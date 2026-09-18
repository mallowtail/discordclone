-- Per-user, per-channel read state, for unread indicators in the sidebar/rail.
create table public.channel_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

alter table public.channel_reads enable row level security;

-- channel_reads: a user may only see and write their own read state.
create policy "read own channel reads"
  on public.channel_reads for select to authenticated
  using (user_id = auth.uid());
create policy "insert own channel reads"
  on public.channel_reads for insert to authenticated
  with check (user_id = auth.uid());
create policy "update own channel reads"
  on public.channel_reads for update to authenticated
  using (user_id = auth.uid());
