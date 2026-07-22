-- MZJ CRM conversation automation v1.18.0
-- Central, configurable session engine for Cash / Finance / Customer Service.

alter table crm.automation_settings
  add column if not exists automation_name text not null default 'أوتوميشن استقبال العملاء',
  add column if not exists automation_enabled boolean not null default true,
  add column if not exists trigger_policy text not null default 'every_message',
  add column if not exists custom_interval_value integer not null default 24,
  add column if not exists custom_interval_unit text not null default 'hour';

alter table crm.automation_settings drop constraint if exists crm_automation_settings_trigger_policy_check;
alter table crm.automation_settings add constraint crm_automation_settings_trigger_policy_check
  check (trigger_policy in ('every_message','once_24_hours','custom'));
alter table crm.automation_settings drop constraint if exists crm_automation_settings_interval_unit_check;
alter table crm.automation_settings add constraint crm_automation_settings_interval_unit_check
  check (custom_interval_unit in ('minute','hour','day'));
alter table crm.automation_settings drop constraint if exists crm_automation_settings_interval_value_check;
alter table crm.automation_settings add constraint crm_automation_settings_interval_value_check
  check (custom_interval_value between 1 and 100000);

create table if not exists crm.automation_platforms (
  id uuid primary key default gen_random_uuid(),
  platform_code text not null unique,
  worker_code text,
  is_enabled boolean not null default true,
  connection_status text not null default 'unknown' check(connection_status in ('unknown','connected','disconnected','error')),
  health_url text,
  last_success_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  updated_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm.automation_start_messages (
  id uuid primary key default gen_random_uuid(),
  message_key text not null unique,
  message_text text not null,
  is_active boolean not null default true,
  sort_order integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm.automation_flows (
  id uuid primary key default gen_random_uuid(),
  flow_code text not null unique,
  display_name text not null,
  emoji text,
  button_payload text,
  service_key text not null,
  department_code text not null,
  branch_policy text not null default 'system' check(branch_policy in ('system','fixed')),
  branch_code text,
  final_action jsonb not null default '{}'::jsonb,
  final_message text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm.automation_flow_aliases (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references crm.automation_flows(id) on delete cascade,
  alias_type text not null default 'text' check(alias_type in ('text','number','payload')),
  alias_value text not null,
  normalized_value text not null,
  created_at timestamptz not null default now(),
  unique(flow_id,alias_type,normalized_value)
);
create index if not exists crm_automation_flow_aliases_lookup_idx
  on crm.automation_flow_aliases(normalized_value,alias_type);

create table if not exists crm.automation_flow_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references crm.automation_flows(id) on delete cascade,
  step_key text not null,
  step_name text not null,
  prompt_text text not null,
  step_type text not null check(step_type in ('message','text','phone','choice')),
  customer_field text,
  is_required boolean not null default true,
  validation_rules jsonb not null default '{}'::jsonb,
  validation_error text not null default 'البيانات المدخلة غير صحيحة، برجاء المحاولة مرة أخرى.',
  max_attempts integer,
  is_active boolean not null default true,
  sort_order integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(flow_id,step_key)
);
create index if not exists crm_automation_flow_steps_order_idx
  on crm.automation_flow_steps(flow_id,is_active,sort_order);

create table if not exists crm.automation_sessions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm.contacts(id) on delete cascade,
  conversation_id uuid not null references crm.conversations(id) on delete cascade,
  platform_code text not null,
  worker_code text,
  trigger_policy text not null,
  flow_id uuid references crm.automation_flows(id) on delete set null,
  current_step_id uuid references crm.automation_flow_steps(id) on delete set null,
  status text not null default 'awaiting_service'
    check(status in ('awaiting_service','awaiting_answer','completed','cancelled','expired','failed')),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  completed_at timestamptz,
  final_result jsonb not null default '{}'::jsonb,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_automation_sessions_one_active_conversation_idx
  on crm.automation_sessions(conversation_id)
  where status in ('awaiting_service','awaiting_answer');
create unique index if not exists crm_automation_sessions_one_active_contact_idx
  on crm.automation_sessions(contact_id)
  where status in ('awaiting_service','awaiting_answer');
create index if not exists crm_automation_sessions_history_idx
  on crm.automation_sessions(contact_id,started_at desc);

create table if not exists crm.automation_inbound_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  provider_message_id text,
  platform_code text not null,
  contact_id uuid references crm.contacts(id) on delete set null,
  conversation_id uuid references crm.conversations(id) on delete cascade,
  session_id uuid references crm.automation_sessions(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received' check(status in ('received','processing','processed','ignored','failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index if not exists crm_automation_inbound_provider_unique_idx
  on crm.automation_inbound_events(platform_code,provider_message_id)
  where provider_message_id is not null and provider_message_id<>'';
create index if not exists crm_automation_inbound_conversation_idx
  on crm.automation_inbound_events(conversation_id,received_at desc);

create table if not exists crm.automation_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references crm.automation_sessions(id) on delete cascade,
  step_id uuid not null references crm.automation_flow_steps(id) on delete cascade,
  inbound_event_id uuid references crm.automation_inbound_events(id) on delete set null,
  raw_value text not null,
  normalized_value text,
  validation_status text not null default 'valid' check(validation_status in ('valid','invalid')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(session_id,step_id)
);

create table if not exists crm.automation_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  session_id uuid references crm.automation_sessions(id) on delete cascade,
  conversation_id uuid not null references crm.conversations(id) on delete cascade,
  step_id uuid references crm.automation_flow_steps(id) on delete set null,
  message_kind text not null check(message_kind in ('start','question','validation_error','final')),
  message_text text not null,
  status text not null default 'queued' check(status in ('queued','sent','failed')),
  provider_message_id text,
  http_status integer,
  error_message text,
  provider_response jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz
);
create index if not exists crm_automation_outbound_session_idx
  on crm.automation_outbound_messages(session_id,created_at);

create table if not exists crm.automation_final_actions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references crm.automation_sessions(id) on delete cascade,
  contact_id uuid not null references crm.contacts(id) on delete cascade,
  conversation_id uuid not null references crm.conversations(id) on delete cascade,
  flow_id uuid not null references crm.automation_flows(id) on delete restrict,
  service_request_id uuid references crm.service_requests(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  status text not null default 'processing' check(status in ('processing','completed','failed','waiting_assignment')),
  result jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into crm.automation_start_messages(message_key,message_text,is_active,sort_order)
values
  ('welcome','مرحباً بك في مجموعة محمد بن ذعار العجمي للسيارات 👋',true,10),
  ('service_menu','برجاء اختيار الخدمة:\n💰 مبيعات الكاش\n🏦 مبيعات التمويل\n🛠 خدمة العملاء',true,20)
on conflict(message_key) do update set
  message_text=excluded.message_text,is_active=excluded.is_active,sort_order=excluded.sort_order,updated_at=now();

insert into crm.automation_flows(flow_code,display_name,emoji,button_payload,service_key,department_code,branch_policy,branch_code,final_action,final_message,is_active,sort_order)
values
  ('cash','مبيعات الكاش','💰','service_cash','cash','cash_sales','system',null,
    '{"createOrUpdateCustomer":true,"setService":true,"setDepartment":true,"assignSales":true,"assignCallCenter":false,"assignCustomerService":false,"sendFinalMessage":true}'::jsonb,
    'تم تحويل طلبك إلى قسم مبيعات الكاش ✅\nسيتم التواصل معك قريباً',true,10),
  ('finance','مبيعات التمويل','🏦','service_finance','finance','finance_sales','fixed','online',
    '{"createOrUpdateCustomer":true,"setService":true,"setDepartment":true,"assignSales":true,"assignCallCenter":true,"assignCustomerService":false,"sendFinalMessage":true}'::jsonb,
    'سيتم التواصل معك في أقرب وقت\nنسعد بخدمتكم دائمًا 🌹',true,20),
  ('service','خدمة العملاء','🛠','service_cs','service','customer_service','fixed','customer_service',
    '{"createOrUpdateCustomer":true,"setService":true,"setDepartment":true,"assignSales":false,"assignCallCenter":false,"assignCustomerService":true,"sendFinalMessage":true}'::jsonb,
    'سيتم التواصل معك قريباً من أحد ممثلي قسم خدمة العملاء 👨‍🔧',true,30)
on conflict(flow_code) do update set
  display_name=excluded.display_name,emoji=excluded.emoji,button_payload=excluded.button_payload,
  service_key=excluded.service_key,department_code=excluded.department_code,branch_policy=excluded.branch_policy,
  branch_code=excluded.branch_code,final_action=excluded.final_action,final_message=excluded.final_message,
  is_active=excluded.is_active,sort_order=excluded.sort_order,updated_at=now();

insert into crm.automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
select f.id,v.alias_type,v.alias_value,v.normalized_value
from crm.automation_flows f
join (values
  ('cash','payload','service_cash','service cash'),('cash','text','💰 مبيعات الكاش','مبيعات الكاش'),('cash','text','مبيعات الكاش','مبيعات الكاش'),('cash','text','كاش','كاش'),('cash','number','1','1'),
  ('finance','payload','service_finance','service finance'),('finance','text','🏦 مبيعات التمويل','مبيعات التمويل'),('finance','text','مبيعات التمويل','مبيعات التمويل'),('finance','text','تمويل','تمويل'),('finance','number','2','2'),
  ('service','payload','service_cs','service cs'),('service','text','🛠 خدمة العملاء','خدمة العملاء'),('service','text','خدمة العملاء','خدمة العملاء'),('service','text','خدمه العملاء','خدمه العملاء'),('service','number','3','3')
) as v(flow_code,alias_type,alias_value,normalized_value) on v.flow_code=f.flow_code
on conflict(flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value;

insert into crm.automation_flow_steps(flow_id,step_key,step_name,prompt_text,step_type,customer_field,is_required,validation_rules,validation_error,max_attempts,is_active,sort_order)
select f.id,v.step_key,v.step_name,v.prompt_text,v.step_type,v.customer_field,v.is_required,v.validation_rules::jsonb,v.validation_error,v.max_attempts,v.is_active,v.sort_order
from crm.automation_flows f
join (values
  ('finance','finance_name','الاسم','برجاء إدخال بيانات التمويل 👇\nالاسم','text','customer_name',true,'{"minLength":2}','برجاء كتابة الاسم بشكل صحيح.',null,true,10),
  ('finance','finance_car','السيارة','السيارة','text','car_name',true,'{"minLength":1}','برجاء كتابة اسم السيارة.',null,true,20),
  ('finance','finance_phone','رقم الجوال','رقم الجوال','phone','phone',true,'{"country":"SA","mobileOnly":true}','رقم الجوال غير صحيح. برجاء إدخال رقم سعودي صحيح مثل 05XXXXXXXX.',null,true,30)
) as v(flow_code,step_key,step_name,prompt_text,step_type,customer_field,is_required,validation_rules,validation_error,max_attempts,is_active,sort_order) on v.flow_code=f.flow_code
on conflict(flow_id,step_key) do update set
  step_name=excluded.step_name,prompt_text=excluded.prompt_text,step_type=excluded.step_type,
  customer_field=excluded.customer_field,is_required=excluded.is_required,validation_rules=excluded.validation_rules,
  validation_error=excluded.validation_error,max_attempts=excluded.max_attempts,is_active=excluded.is_active,
  sort_order=excluded.sort_order,updated_at=now();

insert into crm.automation_platforms(platform_code,worker_code,is_enabled,connection_status,health_url,metadata)
select e.source_code,e.source_code,e.is_active,
  case when e.is_active and coalesce(nullif(e.text_send_url,''),nullif(e.send_url,'')) is not null then 'connected' else 'unknown' end,
  e.health_url,jsonb_build_object('seededFromIntegrationEndpoint',true)
from crm.integration_endpoints e
on conflict(platform_code) do update set
  worker_code=coalesce(crm.automation_platforms.worker_code,excluded.worker_code),
  health_url=coalesce(excluded.health_url,crm.automation_platforms.health_url),
  updated_at=now();

insert into core.schema_migrations(version)
values('crm-conversation-automation-v1.18.0')
on conflict(version) do nothing;
