begin;

alter table marketing.tasks
  add column if not exists completed_by uuid references core.users(id);

create index if not exists marketing_tasks_completed_idx
  on marketing.tasks(completed_at desc)
  where is_deleted=false and status='completed';

commit;
