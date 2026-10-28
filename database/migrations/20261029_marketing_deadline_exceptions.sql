begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';

create table if not exists marketing.work_item_deadline_exceptions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references marketing.work_items(id) on delete cascade,
  requested_by uuid not null references core.users(id),
  requested_at timestamptz not null default now(),
  request_note text not null default '',
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  decided_by uuid references core.users(id),
  decided_at timestamptz,
  decision_note text not null default '',
  unique(item_id)
);
create index if not exists work_item_deadline_exceptions_status
  on marketing.work_item_deadline_exceptions(status,requested_at desc);
insert into marketing.workflow_migrations(code) values('schema-10') on conflict do nothing;
commit;
