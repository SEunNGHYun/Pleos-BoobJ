begin;
alter table public.restaurants add column food_category text not null default '기타'
 check (food_category in ('한식','중식','일식','양식','치킨','피자','분식','카페·디저트','기타'));
commit;
