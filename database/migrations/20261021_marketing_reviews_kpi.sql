-- Marketing workflow: independent format review and executor quality evaluation.
-- Applied through the platform Marketing workflow schema initializer.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
create table if not exists marketing.work_review_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null, sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists marketing.work_kpi_criteria (
  id uuid primary key default gen_random_uuid(),
  name text not null, sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists marketing.work_format_reviews (
  item_id uuid not null references marketing.work_items(id) on delete cascade,
  format_id text not null,
  status text not null check(status in ('submitted','approved','revision')),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references core.users(id),
  updated_at timestamptz not null default now(),
  primary key(item_id,format_id)
);
create index if not exists work_format_reviews_item_status on marketing.work_format_reviews(item_id,status);
alter table marketing.work_items add column if not exists review_note_type_id uuid references marketing.work_review_categories(id);
alter table marketing.work_items add column if not exists review_note_created_at timestamptz;
create table if not exists marketing.work_item_ratings (
  item_id uuid primary key references marketing.work_items(id) on delete cascade,
  assignee_id uuid not null references core.users(id),
  rated_by uuid not null references core.users(id),
  scores jsonb not null check(jsonb_typeof(scores)='array'),
  percentage numeric(5,2) not null check(percentage between 0 and 100),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists work_item_ratings_monthly on marketing.work_item_ratings(created_at,assignee_id);
-- Preserve previously approved files exactly as approved; previously submitted
-- formats remain awaiting review. A format without a ready file is not marked.
insert into marketing.work_format_reviews(item_id,format_id,status,submitted_at,approved_at,approved_by)
select i.id, f.value->>'id',
  case when i.status='approved' then 'approved' else 'submitted' end,
  i.submitted_at, case when i.status='approved' then i.approved_at else null end,
  case when i.status='approved' then i.approved_by else null end
from marketing.work_items i
cross join lateral jsonb_array_elements(i.formats) f(value)
where i.status in ('approved','submitted')
  and exists(select 1 from marketing.work_item_files w join marketing.files file on file.id=w.file_id
    where w.item_id=i.id and w.format_id=f.value->>'id' and w.category='final' and file.status='ready')
on conflict(item_id,format_id) do nothing;
insert into marketing.workflow_migrations(code) values ('schema-5') on conflict do nothing;
commit;
