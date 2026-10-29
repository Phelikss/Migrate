-- Assertions run against the migrated throwaway database. Each check prints PASS or FAIL.
\set ON_ERROR_STOP 1
create table if not exists t_results (name text, ok boolean);
create or replace function t_ok(n text, c boolean) returns void language plpgsql security definer as $$
begin insert into t_results values (n, coalesce(c, false)); raise notice '% - %', case when coalesce(c,false) then 'PASS' else 'FAIL' end, n; end $$;
create or replace function t_as(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u, ''), true);
  if u is null then set local role anon; else set local role authenticated; end if;
end $$;

-- ids: a1 landlord(agent), a2 student, a3 other landlord, a4 admin-to-be
do $$ begin
  perform t_ok('backfill: legacy available listing is approved & Available', (select moderation_status='approved' and status='Available' from properties where id='10000000-0000-0000-0000-000000000001'));
  perform t_ok('backfill: legacy Occupied became Taken and stays approved', (select moderation_status='approved' and status='Taken' from properties where id='10000000-0000-0000-0000-000000000002'));
  perform t_ok('backfill: legacy role "agent" became landlord', (select role='landlord' from profiles where id='00000000-0000-0000-0000-0000000000a1'));
  perform t_ok('backfill: duplicate favourites collapsed to one', (select count(*)=1 from favorites where user_id='00000000-0000-0000-0000-0000000000a2'));
  perform t_ok('legacy permissive policies were removed', (select count(*)=0 from pg_policies where policyname like 'legacy%'));
  perform t_ok('RLS enabled on all four tables', (select count(*)=4 from pg_tables where schemaname='public' and tablename in ('profiles','properties','property_images','favorites') and rowsecurity));
  perform t_ok('default for new listings is pending', (select column_default like '%pending%' from information_schema.columns where table_name='properties' and column_name='moderation_status'));
end $$;

-- landlord posts: cannot choose own moderation status
do $$ declare pid uuid; begin
  perform t_as('00000000-0000-0000-0000-0000000000a1');
  insert into properties (id, host_id, title, rent, property_type, area, bedrooms, contact_phone, description, status, moderation_status)
    values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','New by landlord',8000,'bedsitter','Thogoto',0,'+254711111111','fresh','Available','approved') returning id into pid;
  perform t_ok('landlord insert forced to pending even when asking for approved', (select moderation_status='pending' from properties where id=pid));
  perform t_ok('contact_name copied from profile server-side', (select contact_name='Lena Landlord' from properties where id=pid));
  update properties set moderation_status='approved' where id=pid;
  perform t_ok('landlord cannot self-approve via UPDATE', (select moderation_status='pending' from properties where id=pid));
  update properties set host_id='00000000-0000-0000-0000-0000000000a3' where id=pid;
  perform t_ok('landlord cannot reassign host_id', (select host_id='00000000-0000-0000-0000-0000000000a1' from properties where id=pid));
  update properties set status='Taken' where id=pid;
  perform t_ok('owner can mark own listing Taken', (select status='Taken' from properties where id=pid));
  update properties set status='Available' where id=pid;
  reset role;
end $$;

-- anonymous visibility
do $$ begin
  perform t_as(null);
  perform t_ok('anon cannot see pending listing', (select count(*)=0 from properties where id='20000000-0000-0000-0000-000000000001'));
  perform t_ok('anon sees approved legacy listing', (select count(*)=1 from properties where id='10000000-0000-0000-0000-000000000001'));
  perform t_ok('anon cannot read profiles (no phone/email leak)', (select count(*)=0 from profiles));
  perform t_ok('anon cannot read favourites', (select count(*)=0 from favorites));
  begin insert into properties (host_id,title,rent) values ('00000000-0000-0000-0000-0000000000a1','x',1); perform t_ok('anon cannot insert listings', false);
  exception when others then perform t_ok('anon cannot insert listings', true); end;
  reset role;
end $$;

-- other landlord / student restrictions
do $$ declare n int; begin
  perform t_as('00000000-0000-0000-0000-0000000000a3');
  update properties set title='hijack' where id='10000000-0000-0000-0000-000000000001'; get diagnostics n = row_count;
  perform t_ok('other landlord cannot update someone else''s listing', n=0);
  delete from properties where id='10000000-0000-0000-0000-000000000001'; get diagnostics n = row_count;
  perform t_ok('other landlord cannot delete someone else''s listing', n=0);
  begin insert into property_images (property_id,image_url) values ('10000000-0000-0000-0000-000000000001','https://evil/x.jpg'); perform t_ok('other landlord cannot attach images to another listing', false);
  exception when others then perform t_ok('other landlord cannot attach images to another listing', true); end;
  perform t_ok('other landlord cannot see a pending listing of another host', (select count(*)=0 from properties where id='20000000-0000-0000-0000-000000000001'));
  reset role;

  perform t_as('00000000-0000-0000-0000-0000000000a2');
  begin insert into properties (host_id,title,rent,description,bedrooms) values ('00000000-0000-0000-0000-0000000000a2','student post',100,'x',0); perform t_ok('student cannot post a listing', false);
  exception when others then perform t_ok('student cannot post a listing', true); end;
  update profiles set role='admin' where id='00000000-0000-0000-0000-0000000000a2';
  perform t_ok('student cannot promote self to admin', (select role='student' from profiles where id='00000000-0000-0000-0000-0000000000a2'));
  update profiles set role='landlord' where id='00000000-0000-0000-0000-0000000000a2';
  perform t_ok('student cannot self-switch role either', (select role='student' from profiles where id='00000000-0000-0000-0000-0000000000a2'));
  perform t_ok('student sees only own profile', (select count(*)=1 from profiles));
  update profiles set full_name='Hacked' where id='00000000-0000-0000-0000-0000000000a1'; get diagnostics n = row_count;
  perform t_ok('student cannot edit another profile', n=0);
  reset role;
end $$;

-- favourites
do $$ declare n int; begin
  perform t_as('00000000-0000-0000-0000-0000000000a2');
  begin insert into favorites (user_id, property_id) values ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-000000000001'); perform t_ok('duplicate favourite rejected by unique constraint', false);
  exception when unique_violation then perform t_ok('duplicate favourite rejected by unique constraint', true); when others then perform t_ok('duplicate favourite rejected by unique constraint', false); end;
  begin insert into favorites (user_id, property_id) values ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000002'); perform t_ok('cannot create a favourite for another user', false);
  exception when others then perform t_ok('cannot create a favourite for another user', true); end;
  reset role;
  insert into favorites (user_id, property_id) values ('00000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-000000000001');
  perform t_as('00000000-0000-0000-0000-0000000000a2');
  perform t_ok('student cannot read other users'' favourites', (select count(*)=1 from favorites));
  delete from favorites where user_id='00000000-0000-0000-0000-0000000000a3'; get diagnostics n = row_count;
  perform t_ok('student cannot delete other users'' favourites', n=0);
  delete from favorites where user_id='00000000-0000-0000-0000-0000000000a2'; get diagnostics n = row_count;
  perform t_ok('student can remove own favourite', n=1);
  reset role;
end $$;

-- images follow listing visibility
do $$ begin
  perform t_as('00000000-0000-0000-0000-0000000000a1');
  insert into property_images (property_id,image_url,position) values ('20000000-0000-0000-0000-000000000001','https://x/new.jpg',0);
  perform t_ok('owner can attach images to own listing', true);
  reset role;
  perform t_as(null);
  perform t_ok('anon cannot see images of a pending listing', (select count(*)=0 from property_images where property_id='20000000-0000-0000-0000-000000000001'));
  perform t_ok('anon can see images of approved listing', (select count(*)=1 from property_images where property_id='10000000-0000-0000-0000-000000000001'));
  reset role;
end $$;

-- admin
update profiles set role='admin' where id='00000000-0000-0000-0000-0000000000a4'; -- done by a superuser/DB owner, as documented
do $$ begin
  perform t_as('00000000-0000-0000-0000-0000000000a4');
  perform t_ok('admin sees pending listings', (select count(*)=1 from properties where id='20000000-0000-0000-0000-000000000001'));
  update properties set moderation_status='approved' where id='20000000-0000-0000-0000-000000000001';
  perform t_ok('admin can approve; moderated_by/at recorded', (select moderation_status='approved' and moderated_by='00000000-0000-0000-0000-0000000000a4' and moderated_at is not null from properties where id='20000000-0000-0000-0000-000000000001'));
  update properties set moderation_status='flagged', moderation_note='suspicious' where id='20000000-0000-0000-0000-000000000001';
  perform t_ok('admin can flag with a note', (select moderation_status='flagged' and moderation_note='suspicious' from properties where id='20000000-0000-0000-0000-000000000001'));
  update profiles set role='landlord' where id='00000000-0000-0000-0000-0000000000a2';
  perform t_ok('admin can change a user role', (select role='landlord' from profiles where id='00000000-0000-0000-0000-0000000000a2'));
  update profiles set role='student' where id='00000000-0000-0000-0000-0000000000a2';
  reset role;
  perform t_as(null);
  perform t_ok('flagged listing is hidden from anon', (select count(*)=0 from properties where id='20000000-0000-0000-0000-000000000001'));
  reset role;
  perform t_as('00000000-0000-0000-0000-0000000000a1');
  update properties set moderation_status='approved', moderation_note=null where id='20000000-0000-0000-0000-000000000001';
  perform t_ok('owner cannot un-flag own listing', (select moderation_status='flagged' from properties where id='20000000-0000-0000-0000-000000000001'));
  reset role;
  perform t_as('00000000-0000-0000-0000-0000000000a4');
  update properties set moderation_status='approved' where id='20000000-0000-0000-0000-000000000001';
  update properties set status='Taken' where id='20000000-0000-0000-0000-000000000001';
  perform t_ok('moderation and availability are independent axes (approved + Taken)', (select moderation_status='approved' and status='Taken' from properties where id='20000000-0000-0000-0000-000000000001'));
  reset role;
end $$;

-- constraints
do $$ begin
  perform t_as('00000000-0000-0000-0000-0000000000a1');
  begin insert into properties (host_id,title,rent,description,bedrooms) values ('00000000-0000-0000-0000-0000000000a1','t',0,'d',0); perform t_ok('rent must be > 0', false); exception when check_violation then perform t_ok('rent must be > 0', true); end;
  begin insert into properties (host_id,title,rent,description,bedrooms) values ('00000000-0000-0000-0000-0000000000a1','t',5,'d',-1); perform t_ok('bedrooms must be >= 0', false); exception when check_violation then perform t_ok('bedrooms must be >= 0', true); end;
  begin insert into properties (host_id,title,rent,description,bedrooms) values ('00000000-0000-0000-0000-0000000000a1','t',5,repeat('x',1001),0); perform t_ok('description limited to 1000 chars', false); exception when check_violation then perform t_ok('description limited to 1000 chars', true); end;
  begin insert into properties (host_id,title,rent,description,bedrooms,latitude,longitude) values ('00000000-0000-0000-0000-0000000000a1','t',5,'d',0,95,0); perform t_ok('latitude range enforced', false); exception when check_violation then perform t_ok('latitude range enforced', true); end;
  reset role;
end $$;

-- storage
do $$ begin
  insert into storage.buckets (id,name) values ('other','other') on conflict do nothing;
  perform t_as('00000000-0000-0000-0000-0000000000a1');
  begin insert into storage.objects (bucket_id,name) values ('property-images','00000000-0000-0000-0000-0000000000a1/p/1.jpg'); perform t_ok('landlord can upload into own folder', true); exception when others then perform t_ok('landlord can upload into own folder', false); end;
  begin insert into storage.objects (bucket_id,name) values ('property-images','00000000-0000-0000-0000-0000000000a3/p/1.jpg'); perform t_ok('landlord cannot upload into another user''s folder', false); exception when others then perform t_ok('landlord cannot upload into another user''s folder', true); end;
  reset role;
  perform t_as('00000000-0000-0000-0000-0000000000a3');
  declare n int; begin
    delete from storage.objects where name like '00000000-0000-0000-0000-0000000000a1/%'; get diagnostics n = row_count;
    perform t_ok('other user cannot delete someone else''s photo', n=0);
  end;
  reset role;
  perform t_as(null);
  begin insert into storage.objects (bucket_id,name) values ('property-images','x/y.jpg'); perform t_ok('anon cannot upload', false); exception when others then perform t_ok('anon cannot upload', true); end;
  reset role;
  perform t_ok('bucket is image-only with a 5 MB limit', (select file_size_limit=5242880 and allowed_mime_types @> array['image/jpeg','image/png','image/webp'] and not allowed_mime_types && array['image/svg+xml','text/html'] from storage.buckets where id='property-images'));
end $$;

-- signup trigger cannot be used to create admins
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000b1','x@t','{"full_name":"  Evil Admin ","role":"admin","phone":"+254700000000"}'),
 ('00000000-0000-0000-0000-0000000000b2','y@t','{"full_name":"Real Landlord","role":"landlord","phone":"+254700000001"}');
do $$ begin
  perform t_ok('signup with role=admin in metadata yields student', (select role='student' from profiles where id='00000000-0000-0000-0000-0000000000b1'));
  perform t_ok('signup trims names', (select full_name='Evil Admin' from profiles where id='00000000-0000-0000-0000-0000000000b1'));
  perform t_ok('signup with role=landlord yields landlord', (select role='landlord' from profiles where id='00000000-0000-0000-0000-0000000000b2'));
end $$;

\echo
select case when count(*) filter (where not ok) = 0 then 'ALL ' || count(*) || ' CHECKS PASSED' else count(*) filter (where not ok) || ' FAILED of ' || count(*) end as summary from t_results;
select name as failed_check from t_results where not ok;
