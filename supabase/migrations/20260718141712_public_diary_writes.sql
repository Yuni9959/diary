begin;

-- This is a single shared diary. The public date is therefore the conflict key,
-- while owner_id remains optional metadata for rows created by a signed-in user.
alter table diary.entries
alter column owner_id drop not null;

alter table diary.entries
drop constraint if exists entries_owner_entry_date_unique;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'entries_entry_date_unique'
      and conrelid = 'diary.entries'::regclass
  ) then
    alter table diary.entries
    add constraint entries_entry_date_unique unique (entry_date);
  end if;
end;
$$;

grant usage on schema diary to anon, authenticated;

grant select, insert, update
on diary.entries
to anon;

grant select, insert, update, delete
on diary.entries
to authenticated;

drop policy if exists entries_insert_own on diary.entries;
drop policy if exists entries_insert_public on diary.entries;
create policy entries_insert_public
on diary.entries
for insert
to anon, authenticated
with check (true);

drop policy if exists entries_update_own on diary.entries;
drop policy if exists entries_update_public on diary.entries;
create policy entries_update_public
on diary.entries
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists entries_delete_own on diary.entries;
drop policy if exists entries_delete_authenticated on diary.entries;
create policy entries_delete_authenticated
on diary.entries
for delete
to authenticated
using (true);

commit;
