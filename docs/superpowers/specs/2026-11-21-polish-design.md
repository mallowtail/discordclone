# Polish — design (front page, built-in error log, missed-message fix)

## Intent

The last "finish the website" step. The owner answered up front (2026-11-21, before sleeping):
**simple welcome front page**, **built-in error tracking shown on /admin** (no outside account),
**skip the custom domain**. Plus the realtime "missed message" bug found during testing. Further
choices are Claude's (owner asked not to be asked), listed under Calls.

## Goals

1. **Front page** (`/` for logged-out visitors): Mallowchat logo + name, a one-line description,
   4–6 feature highlights (servers & channels, DMs & group chats, voice chat & screen sharing, GIFs
   & stickers, reports & moderation / privacy controls), and **Log in** / **Sign up** buttons.
   Logged-in people go straight to their chats as today (no flash of the landing page if avoidable).
2. **Built-in error log:** errors in people's browsers (uncaught errors, unhandled promise
   rejections, React error boundaries) are saved to the database and shown on **/admin → Errors**
   (newest first, grouped by message, count, last seen, page path, browser), with "Clear".
   A friendly error screen ("Something went wrong — reload") replaces blank pages.
3. **Missed-message fix:** a message sent right as someone opens a chat (while the live
   connection is still starting) currently only shows after a reload. Fix it.

## Non-goals

- Custom domain (owner: skip). Third-party error services. Server-side (Vercel function) error
  capture beyond what's easy (Vercel already keeps function logs). Marketing/SEO pages.

## Anti-goals

- The error log becomes a spam/abuse vector or fills the database (must be rate-limited and capped).
- Error reports contain private data (message text, tokens, emails).
- The front page slows down the app for logged-in users.

## Calls (Claude's, owner to check in the morning)

1. **Front page look:** same dark theme and tokens as the app, centered hero, a simple feature grid,
   no screenshots (they'd go stale). Works at phone width.
2. **Error capture:** `log_client_error(message, stack, path, user_agent)` RPC, callable by signed-in
   users AND anonymous visitors (errors on /login matter), rate-limited (e.g. ≤ 20 per person/IP-less
   session per 10 minutes via a per-user or per-fingerprint counter; anonymous capped globally per
   minute), truncated (message ≤ 500, stack ≤ 4000 chars), scrubbed of anything that looks like a
   token/email/URL query, deduplicated (same message+path within an hour increments a count), and the
   table capped (oldest deleted beyond ~5,000 rows). Only the site admin can read or clear.
   The user id is stored for signed-in users (helps the admin reproduce), shown only on /admin.
3. **Missed-message fix approach:** after the live channel reports SUBSCRIBED, do one more catch-up
   load a couple of seconds later, and also catch up when the tab regains focus/visibility and after
   a reconnect — merging without duplicates. Apply to channel/DM messages (and any other live lists
   that showed the same gap if cheap: sidebars already reload on SUBSCRIBED).

## How it works today

- `src/app/page.tsx` is a client component that redirects to `/channels/first` or `/login`.
- `src/hooks/useMessages.ts` subscribes to postgres_changes and reloads on SUBSCRIBED (comments at
  ~62, ~108, ~125); there are no `error.tsx`/`global-error.tsx` files.
- `/admin` (safety tools) has tabs Reports · Users · Servers and (free-plan limits, in progress)
  Usage; `is_site_admin()` exists.
- Read AGENTS.md: Next.js 16 conventions differ — read `node_modules/next/dist/docs/` for
  error.tsx/global-error.tsx, route groups and redirects before coding.

## Left to the builder
- Exact SQL; component layout; whether the front page is a server component (check the session on
  the server and redirect) or client; tests (unit for scrubbing/dedup helpers; a dry run for the RPC's
  rate limit, scrubbing, cap and admin-only read; a browser check of the front page at phone width,
  an induced error appearing on /admin, and the missed-message scenario).
