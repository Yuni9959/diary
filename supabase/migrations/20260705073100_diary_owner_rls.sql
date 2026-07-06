begin;

-- Owner columns
alter table diary.entries
add column if not exists owner_id uuid;

alter table diary.entries
alter column owner_id set default auth.uid();

update diary.entries
set owner_id = created_by
where owner_id is null
  and created_by is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'entries_owner_id_fkey'
      and conrelid = 'diary.entries'::regclass
  ) then
    alter table diary.entries
    add constraint entries_owner_id_fkey
    foreign key (owner_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from diary.entries
    where owner_id is null
  ) then
    alter table diary.entries
    alter column owner_id set not null;
  end if;
end;
$$;

alter table diary.sync_events
add column if not exists owner_id uuid;

alter table diary.sync_events
alter column owner_id set default auth.uid();

update diary.sync_events se
set owner_id = e.owner_id
from diary.entries e
where se.owner_id is null
  and se.entry_id = e.id
  and e.owner_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sync_events_owner_id_fkey'
      and conrelid = 'diary.sync_events'::regclass
  ) then
    alter table diary.sync_events
    add constraint sync_events_owner_id_fkey
    foreign key (owner_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from diary.sync_events
    where owner_id is null
  ) then
    alter table diary.sync_events
    alter column owner_id set not null;
  end if;
end;
$$;

-- Per-owner entry uniqueness
alter table diary.entries
drop constraint if exists entries_entry_date_unique;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'entries_owner_entry_date_unique'
      and conrelid = 'diary.entries'::regclass
  ) then
    alter table diary.entries
    add constraint entries_owner_entry_date_unique
    unique (owner_id, entry_date);
  end if;
end;
$$;

-- Indexes
create index if not exists entries_owner_entry_date_idx
on diary.entries (owner_id, entry_date desc);

create index if not exists sync_events_owner_created_at_idx
on diary.sync_events (owner_id, created_at desc);

-- Keep anonymous access closed
revoke all on schema diary from public;
revoke all on all tables in schema diary from public;
revoke all on all sequences in schema diary from public;
revoke all on all functions in schema diary from public;

revoke all on schema diary from anon;
revoke all on all tables in schema diary from anon;
revoke all on all sequences in schema diary from anon;
revoke all on all functions in schema diary from anon;

-- Authenticated app access; RLS still controls row visibility.
grant usage on schema diary to authenticated;

grant select, insert, update, delete
on diary.entries
to authenticated;

grant select, insert, update, delete
on diary.entry_assets
to authenticated;

grant select, insert
on diary.sync_events
to authenticated;

grant usage, select
on all sequences in schema diary
to authenticated;

-- Trusted backend role support only. Never expose service_role in frontend code.
grant usage on schema diary to service_role;
grant all privileges on all tables in schema diary to service_role;
grant usage, select on all sequences in schema diary to service_role;
grant execute on all functions in schema diary to service_role;

-- RLS policies: entries
drop policy if exists entries_select_own on diary.entries;
create policy entries_select_own
on diary.entries
for select
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists entries_insert_own on diary.entries;
create policy entries_insert_own
on diary.entries
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists entries_update_own on diary.entries;
create policy entries_update_own
on diary.entries
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists entries_delete_own on diary.entries;
create policy entries_delete_own
on diary.entries
for delete
to authenticated
using ((select auth.uid()) = owner_id);

-- RLS policies: entry_assets, scoped through the parent entry owner.
drop policy if exists entry_assets_select_own on diary.entry_assets;
create policy entry_assets_select_own
on diary.entry_assets
for select
to authenticated
using (
  exists (
    select 1
    from diary.entries e
    where e.id = entry_assets.entry_id
      and e.owner_id = (select auth.uid())
  )
);

drop policy if exists entry_assets_insert_own on diary.entry_assets;
create policy entry_assets_insert_own
on diary.entry_assets
for insert
to authenticated
with check (
  exists (
    select 1
    from diary.entries e
    where e.id = entry_assets.entry_id
      and e.owner_id = (select auth.uid())
  )
);

drop policy if exists entry_assets_update_own on diary.entry_assets;
create policy entry_assets_update_own
on diary.entry_assets
for update
to authenticated
using (
  exists (
    select 1
    from diary.entries e
    where e.id = entry_assets.entry_id
      and e.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from diary.entries e
    where e.id = entry_assets.entry_id
      and e.owner_id = (select auth.uid())
  )
);

drop policy if exists entry_assets_delete_own on diary.entry_assets;
create policy entry_assets_delete_own
on diary.entry_assets
for delete
to authenticated
using (
  exists (
    select 1
    from diary.entries e
    where e.id = entry_assets.entry_id
      and e.owner_id = (select auth.uid())
  )
);

-- RLS policies: sync_events
drop policy if exists sync_events_select_own on diary.sync_events;
create policy sync_events_select_own
on diary.sync_events
for select
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists sync_events_insert_own on diary.sync_events;
create policy sync_events_insert_own
on diary.sync_events
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

commit;
