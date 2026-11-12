begin;
alter table public.menus add column base_cook_minutes integer
 check (base_cook_minutes between 1 and 240);
commit;
