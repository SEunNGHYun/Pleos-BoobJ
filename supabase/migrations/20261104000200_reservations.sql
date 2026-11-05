begin;
-- Read occupancy at the actual cooking estimate; overdue cooking blocks capacity until READY.
create function babmatj_private.occupancy(p_restaurant uuid,p_exclude uuid default null)
returns table(starts_at timestamptz, ends_at timestamptz) language sql stable set search_path='' as $$
 select case when o.cooking_status='COOKING' then o.cooking_started_at else r.planned_start_at end,
        case when o.cooking_status='COOKING' then
          case when o.estimated_ready_at>now() then o.estimated_ready_at else 'infinity'::timestamptz end
        else r.planned_end_at end
 from public.cooking_reservations r join public.orders o on o.id=r.order_id
 where r.restaurant_id=p_restaurant and (p_exclude is null or o.id<>p_exclude)
 and r.released_at is null and o.order_status='ACCEPTED' and o.cooking_status in ('SCHEDULED','COOKING')
$$;
create function babmatj_private.peak(p_restaurant uuid,p_start timestamptz,p_end timestamptz,p_exclude uuid default null)
returns integer language sql stable set search_path='' as $$
 with occupied as (select * from babmatj_private.occupancy(p_restaurant,p_exclude)),
 points as (select p_start as t union select starts_at from occupied where starts_at>=p_start and starts_at<p_end)
 select coalesce(max((select count(*) from occupied where starts_at<=t and ends_at>t)),0)::integer from points
$$;
create function babmatj_private.check_capacity_reduction() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.max_concurrent_orders<old.max_concurrent_orders and
 babmatj_private.peak(old.id,now(),'infinity'::timestamptz)>new.max_concurrent_orders then
  raise exception 'capacity reduction conflicts with existing reservations';
 end if;
 return new;
end $$;
create trigger check_capacity_reduction before update of max_concurrent_orders on public.restaurants
 for each row execute function babmatj_private.check_capacity_reduction();

create function public.create_pickup_order(
 p_user uuid,p_restaurant uuid,p_pickup uuid,p_plate text,p_phone text,p_request_key uuid,p_items jsonb
) returns public.orders language plpgsql security definer set search_path='' as $$
declare result public.orders; place public.restaurant_pickup_locations; accepting boolean; item jsonb;
begin
 -- Restaurant-first lock order is shared by all state-changing RPCs.
 select is_accepting_orders into accepting from public.restaurants where id=p_restaurant for update;
 if not found then raise exception 'restaurant not found'; end if;
 select * into result from public.orders where user_id=p_user and request_key=p_request_key;
 if found then
  if result.restaurant_id<>p_restaurant then raise exception 'request key belongs to another restaurant'; end if;
  return result;
 end if;
 if not accepting then raise exception 'restaurant is not accepting orders'; end if;
 select * into place from public.restaurant_pickup_locations
  where id=p_pickup and restaurant_id=p_restaurant and is_active for share;
 if not found then raise exception 'pickup location unavailable'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'items must be a nonempty array'; end if;
 if jsonb_array_length(p_items)=0 then raise exception 'items must be a nonempty array'; end if;
 insert into public.orders(user_id,restaurant_id,request_key,pickup_location_id,pickup_vehicle_plate,pickup_contact_phone,
  pickup_name,pickup_address,pickup_latitude,pickup_longitude,pickup_instructions)
 values(p_user,p_restaurant,p_request_key,p_pickup,p_plate,p_phone,place.name,place.address,place.latitude,place.longitude,place.instructions)
 returning * into result;
 for item in select value from jsonb_array_elements(p_items) loop
  insert into public.order_items(order_id,menu_name_snapshot,quantity,unit_price_krw)
  values(result.id,item->>'menu_name',(item->>'quantity')::integer,(item->>'unit_price_krw')::bigint);
 end loop;
 return result;
end $$;

create function public.reserve_cooking(p_order uuid,p_duration integer,p_eta timestamptz,p_buffer integer default 0)
returns public.cooking_reservations language plpgsql security definer set search_path='' as $$
declare o public.orders; rid uuid; cap integer; target timestamptz; candidate timestamptz;
 result public.cooking_reservations; finish timestamptz;
begin
 if p_duration is null or p_duration<=0 or p_buffer is null or p_buffer<0 or p_eta is null or not isfinite(p_eta) then
  raise exception 'duration, buffer and finite ETA are required';
 end if;
 select restaurant_id into rid from public.orders where id=p_order;
 if not found then raise exception 'order not found'; end if;
 select max_concurrent_orders into cap from public.restaurants where id=rid for update;
 select * into o from public.orders where id=p_order for update;
 if o.cooking_status in ('COOKING','READY') then raise exception 'LOCK: cooking has started'; end if;
 if o.order_status not in ('PENDING','ACCEPTED') then raise exception 'order is closed'; end if;
 target=greatest(now(),p_eta-make_interval(mins=>p_duration)-make_interval(mins=>p_buffer));
 -- Bounded seven-day planning window; opening hours are intentionally not yet modeled.
 for candidate in
  select t from (
   select target as t
   union select ends_at from babmatj_private.occupancy(rid,p_order) where ends_at>=target and isfinite(ends_at)
  ) candidates where t+make_interval(mins=>p_duration)<=now()+interval '7 days' order by t
 loop
  finish=candidate+make_interval(mins=>p_duration);
  if babmatj_private.peak(rid,candidate,finish,p_order)<cap then
   update public.orders set order_status='ACCEPTED',cooking_status='SCHEDULED',
    accepted_cook_duration_minutes=p_duration,preparation_buffer_minutes=p_buffer,
    eta_updated_at=case when eta_at is distinct from p_eta then clock_timestamp() else eta_updated_at end,
    eta_at=p_eta,accepted_at=coalesce(accepted_at,now()),version=version+1 where id=p_order;
   insert into public.cooking_reservations(restaurant_id,order_id,planned_start_at,planned_end_at)
    values(rid,p_order,candidate,finish)
    on conflict(order_id) do update set planned_start_at=excluded.planned_start_at,planned_end_at=excluded.planned_end_at
    returning * into result;
   return result;
  end if;
 end loop;
 raise exception 'capacity unavailable within seven-day planning window';
end $$;

create function public.start_cooking(p_order uuid) returns public.orders
language plpgsql security definer set search_path='' as $$
declare rid uuid; cap integer; o public.orders; finish timestamptz; pending record;
begin
 select restaurant_id into rid from public.orders where id=p_order;
 if not found then raise exception 'order not found'; end if;
 select max_concurrent_orders into cap from public.restaurants where id=rid for update;
 select * into o from public.orders where id=p_order for update;
 if o.order_status<>'ACCEPTED' then raise exception 'order is not accepted'; end if;
 if o.cooking_status='COOKING' then return o; end if;
 if o.cooking_status<>'SCHEDULED' then raise exception 'order is not scheduled'; end if;
 if not exists(select 1 from public.cooking_reservations where order_id=p_order and released_at is null) then
  raise exception 'active reservation required';
 end if;
 finish=now()+make_interval(mins=>o.accepted_cook_duration_minutes);
 -- Planned future slots must not prevent a due order starting because of a few
 -- milliseconds of clock drift. Actual starts are bounded by actual cooking count.
 if (select count(*) from public.orders where restaurant_id=rid and order_status='ACCEPTED'
     and cooking_status='COOKING' and id<>p_order)>=cap then
  raise exception 'capacity unavailable for actual cooking';
 end if;
 update public.orders set cooking_status='COOKING',cooking_started_at=now(),estimated_ready_at=finish,version=version+1
 where id=p_order returning * into o;
 -- A delayed/early actual start can invalidate a future planned slot. Repair
 -- affected unstarted bookings under the same restaurant lock or roll back all.
 for pending in
  select other.id,other.accepted_cook_duration_minutes,other.eta_at,other.preparation_buffer_minutes,
         r.planned_start_at,r.planned_end_at
  from public.orders other join public.cooking_reservations r on r.order_id=other.id
  where other.restaurant_id=rid and other.order_status='ACCEPTED' and other.cooking_status='SCHEDULED'
  and r.released_at is null order by r.planned_start_at,other.id
 loop
  if babmatj_private.peak(rid,pending.planned_start_at,pending.planned_end_at,pending.id)>=cap then
   perform public.reserve_cooking(pending.id,pending.accepted_cook_duration_minutes,pending.eta_at,pending.preparation_buffer_minutes);
  end if;
 end loop;
 return o;
end $$;

create function public.mark_order_ready(p_order uuid) returns public.orders
language plpgsql security definer set search_path='' as $$
declare rid uuid; o public.orders;
begin
 select restaurant_id into rid from public.orders where id=p_order;
 if not found then raise exception 'order not found'; end if;
 perform 1 from public.restaurants where id=rid for update;
 select * into o from public.orders where id=p_order for update;
 if o.order_status<>'ACCEPTED' then raise exception 'order is not accepted'; end if;
 if o.cooking_status='READY' then return o; end if;
 if o.cooking_status<>'COOKING' then raise exception 'order is not cooking'; end if;
 update public.orders set cooking_status='READY',ready_at=now(),version=version+1 where id=p_order returning * into o;
 update public.cooking_reservations set released_at=now() where order_id=p_order;
 return o;
end $$;

create function public.close_pickup_order(p_order uuid,p_status public.order_status) returns public.orders
language plpgsql security definer set search_path='' as $$
declare rid uuid; o public.orders;
begin
 if p_status is null or p_status not in ('CANCELLED','REJECTED','COMPLETED') then raise exception 'invalid closing status'; end if;
 select restaurant_id into rid from public.orders where id=p_order;
 if not found then raise exception 'order not found'; end if;
 perform 1 from public.restaurants where id=rid for update;
 select * into o from public.orders where id=p_order for update;
 if o.order_status=p_status then return o; end if;
 if o.order_status in ('CANCELLED','REJECTED','COMPLETED') then raise exception 'order is already closed'; end if;
 if p_status='COMPLETED' and o.cooking_status<>'READY' then raise exception 'READY required before completion'; end if;
 if p_status='REJECTED' and o.order_status<>'PENDING' then raise exception 'only pending orders can be rejected'; end if;
 if p_status='CANCELLED' and o.cooking_status in ('COOKING','READY') then raise exception 'cannot cancel after cooking starts'; end if;
 update public.orders set order_status=p_status,
  completed_at=case when p_status='COMPLETED' then now() else completed_at end,
  cancelled_at=case when p_status='CANCELLED' then now() else cancelled_at end,
  version=version+1 where id=p_order returning * into o;
 update public.cooking_reservations set released_at=coalesce(released_at,now()) where order_id=p_order;
 return o;
end $$;

-- Never expose privileged functions via PostgreSQL's default PUBLIC execute grant.
revoke all on all functions in schema babmatj_private from public,anon,authenticated,service_role;
revoke all on function public.create_pickup_order(uuid,uuid,uuid,text,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.reserve_cooking(uuid,integer,timestamptz,integer) from public,anon,authenticated;
revoke all on function public.start_cooking(uuid) from public,anon,authenticated;
revoke all on function public.mark_order_ready(uuid) from public,anon,authenticated;
revoke all on function public.close_pickup_order(uuid,public.order_status) from public,anon,authenticated;
grant execute on function public.create_pickup_order(uuid,uuid,uuid,text,text,uuid,jsonb),
 public.reserve_cooking(uuid,integer,timestamptz,integer),public.start_cooking(uuid),
 public.mark_order_ready(uuid),public.close_pickup_order(uuid,public.order_status) to service_role;
commit;
