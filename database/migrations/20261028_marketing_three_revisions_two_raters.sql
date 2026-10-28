begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
alter table marketing.work_items drop constraint if exists work_items_status_check;
alter table marketing.work_items add constraint work_items_status_check
  check(status in ('in_progress','submitted','revision','editing','approved'));
alter table marketing.work_item_review_notes add column if not exists revision_number integer;
alter table marketing.work_item_review_notes add column if not exists executor_response text;
alter table marketing.work_item_review_notes drop constraint if exists work_item_review_notes_executor_response_check;
alter table marketing.work_item_review_notes add constraint work_item_review_notes_executor_response_check
  check(executor_response is null or executor_response in ('accepted','declined'));
-- Number every historical note in its original creation order. Past notes remain unchanged.
with numbered as (
  select id,row_number() over(partition by item_id order by created_at,id)::integer as seq
  from marketing.work_item_review_notes
)
update marketing.work_item_review_notes n set revision_number=x.seq
from numbered x where x.id=n.id and n.revision_number is null;
create unique index if not exists work_item_review_notes_sequence_unique
  on marketing.work_item_review_notes(item_id,revision_number) where revision_number is not null;
create table if not exists marketing.work_rating_reviewers (
  slot smallint primary key check(slot in (1,2)),
  user_id uuid not null unique references core.users(id),
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);
alter table marketing.work_rejected_items add column if not exists revision_notes jsonb not null default '[]'::jsonb;
insert into marketing.workflow_migrations(code) values('schema-8') on conflict do nothing;
commit;
