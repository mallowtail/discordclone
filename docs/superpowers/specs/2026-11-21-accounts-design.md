# Accounts — design (delete my account, bot check, server transfer & delete, 1-letter usernames)

## Intent

Part of "finishing the website" (the owner's roadmap: accounts → safety tools → free-plan limits →
polish). Mallowchat is a Discord-like chat app for a small group of friends (~11–14). The owner
wants people to be able to **delete their account**, and wants **bots kept out of sign-up/login**.
Email features (password reset, email verification) were **dropped for now**: sending email needs a
provider that asks for a phone number, which the owner can't use. They can be added later by
configuring SMTP in Supabase.

## Goals

- **Delete my account** in Settings → Account, Discord-style (approach A below): old messages stay,
  shown as **"Deleted User"** with a plain avatar; the login (email, password, Discord/GitHub link)
  is erased; personal data (name, avatar, bio, status, friends, blocks, favorites, settings) is gone.
- **Transfer server ownership** (Server Settings → Overview, owner only), needed so owners can hand
  servers off before deleting their account — and useful on its own.
- **Delete server** (Server Settings → Overview, owner only). Nobody can delete a server today (no
  delete policy, no UI); owners who are the only member of a server would otherwise be unable to
  delete their account.
- **Bot check** (Cloudflare Turnstile) on the email sign-up and email login forms.
- **Usernames may be 1–20 characters** (was 3–20), same allowed characters.
- **Deleted usernames are freed**: someone else can later sign up with that name (owner's choice;
  old `@name` text in messages then points at the new person — accepted).

## Non-goals

- Password reset, email verification, email change confirmation (no email provider).
- A bot check for Discord/GitHub logins (those providers already check).
- Restoring a deleted account; deleting the person's old messages (owner chose to keep them).

## Anti-goals

- Deleting an account leaves a server with no owner, or a group chat with no owner.
- Deleting an account fails half-way and leaves a broken, un-loginable but un-deleted account.
- Turning the bot check on locks everyone out (enabling it before the app sends tokens).
- A deleted user's name, avatar or profile card still shows anywhere.

## Decisions after review (owner)

- Delete server is added (option b), rather than auto-deleting solo servers during account deletion.
- Deleted usernames are freed for reuse.
- Username minimum length is 1.

## Calls made after review (owner to check)

- **Password checks in Settings get the bot check too.** Once Supabase CAPTCHA is on, every
  `signInWithPassword` without a token is rejected — including the change-password re-auth in
  `AccountSection.tsx` and the delete-account password confirmation — so those dialogs show the
  Turnstile widget as well.
- **Any deletion of a login tombstones the profile**, not just the button: a trigger on `auth.users`
  delete does the cleanup + tombstone, so deleting a user from the Supabase dashboard or the admin
  API (as test cleanup does) never leaves a real name/avatar behind. Per the owner, that trigger
  **refuses** while the person still owns a server — ownership must be passed on (or the server
  deleted) first, on every path. The Delete account screen says: "You own these servers. Pass on
  ownership to someone else (or delete the server) before deleting your account." and lists them.
- Test accounts for e2e are created with the admin API (service role, `email_confirm: true`) instead
  of the sign-up API once CAPTCHA is on.

## Approaches (decided with the owner)

Delete my account:
- **A. "Deleted User" placeholder (chosen).** The `profiles` row stays as an empty shell; messages,
  reactions etc. keep pointing at it, so the UI needs almost no changes.
- B. Remove the profile; make `messages.author_id` nullable and handle "no author" everywhere.
  Rejected: touches every screen that shows a name/avatar/reply/mention/profile card.

Bot check: one sensible way — Supabase's native CAPTCHA support with Turnstile (the widget on the
form produces a token passed as `options.captchaToken` to `signUp` / `signInWithPassword`; Supabase
verifies it with the secret key the owner enters in the dashboard).

## How it works today (relevant facts)

- `profiles.id` references `auth.users` **on delete cascade**, and `messages.author_id`,
  `reactions.user_id`, `server_members`, `conversation_members`, `friendships`, `user_blocks`,
  `favorite_gifs`, `channel_reads`, `poll_votes`, `member_roles`, `bans.user_id` reference
  `profiles` on delete cascade. So deleting a user today **deletes all their messages**.
- `bans.banned_by` references `profiles` with **no action** → deleting someone who ever banned a
  person fails. `servers.owner_id`, `conversations.owner_id`, `audit_log.*`, `calls.started_by`,
  `stickers.created_by`, `invites.created_by` are set null.
- Username format: `^[A-Za-z0-9_]{3,20}$`, unique.
- Groups: `leave_group`, `transfer_group_ownership` exist (0031); leaving as owner already passes
  ownership to a random member.
- No server ownership transfer exists.
- Auth calls: `src/app/register/page.tsx` (`supabase.auth.signUp`), `src/app/login/page.tsx`
  (`signInWithPassword`); Discord + GitHub OAuth via `src/components/auth/OAuthButtons.tsx`.
  Settings → Account: `src/components/user/settings/AccountSection.tsx` (change password re-auths
  with `signInWithPassword`).
- Turnstile site key is set: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (in `.env.local` and Vercel
  production). The secret key is held by the owner; **Supabase CAPTCHA is currently OFF**.

## Design

### Database (new migration, applied by hand after a dry run)

- **Profile tombstone:** add `profiles.deleted_at timestamptz`. Change `profiles.id`'s foreign key
  to `auth.users` so deleting the auth user does **not** delete the profile (drop the FK, or make it
  non-cascading — builder's call; a dangling id is acceptable for tombstones). 
- **`bans.banned_by`** → `on delete set null`.
- **Cleanup lives in a trigger on `auth.users` delete** (SECURITY DEFINER), so every deletion path
  tombstones. `delete_my_account()` — SECURITY DEFINER RPC, callable by authenticated, acting on
  `auth.uid()` only — refuses with `'transfer or delete your servers first'` if the caller owns any
  server, then deletes the caller's `auth.users` row, which fires the trigger. The trigger itself also
  refuses (`'transfer or delete your servers first'`) while the person owns any server, so even a
  deletion from the Supabase dashboard or admin API can't leave a server ownerless (owner's rule:
  ownership must be passed on first). Otherwise the trigger:
  2. For each group chat the caller is in: leave it (reusing the existing leave logic, so an owner's
     group passes to a random member; an owner alone in a group → the group is deleted, as today).
  3. Delete the caller's: server memberships (+ member roles), friendships (both directions),
     blocks (both directions), favorite GIFs, channel reads, and anything else purely personal.
     Keep: messages, reactions, poll votes, 1:1 DM memberships (so the other person keeps the DM).
  4. Tombstone the profile: `display_name = 'Deleted User'`, `username = 'deleted_' || <first 8 hex
     of id>`, `avatar_url = null`, `bio = null`, `status = null`, `recent_emojis = '{}'`,
     `trusted_domains = '{}'`, `dm_policy = 'none'`, friend-request settings all false,
     `deleted_at = now()`.
  5. (The `auth.users` row itself is being deleted; sessions, identities and OAuth links cascade.)
  All in one transaction, so it either fully happens or not at all.
- **Tombstones are inert:** nobody can DM, friend, add to groups, mention-autocomplete, or invite a
  profile with `deleted_at` set (check the existing `can_reach` / friend-request / group-add paths;
  `dm_policy='none'` and the friend settings already block most). New usernames starting with
  `deleted_` are refused (those are the tombstones' placeholders); every other old username is free.
- **Username length:** change `profiles_username_format` (0032) to `^[A-Za-z0-9_]{1,20}$`, and every
  client-side check (welcome page, settings, mention parsing/autocomplete in
  `src/lib/messages/mentions.ts`, anywhere a 3-character minimum is assumed) to match.
- **`delete_server(srv uuid)`** — SECURITY DEFINER: owner only; deletes the server (channels,
  categories, messages, roles, invites, stickers etc. cascade). The app first removes the server's
  sticker files and icon from storage (while the caller still has permission); anyone in its voice
  channels is dropped (the app leaves the call when the server disappears; new tokens are refused).
- **`transfer_server_ownership(srv uuid, new_owner uuid)`** — SECURITY DEFINER: caller must own
  `srv`; `new_owner` must be a current member and not a tombstone; sets `servers.owner_id`. Logged to
  the audit log as `ownership_transfer` (widen the action check).

### App

- **Settings → Account → "Delete account"** (danger zone at the bottom): explains what happens
  (messages stay as "Deleted User"; everything else is erased; can't be undone). If the person owns
  servers, it lists them with "Open settings" and the Delete button is disabled until none are left.
  Confirmation: email/password users type their password (checked with `signInWithPassword`, same as
  change-password); Discord/GitHub-only users type their username. Then: leave any voice call, call
  `delete_my_account`, sign out, go to `/login` with a short "Your account was deleted" note.
- **Server Settings → Overview → "Transfer ownership"** (owner only): pick a member, confirm
  ("You'll stop being the owner"), call the RPC; the settings reflect the new owner. The existing
  `protect_server_owner` trigger must let this RPC through.
- **Server Settings → Overview → "Delete server"** (owner only, danger zone): confirm by typing the
  server's name; remove its storage files, call `delete_server`, close settings, go to `/dms`. Other
  members' sidebars drop it live; anyone viewing it lands on "Server not found".
- **"Deleted User" display:** profiles with `deleted_at` show the name "Deleted User", a plain grey
  avatar, and no profile card details (the card says "This account was deleted"); no DM/friend
  buttons. Most of this follows from the tombstoned fields; the profile card/popover and friend
  buttons need explicit handling.
- **Bot check:** a small `Turnstile` component (loads Cloudflare's script
  `https://challenges.cloudflare.com/turnstile/v0/api.js` explicitly; renders the widget; reports a
  token; resets after a failed attempt) on the sign-up and email-login forms. The submit button waits
  for a token. Tokens are passed as `options: { captchaToken }`. If the site key env var is missing,
  the widget is skipped (so dev without a key still works).
- **Rollout order (anti-goal: locking everyone out):** ship the widget first (sending tokens is
  harmless while Supabase CAPTCHA is off) → the owner enables CAPTCHA in Supabase (Authentication →
  Attack Protection → Turnstile + secret) → test sign-up and login on production.

## Left to the builder

- How the profiles→auth.users FK is relaxed; exact list of "purely personal" tables to clear (check
  every FK listed above); whether tombstone checks are a helper function.
- Component names/placement within the existing settings styles; the deleted-user avatar style.
- Tests: unit tests for any new pure logic; a dry run proving delete keeps messages and removes
  personal rows, refuses with owned servers, passes group ownership, and that a tombstone can't be
  DM'd/friended; an e2e for delete (email user + group owner), transfer, and the Turnstile flow
  (Cloudflare's always-pass test key `1x00000000000000000000AA` works for local UI tests while
  Supabase CAPTCHA is off).
