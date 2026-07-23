-- MZJ Marketing native integration - additive schema only.
-- This migration never alters CRM, operations, tracking, or dashboard contracts.

create schema if not exists marketing;

alter table marketing.campaigns add column if not exists source_type text not null default 'campaign';
alter table marketing.campaigns add column if not exists content_brief text;
alter table marketing.campaigns add column if not exists request_date date;
alter table marketing.campaigns add column if not exists updated_by uuid references core.users(id);
alter table marketing.campaigns add column if not exists archived_at timestamptz;
alter table marketing.campaigns add column if not exists deleted_at timestamptz;
alter table marketing.campaigns add column if not exists version integer not null default 1;

alter table marketing.creatives add column if not exists catalog_creative_id uuid;
alter table marketing.creatives add column if not exists instance_no integer not null default 1;
alter table marketing.creatives add column if not exists instance_code text;
alter table marketing.creatives add column if not exists primary_department_code text;
alter table marketing.creatives add column if not exists quantity integer not null default 1;
alter table marketing.creatives add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table marketing.creatives add column if not exists updated_at timestamptz not null default now();

alter table marketing.tasks add column if not exists task_type text not null default 'execution';
alter table marketing.tasks add column if not exists pair_key text;
alter table marketing.tasks add column if not exists department_code text;
alter table marketing.tasks add column if not exists paired_content_user_id uuid references core.users(id);
alter table marketing.tasks add column if not exists depends_on_task_id uuid references marketing.tasks(id) on delete set null;
alter table marketing.tasks add column if not exists received_at timestamptz;
alter table marketing.tasks add column if not exists completed_at timestamptz;
alter table marketing.tasks add column if not exists requires_final_file boolean not null default false;
alter table marketing.tasks add column if not exists updated_by uuid references core.users(id);
alter table marketing.tasks add column if not exists lock_version integer not null default 1;
alter table marketing.tasks add column if not exists updated_at timestamptz not null default now();

create unique index if not exists marketing_task_pair_type_unique
  on marketing.tasks(campaign_id, creative_id, pair_key, task_type)
  where pair_key is not null;
create index if not exists marketing_campaign_status_due_idx on marketing.campaigns(status, due_at) where is_deleted = false;
create index if not exists marketing_creative_campaign_idx on marketing.creatives(campaign_id, instance_no);
create index if not exists marketing_task_assignee_status_idx on marketing.tasks(assigned_to, status, due_at);
create index if not exists marketing_task_campaign_department_idx on marketing.tasks(campaign_id, department_code, status);

create table if not exists marketing.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  is_secret boolean not null default false,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.campaign_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  prefix text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.campaign_counters (
  campaign_type_id uuid primary key references marketing.campaign_types(id) on delete cascade,
  year integer not null,
  current_value integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists marketing.creative_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  primary_department_code text not null,
  requires_final_file boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.platform_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.platform_post_types (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references marketing.platform_catalog(id) on delete cascade,
  code text not null,
  name text not null,
  dimensions text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  unique(platform_id, code)
);

create table if not exists marketing.funnels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists marketing.workflow_actions (
  id uuid primary key default gen_random_uuid(),
  department_code text not null,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  weight numeric(6,2) not null default 0,
  is_admin_only boolean not null default false,
  is_required boolean not null default true,
  is_active boolean not null default true,
  unique(department_code, code)
);

create table if not exists marketing.campaign_creative_content_users (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  user_id uuid not null references core.users(id),
  due_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique(creative_id, user_id)
);

create table if not exists marketing.campaign_creative_execution_assignments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  department_code text not null,
  user_id uuid not null references core.users(id),
  notes text,
  created_at timestamptz not null default now(),
  unique(creative_id, department_code, user_id)
);

create table if not exists marketing.assignment_writer_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  execution_assignment_id uuid not null references marketing.campaign_creative_execution_assignments(id) on delete cascade,
  content_user_id uuid not null references core.users(id),
  writer_due_at timestamptz,
  notes text,
  pair_key text not null,
  created_at timestamptz not null default now(),
  unique(execution_assignment_id, content_user_id),
  unique(pair_key)
);

create table if not exists marketing.creative_vehicle_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  operations_vehicle_id uuid references operations.vehicles(id) on delete set null,
  inventory_identity text,
  vehicle_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(creative_id, operations_vehicle_id)
);

create table if not exists marketing.campaign_budget_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid references marketing.creatives(id) on delete set null,
  funnel_id uuid references marketing.funnels(id) on delete set null,
  ads_count integer not null default 1,
  content_goal text,
  expected_target text,
  row_total numeric(14,2) not null default 0,
  sort_order integer not null default 0
);

create table if not exists marketing.campaign_budget_platforms (
  id uuid primary key default gen_random_uuid(),
  budget_item_id uuid not null references marketing.campaign_budget_items(id) on delete cascade,
  platform_id uuid not null references marketing.platform_catalog(id),
  amount numeric(14,2) not null default 0,
  unique(budget_item_id, platform_id)
);

create table if not exists marketing.publish_schedule_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  publish_at timestamptz not null,
  notes text,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.publish_schedule_targets (
  id uuid primary key default gen_random_uuid(),
  schedule_item_id uuid not null references marketing.publish_schedule_items(id) on delete cascade,
  platform_id uuid not null references marketing.platform_catalog(id),
  post_type_id uuid not null references marketing.platform_post_types(id),
  dimensions text,
  unique(schedule_item_id, platform_id, post_type_id)
);

create table if not exists marketing.agendas (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references marketing.campaigns(id) on delete cascade,
  month_key text not null,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.task_templates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references marketing.tasks(id) on delete cascade,
  approved_version_id uuid,
  status text not null default 'pending_template',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.task_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references marketing.task_templates(id) on delete cascade,
  version_no integer not null,
  original_file_key text,
  original_file_name text,
  mime_type text,
  file_size bigint,
  parsed_data jsonb not null default '{}'::jsonb,
  submitted_by uuid references core.users(id),
  submitted_at timestamptz not null default now(),
  unique(template_id, version_no)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='marketing_task_templates_approved_version_fk') then
    alter table marketing.task_templates
      add constraint marketing_task_templates_approved_version_fk
      foreign key (approved_version_id) references marketing.task_template_versions(id) on delete set null
      not valid;
  end if;
end $$;

create table if not exists marketing.task_template_reviews (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references marketing.task_templates(id) on delete cascade,
  version_id uuid not null references marketing.task_template_versions(id) on delete cascade,
  decision text not null,
  notes text,
  field_notes jsonb not null default '{}'::jsonb,
  reviewed_by uuid not null references core.users(id),
  reviewed_at timestamptz not null default now()
);

create table if not exists marketing.task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  file_role text not null,
  storage_key text not null,
  original_name text not null,
  mime_type text,
  file_size bigint,
  checksum text,
  uploaded_by uuid references core.users(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists marketing.task_actions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  action_code text not null,
  name text not null,
  sort_order integer not null,
  weight numeric(6,2) not null default 0,
  is_admin_only boolean not null default false,
  is_required boolean not null default true,
  status text not null default 'pending',
  completed_by uuid references core.users(id),
  completed_at timestamptz,
  unique(task_id, action_code)
);

create table if not exists marketing.task_action_events (
  id bigserial primary key,
  task_action_id uuid not null references marketing.task_actions(id) on delete cascade,
  event_type text not null,
  note text,
  actor_id uuid references core.users(id),
  created_at timestamptz not null default now()
);

create table if not exists marketing.publish_prep_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  source_task_id uuid not null unique references marketing.tasks(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  final_file_id uuid references marketing.task_files(id) on delete set null,
  approved_template_version_id uuid references marketing.task_template_versions(id) on delete set null,
  caption text,
  hashtags text,
  status text not null default 'draft',
  schedule_identity text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.publish_targets (
  id uuid primary key default gen_random_uuid(),
  publish_prep_item_id uuid not null references marketing.publish_prep_items(id) on delete cascade,
  platform_id uuid not null references marketing.platform_catalog(id),
  post_type_id uuid references marketing.platform_post_types(id),
  publish_at timestamptz,
  status text not null default 'draft',
  idempotency_key text not null unique,
  external_id text,
  external_url text,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists marketing.publish_attempts (
  id bigserial primary key,
  target_id uuid not null references marketing.publish_targets(id) on delete cascade,
  attempt_no integer not null,
  status text not null,
  response_summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(target_id, attempt_no)
);

create table if not exists marketing.platform_connections (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references marketing.platform_catalog(id),
  account_id text,
  account_name text,
  connection_status text not null default 'disconnected',
  environment text not null default 'production',
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  capabilities jsonb not null default '{}'::jsonb,
  last_refresh_at timestamptz,
  last_error text,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now(),
  unique(platform_id, account_id)
);

create table if not exists marketing.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  price numeric(14,2) not null default 0,
  cash_discount_percent numeric(6,2) not null default 0,
  registration_included boolean not null default false,
  insurance_included boolean not null default false,
  issuance_included boolean not null default false,
  care_features text[] not null default '{}',
  delivery_type text,
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.attendance_settings (
  id boolean primary key default true check (id),
  work_start time not null default '16:00',
  work_end time not null default '21:00',
  grace_minutes integer not null default 15,
  heartbeat_seconds integer not null default 60,
  offline_after_minutes integer not null default 10,
  idle_after_minutes integer not null default 5,
  timezone text not null default 'Asia/Riyadh',
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id),
  work_date date not null,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  late_minutes integer not null default 0,
  work_minutes integer not null default 0,
  source text,
  device_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, work_date)
);

create table if not exists marketing.presence (
  user_id uuid primary key references core.users(id) on delete cascade,
  state text not null default 'offline',
  last_seen_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists marketing.photography_requests (
  id uuid primary key default gen_random_uuid(),
  operations_vehicle_id uuid references operations.vehicles(id) on delete set null,
  campaign_id uuid references marketing.campaigns(id) on delete set null,
  creative_id uuid references marketing.creatives(id) on delete set null,
  status text not null default 'requested',
  notes text,
  requested_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.checklist_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vehicle_name text,
  platform_code text,
  post_type_code text,
  dimensions text,
  project_data jsonb not null default '{}'::jsonb,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.publisher_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now()
);

insert into marketing.attendance_settings(id) values (true) on conflict (id) do nothing;

insert into marketing.campaign_types(code,name,prefix,sort_order) values
('awareness','حملة توعوية','AW',10),
('sales','حملة مبيعات','SL',20),
('seasonal','حملة موسمية','SN',30),
('agenda','أجندة محتوى','AG',40)
on conflict (code) do update set name=excluded.name,prefix=excluded.prefix,is_active=true;

insert into marketing.creative_catalog(code,name,primary_department_code,requires_final_file,sort_order) values
('post','بوست','design',true,10),
('reel','ريل','montage',true,20),
('story','ستوري','design',true,30),
('photography','تصوير','photography',true,40),
('content','محتوى نصي','content',false,50)
on conflict (code) do update set name=excluded.name,primary_department_code=excluded.primary_department_code,is_active=true;

insert into marketing.platform_catalog(code,name,sort_order,capabilities) values
('facebook','Facebook',10,'{"publish":true}'::jsonb),
('instagram','Instagram',20,'{"publish":true}'::jsonb),
('tiktok','TikTok',30,'{"publish":false,"state":"sandbox_under_review"}'::jsonb),
('youtube','YouTube',40,'{"publish":true}'::jsonb),
('snapchat','Snapchat',50,'{"publish":false,"state":"waiting_allowlist"}'::jsonb),
('whatsapp','WhatsApp / Mersal',60,'{"publish":true,"video":false}'::jsonb)
on conflict (code) do update set name=excluded.name,capabilities=excluded.capabilities,is_active=true;

insert into marketing.funnels(code,name,sort_order) values
('awareness','وعي',10),('consideration','اهتمام',20),('conversion','تحويل',30),('retention','احتفاظ',40)
on conflict (code) do update set name=excluded.name,is_active=true;

insert into core.departments(code,name,system_code) values
('content','قسم المحتوى','marketing'),
('design','قسم التصميم','marketing'),
('montage','قسم المونتاج','marketing'),
('photography','قسم التصوير','marketing')
on conflict (code) do update set name=excluded.name,system_code=excluded.system_code,is_active=true;

insert into core.permissions(code,name,system_code) values
('marketing.view','دخول نظام التسويق','marketing'),
('marketing.dashboard.view','عرض لوحة التسويق','marketing'),
('marketing.campaigns.view','عرض الحملات','marketing'),
('marketing.campaigns.manage','إدارة الحملات','marketing'),
('marketing.campaigns.release','تحرير الحملات للنشر','marketing'),
('marketing.agendas.view','عرض الأجندات','marketing'),
('marketing.agendas.manage','إدارة الأجندات','marketing'),
('marketing.tasks.view','عرض مهام التسويق','marketing'),
('marketing.tasks.work','تنفيذ مهام التسويق','marketing'),
('marketing.tasks.review','مراجعة مهام التسويق','marketing'),
('marketing.tasks.admin_actions','تنفيذ الإجراءات الإدارية','marketing'),
('marketing.publish_prep.view','عرض تجهيز النشر','marketing'),
('marketing.publish_prep.manage','إدارة تجهيز النشر','marketing'),
('marketing.publish.execute','تنفيذ النشر','marketing'),
('marketing.platforms.manage','إدارة ربط المنصات','marketing'),
('marketing.catalog.manage','إدارة كتالوج التسويق','marketing'),
('marketing.packages.manage','إدارة الباقات','marketing'),
('marketing.attendance.self','الحضور الشخصي','marketing'),
('marketing.attendance.manage','إدارة الحضور','marketing'),
('marketing.stock.view','عرض استوك التسويق','marketing'),
('marketing.stock.manage_shoot','إدارة طلبات التصوير','marketing'),
('marketing.reports.view','عرض تقارير التسويق','marketing'),
('marketing.reports.export','تصدير تقارير التسويق','marketing'),
('marketing.checklist.use','استخدام Checklist','marketing'),
('marketing.checklist.manage','إدارة Checklist','marketing'),
('marketing.settings.manage','إدارة إعدادات التسويق','marketing'),
('marketing.publisher_agent.manage','إدارة أجهزة النشر المحلي','marketing')
on conflict (code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code in ('admin','system_admin') and p.system_code='marketing'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in (
  'marketing.view','marketing.dashboard.view','marketing.campaigns.view','marketing.agendas.view',
  'marketing.tasks.view','marketing.tasks.work','marketing.publish_prep.view','marketing.attendance.self',
  'marketing.stock.view','marketing.checklist.use'
)
where r.code='marketing_user'
on conflict do nothing;

insert into marketing.platform_post_types(platform_id,code,name,dimensions,sort_order)
select id,'post','Post','1080x1080',10 from marketing.platform_catalog where code in ('facebook','instagram')
on conflict (platform_id,code) do update set name=excluded.name,dimensions=excluded.dimensions,is_active=true;
insert into marketing.platform_post_types(platform_id,code,name,dimensions,sort_order)
select id,'reel','Reel','1080x1920',20 from marketing.platform_catalog where code in ('facebook','instagram')
on conflict (platform_id,code) do update set name=excluded.name,dimensions=excluded.dimensions,is_active=true;
insert into marketing.platform_post_types(platform_id,code,name,dimensions,sort_order)
select id,'story','Story','1080x1920',30 from marketing.platform_catalog where code in ('facebook','instagram','snapchat')
on conflict (platform_id,code) do update set name=excluded.name,dimensions=excluded.dimensions,is_active=true;
insert into marketing.platform_post_types(platform_id,code,name,dimensions,sort_order)
select id,'video','Video','1920x1080',10 from marketing.platform_catalog where code='youtube'
on conflict (platform_id,code) do update set name=excluded.name,dimensions=excluded.dimensions,is_active=true;
insert into marketing.platform_post_types(platform_id,code,name,dimensions,sort_order)
select id,'short','Short','1080x1920',20 from marketing.platform_catalog where code='youtube'
on conflict (platform_id,code) do update set name=excluded.name,dimensions=excluded.dimensions,is_active=true;
insert into marketing.platform_post_types(platform_id,code,name,dimensions,sort_order)
select id,'video','Video','1080x1920',10 from marketing.platform_catalog where code='tiktok'
on conflict (platform_id,code) do update set name=excluded.name,dimensions=excluded.dimensions,is_active=true;
insert into marketing.platform_post_types(platform_id,code,name,dimensions,sort_order)
select id,'text','Text','',10 from marketing.platform_catalog where code='whatsapp'
on conflict (platform_id,code) do update set name=excluded.name,dimensions=excluded.dimensions,is_active=true;
insert into marketing.platform_post_types(platform_id,code,name,dimensions,sort_order)
select id,'image','Image','1080x1080',20 from marketing.platform_catalog where code='whatsapp'
on conflict (platform_id,code) do update set name=excluded.name,dimensions=excluded.dimensions,is_active=true;

insert into marketing.workflow_actions(department_code,code,name,sort_order,weight,is_admin_only,is_required) values
('design','receive','استلام المهمة',10,10,false,true),('design','execute','تنفيذ التصميم',20,70,false,true),('design','review','المراجعة النهائية',30,20,true,true),
('montage','receive','استلام المهمة',10,10,false,true),('montage','execute','تنفيذ المونتاج',20,70,false,true),('montage','review','المراجعة النهائية',30,20,true,true),
('photography','receive','استلام المهمة',10,10,false,true),('photography','execute','تنفيذ التصوير',20,70,false,true),('photography','review','المراجعة النهائية',30,20,true,true)
on conflict (department_code,code) do update set name=excluded.name,sort_order=excluded.sort_order,weight=excluded.weight,is_admin_only=excluded.is_admin_only,is_required=excluded.is_required,is_active=true;
