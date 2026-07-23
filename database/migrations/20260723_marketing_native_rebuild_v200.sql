
begin;

drop schema if exists marketing cascade;
create schema marketing;

create table marketing.schema_version (
  version integer primary key,
  applied_at timestamptz not null default now()
);
insert into marketing.schema_version(version) values (2);

create sequence marketing.campaign_code_seq start 1;
create sequence marketing.task_no_seq start 1;
create sequence marketing.photo_request_no_seq start 1;

create table marketing.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_content boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table marketing.department_users (
  department_id uuid not null references marketing.departments(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(department_id,user_id)
);

create table marketing.assignment_actions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references marketing.departments(id) on delete cascade,
  name text not null,
  code text not null,
  progress_weight numeric(5,2) not null check(progress_weight >= 0 and progress_weight <= 100),
  admin_only boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(department_id,code)
);

create table marketing.creatives (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_code text not null unique,
  primary_department_id uuid not null references marketing.departments(id),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table marketing.campaign_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  prefix text not null default 'MZJ',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table marketing.platforms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table marketing.publish_types (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references marketing.platforms(id) on delete cascade,
  name text not null,
  dimensions text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform_id,name,dimensions)
);

create table marketing.package_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table marketing.request_statuses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table marketing.campaigns (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source_kind text not null check(source_kind in ('campaign','agenda')),
  campaign_code text not null unique,
  name text not null,
  campaign_type_id uuid references marketing.campaign_types(id),
  objective text,
  content_request text,
  campaign_date date,
  publish_start date not null,
  publish_end date not null,
  agenda_month date,
  status text not null default 'draft',
  moved_to_publish_at timestamptz,
  archived_at timestamptz,
  archived_by uuid references core.users(id),
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references core.users(id),
  created_by uuid not null references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(publish_end >= publish_start)
);
create index marketing_campaigns_kind_status_idx on marketing.campaigns(source_kind,status,created_at desc);
create index marketing_campaigns_active_idx on marketing.campaigns(is_deleted,archived_at,updated_at desc);

create table marketing.agenda_days (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  agenda_date date not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(campaign_id,agenda_date)
);

create table marketing.creative_instances (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  agenda_day_id uuid references marketing.agenda_days(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id),
  instance_no integer not null check(instance_no > 0),
  instance_code text not null,
  content_received_date date,
  content_notes text,
  primary_received_date date,
  primary_notes text,
  is_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id,instance_no)
);
create index marketing_instances_campaign_idx on marketing.creative_instances(campaign_id,instance_no);

create table marketing.instance_content_users (
  creative_instance_id uuid not null references marketing.creative_instances(id) on delete cascade,
  user_id uuid not null references core.users(id),
  due_date date,
  notes text,
  created_at timestamptz not null default now(),
  primary key(creative_instance_id,user_id)
);

create table marketing.instance_sections (
  id uuid primary key default gen_random_uuid(),
  creative_instance_id uuid not null references marketing.creative_instances(id) on delete cascade,
  department_id uuid not null references marketing.departments(id),
  section_kind text not null check(section_kind in ('primary','optional')),
  received_date date,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(creative_instance_id,department_id)
);

create table marketing.section_users (
  id uuid primary key default gen_random_uuid(),
  instance_section_id uuid not null references marketing.instance_sections(id) on delete cascade,
  user_id uuid not null references core.users(id),
  due_date date,
  created_at timestamptz not null default now(),
  unique(instance_section_id,user_id)
);

create table marketing.section_user_writers (
  section_user_id uuid not null references marketing.section_users(id) on delete cascade,
  content_user_id uuid not null references core.users(id),
  due_date date,
  created_at timestamptz not null default now(),
  primary key(section_user_id,content_user_id)
);

create table marketing.instance_vehicles (
  creative_instance_id uuid not null references marketing.creative_instances(id) on delete cascade,
  vehicle_id uuid not null references operations.vehicles(id),
  created_at timestamptz not null default now(),
  primary key(creative_instance_id,vehicle_id)
);

create table marketing.instance_platforms (
  creative_instance_id uuid not null references marketing.creative_instances(id) on delete cascade,
  platform_id uuid not null references marketing.platforms(id),
  created_at timestamptz not null default now(),
  primary key(creative_instance_id,platform_id)
);

create table marketing.instance_publish_types (
  creative_instance_id uuid not null references marketing.creative_instances(id) on delete cascade,
  publish_type_id uuid not null references marketing.publish_types(id),
  created_at timestamptz not null default now(),
  primary key(creative_instance_id,publish_type_id)
);

create table marketing.budget_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_instance_id uuid not null references marketing.creative_instances(id),
  funnel text not null,
  ads_count integer not null default 1 check(ads_count > 0),
  content_goal text,
  expected_goal text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table marketing.budget_item_platforms (
  budget_item_id uuid not null references marketing.budget_items(id) on delete cascade,
  platform_id uuid not null references marketing.platforms(id),
  amount numeric(14,2) not null default 0 check(amount >= 0),
  primary key(budget_item_id,platform_id)
);

create table marketing.schedule_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_instance_id uuid not null references marketing.creative_instances(id),
  publish_date date not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table marketing.schedule_item_platforms (
  schedule_item_id uuid not null references marketing.schedule_items(id) on delete cascade,
  platform_id uuid not null references marketing.platforms(id),
  publish_type_id uuid not null references marketing.publish_types(id),
  primary key(schedule_item_id,platform_id,publish_type_id)
);

create table marketing.files (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null,
  owner_id uuid,
  storage_key text not null unique,
  original_name text not null,
  mime_type text,
  file_size bigint,
  status text not null default 'uploading',
  uploaded_by uuid not null references core.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table marketing.tasks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_instance_id uuid not null references marketing.creative_instances(id) on delete cascade,
  template_task_id uuid references marketing.tasks(id) on delete set null,
  task_no text not null unique,
  task_kind text not null check(task_kind in ('template','execution')),
  department_id uuid not null references marketing.departments(id),
  assigned_to uuid not null references core.users(id),
  content_writer_id uuid not null references core.users(id),
  status text not null,
  progress numeric(5,2) not null default 0 check(progress >= 0 and progress <= 100),
  due_date date,
  received_at timestamptz,
  completed_at timestamptz,
  final_file_id uuid references marketing.files(id),
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(creative_instance_id,task_kind,department_id,assigned_to,content_writer_id)
);
create index marketing_tasks_user_status_idx on marketing.tasks(assigned_to,status,due_date);
create index marketing_tasks_campaign_idx on marketing.tasks(campaign_id,department_id,task_kind);
create index marketing_tasks_template_idx on marketing.tasks(template_task_id,status);

create table marketing.task_actions (
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  assignment_action_id uuid not null references marketing.assignment_actions(id),
  completed boolean not null default false,
  completed_at timestamptz,
  completed_by uuid references core.users(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(task_id,assignment_action_id)
);

create table marketing.template_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  revision_no integer not null,
  file_id uuid not null references marketing.files(id),
  parsed_data jsonb not null default '{}'::jsonb,
  status text not null default 'submitted',
  submitted_by uuid not null references core.users(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references core.users(id),
  reviewed_at timestamptz,
  review_notes text,
  unique(task_id,revision_no)
);

create table marketing.task_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  submission_id uuid references marketing.template_submissions(id) on delete set null,
  action text not null,
  notes text,
  actor_id uuid not null references core.users(id),
  created_at timestamptz not null default now()
);

create table marketing.campaign_files (
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  file_id uuid not null references marketing.files(id) on delete cascade,
  file_kind text not null,
  created_at timestamptz not null default now(),
  primary key(campaign_id,file_id)
);

create table marketing.campaign_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  platform_id uuid not null references marketing.platforms(id),
  url text not null,
  created_by uuid not null references core.users(id),
  created_at timestamptz not null default now()
);

create table marketing.raw_folder_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  status text not null,
  response_data jsonb not null default '{}'::jsonb,
  created_by uuid not null references core.users(id),
  created_at timestamptz not null default now()
);

create table marketing.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid not null references marketing.package_categories(id),
  price numeric(14,2) not null default 0 check(price >= 0),
  cash_discount numeric(5,2) not null default 0 check(cash_discount >= 0 and cash_discount <= 100),
  registration_fee boolean not null default false,
  insurance boolean not null default false,
  issuance_fee boolean not null default false,
  car_care_lines text[] not null default '{}',
  delivery_mode text not null default 'home' check(delivery_mode in ('home','region')),
  is_active boolean not null default true,
  created_by uuid not null references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table marketing.attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id),
  attendance_date date not null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  status text not null default 'present',
  notes text,
  recorded_by uuid not null references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,attendance_date)
);

create table marketing.platform_connections (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references marketing.platforms(id),
  connection_name text not null,
  account_label text,
  status text not null default 'disconnected',
  credentials jsonb not null default '{}'::jsonb,
  created_by uuid not null references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform_id,connection_name)
);

insert into marketing.departments(code,name,is_content,sort_order) values
('content','قسم المحتوى',true,10),
('design','قسم التصميم',false,20),
('photography','قسم التصوير',false,30),
('editing','قسم المونتاج',false,40),
('publishing','قسم النشر',false,50);

with d as (select id,code from marketing.departments)
insert into marketing.assignment_actions(department_id,name,code,progress_weight,admin_only,sort_order)
select d.id,x.name,x.code,x.weight,x.admin_only,x.sort_order
from d join (values
('content','رفع Task Template','template_upload',50::numeric,false,10),
('content','اعتماد Task Template','template_approval',50::numeric,true,20),
('design','النسخة الأولى','first_version',35::numeric,false,10),
('design','الاعتماد','approval',35::numeric,true,20),
('design','التسليم والإرفاق','delivery',30::numeric,false,30),
('photography','التصوير قبل الفلترة','pre_filter_shoot',20::numeric,false,10),
('photography','الاعتماد الأول','first_approval',20::numeric,true,20),
('photography','الإيديت','edit',20::numeric,false,30),
('photography','الاعتماد النهائي','final_approval',20::numeric,true,40),
('photography','التسليم والإرفاق','delivery',20::numeric,false,50),
('editing','اختيار اللقطات المناسبة','select_shots',10::numeric,false,10),
('editing','تجهيز مشاهد الذكاء الاصطناعي','ai_scenes',10::numeric,false,20),
('editing','فويس أوفر','voice_over',10::numeric,false,30),
('editing','الهوك','hook',10::numeric,false,40),
('editing','الاعتماد الأول','first_approval',15::numeric,true,50),
('editing','الإيديت','edit',20::numeric,false,60),
('editing','الاعتماد النهائي','final_approval',15::numeric,true,70),
('editing','التسليم والإرفاق','delivery',10::numeric,false,80),
('publishing','تجهيز النشر','publish_prepare',50::numeric,false,10),
('publishing','الاعتماد والنشر','publish',50::numeric,true,20)
) as x(department_code,name,code,weight,admin_only,sort_order) on x.department_code=d.code;

with d as (select id,code from marketing.departments)
insert into marketing.creatives(name,short_code,primary_department_id,sort_order)
select x.name,x.short_code,d.id,x.sort_order
from (values
('REEL - مواصفات كامله - STUDIO','M-RL-SPEC-ST','editing',10),
('REEL - اهم المواصفات - STUDIO','M-RL-TOP-ST','editing',20),
('REEL - SHORT/TREND - SHOWROOM','M-RL-TRD-SR','editing',30),
('REEL - UGC - SHOWROOM','M-RL-UGC-SR','editing',40),
('REEL - حملات - SHOWROOM','M-RL-CMP-SR','editing',50),
('REEL - معارضنا - SHOWROOM','M-RL-SHOW-SR','editing',60),
('REEL - تجربه عميل - SHOWROOM','M-RL-CUST-SR','editing',70),
('VIDEO - مواصفات - STUDIO','M-VD-SPEC-ST','editing',80),
('VIDEO - فيلم سياره - STUDIO','M-VD-CAR-ST','editing',90),
('VIDEO - فيلم - STUDIO','M-VD-FILM-ST','editing',100),
('VIDEO - مواصفات - SHOWROOM','M-VD-SPEC-SR','editing',110),
('VIDEO - فيلم - SHOWROOM','M-VD-FILM-SR','editing',120),
('VIDEO - معارضنا - SHOWROOM','M-VD-SHOW-SR','editing',130),
('POST','D-POST','design',200),
('CAROUSEL','D-CAROUSEL','design',210),
('PANNER','D-PANNER','design',220),
('MOTION','D-MOTION','design',230),
('GIF','D-GIF','design',240),
('PRINT','D-PRINT','design',250),
('MZJ-INTERIAL','D-INTERIAL','design',260),
('STORY - جاهزة الان - STUDIO','M-ST-READY-ST','design',270),
('STORY - سعرها اليوم - STUDIO','M-ST-PRICE-ST','design',280),
('STORY - قسطها الان - STUDIO','M-ST-INST-ST','design',290),
('STORY - معرضنا - SHOWROOM','M-ST-SHOW-SR','design',300),
('STORY - جاهزة الان - SHOWROOM','M-ST-READY-SR','design',310),
('STORY - سعرها اليوم - SHOWROOM','M-ST-PRICE-SR','design',320),
('STORY - قسطها الان - SHOWROOM','M-ST-INST-SR','design',330),
('تصوير صور السياره','P-CAR-PHOTO','photography',400),
('تصوير ريل - مواصفات - STUDIO','P-RL-SPEC-ST','photography',410),
('تصوير ريل - SHORT/TREND - SHOWROOM','P-RL-TRD-SR','photography',420),
('تصوير ريل - UGC - SHOWROOM','P-RL-UGC-SR','photography',430),
('تصوير ريل - معارضنا - SHOWROOM','P-RL-SHOW-SR','photography',440),
('تصوير ريل - تجربه عميل - SHOWROOM','P-RL-CUST-SR','photography',450),
('تصوير فيديو - مواصفات - STUDIO','P-VD-SPEC-ST','photography',460),
('تصوير فيديو - مواصفات - SHOWROOM','P-VD-SPEC-SR','photography',470),
('تصوير فيديو - معارضنا - SHOWROOM','P-VD-SHOW-SR','photography',480),
('تصوير ستوري - سياره - STUDIO','P-ST-CAR-ST','photography',490),
('تصوير ستوري - معرضنا - SHOWROOM','P-ST-SHOW-SR','photography',500)
) as x(name,short_code,department_code,sort_order) join d on d.code=x.department_code;

insert into marketing.campaign_types(name,code,prefix,sort_order) values
('حملة إعادة نشر','REPOST','MZJ',10),
('حملة بيعية','SALES','MZJ',20),
('حملة توعوية','AWARENESS','MZJ',30);

insert into marketing.platforms(name,code,sort_order) values
('Snapchat','snapchat',10),('TV','tv',20),('انستجرام','instagram',30),('تيك توك','tiktok',40),('جوجل','google',50),
('حملات واتساب','whatsapp_campaigns',60),('سناب شات','snapchat_ar',70),('فيس بوك','facebook',80),('لينكد ان','linkedin',90),('يوتيوب','youtube',100);

with p as (select id,code from marketing.platforms)
insert into marketing.publish_types(platform_id,name,dimensions,sort_order)
select p.id,x.name,x.dimensions,x.sort_order from p join (values
('snapchat','Story','1920x1080',10),('snapchat','Spotlight','1920x1080',20),
('instagram','بوست صور','1080x1080',10),('instagram','ريل','1920x1080',20),('instagram','ستوري','1920x1080',30),
('tiktok','ريل/فيديو','1920x1080',10),('tiktok','ستوري','1920x1080',20),
('whatsapp_campaigns','رسالة نصية',null,10),('whatsapp_campaigns','صورة واتساب','1080x1080',20),('whatsapp_campaigns','فيديو واتساب','1920x1080',30),
('snapchat_ar','Story','1920x1080',10),('snapchat_ar','Spotlight','1920x1080',20),
('facebook','بوست صور','1080x1080',10),('facebook','ريل','1920x1080',20),('facebook','ستوري','1920x1080',30),
('youtube','Short/ريل','1920x1080',10),('youtube','فيديو HD','1080x1920',20)
) as x(platform_code,name,dimensions,sort_order) on p.code=x.platform_code;

insert into marketing.package_categories(name,code,sort_order) values
('العائلية','family',10),('الفضية','silver',20),('الذهبية','gold',30),('VIP','vip',40);

insert into marketing.request_statuses(code,name,sort_order) values
('request_received','تم استلام الطلب',10),('scheduled','تم تحديد الموعد',20),('in_progress','جاري التنفيذ',30),('completed','تم الانتهاء',40),('cancelled','ملغي',50);

insert into core.permissions(code,name,system_code) values
('marketing.view','عرض نظام التسويق','marketing'),
('marketing.campaigns.manage','إدارة الحملات والأجندات','marketing'),
('marketing.tasks.execute','تنفيذ تاسكات التسويق','marketing'),
('marketing.templates.review','مراجعة واعتماد Task Template','marketing'),
('marketing.settings.manage','إدارة إعدادات التسويق','marketing'),
('marketing.packages.manage','إدارة باقات التسويق','marketing'),
('marketing.requests.manage','إدارة طلبات تصوير التسويق','marketing'),
('marketing.reports.view','عرض تقارير التسويق','marketing')
on conflict(code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='admin' and p.system_code='marketing'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('marketing.view','marketing.tasks.execute','marketing.reports.view')
where r.code='marketing_user'
on conflict do nothing;

commit;
