-- A forwarded message carries a frozen snapshot of the original (see ForwardSnapshot in the app).
alter table public.messages
  add column if not exists forward_snapshot jsonb;
