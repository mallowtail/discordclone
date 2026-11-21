<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Where things live

Imports always use `@/…` (= `src/…`). Pure logic lives in `src/lib` and is unit-tested in `tests/` (one test file per lib file, same name).

- `src/app/` — routes (folder names are URLs; don't move). `(app)/` = signed-in shell: `channels/[channelId]`, `channels/first` (opens a server), `dms` (Friends page), `dms/[conversationId]` (DM or group), `admin` (site admin only: Reports · Users · Servers · Usage · Errors; "Not found" for everyone else). `/` = welcome page for logged-out visitors (signed-in users are redirected server-side). `api/link-preview` (+ `/image` relay), `api/voice/token` + `api/voice/rooms` + `api/voice/call` (start/check DM calls against who is really connected) (LiveKit), `api/admin/ban-voice` (site admin: drop a banned person from every voice room). GIFs (KLIPY) are fetched in the browser, per their rules. `auth/callback`, `welcome` (pick username after OAuth), `invite/[code]`, `login`, `register`.
- `src/components/`
  - `ui/` — Modal, ConfirmDialog, Drawer, Dropdown, EmptyState, Skeleton, SidePanel (header buttons + side-panel overlay), overlayStack (Escape handling)
  - `providers/` — Auth, Presence, Unread, Friends, LinkGuard ("Leaving Mallowchat"), FavoriteGifs, Safety (block/ignore), Voice (the one LiveKit connection), ProfilePopover, Drawer
  - `messages/list/` — MessageList, MessageItem, MessageContent (markdown, images, files, GIFs), StickerImage, MessageActions, ReactionBar, TypingIndicator, LinkPreviews
  - `messages/composer/` — MessageInput (+ menu, uploads queue, GIF/emoji), MentionAutocomplete, MessageDropZone, GifPicker, StickerPicker
  - `messages/polls/`, `messages/forwarding/`, `messages/pins/`
  - `servers/layout/` — ServerRail, ServerSidebar, ServerIcon · `servers/settings/` — ServerSettings (full-screen tabs: Overview, Roles, Members, Invites, Bans, Stickers (StickersTab), Reports (ReportsTab), Audit Log) · `servers/dialogs/` — add/create/invite · `servers/members/` · `servers/roles/` (RolesPanel) · `servers/search/`
  - `dms/sidebar/` — DmSidebar, NewDmDialog, PeoplePickerDialog, RequestBadge · `dms/groups/` — GroupIcon, GroupMembersPanel
  - `user/profile/` — Avatar, ProfileCard, FullProfileModal, FriendButton, StatusBubble, UserPanel · `user/settings/` — UserSettings + sections
  - `voice/` — VoiceBar, VoiceChannelRow, VoiceChannelView, CallButton, IncomingCall, ScreenShares (watch-to-download streams), micGate (voice activity / push-to-talk gate)
  - `auth/` — OAuthButtons
  - `admin/` — /admin tabs (AdminReportsTab, AdminUsersTab, AdminServersTab, AdminUsageTab — storage/database meters + clean-up runs, AdminErrorsTab — browser error log), BanDialog (hand off / delete owned servers, then ban), AdminDeleteServerButton, adminActions (admin deletes + removing the files they return)
  - `reports/` — ReportDialog (report a message / user / server), ReportCard (+ MarkHandledButton; shared by Server Settings → Reports and /admin)
- `src/lib/`
  - `messages/` — validation, mentions, reactions, pins, polls, gifs, stickers, embeds (link → player), linkGuard, forward, grouping, messagePaging, sendAttachment, typing, unread, format, recentEmojis, localDeletes (own-screen delete)
  - `media/` — upload, uploadLimits (20 MB/day + paused copy; `upload_status()`), imageOptimize, imagePlan, url
  - `servers/` — invite, permissions, roleHierarchy, roleColor(s), moderation, auditLog, server-icon
  - `search/` — search, searchQuery, searchSuggest
  - `users/` — profile, oauthProfile, friends, conversations, dm, avatarColor, popover, account (deleted + site-banned accounts: `shownProfile` dresses a banned profile as "Deleted User" — use it wherever other people's profiles are fetched)
  - `voice/` — rooms (LiveKit room names ↔ channel / conversation), settings (Settings → Voice, saved in localStorage), calls (stale-call rule)
  - `reports/` — reports (reasons, error copy, snapshot display helpers)
  - `admin/` — admin error copy, user search filter, grouping returned (bucket, path) files
  - `errors/` — report (scrub/truncate/dedupe, mirrors the SQL scrub), clientReporter (window errors + boundaries → `log_client_error`; installed by `instrumentation-client.ts`)
  - `server/` — server-only: safeFetch (SSRF-safe fetch), linkPreview, linkMeta
  - `supabase/` — browser and server clients
- `src/hooks/` — data hooks (useMessages, useConversations, useServers, useServerPermissions, useReactions, useTyping, useIsSiteAdmin (cached once per session), …)
- `supabase/migrations/` — numbered SQL, applied to production by hand via the Management API. Security rules live here (RLS, security-definer functions, triggers in 0032 guarding message edits/inserts).
- `supabase/functions/expire-uploads/` — daily clean-up Edge Function (pg_cron 04:00 KST, secret in Vault; admin "Run clean-up now"): 30-day uploads → text (pinned/kept/open-report files kept), orphans, 80% storage pressure, database safety net. Storage files can only be deleted through the Storage API, never SQL.
