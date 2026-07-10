begin;

-- Diary entries are public to read, but writes still require an authenticated owner.
grant usage on schema diary to anon, authenticated;

grant select
on diary.entries
to anon, authenticated;

grant select
on diary.entry_assets
to anon, authenticated;

grant insert, update, delete
on diary.entries
to authenticated;

grant insert, update, delete
on diary.entry_assets
to authenticated;

grant select, insert
on diary.sync_events
to authenticated;

drop policy if exists entries_select_own on diary.entries;
drop policy if exists entries_select_public on diary.entries;
create policy entries_select_public
on diary.entries
for select
to anon, authenticated
using (true);

drop policy if exists entry_assets_select_own on diary.entry_assets;
drop policy if exists entry_assets_select_public on diary.entry_assets;
create policy entry_assets_select_public
on diary.entry_assets
for select
to anon, authenticated
using (true);

commit;
