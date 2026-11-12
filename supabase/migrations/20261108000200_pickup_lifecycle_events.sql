begin;
alter table public.restaurant_order_actions
 drop constraint restaurant_order_actions_action_check,
 add constraint restaurant_order_actions_action_check
 check (action in ('ACCEPT','REJECT','START','READY','ARRIVE','COMPLETE','CANCEL'));
create function public.record_pickup_arrival(p_order uuid) returns void
language sql security definer set search_path='' as $$
 update public.orders set vehicle_status='ARRIVED', version=version+1
 where id=p_order and vehicle_status<>'ARRIVED' and exists(
  select 1 from public.pickup_space_reservations where order_id=p_order and status='OCCUPIED'
 );
$$;
revoke all on function public.record_pickup_arrival(uuid) from public,anon,authenticated;
grant execute on function public.record_pickup_arrival(uuid) to service_role;
commit;
