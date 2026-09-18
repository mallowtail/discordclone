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
-- with check repeats the using predicate explicitly (Postgres would reuse it implicitly if
-- omitted, since it references the same row-owning column) so the "can't repoint user_id"
-- guarantee doesn't depend on the reader knowing that implicit-reuse rule.
-- channel_id is intentionally left unconstrained here: a user repointing their own row to a
-- different channel_id is still confined to their own (user_id, channel_id) row by RLS, so
-- at worst it's bookkeeping noise, not a security issue.
create policy "update own channel reads"
  on public.channel_reads for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
