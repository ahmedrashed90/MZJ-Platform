import { getSql, runSqlScript, withDatabaseAdvisoryLock } from "./_db.js";

let marketingSchemaPromise: Promise<void> | null = null;

export const MARKETING_SCHEMA_SQL = String.raw`begin;

create schema if not exists marketing_native;
create sequence if not exists marketing_native.project_code_seq;
create sequence if not exists marketing_native.task_no_seq;
create sequence if not exists marketing_native.photo_request_no_seq;

create table if not exists marketing_native.schema_meta (
  singleton boolean primary key default true check (singleton = true),
  schema_version integer not null,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into marketing_native.schema_meta(singleton,schema_version)
values(true,1200)
on conflict(singleton) do update set schema_version=excluded.schema_version,updated_at=now();

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

create table if not exists marketing_native.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_content_department boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists marketing_single_content_department
on marketing_native.departments((is_content_department)) where is_content_department=true and is_active=true;

create table if not exists marketing_native.department_users (
  department_id uuid not null references marketing_native.departments(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(department_id,user_id)
);

create table if not exists marketing_native.assignment_actions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references marketing_native.departments(id) on delete cascade,
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

create table if not exists marketing_native.creative_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_code text not null unique,
  primary_department_id uuid references marketing_native.departments(id),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing_native.campaign_types (
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

create table if not exists marketing_native.platforms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing_native.platform_post_types (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references marketing_native.platforms(id) on delete cascade,
  name text not null,
  code text not null,
  dimensions text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform_id,code)
);

create table if not exists marketing_native.package_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing_native.request_statuses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_terminal boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing_native.campaigns (
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
  campaign_type_id uuid references marketing_native.campaign_types(id),
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

create unique index if not exists marketing_campaigns_idempotency_key on marketing_native.campaigns(idempotency_key) where idempotency_key is not null;
create index if not exists marketing_campaigns_kind_stage_idx on marketing_native.campaigns(source_kind,stage,created_at desc) where is_deleted=false;

create table if not exists marketing_native.creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing_native.campaigns(id) on delete cascade,
  creative_type text not null,
  quantity integer not null default 1,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  creative_type_id uuid references marketing_native.creative_types(id),
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
create unique index if not exists marketing_creatives_project_instance on marketing_native.creatives(campaign_id,instance_no);

create table if not exists marketing_native.instance_assignments (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references marketing_native.creatives(id) on delete cascade,
  department_id uuid not null references marketing_native.departments(id),
  assigned_user_id uuid not null references core.users(id),
  content_writer_id uuid references core.users(id),
  assignment_role text not null check(assignment_role in ('content','primary','optional')),
  due_at timestamptz,
  notes text,
  is_optional boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists marketing_instance_assignment_unique
on marketing_native.instance_assignments(creative_id,department_id,assigned_user_id,coalesce(content_writer_id,'00000000-0000-0000-0000-000000000000'::uuid),assignment_role);

create table if not exists marketing_native.instance_vehicles (
  creative_id uuid not null references marketing_native.creatives(id) on delete cascade,
  vehicle_id uuid not null references operations.vehicles(id),
  created_at timestamptz not null default now(),
  primary key(creative_id,vehicle_id)
);

create table if not exists marketing_native.budget_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing_native.campaigns(id) on delete cascade,
  creative_id uuid references marketing_native.creatives(id) on delete cascade,
  funnel text not null,
  platform_id uuid references marketing_native.platforms(id),
  amount numeric(14,2) not null default 0 check(amount>=0),
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ad_count integer not null default 1,
  content_goal text,
  expected_goal text
);

create table if not exists marketing_native.publish_schedule (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing_native.campaigns(id) on delete cascade,
  creative_id uuid not null references marketing_native.creatives(id) on delete cascade,
  publish_date date not null,
  publish_time time,
  platform_id uuid not null references marketing_native.platforms(id),
  post_type_id uuid not null references marketing_native.platform_post_types(id),
  notes text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id,creative_id,publish_date,platform_id,post_type_id)
);

create table if not exists marketing_native.tasks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing_native.campaigns(id) on delete cascade,
  creative_id uuid references marketing_native.creatives(id) on delete cascade,
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
  department_id uuid references marketing_native.departments(id),
  content_writer_id uuid references core.users(id),
  template_task_id uuid references marketing_native.tasks(id) on delete set null,
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
create unique index if not exists marketing_tasks_task_no_unique on marketing_native.tasks(task_no) where task_no is not null;
create unique index if not exists marketing_template_task_unique
on marketing_native.tasks(creative_id,content_writer_id) where task_kind='template';
create unique index if not exists marketing_execution_task_unique
on marketing_native.tasks(creative_id,assigned_to,content_writer_id,department_id) where task_kind='execution';
create index if not exists marketing_tasks_assignee_status_idx on marketing_native.tasks(assigned_to,status,created_at desc);

create table if not exists marketing_native.task_action_progress (
  task_id uuid not null references marketing_native.tasks(id) on delete cascade,
  action_id uuid not null references marketing_native.assignment_actions(id),
  completed boolean not null default false,
  completed_by uuid references core.users(id),
  completed_at timestamptz,
  note text,
  updated_at timestamptz not null default now(),
  primary key(task_id,action_id)
);

create table if not exists marketing_native.task_uploads (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references marketing_native.tasks(id) on delete cascade,
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
create index if not exists marketing_task_uploads_task_idx on marketing_native.task_uploads(task_id,created_at desc);

create table if not exists marketing_native.task_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references marketing_native.tasks(id) on delete cascade,
  action text not null check(action in ('submitted','approved','revision_requested','rejected')),
  note text,
  reviewer_id uuid references core.users(id),
  reviewer_name text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists marketing_native.project_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing_native.campaigns(id) on delete cascade,
  platform_id uuid references marketing_native.platforms(id),
  url text not null,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now()
);

create table if not exists marketing_native.project_files (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing_native.campaigns(id) on delete cascade,
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

create table if not exists marketing_native.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid references marketing_native.package_categories(id),
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

create table if not exists marketing_native.attendance_settings (
  id text primary key default 'default' check (id = 'default'),
  work_start_time time not null default '16:00',
  work_end_time time not null default '21:00',
  grace_minutes integer not null default 0,
  idle_after_minutes integer not null default 5,
  offline_after_minutes integer not null default 10,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);
insert into marketing_native.attendance_settings(id) values('default') on conflict(id) do nothing;

create table if not exists marketing_native.attendance_records (
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

create table if not exists marketing_native.presence_status (
  user_id uuid primary key references core.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  last_page text,
  activity_type text,
  device_info jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists marketing_native.attendance_requests (
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

create table if not exists marketing_native.platform_connections (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references marketing_native.platforms(id) on delete cascade,
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

create table if not exists marketing_native.activity_log (
  id bigserial primary key,
  actor_id uuid references core.users(id),
  actor_name text,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists marketing_activity_log_entity_idx on marketing_native.activity_log(entity_type,entity_id,created_at desc);

insert into marketing_native.departments(code,name,is_content_department,sort_order) values
('content','قسم المحتوى',true,10),
('design','قسم التصميم',false,20),
('photography','قسم التصوير',false,30),
('montage','قسم المونتاج',false,40),
('publishing','قسم النشر',false,50)
on conflict do nothing;

insert into marketing_native.assignment_actions(department_id,name,percentage,audience,sort_order)
select d.id,v.name,v.percentage,v.audience,v.sort_order
from marketing_native.departments d
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
on conflict do nothing;

insert into marketing_native.creative_types(name,short_code,primary_department_id,sort_order)
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
join marketing_native.departments d on d.code=v.department_code
on conflict do nothing;

insert into marketing_native.campaign_types(name,short_code,code_prefix,sort_order) values
('حملة تسويقية','CMP','MZJ',10),
('حملة عروض','OFR','MZJ',20),
('حملة إطلاق','LCH','MZJ',30),
('حملة توعوية','AWR','MZJ',40)
on conflict do nothing;

insert into marketing_native.platforms(code,name,sort_order) values
('instagram','Instagram',10),
('snapchat','Snapchat',20),
('tiktok','TikTok',30),
('youtube','YouTube',40),
('whatsapp','حملات واتساب',50)
on conflict do nothing;

insert into marketing_native.platform_post_types(platform_id,name,code,dimensions,sort_order)
select p.id,v.name,v.code,v.dimensions,v.sort_order from marketing_native.platforms p
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
on conflict do nothing;

insert into marketing_native.package_categories(name,sort_order) values
('العائلية',10),('الفضية',20),('الذهبية',30),('VIP',40)
on conflict do nothing;

insert into marketing_native.request_statuses(code,name,is_terminal,sort_order) values
('request_received','تم استلام الطلب',false,10),
('scheduled','تمت الجدولة',false,20),
('in_progress','قيد التنفيذ',false,30),
('completed','مكتمل',true,40),
('cancelled','ملغي',true,50)
on conflict do nothing;

do $$
declare
  expected_table_count integer;
  schema_version_value integer;
begin
  select count(*) into expected_table_count
  from unnest(array[
    'schema_meta','departments','department_users','assignment_actions','creative_types','campaign_types',
    'platforms','platform_post_types','package_categories','request_statuses','campaigns','creatives',
    'instance_assignments','instance_vehicles','budget_items','publish_schedule','tasks','task_action_progress',
    'task_uploads','task_reviews','project_links','project_files','packages','attendance_settings',
    'attendance_records','presence_status','attendance_requests','platform_connections','activity_log'
  ]::text[]) as expected_table_name
  where to_regclass(format('marketing_native.%I', expected_table_name)) is not null;

  if expected_table_count <> 29 then
    raise exception 'marketing_native schema validation failed: expected 29 canonical tables, found %', expected_table_count;
  end if;


  select schema_version into schema_version_value
  from marketing_native.schema_meta
  where singleton=true;

  if schema_version_value is distinct from 1200 then
    raise exception 'marketing_native schema validation failed: schema version is %', schema_version_value;
  end if;

  if exists (
    select 1
    from marketing_native.platform_post_types pt
    left join marketing_native.platforms p on p.id=pt.platform_id
    where p.id is null
  ) then
    raise exception 'marketing_native schema validation failed: orphan platform_post_types rows';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class child on child.oid=c.conrelid
    join pg_namespace child_ns on child_ns.oid=child.relnamespace
    join pg_class parent on parent.oid=c.confrelid
    join pg_namespace parent_ns on parent_ns.oid=parent.relnamespace
    where c.contype='f'
      and child_ns.nspname='marketing_native'
      and child.relname='platform_post_types'
      and parent_ns.nspname='marketing_native'
      and parent.relname='platforms'
  ) then
    raise exception 'marketing_native schema validation failed: platform_post_types FK does not target marketing_native.platforms';
  end if;

  if exists (
    select 1
    from pg_constraint c
    join pg_class child on child.oid=c.conrelid
    join pg_namespace child_ns on child_ns.oid=child.relnamespace
    join pg_class parent on parent.oid=c.confrelid
    join pg_namespace parent_ns on parent_ns.oid=parent.relnamespace
    where c.contype='f'
      and child_ns.nspname='marketing_native'
      and parent_ns.nspname='marketing'
  ) then
    raise exception 'marketing_native schema validation failed: a foreign key still targets legacy marketing schema';
  end if;

  if (select count(*) from marketing_native.attendance_settings) <> 1
     or not exists (select 1 from marketing_native.attendance_settings where id='default') then
    raise exception 'marketing_native seed validation failed: attendance singleton is invalid';
  end if;
end $$;

commit;`;

async function marketingSchemaIsCurrent() {
  const sql = getSql();
  const [relation] = await sql<{ exists: boolean }[]>`select to_regclass('marketing_native.schema_meta') is not null as exists`;
  if (!relation?.exists) return false;
  try {
    const [state] = await sql<{ schema_version: number; table_count: number; platform_fk_ok: boolean; no_legacy_fk: boolean }[]>`
      select
        m.schema_version,
        (
          select count(*)::int
          from unnest(array[
            'schema_meta','departments','department_users','assignment_actions','creative_types','campaign_types',
            'platforms','platform_post_types','package_categories','request_statuses','campaigns','creatives',
            'instance_assignments','instance_vehicles','budget_items','publish_schedule','tasks','task_action_progress',
            'task_uploads','task_reviews','project_links','project_files','packages','attendance_settings',
            'attendance_records','presence_status','attendance_requests','platform_connections','activity_log'
          ]::text[]) as expected_table_name
          where to_regclass(format('marketing_native.%I', expected_table_name)) is not null
        ) as table_count,
        exists (
          select 1
          from pg_constraint c
          join pg_class child on child.oid=c.conrelid
          join pg_namespace child_ns on child_ns.oid=child.relnamespace
          join pg_class parent on parent.oid=c.confrelid
          join pg_namespace parent_ns on parent_ns.oid=parent.relnamespace
          where c.contype='f'
            and child_ns.nspname='marketing_native'
            and child.relname='platform_post_types'
            and parent_ns.nspname='marketing_native'
            and parent.relname='platforms'
        ) as platform_fk_ok,
        not exists (
          select 1
          from pg_constraint c
          join pg_class child on child.oid=c.conrelid
          join pg_namespace child_ns on child_ns.oid=child.relnamespace
          join pg_class parent on parent.oid=c.confrelid
          join pg_namespace parent_ns on parent_ns.oid=parent.relnamespace
          where c.contype='f'
            and child_ns.nspname='marketing_native'
            and parent_ns.nspname='marketing'
        ) as no_legacy_fk
      from marketing_native.schema_meta m
      where m.singleton=true
      limit 1
    `;
    return Number(state?.schema_version || 0) === 1200
      && Number(state?.table_count || 0) === 29
      && Boolean(state?.platform_fk_ok)
      && Boolean(state?.no_legacy_fk);
  } catch {
    return false;
  }
}

export async function ensureMarketingSchema() {
  if (!marketingSchemaPromise) {
    marketingSchemaPromise = (async () => {
      if (await marketingSchemaIsCurrent()) return;
      await withDatabaseAdvisoryLock("mzj:marketing-native-schema:v1200", async () => {
        if (await marketingSchemaIsCurrent()) return;
        await runSqlScript(MARKETING_SCHEMA_SQL);
      });
    })().catch((error) => {
      marketingSchemaPromise = null;
      throw error;
    });
  }
  return marketingSchemaPromise;
}
