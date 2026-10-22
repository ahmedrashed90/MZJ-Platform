-- Preserve a rejected executor's rating capability WITHOUT leaving the rejected
-- requirement in the active task, readiness, product or publication pipeline.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
create table if not exists marketing.work_rejected_items (
  item_id uuid primary key,
  task_id uuid not null references marketing.work_tasks(id) on delete cascade,
  assigned_to uuid not null references core.users(id),
  idea_name text not null,
  media_kind text not null check(media_kind in ('image','video')),
  rejected_by uuid references core.users(id),
  rejected_at timestamptz not null default now(),
  rejection_note text not null default '',
  scores jsonb check(scores is null or jsonb_typeof(scores)='array'),
  percentage numeric(5,2) check(percentage is null or percentage between 0 and 100),
  rated_by uuid references core.users(id),
  rated_at timestamptz
);
create index if not exists work_rejected_items_task on marketing.work_rejected_items(task_id,rejected_at desc);
create index if not exists work_rejected_items_ratings on marketing.work_rejected_items(rated_at,assigned_to) where rated_at is not null;
insert into marketing.workflow_migrations(code) values('schema-7') on conflict do nothing;
commit;
