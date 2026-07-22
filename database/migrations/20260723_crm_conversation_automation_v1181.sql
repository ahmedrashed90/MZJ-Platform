-- MZJ CRM Conversation Automation v1.18.1
-- Clean rebuild. Run once on PostgreSQL before opening the Automation Settings page.
-- This migration deliberately does not alter crm.automation_events / crm.automation_jobs,
-- because those belong to the existing inbox-agent scheduler.

begin;

create extension if not exists pgcrypto;
create schema if not exists crm;

-- Remove only the incomplete v1.18.0 conversation-automation implementation.
drop table if exists crm.automation_final_actions cascade;
drop table if exists crm.automation_outbound_messages cascade;
drop table if exists crm.automation_answers cascade;
drop table if exists crm.automation_inbound_events cascade;
drop table if exists crm.automation_sessions cascade;
drop table if exists crm.automation_flow_steps cascade;
drop table if exists crm.automation_flow_aliases cascade;
drop table if exists crm.automation_flows cascade;
drop table if exists crm.automation_start_messages cascade;
drop table if exists crm.automation_platforms cascade;

-- Retire the old service-menu fields and the incomplete v1.18.0 settings fields.
-- crm.automation_settings remains only for the independent closed-status scheduler.
alter table if exists crm.automation_settings drop constraint if exists crm_automation_settings_trigger_policy_check;
alter table if exists crm.automation_settings drop constraint if exists crm_automation_settings_interval_unit_check;
alter table if exists crm.automation_settings drop constraint if exists crm_automation_settings_interval_value_check;
alter table if exists crm.automation_settings drop column if exists automation_name;
alter table if exists crm.automation_settings drop column if exists automation_enabled;
alter table if exists crm.automation_settings drop column if exists trigger_policy;
alter table if exists crm.automation_settings drop column if exists custom_interval_value;
alter table if exists crm.automation_settings drop column if exists custom_interval_unit;
alter table if exists crm.automation_settings drop column if exists service_selection_enabled;
alter table if exists crm.automation_settings drop column if exists service_selection_message;
alter table if exists crm.automation_settings drop column if exists service_options;
alter table if exists crm.automation_settings drop column if exists ask_for_branch;
alter table if exists crm.automation_settings drop column if exists no_match_behavior;
alter table if exists crm.automation_settings drop column if exists unclassified_label;

create table if not exists crm.conversation_automation_settings (
  id text primary key default 'default',
  automation_name text not null default 'أوتوميشن استقبال العملاء',
  automation_enabled boolean not null default true,
  trigger_policy text not null default 'every_message'
    check (trigger_policy in ('every_message','once_24_hours','custom')),
  custom_interval_value integer not null default 24
    check (custom_interval_value between 1 and 100000),
  custom_interval_unit text not null default 'hour'
    check (custom_interval_unit in ('minute','hour','day')),
  updated_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm.conversation_automation_platforms (
  id uuid primary key default gen_random_uuid(),
  platform_code text not null unique,
  worker_code text,
  is_enabled boolean not null default false,
  connection_status text not null default 'unknown'
    check (connection_status in ('unknown','connected','disconnected','error')),
  health_url text,
  last_success_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  updated_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm.conversation_automation_start_messages (
  id uuid primary key default gen_random_uuid(),
  message_key text not null unique,
  message_text text not null,
  is_active boolean not null default true,
  sort_order integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm.conversation_automation_flows (
  id uuid primary key default gen_random_uuid(),
  flow_code text not null unique,
  display_name text not null,
  emoji text,
  button_payload text,
  service_key text not null,
  department_code text not null,
  branch_policy text not null default 'system'
    check (branch_policy in ('system','fixed')),
  branch_code text,
  final_action jsonb not null default '{}'::jsonb,
  final_message text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm.conversation_automation_flow_aliases (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references crm.conversation_automation_flows(id) on delete cascade,
  alias_type text not null default 'text'
    check (alias_type in ('text','number','payload')),
  alias_value text not null,
  normalized_value text not null,
  created_at timestamptz not null default now(),
  unique (flow_id, alias_type, normalized_value)
);
create index if not exists crm_conversation_automation_alias_lookup_idx
  on crm.conversation_automation_flow_aliases(alias_type, normalized_value);

create table if not exists crm.conversation_automation_flow_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references crm.conversation_automation_flows(id) on delete cascade,
  step_key text not null,
  step_name text not null,
  prompt_text text not null,
  step_type text not null check (step_type in ('message','text','phone','choice')),
  customer_field text,
  is_required boolean not null default true,
  validation_rules jsonb not null default '{}'::jsonb,
  validation_error text not null default 'البيانات المدخلة غير صحيحة، برجاء المحاولة مرة أخرى.',
  max_attempts integer check (max_attempts is null or max_attempts > 0),
  is_active boolean not null default true,
  sort_order integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (flow_id, step_key)
);
create index if not exists crm_conversation_automation_steps_order_idx
  on crm.conversation_automation_flow_steps(flow_id, is_active, sort_order, id);

create table if not exists crm.conversation_automation_sessions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm.contacts(id) on delete cascade,
  conversation_id uuid not null references crm.conversations(id) on delete cascade,
  platform_code text not null,
  worker_code text,
  trigger_policy text not null,
  flow_id uuid references crm.conversation_automation_flows(id) on delete set null,
  current_step_id uuid references crm.conversation_automation_flow_steps(id) on delete set null,
  status text not null default 'awaiting_service'
    check (status in ('awaiting_service','awaiting_answer','completed','cancelled','expired','failed')),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  completed_at timestamptz,
  final_result jsonb not null default '{}'::jsonb,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_conversation_automation_one_active_contact_idx
  on crm.conversation_automation_sessions(contact_id)
  where status in ('awaiting_service','awaiting_answer');
create unique index if not exists crm_conversation_automation_one_active_conversation_idx
  on crm.conversation_automation_sessions(conversation_id)
  where status in ('awaiting_service','awaiting_answer');
create index if not exists crm_conversation_automation_sessions_history_idx
  on crm.conversation_automation_sessions(contact_id, started_at desc);

create table if not exists crm.conversation_automation_inbound_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  provider_message_id text,
  platform_code text not null,
  contact_id uuid references crm.contacts(id) on delete set null,
  conversation_id uuid references crm.conversations(id) on delete cascade,
  session_id uuid references crm.conversation_automation_sessions(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received'
    check (status in ('received','processing','processed','ignored','failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index if not exists crm_conversation_automation_provider_event_idx
  on crm.conversation_automation_inbound_events(platform_code, provider_message_id)
  where provider_message_id is not null and provider_message_id <> '';
create index if not exists crm_conversation_automation_inbound_history_idx
  on crm.conversation_automation_inbound_events(conversation_id, received_at desc);

create table if not exists crm.conversation_automation_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references crm.conversation_automation_sessions(id) on delete cascade,
  step_id uuid not null references crm.conversation_automation_flow_steps(id) on delete cascade,
  inbound_event_id uuid references crm.conversation_automation_inbound_events(id) on delete set null,
  raw_value text not null,
  normalized_value text,
  validation_status text not null default 'valid'
    check (validation_status in ('valid','invalid')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, step_id)
);

create table if not exists crm.conversation_automation_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  session_id uuid references crm.conversation_automation_sessions(id) on delete cascade,
  conversation_id uuid not null references crm.conversations(id) on delete cascade,
  step_id uuid references crm.conversation_automation_flow_steps(id) on delete set null,
  message_kind text not null check (message_kind in ('start','question','validation_error','final')),
  message_text text not null,
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  provider_message_id text,
  http_status integer,
  error_message text,
  provider_response jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz
);
create index if not exists crm_conversation_automation_outbound_history_idx
  on crm.conversation_automation_outbound_messages(session_id, created_at);

create table if not exists crm.conversation_automation_final_actions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references crm.conversation_automation_sessions(id) on delete cascade,
  contact_id uuid not null references crm.contacts(id) on delete cascade,
  conversation_id uuid not null references crm.conversations(id) on delete cascade,
  flow_id uuid not null references crm.conversation_automation_flows(id) on delete restrict,
  service_request_id uuid references crm.service_requests(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  status text not null default 'processing'
    check (status in ('processing','completed','failed','waiting_assignment')),
  result jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into crm.conversation_automation_settings(
  id, automation_name, automation_enabled, trigger_policy, custom_interval_value, custom_interval_unit
) values ('default','أوتوميشن استقبال العملاء',true,'every_message',24,'hour')
on conflict (id) do update set
  automation_name=excluded.automation_name,
  automation_enabled=excluded.automation_enabled,
  trigger_policy=excluded.trigger_policy,
  custom_interval_value=excluded.custom_interval_value,
  custom_interval_unit=excluded.custom_interval_unit,
  updated_at=now();

insert into crm.conversation_automation_start_messages(message_key,message_text,is_active,sort_order)
values ('welcome','مرحباً بك في مجموعة محمد بن ذعار العجمي للسيارات 👋',true,10)
on conflict (message_key) do update set message_text=excluded.message_text,is_active=true,sort_order=10,updated_at=now();

insert into crm.conversation_automation_start_messages(message_key,message_text,is_active,sort_order)
values ('service_menu',E'برجاء اختيار الخدمة:\n💰 مبيعات الكاش\n🏦 مبيعات التمويل\n🛠 خدمة العملاء',true,20)
on conflict (message_key) do update set message_text=excluded.message_text,is_active=true,sort_order=20,updated_at=now();

insert into crm.conversation_automation_flows(
  flow_code,display_name,emoji,button_payload,service_key,department_code,branch_policy,branch_code,final_action,final_message,is_active,sort_order
) values (
  'cash','مبيعات الكاش','💰','service_cash','cash','cash_sales','system',null,
  '{"createOrUpdateCustomer":true,"setService":true,"setDepartment":true,"assignSales":true,"assignCallCenter":false,"assignCustomerService":false,"sendFinalMessage":true}'::jsonb,
  E'تم تحويل طلبك إلى قسم مبيعات الكاش ✅\nسيتم التواصل معك قريباً',true,10
) on conflict (flow_code) do update set
  display_name=excluded.display_name,emoji=excluded.emoji,button_payload=excluded.button_payload,
  service_key=excluded.service_key,department_code=excluded.department_code,branch_policy=excluded.branch_policy,
  branch_code=excluded.branch_code,final_action=excluded.final_action,final_message=excluded.final_message,
  is_active=true,sort_order=10,updated_at=now();

insert into crm.conversation_automation_flows(
  flow_code,display_name,emoji,button_payload,service_key,department_code,branch_policy,branch_code,final_action,final_message,is_active,sort_order
) values (
  'finance','مبيعات التمويل','🏦','service_finance','finance','finance_sales','fixed','online',
  '{"createOrUpdateCustomer":true,"setService":true,"setDepartment":true,"assignSales":true,"assignCallCenter":true,"assignCustomerService":false,"sendFinalMessage":true}'::jsonb,
  E'سيتم التواصل معك في أقرب وقت\nنسعد بخدمتكم دائمًا 🌹',true,20
) on conflict (flow_code) do update set
  display_name=excluded.display_name,emoji=excluded.emoji,button_payload=excluded.button_payload,
  service_key=excluded.service_key,department_code=excluded.department_code,branch_policy=excluded.branch_policy,
  branch_code=excluded.branch_code,final_action=excluded.final_action,final_message=excluded.final_message,
  is_active=true,sort_order=20,updated_at=now();

insert into crm.conversation_automation_flows(
  flow_code,display_name,emoji,button_payload,service_key,department_code,branch_policy,branch_code,final_action,final_message,is_active,sort_order
) values (
  'service','خدمة العملاء','🛠','service_cs','service','customer_service','fixed','customer_service',
  '{"createOrUpdateCustomer":true,"setService":true,"setDepartment":true,"assignSales":false,"assignCallCenter":false,"assignCustomerService":true,"sendFinalMessage":true}'::jsonb,
  'سيتم التواصل معك قريباً من أحد ممثلي قسم خدمة العملاء 👨‍🔧',true,30
) on conflict (flow_code) do update set
  display_name=excluded.display_name,emoji=excluded.emoji,button_payload=excluded.button_payload,
  service_key=excluded.service_key,department_code=excluded.department_code,branch_policy=excluded.branch_policy,
  branch_code=excluded.branch_code,final_action=excluded.final_action,final_message=excluded.final_message,
  is_active=true,sort_order=30,updated_at=now();

-- Insert accepted replies one row at a time. This avoids duplicate constrained values
-- inside a single ON CONFLICT command and keeps the migration safe to rerun.
with f as (select id from crm.conversation_automation_flows where flow_code='cash')
insert into crm.conversation_automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
select id,'payload','service_cash','service cash' from f
on conflict (flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value;
with f as (select id from crm.conversation_automation_flows where flow_code='cash')
insert into crm.conversation_automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
select id,'text','مبيعات الكاش','مبيعات الكاش' from f
on conflict (flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value;
with f as (select id from crm.conversation_automation_flows where flow_code='cash')
insert into crm.conversation_automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
select id,'text','كاش','كاش' from f
on conflict (flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value;
with f as (select id from crm.conversation_automation_flows where flow_code='cash')
insert into crm.conversation_automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
select id,'number','1','1' from f
on conflict (flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value;

with f as (select id from crm.conversation_automation_flows where flow_code='finance')
insert into crm.conversation_automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
select id,'payload','service_finance','service finance' from f
on conflict (flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value;
with f as (select id from crm.conversation_automation_flows where flow_code='finance')
insert into crm.conversation_automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
select id,'text','مبيعات التمويل','مبيعات التمويل' from f
on conflict (flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value;
with f as (select id from crm.conversation_automation_flows where flow_code='finance')
insert into crm.conversation_automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
select id,'text','تمويل','تمويل' from f
on conflict (flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value;
with f as (select id from crm.conversation_automation_flows where flow_code='finance')
insert into crm.conversation_automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
select id,'number','2','2' from f
on conflict (flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value;

with f as (select id from crm.conversation_automation_flows where flow_code='service')
insert into crm.conversation_automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
select id,'payload','service_cs','service cs' from f
on conflict (flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value;
with f as (select id from crm.conversation_automation_flows where flow_code='service')
insert into crm.conversation_automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
select id,'text','خدمة العملاء','خدمه العملاء' from f
on conflict (flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value;
with f as (select id from crm.conversation_automation_flows where flow_code='service')
insert into crm.conversation_automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
select id,'text','خدمة عملاء','خدمه عملاء' from f
on conflict (flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value;
with f as (select id from crm.conversation_automation_flows where flow_code='service')
insert into crm.conversation_automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
select id,'number','3','3' from f
on conflict (flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value;

with f as (select id from crm.conversation_automation_flows where flow_code='finance')
insert into crm.conversation_automation_flow_steps(
  flow_id,step_key,step_name,prompt_text,step_type,customer_field,is_required,validation_rules,validation_error,max_attempts,is_active,sort_order
)
select id,'finance_name','الاسم',E'برجاء إدخال بيانات التمويل 👇\nالاسم','text','customer_name',true,'{"minLength":2}'::jsonb,'برجاء كتابة الاسم بشكل صحيح.',null::integer,true,10 from f
on conflict (flow_id,step_key) do update set
  step_name=excluded.step_name,prompt_text=excluded.prompt_text,step_type=excluded.step_type,
  customer_field=excluded.customer_field,is_required=excluded.is_required,validation_rules=excluded.validation_rules,
  validation_error=excluded.validation_error,max_attempts=excluded.max_attempts,is_active=true,sort_order=10,updated_at=now();

with f as (select id from crm.conversation_automation_flows where flow_code='finance')
insert into crm.conversation_automation_flow_steps(
  flow_id,step_key,step_name,prompt_text,step_type,customer_field,is_required,validation_rules,validation_error,max_attempts,is_active,sort_order
)
select id,'finance_car','السيارة','السيارة','text','car_name',true,'{"minLength":1}'::jsonb,'برجاء كتابة اسم السيارة.',null::integer,true,20 from f
on conflict (flow_id,step_key) do update set
  step_name=excluded.step_name,prompt_text=excluded.prompt_text,step_type=excluded.step_type,
  customer_field=excluded.customer_field,is_required=excluded.is_required,validation_rules=excluded.validation_rules,
  validation_error=excluded.validation_error,max_attempts=excluded.max_attempts,is_active=true,sort_order=20,updated_at=now();

with f as (select id from crm.conversation_automation_flows where flow_code='finance')
insert into crm.conversation_automation_flow_steps(
  flow_id,step_key,step_name,prompt_text,step_type,customer_field,is_required,validation_rules,validation_error,max_attempts,is_active,sort_order
)
select id,'finance_phone','رقم الجوال','رقم الجوال','phone','phone',true,'{"country":"SA","mobileOnly":true}'::jsonb,'رقم الجوال غير صحيح. برجاء إدخال رقم سعودي صحيح مثل 05XXXXXXXX.',null::integer,true,30 from f
on conflict (flow_id,step_key) do update set
  step_name=excluded.step_name,prompt_text=excluded.prompt_text,step_type=excluded.step_type,
  customer_field=excluded.customer_field,is_required=excluded.is_required,validation_rules=excluded.validation_rules,
  validation_error=excluded.validation_error,max_attempts=excluded.max_attempts,is_active=true,sort_order=30,updated_at=now();

-- Register the current integration endpoints as available platform/worker mappings.
-- They start disabled so the administrator explicitly chooses where automation runs.
insert into crm.conversation_automation_platforms(
  platform_code,worker_code,is_enabled,connection_status,health_url,metadata
)
select lower(e.source_code),e.source_code,false,
  'unknown',
  e.health_url,jsonb_build_object('seededFromIntegrationEndpoint',true)
from crm.integration_endpoints e
where coalesce(nullif(e.source_code,''),'') <> ''
on conflict (platform_code) do update set
  worker_code=coalesce(crm.conversation_automation_platforms.worker_code,excluded.worker_code),
  health_url=coalesce(excluded.health_url,crm.conversation_automation_platforms.health_url),
  connection_status=excluded.connection_status,
  updated_at=now();

insert into core.schema_migrations(version)
values ('crm-conversation-automation-v1.18.1')
on conflict (version) do nothing;

commit;
