-- Voice channels: a channel is either text (the default; every existing channel) or voice.
-- Voice itself runs on LiveKit Cloud; the app's server hands out join tokens after checking
-- membership (src/app/api/voice/token), so nothing else is needed in the database for channels.
alter table public.channels
  add column kind text not null default 'text' check (kind in ('text', 'voice'));
