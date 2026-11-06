-- Realtime sends DELETE events to every subscriber regardless of RLS, carrying only the old row's
-- primary key. With (requester, addressee) as the key, any signed-in user could watch who unfriends
-- or cancels a request with whom. Key the table on an opaque id instead, so a delete event reveals
-- nothing. The pair stays unique (plus the existing one-row-per-unordered-pair index).
alter table public.friendships add column id uuid not null default gen_random_uuid();
alter table public.friendships drop constraint friendships_pkey;
alter table public.friendships add primary key (id);
alter table public.friendships add constraint friendships_pair unique (requester, addressee);
