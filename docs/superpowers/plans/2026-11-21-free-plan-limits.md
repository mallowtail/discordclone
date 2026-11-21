# Free-Plan Limits Implementation Plan (short form — owner asleep, pre-approved scope)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. The spec carries the detail.

**Goal:** 20 MB/day uploads per person; uploads older than 30 days → plain text; 80% storage → oldest uploads → text; 95% → uploads paused; database 80% safety net deleting oldest messages except pinned/"Keep"; "Keep this message"; /admin Usage tab.

**Spec:** `docs/superpowers/specs/2026-11-21-free-plan-limits-design.md` — binding; read it whole (Owner decisions + Calls).

## Global Constraints
- Limits: 20 MB per person per Korea day (Asia/Seoul); storage 1 GB, warn/clean at 80% (clean to < 75%), pause uploads at 95%; database 500 MB, message safety net at 80% (to < 75%).
- Never touch avatars, server icons, stickers, GIF links in clean-up; delete only files owned by the message's author.
- Never delete pinned or kept messages.
- Copy: "You've uploaded 20 MB today — try again tomorrow."; "Uploads are paused because Mallowchat's storage is almost full."; replacement lines `🖼 picture removed after 30 days`, `📎 <name> — removed after 30 days`, `… removed to free space`.
- Supabase forbids deleting storage files from SQL → file deletion happens in an Edge Function (Storage API, batches ≤ 1000) triggered by pg_cron; no new secrets on Vercel.
- Production has 3 real users and 2 real servers — never touch their data; test with temp data and clean it up.
- Supabase CAPTCHA is ON (browser tests log in via admin generate_link → session).

## Review Focus
1. A user can't exceed the daily quota by calling the Storage API directly.
2. Expiry never deletes files that aren't the expiring message's author's own attachment.
3. The cleanup function can't be triggered by app users (only the cron/admin path).
4. Pinned/kept messages survive the database safety net.
5. Cleanup failures are visible on /admin (last run + error).

---
### Task 1: Database + Edge Function + cron
Spec Design → Database and Edge Function, the message safety net, "Keep" flag + RPC with Call 7's rules. Dry run proves Review Focus 1–4. Deploy the function, schedule the cron (04:00 Asia/Seoul), run it once on temp data end-to-end, verify, commit.

### Task 2: App
Quota/pause error copy in every upload path; "Keep this message" in the … menu + "Kept" marker; /admin Usage tab (bars, last run, Run clean-up now, LiveKit dashboard link). Build passes; tests for pure helpers.

### Task 3: E2E, review, ship
Local e2e (quota hit, pause simulation, expiry on a back-dated temp message, keep/pinned survive the safety net via a forced run), final review + one fix wave, merge, deploy, prod check, clean up temp data.
