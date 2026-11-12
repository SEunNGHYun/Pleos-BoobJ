begin;
alter table public.restaurant_pickup_locations
 add column space_capacity integer not null default 1 check (space_capacity between 1 and 30),
 add column handoff_minutes integer not null default 3 check (handoff_minutes between 1 and 60);

create table public.pickup_space_reservations (
 order_id uuid primary key references public.orders(id) on delete restrict,
 location_id uuid not null references public.restaurant_pickup_locations(id) on delete restrict,
 space_number integer not null check (space_number > 0),
 start_at timestamptz not null,
 end_at timestamptz not null,
 status text not null default 'RESERVED' check (status in ('RESERVED','OCCUPIED','RELEASED')),
 check (isfinite(start_at) and isfinite(end_at) and start_at < end_at)
);
create index pickup_space_active on public.pickup_space_reservations(location_id,space_number,start_at)
 where status <> 'RELEASED';
alter table public.pickup_space_reservations enable row level security;
revoke all on public.pickup_space_reservations from public,anon,authenticated,service_role;
grant select,insert on public.pickup_space_reservations to service_role;

create function babmatj_private.check_pickup_space() returns trigger
language plpgsql security definer set search_path='' as $$
declare capacity integer;
begin
 if tg_op='INSERT' and new.status<>'RESERVED' then raise exception 'pickup must start reserved'; end if;
 if tg_op='UPDATE' then
  if (old.order_id,old.location_id,old.space_number,old.start_at,old.end_at)
     is distinct from (new.order_id,new.location_id,new.space_number,new.start_at,new.end_at) then
   raise exception 'pickup window is immutable';
  end if;
  if old.status=new.status or new.status='RELEASED' then return new; end if;
  if old.status<>'RESERVED' or new.status<>'OCCUPIED' then raise exception 'invalid pickup transition'; end if;
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'pickup reservation requires read committed';
 end if;
 select space_capacity into capacity from public.restaurant_pickup_locations
  where id=new.location_id and is_active for update;
 if capacity is null or new.space_number>capacity then raise exception 'invalid pickup space'; end if;
 if not exists(select 1 from public.orders where id=new.order_id
  and pickup_location_id=new.location_id and order_status='ACCEPTED') then
  raise exception 'pickup requires an accepted order at this location';
 end if;
 if exists(select 1 from public.pickup_space_reservations r
  where r.location_id=new.location_id and r.space_number=new.space_number
    and r.order_id<>new.order_id and r.status<>'RELEASED'
    and (r.status='OCCUPIED' or (new.start_at<r.end_at and r.start_at<new.end_at))) then
  raise exception 'pickup space conflict';
 end if;
 return new;
end $$;
create trigger check_pickup_space before insert or update on public.pickup_space_reservations
 for each row execute function babmatj_private.check_pickup_space();

create function babmatj_private.prevent_occupied_space_removal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.space_capacity<old.space_capacity and exists(
  select 1 from public.pickup_space_reservations
  where location_id=old.id and space_number>new.space_capacity and status<>'RELEASED'
 ) then raise exception 'pickup capacity has active reservations'; end if;
 return new;
end $$;
create trigger prevent_occupied_space_removal before update of space_capacity on public.restaurant_pickup_locations
 for each row execute function babmatj_private.prevent_occupied_space_removal();

create function public.occupy_pickup_space(p_order uuid) returns public.pickup_space_reservations
language plpgsql security definer set search_path='' as $$
declare restaurant uuid; slot public.pickup_space_reservations; observed_at timestamptz;
begin
 select restaurant_id into restaurant from public.orders where id=p_order;
 perform 1 from public.restaurants where id=restaurant for update;
 select * into slot from public.pickup_space_reservations where order_id=p_order for update;
 if slot.status='OCCUPIED' then return slot; end if;
 if slot.status is distinct from 'RESERVED' then raise exception 'pickup reservation required'; end if;
 observed_at:=clock_timestamp();
 if observed_at<slot.start_at then raise exception 'pickup arrival is early'; end if;
 if observed_at>=slot.end_at then raise exception 'pickup arrival is late'; end if;
 update public.pickup_space_reservations set status='OCCUPIED' where order_id=p_order returning * into slot;
 return slot;
end $$;

create function babmatj_private.close_pickup_space() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.order_status='COMPLETED' and exists(
  select 1 from public.pickup_space_reservations where order_id=new.id and status<>'OCCUPIED'
 ) then raise exception 'occupied pickup space required'; end if;
 if new.order_status='CANCELLED' and exists(
  select 1 from public.pickup_space_reservations where order_id=new.id and status='OCCUPIED'
 ) then raise exception 'cannot cancel an occupied pickup space'; end if;
 update public.pickup_space_reservations set status='RELEASED'
  where order_id=new.id and status<>'RELEASED';
 return new;
end $$;
create trigger close_pickup_space after update of order_status on public.orders
 for each row when (old.order_status is distinct from new.order_status
  and new.order_status in ('CANCELLED','REJECTED','COMPLETED'))
 execute function babmatj_private.close_pickup_space();

revoke all on function public.occupy_pickup_space(uuid) from public,anon,authenticated;
grant execute on function public.occupy_pickup_space(uuid) to service_role;
revoke all on function babmatj_private.check_pickup_space(),
 babmatj_private.prevent_occupied_space_removal(), babmatj_private.close_pickup_space()
 from public,anon,authenticated,service_role;
commit;
