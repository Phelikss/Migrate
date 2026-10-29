-- ASSUMED pre-migration schema, inferred from the app's original JS (the live project was paused and not inspectable).
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text, phone text, university text, role text);
create table public.properties (
  id uuid primary key default gen_random_uuid(), host_id uuid references auth.users(id), title text not null, rent numeric, property_type text,
  area text, location text, bedrooms int, bathrooms int, contact_phone text, description text, amenities text[], latitude numeric, longitude numeric,
  status text default 'Available' check (status in ('Available','Occupied')), campus text, created_at timestamptz default now());
create table public.property_images (property_id uuid references public.properties(id) on delete cascade, image_url text);
create table public.favorites (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, property_id uuid references public.properties(id) on delete cascade);
alter table public.profiles enable row level security; alter table public.properties enable row level security;
alter table public.property_images enable row level security; alter table public.favorites enable row level security;
-- deliberately weak legacy policies the migration must replace
create policy "legacy read all" on public.properties for select using (true);
create policy "legacy anyone update" on public.properties for update using (true);
create policy "legacy profiles all" on public.profiles for all using (true) with check (true);
create policy "legacy fav all" on public.favorites for all using (true) with check (true);
create policy "legacy images all" on public.property_images for all using (true) with check (true);
grant all on all tables in schema public to anon, authenticated;
grant all on all tables in schema storage to anon, authenticated;

-- legacy data
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','landlord@test'), ('00000000-0000-0000-0000-0000000000a2','student@test'),
 ('00000000-0000-0000-0000-0000000000a3','other-landlord@test'), ('00000000-0000-0000-0000-0000000000a4','admin@test');
insert into public.profiles values
 ('00000000-0000-0000-0000-0000000000a1','Lena Landlord','0711111111','PUEA','agent'),
 ('00000000-0000-0000-0000-0000000000a2','Sam Student','0722222222','PUEA','student'),
 ('00000000-0000-0000-0000-0000000000a3','Olu Other','0733333333','PUEA','landlord'),
 ('00000000-0000-0000-0000-0000000000a4','Ada Admin','0744444444','PUEA','student');
insert into public.properties (id, host_id, title, rent, property_type, area, bedrooms, contact_phone, description, status) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','Legacy available',6500,'bedsitter','Thogoto',0,'0711111111','old','Available'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','Legacy occupied',7000,'bedsitter','Thogoto',0,'0711111111','old','Occupied');
insert into public.property_images values ('10000000-0000-0000-0000-000000000001','https://x/1.jpg');
insert into public.favorites (user_id, property_id) values
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-000000000001'); -- duplicate on purpose
