begin;

-- The former automation tables mixed CRM entry-flow behavior with unrelated delayed
-- inbox jobs. Move the delayed-job infrastructure out of the automation namespace
-- before rebuilding the customer automation engine.
do $$
begin
  if to_regclass('crm.automation_settings') is not null and to_regclass('crm.crm_runtime_settings') is null then
    alter table crm.automation_settings rename to crm_runtime_settings;
  elsif to_regclass('crm.automation_settings') is not null then
    drop table crm.automation_settings cascade;
  end if;

  if to_regclass('crm.automation_events') is not null and to_regclass('crm.background_events') is null then
    alter table crm.automation_events rename to background_events;
  elsif to_regclass('crm.automation_events') is not null then
    drop table crm.automation_events cascade;
  end if;

  if to_regclass('crm.automation_jobs') is not null and to_regclass('crm.background_jobs') is null then
    alter table crm.automation_jobs rename to background_jobs;
  elsif to_regclass('crm.automation_jobs') is not null then
    drop table crm.automation_jobs cascade;
  end if;
end $$;

-- Preserve the non-flow CRM flags even on databases that never had the old table.
create table if not exists crm.crm_runtime_settings (
  id text primary key default 'default',
  closed_statuses jsonb not null default '{"cash":["تم البيع","غير مؤهل"],"finance":["تم البيع","غير مؤهل"],"service":["تم الانتهاء"]}'::jsonb,
  cash_total_customers_template_enabled boolean not null default false,
  finance_call_center_template_enabled boolean not null default false,
  updated_by uuid references core.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table crm.crm_runtime_settings add column if not exists closed_statuses jsonb not null default '{"cash":["تم البيع","غير مؤهل"],"finance":["تم البيع","غير مؤهل"],"service":["تم الانتهاء"]}'::jsonb;
alter table crm.crm_runtime_settings add column if not exists cash_total_customers_template_enabled boolean not null default false;
alter table crm.crm_runtime_settings add column if not exists finance_call_center_template_enabled boolean not null default false;
insert into crm.crm_runtime_settings(id) values('default') on conflict(id) do nothing;

create table if not exists crm.background_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  source text,
  contact_id uuid references crm.contacts(id) on delete set null,
  conversation_id uuid references crm.conversations(id) on delete set null,
  service_request_id uuid references crm.service_requests(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received',
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists crm.background_jobs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  job_type text not null,
  contact_id uuid references crm.contacts(id) on delete cascade,
  conversation_id uuid references crm.conversations(id) on delete cascade,
  service_request_id uuid references crm.service_requests(id) on delete cascade,
  lead_id uuid references crm.leads(id) on delete set null,
  trigger_message_id uuid references crm.messages(id) on delete set null,
  status text not null default 'queued',
  attempt integer not null default 1,
  due_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  scheduler_status text not null default 'pending',
  scheduler_message_id text,
  scheduler_error text,
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists crm_background_jobs_due_idx on crm.background_jobs(status,due_at);
create index if not exists crm_background_jobs_scheduler_idx on crm.background_jobs(scheduler_status,status,due_at);

-- Remove any previous customer-flow implementation and its data. This migration is
-- intentionally authoritative: after it runs, only the schema below owns automation.
drop table if exists crm.automation_final_actions cascade;
drop table if exists crm.automation_outbound_messages cascade;
drop table if exists crm.automation_answers cascade;
drop table if exists crm.automation_inbound_events cascade;
drop table if exists crm.automation_sessions cascade;
drop table if exists crm.automation_step_options cascade;
drop table if exists crm.automation_steps cascade;
drop table if exists crm.automation_choice_replies cascade;
drop table if exists crm.automation_choices cascade;
drop table if exists crm.automation_start_messages cascade;
drop table if exists crm.automation_platforms cascade;
drop table if exists crm.automation_definitions cascade;

create table crm.automation_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  trigger_policy text not null default 'every_message' check(trigger_policy in ('every_message','once_24_hours','custom_duration')),
  trigger_interval_seconds integer check(trigger_interval_seconds is null or trigger_interval_seconds > 0),
  version integer not null default 1,
  created_by uuid references core.users(id) on delete set null,
  updated_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(trigger_policy <> 'custom_duration' or trigger_interval_seconds is not null)
);

create table crm.automation_platforms (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references crm.automation_definitions(id) on delete cascade,
  source_code text not null,
  worker_code text,
  is_enabled boolean not null default false,
  last_health_status text,
  last_health_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(automation_id,source_code)
);

create table crm.automation_start_messages (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references crm.automation_definitions(id) on delete cascade,
  message_code text not null,
  body text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(automation_id,message_code),
  unique(automation_id,sort_order)
);

create table crm.automation_choices (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references crm.automation_definitions(id) on delete cascade,
  choice_code text not null,
  display_name text not null,
  emoji text,
  department_code text not null,
  service_key text not null check(service_key in ('cash','finance','service')),
  branch_policy text not null default 'system' check(branch_policy in ('system','fixed')),
  branch_code text,
  final_action jsonb not null default '{}'::jsonb,
  final_message text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(automation_id,choice_code),
  unique(automation_id,sort_order),
  check(branch_policy <> 'fixed' or nullif(branch_code,'') is not null)
);

create table crm.automation_choice_replies (
  id uuid primary key default gen_random_uuid(),
  choice_id uuid not null references crm.automation_choices(id) on delete cascade,
  reply_type text not null default 'text' check(reply_type in ('text','number','payload')),
  reply_value text not null,
  normalized_value text not null,
  created_at timestamptz not null default now(),
  unique(choice_id,reply_type,normalized_value)
);
create index crm_automation_choice_replies_match_idx on crm.automation_choice_replies(reply_type,normalized_value);

create table crm.automation_steps (
  id uuid primary key default gen_random_uuid(),
  choice_id uuid not null references crm.automation_choices(id) on delete cascade,
  step_code text not null,
  name text not null,
  prompt text not null,
  step_type text not null check(step_type in ('message','text','phone','choice')),
  customer_field_key text,
  is_required boolean not null default true,
  validation_rules jsonb not null default '{}'::jsonb,
  validation_error_message text,
  max_attempts integer check(max_attempts is null or max_attempts > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(choice_id,step_code),
  unique(choice_id,sort_order)
);

create table crm.automation_step_options (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references crm.automation_steps(id) on delete cascade,
  option_code text not null,
  label text not null,
  accepted_replies jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  unique(step_id,option_code),
  unique(step_id,sort_order)
);

create table crm.automation_sessions (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references crm.automation_definitions(id) on delete restrict,
  contact_id uuid not null references crm.contacts(id) on delete cascade,
  conversation_id uuid not null references crm.conversations(id) on delete cascade,
  platform_code text not null,
  worker_code text,
  trigger_policy text not null,
  selected_choice_id uuid references crm.automation_choices(id) on delete set null,
  current_step_id uuid references crm.automation_steps(id) on delete set null,
  status text not null check(status in ('awaiting_choice','sending','awaiting_answer','completed','cancelled','expired','failed')),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  completed_at timestamptz,
  final_action_result jsonb,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);
create unique index crm_automation_sessions_one_active_idx
  on crm.automation_sessions(conversation_id)
  where status in ('awaiting_choice','sending','awaiting_answer');
create unique index crm_automation_sessions_one_active_contact_idx
  on crm.automation_sessions(contact_id)
  where status in ('awaiting_choice','sending','awaiting_answer');
create index crm_automation_sessions_contact_idx on crm.automation_sessions(contact_id,last_activity_at desc);

create table crm.automation_inbound_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  provider_message_id text,
  conversation_id uuid not null references crm.conversations(id) on delete cascade,
  contact_id uuid not null references crm.contacts(id) on delete cascade,
  session_id uuid references crm.automation_sessions(id) on delete set null,
  platform_code text not null,
  worker_code text,
  message_text text,
  payload_value text,
  message_type text,
  occurred_at timestamptz not null,
  status text not null default 'received' check(status in ('received','processed','ignored','failed')),
  result jsonb not null default '{}'::jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index crm_automation_inbound_events_session_idx on crm.automation_inbound_events(session_id,occurred_at);

create table crm.automation_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references crm.automation_sessions(id) on delete cascade,
  step_id uuid not null references crm.automation_steps(id) on delete restrict,
  inbound_event_id uuid not null references crm.automation_inbound_events(id) on delete restrict,
  raw_value text,
  normalized_value text,
  validation_status text not null check(validation_status in ('valid','invalid')),
  validation_error text,
  attempt_number integer not null default 1,
  created_at timestamptz not null default now(),
  unique(session_id,step_id,inbound_event_id)
);
create index crm_automation_answers_session_idx on crm.automation_answers(session_id,created_at);

create table crm.automation_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references crm.automation_sessions(id) on delete cascade,
  step_id uuid references crm.automation_steps(id) on delete set null,
  message_kind text not null check(message_kind in ('start','step_message','question','validation_error','final')),
  idempotency_key text not null unique,
  body text not null,
  buttons jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
  provider_message_id text,
  http_status integer,
  provider_response jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz
);
create index crm_automation_outbound_messages_session_idx on crm.automation_outbound_messages(session_id,created_at);

create table crm.automation_final_actions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references crm.automation_sessions(id) on delete cascade,
  action_key text not null unique,
  choice_id uuid not null references crm.automation_choices(id) on delete restrict,
  contact_id uuid not null references crm.contacts(id) on delete restrict,
  conversation_id uuid not null references crm.conversations(id) on delete restrict,
  lead_id uuid references crm.leads(id) on delete set null,
  service_request_id uuid references crm.service_requests(id) on delete set null,
  status text not null default 'processing' check(status in ('processing','completed','failed')),
  assignment_result jsonb,
  final_message_result jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz
);

create index crm_automation_choices_active_idx on crm.automation_choices(automation_id,is_active,sort_order);
create index crm_automation_steps_active_idx on crm.automation_steps(choice_id,is_active,sort_order);
create index crm_automation_platforms_enabled_idx on crm.automation_platforms(automation_id,is_enabled,source_code);

-- Default, editable scenario agreed with the business.
insert into crm.automation_definitions(code,name,is_active,trigger_policy,trigger_interval_seconds)
values('default_customer_entry','أوتوميشن استقبال وتوزيع العملاء',true,'every_message',null);

insert into crm.automation_platforms(automation_id,source_code,worker_code,is_enabled)
select a.id,p.source_code,e.source_code,
       case when p.source_code='facebook' and e.is_active=true and nullif(coalesce(e.text_send_url,e.send_url),'') is not null then true else false end
from crm.automation_definitions a
cross join (values('facebook'),('instagram'),('whatsapp'),('tiktok')) p(source_code)
left join lateral (
  select * from crm.integration_endpoints ie
  where ie.source_code=p.source_code
     or (p.source_code='whatsapp' and ie.source_code='mersal')
  order by case when ie.source_code=p.source_code then 0 else 1 end
  limit 1
) e on true
where a.code='default_customer_entry';

insert into crm.automation_start_messages(automation_id,message_code,body,sort_order,is_active)
select id,'welcome',E'مرحباً بك في مجموعة محمد بن ذعار العجمي للسيارات 👋\n\nبرجاء اختيار الخدمة:\n💰 مبيعات الكاش\n🏦 مبيعات التمويل\n🛠 خدمة العملاء',10,true
from crm.automation_definitions where code='default_customer_entry';

insert into crm.automation_choices(automation_id,choice_code,display_name,emoji,department_code,service_key,branch_policy,branch_code,final_action,final_message,sort_order,is_active)
select a.id,v.choice_code,v.display_name,v.emoji,v.department_code,v.service_key,v.branch_policy,v.branch_code,v.final_action,v.final_message,v.sort_order,true
from crm.automation_definitions a
cross join (values
 ('cash','مبيعات الكاش','💰','cash_sales','cash','system',null::text,'{"createOrUpdateCustomer":true,"classifyService":true,"requestDistribution":true,"assignSales":true,"assignCallCenter":false,"assignCustomerService":false,"sendFinalMessage":true}'::jsonb,E'تم تحويل طلبك إلى قسم مبيعات الكاش ✅\nسيتم التواصل معك قريباً',10),
 ('finance','مبيعات التمويل','🏦','finance_sales','finance','system',null::text,'{"createOrUpdateCustomer":true,"classifyService":true,"requestDistribution":true,"assignSales":true,"assignCallCenter":true,"assignCustomerService":false,"sendFinalMessage":true}'::jsonb,E'سيتم التواصل معك في أقرب وقت\nنسعد بخدمتكم دائمًا 🌹',20),
 ('customer_service','خدمة العملاء','🛠','customer_service','service','system',null::text,'{"createOrUpdateCustomer":true,"classifyService":true,"requestDistribution":true,"assignSales":false,"assignCallCenter":false,"assignCustomerService":true,"sendFinalMessage":true}'::jsonb,'سيتم التواصل معك قريباً من أحد ممثلي قسم خدمة العملاء 👨‍🔧',30)
) v(choice_code,display_name,emoji,department_code,service_key,branch_policy,branch_code,final_action,final_message,sort_order)
where a.code='default_customer_entry';

insert into crm.automation_choice_replies(choice_id,reply_type,reply_value,normalized_value)
select c.id,v.reply_type,v.reply_value,v.normalized_value
from crm.automation_choices c
join crm.automation_definitions a on a.id=c.automation_id and a.code='default_customer_entry'
cross join lateral (
  select * from (values
    ('cash','text','مبيعات الكاش','مبيعات الكاش'),('cash','text','كاش','كاش'),('cash','number','1','1'),('cash','payload','cash','cash'),('cash','payload','service_cash','service cash'),
    ('finance','text','مبيعات التمويل','مبيعات التمويل'),('finance','text','تمويل','تمويل'),('finance','number','2','2'),('finance','payload','finance','finance'),('finance','payload','service_finance','service finance'),
    ('customer_service','text','خدمة العملاء','خدمه العملاء'),('customer_service','text','خدمة عملاء','خدمه عملاء'),('customer_service','number','3','3'),('customer_service','payload','customer_service','customer service'),('customer_service','payload','service_cs','service cs')
  ) r(choice_code,reply_type,reply_value,normalized_value)
  where r.choice_code=c.choice_code
) v;

insert into crm.automation_steps(choice_id,step_code,name,prompt,step_type,customer_field_key,is_required,validation_rules,validation_error_message,max_attempts,sort_order,is_active)
select c.id,v.step_code,v.name,v.prompt,v.step_type,v.customer_field_key,true,v.validation_rules,v.validation_error_message,v.max_attempts,v.sort_order,true
from crm.automation_choices c
join crm.automation_definitions a on a.id=c.automation_id and a.code='default_customer_entry'
cross join (values
 ('finance','finance_name','الاسم',E'برجاء إدخال بيانات التمويل 👇\nالاسم','text','customer_name','{"minLength":2,"maxLength":120}'::jsonb,'برجاء إدخال الاسم بصورة صحيحة.',3,10),
 ('finance','finance_car','السيارة','السيارة','text','car_name','{"minLength":1,"maxLength":120}'::jsonb,'برجاء إدخال اسم السيارة.',3,20),
 ('finance','finance_phone','رقم الجوال','رقم الجوال','phone','phone','{"country":"SA","normalize":true,"deduplicate":true}'::jsonb,'رقم الجوال غير صحيح. برجاء إدخال رقم سعودي صحيح.',null,30)
) v(choice_code,step_code,name,prompt,step_type,customer_field_key,validation_rules,validation_error_message,max_attempts,sort_order)
where c.choice_code=v.choice_code;

insert into core.schema_migrations(version)
values('crm-automation-flow-rebuild-v1.18.0')
on conflict(version) do nothing;

commit;
