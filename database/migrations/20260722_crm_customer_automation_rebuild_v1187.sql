-- Clean rebuild of CRM customer-entry automation.
-- These tables are owned only by this automation feature, so old experimental state is removed.
drop table if exists crm.customer_automation_events cascade;
drop table if exists crm.customer_automation_runs cascade;
drop table if exists crm.customer_automation_session_events cascade;
drop table if exists crm.customer_automation_sessions cascade;
drop table if exists crm.customer_automation_settings cascade;

create table crm.customer_automation_settings (
  id text primary key default 'default',
  enabled boolean not null default true,
  automation_name text not null default 'أوتوميشن استقبال عملاء CRM',
  trigger_policy text not null default 'every_message',
  interval_value integer not null default 24,
  interval_unit text not null default 'hour',
  platform_bindings jsonb not null default '[]'::jsonb,
  entry_messages jsonb not null default '{"greeting":"مرحباً بك في مجموعة محمد بن ذعار العجمي للسيارات 👋","servicePrompt":"برجاء اختيار الخدمة:","noMatch":"برجاء اختيار إحدى الخدمات الظاهرة في القائمة."}'::jsonb,
  service_choices jsonb not null default '[{"key":"cash","label":"مبيعات الكاش","emoji":"💰","aliases":["1","كاش","مبيعات كاش","مبيعات الكاش","شراء كاش"],"enabled":true,"sortOrder":10},{"key":"finance","label":"مبيعات التمويل","emoji":"🏦","aliases":["2","تمويل","مبيعات تمويل","مبيعات التمويل","شراء تمويل"],"enabled":true,"sortOrder":20},{"key":"service","label":"خدمة العملاء","emoji":"🛠","aliases":["3","خدمة العملاء","خدمه العملاء","خدمة","خدمة عملاء"],"enabled":true,"sortOrder":30}]'::jsonb,
  flow_messages jsonb not null default '{"cash":{"completionMessage":"تم تحويل طلبك إلى قسم مبيعات الكاش ✅\nسيتم التواصل معك قريباً"},"finance":{"startMessage":"برجاء إدخال بيانات التمويل 👇","nameQuestion":"الاسم","nameError":"برجاء إدخال الاسم.","carQuestion":"السيارة","carError":"برجاء إدخال السيارة المطلوبة.","phoneQuestion":"رقم الجوال","phoneError":"برجاء إدخال رقم جوال صحيح.","completionMessage":"سيتم التواصل معك في أقرب وقت\nنسعد بخدمتكم دائمًا 🌹"},"service":{"completionMessage":"سيتم التواصل معك قريباً من أحد ممثلي قسم خدمة العملاء 👨‍🔧"}}'::jsonb,
  version integer not null default 1,
  updated_by uuid references core.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint crm_customer_automation_trigger_policy_chk check(trigger_policy in ('every_message','every_24_hours','custom_interval')),
  constraint crm_customer_automation_interval_unit_chk check(interval_unit in ('minute','hour','day')),
  constraint crm_customer_automation_interval_value_chk check(interval_value > 0)
);

insert into crm.customer_automation_settings(id)
values('default');

update crm.customer_automation_settings settings
set platform_bindings = coalesce((
  select jsonb_agg(
    jsonb_build_object(
      'platformCode', case
        when lower(endpoint.source_code) like '%facebook%' then 'facebook'
        when lower(endpoint.source_code) like '%instagram%' then 'instagram'
        when lower(endpoint.source_code) like '%whatsapp%' or lower(endpoint.source_code) like '%mersal%' then 'whatsapp'
        when lower(endpoint.source_code) like '%tiktok%' then 'tiktok'
        when lower(endpoint.source_code) like '%snapchat%' then 'snapchat'
        else lower(endpoint.source_code)
      end,
      'workerCode', lower(endpoint.source_code),
      'enabled', true
    ) order by endpoint.source_code
  )
  from crm.integration_endpoints endpoint
  where endpoint.is_active=true and coalesce(endpoint.text_send_url,endpoint.send_url,'')<>''
), '[]'::jsonb)
where settings.id='default';

create table crm.customer_automation_sessions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm.contacts(id) on delete cascade,
  conversation_id uuid not null references crm.conversations(id) on delete cascade,
  service_request_id uuid references crm.service_requests(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  platform_code text not null,
  worker_code text not null,
  choice_key text,
  service_key text,
  state text not null default 'awaiting_service',
  customer_name text,
  car_name text,
  phone text,
  phone_normalized text,
  last_inbound_event_key text,
  last_inbound_message_id text,
  last_outbound_key text,
  last_outbound_message_id uuid references crm.messages(id) on delete set null,
  settings_version integer not null,
  settings_snapshot jsonb not null,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint crm_customer_automation_session_state_chk check(state in (
    'awaiting_service','awaiting_name','awaiting_car','awaiting_phone','completed','cancelled','failed'
  )),
  constraint crm_customer_automation_session_choice_chk check(choice_key is null or choice_key in ('cash','finance','service'))
);

create unique index crm_customer_automation_one_active_contact
  on crm.customer_automation_sessions(contact_id)
  where state in ('awaiting_service','awaiting_name','awaiting_car','awaiting_phone');
create index crm_customer_automation_sessions_conversation_idx
  on crm.customer_automation_sessions(conversation_id,started_at desc);
create index crm_customer_automation_sessions_contact_idx
  on crm.customer_automation_sessions(contact_id,started_at desc);

create table crm.customer_automation_session_events (
  id bigserial primary key,
  session_id uuid not null references crm.customer_automation_sessions(id) on delete cascade,
  event_key text not null unique,
  event_type text not null,
  state_before text,
  state_after text,
  message_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index crm_customer_automation_session_events_session_idx
  on crm.customer_automation_session_events(session_id,created_at);

insert into core.schema_migrations(version)
values('crm-customer-automation-rebuild-v1.18.7')
on conflict(version) do nothing;
