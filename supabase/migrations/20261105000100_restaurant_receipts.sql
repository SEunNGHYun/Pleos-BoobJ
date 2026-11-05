begin;
-- Persistent operation receipts make retries safe across processes/restarts.
create table public.restaurant_order_actions (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references public.users(id) on delete restrict,
 order_id uuid not null references public.orders(id) on delete restrict,
 action text not null check(action in ('ACCEPT','REJECT')),
 request_key uuid not null,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 request_payload jsonb not null,
 response jsonb not null,
 created_at timestamptz not null default now(),
 unique(actor_id,order_id,action,request_key)
);
create index restaurant_actions_order on public.restaurant_order_actions(order_id,created_at);
alter table public.restaurant_order_actions enable row level security;
revoke all on public.restaurant_order_actions from public,anon,authenticated,service_role;
grant select,insert on public.restaurant_order_actions to service_role;
commit;
