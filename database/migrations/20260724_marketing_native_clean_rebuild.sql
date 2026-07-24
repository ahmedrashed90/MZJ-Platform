create schema if not exists marketing;

create table if not exists marketing.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_content boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.department_users (
  department_id uuid not null references marketing.departments(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(department_id,user_id)
);

create table if not exists marketing.assignment_actions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references marketing.departments(id) on delete cascade,
  name text not null,
  percentage numeric(6,2) not null default 0 check(percentage >= 0 and percentage <= 100),
  admin_only boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.creative_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_code text not null,
  primary_department_id uuid references marketing.departments(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.campaign_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_code text not null,
  code_prefix text not null,
  sequence_value integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.platforms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.platform_post_types (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references marketing.platforms(id) on delete cascade,
  name text not null,
  width integer,
  height integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform_id,name)
);

create table if not exists marketing.funnels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  source text not null default 'dashboard',
  created_at timestamptz not null default now()
);
alter table marketing.funnels add column if not exists active boolean not null default true;
alter table marketing.funnels add column if not exists source text not null default 'dashboard';
alter table marketing.funnels add column if not exists created_at timestamptz not null default now();
create unique index if not exists marketing_funnels_name_uq on marketing.funnels(name);

insert into marketing.funnels(name,active,source)
select seed.name,true,'dashboard'
from (values ('Awareness'),('Leads'),('Conversion Message')) as seed(name)
where not exists (select 1 from marketing.funnels current where current.name=seed.name);
update marketing.funnels set active=true,source=coalesce(nullif(source,''),'dashboard');

create table if not exists marketing.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  price numeric(14,2) not null default 0,
  cash_discount numeric(6,2) not null default 0,
  registration_fees boolean not null default false,
  insurance boolean not null default false,
  issuance_fees boolean not null default false,
  care_features jsonb not null default '[]'::jsonb,
  delivery_home boolean not null default false,
  delivery_region boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table marketing.campaigns add column if not exists campaign_date date not null default current_date;
alter table marketing.campaigns add column if not exists campaign_type_id uuid references marketing.campaign_types(id) on delete set null;
alter table marketing.campaigns add column if not exists required_from_content text;
alter table marketing.campaigns add column if not exists publish_start date;
alter table marketing.campaigns add column if not exists publish_end date;
alter table marketing.campaigns add column if not exists payload jsonb not null default '{}'::jsonb;
alter table marketing.campaigns add column if not exists progress numeric(6,2) not null default 0;
alter table marketing.campaigns add column if not exists result_file_id uuid;
alter table marketing.campaigns add column if not exists links jsonb not null default '[]'::jsonb;
alter table marketing.campaigns add column if not exists archived_at timestamptz;
alter table marketing.campaigns add column if not exists archived_by uuid references core.users(id);

create table if not exists marketing.agendas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  month_key text not null,
  publish_start date not null,
  publish_end date not null,
  status text not null default 'required',
  payload jsonb not null default '{}'::jsonb,
  progress numeric(6,2) not null default 0,
  result_file_id uuid,
  links jsonb not null default '[]'::jsonb,
  archived_at timestamptz,
  archived_by uuid references core.users(id),
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table marketing.creatives alter column campaign_id drop not null;
alter table marketing.creatives add column if not exists agenda_id uuid references marketing.agendas(id) on delete cascade;
alter table marketing.creatives add column if not exists creative_type_id uuid references marketing.creative_types(id) on delete set null;
alter table marketing.creatives add column if not exists instance_code text;
alter table marketing.creatives add column if not exists name text;
alter table marketing.creatives add column if not exists primary_department_id uuid references marketing.departments(id) on delete set null;
alter table marketing.creatives add column if not exists cars jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists content_assignments jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists primary_assignments jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists optional_assignments jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists platform_assignments jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists schedule_day date;
alter table marketing.creatives add column if not exists notes jsonb not null default '{}'::jsonb;

create table if not exists marketing.files (
  id uuid primary key default gen_random_uuid(),
  storage_key text not null unique,
  original_name text not null,
  mime_type text,
  file_size bigint,
  category text not null,
  source_type text,
  source_id uuid,
  task_id uuid,
  status text not null default 'uploading',
  uploaded_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.task_templates (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check(source_type in ('campaign','agenda')),
  source_id uuid not null,
  creative_id uuid references marketing.creatives(id) on delete cascade,
  content_user_id uuid not null references core.users(id),
  task_no text not null unique,
  status text not null default 'not_started',
  progress numeric(6,2) not null default 0,
  due_on date,
  department_note text,
  admin_note text,
  template_data jsonb not null default '{}'::jsonb,
  approved_data jsonb not null default '{}'::jsonb,
  file_id uuid references marketing.files(id) on delete set null,
  received_at timestamptz,
  reviewed_by uuid references core.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table marketing.tasks alter column campaign_id drop not null;
alter table marketing.tasks add column if not exists agenda_id uuid references marketing.agendas(id) on delete cascade;
alter table marketing.tasks add column if not exists source_type text not null default 'campaign';
alter table marketing.tasks add column if not exists source_id uuid;
alter table marketing.tasks add column if not exists department_id uuid references marketing.departments(id) on delete set null;
alter table marketing.tasks add column if not exists task_template_id uuid references marketing.task_templates(id) on delete set null;
alter table marketing.tasks add column if not exists task_kind text not null default 'execution';
alter table marketing.tasks add column if not exists title text;
alter table marketing.tasks add column if not exists progress numeric(6,2) not null default 0;
alter table marketing.tasks add column if not exists received_at timestamptz;
alter table marketing.tasks add column if not exists note text;
alter table marketing.tasks add column if not exists final_file_id uuid references marketing.files(id) on delete set null;
alter table marketing.tasks add column if not exists approved_template_data jsonb not null default '{}'::jsonb;
alter table marketing.tasks add column if not exists is_deleted boolean not null default false;

create table if not exists marketing.task_action_progress (
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  action_id uuid not null references marketing.assignment_actions(id) on delete cascade,
  completed boolean not null default false,
  completed_by uuid references core.users(id),
  completed_at timestamptz,
  primary key(task_id,action_id)
);

create table if not exists marketing.task_review_history (
  id uuid primary key default gen_random_uuid(),
  task_template_id uuid not null references marketing.task_templates(id) on delete cascade,
  action text not null,
  note text,
  before_data jsonb,
  after_data jsonb,
  actor_id uuid references core.users(id),
  actor_name text,
  created_at timestamptz not null default now()
);

create table if not exists marketing.budget_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  funnel_id uuid references marketing.funnels(id) on delete set null,
  creative_id uuid references marketing.creatives(id) on delete set null,
  ads_count integer not null default 1,
  content_goal text,
  expected_goal text,
  platform_amounts jsonb not null default '[]'::jsonb,
  total numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists marketing.publish_schedule (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null default gen_random_uuid(),
  source_type text not null check(source_type in ('campaign','agenda')),
  source_id uuid not null,
  creative_id uuid references marketing.creatives(id) on delete cascade,
  task_id uuid references marketing.tasks(id) on delete cascade,
  publish_date date not null,
  platform_id uuid references marketing.platforms(id) on delete set null,
  post_type_id uuid references marketing.platform_post_types(id) on delete set null,
  caption text,
  hashtags text,
  status text not null default 'waiting',
  published_at timestamptz,
  publish_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table marketing.publish_schedule add column if not exists group_id uuid default gen_random_uuid();
update marketing.publish_schedule set group_id=gen_random_uuid() where group_id is null;
alter table marketing.publish_schedule alter column group_id set default gen_random_uuid();
alter table marketing.publish_schedule alter column group_id set not null;
alter table marketing.publish_schedule add column if not exists task_id uuid references marketing.tasks(id) on delete cascade;

create table if not exists marketing.platform_connections (
  platform text primary key check(platform in ('facebook','instagram')),
  connected boolean not null default false,
  status text not null default 'disconnected',
  state text not null default 'idle',
  source text,
  account_id text,
  account_name text,
  page_id text,
  page_name text,
  ig_user_id text,
  username text,
  pages jsonb not null default '[]'::jsonb,
  access_token_encrypted text,
  user_access_token_encrypted text,
  page_access_token_encrypted text,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references core.users(id)
);

create table if not exists marketing.publish_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references marketing.publish_schedule(id) on delete set null,
  platform text not null,
  status text not null,
  result jsonb not null default '{}'::jsonb,
  error text,
  published_by uuid references core.users(id),
  created_at timestamptz not null default now()
);

create table if not exists marketing.attendance_settings (
  singleton boolean primary key default true check(singleton),
  work_start time not null default '09:00',
  work_end time not null default '17:00',
  grace_minutes integer not null default 15,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);
insert into marketing.attendance_settings(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists marketing.attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  attendance_date date not null default current_date,
  check_in timestamptz,
  check_out timestamptz,
  delay_minutes integer not null default 0,
  work_minutes integer not null default 0,
  status text not null default 'not_registered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,attendance_date)
);

create table if not exists marketing.presence_status (
  user_id uuid primary key references core.users(id) on delete cascade,
  online boolean not null default false,
  last_activity_at timestamptz not null default now(),
  last_activity_type text,
  updated_at timestamptz not null default now()
);
alter table marketing.presence_status add column if not exists last_activity_type text;

create table if not exists marketing.user_colors (
  user_id uuid primary key references core.users(id) on delete cascade,
  color text not null default '#c65f3c',
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);

alter table operations.transfer_request_vehicles add column if not exists item_note text;

create table if not exists marketing.stock_vehicle_state (
  vehicle_id uuid primary key references operations.vehicles(id) on delete cascade,
  photographed boolean not null default false,
  photographed_at timestamptz,
  content_usage jsonb not null default '[]'::jsonb,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_campaigns_status_idx on marketing.campaigns(status,archived_at,created_at desc);
create index if not exists marketing_agendas_status_idx on marketing.agendas(status,archived_at,created_at desc);
create index if not exists marketing_tasks_source_idx on marketing.tasks(source_type,source_id,status,is_deleted);
create index if not exists marketing_tasks_assigned_idx on marketing.tasks(assigned_to,status,is_deleted);
create index if not exists marketing_templates_source_idx on marketing.task_templates(source_type,source_id,status);
create index if not exists marketing_schedule_date_idx on marketing.publish_schedule(publish_date,status);
create index if not exists marketing_schedule_group_idx on marketing.publish_schedule(group_id);
create index if not exists marketing_schedule_task_idx on marketing.publish_schedule(task_id);

insert into core.permissions(code,name,system_code) values
('marketing.view','عرض سيستم التسويق','marketing'),
('marketing.task.receive','استلام تاسكات التسويق','marketing'),
('marketing.task.execute','تنفيذ إجراءات التكليف','marketing'),
('marketing.file.upload','رفع ملفات التسويق','marketing'),
('marketing.manage','إدارة سيستم التسويق','marketing')
on conflict(code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='marketing_user' and p.code in ('marketing.view','marketing.task.receive','marketing.task.execute','marketing.file.upload')
on conflict do nothing;
