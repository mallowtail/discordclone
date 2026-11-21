<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Where things live

Imports always use `@/…` (= `src/…`). Pure logic lives in `src/lib` and is unit-tested in `tests/` (one test file per lib file, same name).

- `src/app/` — routes (folder names are URLs; don't move). `(app)/` = signed-in shell: `channels/[channelId]`, `channels/first` (opens a server), `dms` (Friends page), `dms/[conversationId]` (DM or group). `api/link-preview` (+ `/image` relay), `api/voice/token` + `api/voice/rooms` + `api/voice/call` (start/check DM calls against who is really connected) (LiveKit). GIFs (KLIPY) are fetched in the browser, per their rules. `auth/callback`, `welcome` (pick username after OAuth), `invite/[code]`, `login`, `register`.
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
  - `reports/` — ReportDialog (report a message / user / server), ReportCard (+ MarkHandledButton; shared by Server Settings → Reports and /admin)
- `src/lib/`
  - `messages/` — validation, mentions, reactions, pins, polls, gifs, stickers, embeds (link → player), linkGuard, forward, grouping, messagePaging, sendAttachment, typing, unread, format, recentEmojis
  - `media/` — upload, imageOptimize, imagePlan, url
  - `servers/` — invite, permissions, roleHierarchy, roleColor(s), moderation, auditLog, server-icon
  - `search/` — search, searchQuery, searchSuggest
  - `users/` — profile, oauthProfile, friends, conversations, dm, avatarColor, popover, account (deleted + site-banned accounts: `shownProfile` dresses a banned profile as "Deleted User" — use it wherever other people's profiles are fetched)
  - `voice/` — rooms (LiveKit room names ↔ channel / conversation), settings (Settings → Voice, saved in localStorage), calls (stale-call rule)
  - `reports/` — reports (reasons, error copy, snapshot display helpers)
  - `server/` — server-only: safeFetch (SSRF-safe fetch), linkPreview, linkMeta
  - `supabase/` — browser and server clients
- `src/hooks/` — data hooks (useMessages, useConversations, useServers, useServerPermissions, useReactions, useTyping, …)
- `supabase/migrations/` — numbered SQL, applied to production by hand via the Management API. Security rules live here (RLS, security-definer functions, triggers in 0032 guarding message edits/inserts).
