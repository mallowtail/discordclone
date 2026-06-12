-- replies + pins columns on messages
alter table public.messages add column if not exists reply_to_id uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists mention_author boolean not null default true;
alter table public.messages add column if not exists pinned boolean not null default false;
alter table public.messages add column if not exists pinned_at timestamptz;
create index if not exists messages_pinned_idx on public.messages (channel_id, pinned);

-- pin/unpin via a function: anyone who can read the message may toggle its pin,
-- without granting broad UPDATE (which would let non-authors edit content).
create or replace function public.toggle_pin(msg uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_read_message(msg) then
    raise exception 'not allowed';
  end if;
  update public.messages
    set pinned = not pinned,
        pinned_at = case when not pinned then now() else null end
    where id = msg;
end; $$;

grant execute on function public.toggle_pin(uuid) to authenticated;
