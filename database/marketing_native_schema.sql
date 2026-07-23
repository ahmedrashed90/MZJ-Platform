begin;

create schema if not exists marketing;
create sequence if not exists marketing.project_code_seq;
create sequence if not exists marketing.task_no_seq;
create sequence if not exists marketing.photo_request_no_seq;

insert into core.permissions(code,name,system_code) values
('marketing.view','عرض نظام التسويق','marketing'),
('marketing.project.create','إنشاء الحملات والأجندات','marketing'),
('marketing.project.edit','تعديل الحملات والأجندات','marketing'),
('marketing.project.archive','أرشفة الحملات والأجندات','marketing'),
('marketing.project.delete','مسح الحملات والأجندات','marketing'),
('marketing.task.receive','استلام تاسكات التسويق','marketing'),
('marketing.task.execute','تنفيذ إجراءات التكليف','marketing'),
('marketing.template.upload','رفع Task Template','marketing'),
('marketing.template.review','مراجعة واعتماد Task Template','marketing'),
('marketing.publish.manage','إدارة قسم وتجهيز النشر','marketing'),
('marketing.package.manage','إدارة الباقات','marketing'),
('marketing.stock.view','عرض استوك العمليات من التسويق','marketing'),
('marketing.photo_request.create','إنشاء طلب تصوير','marketing'),
('marketing.photo_request.manage','متابعة طلبات التصوير','marketing'),
('marketing.reports.view','عرض تقارير التسويق','marketing'),
('marketing.attendance.use','تسجيل الحضور والانصراف','marketing'),
('marketing.attendance.manage','إدارة الحضور والانصراف','marketing'),
('marketing.connections.manage','إدارة ربط المنصات','marketing'),
('marketing.settings.manage','إدارة إعدادات التسويق','marketing')
on conflict (code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code in ('admin','system_admin') and p.system_code='marketing'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in (
  'marketing.view','marketing.task.receive','marketing.task.execute','marketing.template.upload',
  'marketing.stock.view','marketing.attendance.use'
)
where r.code='marketing_user'
on conflict do nothing;

create table if not exists marketing.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_content_department boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.departments.
alter table marketing.departments add column if not exists code text;
alter table marketing.departments add column if not exists name text;
alter table marketing.departments add column if not exists is_content_department boolean not null default false;
alter table marketing.departments add column if not exists is_active boolean not null default true;
alter table marketing.departments add column if not exists sort_order integer not null default 0;
alter table marketing.departments add column if not exists created_at timestamptz not null default now();
alter table marketing.departments add column if not exists updated_at timestamptz not null default now();

create unique index if not exists marketing_single_content_department
on marketing.departments((is_content_department)) where is_content_department=true and is_active=true;

create table if not exists marketing.department_users (
  department_id uuid not null references marketing.departments(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(department_id,user_id)
);
-- Existing-table compatibility contract for marketing.department_users.
alter table marketing.department_users add column if not exists department_id uuid references marketing.departments(id) on delete cascade;
alter table marketing.department_users add column if not exists user_id uuid references core.users(id) on delete cascade;
alter table marketing.department_users add column if not exists is_active boolean not null default true;
alter table marketing.department_users add column if not exists created_at timestamptz not null default now();

create table if not exists marketing.assignment_actions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references marketing.departments(id) on delete cascade,
  name text not null,
  percentage numeric(5,2) not null check(percentage>=0 and percentage<=100),
  audience text not null default 'user' check(audience in ('user','admin','both')),
  is_required boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(department_id,name)
);
-- Existing-table compatibility contract for marketing.assignment_actions.
alter table marketing.assignment_actions add column if not exists department_id uuid references marketing.departments(id) on delete cascade;
alter table marketing.assignment_actions add column if not exists name text;
alter table marketing.assignment_actions add column if not exists percentage numeric(5,2);
alter table marketing.assignment_actions add column if not exists audience text not null default 'user';
alter table marketing.assignment_actions add column if not exists is_required boolean not null default true;
alter table marketing.assignment_actions add column if not exists is_active boolean not null default true;
alter table marketing.assignment_actions add column if not exists sort_order integer not null default 0;
alter table marketing.assignment_actions add column if not exists created_at timestamptz not null default now();
alter table marketing.assignment_actions add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.creative_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_code text not null unique,
  primary_department_id uuid references marketing.departments(id),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.creative_types.
alter table marketing.creative_types add column if not exists name text;
alter table marketing.creative_types add column if not exists short_code text;
alter table marketing.creative_types add column if not exists primary_department_id uuid references marketing.departments(id);
alter table marketing.creative_types add column if not exists is_active boolean not null default true;
alter table marketing.creative_types add column if not exists sort_order integer not null default 0;
alter table marketing.creative_types add column if not exists created_at timestamptz not null default now();
alter table marketing.creative_types add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.campaign_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_code text not null unique,
  code_prefix text not null default 'MZJ',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  next_number bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.campaign_types.
alter table marketing.campaign_types add column if not exists name text;
alter table marketing.campaign_types add column if not exists short_code text;
alter table marketing.campaign_types add column if not exists code_prefix text not null default 'MZJ';
alter table marketing.campaign_types add column if not exists is_active boolean not null default true;
alter table marketing.campaign_types add column if not exists sort_order integer not null default 0;
alter table marketing.campaign_types add column if not exists next_number bigint not null default 1;
alter table marketing.campaign_types add column if not exists created_at timestamptz not null default now();
alter table marketing.campaign_types add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.platforms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.platforms.
alter table marketing.platforms add column if not exists code text;
alter table marketing.platforms add column if not exists name text;
alter table marketing.platforms add column if not exists is_active boolean not null default true;
alter table marketing.platforms add column if not exists sort_order integer not null default 0;
alter table marketing.platforms add column if not exists created_at timestamptz not null default now();
alter table marketing.platforms add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.platform_post_types (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references marketing.platforms(id) on delete cascade,
  name text not null,
  code text not null,
  dimensions text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform_id,code)
);
-- Existing-table compatibility contract for marketing.platform_post_types.
alter table marketing.platform_post_types add column if not exists platform_id uuid references marketing.platforms(id) on delete cascade;
alter table marketing.platform_post_types add column if not exists name text;
alter table marketing.platform_post_types add column if not exists code text;
alter table marketing.platform_post_types add column if not exists dimensions text;
alter table marketing.platform_post_types add column if not exists is_active boolean not null default true;
alter table marketing.platform_post_types add column if not exists sort_order integer not null default 0;
alter table marketing.platform_post_types add column if not exists created_at timestamptz not null default now();
alter table marketing.platform_post_types add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.package_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.package_categories.
alter table marketing.package_categories add column if not exists name text;
alter table marketing.package_categories add column if not exists is_active boolean not null default true;
alter table marketing.package_categories add column if not exists sort_order integer not null default 0;
alter table marketing.package_categories add column if not exists created_at timestamptz not null default now();
alter table marketing.package_categories add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.request_statuses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_terminal boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.request_statuses.
alter table marketing.request_statuses add column if not exists code text;
alter table marketing.request_statuses add column if not exists name text;
alter table marketing.request_statuses add column if not exists is_terminal boolean not null default false;
alter table marketing.request_statuses add column if not exists is_active boolean not null default true;
alter table marketing.request_statuses add column if not exists sort_order integer not null default 0;
alter table marketing.request_statuses add column if not exists created_at timestamptz not null default now();
alter table marketing.request_statuses add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.campaigns (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  campaign_code text unique,
  name text not null,
  campaign_type text,
  objective text,
  status text not null default 'active',
  starts_at timestamptz,
  ends_at timestamptz,
  due_at timestamptz,
  created_by uuid references core.users(id),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_kind text not null default 'campaign',
  campaign_type_id uuid references marketing.campaign_types(id),
  campaign_date date,
  starts_on date,
  ends_on date,
  content_brief text,
  stage text not null default 'required',
  archived_at timestamptz,
  archived_by uuid references core.users(id),
  deleted_at timestamptz,
  deleted_by uuid references core.users(id),
  moved_to_publish_at timestamptz,
  raw_folders_created_at timestamptz,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb
);
-- Existing-table compatibility contract for marketing.campaigns.
alter table marketing.campaigns add column if not exists legacy_id text;
alter table marketing.campaigns add column if not exists campaign_code text;
alter table marketing.campaigns add column if not exists name text;
alter table marketing.campaigns add column if not exists campaign_type text;
alter table marketing.campaigns add column if not exists objective text;
alter table marketing.campaigns add column if not exists status text not null default 'active';
alter table marketing.campaigns add column if not exists starts_at timestamptz;
alter table marketing.campaigns add column if not exists ends_at timestamptz;
alter table marketing.campaigns add column if not exists due_at timestamptz;
alter table marketing.campaigns add column if not exists created_by uuid references core.users(id);
alter table marketing.campaigns add column if not exists is_deleted boolean not null default false;
alter table marketing.campaigns add column if not exists created_at timestamptz not null default now();
alter table marketing.campaigns add column if not exists updated_at timestamptz not null default now();
alter table marketing.campaigns add column if not exists source_kind text not null default 'campaign';
alter table marketing.campaigns add column if not exists campaign_type_id uuid references marketing.campaign_types(id);
alter table marketing.campaigns add column if not exists campaign_date date;
alter table marketing.campaigns add column if not exists starts_on date;
alter table marketing.campaigns add column if not exists ends_on date;
alter table marketing.campaigns add column if not exists content_brief text;
alter table marketing.campaigns add column if not exists stage text not null default 'required';
alter table marketing.campaigns add column if not exists archived_at timestamptz;
alter table marketing.campaigns add column if not exists archived_by uuid references core.users(id);
alter table marketing.campaigns add column if not exists deleted_at timestamptz;
alter table marketing.campaigns add column if not exists deleted_by uuid references core.users(id);
alter table marketing.campaigns add column if not exists moved_to_publish_at timestamptz;
alter table marketing.campaigns add column if not exists raw_folders_created_at timestamptz;
alter table marketing.campaigns add column if not exists idempotency_key text;
alter table marketing.campaigns add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists marketing_campaigns_idempotency_key on marketing.campaigns(idempotency_key) where idempotency_key is not null;
create index if not exists marketing_campaigns_kind_stage_idx on marketing.campaigns(source_kind,stage,created_at desc) where is_deleted=false;

create table if not exists marketing.creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_type text not null,
  quantity integer not null default 1,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  creative_type_id uuid references marketing.creative_types(id),
  instance_no text,
  short_code text,
  agenda_day date,
  content_due_at timestamptz,
  content_notes text,
  admin_notes text,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.creatives.
alter table marketing.creatives add column if not exists campaign_id uuid references marketing.campaigns(id) on delete cascade;
alter table marketing.creatives add column if not exists creative_type text;
alter table marketing.creatives add column if not exists quantity integer not null default 1;
alter table marketing.creatives add column if not exists status text not null default 'pending';
alter table marketing.creatives add column if not exists created_at timestamptz not null default now();
alter table marketing.creatives add column if not exists creative_type_id uuid references marketing.creative_types(id);
alter table marketing.creatives add column if not exists instance_no text;
alter table marketing.creatives add column if not exists short_code text;
alter table marketing.creatives add column if not exists agenda_day date;
alter table marketing.creatives add column if not exists content_due_at timestamptz;
alter table marketing.creatives add column if not exists content_notes text;
alter table marketing.creatives add column if not exists admin_notes text;
alter table marketing.creatives add column if not exists sort_order integer not null default 0;
alter table marketing.creatives add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table marketing.creatives add column if not exists updated_at timestamptz not null default now();
create unique index if not exists marketing_creatives_project_instance on marketing.creatives(campaign_id,instance_no);

create table if not exists marketing.instance_assignments (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  department_id uuid not null references marketing.departments(id),
  assigned_user_id uuid not null references core.users(id),
  content_writer_id uuid references core.users(id),
  assignment_role text not null check(assignment_role in ('content','primary','optional')),
  due_at timestamptz,
  notes text,
  is_optional boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.instance_assignments.
alter table marketing.instance_assignments add column if not exists creative_id uuid references marketing.creatives(id) on delete cascade;
alter table marketing.instance_assignments add column if not exists department_id uuid references marketing.departments(id);
alter table marketing.instance_assignments add column if not exists assigned_user_id uuid references core.users(id);
alter table marketing.instance_assignments add column if not exists content_writer_id uuid references core.users(id);
alter table marketing.instance_assignments add column if not exists assignment_role text;
alter table marketing.instance_assignments add column if not exists due_at timestamptz;
alter table marketing.instance_assignments add column if not exists notes text;
alter table marketing.instance_assignments add column if not exists is_optional boolean not null default false;
alter table marketing.instance_assignments add column if not exists created_at timestamptz not null default now();
alter table marketing.instance_assignments add column if not exists updated_at timestamptz not null default now();
create unique index if not exists marketing_instance_assignment_unique
on marketing.instance_assignments(creative_id,department_id,assigned_user_id,coalesce(content_writer_id,'00000000-0000-0000-0000-000000000000'::uuid),assignment_role);

create table if not exists marketing.instance_vehicles (
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  vehicle_id uuid not null references operations.vehicles(id),
  created_at timestamptz not null default now(),
  primary key(creative_id,vehicle_id)
);
-- Existing-table compatibility contract for marketing.instance_vehicles.
alter table marketing.instance_vehicles add column if not exists creative_id uuid references marketing.creatives(id) on delete cascade;
alter table marketing.instance_vehicles add column if not exists vehicle_id uuid references operations.vehicles(id);
alter table marketing.instance_vehicles add column if not exists created_at timestamptz not null default now();

create table if not exists marketing.budget_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid references marketing.creatives(id) on delete cascade,
  funnel text not null,
  platform_id uuid references marketing.platforms(id),
  amount numeric(14,2) not null default 0 check(amount>=0),
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ad_count integer not null default 1,
  content_goal text,
  expected_goal text
);
-- Existing-table compatibility contract for marketing.budget_items.
alter table marketing.budget_items add column if not exists campaign_id uuid references marketing.campaigns(id) on delete cascade;
alter table marketing.budget_items add column if not exists creative_id uuid references marketing.creatives(id) on delete cascade;
alter table marketing.budget_items add column if not exists funnel text;
alter table marketing.budget_items add column if not exists platform_id uuid references marketing.platforms(id);
alter table marketing.budget_items add column if not exists amount numeric(14,2) not null default 0;
alter table marketing.budget_items add column if not exists notes text;
alter table marketing.budget_items add column if not exists sort_order integer not null default 0;
alter table marketing.budget_items add column if not exists created_at timestamptz not null default now();
alter table marketing.budget_items add column if not exists updated_at timestamptz not null default now();
alter table marketing.budget_items add column if not exists ad_count integer not null default 1;
alter table marketing.budget_items add column if not exists content_goal text;
alter table marketing.budget_items add column if not exists expected_goal text;

create table if not exists marketing.publish_schedule (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  publish_date date not null,
  publish_time time,
  platform_id uuid not null references marketing.platforms(id),
  post_type_id uuid not null references marketing.platform_post_types(id),
  notes text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id,creative_id,publish_date,platform_id,post_type_id)
);
-- Existing-table compatibility contract for marketing.publish_schedule.
alter table marketing.publish_schedule add column if not exists campaign_id uuid references marketing.campaigns(id) on delete cascade;
alter table marketing.publish_schedule add column if not exists creative_id uuid references marketing.creatives(id) on delete cascade;
alter table marketing.publish_schedule add column if not exists publish_date date;
alter table marketing.publish_schedule add column if not exists publish_time time;
alter table marketing.publish_schedule add column if not exists platform_id uuid references marketing.platforms(id);
alter table marketing.publish_schedule add column if not exists post_type_id uuid references marketing.platform_post_types(id);
alter table marketing.publish_schedule add column if not exists notes text;
alter table marketing.publish_schedule add column if not exists status text not null default 'scheduled';
alter table marketing.publish_schedule add column if not exists created_at timestamptz not null default now();
alter table marketing.publish_schedule add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.tasks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid references marketing.creatives(id) on delete cascade,
  department_code text not null,
  assigned_to uuid references core.users(id),
  paired_content_user_id uuid references core.users(id),
  status text not null default 'required',
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  task_no text,
  task_kind text not null default 'execution',
  department_id uuid references marketing.departments(id),
  content_writer_id uuid references core.users(id),
  template_task_id uuid references marketing.tasks(id) on delete set null,
  received_at timestamptz,
  received_by uuid references core.users(id),
  progress numeric(5,2) not null default 0,
  review_status text,
  review_note text,
  template_data jsonb not null default '{}'::jsonb,
  final_asset_id uuid,
  final_file_name text,
  final_file_url text,
  metadata jsonb not null default '{}'::jsonb
);
-- Existing-table compatibility contract for marketing.tasks.
alter table marketing.tasks add column if not exists campaign_id uuid references marketing.campaigns(id) on delete cascade;
alter table marketing.tasks add column if not exists creative_id uuid references marketing.creatives(id) on delete cascade;
alter table marketing.tasks add column if not exists department_code text;
alter table marketing.tasks add column if not exists assigned_to uuid references core.users(id);
alter table marketing.tasks add column if not exists paired_content_user_id uuid references core.users(id);
alter table marketing.tasks add column if not exists status text not null default 'required';
alter table marketing.tasks add column if not exists due_at timestamptz;
alter table marketing.tasks add column if not exists completed_at timestamptz;
alter table marketing.tasks add column if not exists created_at timestamptz not null default now();
alter table marketing.tasks add column if not exists updated_at timestamptz not null default now();
alter table marketing.tasks add column if not exists task_no text;
alter table marketing.tasks add column if not exists task_kind text not null default 'execution';
alter table marketing.tasks add column if not exists department_id uuid references marketing.departments(id);
alter table marketing.tasks add column if not exists content_writer_id uuid references core.users(id);
alter table marketing.tasks add column if not exists template_task_id uuid references marketing.tasks(id) on delete set null;
alter table marketing.tasks add column if not exists received_at timestamptz;
alter table marketing.tasks add column if not exists received_by uuid references core.users(id);
alter table marketing.tasks add column if not exists progress numeric(5,2) not null default 0;
alter table marketing.tasks add column if not exists review_status text;
alter table marketing.tasks add column if not exists review_note text;
alter table marketing.tasks add column if not exists template_data jsonb not null default '{}'::jsonb;
alter table marketing.tasks add column if not exists final_asset_id uuid;
alter table marketing.tasks add column if not exists final_file_name text;
alter table marketing.tasks add column if not exists final_file_url text;
alter table marketing.tasks add column if not exists metadata jsonb not null default '{}'::jsonb;
create unique index if not exists marketing_tasks_task_no_unique on marketing.tasks(task_no) where task_no is not null;
create unique index if not exists marketing_template_task_unique
on marketing.tasks(creative_id,content_writer_id) where task_kind='template';
create unique index if not exists marketing_execution_task_unique
on marketing.tasks(creative_id,assigned_to,content_writer_id,department_id) where task_kind='execution';
create index if not exists marketing_tasks_assignee_status_idx on marketing.tasks(assigned_to,status,created_at desc);

create table if not exists marketing.task_action_progress (
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  action_id uuid not null references marketing.assignment_actions(id),
  completed boolean not null default false,
  completed_by uuid references core.users(id),
  completed_at timestamptz,
  note text,
  updated_at timestamptz not null default now(),
  primary key(task_id,action_id)
);
-- Existing-table compatibility contract for marketing.task_action_progress.
alter table marketing.task_action_progress add column if not exists task_id uuid references marketing.tasks(id) on delete cascade;
alter table marketing.task_action_progress add column if not exists action_id uuid references marketing.assignment_actions(id);
alter table marketing.task_action_progress add column if not exists completed boolean not null default false;
alter table marketing.task_action_progress add column if not exists completed_by uuid references core.users(id);
alter table marketing.task_action_progress add column if not exists completed_at timestamptz;
alter table marketing.task_action_progress add column if not exists note text;
alter table marketing.task_action_progress add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.task_uploads (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  upload_kind text not null check(upload_kind in ('template','template_revision','final','result','product')),
  file_name text not null,
  storage_key text,
  external_url text,
  mime_type text,
  file_size bigint,
  version_no integer not null default 1,
  status text not null default 'ready',
  uploaded_by uuid references core.users(id),
  uploaded_by_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.task_uploads.
alter table marketing.task_uploads add column if not exists task_id uuid references marketing.tasks(id) on delete cascade;
alter table marketing.task_uploads add column if not exists upload_kind text;
alter table marketing.task_uploads add column if not exists file_name text;
alter table marketing.task_uploads add column if not exists storage_key text;
alter table marketing.task_uploads add column if not exists external_url text;
alter table marketing.task_uploads add column if not exists mime_type text;
alter table marketing.task_uploads add column if not exists file_size bigint;
alter table marketing.task_uploads add column if not exists version_no integer not null default 1;
alter table marketing.task_uploads add column if not exists status text not null default 'ready';
alter table marketing.task_uploads add column if not exists uploaded_by uuid references core.users(id);
alter table marketing.task_uploads add column if not exists uploaded_by_name text;
alter table marketing.task_uploads add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table marketing.task_uploads add column if not exists created_at timestamptz not null default now();
create index if not exists marketing_task_uploads_task_idx on marketing.task_uploads(task_id,created_at desc);

create table if not exists marketing.task_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  action text not null check(action in ('submitted','approved','revision_requested','rejected')),
  note text,
  reviewer_id uuid references core.users(id),
  reviewer_name text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.task_reviews.
alter table marketing.task_reviews add column if not exists task_id uuid references marketing.tasks(id) on delete cascade;
alter table marketing.task_reviews add column if not exists action text;
alter table marketing.task_reviews add column if not exists note text;
alter table marketing.task_reviews add column if not exists reviewer_id uuid references core.users(id);
alter table marketing.task_reviews add column if not exists reviewer_name text;
alter table marketing.task_reviews add column if not exists snapshot jsonb not null default '{}'::jsonb;
alter table marketing.task_reviews add column if not exists created_at timestamptz not null default now();

create table if not exists marketing.project_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  platform_id uuid references marketing.platforms(id),
  url text not null,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.project_links.
alter table marketing.project_links add column if not exists campaign_id uuid references marketing.campaigns(id) on delete cascade;
alter table marketing.project_links add column if not exists platform_id uuid references marketing.platforms(id);
alter table marketing.project_links add column if not exists url text;
alter table marketing.project_links add column if not exists created_by uuid references core.users(id);
alter table marketing.project_links add column if not exists created_at timestamptz not null default now();

create table if not exists marketing.project_files (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  file_kind text not null check(file_kind in ('result','product','audit','schedule','other')),
  file_name text not null,
  storage_key text,
  external_url text,
  mime_type text,
  file_size bigint,
  uploaded_by uuid references core.users(id),
  uploaded_by_name text,
  created_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.project_files.
alter table marketing.project_files add column if not exists campaign_id uuid references marketing.campaigns(id) on delete cascade;
alter table marketing.project_files add column if not exists file_kind text;
alter table marketing.project_files add column if not exists file_name text;
alter table marketing.project_files add column if not exists storage_key text;
alter table marketing.project_files add column if not exists external_url text;
alter table marketing.project_files add column if not exists mime_type text;
alter table marketing.project_files add column if not exists file_size bigint;
alter table marketing.project_files add column if not exists uploaded_by uuid references core.users(id);
alter table marketing.project_files add column if not exists uploaded_by_name text;
alter table marketing.project_files add column if not exists created_at timestamptz not null default now();

create table if not exists marketing.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid references marketing.package_categories(id),
  price numeric(14,2) not null default 0,
  cash_discount_percent numeric(5,2) not null default 0,
  registration_fee numeric(14,2) not null default 0,
  insurance_fee numeric(14,2) not null default 0,
  issuance_fee numeric(14,2) not null default 0,
  care_items text[] not null default '{}',
  delivery_home boolean not null default false,
  delivery_region text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(name,category_id)
);
-- Existing-table compatibility contract for marketing.packages.
alter table marketing.packages add column if not exists name text;
alter table marketing.packages add column if not exists category_id uuid references marketing.package_categories(id);
alter table marketing.packages add column if not exists price numeric(14,2) not null default 0;
alter table marketing.packages add column if not exists cash_discount_percent numeric(5,2) not null default 0;
alter table marketing.packages add column if not exists registration_fee numeric(14,2) not null default 0;
alter table marketing.packages add column if not exists insurance_fee numeric(14,2) not null default 0;
alter table marketing.packages add column if not exists issuance_fee numeric(14,2) not null default 0;
alter table marketing.packages add column if not exists care_items text[] not null default '{}';
alter table marketing.packages add column if not exists delivery_home boolean not null default false;
alter table marketing.packages add column if not exists delivery_region text;
alter table marketing.packages add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table marketing.packages add column if not exists is_active boolean not null default true;
alter table marketing.packages add column if not exists created_by uuid references core.users(id);
alter table marketing.packages add column if not exists created_at timestamptz not null default now();
alter table marketing.packages add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.attendance_settings (
  id boolean primary key default true check (id = true),
  work_start_time time not null default '16:00',
  work_end_time time not null default '21:00',
  grace_minutes integer not null default 0,
  idle_after_minutes integer not null default 5,
  offline_after_minutes integer not null default 10,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.attendance_settings.
alter table marketing.attendance_settings add column if not exists work_start_time time not null default '16:00';
alter table marketing.attendance_settings add column if not exists work_end_time time not null default '21:00';
alter table marketing.attendance_settings add column if not exists grace_minutes integer not null default 0;
alter table marketing.attendance_settings add column if not exists idle_after_minutes integer not null default 5;
alter table marketing.attendance_settings add column if not exists offline_after_minutes integer not null default 10;
alter table marketing.attendance_settings add column if not exists updated_by uuid references core.users(id);
alter table marketing.attendance_settings add column if not exists updated_at timestamptz not null default now();
alter table marketing.attendance_settings alter column work_start_time set default '16:00';
alter table marketing.attendance_settings alter column work_end_time set default '21:00';
alter table marketing.attendance_settings alter column grace_minutes set default 0;
alter table marketing.attendance_settings alter column idle_after_minutes set default 5;
alter table marketing.attendance_settings alter column offline_after_minutes set default 10;
alter table marketing.attendance_settings alter column updated_at set default now();
update marketing.attendance_settings set work_start_time=coalesce(work_start_time,'16:00'::time), work_end_time=coalesce(work_end_time,'21:00'::time), grace_minutes=coalesce(grace_minutes,0), idle_after_minutes=coalesce(idle_after_minutes,5), offline_after_minutes=coalesce(offline_after_minutes,10), updated_at=coalesce(updated_at,now()) where work_start_time is null or work_end_time is null or grace_minutes is null or idle_after_minutes is null or offline_after_minutes is null or updated_at is null;
alter table marketing.attendance_settings alter column work_start_time set not null;
alter table marketing.attendance_settings alter column work_end_time set not null;
alter table marketing.attendance_settings alter column grace_minutes set not null;
alter table marketing.attendance_settings alter column idle_after_minutes set not null;
alter table marketing.attendance_settings alter column offline_after_minutes set not null;
alter table marketing.attendance_settings alter column updated_at set not null;
do $$
declare
  attendance_id_type text;
begin
  if not exists(select 1 from marketing.attendance_settings) then
    select udt_name into attendance_id_type
    from information_schema.columns
    where table_schema='marketing' and table_name='attendance_settings' and column_name='id';

    if attendance_id_type='bool' then
      insert into marketing.attendance_settings(id,work_start_time,work_end_time,grace_minutes,idle_after_minutes,offline_after_minutes,updated_at)
      values(true,'16:00'::time,'21:00'::time,0,5,10,now());
    elsif attendance_id_type in ('text','varchar','bpchar') then
      insert into marketing.attendance_settings(id,work_start_time,work_end_time,grace_minutes,idle_after_minutes,offline_after_minutes,updated_at)
      values('default','16:00'::time,'21:00'::time,0,5,10,now());
    else
      insert into marketing.attendance_settings(work_start_time,work_end_time,grace_minutes,idle_after_minutes,offline_after_minutes,updated_at)
      values('16:00'::time,'21:00'::time,0,5,10,now());
    end if;
  end if;
end $$;


create table if not exists marketing.attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  attendance_date date not null default current_date,
  check_in_at timestamptz,
  check_out_at timestamptz,
  status text not null default 'present',
  late_minutes integer not null default 0,
  work_minutes integer not null default 0,
  source text not null default 'marketing_system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,attendance_date)
);
-- Existing-table compatibility contract for marketing.attendance_records.
alter table marketing.attendance_records add column if not exists user_id uuid references core.users(id) on delete cascade;
alter table marketing.attendance_records add column if not exists attendance_date date not null default current_date;
alter table marketing.attendance_records add column if not exists check_in_at timestamptz;
alter table marketing.attendance_records add column if not exists check_out_at timestamptz;
alter table marketing.attendance_records add column if not exists status text not null default 'present';
alter table marketing.attendance_records add column if not exists late_minutes integer not null default 0;
alter table marketing.attendance_records add column if not exists work_minutes integer not null default 0;
alter table marketing.attendance_records add column if not exists source text not null default 'marketing_system';
alter table marketing.attendance_records add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table marketing.attendance_records add column if not exists created_at timestamptz not null default now();
alter table marketing.attendance_records add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.presence_status (
  user_id uuid primary key references core.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  last_page text,
  activity_type text,
  device_info jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.presence_status.
alter table marketing.presence_status add column if not exists last_seen_at timestamptz not null default now();
alter table marketing.presence_status add column if not exists last_activity_at timestamptz not null default now();
alter table marketing.presence_status add column if not exists last_page text;
alter table marketing.presence_status add column if not exists activity_type text;
alter table marketing.presence_status add column if not exists device_info jsonb not null default '{}'::jsonb;
alter table marketing.presence_status add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.attendance_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  request_type text not null,
  request_date date not null,
  note text,
  status text not null default 'pending',
  reviewed_by uuid references core.users(id),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.attendance_requests.
alter table marketing.attendance_requests add column if not exists user_id uuid references core.users(id) on delete cascade;
alter table marketing.attendance_requests add column if not exists request_type text;
alter table marketing.attendance_requests add column if not exists request_date date;
alter table marketing.attendance_requests add column if not exists note text;
alter table marketing.attendance_requests add column if not exists status text not null default 'pending';
alter table marketing.attendance_requests add column if not exists reviewed_by uuid references core.users(id);
alter table marketing.attendance_requests add column if not exists review_note text;
alter table marketing.attendance_requests add column if not exists created_at timestamptz not null default now();
alter table marketing.attendance_requests add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.platform_connections (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references marketing.platforms(id) on delete cascade,
  connection_status text not null default 'disconnected',
  account_name text,
  account_external_id text,
  token_status text,
  settings jsonb not null default '{}'::jsonb,
  connected_by uuid references core.users(id),
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(platform_id)
);
-- Existing-table compatibility contract for marketing.platform_connections.
alter table marketing.platform_connections add column if not exists platform_id uuid references marketing.platforms(id) on delete cascade;
alter table marketing.platform_connections add column if not exists connection_status text not null default 'disconnected';
alter table marketing.platform_connections add column if not exists account_name text;
alter table marketing.platform_connections add column if not exists account_external_id text;
alter table marketing.platform_connections add column if not exists token_status text;
alter table marketing.platform_connections add column if not exists settings jsonb not null default '{}'::jsonb;
alter table marketing.platform_connections add column if not exists connected_by uuid references core.users(id);
alter table marketing.platform_connections add column if not exists connected_at timestamptz;
alter table marketing.platform_connections add column if not exists updated_at timestamptz not null default now();

create table if not exists marketing.activity_log (
  id bigserial primary key,
  actor_id uuid references core.users(id),
  actor_name text,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- Existing-table compatibility contract for marketing.activity_log.
alter table marketing.activity_log add column if not exists actor_id uuid references core.users(id);
alter table marketing.activity_log add column if not exists actor_name text;
alter table marketing.activity_log add column if not exists action text;
alter table marketing.activity_log add column if not exists entity_type text;
alter table marketing.activity_log add column if not exists entity_id text;
alter table marketing.activity_log add column if not exists details jsonb not null default '{}'::jsonb;
alter table marketing.activity_log add column if not exists created_at timestamptz not null default now();
alter table marketing.activity_log alter column action drop default;
alter table marketing.activity_log alter column entity_type drop default;
alter table marketing.activity_log alter column entity_id drop default;
alter table marketing.activity_log alter column actor_name drop default;
alter table marketing.activity_log alter column details drop default;
do $$
declare
  column_type text;
begin
  select udt_name into column_type from information_schema.columns where table_schema='marketing' and table_name='activity_log' and column_name='action';
  if column_type is distinct from 'text' then execute 'alter table marketing.activity_log alter column action type text using action::text'; end if;
  select udt_name into column_type from information_schema.columns where table_schema='marketing' and table_name='activity_log' and column_name='entity_type';
  if column_type is distinct from 'text' then execute 'alter table marketing.activity_log alter column entity_type type text using entity_type::text'; end if;
  select udt_name into column_type from information_schema.columns where table_schema='marketing' and table_name='activity_log' and column_name='entity_id';
  if column_type is distinct from 'text' then execute 'alter table marketing.activity_log alter column entity_id type text using entity_id::text'; end if;
  select udt_name into column_type from information_schema.columns where table_schema='marketing' and table_name='activity_log' and column_name='actor_name';
  if column_type is distinct from 'text' then execute 'alter table marketing.activity_log alter column actor_name type text using actor_name::text'; end if;
  select udt_name into column_type from information_schema.columns where table_schema='marketing' and table_name='activity_log' and column_name='details';
  if column_type is distinct from 'jsonb' then execute 'alter table marketing.activity_log alter column details type jsonb using to_jsonb(details)'; end if;
end $$;
alter table marketing.activity_log alter column action set default 'legacy';
alter table marketing.activity_log alter column entity_type set default 'legacy';
alter table marketing.activity_log alter column details set default '{}'::jsonb;
alter table marketing.activity_log alter column created_at set default now();
update marketing.activity_log set action=coalesce(nullif(action,''),'legacy'), entity_type=coalesce(nullif(entity_type,''),'legacy'), details=coalesce(details,'{}'::jsonb), created_at=coalesce(created_at,now()) where action is null or action='' or entity_type is null or entity_type='' or details is null or created_at is null;
alter table marketing.activity_log alter column action set not null;
alter table marketing.activity_log alter column entity_type set not null;
alter table marketing.activity_log alter column details set not null;
alter table marketing.activity_log alter column created_at set not null;
create index if not exists marketing_activity_log_entity_idx on marketing.activity_log(entity_type,entity_id,created_at desc);

insert into marketing.departments(code,name,is_content_department,sort_order) values
('content','قسم المحتوى',true,10),
('design','قسم التصميم',false,20),
('photography','قسم التصوير',false,30),
('montage','قسم المونتاج',false,40),
('publishing','قسم النشر',false,50)
on conflict(code) do update set name=excluded.name,sort_order=excluded.sort_order;

insert into marketing.assignment_actions(department_id,name,percentage,audience,sort_order)
select d.id,v.name,v.percentage,v.audience,v.sort_order
from marketing.departments d
join (values
('content','رفع Task Template',100::numeric,'user',10),
('design','النسخة الأولى',50::numeric,'user',10),
('design','الاعتماد والتسليم',50::numeric,'user',20),
('photography','التصوير قبل الفلترة',50::numeric,'user',10),
('photography','اختيار اللقطات المناسبة',50::numeric,'user',20),
('montage','الإيديت',40::numeric,'user',10),
('montage','تجهيز مشاهد الذكاء الاصطناعي',20::numeric,'user',20),
('montage','فويـس أوفر',20::numeric,'user',30),
('montage','الهوك والتسليم',20::numeric,'user',40),
('publishing','التجهيز للنشر',50::numeric,'user',10),
('publishing','النشر والتوثيق',50::numeric,'user',20)
) as v(code,name,percentage,audience,sort_order) on v.code=d.code
on conflict(department_id,name) do nothing;

insert into marketing.creative_types(name,short_code,primary_department_id,sort_order)
select v.name,v.short_code,d.id,v.sort_order
from (values
('REEL - مواصفات كامله - STUDIO','M-RL-SPEC-ST','montage',10),
('REEL - اهم المواصفات - STUDIO','M-RL-TOP-ST','montage',20),
('REEL - SHORT/TREND - SHOWROOM','M-RL-TRD-SR','montage',30),
('REEL - UGC - SHOWROOM','M-RL-UGC-SR','montage',40),
('REEL - حملات - SHOWROOM','M-RL-CMP-SR','montage',50),
('REEL - معارضنا - SHOWROOM','M-RL-SHOW-SR','montage',60),
('REEL - تجربه عميل - SHOWROOM','M-RL-CUST-SR','montage',70),
('VIDEO - مواصفات - STUDIO','M-VD-SPEC-ST','montage',80),
('VIDEO - فيلم سياره - STUDIO','M-VD-CAR-ST','montage',90),
('VIDEO - فيلم - STUDIO','M-VD-FILM-ST','montage',100),
('VIDEO - مواصفات - SHOWROOM','M-VD-SPEC-SR','montage',110),
('VIDEO - فيلم - SHOWROOM','M-VD-FILM-SR','montage',120),
('VIDEO - معارضنا - SHOWROOM','M-VD-SHOW-SR','montage',130),
('POST','D-POST','design',210),
('CAROUSEL','D-CAROUSEL','design',220),
('PANNER','D-PANNER','design',230),
('MOTION','D-MOTION','design',240),
('GIF','D-GIF','design',250),
('PRINT','D-PRINT','design',260),
('MZJ-INTERIAL','D-INTERIAL','design',270),
('STORY - جاهزة الان - STUDIO','M-ST-READY-ST','design',280),
('STORY - سعرها اليوم - STUDIO','M-ST-PRICE-ST','design',290),
('STORY - قسطها الان - STUDIO','M-ST-INST-ST','design',300),
('STORY - معرضنا - SHOWROOM','M-ST-SHOW-SR','design',310),
('STORY - جاهزة الان - SHOWROOM','M-ST-READY-SR','design',320),
('STORY - سعرها اليوم - SHOWROOM','M-ST-PRICE-SR','design',330),
('STORY - قسطها الان - SHOWROOM','M-ST-INST-SR','design',340),
('تصوير صور السياره','P-CAR-PHOTO','photography',410),
('تصوير ريل - مواصفات - STUDIO','P-RL-SPEC-ST','photography',420),
('تصوير ريل - SHORT/TREND - SHOWROOM','P-RL-TRD-SR','photography',430),
('تصوير ريل - UGC - SHOWROOM','P-RL-UGC-SR','photography',440),
('تصوير ريل - معارضنا - SHOWROOM','P-RL-SHOW-SR','photography',450),
('تصوير ريل - تجربه عميل - SHOWROOM','P-RL-CUST-SR','photography',460),
('تصوير فيديو - مواصفات - STUDIO','P-VD-SPEC-ST','photography',470),
('تصوير فيديو - مواصفات - SHOWROOM','P-VD-SPEC-SR','photography',480),
('تصوير فيديو - معارضنا - SHOWROOM','P-VD-SHOW-SR','photography',490),
('تصوير ستوري - سياره - STUDIO','P-ST-CAR-ST','photography',500),
('تصوير ستوري - معرضنا - SHOWROOM','P-ST-SHOW-SR','photography',510)
) as v(name,short_code,department_code,sort_order)
join marketing.departments d on d.code=v.department_code
on conflict(name) do update set short_code=excluded.short_code,primary_department_id=excluded.primary_department_id,sort_order=excluded.sort_order;

insert into marketing.campaign_types(name,short_code,code_prefix,sort_order) values
('حملة تسويقية','CMP','MZJ',10),
('حملة عروض','OFR','MZJ',20),
('حملة إطلاق','LCH','MZJ',30),
('حملة توعوية','AWR','MZJ',40)
on conflict(name) do nothing;

insert into marketing.platforms(code,name,sort_order) values
('instagram','Instagram',10),
('snapchat','Snapchat',20),
('tiktok','TikTok',30),
('youtube','YouTube',40),
('whatsapp','حملات واتساب',50)
on conflict(code) do update set name=excluded.name,sort_order=excluded.sort_order;

insert into marketing.platform_post_types(platform_id,name,code,dimensions,sort_order)
select p.id,v.name,v.code,v.dimensions,v.sort_order from marketing.platforms p
join (values
('instagram','Reel / Video','reel','1080×1920',10),
('instagram','Story','story','1080×1920',20),
('instagram','Post','post','1080×1080',30),
('instagram','Carousel','carousel','1080×1080',40),
('snapchat','Story','story','1080×1920',10),
('snapchat','Spotlight / Video','video','1080×1920',20),
('tiktok','Video','video','1080×1920',10),
('youtube','Shorts / Video','shorts','1080×1920',10),
('youtube','Video','video','1920×1080',20),
('whatsapp','صورة','image','1080×1080',10),
('whatsapp','فيديو','video','1080×1920',20),
('whatsapp','رسالة','message',null,30)
) as v(platform_code,name,code,dimensions,sort_order) on v.platform_code=p.code
on conflict(platform_id,code) do update set name=excluded.name,dimensions=excluded.dimensions,sort_order=excluded.sort_order;

insert into marketing.package_categories(name,sort_order) values
('العائلية',10),('الفضية',20),('الذهبية',30),('VIP',40)
on conflict(name) do update set sort_order=excluded.sort_order;

insert into marketing.request_statuses(code,name,is_terminal,sort_order) values
('request_received','تم استلام الطلب',false,10),
('scheduled','تمت الجدولة',false,20),
('in_progress','قيد التنفيذ',false,30),
('completed','مكتمل',true,40),
('cancelled','ملغي',true,50)
on conflict(code) do update set name=excluded.name,is_terminal=excluded.is_terminal,sort_order=excluded.sort_order;

-- Runtime schema contract verification. Any missing column rolls back the whole migration.
do $$
declare
  missing_columns text;
begin
  select string_agg(format('marketing.%I.%I', expected.table_name, expected.column_name), ', ' order by expected.table_name, expected.column_name)
    into missing_columns
  from (values
      ('departments','id'),
      ('departments','code'),
      ('departments','name'),
      ('departments','is_content_department'),
      ('departments','is_active'),
      ('departments','sort_order'),
      ('departments','created_at'),
      ('departments','updated_at'),
      ('department_users','department_id'),
      ('department_users','user_id'),
      ('department_users','is_active'),
      ('department_users','created_at'),
      ('assignment_actions','id'),
      ('assignment_actions','department_id'),
      ('assignment_actions','name'),
      ('assignment_actions','percentage'),
      ('assignment_actions','audience'),
      ('assignment_actions','is_required'),
      ('assignment_actions','is_active'),
      ('assignment_actions','sort_order'),
      ('assignment_actions','created_at'),
      ('assignment_actions','updated_at'),
      ('creative_types','id'),
      ('creative_types','name'),
      ('creative_types','short_code'),
      ('creative_types','primary_department_id'),
      ('creative_types','is_active'),
      ('creative_types','sort_order'),
      ('creative_types','created_at'),
      ('creative_types','updated_at'),
      ('campaign_types','id'),
      ('campaign_types','name'),
      ('campaign_types','short_code'),
      ('campaign_types','code_prefix'),
      ('campaign_types','is_active'),
      ('campaign_types','sort_order'),
      ('campaign_types','next_number'),
      ('campaign_types','created_at'),
      ('campaign_types','updated_at'),
      ('platforms','id'),
      ('platforms','code'),
      ('platforms','name'),
      ('platforms','is_active'),
      ('platforms','sort_order'),
      ('platforms','created_at'),
      ('platforms','updated_at'),
      ('platform_post_types','id'),
      ('platform_post_types','platform_id'),
      ('platform_post_types','name'),
      ('platform_post_types','code'),
      ('platform_post_types','dimensions'),
      ('platform_post_types','is_active'),
      ('platform_post_types','sort_order'),
      ('platform_post_types','created_at'),
      ('platform_post_types','updated_at'),
      ('package_categories','id'),
      ('package_categories','name'),
      ('package_categories','is_active'),
      ('package_categories','sort_order'),
      ('package_categories','created_at'),
      ('package_categories','updated_at'),
      ('request_statuses','id'),
      ('request_statuses','code'),
      ('request_statuses','name'),
      ('request_statuses','is_terminal'),
      ('request_statuses','is_active'),
      ('request_statuses','sort_order'),
      ('request_statuses','created_at'),
      ('request_statuses','updated_at'),
      ('campaigns','id'),
      ('campaigns','legacy_id'),
      ('campaigns','campaign_code'),
      ('campaigns','name'),
      ('campaigns','campaign_type'),
      ('campaigns','objective'),
      ('campaigns','status'),
      ('campaigns','starts_at'),
      ('campaigns','ends_at'),
      ('campaigns','due_at'),
      ('campaigns','created_by'),
      ('campaigns','is_deleted'),
      ('campaigns','created_at'),
      ('campaigns','updated_at'),
      ('campaigns','source_kind'),
      ('campaigns','campaign_type_id'),
      ('campaigns','campaign_date'),
      ('campaigns','starts_on'),
      ('campaigns','ends_on'),
      ('campaigns','content_brief'),
      ('campaigns','stage'),
      ('campaigns','archived_at'),
      ('campaigns','archived_by'),
      ('campaigns','deleted_at'),
      ('campaigns','deleted_by'),
      ('campaigns','moved_to_publish_at'),
      ('campaigns','raw_folders_created_at'),
      ('campaigns','idempotency_key'),
      ('campaigns','metadata'),
      ('creatives','id'),
      ('creatives','campaign_id'),
      ('creatives','creative_type'),
      ('creatives','quantity'),
      ('creatives','status'),
      ('creatives','created_at'),
      ('creatives','creative_type_id'),
      ('creatives','instance_no'),
      ('creatives','short_code'),
      ('creatives','agenda_day'),
      ('creatives','content_due_at'),
      ('creatives','content_notes'),
      ('creatives','admin_notes'),
      ('creatives','sort_order'),
      ('creatives','metadata'),
      ('creatives','updated_at'),
      ('instance_assignments','id'),
      ('instance_assignments','creative_id'),
      ('instance_assignments','department_id'),
      ('instance_assignments','assigned_user_id'),
      ('instance_assignments','content_writer_id'),
      ('instance_assignments','assignment_role'),
      ('instance_assignments','due_at'),
      ('instance_assignments','notes'),
      ('instance_assignments','is_optional'),
      ('instance_assignments','created_at'),
      ('instance_assignments','updated_at'),
      ('instance_vehicles','creative_id'),
      ('instance_vehicles','vehicle_id'),
      ('instance_vehicles','created_at'),
      ('budget_items','id'),
      ('budget_items','campaign_id'),
      ('budget_items','creative_id'),
      ('budget_items','funnel'),
      ('budget_items','platform_id'),
      ('budget_items','amount'),
      ('budget_items','notes'),
      ('budget_items','sort_order'),
      ('budget_items','created_at'),
      ('budget_items','updated_at'),
      ('budget_items','ad_count'),
      ('budget_items','content_goal'),
      ('budget_items','expected_goal'),
      ('publish_schedule','id'),
      ('publish_schedule','campaign_id'),
      ('publish_schedule','creative_id'),
      ('publish_schedule','publish_date'),
      ('publish_schedule','publish_time'),
      ('publish_schedule','platform_id'),
      ('publish_schedule','post_type_id'),
      ('publish_schedule','notes'),
      ('publish_schedule','status'),
      ('publish_schedule','created_at'),
      ('publish_schedule','updated_at'),
      ('tasks','id'),
      ('tasks','campaign_id'),
      ('tasks','creative_id'),
      ('tasks','department_code'),
      ('tasks','assigned_to'),
      ('tasks','paired_content_user_id'),
      ('tasks','status'),
      ('tasks','due_at'),
      ('tasks','completed_at'),
      ('tasks','created_at'),
      ('tasks','updated_at'),
      ('tasks','task_no'),
      ('tasks','task_kind'),
      ('tasks','department_id'),
      ('tasks','content_writer_id'),
      ('tasks','template_task_id'),
      ('tasks','received_at'),
      ('tasks','received_by'),
      ('tasks','progress'),
      ('tasks','review_status'),
      ('tasks','review_note'),
      ('tasks','template_data'),
      ('tasks','final_asset_id'),
      ('tasks','final_file_name'),
      ('tasks','final_file_url'),
      ('tasks','metadata'),
      ('task_action_progress','task_id'),
      ('task_action_progress','action_id'),
      ('task_action_progress','completed'),
      ('task_action_progress','completed_by'),
      ('task_action_progress','completed_at'),
      ('task_action_progress','note'),
      ('task_action_progress','updated_at'),
      ('task_uploads','id'),
      ('task_uploads','task_id'),
      ('task_uploads','upload_kind'),
      ('task_uploads','file_name'),
      ('task_uploads','storage_key'),
      ('task_uploads','external_url'),
      ('task_uploads','mime_type'),
      ('task_uploads','file_size'),
      ('task_uploads','version_no'),
      ('task_uploads','status'),
      ('task_uploads','uploaded_by'),
      ('task_uploads','uploaded_by_name'),
      ('task_uploads','metadata'),
      ('task_uploads','created_at'),
      ('task_reviews','id'),
      ('task_reviews','task_id'),
      ('task_reviews','action'),
      ('task_reviews','note'),
      ('task_reviews','reviewer_id'),
      ('task_reviews','reviewer_name'),
      ('task_reviews','snapshot'),
      ('task_reviews','created_at'),
      ('project_links','id'),
      ('project_links','campaign_id'),
      ('project_links','platform_id'),
      ('project_links','url'),
      ('project_links','created_by'),
      ('project_links','created_at'),
      ('project_files','id'),
      ('project_files','campaign_id'),
      ('project_files','file_kind'),
      ('project_files','file_name'),
      ('project_files','storage_key'),
      ('project_files','external_url'),
      ('project_files','mime_type'),
      ('project_files','file_size'),
      ('project_files','uploaded_by'),
      ('project_files','uploaded_by_name'),
      ('project_files','created_at'),
      ('packages','id'),
      ('packages','name'),
      ('packages','category_id'),
      ('packages','price'),
      ('packages','cash_discount_percent'),
      ('packages','registration_fee'),
      ('packages','insurance_fee'),
      ('packages','issuance_fee'),
      ('packages','care_items'),
      ('packages','delivery_home'),
      ('packages','delivery_region'),
      ('packages','metadata'),
      ('packages','is_active'),
      ('packages','created_by'),
      ('packages','created_at'),
      ('packages','updated_at'),
      ('attendance_settings','id'),
      ('attendance_settings','work_start_time'),
      ('attendance_settings','work_end_time'),
      ('attendance_settings','grace_minutes'),
      ('attendance_settings','idle_after_minutes'),
      ('attendance_settings','offline_after_minutes'),
      ('attendance_settings','updated_by'),
      ('attendance_settings','updated_at'),
      ('attendance_records','id'),
      ('attendance_records','user_id'),
      ('attendance_records','attendance_date'),
      ('attendance_records','check_in_at'),
      ('attendance_records','check_out_at'),
      ('attendance_records','status'),
      ('attendance_records','late_minutes'),
      ('attendance_records','work_minutes'),
      ('attendance_records','source'),
      ('attendance_records','metadata'),
      ('attendance_records','created_at'),
      ('attendance_records','updated_at'),
      ('presence_status','user_id'),
      ('presence_status','last_seen_at'),
      ('presence_status','last_activity_at'),
      ('presence_status','last_page'),
      ('presence_status','activity_type'),
      ('presence_status','device_info'),
      ('presence_status','updated_at'),
      ('attendance_requests','id'),
      ('attendance_requests','user_id'),
      ('attendance_requests','request_type'),
      ('attendance_requests','request_date'),
      ('attendance_requests','note'),
      ('attendance_requests','status'),
      ('attendance_requests','reviewed_by'),
      ('attendance_requests','review_note'),
      ('attendance_requests','created_at'),
      ('attendance_requests','updated_at'),
      ('platform_connections','id'),
      ('platform_connections','platform_id'),
      ('platform_connections','connection_status'),
      ('platform_connections','account_name'),
      ('platform_connections','account_external_id'),
      ('platform_connections','token_status'),
      ('platform_connections','settings'),
      ('platform_connections','connected_by'),
      ('platform_connections','connected_at'),
      ('platform_connections','updated_at'),
      ('activity_log','id'),
      ('activity_log','actor_id'),
      ('activity_log','actor_name'),
      ('activity_log','action'),
      ('activity_log','entity_type'),
      ('activity_log','entity_id'),
      ('activity_log','details'),
      ('activity_log','created_at')
  ) as expected(table_name,column_name)
  left join information_schema.columns actual
    on actual.table_schema='marketing'
   and actual.table_name=expected.table_name
   and actual.column_name=expected.column_name
  where actual.column_name is null;

  if missing_columns is not null then
    raise exception 'Marketing schema contract is incomplete. Missing columns: %', missing_columns;
  end if;
end $$;

commit;
