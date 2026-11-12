begin;
create table public.restaurant_images (
 restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
 image_data text not null check (length(image_data) <= 60000)
);
create table public.menu_images (
 menu_id uuid primary key references public.menus(id) on delete cascade,
 image_data text not null check (length(image_data) <= 60000)
);
alter table public.restaurant_images enable row level security;
alter table public.menu_images enable row level security;
revoke all on public.restaurant_images,public.menu_images from public,anon,authenticated,service_role;
grant select,insert on public.restaurant_images to service_role;
grant select,insert,update,delete on public.menu_images to service_role;
commit;
