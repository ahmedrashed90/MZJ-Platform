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
  password_hash text,
  is_active boolean not null default true,
  can_receive_leads boolean not null default false,
  can_receive_tasks boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  location text,
  assigned_to uuid references core.users(id),
  call_center_assigned_to uuid references core.users(id),
  notes text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_leads_phone_unique on crm.leads(phone_normalized) where phone_normalized is not null and is_deleted = false;
create index if not exists crm_leads_department_idx on crm.leads(department_code, branch_code, status_label);

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
