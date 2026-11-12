begin;
alter table public.restaurant_order_actions
 drop constraint restaurant_order_actions_action_check,
 add constraint restaurant_order_actions_action_check
 check (action in ('ACCEPT','REJECT','START','READY','ARRIVE','COMPLETE','CANCEL','ETA','CONFIRM_ETA'));

create function public.clear_pickup_for_replan(p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 delete from public.pickup_space_reservations where order_id=p_order and status='RESERVED';
 if not found then raise exception 'pickup reservation required'; end if;
end;
$$;

create function public.advance_eta_version(p_order uuid) returns void
language sql security definer set search_path='' as $$
 update public.orders set version=version+1 where id=p_order and order_status='ACCEPTED';
$$;
revoke all on function public.clear_pickup_for_replan(uuid),public.advance_eta_version(uuid) from public,anon,authenticated;
grant execute on function public.clear_pickup_for_replan(uuid),public.advance_eta_version(uuid) to service_role;
commit;
