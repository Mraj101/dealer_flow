-- Run AFTER creating your user (Dashboard -> Authentication -> Users -> Add user)

-- 1) Give existing rows (test data) to your user. Replace the uuid.
--    Find it in Authentication -> Users -> copy "User UID".
update products   set user_id = 'YOUR-USER-UID' where user_id is null;
update shops      set user_id = 'YOUR-USER-UID' where user_id is null;
update sales      set user_id = 'YOUR-USER-UID' where user_id is null;
update sale_items set user_id = 'YOUR-USER-UID' where user_id is null;
update payments   set user_id = 'YOUR-USER-UID' where user_id is null;

-- 2) RLS on, one policy per table: logged-in users see/write only their own rows
do $$
declare t text;
begin
  foreach t in array array['products','shops','sales','sale_items','payments'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "own rows" on %I for all to authenticated
       using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
