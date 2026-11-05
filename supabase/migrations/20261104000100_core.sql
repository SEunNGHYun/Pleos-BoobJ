begin;
create schema if not exists babmatj_private;
revoke all on schema babmatj_private from public, anon, authenticated;

create type public.order_status as enum ('PENDING','ACCEPTED','REJECTED','CANCELLED','COMPLETED');
create type public.cooking_status as enum ('UNSCHEDULED','SCHEDULED','COOKING','READY');
create type public.vehicle_status as enum ('UNKNOWN','EN_ROUTE','NEARBY','ARRIVED');

create table public.users (
 id uuid primary key references auth.users(id) on delete restrict,
 display_name text,
 contact_phone text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.user_vehicles (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete restrict,
 plate_number text not null check (length(btrim(plate_number))>0), label text,
 is_default boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,plate_number)
);
create unique index one_default_vehicle on public.user_vehicles(user_id) where is_default;
create table public.restaurants (
 id uuid primary key default gen_random_uuid(), name text not null check (length(btrim(name))>0),
 contact_phone text not null check (contact_phone ~ '^\+[1-9][0-9]{7,14}$'), address text not null check(length(btrim(address))>0),
 latitude double precision check(latitude between -90 and 90), longitude double precision check(longitude between -180 and 180),
 is_accepting_orders boolean not null default false,
 max_concurrent_orders integer not null default 1 check(max_concurrent_orders>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((latitude is null)=(longitude is null))
);
create table public.restaurant_members (
 restaurant_id uuid not null references public.restaurants(id) on delete restrict,
 user_id uuid not null references public.users(id) on delete restrict,
 role text not null check(role in ('OWNER','STAFF')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(restaurant_id,user_id)
);
create index restaurant_members_user on public.restaurant_members(user_id);
create unique index one_restaurant_owner on public.restaurant_members(restaurant_id) where role='OWNER';
create table public.restaurant_pickup_locations (
 id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id) on delete restrict,
 name text not null check(length(btrim(name))>0), address text not null check(length(btrim(address))>0),
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180), instructions text,
 is_active boolean not null default true, is_default boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(restaurant_id,id), check(not is_default or is_active)
);
create index pickup_locations_restaurant on public.restaurant_pickup_locations(restaurant_id);
create unique index one_default_pickup on public.restaurant_pickup_locations(restaurant_id) where is_active and is_default;
create table public.orders (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete restrict,
 restaurant_id uuid not null references public.restaurants(id) on delete restrict,
 request_key uuid not null, pickup_location_id uuid not null,
 pickup_vehicle_plate text not null check(length(btrim(pickup_vehicle_plate))>0),
 pickup_contact_phone text not null check(pickup_contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
 pickup_name text not null, pickup_address text not null,
 pickup_latitude double precision not null check(pickup_latitude between -90 and 90),
 pickup_longitude double precision not null check(pickup_longitude between -180 and 180), pickup_instructions text,
 order_status public.order_status not null default 'PENDING',
 cooking_status public.cooking_status not null default 'UNSCHEDULED',
 vehicle_status public.vehicle_status not null default 'UNKNOWN',
 accepted_cook_duration_minutes integer check(accepted_cook_duration_minutes>0),
 preparation_buffer_minutes integer not null default 0 check(preparation_buffer_minutes>=0),
 eta_at timestamptz, eta_updated_at timestamptz,
 cooking_started_at timestamptz, estimated_ready_at timestamptz, ready_at timestamptz,
 accepted_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
 version integer not null default 0 check(version>=0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,request_key), unique(restaurant_id,id),
 foreign key(restaurant_id,pickup_location_id) references public.restaurant_pickup_locations(restaurant_id,id) on delete restrict,
 check(order_status not in ('ACCEPTED','COMPLETED') or (accepted_cook_duration_minutes is not null and accepted_at is not null)),
 check(cooking_status not in ('COOKING','READY') or (cooking_started_at is not null and estimated_ready_at is not null)),
 check(cooking_status<>'READY' or ready_at is not null),
 check(order_status<>'COMPLETED' or (cooking_status='READY' and completed_at is not null)),
 check(order_status<>'CANCELLED' or cancelled_at is not null),
 check(order_status<>'PENDING' or cooking_status='UNSCHEDULED'),
 check(ready_at is null or (cooking_started_at is not null and ready_at>=cooking_started_at)),
 check(estimated_ready_at is null or (cooking_started_at is not null and estimated_ready_at>cooking_started_at))
);
create index orders_restaurant_status on public.orders(restaurant_id,order_status,created_at);
create index orders_user_created on public.orders(user_id,created_at);
create table public.order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete restrict,
 menu_name_snapshot text not null check(length(btrim(menu_name_snapshot))>0),
 quantity integer not null check(quantity>0), unit_price_krw bigint not null check(unit_price_krw>=0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index items_order on public.order_items(order_id);
create table public.cooking_reservations (
 id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id) on delete restrict,
 order_id uuid not null unique, planned_start_at timestamptz not null, planned_end_at timestamptz not null,
 released_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(restaurant_id,order_id) references public.orders(restaurant_id,id) on delete restrict,
 check(isfinite(planned_start_at) and isfinite(planned_end_at) and planned_end_at>planned_start_at)
);
create index reservations_start on public.cooking_reservations(restaurant_id,planned_start_at);
create index reservations_end on public.cooking_reservations(restaurant_id,planned_end_at);

create function babmatj_private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=clock_timestamp(); return new; end $$;
do $$ declare t text; begin
 foreach t in array array['users','user_vehicles','restaurants','restaurant_members','restaurant_pickup_locations','orders','order_items','cooking_reservations'] loop
  execute format('create trigger touch_updated_at before update on public.%I for each row execute function babmatj_private.touch_updated_at()',t);
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated, service_role',t);
  execute format('grant select on public.%I to service_role',t);
 end loop;
end $$;
-- Clients cannot directly read/write business tables. NestJS must authorize every request.
grant insert,update,delete on public.users,public.user_vehicles,public.restaurants,
 public.restaurant_members,public.restaurant_pickup_locations to service_role;
-- Orders/items/reservations are writeable ONLY through approved RPCs for the backend.
revoke all on all functions in schema babmatj_private from public, anon, authenticated, service_role;
commit;
