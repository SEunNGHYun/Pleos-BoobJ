begin;
create table public.menus (
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id) on delete restrict,
 name text not null check(length(btrim(name))>0),
 price_krw bigint not null check(price_krw between 0 and 100000000),
 is_available boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index menus_restaurant on public.menus(restaurant_id);
create trigger touch_updated_at before update on public.menus for each row execute function babmatj_private.touch_updated_at();
alter table public.menus enable row level security;
revoke all on public.menus from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.menus to service_role;
alter table public.orders add column request_fingerprint text check(request_fingerprint is null or request_fingerprint ~ '^[a-f0-9]{64}$');

-- Trusted backend only: menu names/prices are copied from DB, never from the customer.
create function public.create_menu_pickup_order(
 p_user uuid,p_restaurant uuid,p_pickup uuid,p_plate text,p_phone text,p_request_key uuid,
 p_items jsonb,p_fingerprint text
) returns public.orders language plpgsql security definer set search_path='' as $$
declare result public.orders; item jsonb; menu public.menus; snapshots jsonb='[]'::jsonb; quantity integer;
begin
 perform 1 from public.restaurants where id=p_restaurant for update;
 if not found then raise exception 'restaurant not found'; end if;
 select * into result from public.orders where user_id=p_user and request_key=p_request_key;
 if found then
  if result.restaurant_id<>p_restaurant or result.request_fingerprint is distinct from p_fingerprint then
   raise exception 'idempotency key conflicts with a different request';
  end if;
  return result;
 end if;
 if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'invalid request fingerprint'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'invalid menu items'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'invalid menu items'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  select * into menu from public.menus where id=(item->>'menuId')::uuid and restaurant_id=p_restaurant and is_available for share;
  if not found then raise exception 'menu unavailable for this restaurant'; end if;
  quantity=(item->>'quantity')::integer;
  if quantity is null or quantity not between 1 and 100 then raise exception 'invalid menu quantity'; end if;
  snapshots=snapshots||jsonb_build_array(jsonb_build_object('menu_name',menu.name,'quantity',quantity,'unit_price_krw',menu.price_krw));
 end loop;
 result=public.create_pickup_order(p_user,p_restaurant,p_pickup,p_plate,p_phone,p_request_key,snapshots);
 update public.orders set request_fingerprint=p_fingerprint where id=result.id returning * into result;
 return result;
end $$;
revoke all on function public.create_menu_pickup_order(uuid,uuid,uuid,text,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_menu_pickup_order(uuid,uuid,uuid,text,text,uuid,jsonb,text) to service_role;
commit;
