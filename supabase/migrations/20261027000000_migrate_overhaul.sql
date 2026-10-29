-- Migrate overhaul migration
-- ---------------------------------------------------------------------------
-- STATUS: reviewed against the live project schema on 2026-10-28 (project restored from pause;
-- 1 profile, 0 properties at that time). Starting schema:
--   profiles(id, full_name, phone, university, role)
--   properties(id, host_id, title, rent, property_type, area, location, bedrooms,
--              bathrooms, contact_phone, description, amenities, latitude, longitude,
--              status 'Available'|'Occupied', campus, created_at)
--   property_images(property_id, image_url)
--   favorites(id, user_id, property_id)
-- Every statement is idempotent so it is safe to re-run. It is backward compatible:
-- existing listings are backfilled as 'approved' so nothing disappears on release.
--
-- ROLLBACK NOTES (see README): new columns can be dropped, policies re-created from
-- the previous dump. Take a backup (Dashboard > Database > Backups) before applying.
-- ---------------------------------------------------------------------------

begin;

-- 1. PROFILES -----------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  university text,
  role text not null default 'student',
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists role text not null default 'student';

-- Normalise legacy values before adding the constraint.
update public.profiles set role = 'landlord' where lower(role) in ('agent', 'landlord / agent', 'landlord/agent');
update public.profiles set role = 'student' where role is null or role not in ('student', 'landlord', 'admin');

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('student', 'landlord', 'admin'));
alter table public.profiles drop constraint if exists profiles_full_name_len;
alter table public.profiles add constraint profiles_full_name_len
  check (full_name is null or char_length(btrim(full_name)) between 2 and 60) not valid;

-- 2. PROPERTIES ---------------------------------------------------------------
-- Added with default 'approved' so every existing (already public) listing stays visible;
-- the default is then switched to 'pending' for all new listings. Re-running does not re-approve anything.
alter table public.properties add column if not exists moderation_status text not null default 'approved';
alter table public.properties alter column moderation_status set default 'pending';
alter table public.properties add column if not exists moderation_note text;
alter table public.properties add column if not exists moderated_by uuid references auth.users(id) on delete set null;
alter table public.properties add column if not exists moderated_at timestamptz;
alter table public.properties add column if not exists contact_name text;
alter table public.properties add column if not exists updated_at timestamptz not null default now();
alter table public.properties add column if not exists created_at timestamptz not null default now();

-- Legacy availability values -> 'Available' | 'Taken'. ('Occupied' is kept as an alias in the app.)
-- Drop any legacy CHECK on the status column, whatever it was named.
do $$ declare c record; begin
  for c in select conname from pg_constraint
            where conrelid = 'public.properties'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%status%' and pg_get_constraintdef(oid) not ilike '%moderation_status%'
  loop execute format('alter table public.properties drop constraint %I', c.conname); end loop;
end $$;
alter table public.properties alter column status set default 'Available';
update public.properties set status = 'Taken' where status = 'Occupied';
alter table public.properties add constraint properties_status_check check (status in ('Available', 'Taken'));

alter table public.properties drop constraint if exists properties_moderation_check;
alter table public.properties add constraint properties_moderation_check
  check (moderation_status in ('pending', 'approved', 'flagged', 'rejected'));

alter table public.properties drop constraint if exists properties_rent_positive;
alter table public.properties add constraint properties_rent_positive check (rent > 0) not valid;
alter table public.properties drop constraint if exists properties_bedrooms_nonneg;
alter table public.properties add constraint properties_bedrooms_nonneg check (bedrooms is null or bedrooms >= 0) not valid;
alter table public.properties drop constraint if exists properties_desc_len;
alter table public.properties add constraint properties_desc_len check (description is null or char_length(description) <= 1000) not valid;
alter table public.properties drop constraint if exists properties_lat_range;
alter table public.properties add constraint properties_lat_range check (latitude is null or latitude between -90 and 90) not valid;
alter table public.properties drop constraint if exists properties_lng_range;
alter table public.properties add constraint properties_lng_range check (longitude is null or longitude between -180 and 180) not valid;
-- "not valid" = enforced for new/changed rows without failing on legacy rows. Run
--   alter table public.properties validate constraint <name>;
-- once legacy data has been reviewed.

-- House types: proposal list (single room, bedsitter, 1 bedroom, 2 bedroom, other) plus existing shared/hostel.
do $$ declare c record; begin
  for c in select conname from pg_constraint
            where conrelid = 'public.properties'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%property_type%'
  loop execute format('alter table public.properties drop constraint %I', c.conname); end loop;
end $$;
alter table public.properties add constraint properties_type_check
  check (property_type is null or property_type in ('bedsitter','single_room','one_bedroom','two_bedroom','shared','hostel','other'));

create index if not exists properties_public_idx on public.properties (moderation_status, status, created_at desc);
create index if not exists properties_host_idx on public.properties (host_id);

-- True when the statement comes in through the public API (PostgREST sets the session role to anon/authenticated).
-- Direct database sessions (SQL editor, migrations, service role) are trusted and are not restricted by the guard triggers.
create or replace function public.is_api_user() returns boolean
language sql stable as $$ select coalesce(current_setting('role', true), '') in ('anon', 'authenticated'); $$;

-- Keep updated_at fresh and stop owners changing moderation fields.
create or replace function public.properties_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare restricted boolean := public.is_api_user() and not public.is_admin();
begin
  if tg_op = 'INSERT' then
    if restricted then
      new.moderation_status := 'pending';
      new.moderation_note := null; new.moderated_by := null; new.moderated_at := null;
    end if;
    select full_name into new.contact_name from public.profiles where id = new.host_id;
  else
    new.updated_at := now();
    if restricted then
      new.moderation_status := old.moderation_status;
      new.moderation_note := old.moderation_note;
      new.moderated_by := old.moderated_by;
      new.moderated_at := old.moderated_at;
      new.host_id := old.host_id;
    elsif new.moderation_status is distinct from old.moderation_status then
      new.moderated_by := auth.uid(); new.moderated_at := now(); -- null when done from the SQL editor
    end if;
  end if;
  return new;
end $$;

-- 3. PROPERTY IMAGES ----------------------------------------------------------
alter table public.property_images add column if not exists id uuid default gen_random_uuid();
alter table public.property_images add column if not exists position int not null default 0;
alter table public.property_images add column if not exists storage_path text;
create unique index if not exists property_images_id_uidx on public.property_images (id);
create index if not exists property_images_property_idx on public.property_images (property_id, position);

-- 4. FAVOURITES ---------------------------------------------------------------
-- Remove duplicates (keep the oldest) before adding the unique constraint.
delete from public.favorites f using public.favorites g
 where f.user_id = g.user_id and f.property_id = g.property_id and f.ctid > g.ctid;
alter table public.favorites add column if not exists created_at timestamptz not null default now();
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'favorites_user_property_key') then
    alter table public.favorites add constraint favorites_user_property_key unique (user_id, property_id);
  end if;
end $$;
create index if not exists favorites_user_idx on public.favorites (user_id);

-- 5. AUTHORISATION HELPERS ----------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

drop trigger if exists properties_before_write on public.properties;
create trigger properties_before_write before insert or update on public.properties
  for each row execute function public.properties_before_write();

-- Users may never set their own role to admin (or change it at all).
create or replace function public.profiles_guard_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.role is distinct from old.role and public.is_api_user() and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.profiles_guard_role();

-- Signup trigger: only 'student' or 'landlord' can be self-selected.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := coalesce(new.raw_user_meta_data->>'role', 'student');
begin
  if r not in ('student', 'landlord') then r := 'student'; end if;
  insert into public.profiles (id, full_name, phone, university, role)
  values (new.id, left(btrim(new.raw_user_meta_data->>'full_name'), 60),
          left(btrim(new.raw_user_meta_data->>'phone'), 20),
          left(btrim(new.raw_user_meta_data->>'university'), 100), r)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6. ROW LEVEL SECURITY -------------------------------------------------------
-- Drop every existing policy on these tables so the result is exactly what is below.
do $$ declare pol record; begin
  for pol in select schemaname, tablename, policyname from pg_policies
              where schemaname = 'public' and tablename in ('profiles','properties','property_images','favorites')
  loop execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename); end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.property_images enable row level security;
alter table public.favorites enable row level security;

-- profiles: own row, or admin. Landlord contact is exposed via properties.contact_name/contact_phone only.
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = auth.uid() and role in ('student','landlord'));
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- properties
create policy properties_select_public on public.properties for select to anon, authenticated
  using (moderation_status = 'approved' or host_id = auth.uid() or public.is_admin());
create policy properties_insert_landlord on public.properties for insert to authenticated
  with check (host_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('landlord','admin')));
create policy properties_update_owner on public.properties for update to authenticated
  using (host_id = auth.uid() or public.is_admin()) with check (host_id = auth.uid() or public.is_admin());
create policy properties_delete_owner on public.properties for delete to authenticated
  using (host_id = auth.uid() or public.is_admin());

-- property_images follow their property's visibility and ownership
create policy images_select on public.property_images for select to anon, authenticated
  using (exists (select 1 from public.properties p where p.id = property_id
                  and (p.moderation_status = 'approved' or p.host_id = auth.uid() or public.is_admin())));
create policy images_insert_owner on public.property_images for insert to authenticated
  with check (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin())));
create policy images_update_owner on public.property_images for update to authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin())));
create policy images_delete_owner on public.property_images for delete to authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin())));

-- favourites: strictly own rows
create policy favorites_select_own on public.favorites for select to authenticated using (user_id = auth.uid());
create policy favorites_insert_own on public.favorites for insert to authenticated with check (user_id = auth.uid());
create policy favorites_delete_own on public.favorites for delete to authenticated using (user_id = auth.uid());

-- 7. STORAGE ------------------------------------------------------------------
-- Public-read bucket with a size limit and image-only MIME types (enforced server-side).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('property-images', 'property-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Legacy policies from the original schema (same intent, different names) are replaced by the three below.
drop policy if exists "hosts upload own listing photos" on storage.objects;
drop policy if exists "hosts delete own listing photos" on storage.objects;
drop policy if exists "property images upload own folder" on storage.objects;
drop policy if exists "property images modify own folder" on storage.objects;
drop policy if exists "property images delete own folder" on storage.objects;
create policy "property images upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'property-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "property images modify own folder" on storage.objects for update to authenticated
  using (bucket_id = 'property-images' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "property images delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'property-images' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
-- Public bucket: object URLs are readable by anyone who has the URL; listing is not granted.

-- 8. HARDENING (from the Supabase security advisor after the first live run) -----------------
-- Trigger functions must not be callable through the REST API; triggers run regardless of EXECUTE.
-- is_admin() stays executable because RLS policies call it as the signed-in/anonymous role.
alter function public.is_api_user() set search_path = public, pg_temp;
revoke execute on function public.profiles_guard_role() from public, anon, authenticated;
revoke execute on function public.properties_before_write() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

commit;

-- To create the first administrator (run manually in the SQL editor, never from the app):
--   update public.profiles set role = 'admin' where id = '<auth user uuid>';
