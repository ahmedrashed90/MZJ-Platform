begin;

-- Canonical clean rebuild for the marketing schema.
-- The previous incomplete marketing migrations used incompatible table shapes
-- (most notably marketing.publish_jobs). Because marketing has not gone live yet,
-- this migration rebuilds the isolated marketing schema from one source of truth.
-- It refuses to delete real marketing business data.
do $marketing_rebuild_guard$
declare
  business_rows bigint := 0;
  current_rows bigint := 0;
begin
  if to_regclass('marketing.campaigns') is not null then
    execute 'select count(*) from marketing.campaigns' into current_rows;
    business_rows := business_rows + current_rows;
  end if;

  if to_regclass('marketing.tasks') is not null then
    execute 'select count(*) from marketing.tasks' into current_rows;
    business_rows := business_rows + current_rows;
  end if;

  if to_regclass('marketing.photography_requests') is not null then
    execute 'select count(*) from marketing.photography_requests' into current_rows;
    business_rows := business_rows + current_rows;
  end if;

  if business_rows > 0 then
    raise exception 'Marketing rebuild stopped: existing business data was found (% rows). Take a backup and migrate that data before rebuilding the marketing schema.', business_rows;
  end if;
end
$marketing_rebuild_guard$;

drop schema if exists marketing cascade;
create schema marketing;
create sequence marketing.campaign_code_seq;
create sequence marketing.photography_request_no_seq;

create table marketing.campaigns (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  campaign_code text unique,
  name text not null,
  campaign_type text,
  objective text,
  status text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  due_at timestamptz,
  created_by uuid references core.users(id),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table marketing.creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_type text not null,
  quantity integer not null default 1,
  status text not null,
  created_at timestamptz not null default now()
);

create table marketing.tasks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid references marketing.creatives(id) on delete cascade,
  department_code text not null,
  assigned_to uuid references core.users(id),
  paired_content_user_id uuid references core.users(id),
  status text not null,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Remove permissions belonging to the two explicitly excluded features.
delete from core.role_permissions
where permission_id in (
  select id from core.permissions
  where code in ('marketing.checklist.use','marketing.checklist.manage','marketing.publisher_agent.manage')
);

delete from core.permissions
where code in ('marketing.checklist.use','marketing.checklist.manage','marketing.publisher_agent.manage');

insert into core.permissions(code,name,system_code) values
('marketing.view','عرض نظام التسويق','marketing'),
('marketing.dashboard.view','عرض لوحة تحكم التسويق','marketing'),
('marketing.campaigns.view','عرض الحملات والأجندة','marketing'),
('marketing.campaigns.manage','إنشاء وتعديل الحملات والأجندة','marketing'),
('marketing.campaigns.release','تحرير الحملات للنشر','marketing'),
('marketing.tasks.view','عرض مهام التسويق','marketing'),
('marketing.tasks.work','تنفيذ مهام التسويق','marketing'),
('marketing.tasks.review','مراجعة واعتماد مهام التسويق','marketing'),
('marketing.tasks.admin_actions','تنفيذ إجراءات الأدمن على المهام','marketing'),
('marketing.publish_prep.view','عرض تجهيز النشر','marketing'),
('marketing.publish_prep.manage','إدارة تجهيز النشر','marketing'),
('marketing.platforms.manage','إدارة ربط منصات النشر','marketing'),
('marketing.packages.manage','إدارة باقات التسويق','marketing'),
('marketing.attendance.self','تسجيل الحضور والانصراف','marketing'),
('marketing.attendance.manage','إدارة حضور فريق التسويق','marketing'),
('marketing.stock.view','عرض استوك التسويق','marketing'),
('marketing.photography_requests.create','إنشاء طلبات التصوير','marketing'),
('marketing.photography_requests.manage','إدارة ومتابعة طلبات التصوير','marketing'),
('marketing.reports.view','عرض تقارير التسويق','marketing'),
('marketing.reports.export','تصدير تقارير التسويق','marketing'),
('marketing.settings.manage','إدارة إعدادات التسويق','marketing')
on conflict (code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code in ('admin','system_admin') and p.system_code='marketing'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in (
  'marketing.view','marketing.dashboard.view','marketing.campaigns.view','marketing.tasks.view',
  'marketing.tasks.work','marketing.publish_prep.view','marketing.attendance.self','marketing.stock.view',
  'marketing.photography_requests.create','marketing.reports.view'
) where r.code='marketing_user'
on conflict do nothing;

create table if not exists marketing.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.campaign_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  prefix text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.campaign_counters (
  campaign_type_id uuid primary key references marketing.campaign_types(id) on delete cascade,
  counter integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists marketing.content_sections (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists marketing.creative_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_code text not null,
  primary_department_code text not null,
  content_section_id uuid references marketing.content_sections(id),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(name,primary_department_code)
);

create table if not exists marketing.funnels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists marketing.order_statuses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists marketing.platform_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  icon text,
  status text not null default 'disconnected',
  capability_state text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
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
  unique(platform_id,code)
);

create table if not exists marketing.department_mappings (
  department_code text primary key,
  display_name text not null,
  short_code text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists marketing.department_members (
  department_code text not null references marketing.department_mappings(department_code) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key(department_code,user_id)
);

create table if not exists marketing.workflow_actions (
  id uuid primary key default gen_random_uuid(),
  department_code text not null,
  name text not null,
  sort_order integer not null default 0,
  weight numeric(6,2) not null default 0,
  is_admin_only boolean not null default false,
  is_required boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(department_code,name)
);

create table if not exists marketing.agendas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  month_key text not null,
  publish_start_date date not null,
  publish_end_date date not null,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

alter table marketing.campaigns add column if not exists source_type text not null default 'campaign';
alter table marketing.campaigns add column if not exists agenda_id uuid references marketing.agendas(id);
alter table marketing.campaigns add column if not exists campaign_type_id uuid references marketing.campaign_types(id);
alter table marketing.campaigns add column if not exists campaign_date date not null default current_date;
alter table marketing.campaigns add column if not exists publish_start_date date;
alter table marketing.campaigns add column if not exists publish_end_date date;
alter table marketing.campaigns add column if not exists content_brief text;
alter table marketing.campaigns add column if not exists structure_deadline date;
alter table marketing.campaigns add column if not exists progress_percent numeric(6,2) not null default 0;
alter table marketing.campaigns add column if not exists released_at timestamptz;
alter table marketing.campaigns add column if not exists archived_at timestamptz;
alter table marketing.campaigns add column if not exists updated_by uuid references core.users(id);
alter table marketing.campaigns add column if not exists version integer not null default 1;
create index if not exists marketing_campaigns_status_date_idx on marketing.campaigns(status,is_deleted,publish_start_date,publish_end_date);
create index if not exists marketing_campaigns_source_idx on marketing.campaigns(source_type,agenda_id);

alter table marketing.creatives add column if not exists catalog_creative_id uuid references marketing.creative_catalog(id);
alter table marketing.creatives add column if not exists instance_no integer not null default 1;
alter table marketing.creatives add column if not exists instance_code text;
alter table marketing.creatives add column if not exists creative_name text;
alter table marketing.creatives add column if not exists primary_department_code text;
alter table marketing.creatives add column if not exists notes text;
alter table marketing.creatives add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table marketing.creatives add column if not exists updated_at timestamptz not null default now();
create unique index if not exists marketing_creatives_instance_unique on marketing.creatives(campaign_id,instance_no);
create index if not exists marketing_creatives_campaign_idx on marketing.creatives(campaign_id,status);

create table if not exists marketing.creative_assignments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  department_code text not null,
  execution_user_id uuid not null references core.users(id),
  content_user_id uuid not null references core.users(id),
  pair_key text not null,
  due_date date,
  writer_due_date date,
  department_note text,
  content_note text,
  created_at timestamptz not null default now(),
  unique(creative_id,department_code,execution_user_id,content_user_id),
  unique(pair_key)
);

create table if not exists marketing.creative_vehicle_links (
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  vehicle_id uuid not null references operations.vehicles(id),
  vin_snapshot text not null,
  car_name_snapshot text,
  statement_snapshot text,
  exterior_color_snapshot text,
  interior_color_snapshot text,
  model_year_snapshot text,
  location_snapshot text,
  created_at timestamptz not null default now(),
  primary key(creative_id,vehicle_id)
);

alter table marketing.tasks add column if not exists task_code text;
alter table marketing.tasks add column if not exists task_type text not null default 'execution';
alter table marketing.tasks add column if not exists pair_key text;
alter table marketing.tasks add column if not exists title text;
alter table marketing.tasks add column if not exists assignment_id uuid references marketing.creative_assignments(id) on delete cascade;
alter table marketing.tasks add column if not exists depends_on_task_id uuid references marketing.tasks(id);
alter table marketing.tasks add column if not exists progress_percent numeric(6,2) not null default 0;
alter table marketing.tasks add column if not exists received_at timestamptz;
alter table marketing.tasks add column if not exists requires_final_file boolean not null default false;
alter table marketing.tasks add column if not exists workflow_snapshot jsonb not null default '[]'::jsonb;
alter table marketing.tasks add column if not exists review_status text;
alter table marketing.tasks add column if not exists user_completed_at timestamptz;
alter table marketing.tasks add column if not exists created_by uuid references core.users(id);
alter table marketing.tasks add column if not exists updated_by uuid references core.users(id);
alter table marketing.tasks add column if not exists version integer not null default 1;
create unique index if not exists marketing_tasks_pair_type_unique on marketing.tasks(pair_key,task_type) where pair_key is not null;
create index if not exists marketing_tasks_assignee_status_idx on marketing.tasks(assigned_to,status,due_at);
create index if not exists marketing_tasks_campaign_idx on marketing.tasks(campaign_id,department_code,task_type);

create table if not exists marketing.task_action_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  action_code text not null,
  action_name text not null,
  action_order integer not null,
  weight numeric(6,2) not null default 0,
  is_admin_only boolean not null default false,
  is_required boolean not null default true,
  is_completed boolean not null default false,
  completed_by uuid references core.users(id),
  completed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique(task_id,action_order)
);

create table if not exists marketing.task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  file_kind text not null,
  file_name text not null,
  storage_key text not null,
  mime_type text,
  file_size bigint,
  checksum text,
  uploaded_by uuid references core.users(id),
  uploaded_at timestamptz not null default now(),
  is_active boolean not null default true
);

create table if not exists marketing.task_template_versions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  version_no integer not null,
  source_file_id uuid references marketing.task_files(id),
  status text not null default 'submitted',
  parsed_data jsonb not null default '{}'::jsonb,
  submitted_by uuid references core.users(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references core.users(id),
  reviewed_at timestamptz,
  review_note text,
  unique(task_id,version_no)
);

create table if not exists marketing.campaign_budget_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  funnel_id uuid references marketing.funnels(id),
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  ads_count integer not null default 1,
  content_goal text,
  expected_target text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists marketing.campaign_budget_platforms (
  id uuid primary key default gen_random_uuid(),
  budget_item_id uuid not null references marketing.campaign_budget_items(id) on delete cascade,
  platform_id uuid not null references marketing.platform_catalog(id),
  amount numeric(14,2) not null default 0,
  unique(budget_item_id,platform_id)
);

create table if not exists marketing.publish_schedule_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  publish_date date not null,
  caption text,
  hashtags text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.publish_schedule_targets (
  id uuid primary key default gen_random_uuid(),
  schedule_item_id uuid not null references marketing.publish_schedule_items(id) on delete cascade,
  platform_id uuid not null references marketing.platform_catalog(id),
  post_type_id uuid not null references marketing.platform_post_types(id),
  publish_time time,
  dimensions text,
  status text not null default 'draft',
  unique(schedule_item_id,platform_id,post_type_id)
);

create table if not exists marketing.publish_prep_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  source_task_id uuid not null references marketing.tasks(id) on delete cascade,
  approved_template_version_id uuid references marketing.task_template_versions(id),
  final_file_id uuid references marketing.task_files(id),
  caption text,
  hashtags text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_task_id)
);

alter table marketing.publish_prep_items add column if not exists recipients text[] not null default '{}';
alter table marketing.publish_prep_items add column if not exists use_saved_contacts boolean not null default false;

create table if not exists marketing.publish_targets (
  id uuid primary key default gen_random_uuid(),
  publish_prep_item_id uuid not null references marketing.publish_prep_items(id) on delete cascade,
  platform_id uuid not null references marketing.platform_catalog(id),
  post_type_id uuid references marketing.platform_post_types(id),
  scheduled_at timestamptz,
  status text not null default 'draft',
  published_url text,
  external_id text,
  error_message text,
  idempotency_key text unique,
  updated_at timestamptz not null default now()
);

create table if not exists marketing.platform_connections (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references marketing.platform_catalog(id),
  status text not null default 'disconnected',
  mode text not null default 'production',
  account_id text,
  account_name text,
  profile_id text,
  scopes text[] not null default '{}',
  access_token_encrypted text,
  refresh_token_encrypted text,
  expires_at timestamptz,
  last_refreshed_at timestamptz,
  last_error text,
  connected_by uuid references core.users(id),
  updated_at timestamptz not null default now(),
  unique(platform_id)
);

create table if not exists marketing.oauth_states (
  id uuid primary key default gen_random_uuid(),
  platform_code text not null,
  state_hash text not null unique,
  user_id uuid not null references core.users(id) on delete cascade,
  redirect_uri text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists marketing_oauth_states_lookup_idx on marketing.oauth_states(platform_code,state_hash,expires_at) where used_at is null;

create table if not exists marketing.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references marketing.publish_targets(id) on delete cascade,
  idempotency_key text not null,
  status text not null default 'publishing',
  requested_by uuid references core.users(id),
  external_id text,
  published_url text,
  error_message text,
  response_summary jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_publish_jobs_target_idx on marketing.publish_jobs(target_id,created_at desc);
create unique index if not exists marketing_publish_jobs_success_once_idx on marketing.publish_jobs(target_id,idempotency_key) where status='published';

create table if not exists marketing.publish_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references marketing.publish_jobs(id) on delete cascade,
  target_id uuid not null references marketing.publish_targets(id) on delete cascade,
  attempt_no integer not null default 1,
  status text not null,
  response_summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  unique(job_id,attempt_no)
);


create table if not exists marketing.whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  phone_normalized text not null unique,
  phone_display text not null,
  name text,
  source_file text,
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_whatsapp_contacts_active_idx on marketing.whatsapp_contacts(is_active,updated_at desc);

create table if not exists marketing.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  price numeric(14,2) not null default 0,
  cash_discount_percent numeric(6,2) not null default 0,
  includes_registration boolean not null default false,
  includes_insurance boolean not null default false,
  includes_issuance boolean not null default false,
  care_features text[] not null default '{}',
  delivery_type text not null default 'home',
  is_archived boolean not null default false,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.attendance_settings (
  id boolean primary key default true check(id=true),
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
insert into marketing.attendance_settings(id) values(true) on conflict(id) do nothing;

create table if not exists marketing.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id),
  work_date date not null,
  checked_in_at timestamptz not null,
  checked_out_at timestamptz,
  late_minutes integer not null default 0,
  work_minutes integer not null default 0,
  check_in_source text,
  check_out_source text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,work_date)
);

create table if not exists marketing.presence (
  user_id uuid primary key references core.users(id) on delete cascade,
  status text not null default 'offline',
  last_seen_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  user_agent text,
  updated_at timestamptz not null default now()
);

alter table operations.transfer_requests add column if not exists request_kind text not null default 'transfer';
alter table operations.transfer_requests add column if not exists photography_date date;
alter table operations.transfer_requests add column if not exists photography_location text;
alter table operations.transfer_requests add column if not exists marketing_campaign_id uuid;

do $marketing_transfer_request_fk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'operations.transfer_requests'::regclass
      and conname = 'operations_transfer_requests_marketing_campaign_fk'
  ) then
    alter table operations.transfer_requests
      add constraint operations_transfer_requests_marketing_campaign_fk
      foreign key (marketing_campaign_id)
      references marketing.campaigns(id)
      on delete set null;
  end if;
end
$marketing_transfer_request_fk$;
create index if not exists operations_photography_requests_idx on operations.transfer_requests(request_kind,photography_date,status) where is_deleted=false;

insert into marketing.campaign_types(name,prefix,sort_order) values
('حملة تسويقية','CMP',10),('حملة عروض','OFF',20),('حملة إطلاق','LCH',30),('أجندة شهرية','AGN',40)
on conflict(name) do update set prefix=excluded.prefix,sort_order=excluded.sort_order,is_active=true;

insert into marketing.content_sections(code,name,sort_order) values
('general','محتوى عام',10),('sales','محتوى مبيعات',20),('offers','العروض',30),('branding','الهوية والعلامة',40)
on conflict(code) do update set name=excluded.name,sort_order=excluded.sort_order,is_active=true;

insert into marketing.department_mappings(department_code,display_name,short_code,sort_order) values
('content','قسم المحتوى','CONTENT',10),('montage','قسم المونتاج','MONTAGE',20),('photography','قسم التصوير','PHOTO',30),('design','قسم التصميم','DESIGN',40),('publishing','قسم النشر','PUBLISH',50)
on conflict(department_code) do update set display_name=excluded.display_name,short_code=excluded.short_code,sort_order=excluded.sort_order,is_active=true;

insert into marketing.funnels(name,sort_order) values
('وعي',10),('تفاعل',20),('زيارات',30),('عملاء محتملون',40),('مبيعات',50)
on conflict(name) do update set sort_order=excluded.sort_order,is_active=true;

insert into marketing.platform_catalog(code,name,icon,status,capability_state,sort_order) values
('facebook','Facebook','f','disconnected','available',10),
('instagram','Instagram','◎','disconnected','available',20),
('tiktok','TikTok','♪','sandbox_under_review','sandbox_under_review',30),
('youtube','YouTube','▶','disconnected','available',40),
('snapchat','Snapchat','👻','waiting_allowlist','waiting_allowlist',50),
('whatsapp','WhatsApp / مرسال','◉','disconnected','available',60)
on conflict(code) do update set name=excluded.name,icon=excluded.icon,capability_state=excluded.capability_state,sort_order=excluded.sort_order,is_active=true;

with p as (select id,code from marketing.platform_catalog)
insert into marketing.platform_post_types(platform_id,code,name,dimensions,sort_order)
select p.id,x.code,x.name,x.dimensions,x.sort_order from p join (values
('facebook','post','بوست','1080x1080',10),('facebook','reel','ريل','1080x1920',20),('facebook','story','ستوري','1080x1920',30),
('instagram','post','بوست','1080x1080',10),('instagram','carousel','كاروسيل','1080x1080',20),('instagram','reel','ريل','1080x1920',30),('instagram','story','ستوري','1080x1920',40),
('tiktok','video','فيديو','1080x1920',10),
('youtube','video','فيديو','1920x1080',10),('youtube','short','Short','1080x1920',20),
('snapchat','story','Story','1080x1920',10),('snapchat','spotlight','Spotlight','1080x1920',20),
('whatsapp','image','صورة','1080x1080',10),('whatsapp','video','فيديو','1080x1920',20)
) as x(platform_code,code,name,dimensions,sort_order) on x.platform_code=p.code
on conflict(platform_id,code) do update set name=excluded.name,dimensions=excluded.dimensions,sort_order=excluded.sort_order,is_active=true;

insert into marketing.creative_catalog(name,short_code,primary_department_code,sort_order) values
('REEL - معارضنا - SHOWROOM','REEL-SHOWROOM','montage',10),
('REEL - أهم المواصفات - STUDIO','REEL-SPECS','montage',20),
('VIDEO','VIDEO','montage',30),
('POST','POST','design',40),
('CAROUSEL','CAROUSEL','design',50),
('PANNER','PANNER','design',60),
('MOTION','MOTION','design',70),
('تصوير سيارات','PHOTO','photography',80)
on conflict(name,primary_department_code) do update set short_code=excluded.short_code,sort_order=excluded.sort_order,is_active=true;

insert into marketing.workflow_actions(department_code,name,sort_order,weight,is_admin_only,is_required) values
('montage','استلام التاسك',10,10,false,true),('montage','تنفيذ المونتاج الأولي',20,35,false,true),('montage','اعتماد المراجعة الأولى',30,15,true,true),('montage','تنفيذ التعديلات',40,25,false,true),('montage','الاعتماد النهائي',50,15,true,true),
('photography','استلام طلب التصوير',10,10,false,true),('photography','تنفيذ التصوير',20,45,false,true),('photography','اعتماد اللقطات الأولى',30,15,true,true),('photography','استكمال المطلوب',40,15,false,true),('photography','الاعتماد النهائي',50,15,true,true),
('design','استلام التاسك',10,15,false,true),('design','تنفيذ التصميم',20,55,false,true),('design','الاعتماد النهائي',30,30,true,true),
('publishing','استلام تجهيز النشر',10,20,false,true),('publishing','مراجعة النص والمنصات',20,30,false,true),('publishing','اعتماد النشر',30,50,true,true)
on conflict(department_code,name) do update set sort_order=excluded.sort_order,weight=excluded.weight,is_admin_only=excluded.is_admin_only,is_required=excluded.is_required,is_active=true;

insert into marketing.settings(key,value) values
('publishing',jsonb_build_object('enabled',false,'timezone','Asia/Riyadh','defaultHour','18:00','facebookHour','18:00','instagramHour','18:00','tiktokHour','18:00','youtubeHour','18:00','snapchatHour','18:00','whatsappHour','18:00','youtubePrivacy','unlisted')),
('mersal',jsonb_build_object('endpoint','','imageTemplate','mzj_image_campaign','videoTemplate','mzj_video_campaign','language','ar')),
('ownerColors','{}'::jsonb)
on conflict(key) do nothing;

commit;
