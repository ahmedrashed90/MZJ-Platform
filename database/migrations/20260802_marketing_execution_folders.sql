begin;

alter table marketing.tasks
  add column if not exists execution_folders jsonb not null default '{}'::jsonb;

commit;
