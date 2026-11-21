# Safety Tools Implementation Plan (short form — owner waived the full plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. The spec carries the detail; each task names the spec sections it implements.

**Goal:** Reports (message/user/server) to moderators with View Reports and the site admin; moderator delete for Manage Messages; site admin page with site-wide ban/unban (banned users shown as Deleted User, data kept), deleting reported messages/files and any server.

**Spec:** `docs/superpowers/specs/2026-11-21-safety-tools-design.md` — binding; read it whole (including "Calls made after review").

## Global Constraints

- Site admin = only the owner's account (the one production account with a Gmail address); `site_admins` is never writable from the app.
- Reasons exactly: Spam · Harassment or bullying · Inappropriate content · Hate speech · Something else; note ≤ 500.
- Moderator visibility: `view_reports` holders of that server, for message reports in its channels, excluding `admin_only` (reports about someone who holds view_reports there). Everything else admin-only.
- Banned users display exactly like deleted accounts to everyone but the admin; nothing about them is erased unless "Also delete all their messages" is ticked.
- Never leave a server or group without an owner.
- Migrations: new file(s), dry-run then apply via the Management API; production has 3 real users — never touch them (except seeding the owner into site_admins).
- Supabase CAPTCHA is ON: browser tests log in via admin generate_link → session, not the password form.
- Imports `@/…`; pure logic in `src/lib` with one test file per lib file.

## Review Focus

1. A non-admin can't call any admin function or read any report outside their server's rules (incl. DM/group reports), by any request.
2. A moderator never sees a report about themself.
3. A banned user's still-valid token can't post, react, join, call, or report; they're removed from voice.
4. Banning someone who owns servers is refused until each is handed off/deleted; their groups get new owners.
5. A report's snapshot survives the message being deleted; reporting can't be spammed (rate limit + one open report per target).

---

### Task 1: Database migration(s)
Spec Design → Database, plus "Calls made after review" 1, 2, 3 (DB parts), 5, 6 (banned_at). Dry run must prove Review Focus 1–5 plus: moderator delete only with manage_messages in that server and audited; unban restores; owner seeded as site admin. Apply, verify, commit.

### Task 2: Reporting + moderator UI
Report dialog; Report message (MessageActions More menu), Report user (SafetyMenu), Report server (placement builder's call); Delete on others' messages for manage_messages holders; Server Settings → Reports tab with open-count badge; `view_reports` in PERMISSIONS; banned_at treated like deleted_at for display everywhere deleted users are handled.

### Task 3: Admin page + voice removal
`/admin` (Reports · Users · Servers), Admin button in UserPanel for the site admin, ban dialog with server hand-off/delete steps and "Also delete all their messages", unban, delete reported message/files, delete server; the voice-removal route using the existing LiveKit secret; banned-login message on /login; AuthProvider signs out banned users.

### Task 4: End-to-end, ship
Local e2e (report → moderator sees → handles; admin-only routing; moderator delete + audit; ban with owned server/group; banned shown as Deleted User; unban restores; banned voice removal if testable), full checks, final review + one fix wave, merge, deploy, prod e2e, clean up temp data.
