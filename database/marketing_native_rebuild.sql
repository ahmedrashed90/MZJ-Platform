begin;

create table if not exists operations.photography_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text unique,
  status text not null default 'request_received',
  requested_by uuid references core.users(id),
  requested_by_name text,
  requested_by_branch text,
  requested_at timestamptz not null default now(),
  photography_date date,
  note text,
  is_deleted boolean not null default false,
  completed_at timestamptz,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);
alter table operations.photography_requests add column if not exists updated_by uuid references core.users(id);
alter table operations.photography_requests add column if not exists updated_at timestamptz not null default now();
create table if not exists operations.photography_request_vehicles (
  request_id uuid not null references operations.photography_requests(id) on delete cascade,
  vehicle_id uuid not null references operations.vehicles(id),
  primary key(request_id,vehicle_id)
);
create table if not exists operations.photography_request_updates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references operations.photography_requests(id) on delete cascade,
  old_status text,
  new_status text not null,
  photography_date date,
  note text,
  changed_by uuid references core.users(id),
  changed_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists operations_photography_requests_status_idx on operations.photography_requests(status,requested_at desc);
create index if not exists operations_photography_vehicle_idx on operations.photography_request_vehicles(vehicle_id);
create index if not exists operations_photography_updates_idx on operations.photography_request_updates(request_id,created_at desc);

drop schema if exists marketing cascade;
create schema marketing;

create sequence if not exists marketing.task_no_seq start 1;

create table if not exists marketing.campaign_code_counters (
  base_code text primary key,
  last_sequence integer not null default 0 check(last_sequence >= 0),
  updated_at timestamptz not null default now()
);


create table if not exists marketing.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  is_content boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.department_users (
  department_id uuid not null references marketing.departments(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (department_id,user_id)
);

create table if not exists marketing.assignment_actions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references marketing.departments(id) on delete cascade,
  name text not null,
  progress_percent numeric(5,2) not null check(progress_percent >= 0 and progress_percent <= 100),
  admin_only boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(department_id,name)
);

create table if not exists marketing.creative_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_code text not null unique,
  primary_department_id uuid not null references marketing.departments(id),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.campaign_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code_prefix text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.funnels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.platforms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
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
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform_id,name)
);

create table if not exists marketing.request_statuses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  is_terminal boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists marketing.package_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.campaigns (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check(source_kind in ('campaign','agenda')),
  idempotency_key text not null unique,
  campaign_code text not null unique,
  name text not null,
  campaign_type_id uuid references marketing.campaign_types(id),
  campaign_date date,
  publish_start_date date not null,
  publish_end_date date not null,
  objective text,
  content_brief text,
  status text not null default 'draft',
  workflow_stage text not null default 'required',
  result_storage_key text,
  result_file_name text,
  raw_folders jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  archived_by uuid references core.users(id),
  deleted_at timestamptz,
  deleted_by uuid references core.users(id),
  created_by uuid not null references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(publish_end_date >= publish_start_date)
);
create index if not exists marketing_campaigns_kind_status_idx on marketing.campaigns(source_kind,status,workflow_stage,created_at desc);

create table if not exists marketing.agenda_days (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  agenda_date date not null,
  sort_order integer not null default 0,
  unique(campaign_id,agenda_date)
);

create table if not exists marketing.creative_instances (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  agenda_day_id uuid references marketing.agenda_days(id) on delete cascade,
  creative_id uuid not null references marketing.creative_catalog(id),
  sequence_no integer not null,
  instance_code text not null,
  content_received_date date,
  content_notes text,
  is_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id,instance_code)
);
create index if not exists marketing_instances_campaign_idx on marketing.creative_instances(campaign_id,sequence_no);

create table if not exists marketing.instance_content_writers (
  instance_id uuid not null references marketing.creative_instances(id) on delete cascade,
  user_id uuid not null references core.users(id),
  due_date date,
  notes text,
  primary key(instance_id,user_id)
);

create table if not exists marketing.instance_departments (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references marketing.creative_instances(id) on delete cascade,
  department_id uuid not null references marketing.departments(id),
  is_primary boolean not null default false,
  due_date date,
  notes text,
  created_at timestamptz not null default now(),
  unique(instance_id,department_id)
);

create table if not exists marketing.instance_assignments (
  id uuid primary key default gen_random_uuid(),
  instance_department_id uuid not null references marketing.instance_departments(id) on delete cascade,
  executive_user_id uuid not null references core.users(id),
  content_writer_id uuid not null references core.users(id),
  due_date date,
  created_at timestamptz not null default now(),
  unique(instance_department_id,executive_user_id,content_writer_id)
);

create table if not exists marketing.instance_vehicles (
  instance_id uuid not null references marketing.creative_instances(id) on delete cascade,
  vehicle_id uuid not null references operations.vehicles(id),
  primary key(instance_id,vehicle_id)
);

create table if not exists marketing.instance_platform_posts (
  instance_id uuid not null references marketing.creative_instances(id) on delete cascade,
  platform_id uuid not null references marketing.platforms(id),
  post_type_id uuid not null references marketing.platform_post_types(id),
  primary key(instance_id,platform_id,post_type_id)
);

create table if not exists marketing.budget_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  funnel_id uuid references marketing.funnels(id),
  instance_id uuid not null references marketing.creative_instances(id),
  ads_count integer not null default 0,
  content_goal text,
  expected_goal text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists marketing.budget_platform_values (
  budget_item_id uuid not null references marketing.budget_items(id) on delete cascade,
  platform_id uuid not null references marketing.platforms(id),
  amount numeric(14,2) not null default 0 check(amount >= 0),
  primary key(budget_item_id,platform_id)
);

create table if not exists marketing.publish_schedule_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  publish_date date not null,
  instance_id uuid not null references marketing.creative_instances(id),
  created_at timestamptz not null default now(),
  unique(campaign_id,publish_date,instance_id)
);

create table if not exists marketing.publish_schedule_posts (
  schedule_item_id uuid not null references marketing.publish_schedule_items(id) on delete cascade,
  platform_id uuid not null references marketing.platforms(id),
  post_type_id uuid not null references marketing.platform_post_types(id),
  primary key(schedule_item_id,platform_id,post_type_id)
);

create table if not exists marketing.tasks (
  id uuid primary key default gen_random_uuid(),
  task_no text not null unique,
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  instance_id uuid not null references marketing.creative_instances(id) on delete cascade,
  task_kind text not null check(task_kind in ('template','execution')),
  department_id uuid not null references marketing.departments(id),
  assigned_to uuid not null references core.users(id),
  content_writer_id uuid not null references core.users(id),
  template_task_id uuid references marketing.tasks(id),
  assignment_id uuid references marketing.instance_assignments(id),
  status text not null default 'new',
  progress numeric(5,2) not null default 0 check(progress >= 0 and progress <= 100),
  due_date date,
  actual_received_at timestamptz,
  completed_at timestamptz,
  admin_note text,
  rejection_reason text,
  final_storage_key text,
  final_file_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(instance_id,task_kind,assigned_to,content_writer_id,department_id)
);
create index if not exists marketing_tasks_user_status_idx on marketing.tasks(assigned_to,status,due_date);
create index if not exists marketing_tasks_campaign_idx on marketing.tasks(campaign_id,department_id,task_kind);

create table if not exists marketing.task_action_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  source_action_id uuid references marketing.assignment_actions(id),
  name text not null,
  progress_percent numeric(5,2) not null,
  admin_only boolean not null default false,
  sort_order integer not null default 0,
  completed_at timestamptz,
  completed_by uuid references core.users(id),
  unique(task_id,name)
);

create table if not exists marketing.template_submissions (
  id uuid primary key default gen_random_uuid(),
  template_task_id uuid not null references marketing.tasks(id) on delete cascade,
  version_no integer not null,
  storage_key text,
  file_name text,
  template_data jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending',
  review_note text,
  submitted_by uuid not null references core.users(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references core.users(id),
  reviewed_at timestamptz,
  unique(template_task_id,version_no)
);

create table if not exists marketing.campaign_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  platform_id uuid not null references marketing.platforms(id),
  url text not null,
  created_by uuid not null references core.users(id),
  created_at timestamptz not null default now(),
  unique(campaign_id,platform_id,url)
);

create table if not exists marketing.car_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid not null references marketing.package_categories(id),
  price numeric(14,2) not null default 0,
  cash_discount_percent numeric(5,2) not null default 0,
  registration_fee boolean not null default false,
  insurance boolean not null default false,
  issuance_fee boolean not null default false,
  car_care_lines text[] not null default '{}',
  delivery_type text not null default 'home' check(delivery_type in ('home','region')),
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.platform_connections (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references marketing.platforms(id),
  account_name text,
  account_external_id text,
  connection_status text not null default 'disconnected',
  metadata jsonb not null default '{}'::jsonb,
  connected_by uuid references core.users(id),
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(platform_id,account_external_id)
);

create table if not exists marketing.attendance_settings (
  id boolean primary key default true,
  work_start time not null default '09:00',
  work_end time not null default '17:00',
  late_after_minutes integer not null default 0,
  work_days integer[] not null default '{0,1,2,3,4}',
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now(),
  check(id=true)
);
insert into marketing.attendance_settings(id) values(true) on conflict(id) do nothing;

create table if not exists marketing.attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id),
  attendance_date date not null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  last_activity_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,attendance_date)
);

create table if not exists marketing.activity_log (
  id bigserial primary key,
  user_id uuid references core.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

insert into core.permissions(code,name,system_code) values
('marketing.view','عرض نظام التسويق','marketing'),
('marketing.manage','إدارة الحملات والأجندات','marketing'),
('marketing.settings.manage','إدارة إعدادات التسويق','marketing'),
('marketing.templates.review','مراجعة Task Template','marketing'),
('marketing.tasks.execute','تنفيذ تاسكات التسويق','marketing'),
('marketing.packages.manage','إدارة الباقات','marketing'),
('marketing.requests.manage','متابعة طلبات التصوير','marketing')
on conflict(code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code in ('admin','system_admin') and p.system_code='marketing'
on conflict do nothing;

insert into marketing.departments(code,name,is_content,sort_order) values
('content','قسم المحتوى',true,10),
('design','قسم التصميم',false,20),
('photography','قسم التصوير',false,30),
('montage','قسم المونتاج',false,40),
('publishing','قسم النشر',false,50)
on conflict(code) do update set name=excluded.name,is_content=excluded.is_content,sort_order=excluded.sort_order;

insert into marketing.campaign_types(name,code_prefix,sort_order) values
('حملة بيعية','MZJ-SALES',10),
('حملة إعادة نشر','MZJ-REPOST',20),
('حملة توعوية','MZJ-AWARE',30)
on conflict(name) do nothing;

insert into marketing.funnels(name,sort_order) values
('Awareness',10),('Conversion Message',20),('Leads',30)
on conflict(name) do nothing;

insert into marketing.platforms(code,name,sort_order) values
('snapchat','Snapchat',10),('tv','TV',20),('instagram','انستجرام',30),('tiktok','تيك توك',40),('google','جوجل',50),('whatsapp','حملات واتساب',60),('facebook','فيس بوك',70),('linkedin','لينكد ان',80),('youtube','يوتيوب',90)
on conflict(code) do update set name=excluded.name,sort_order=excluded.sort_order;

insert into marketing.platform_post_types(platform_id,name,width,height,sort_order)
select p.id,v.name,v.width,v.height,v.sort_order
from marketing.platforms p join (values
('snapchat','Story',1080,1920,10),('snapchat','Spotlight',1080,1920,20),
('instagram','بوست صور',1080,1080,10),('instagram','ريل',1080,1920,20),('instagram','ستوري',1080,1920,30),
('tiktok','ريل/فيديو',1080,1920,10),('tiktok','ستوري',1080,1920,20),
('facebook','بوست صور',1080,1080,10),('facebook','ريل',1080,1920,20),('facebook','ستوري',1080,1920,30),
('youtube','Short/ريل',1080,1920,10),('youtube','فيديو HD',1920,1080,20),
('whatsapp','رسالة نصية',null,null,10),('whatsapp','صورة واتساب',1080,1080,20),('whatsapp','فيديو واتساب - قيد التحقق',1920,1080,30)
) as v(platform_code,name,width,height,sort_order) on v.platform_code=p.code
on conflict(platform_id,name) do update set width=excluded.width,height=excluded.height,sort_order=excluded.sort_order;

insert into marketing.package_categories(name,sort_order) values
('العائلية',10),('الفضية',20),('الذهبية',30),('VIP',40)
on conflict(name) do nothing;

insert into marketing.request_statuses(code,name,is_terminal,sort_order) values
('request_received','تم استلام الطلب',false,10),
('scheduled','تم تحديد الموعد',false,20),
('in_progress','جاري التصوير',false,30),
('completed','مكتمل',true,40),
('cancelled','ملغي',true,50)
on conflict(code) do update set name=excluded.name,is_terminal=excluded.is_terminal,sort_order=excluded.sort_order;

with defs(department_code,name,short_code,sort_order) as (values
('montage','REEL - مواصفات كامله - STUDIO','M-RL-SPEC-ST',10),
('montage','REEL - اهم المواصفات - STUDIO','M-RL-TOP-ST',20),
('montage','REEL - SHORT/TREND - SHOWROOM','M-RL-TRD-SR',30),
('montage','REEL - UGC - SHOWROOM','M-RL-UGC-SR',40),
('montage','REEL - حملات - SHOWROOM','M-RL-CMP-SR',50),
('montage','REEL - معارضنا - SHOWROOM','M-RL-SHOW-SR',60),
('montage','REEL - تجربه عميل - SHOWROOM','M-RL-CUST-SR',70),
('montage','VIDEO - مواصفات - STUDIO','M-VD-SPEC-ST',80),
('montage','VIDEO - فيلم سياره - STUDIO','M-VD-CAR-ST',90),
('montage','VIDEO - فيلم - STUDIO','M-VD-FILM-ST',100),
('montage','VIDEO - مواصفات - SHOWROOM','M-VD-SPEC-SR',110),
('montage','VIDEO - فيلم - SHOWROOM','M-VD-FILM-SR',120),
('montage','VIDEO - معارضنا - SHOWROOM','M-VD-SHOW-SR',130),
('design','POST','D-POST',10),('design','CAROUSEL','D-CAROUSEL',20),('design','PANNER','D-PANNER',30),('design','MOTION','D-MOTION',40),('design','GIF','D-GIF',50),('design','PRINT','D-PRINT',60),('design','MZJ-INTERIAL','D-INTERIAL',70),
('design','STORY - جاهزة الان - STUDIO','M-ST-READY-ST',80),('design','STORY - سعرها اليوم - STUDIO','M-ST-PRICE-ST',90),('design','STORY - قسطها الان - STUDIO','M-ST-INST-ST',100),('design','STORY - معرضنا - SHOWROOM','M-ST-SHOW-SR',110),('design','STORY - جاهزة الان - SHOWROOM','M-ST-READY-SR',120),('design','STORY - سعرها اليوم - SHOWROOM','M-ST-PRICE-SR',130),('design','STORY - قسطها الان - SHOWROOM','M-ST-INST-SR',140),
('photography','تصوير صور السياره','P-CAR-PHOTO',10),('photography','تصوير ريل - مواصفات - STUDIO','P-RL-SPEC-ST',20),('photography','تصوير ريل - SHORT/TREND - SHOWROOM','P-RL-TRD-SR',30),('photography','تصوير ريل - UGC - SHOWROOM','P-RL-UGC-SR',40),('photography','تصوير ريل - معارضنا - SHOWROOM','P-RL-SHOW-SR',50),('photography','تصوير ريل - تجربه عميل - SHOWROOM','P-RL-CUST-SR',60),('photography','تصوير فيديو - مواصفات - STUDIO','P-VD-SPEC-ST',70),('photography','تصوير فيديو - مواصفات - SHOWROOM','P-VD-SPEC-SR',80),('photography','تصوير فيديو - معارضنا - SHOWROOM','P-VD-SHOW-SR',90),('photography','تصوير ستوري - سياره - STUDIO','P-ST-CAR-ST',100),('photography','تصوير ستوري - معرضنا - SHOWROOM','P-ST-SHOW-SR',110)
)
insert into marketing.creative_catalog(name,short_code,primary_department_id,sort_order)
select defs.name,defs.short_code,d.id,defs.sort_order from defs join marketing.departments d on d.code=defs.department_code
on conflict(name) do update set short_code=excluded.short_code,primary_department_id=excluded.primary_department_id,sort_order=excluded.sort_order;

with defs(department_code,name,pct,admin_only,sort_order) as (values
('design','النسخة الأولى',35,false,10),('design','الاعتماد',35,true,20),('design','التسليم و الإرفاق',30,false,30),
('photography','التصوير قبل الفلترة',20,false,10),('photography','الاعتماد',20,true,20),('photography','الإيديت',20,false,30),('photography','الاعتماد النهائي',20,true,40),('photography','التسليم و الإرفاق',20,false,50),
('montage','اختيار اللقطات المناسبة',10,false,10),('montage','تجهيز مشاهد الذكاء الاصطناعي',10,false,20),('montage','فويس اوفر',10,false,30),('montage','الهوك',10,false,40),('montage','الاعتماد',15,true,50),('montage','الإيديت',25,false,60),('montage','التسليم و الإرفاق',20,false,70)
)
insert into marketing.assignment_actions(department_id,name,progress_percent,admin_only,sort_order)
select d.id,defs.name,defs.pct,defs.admin_only,defs.sort_order from defs join marketing.departments d on d.code=defs.department_code
on conflict(department_id,name) do update set progress_percent=excluded.progress_percent,admin_only=excluded.admin_only,sort_order=excluded.sort_order;

commit;
