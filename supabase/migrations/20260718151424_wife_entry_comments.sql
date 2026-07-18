begin;

create table diary.entry_comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null
    references diary.entries(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint entry_comments_body_length_check
    check (char_length(btrim(body)) between 1 and 500)
);

comment on table diary.entry_comments
is 'Short wife responses attached to diary entries.';

create index entry_comments_entry_created_idx
on diary.entry_comments (entry_id, created_at, id);

alter table diary.entry_comments enable row level security;

revoke all on diary.entry_comments from public, anon, authenticated;
grant usage on schema diary to anon, authenticated;
grant select, insert on diary.entry_comments to anon, authenticated;
grant delete on diary.entry_comments to authenticated;
grant all privileges on diary.entry_comments to service_role;

create policy entry_comments_select_public
on diary.entry_comments for select
to anon, authenticated
using (true);

create policy entry_comments_insert_public
on diary.entry_comments for insert
to anon, authenticated
with check (char_length(btrim(body)) between 1 and 500);

create policy entry_comments_delete_authenticated
on diary.entry_comments for delete
to authenticated
using ((select auth.uid()) is not null);

commit;
