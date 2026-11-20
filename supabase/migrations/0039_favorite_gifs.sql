-- Favourite GIFs, saved per account (like Discord). Only KLIPY's URL and size are stored — not the
-- media — which KLIPY's integration rules allow (the same as a GIF message). Up to 100 each.
create table public.favorite_gifs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  url text not null check (url ~ '^https://([a-z0-9-]+\.)*klipy\.com/[^\s"''<>\\]+$' and char_length(url) <= 2000),
  width integer not null check (width between 1 and 4000),
  height integer not null check (height between 1 and 4000),
  title text not null default '' check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  unique (user_id, url)
);
create index favorite_gifs_user on public.favorite_gifs (user_id, created_at desc);

alter table public.favorite_gifs enable row level security;
create policy "read own favorite gifs" on public.favorite_gifs for select to authenticated
  using (user_id = auth.uid());
create policy "add own favorite gifs" on public.favorite_gifs for insert to authenticated
  with check (
    user_id = auth.uid()
    and (select count(*) from public.favorite_gifs f where f.user_id = auth.uid()) < 100
  );
create policy "remove own favorite gifs" on public.favorite_gifs for delete to authenticated
  using (user_id = auth.uid());
