-- Sites a user has chosen to trust: links to them open without the "Leaving Mallowchat" warning.
-- Saved on the account (not the device), like Discord. Edited through the existing
-- "update own profile" policy; the checks keep it to plain hostnames and a sane size.
create or replace function public.valid_domain_list(domains text[])
returns boolean language sql immutable as $$
  select cardinality(domains) <= 200
     and not exists (select 1 from unnest(domains) as d where d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or char_length(d) > 253);
$$;

alter table public.profiles
  add column trusted_domains text[] not null default '{}',
  add constraint profiles_trusted_domains check (public.valid_domain_list(trusted_domains));
