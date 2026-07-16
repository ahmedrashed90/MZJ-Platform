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
    'فضلاً اكتب لنا المدينة أو الفرع الأقرب لك، وسيقوم أحد المختصين بالتواصل معك في أقرب وقت.'
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
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}
