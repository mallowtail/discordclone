# Free-plan limits — design

## Intent

Part of "finishing the website". Mallowchat runs on free plans: Supabase (1 GB file storage,
500 MB database) and LiveKit (5,000 voice minutes, 50 GB video/month). One person — or a slow build-up
of pictures — could fill storage and break uploads for everyone. The owner wants per-person upload
limits, automatic clean-up of old uploads, protection near the limit, and a usage panel on /admin.
Owner answered every question up front (2026-11-21, before going to sleep); further choices are
Claude's, listed under "Calls".

## Owner decisions (binding)

- **20 MB per person per day** of uploads. No lifetime cap.
- **Uploaded pictures/files older than 30 days become plain text** (the file's name), freeing their
  storage.
- **If storage still reaches 80%**, the oldest uploads become plain text until it's back under.
- **At 95% storage, new uploads pause for everyone** (text chat keeps working).
- **GIF links and stickers are left alone** (they use no per-person storage).
- **/admin shows usage bars with a warning at 80%.**
- **Text messages (database safety net, owner chose this over deleting after a month):** messages are
  kept forever; only if the **database reaches 80%** of its 500 MB are the **oldest messages deleted**
  until it's back under — **never pinned messages or messages marked "Keep this message"**. A
  "Keep this message" option goes in the message "…" menu.

## Calls (Claude's, owner to check in the morning)

1. **What counts toward the 20 MB/day:** every file a person uploads (message pictures and files,
   avatar, server icon, stickers they add), by `storage.objects.owner_id`, counted per **Korea day**
   (midnight to midnight, Asia/Seoul — the users are near Seoul). The check runs before each upload;
   an upload that starts under the limit is allowed to finish (so a day can end slightly over).
2. **What "becomes plain text" looks like:** the message keeps its text; the picture/file is replaced
   by a line like `🖼 picture removed after 30 days` or `📎 notes.pdf — removed after 30 days`
   (`removed to free space` for the 80% rule), and the file is deleted from storage. The same is
   done inside forwarded copies of that message. Avatars, server icons and stickers are never
   expired (they're small and in use); report snapshots keep their (now broken) image links — the
   admin still sees the text.
3. **How the clean-up runs:** a daily scheduled job (pg_cron) that calls a small Supabase Edge
   Function; the function uses Supabase's built-in service credentials to delete files through the
   Storage API (Supabase forbids deleting storage files directly from SQL). No new secrets on Vercel.
   The same job applies the 80% rule (oldest first, until under 75% so it doesn't run every day).
4. **95% pause:** enforced by the attachments/avatars/server-icons/stickers upload policies (the
   database refuses new files when total storage ≥ 95% of 1 GB), with the app showing
   "Uploads are paused because Mallowchat's storage is almost full."
5. **Voice usage:** LiveKit has no simple usage API for the free plan, so /admin shows storage and
   database bars from Supabase and a link to the LiveKit dashboard for voice minutes and video data.
7. **Who can mark "Keep this message":** the author (own messages); in servers also anyone with
   Manage Messages; in DMs/groups any member. Shown as a small "Kept" marker; "Don't keep" undoes it.
   The 80% message clean-up deletes oldest-first until under 75%, logs to `cleanup_runs`, and also
   removes those messages' attachment files (author-owned only).
6. **Messages:** "You've uploaded 20 MB today — try again tomorrow." (with how much is left shown
   in the upload error when close).

## Non-goals

- Paid plans, per-server quotas, compressing videos, limiting message count or voice minutes.

## Anti-goals

- Clean-up deletes the wrong files (anything not tied to an expired message), or touches avatars,
  icons, stickers, GIF links.
- Clean-up silently fails forever (the admin page shows when it last ran and what it did).
- A person bypasses the daily limit by calling the storage API directly.

## How it works today

- Uploads: `src/lib/media/upload.ts` (`uploadAttachment`, `uploadImageTo`; images ≤ 5 MB after
  shrinking, other files ≤ 25 MB; buckets attachments/avatars/server-icons/stickers; paths random
  UUID names, server-icons in `<server_id>/`, stickers in `<server_id>/`). Message columns
  `image_url`, `file_url`, `file_name`; constraints `messages_image_url`/`messages_file_url` (0032);
  forward snapshots copy them (0037+).
- Storage today: 0 objects. Database ≈ 17 MB.
- Admin page `/admin` (safety tools) with tabs Reports · Users · Servers; `is_site_admin()`.

## Design

### Database (new migration)
- `upload_quota_used(uid)` → bytes uploaded today (Korea day) by that user across the four buckets.
- Storage insert policies for the four buckets gain: `upload_quota_used(auth.uid()) < 20 MB` and
  `storage_total_bytes() < 0.95 × 1 GB` (re-create each policy from its newest definition).
- `expire_uploads(mode)` (definer, not callable by app users): finds messages whose `image_url` /
  `file_url` should go (age > 30 days, or oldest-first for the 80% rule), rewrites them to plain
  text per Call 2 (also forward snapshots), and returns the (bucket, path) list to delete — only
  paths whose storage object belongs to that message's author (as 0053 does).
- `cleanup_runs` table: when, mode, messages changed, files deleted, bytes freed, error — readable by
  the site admin only.
- `admin_usage()` (admin only): storage bytes by bucket and total, database size, quota limits,
  last cleanup run.
- pg_cron schedule: daily at 04:00 Korea time, calling the Edge Function via pg_net.

### Edge Function `expire-uploads`
- Called only by the cron job (checks a shared secret stored in the database/Vault, or the
  service-role JWT); calls `expire_uploads('age')`, deletes returned files via Storage (batches of
  ≤ 1000), then `expire_uploads('pressure')` if total ≥ 80%, then records a `cleanup_runs` row.

### App
- Upload errors mapped to the copy in Call 4/6 (the storage error text for a policy refusal is
  generic — check the quota first on the client via `upload_quota_used` so the message is clear).
- The message renderer shows the plain-text replacement naturally (it's just message text).
- `/admin` → new **Usage** tab: bars for storage (and per bucket) and database, the 80%/95% lines,
  last clean-up run and what it did, a "Run clean-up now" button (admin only), and a link to the
  LiveKit dashboard.

## Left to the builder
- Exact SQL; how the Edge Function is authenticated and deployed (Management API or CLI); the cron
  wiring; tests (unit for pure helpers; dry run proving the quota and pause policies, the expiry
  rewrite, author-owned-files-only; one real end-to-end run of the function on temp data).
