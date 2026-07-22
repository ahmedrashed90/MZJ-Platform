alter table crm.automation_settings add column if not exists automation_enabled boolean not null default true;
alter table crm.automation_settings add column if not exists automation_name text not null default 'أوتوميشن استقبال عملاء CRM';
alter table crm.automation_settings add column if not exists platform_workers jsonb not null default '[{"platformCode":"facebook","workerCode":"facebook","enabled":true},{"platformCode":"instagram","workerCode":"instagram","enabled":true},{"platformCode":"whatsapp","workerCode":"whatsapp","enabled":true},{"platformCode":"tiktok","workerCode":"tiktok-snapchat","enabled":true},{"platformCode":"snapchat","workerCode":"tiktok-snapchat","enabled":true}]'::jsonb;
alter table crm.automation_settings add column if not exists trigger_mode text not null default 'every_message';
alter table crm.automation_settings add column if not exists custom_interval_value integer not null default 24;
alter table crm.automation_settings add column if not exists custom_interval_unit text not null default 'hour';
alter table crm.automation_settings add column if not exists schedule_enabled boolean not null default false;
alter table crm.automation_settings add column if not exists schedule_start time not null default '08:00';
alter table crm.automation_settings add column if not exists schedule_end time not null default '23:00';
alter table crm.automation_settings add column if not exists schedule_days integer[] not null default array[0,1,2,3,4,5,6];
alter table crm.automation_settings add column if not exists automation_messages jsonb not null default '{"start":{"enabled":true,"text":"السلام عليكم ورحمة الله وبركاته"},"welcome":{"enabled":true,"text":"أهلًا وسهلًا بك في مجموعة محمد ذعار العجمي للسيارات 🌹"},"servicePrompt":{"enabled":true,"text":"برجاء اختيار الخدمة المطلوبة 👇"},"noMatch":{"enabled":true,"text":"برجاء اختيار إحدى الخدمات الظاهرة في القائمة."},"validationFallback":{"enabled":true,"text":"برجاء إدخال البيانات بصورة صحيحة."},"cancelled":{"enabled":true,"text":"تم إلغاء الطلب الحالي. يمكنك إرسال رسالة جديدة للبدء مرة أخرى."},"restarted":{"enabled":false,"text":"تمت إعادة بداية الطلب."}}'::jsonb;
alter table crm.automation_settings add column if not exists flow_timeout_value integer not null default 24;
alter table crm.automation_settings add column if not exists flow_timeout_unit text not null default 'hour';
alter table crm.automation_settings add column if not exists restart_keywords text[] not null default array['البداية','ابدأ من جديد','القائمة'];
alter table crm.automation_settings add column if not exists cancel_keywords text[] not null default array['إلغاء','الغاء','خروج'];
alter table crm.automation_settings add column if not exists automation_version integer not null default 1;

update crm.automation_settings
set automation_enabled=service_selection_enabled,
    automation_messages=jsonb_set(
      coalesce(automation_messages,'{}'::jsonb),
      '{servicePrompt}',
      jsonb_build_object('enabled',true,'text',coalesce(nullif(service_selection_message,''),'برجاء اختيار الخدمة المطلوبة 👇')),
      true
    ),
    updated_at=now()
where id='default';

create table if not exists crm.customer_automation_runs (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references crm.contacts(id) on delete cascade,
  conversation_id uuid not null references crm.conversations(id) on delete cascade,
  service_request_id uuid references crm.service_requests(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  platform_code text,
  worker_code text,
  option_key text,
  service_key text,
  status text not null default 'awaiting_service',
  current_step_key text,
  current_step_index integer not null default 0,
  current_attempt integer not null default 0,
  answers jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  last_event_key text,
  last_message_id text,
  last_automation_message text,
  automation_version integer not null default 1,
  settings_snapshot jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  expires_at timestamptz,
  completed_at timestamptz,
  termination_reason text,
  updated_at timestamptz not null default now()
);
alter table crm.customer_automation_runs add column if not exists automation_version integer not null default 1;
alter table crm.customer_automation_runs add column if not exists settings_snapshot jsonb not null default '{}'::jsonb;

create index if not exists crm_customer_automation_runs_conversation_idx on crm.customer_automation_runs(conversation_id,started_at desc);
create index if not exists crm_customer_automation_runs_contact_idx on crm.customer_automation_runs(contact_id,started_at desc);
create unique index if not exists crm_customer_automation_runs_one_active
  on crm.customer_automation_runs(conversation_id)
  where status in ('awaiting_service','classifying','awaiting_step');
create unique index if not exists crm_customer_automation_runs_one_active_contact
  on crm.customer_automation_runs(contact_id)
  where contact_id is not null and status in ('awaiting_service','classifying','awaiting_step');

insert into core.schema_migrations(version) values('crm-customer-automation-v1.18.0') on conflict(version) do nothing;
