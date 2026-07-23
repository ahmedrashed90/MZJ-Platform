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
-- MZJ Marketing local publisher runtime. Additive and isolated to marketing schema.

create table if not exists marketing.publisher_import_plans (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references marketing.publisher_devices(id) on delete cascade,
  root_folder_name text not null,
  raw_plan jsonb not null default '{}'::jsonb,
  job_count integer not null default 0,
  status text not null default 'imported',
  created_at timestamptz not null default now(),
  constraint marketing_publisher_import_plans_status_check check (status in ('imported','processing','completed','failed','cancelled'))
);

create table if not exists marketing.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  import_plan_id uuid references marketing.publisher_import_plans(id) on delete set null,
  device_id uuid not null references marketing.publisher_devices(id) on delete cascade,
  source_day text not null,
  post_type text not null,
  caption text,
  media jsonb not null default '[]'::jsonb,
  status text not null default 'queued',
  idempotency_key text not null unique,
  lease_token_hash text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  result jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint marketing_publish_jobs_status_check check (status in ('queued','leased','uploading','processing','completed','failed','blocked','cancelled'))
);

create index if not exists marketing_publish_jobs_device_status_idx on marketing.publish_jobs(device_id,status,created_at);
create index if not exists marketing_publish_jobs_lease_idx on marketing.publish_jobs(status,lease_expires_at);
-- Exact reconciliation between original schedule targets and Publish Prep targets.

alter table marketing.publish_targets
  add column if not exists schedule_target_id uuid references marketing.publish_schedule_targets(id) on delete set null;

create unique index if not exists marketing_publish_target_schedule_unique
  on marketing.publish_targets(publish_prep_item_id, schedule_target_id)
  where schedule_target_id is not null;

create index if not exists marketing_publish_target_schedule_lookup_idx
  on marketing.publish_targets(schedule_target_id, status);
