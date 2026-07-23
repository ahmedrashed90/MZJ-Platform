create extension if not exists pgcrypto;

create schema if not exists core;
create schema if not exists crm;
create schema if not exists marketing;
create schema if not exists operations;
create schema if not exists tracking;
create schema if not exists integrations;
create schema if not exists audit;

create table if not exists core.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  system_code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists core.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists core.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists core.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  system_code text not null,
  created_at timestamptz not null default now()
);

create table if not exists core.role_permissions (
  role_id uuid not null references core.roles(id) on delete cascade,
  permission_id uuid not null references core.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists core.users (
  id uuid primary key default gen_random_uuid(),
  employee_no text unique,
  full_name text not null,
  email text unique,
  mobile text unique,
  next_erp_user_id text,
  password_hash text,
  must_change_password boolean not null default true,
  password_changed_at timestamptz,
  is_active boolean not null default true,
  can_receive_leads boolean not null default false,
  can_receive_tasks boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table core.users add column if not exists next_erp_user_id text;
create unique index if not exists core_users_next_erp_user_id_unique
on core.users(lower(trim(next_erp_user_id)))
where nullif(trim(next_erp_user_id),'') is not null;

create table if not exists core.sessions (
  token_hash text primary key,
  user_id uuid not null references core.users(id) on delete cascade,
  expires_at timestamptz not null,
  user_agent text,
  ip_address inet,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists core_sessions_user_idx on core.sessions(user_id);
create index if not exists core_sessions_expiry_idx on core.sessions(expires_at);

create table if not exists core.user_roles (
  user_id uuid not null references core.users(id) on delete cascade,
  role_id uuid not null references core.roles(id) on delete cascade,
  primary key (user_id, role_id)
);

create table if not exists core.user_departments (
  user_id uuid not null references core.users(id) on delete cascade,
  department_id uuid not null references core.departments(id) on delete cascade,
  is_primary boolean not null default false,
  primary key (user_id, department_id)
);

create table if not exists core.user_branches (
  user_id uuid not null references core.users(id) on delete cascade,
  branch_id uuid not null references core.branches(id) on delete cascade,
  is_primary boolean not null default false,
  primary key (user_id, branch_id)
);

create table if not exists crm.leads (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  customer_name text,
  phone text,
  phone_normalized text,
  source_code text,
  source_name text,
  platform_code text,
  service_key text,
  department_code text,
  branch_code text,
  status_code text,
  status_label text,
  payment_type text,
  car_name text,
  car_category text,
  location text,
  unread_count integer not null default 0,
  dashboard_unread boolean not null default false,
  has_unread_message boolean not null default false,
  has_unread_messages boolean not null default false,
  message_unread boolean not null default false,
  is_unread boolean not null default false,
  last_message_direction text,
  last_incoming_message_at timestamptz,
  last_message_at timestamptz,
  dashboard_message_read_at timestamptz,
  assigned_to uuid references core.users(id),
  call_center_assigned_to uuid references core.users(id),
  notes text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_leads_phone_unique on crm.leads(phone_normalized) where phone_normalized is not null and is_deleted = false;
create index if not exists crm_leads_department_idx on crm.leads(department_code, branch_code, status_label);

create table if not exists crm.customer_field_definitions (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  label text not null,
  field_type text not null default 'text',
  sort_order integer not null default 0,
  department_keys text[] not null default '{}',
  is_active boolean not null default true,
  is_required boolean not null default false,
  include_in_completion boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  is_system boolean not null default false,
  is_locked boolean not null default false,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_customer_fields_order_idx on crm.customer_field_definitions(is_active, sort_order);

insert into crm.customer_field_definitions(
  field_key,label,field_type,sort_order,department_keys,is_active,is_required,include_in_completion,options,is_system,is_locked
) values
('status_label','حالة العميل','status',10,'{}'::text[],true,true,true,'[]'::jsonb,true,true),
('follow_up_at','تاريخ المتابعة','date',20,'{}'::text[],true,false,false,'[]'::jsonb,true,false),
('source_code','المصدر','source',30,'{}'::text[],true,true,true,'[]'::jsonb,true,true),
('department_code','القسم','department',40,'{}'::text[],true,true,true,'[]'::jsonb,true,true),
('department_transfer','تحويل لقسم آخر','transfer',50,'{}'::text[],true,false,false,'[]'::jsonb,true,true),
('customer_name','اسم العميل','text',60,'{}'::text[],true,true,true,'[]'::jsonb,true,true),
('phone','رقم الجوال','phone',70,'{}'::text[],true,true,true,'[]'::jsonb,true,true),
('age','العمر','number',80,'{}'::text[],true,false,true,'[]'::jsonb,true,false),
('salary','الراتب','number',90,'{}'::text[],true,false,true,'[]'::jsonb,true,true),
('obligation','الالتزام إن وجد','number',100,'{}'::text[],true,false,true,'[]'::jsonb,true,true),
('salary_bank','نزول الراتب على أي بنك','text',110,'{}'::text[],true,false,true,'[]'::jsonb,true,false),
('location','المكان','text',120,'{}'::text[],true,false,true,'[]'::jsonb,true,false),
('car_type','نوع السيارة','text',130,'{}'::text[],true,false,true,'[]'::jsonb,true,false),
('car_category','الفئة','text',135,'{}'::text[],true,false,true,'[]'::jsonb,true,false),
('car_model','الموديل','text',140,'{}'::text[],true,false,true,'[]'::jsonb,true,false),
('color','اللون','text',150,'{}'::text[],true,false,true,'[]'::jsonb,true,false),
('finance_type','نوع التمويل','select',160,array['finance'],true,false,false,
 '[{"value":"general","label":"عام 45%"},{"value":"rate55","label":"55%"},{"value":"realEstate","label":"عقاري 65%"}]'::jsonb,true,true),
('notes','ملاحظات','textarea',170,'{}'::text[],true,false,false,'[]'::jsonb,true,false)
on conflict (field_key) do nothing;

create table if not exists crm.conversations (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  lead_id uuid references crm.leads(id) on delete set null,
  channel_code text not null,
  customer_name text,
  participant_id text,
  status text not null default 'open',
  preview_text text,
  unread_count integer not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_conversations_last_message_idx on crm.conversations(last_message_at desc);

create table if not exists crm.messages (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,
  conversation_id uuid not null references crm.conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  message_type text not null default 'text',
  body text,
  attachment_url text,
  provider_status text,
  sent_by uuid references core.users(id),
  created_at timestamptz not null default now()
);

create table if not exists crm.status_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm.leads(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references core.users(id),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists marketing.campaigns (
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

create table if not exists marketing.creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_type text not null,
  quantity integer not null default 1,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists marketing.tasks (
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

create table if not exists operations.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into operations.locations(code, name, sort_order) values
('warehouse','المستودع',10),
('agency','الوكالة',20),
('hall','الصالة',30),
('qadisiyah','القادسية',40),
('multaqa','الملتقى',50)
on conflict (code) do nothing;

create table if not exists operations.vehicles (
  id uuid primary key default gen_random_uuid(),
  vin text not null unique,
  car_name text,
  statement text,
  agent_name text,
  exterior_color text,
  interior_color text,
  model_year text,
  plate_no text,
  batch_no text,
  location_id uuid references operations.locations(id),
  status_code text not null,
  source_type text,
  has_notes boolean not null default false,
  notes text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists operations_vehicles_location_status_idx on operations.vehicles(location_id, status_code) where is_deleted = false;

create table if not exists operations.vehicle_approvals (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  financial_approved boolean not null default false,
  administrative_approved boolean not null default false,
  financial_approved_by uuid references core.users(id),
  administrative_approved_by uuid references core.users(id),
  pending_delivery jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists operations.vehicle_shortages (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  shortage_type text not null,
  note text,
  is_resolved boolean not null default false,
  resolved_by uuid references core.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists operations.transfer_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text unique,
  department_code text,
  transfer_type text,
  source_location_id uuid references operations.locations(id),
  destination_location_id uuid references operations.locations(id),
  status text not null,
  requested_by uuid references core.users(id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists operations.transfer_request_vehicles (
  transfer_request_id uuid not null references operations.transfer_requests(id) on delete cascade,
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  primary key (transfer_request_id, vehicle_id)
);

create table if not exists operations.movements (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  from_location_id uuid references operations.locations(id),
  to_location_id uuid references operations.locations(id),
  old_status text,
  new_status text,
  note text,
  performed_by uuid references core.users(id),
  created_at timestamptz not null default now()
);

create table if not exists tracking.orders (
  id uuid primary key default gen_random_uuid(),
  sales_order_no text not null unique,
  customer_name text,
  customer_mobile text,
  order_date date,
  status text not null default 'not_started',
  tracking_token text unique default encode(gen_random_bytes(24), 'hex'),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tracking.order_vehicles (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references tracking.orders(id) on delete cascade,
  vin text not null,
  car_name text,
  is_selected boolean not null default false,
  unique(order_id, vin)
);

create table if not exists tracking.stages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  owner_type text not null,
  sort_order integer not null,
  sms_enabled boolean not null default false,
  is_active boolean not null default true
);

create table if not exists tracking.order_stages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references tracking.orders(id) on delete cascade,
  stage_id uuid not null references tracking.stages(id),
  status text not null default 'pending',
  completed_by uuid references core.users(id),
  completed_at timestamptz,
  reverted_by uuid references core.users(id),
  reverted_at timestamptz,
  unique(order_id, stage_id)
);

create table if not exists integrations.inbound_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_key text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'received',
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(source, event_key)
);

create table if not exists integrations.sms_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists integrations.sms_jobs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  phone text not null,
  template_id uuid references integrations.sms_templates(id),
  body text not null,
  status text not null default 'queued',
  device_id text,
  attempts integer not null default 0,
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists integrations.erpnext_sales_orders (
  id uuid primary key default gen_random_uuid(),
  sales_order_no text not null unique,
  erp_status text,
  erp_event text,
  erp_sales_person text,
  accounting_customer_name text,
  actual_customer_name text,
  actual_customer_phone text,
  actual_customer_phone_normalized text,
  customer_vat text,
  order_date date,
  delivery_date date,
  erp_user_id text,
  erp_branch text,
  platform_user_id uuid references core.users(id) on delete set null,
  platform_user_name text,
  platform_department_code text,
  platform_department_name text,
  platform_branch_code text,
  platform_branch_name text,
  crm_lead_id uuid references crm.leads(id) on delete set null,
  tracking_order_id uuid references tracking.orders(id) on delete set null,
  subtotal_before_tax numeric(14,2) not null default 0,
  tax_value numeric(14,2) not null default 0,
  total_incl_vat numeric(14,2) not null default 0,
  registration_fee numeric(14,2) not null default 0,
  user_link_status text not null default 'pending',
  crm_link_status text not null default 'pending',
  operations_link_status text not null default 'pending',
  warnings jsonb not null default '[]'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists erpnext_sales_orders_phone_idx on integrations.erpnext_sales_orders(actual_customer_phone_normalized);
create index if not exists erpnext_sales_orders_user_idx on integrations.erpnext_sales_orders(platform_user_id,updated_at desc);
create index if not exists erpnext_sales_orders_crm_idx on integrations.erpnext_sales_orders(crm_lead_id,updated_at desc);

create table if not exists integrations.erpnext_sales_order_vehicles (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references integrations.erpnext_sales_orders(id) on delete cascade,
  item_identity text not null,
  item_no text,
  vin text,
  item_type text,
  item_category text,
  item_model text,
  interior_color text,
  exterior_color text,
  dealer text,
  qty numeric(12,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  item_value numeric(14,2) not null default 0,
  total_incl_vat numeric(14,2) not null default 0,
  tracking_vehicle_id uuid references tracking.order_vehicles(id) on delete set null,
  operations_vehicle_id uuid references operations.vehicles(id) on delete set null,
  operations_status_code text,
  operations_status_applied_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sales_order_id,item_identity)
);
create index if not exists erpnext_sales_order_vehicles_vin_idx
on integrations.erpnext_sales_order_vehicles(upper(trim(vin)))
where nullif(trim(vin),'') is not null;
create index if not exists erpnext_sales_order_vehicles_operations_idx
on integrations.erpnext_sales_order_vehicles(operations_vehicle_id,updated_at desc);

create table if not exists audit.activity_log (
  id bigserial primary key,
  user_id uuid references core.users(id),
  system_code text not null,
  action text not null,
  entity_type text,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);


create schema if not exists marketing;

alter table marketing.campaigns add column if not exists brief text;
alter table marketing.campaigns add column if not exists budget_total numeric(14,2) not null default 0;
alter table marketing.campaigns add column if not exists structure_approved_by uuid references core.users(id);
alter table marketing.campaigns add column if not exists structure_approved_at timestamptz;
alter table marketing.campaigns add column if not exists publish_ready_at timestamptz;
alter table marketing.campaigns add column if not exists raw_root_path text;
alter table marketing.campaigns add column if not exists folder_created_at timestamptz;
alter table marketing.campaigns add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table marketing.campaigns add column if not exists updated_by uuid references core.users(id);
alter table marketing.campaigns add column if not exists archived_at timestamptz;
alter table marketing.campaigns alter column status set default 'في انتظار اعتماد الهيكل';

alter table marketing.creatives add column if not exists instance_key text;
alter table marketing.creatives add column if not exists name text;
alter table marketing.creatives add column if not exists description text;
alter table marketing.creatives add column if not exists cars jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists departments jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists budget numeric(14,2) not null default 0;
alter table marketing.creatives add column if not exists sort_order integer not null default 0;
alter table marketing.creatives add column if not exists raw_path text;
alter table marketing.creatives add column if not exists output_path text;
alter table marketing.creatives add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table marketing.creatives add column if not exists updated_at timestamptz not null default now();
update marketing.creatives set instance_key = coalesce(nullif(instance_key,''), 'legacy-' || id::text), name = coalesce(nullif(name,''), creative_type) where instance_key is null or name is null;
alter table marketing.creatives alter column instance_key set not null;
alter table marketing.creatives alter column name set not null;
create unique index if not exists marketing_creatives_campaign_instance_uidx on marketing.creatives(campaign_id, instance_key);

alter table marketing.tasks add column if not exists task_key text;
alter table marketing.tasks add column if not exists task_type text not null default 'execution';
alter table marketing.tasks add column if not exists title text;
alter table marketing.tasks add column if not exists notes text;
alter table marketing.tasks add column if not exists template_data jsonb not null default '{}'::jsonb;
alter table marketing.tasks add column if not exists action_data jsonb not null default '[]'::jsonb;
alter table marketing.tasks add column if not exists final_file_path text;
alter table marketing.tasks add column if not exists final_file_name text;
alter table marketing.tasks add column if not exists submitted_at timestamptz;
alter table marketing.tasks add column if not exists approved_at timestamptz;
alter table marketing.tasks add column if not exists approved_by uuid references core.users(id);
alter table marketing.tasks add column if not exists sort_order integer not null default 0;
alter table marketing.tasks add column if not exists metadata jsonb not null default '{}'::jsonb;
update marketing.tasks set task_key = coalesce(nullif(task_key,''), 'legacy-' || id::text), title = coalesce(nullif(title,''), department_code) where task_key is null or title is null;
alter table marketing.tasks alter column task_key set not null;
alter table marketing.tasks alter column title set not null;
create unique index if not exists marketing_tasks_campaign_key_uidx on marketing.tasks(campaign_id, task_key);
create index if not exists marketing_tasks_assigned_status_idx on marketing.tasks(assigned_to, status, due_at);

create table if not exists marketing.agenda_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  item_type text not null default 'task',
  starts_at timestamptz not null,
  ends_at timestamptz,
  owner_id uuid references core.users(id),
  campaign_id uuid references marketing.campaigns(id) on delete set null,
  status text not null default 'مجدول',
  notes text,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_agenda_starts_idx on marketing.agenda_items(starts_at, status);

create table if not exists marketing.publishing_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  platform_code text not null,
  post_type text not null,
  scheduled_at timestamptz,
  caption text,
  hashtags text,
  media_path text,
  status text not null default 'مسودة',
  published_at timestamptz,
  external_post_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_publishing_schedule_idx on marketing.publishing_items(scheduled_at, status);

create table if not exists marketing.creative_type_settings (
  code text primary key,
  name text not null,
  department_codes text[] not null default array['content'],
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into marketing.creative_type_settings(code,name,department_codes,sort_order) values
('SHOWROOM_REEL','تصوير ريل - معرضنا - SHOWROOM',array['content','photography'],10),
('PHOTO_STORY','تصوير ستوري - معرضنا - SHOWROOM',array['content','photography'],20),
('REEL','REEL',array['content','montage'],30),
('VIDEO','VIDEO',array['content','montage'],40),
('STORY','STORY',array['content','montage'],50),
('POST','POST',array['content','design'],60),
('CAROUSEL','CAROUSEL',array['content','design'],70),
('PANNER','PANNER',array['content','design'],80),
('MOTION','MOTION',array['content','design'],90),
('GIF','GIF',array['content','design'],100),
('PRINT','مطبوعات اوفلاين',array['content','design'],110),
('MZJ_INTERIAL','MZJ-INTERIAL',array['content','design'],120)
on conflict(code) do update set name=excluded.name,department_codes=excluded.department_codes,sort_order=excluded.sort_order,is_active=true,updated_at=now();

create table if not exists marketing.platform_settings (
  code text primary key,
  name text not null,
  post_types text[] not null default '{}',
  is_active boolean not null default true,
  connection_status text not null default 'غير مربوط',
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into marketing.platform_settings(code,name,post_types,connection_status,sort_order) values
('instagram','Instagram',array['Post','Reel','Story','Carousel'],'جاهز',10),
('facebook','Facebook',array['Post','Reel','Story'],'جاهز',20),
('tiktok','TikTok',array['Video','Draft Upload'],'Sandbox / Draft Upload',30),
('snapchat','Snapchat',array['Story','Spotlight','Saved Story'],'بانتظار موافقة Public Profile API',40),
('youtube','YouTube',array['Video','Short'],'غير مربوط',50),
('x','X',array['Post','Video'],'غير مربوط',60)
on conflict(code) do update set name=excluded.name,post_types=excluded.post_types,connection_status=excluded.connection_status,sort_order=excluded.sort_order,updated_at=now();

create table if not exists marketing.activity_log (
  id bigserial primary key,
  campaign_id uuid references marketing.campaigns(id) on delete cascade,
  task_id uuid references marketing.tasks(id) on delete cascade,
  user_id uuid references core.users(id),
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists marketing_activity_campaign_idx on marketing.activity_log(campaign_id, created_at desc);

insert into core.permissions(code,name,system_code) values
('marketing.view','عرض التسويق','marketing'),
('marketing.campaigns.manage','إدارة الحملات','marketing'),
('marketing.structure.approve','اعتماد هيكل الحملات','marketing'),
('marketing.templates.manage','تنفيذ Task Template','marketing'),
('marketing.templates.approve','اعتماد Task Template','marketing'),
('marketing.tasks.execute','تنفيذ تكليفات التسويق','marketing'),
('marketing.tasks.approve','اعتماد تنفيذ تكليفات التسويق','marketing'),
('marketing.publishing.manage','إدارة تجهيز النشر','marketing'),
('marketing.settings.manage','إدارة إعدادات التسويق','marketing')
on conflict(code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code in ('admin','system_admin') and p.system_code='marketing'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('marketing.view','marketing.templates.manage','marketing.tasks.execute')
where r.code='marketing_user'
on conflict do nothing;
