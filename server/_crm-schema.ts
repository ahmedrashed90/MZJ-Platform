import { getSql, runSqlScript } from "./_db.js";

let schemaPromise: Promise<void> | null = null;

const CRM_SCHEMA_SQL = String.raw`
create table if not exists core.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

alter table crm.leads add column if not exists age integer;
alter table crm.leads add column if not exists salary numeric(14,2);
alter table crm.leads add column if not exists obligation numeric(14,2);
alter table crm.leads add column if not exists salary_bank text;
alter table crm.leads add column if not exists car_model text;
alter table crm.leads add column if not exists car_type text;
alter table crm.leads add column if not exists car_category text;
alter table crm.leads add column if not exists unread_count integer not null default 0;
alter table crm.leads add column if not exists dashboard_unread boolean not null default false;
alter table crm.leads add column if not exists has_unread_message boolean not null default false;
alter table crm.leads add column if not exists has_unread_messages boolean not null default false;
alter table crm.leads add column if not exists message_unread boolean not null default false;
alter table crm.leads add column if not exists is_unread boolean not null default false;
alter table crm.leads add column if not exists last_message_direction text;
alter table crm.leads add column if not exists last_incoming_message_at timestamptz;
alter table crm.leads add column if not exists last_message_at timestamptz;
alter table crm.leads add column if not exists dashboard_message_read_at timestamptz;
alter table crm.leads add column if not exists color text;
alter table crm.leads add column if not exists finance_type text;
alter table crm.leads add column if not exists follow_up_at timestamptz;
alter table crm.leads add column if not exists campaign_name text;
alter table crm.leads add column if not exists campaign_date date;
alter table crm.leads add column if not exists source_history jsonb not null default '[]'::jsonb;
alter table crm.leads add column if not exists extra_data jsonb not null default '{}'::jsonb;
alter table crm.leads add column if not exists created_by uuid references core.users(id);
alter table crm.leads add column if not exists updated_by uuid references core.users(id);
alter table crm.leads add column if not exists deleted_by uuid references core.users(id);
alter table crm.leads add column if not exists deleted_at timestamptz;
alter table crm.leads add column if not exists registered_at timestamptz;
alter table crm.leads add column if not exists status_note text;
alter table crm.leads add column if not exists completion_percent integer;
alter table crm.leads add column if not exists assignment_mode text;
alter table crm.leads add column if not exists last_contact_at timestamptz;
alter table crm.leads add column if not exists responsible_name_snapshot text;
alter table crm.leads add column if not exists call_center_name_snapshot text;

alter table crm.conversations add column if not exists service_key text;
alter table crm.conversations add column if not exists department_code text;
alter table crm.conversations add column if not exists branch_code text;
alter table crm.conversations add column if not exists assigned_to uuid references core.users(id);
alter table crm.conversations add column if not exists call_center_assigned_to uuid references core.users(id);
alter table crm.conversations add column if not exists provider text;
alter table crm.conversations add column if not exists page_id text;
alter table crm.conversations add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table crm.messages add column if not exists attachment_type text;
alter table crm.messages add column if not exists file_name text;
alter table crm.messages add column if not exists mime_type text;
alter table crm.messages add column if not exists provider_message_id text;
alter table crm.messages add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists crm.dashboard_statuses (
  id text primary key,
  department_code text not null,
  label text not null,
  value text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_dashboard_statuses_department_idx on crm.dashboard_statuses(department_code, sort_order);

create table if not exists crm.sources (
  code text primary key,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists crm.lead_events (
  id bigserial primary key,
  lead_id uuid not null references crm.leads(id) on delete cascade,
  event_type text not null,
  old_status text,
  new_status text,
  old_department text,
  new_department text,
  old_branch text,
  new_branch text,
  actor_id uuid references core.users(id),
  actor_name text,
  actor_role text,
  note text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists crm_lead_events_lead_idx on crm.lead_events(lead_id, created_at desc);

create table if not exists crm.manual_lead_requests (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text not null,
  phone_normalized text not null,
  source_code text,
  payment_type text,
  service_key text,
  department_code text,
  branch_code text,
  car_name text,
  location text,
  notes text,
  requested_assigned_to uuid references core.users(id),
  requested_call_center_to uuid references core.users(id),
  duplicate_lead_id uuid references crm.leads(id),
  approval_status text not null default 'pending',
  approval_note text,
  requested_by uuid references core.users(id),
  reviewed_by uuid references core.users(id),
  reviewed_at timestamptz,
  created_lead_id uuid references crm.leads(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_manual_requests_status_idx on crm.manual_lead_requests(approval_status, created_at desc);

create table if not exists crm.message_templates (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  name text not null,
  display_name text not null,
  content text not null,
  template_type text not null default 'quick_message',
  provider text,
  language_code text,
  departments text[] not null default '{}',
  status text not null default 'active',
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_message_templates_external_unique on crm.message_templates(provider, external_id) where external_id is not null;

create table if not exists crm.status_template_mappings (
  id uuid primary key default gen_random_uuid(),
  department_code text not null,
  status_value text not null,
  status_label text not null,
  template_id uuid not null references crm.message_templates(id) on delete cascade,
  message_type text not null default 'template',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(department_code, status_value)
);

create table if not exists crm.report_quality_settings (
  id text primary key default 'default',
  marketing_numerator_statuses text[] not null default array['مؤهل'],
  marketing_denominator_mode text not null default 'all',
  marketing_denominator_statuses text[] not null default '{}',
  sales_numerator_statuses text[] not null default array['تم البيع','تم الانتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع'],
  sales_denominator_mode text not null default 'statuses',
  sales_denominator_statuses text[] not null default array['مؤهل','مؤجل','محتمل','غير مؤهل','تم البيع','تم الانتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع'],
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists crm.integration_endpoints (
  source_code text primary key,
  display_name text not null,
  send_url text,
  webhook_url text,
  health_url text,
  secret_name text,
  is_active boolean not null default true,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists integrations.outbound_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  idempotency_key text not null unique,
  conversation_id uuid references crm.conversations(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  payload jsonb not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  response_payload jsonb,
  error_message text,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists integrations_outbound_jobs_status_idx on integrations.outbound_jobs(status, created_at);

create table if not exists crm.kpi_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  total_sales integer not null default 0,
  speed_score numeric(6,2) not null default 0,
  efficiency_score numeric(6,2) not null default 0,
  discipline_score numeric(6,2) not null default 0,
  value_score numeric(6,2) not null default 0,
  total_score numeric(6,2) not null default 0,
  rating text,
  details jsonb not null default '{}'::jsonb,
  notes text,
  evaluated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, period_start, period_end)
);

create table if not exists crm.inbox_agent_settings (
  id text primary key default 'default',
  enabled boolean not null default false,
  first_delay_seconds integer not null default 240,
  between_replies_seconds integer not null default 120,
  max_bot_messages integer not null default 2,
  escalate_to_branch_manager boolean not null default true,
  escalate_to_sales_manager boolean not null default true,
  sales_manager_delay_seconds integer not null default 300,
  sales_manager_name text,
  sales_manager_phone text,
  fallback_phone text,
  business_hours_only boolean not null default false,
  business_start time not null default '09:00',
  business_end time not null default '22:00',
  stop_keywords text[] not null default array['إلغاء','خلاص','لا تتواصلون'],
  replies text[] not null default array[
    'أهلًا بك، تم استلام رسالتك وجاري تحويل طلبك للمختص. يسعدنا خدمتك.',
    'حتى نساعدك بشكل أسرع، هل استفسارك عن الشراء كاش أم تمويل؟',
    'تم تصعيد طلبك للمسؤول لضمان الرد عليك في أقرب وقت، ونقدّر انتظارك.'
  ],
  branch_escalation_template text,
  social_enabled boolean not null default false,
  social_worker_url text,
  social_conversation_limit integer not null default 50,
  social_message_limit integer not null default 30,
  social_platforms text[] not null default array['instagram','facebook','tiktok'],
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists crm.inbox_agent_managers (
  id uuid primary key default gen_random_uuid(),
  scope_code text not null unique,
  manager_name text not null,
  whatsapp_phone text not null,
  is_active boolean not null default true,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists crm.inbox_agent_logs (
  id bigserial primary key,
  conversation_id uuid references crm.conversations(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  action text not null,
  reason text,
  message_text text,
  customer_name text,
  customer_phone text,
  branch_code text,
  assigned_name text,
  manager_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists crm_inbox_agent_logs_created_idx on crm.inbox_agent_logs(created_at desc);

create table if not exists crm.assignment_state (
  pool_key text primary key,
  last_user_id uuid references core.users(id),
  last_branch_code text,
  updated_at timestamptz not null default now()
);

insert into crm.report_quality_settings(id) values ('default') on conflict (id) do nothing;
insert into crm.inbox_agent_settings(id) values ('default') on conflict (id) do nothing;

insert into crm.sources(code, name, sort_order) values
('facebook','فيسبوك',10),
('instagram','إنستجرام',20),
('tiktok','تيك توك',30),
('snapchat','سناب شات',40),
('whatsapp','واتساب',50),
('tiktok_lead','تيك توك ليد',60),
('snapchat_lead','سناب شات ليد',70),
('installment_calculator','حاسبة التقسيط',80),
('haraj','موقع حراج',90),
('other_website','موقع آخر',100),
('branch','خلال الفرع',110),
('friend','صديق',120),
('unified_number','اتصال الرقم الموحد',130)
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into crm.integration_endpoints(source_code, display_name) values
('facebook','فيسبوك'),('instagram','إنستجرام'),('tiktok','تيك توك'),('whatsapp','واتساب'),
('tiktok-snapchat','ليد تيك توك وسناب شات'),('installment-calculator','حاسبة التقسيط')
on conflict (source_code) do nothing;

insert into crm.dashboard_statuses(id, department_code, label, value, sort_order) values
('cash-new','cash','إجمالي العملاء','عميل جديد',10),
('cash-replied','cash','تم الرد','تم الرد',20),
('cash-not-qualified','cash','غير مؤهل','غير مؤهل',30),
('cash-delayed','cash','مؤجل','مؤجل',40),
('cash-potential','cash','محتمل','محتمل',50),
('cash-sold','cash','تم البيع','تم البيع',60),
('finance-new','finance','الكول سنتر','عميل جديد',10),
('finance-called','finance','تم الاتصال','تم الاتصال',20),
('finance-no-answer','finance','لم يتم الرد','لم يتم الرد',30),
('finance-not-qualified','finance','غير مؤهل','غير مؤهل',40),
('finance-delayed','finance','مؤجل','مؤجل',50),
('finance-qualified-no-docs','finance','مؤهل - لم يتم إرسال الأوراق','مؤهل - لم يتم إرسال الأوراق',60),
('finance-qualified-late-docs','finance','مؤهل - تأخر في إرسال الأوراق','مؤهل - تأخر في إرسال الأوراق',70),
('finance-qualified-docs-sent','finance','مؤهل - تم إرسال الأوراق','مؤهل - تم إرسال الأوراق',80),
('finance-request-raised','finance','تم رفع الطلب الى جهة التمويل','تم رفع الطلب الى جهة التمويل',90),
('finance-need-docs','finance','طلب إستكمال أوراق','طلب إستكمال أوراق',100),
('finance-callcenter-support','finance','طلب الدعم من الكول سنتر الى المبيعات','طلب الدعم من الكول سنتر الى المبيعات',110),
('finance-car-selected','finance','تم إختيار السيارة','تم إختيار السيارة',120),
('finance-car-docs-raised','finance','تم رفع أوراق السيارة المطلوبة الى جهة التمويل','تم رفع أوراق السيارة المطلوبة الى جهة التمويل',130),
('finance-advanced','finance','إستيفاء الطلب - متقدم','إستيفاء الطلب - متقدم',140),
('finance-rejected','finance','طلبات لم تتم الموافقة','طلبات لم تتم الموافقة',150),
('finance-approved','finance','طلبات تمت الموافقة','طلبات تمت الموافقة',160),
('finance-contract-issued','finance','تم إصدار العقد','تم إصدار العقد',170),
('finance-contract-call','finance','تم الإتصال لتوقيع العقد','تم الإتصال لتوقيع العقد',180),
('finance-contract-not-signed','finance','لم يتم توقيع العقد','لم يتم توقيع العقد',190),
('finance-contract-signed','finance','تم توقيع العقد','تم توقيع العقد',200),
('finance-done-sale-request','finance','تم الإنتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع',210),
('service-new','service','إجمالي العملاء','عميل جديد',10),
('service-working','service','جاري العمل','جاري العمل',20),
('service-done','service','تم الانتهاء','تم الانتهاء',30),
('service-replied','service','تم الرد','تم الرد',40)
on conflict (id) do update set
  department_code = excluded.department_code,
  label = excluded.label,
  value = excluded.value,
  sort_order = excluded.sort_order;

insert into core.schema_migrations(version) values ('crm-v1.3') on conflict (version) do nothing;
`;


const CRM_SETTINGS_V15_SQL = String.raw`
alter table crm.leads add column if not exists credit_limit numeric(14,2);
alter table crm.leads add column if not exists credit_qualified boolean;

create table if not exists core.sources (
  code text primary key,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  system_codes text[] not null default array['crm','marketing'],
  delivery_route text not null default 'whatsapp',
  allow_free_text boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into core.sources(code,name,sort_order,is_active)
select code,name,sort_order,is_active from crm.sources
on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,is_active=excluded.is_active,updated_at=now();

insert into core.sources(code,name,sort_order,is_active,system_codes,delivery_route,allow_free_text) values
('facebook','فيسبوك',10,true,array['crm','marketing'],'facebook',true),
('instagram','إنستجرام',20,true,array['crm','marketing'],'instagram',true),
('tiktok','تيك توك',30,true,array['crm','marketing'],'tiktok',true),
('snapchat','سناب شات',40,true,array['crm','marketing'],'whatsapp',false),
('whatsapp','واتساب',50,true,array['crm','marketing'],'whatsapp',true),
('tiktok_lead','تيك توك ليد',60,true,array['crm','marketing'],'whatsapp',false),
('snapchat_lead','سناب شات ليد',70,true,array['crm','marketing'],'whatsapp',false),
('installment_calculator','حاسبة التقسيط',80,true,array['crm','marketing'],'whatsapp',false),
('haraj','موقع حراج',90,true,array['crm','marketing'],'whatsapp',false),
('other_website','موقع آخر',100,true,array['crm','marketing'],'whatsapp',false),
('branch','خلال الفرع',110,true,array['crm','marketing'],'whatsapp',false),
('friend','صديق',120,true,array['crm','marketing'],'whatsapp',false),
('unified_number','اتصال الرقم الموحد',130,true,array['crm','marketing'],'whatsapp',false),
('manual','إدخال يدوي',140,true,array['crm'],'whatsapp',false)
on conflict (code) do update set
  name=excluded.name,
  sort_order=excluded.sort_order,
  system_codes=excluded.system_codes,
  delivery_route=excluded.delivery_route,
  allow_free_text=excluded.allow_free_text,
  updated_at=now();

-- توحيد أكواد المصادر القديمة مع الأكواد المركزية بدون تغيير الاسم العربي المعروض.
update crm.leads set source_code='installment_calculator', source_name='حاسبة التقسيط' where source_code in ('installment-calculator','installment');
update crm.leads set source_code='facebook' where source_code in ('facebook-chat','facebook_chat','fb');
update crm.leads set source_code='instagram' where source_code in ('instagram-chat','instagram_chat','ig');
update crm.leads set source_code='tiktok' where source_code in ('tiktok-chat','tiktok_chat','tt');
update crm.manual_lead_requests set source_code='installment_calculator' where source_code in ('installment-calculator','installment');

create table if not exists crm.assignment_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  department_code text not null,
  branch_code text,
  source_codes text[] not null default '{}',
  assignment_mode text not null default 'round_robin',
  prevent_consecutive boolean not null default true,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_assignment_rules_match_idx on crm.assignment_rules(department_code,branch_code,is_active,sort_order);

create table if not exists crm.assignment_rule_members (
  rule_id uuid not null references crm.assignment_rules(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  priority integer not null default 100,
  is_active boolean not null default true,
  assignment_count integer not null default 0,
  last_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(rule_id,user_id)
);

create table if not exists crm.assignment_logs (
  id bigserial primary key,
  rule_id uuid references crm.assignment_rules(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  department_code text not null,
  branch_code text,
  source_code text,
  assigned_to uuid references core.users(id) on delete set null,
  assigned_name text,
  previous_assigned_to uuid references core.users(id) on delete set null,
  previous_assigned_name text,
  assignment_mode text not null default 'round_robin',
  action text not null default 'automatic_assignment',
  actor_id uuid references core.users(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists crm_assignment_logs_created_idx on crm.assignment_logs(created_at desc);

insert into core.schema_migrations(version) values ('platform-settings-v1.5') on conflict (version) do nothing;
`;



const CRM_CUSTOMER_FIELDS_V16_SQL = String.raw`
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
create index if not exists crm_customer_fields_order_idx on crm.customer_field_definitions(is_active,sort_order);

insert into crm.customer_field_definitions(
  field_key,label,field_type,sort_order,department_keys,is_active,is_required,include_in_completion,options,is_system,is_locked
) values
('status_label','حالة العميل','status',10,'{}',true,true,true,'[]'::jsonb,true,true),
('follow_up_at','تاريخ المتابعة','date',20,'{}',true,false,false,'[]'::jsonb,true,false),
('source_code','المصدر','source',30,'{}',true,true,true,'[]'::jsonb,true,true),
('department_code','القسم','department',40,'{}',true,true,true,'[]'::jsonb,true,true),
('department_transfer','تحويل لقسم آخر','transfer',50,'{}',true,false,false,'[]'::jsonb,true,true),
('customer_name','اسم العميل','text',60,'{}',true,true,true,'[]'::jsonb,true,true),
('phone','رقم الجوال','phone',70,'{}',true,true,true,'[]'::jsonb,true,true),
('age','العمر','number',80,'{}',true,false,true,'[]'::jsonb,true,false),
('salary','الراتب','number',90,'{}',true,false,true,'[]'::jsonb,true,true),
('obligation','الالتزام إن وجد','number',100,'{}',true,false,true,'[]'::jsonb,true,true),
('salary_bank','نزول الراتب على أي بنك','text',110,'{}',true,false,true,'[]'::jsonb,true,false),
('location','المكان','text',120,'{}',true,false,true,'[]'::jsonb,true,false),
('car_type','نوع السيارة','text',130,'{}',true,false,true,'[]'::jsonb,true,false),
('car_model','الموديل','text',140,'{}',true,false,true,'[]'::jsonb,true,false),
('color','اللون','text',150,'{}',true,false,true,'[]'::jsonb,true,false),
('finance_type','نوع التمويل','select',160,array['finance'],true,false,false,
 '[{"value":"general","label":"عام 45%"},{"value":"rate55","label":"55%"},{"value":"realEstate","label":"عقاري 65%"}]'::jsonb,true,true),
('notes','ملاحظات','textarea',170,'{}',true,false,false,'[]'::jsonb,true,false)
on conflict (field_key) do nothing;

insert into core.schema_migrations(version) values ('crm-customer-fields-v1.6') on conflict (version) do nothing;
`;


const CRM_REFERENCE_V17_SQL = String.raw`
alter table crm.leads add column if not exists car_category text;
alter table crm.leads add column if not exists unread_count integer not null default 0;
alter table crm.leads add column if not exists dashboard_unread boolean not null default false;
alter table crm.leads add column if not exists has_unread_message boolean not null default false;
alter table crm.leads add column if not exists has_unread_messages boolean not null default false;
alter table crm.leads add column if not exists message_unread boolean not null default false;
alter table crm.leads add column if not exists is_unread boolean not null default false;
alter table crm.leads add column if not exists last_message_direction text;
alter table crm.leads add column if not exists last_incoming_message_at timestamptz;
alter table crm.leads add column if not exists last_message_at timestamptz;
alter table crm.leads add column if not exists dashboard_message_read_at timestamptz;
create index if not exists crm_leads_dashboard_unread_idx on crm.leads(department_code,dashboard_unread,last_incoming_message_at desc) where is_deleted=false;

insert into crm.customer_field_definitions(
  field_key,label,field_type,sort_order,department_keys,is_active,is_required,include_in_completion,options,is_system,is_locked
) values ('car_category','الفئة','text',135,'{}',true,false,true,'[]'::jsonb,true,false)
on conflict (field_key) do update set
  label='الفئة',field_type='text',department_keys='{}',is_active=true,include_in_completion=true,is_system=true,updated_at=now();

insert into core.schema_migrations(version) values ('crm-reference-v27-v1.7') on conflict (version) do nothing;
`;



const CRM_AUTOMATION_CORE_V19_SQL = String.raw`
create table if not exists crm.contacts (
  id uuid primary key default gen_random_uuid(),
  contact_key text not null unique,
  display_name text,
  primary_phone text,
  primary_phone_normalized text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_contacts_phone_unique on crm.contacts(primary_phone_normalized) where primary_phone_normalized is not null and primary_phone_normalized<>'';

create table if not exists crm.contact_identities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm.contacts(id) on delete cascade,
  channel_code text not null,
  external_id text not null,
  participant_id text,
  page_id text,
  display_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel_code,external_id)
);
create index if not exists crm_contact_identities_contact_idx on crm.contact_identities(contact_id,channel_code);

alter table crm.integration_endpoints add column if not exists text_send_url text;
alter table crm.integration_endpoints add column if not exists template_send_url text;
alter table crm.integration_endpoints add column if not exists media_send_url text;
alter table crm.integration_endpoints add column if not exists templates_sync_url text;
alter table crm.integration_endpoints add column if not exists inbound_webhook_url text;
update crm.integration_endpoints set text_send_url=coalesce(text_send_url,send_url),inbound_webhook_url=coalesce(inbound_webhook_url,webhook_url)
where text_send_url is null or inbound_webhook_url is null;

alter table crm.leads add column if not exists contact_id uuid references crm.contacts(id) on delete set null;

create table if not exists crm.service_requests (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm.contacts(id) on delete cascade,
  lead_id uuid references crm.leads(id) on delete set null,
  conversation_id uuid references crm.conversations(id) on delete set null,
  service_key text not null,
  department_code text not null,
  branch_code text,
  status_label text not null default 'عميل جديد',
  request_state text not null default 'open' check(request_state in ('open','closed')),
  source_code text,
  classification_method text,
  assigned_to uuid references core.users(id) on delete set null,
  call_center_assigned_to uuid references core.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references core.users(id) on delete set null,
  closure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_service_requests_contact_state_idx on crm.service_requests(contact_id,request_state,opened_at desc);
create index if not exists crm_service_requests_lead_idx on crm.service_requests(lead_id,opened_at desc);
create index if not exists crm_service_requests_assignment_idx on crm.service_requests(assigned_to,request_state,updated_at desc);

alter table crm.leads add column if not exists current_request_id uuid references crm.service_requests(id) on delete set null;
alter table crm.conversations add column if not exists contact_id uuid references crm.contacts(id) on delete set null;
alter table crm.conversations add column if not exists service_request_id uuid references crm.service_requests(id) on delete set null;
alter table crm.conversations add column if not exists classification_state text not null default 'new';
alter table crm.conversations add column if not exists service_selection_sent_at timestamptz;
alter table crm.conversations add column if not exists service_selection_version integer not null default 0;
alter table crm.conversations add column if not exists last_customer_message_at timestamptz;
alter table crm.conversations add column if not exists last_human_reply_at timestamptz;
alter table crm.conversations add column if not exists last_bot_reply_at timestamptz;
alter table crm.conversations add column if not exists closed_at timestamptz;

alter table crm.messages add column if not exists caption text;
alter table crm.messages add column if not exists file_size bigint;
alter table crm.messages add column if not exists storage_key text;
alter table crm.messages add column if not exists media_status text;
alter table crm.messages add column if not exists media_expires_at timestamptz;
alter table crm.messages add column if not exists is_sensitive boolean not null default false;
alter table crm.messages add column if not exists sender_type text not null default 'customer';
create unique index if not exists crm_messages_provider_unique on crm.messages(conversation_id,provider_message_id) where provider_message_id is not null;

create table if not exists crm.media_assets (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references crm.conversations(id) on delete cascade,
  message_id uuid references crm.messages(id) on delete cascade,
  storage_provider text not null default 'r2',
  storage_key text not null unique,
  original_name text,
  media_type text not null,
  mime_type text,
  file_size bigint,
  checksum text,
  is_sensitive boolean not null default false,
  status text not null default 'ready',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_media_assets_conversation_idx on crm.media_assets(conversation_id,created_at desc);

create table if not exists crm.media_access_logs (
  id bigserial primary key,
  asset_id uuid not null references crm.media_assets(id) on delete cascade,
  user_id uuid references core.users(id) on delete set null,
  action text not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists crm.ownership_events (
  id bigserial primary key,
  contact_id uuid references crm.contacts(id) on delete set null,
  service_request_id uuid references crm.service_requests(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  previous_assigned_to uuid references core.users(id) on delete set null,
  previous_assigned_name text,
  new_assigned_to uuid references core.users(id) on delete set null,
  new_assigned_name text,
  previous_department_code text,
  new_department_code text,
  previous_branch_code text,
  new_branch_code text,
  actor_id uuid references core.users(id) on delete set null,
  actor_name text,
  actor_type text not null default 'user',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists crm_ownership_events_lead_idx on crm.ownership_events(lead_id,created_at desc);
create index if not exists crm_ownership_events_previous_idx on crm.ownership_events(previous_assigned_to,created_at desc);

create table if not exists crm.automation_settings (
  id text primary key default 'default',
  service_selection_enabled boolean not null default true,
  service_selection_message text not null default 'مرحبًا بك في مجموعة محمد ذعار العجمي للسيارات. يسعدنا خدمتك، فضلاً اختر نوع الخدمة المطلوبة:\n\n1- مبيعات كاش\n2- مبيعات تمويل\n3- خدمة العملاء',
  service_options jsonb not null default '[{"key":"cash","label":"مبيعات كاش","aliases":["1","كاش","مبيعات كاش","شراء كاش"]},{"key":"finance","label":"مبيعات تمويل","aliases":["2","تمويل","مبيعات تمويل","شراء تمويل"]},{"key":"service","label":"خدمة العملاء","aliases":["3","خدمة العملاء","خدمه العملاء","خدمة"]}]'::jsonb,
  ask_for_branch boolean not null default false,
  no_match_behavior text not null default 'wait',
  unclassified_label text not null default 'بانتظار اختيار الخدمة',
  closed_statuses jsonb not null default '{"cash":["تم البيع"],"finance":["تم الانتهاء - إنشاء طلب البيع","تم الإنتهاء - إنشاء طلب البيع"],"service":["تم الانتهاء"]}'::jsonb,
  updated_by uuid references core.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into crm.automation_settings(id) values('default') on conflict(id) do nothing;

create table if not exists crm.automation_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  name text not null,
  description text,
  trigger_event text not null,
  priority integer not null default 100,
  is_active boolean not null default true,
  run_mode text not null default 'automatic',
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  stop_after_match boolean not null default false,
  max_runs_per_entity integer not null default 1,
  created_by uuid references core.users(id) on delete set null,
  updated_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_automation_rules_trigger_idx on crm.automation_rules(trigger_event,is_active,priority);

create table if not exists crm.automation_events (
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

create table if not exists crm.automation_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  event_id uuid references crm.automation_events(id) on delete set null,
  rule_id uuid references crm.automation_rules(id) on delete set null,
  contact_id uuid references crm.contacts(id) on delete set null,
  conversation_id uuid references crm.conversations(id) on delete set null,
  service_request_id uuid references crm.service_requests(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  status text not null default 'running',
  trigger_payload jsonb not null default '{}'::jsonb,
  action_results jsonb not null default '[]'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists crm_automation_runs_created_idx on crm.automation_runs(started_at desc);

create table if not exists crm.automation_jobs (
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists crm_automation_jobs_due_idx on crm.automation_jobs(status,due_at);

insert into crm.automation_rules(rule_key,name,description,trigger_event,priority,conditions,actions,stop_after_match,max_runs_per_entity) values
('service-selection-new-conversation','اختيار الخدمة للعميل الجديد','يرسل رسالة اختيار الخدمة مرة واحدة عندما لا يوجد طلب مفتوح.','message.received',10,
 '[{"field":"event.direction","operator":"eq","value":"in"},{"field":"conversation.hasOpenRequest","operator":"eq","value":false},{"field":"conversation.serviceSelectionSent","operator":"eq","value":false}]'::jsonb,
 '[{"type":"send_service_selection"},{"type":"set_conversation_state","state":"awaiting_service"}]'::jsonb,false,1000),
('classify-service-reply','تصنيف رد اختيار الخدمة','يقرأ رد العميل أثناء انتظار اختيار الخدمة وينشئ طلب الخدمة المناسب.','message.received',20,
 '[{"field":"event.direction","operator":"eq","value":"in"},{"field":"conversation.classificationState","operator":"eq","value":"awaiting_service"}]'::jsonb,
 '[{"type":"classify_service_from_message"},{"type":"schedule_inbox_agent"}]'::jsonb,true,1000),
('inbox-agent-start','بدء وكيل صندوق الوارد','يبدأ عداد عدم الرد البشري بعد كل رسالة مرتبطة بطلب مفتوح.','message.received',30,
 '[{"field":"event.direction","operator":"eq","value":"in"},{"field":"conversation.hasOpenRequest","operator":"eq","value":true}]'::jsonb,
 '[{"type":"schedule_inbox_agent"}]'::jsonb,false,100000),
('inbox-agent-cancel','إيقاف وكيل صندوق الوارد عند الرد','يلغي مهام الوكيل المعلقة عند إرسال رد بشري.','message.sent',10,
 '[{"field":"event.senderType","operator":"eq","value":"human"}]'::jsonb,
 '[{"type":"cancel_inbox_agent"}]'::jsonb,false,100000),
('close-request-final-status','إغلاق الطلب عند الحالة النهائية','يغلق طلب الخدمة عند الوصول لحالة نهائية معتمدة.','lead.status_changed',10,'[]'::jsonb,
 '[{"type":"close_request_if_final"}]'::jsonb,false,100000)
on conflict(rule_key) do nothing;

update crm.inbox_agent_settings set replies=array_replace(replies,'فضلاً اكتب لنا المدينة أو الفرع الأقرب لك، وسيقوم أحد المختصين بالتواصل معك في أقرب وقت.','تم تصعيد طلبك للمسؤول لضمان الرد عليك في أقرب وقت، ونقدّر انتظارك.');

alter table crm.inbox_agent_settings drop column if exists social_worker_url;
alter table crm.inbox_agent_settings drop column if exists social_conversation_limit;
alter table crm.inbox_agent_settings drop column if exists social_message_limit;

insert into crm.contacts(contact_key,display_name,primary_phone,primary_phone_normalized,metadata)
select case when nullif(l.phone_normalized,'') is not null then 'phone:'||l.phone_normalized else 'lead:'||l.id::text end,
       l.customer_name,l.phone,l.phone_normalized,jsonb_build_object('migratedFromLeadId',l.id::text)
from crm.leads l
on conflict(contact_key) do update set display_name=coalesce(excluded.display_name,crm.contacts.display_name),updated_at=now();

update crm.leads l set contact_id=c.id
from crm.contacts c
where l.contact_id is null and c.contact_key=case when nullif(l.phone_normalized,'') is not null then 'phone:'||l.phone_normalized else 'lead:'||l.id::text end;

insert into crm.service_requests(contact_id,lead_id,service_key,department_code,branch_code,status_label,request_state,source_code,classification_method,assigned_to,call_center_assigned_to,opened_at,closed_at,closure_reason,metadata)
select l.contact_id,l.id,coalesce(nullif(l.service_key,''),'cash'),coalesce(nullif(l.department_code,''),'cash_sales'),l.branch_code,
       coalesce(nullif(l.status_label,''),'عميل جديد'),
       case when l.status_label in ('تم البيع','تم الانتهاء','تم الانتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع') then 'closed' else 'open' end,
       l.source_code,'legacy_migration',l.assigned_to,l.call_center_assigned_to,coalesce(l.registered_at,l.created_at),
       case when l.status_label in ('تم البيع','تم الانتهاء','تم الانتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع') then coalesce(l.updated_at,now()) else null end,
       case when l.status_label in ('تم البيع','تم الانتهاء','تم الانتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع') then l.status_label else null end,
       jsonb_build_object('migratedFromLeadId',l.id::text)
from crm.leads l
where l.contact_id is not null and not exists(select 1 from crm.service_requests r where r.lead_id=l.id);

with open_rank as (
  select id,contact_id,row_number() over(partition by contact_id order by opened_at desc,id desc) rn
  from crm.service_requests where request_state='open'
)
update crm.service_requests r set request_state='closed',closed_at=coalesce(closed_at,now()),closure_reason=coalesce(closure_reason,'إغلاق تلقائي لطلب قديم أثناء الترحيل')
from open_rank x where r.id=x.id and x.rn>1;

update crm.leads l set current_request_id=r.id
from crm.service_requests r
where r.lead_id=l.id and r.request_state='open' and l.current_request_id is null;

create unique index if not exists crm_service_requests_one_open_per_contact on crm.service_requests(contact_id) where request_state='open';

update crm.conversations c set contact_id=l.contact_id,service_request_id=l.current_request_id,
  classification_state=case when l.current_request_id is null then 'new' else 'classified' end
from crm.leads l where c.lead_id=l.id and c.contact_id is null;

insert into core.schema_migrations(version) values('crm-automation-core-v1.9') on conflict(version) do nothing;
`;

export async function ensureCrmSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`
        create table if not exists core.schema_migrations (
          version text primary key,
          applied_at timestamptz not null default now()
        )
      `;
      const [baseMigration] = await sql<{ version: string }[]>`
        select version from core.schema_migrations where version = 'crm-v1.3'
      `;
      if (!baseMigration) await runSqlScript(CRM_SCHEMA_SQL);
      const [settingsMigration] = await sql<{ version: string }[]>`
        select version from core.schema_migrations where version = 'platform-settings-v1.5'
      `;
      if (!settingsMigration) await runSqlScript(CRM_SETTINGS_V15_SQL);
      const [customerFieldsMigration] = await sql<{ version: string }[]>`
        select version from core.schema_migrations where version = 'crm-customer-fields-v1.6'
      `;
      if (!customerFieldsMigration) await runSqlScript(CRM_CUSTOMER_FIELDS_V16_SQL);
      const [referenceV17Migration] = await sql<{ version: string }[]>`
        select version from core.schema_migrations where version = 'crm-reference-v27-v1.7'
      `;
      if (!referenceV17Migration) await runSqlScript(CRM_REFERENCE_V17_SQL);
      const [automationV19Migration] = await sql<{ version: string }[]>`
        select version from core.schema_migrations where version = 'crm-automation-core-v1.9'
      `;
      if (!automationV19Migration) await runSqlScript(CRM_AUTOMATION_CORE_V19_SQL);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}
