begin;
create schema if not exists marketing;
create table if not exists marketing.workflow_migrations(code text primary key, applied_at timestamptz not null default now());
create sequence if not exists marketing.work_task_number_seq as bigint;
create sequence if not exists marketing.work_plan_number_seq as bigint;
create table if not exists marketing.work_reservations (
  id uuid primary key default gen_random_uuid(), request_key uuid not null, created_by uuid not null references core.users(id),
  task_number bigint not null default nextval('marketing.work_task_number_seq') unique,
  created_at timestamptz not null default now(), used_at timestamptz, unique(created_by,request_key)
);
create table if not exists marketing.work_tasks (
  id uuid primary key references marketing.work_reservations(id),
  task_number bigint not null unique, task_no text not null unique, name text not null,
  type_id uuid not null references marketing.campaign_types(id),
  created_by uuid not null references core.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  status text not null default 'active' check(status in ('active','completed','empty')),
  completed_at timestamptz, version integer not null default 1
);
create table if not exists marketing.work_items (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references marketing.work_tasks(id) on delete cascade,
  client_key uuid not null, department_id uuid not null references marketing.departments(id), assigned_to uuid not null references core.users(id),
  media_kind text not null check(media_kind in ('image','video')),
  idea_name text not null default '', idea text not null default '', formats jsonb not null default '[]', due_on date not null,
  status text not null default 'in_progress' check(status in ('in_progress','submitted','revision','approved')),
  submitted_at timestamptz, approved_at timestamptz, approved_by uuid references core.users(id),
  review_note text not null default '', version integer not null default 1, sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(task_id,client_key), check(jsonb_typeof(formats)='array' and jsonb_array_length(formats)>0)
);
create index if not exists work_items_task on marketing.work_items(task_id,sort_order);
create index if not exists work_items_delivery on marketing.work_items(assigned_to,due_on,status);
create index if not exists work_items_approved on marketing.work_items(approved_at desc) where status='approved';
create table if not exists marketing.work_uploads (
  file_id uuid primary key references marketing.files(id) on delete cascade,
  reservation_id uuid references marketing.work_reservations(id), item_id uuid references marketing.work_items(id) on delete cascade,
  category text not null check(category in ('idea','final')), format_ids jsonb not null default '[]',
  created_by uuid not null references core.users(id), created_at timestamptz not null default now(),
  committed_at timestamptz, cancelled_at timestamptz,
  check((reservation_id is not null) <> (item_id is not null))
);
create table if not exists marketing.work_item_files (
  id uuid primary key default gen_random_uuid(), item_id uuid not null references marketing.work_items(id) on delete cascade,
  file_id uuid not null references marketing.files(id), category text not null check(category in ('idea','final')),
  format_id text not null default '', order_index integer not null default 0,
  created_at timestamptz not null default now(), unique(item_id,file_id,format_id)
);
create index if not exists work_item_files_file on marketing.work_item_files(file_id);
create table if not exists marketing.work_history (
  id uuid primary key default gen_random_uuid(), task_id uuid references marketing.work_tasks(id) on delete cascade,
  item_id uuid, action text not null, note text, actor_id uuid references core.users(id), actor_name text,
  data jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists marketing.work_action_progress (
  item_id uuid not null references marketing.work_items(id) on delete cascade,
  action_id uuid not null references marketing.assignment_actions(id), completed boolean not null default false,
  completed_by uuid references core.users(id), updated_at timestamptz not null default now(), primary key(item_id,action_id)
);
create table if not exists marketing.work_plans (
  id uuid primary key default gen_random_uuid(), request_key uuid not null, plan_number bigint not null default nextval('marketing.work_plan_number_seq'),
  plan_no text not null unique, kind text not null check(kind in ('agenda','campaign')), name text not null,
  created_by uuid not null references core.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(created_by,request_key)
);
create table if not exists marketing.work_plan_items (
  id uuid primary key default gen_random_uuid(), plan_id uuid not null references marketing.work_plans(id) on delete cascade,
  product_id uuid not null references marketing.work_items(id), scheduled_on date not null,
  caption text not null default '', hashtags text not null default '', version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(plan_id,product_id,scheduled_on)
);
create index if not exists work_plan_items_date on marketing.work_plan_items(scheduled_on,plan_id);
create table if not exists marketing.work_publish_targets (
  id uuid primary key default gen_random_uuid(), line_id uuid not null references marketing.work_plan_items(id),
  post_type_id uuid not null references marketing.platform_post_types(id), schedule_id uuid not null references marketing.publish_schedule(id),
  unique(line_id,post_type_id), unique(schedule_id)
);
create table if not exists marketing.work_publish_files (
  schedule_id uuid not null references marketing.publish_schedule(id), file_id uuid not null references marketing.files(id),
  sort_order integer not null default 0, primary key(schedule_id,file_id)
);
alter table marketing.tasks add column if not exists workflow_product_id uuid references marketing.work_items(id);
alter table marketing.assignment_actions add column if not exists is_final_approval boolean not null default false;
update marketing.assignment_actions set is_final_approval=true,admin_only=true
 where regexp_replace(name,'[[:space:]_-]+','','g')=regexp_replace('اعتماد - المنتج 100%','[[:space:]_-]+','','g');
insert into marketing.workflow_migrations(code) values('schema-1') on conflict do nothing;
commit;
