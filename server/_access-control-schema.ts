import { getSql, runSqlScript } from "./_db.js";

export const ACCESS_CONTROL_SCHEMA_SQL = String.raw`
create table if not exists core.systems (
  code text primary key,
  name_ar text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists core.system_pages (
  id uuid primary key default gen_random_uuid(),
  system_code text not null references core.systems(code) on delete cascade,
  code text not null,
  name_ar text not null,
  route text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(system_code, code)
);

alter table core.permissions add column if not exists page_code text;
alter table core.permissions add column if not exists action_code text;
alter table core.permissions add column if not exists name_ar text;
alter table core.permissions add column if not exists description_ar text;
alter table core.permissions add column if not exists category text not null default 'action';
alter table core.permissions add column if not exists is_sensitive boolean not null default false;
alter table core.permissions add column if not exists is_active boolean not null default true;
alter table core.permissions add column if not exists sort_order integer not null default 0;
alter table core.permissions add column if not exists updated_at timestamptz not null default now();
update core.permissions set name_ar = coalesce(nullif(name_ar, ''), name) where name_ar is null or name_ar = '';

alter table core.users add column if not exists permission_version bigint not null default 1;

create table if not exists core.user_systems (
  user_id uuid not null references core.users(id) on delete cascade,
  system_code text not null references core.systems(code) on delete cascade,
  is_enabled boolean not null default false,
  role_id uuid references core.roles(id) on delete set null,
  data_scope text not null default 'assigned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, system_code),
  constraint core_user_systems_data_scope_check check (data_scope in (
    'self','assigned','created_by_me','branch','branches','department','departments',
    'branch_and_department','source_branch','destination_branch','workflow_assigned','all'
  ))
);

create table if not exists core.user_permission_overrides (
  user_id uuid not null references core.users(id) on delete cascade,
  permission_id uuid not null references core.permissions(id) on delete cascade,
  effect text not null,
  reason text,
  created_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, permission_id),
  constraint core_user_permission_overrides_effect_check check (effect in ('allow','deny'))
);

create table if not exists core.user_scope_rules (
  user_id uuid not null references core.users(id) on delete cascade,
  system_code text not null references core.systems(code) on delete cascade,
  scope_code text not null,
  branch_ids uuid[] not null default '{}',
  department_ids uuid[] not null default '{}',
  created_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, system_code),
  constraint core_user_scope_rules_scope_check check (scope_code in (
    'self','assigned','created_by_me','branch','branches','department','departments',
    'branch_and_department','source_branch','destination_branch','workflow_assigned','all'
  ))
);

create table if not exists core.permission_change_log (
  id bigserial primary key,
  target_user_id uuid references core.users(id) on delete set null,
  target_role_id uuid references core.roles(id) on delete set null,
  changed_by uuid references core.users(id) on delete set null,
  change_type text not null,
  permission_code text,
  system_code text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  request_id text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists core_permissions_system_page_idx on core.permissions(system_code, page_code, sort_order);
create index if not exists core_user_systems_enabled_idx on core.user_systems(user_id, is_enabled);
create index if not exists core_user_permission_overrides_user_idx on core.user_permission_overrides(user_id, effect);
create index if not exists core_permission_change_log_target_idx on core.permission_change_log(target_user_id, created_at desc);

alter table audit.activity_log add column if not exists page_code text;
alter table audit.activity_log add column if not exists permission_code text;
alter table audit.activity_log add column if not exists branch_code text;
alter table audit.activity_log add column if not exists department_code text;
alter table audit.activity_log add column if not exists user_agent text;
alter table audit.activity_log add column if not exists request_id text;
alter table audit.activity_log add column if not exists result text not null default 'success';
alter table audit.activity_log add column if not exists rejection_reason text;
`;

type SystemSeed = { code: string; name: string; order: number };
type RoleSeed = { code: string; name: string };
type PageSeed = { system: string; code: string; name: string; route: string; order: number };
type PermissionSeed = {
  code: string;
  system: string;
  page: string | null;
  action: string;
  name: string;
  category: "system" | "page" | "action" | "workflow" | "settings";
  sensitive?: boolean;
  order: number;
};


export const ROLE_SEEDS: RoleSeed[] = [
  { code: "admin", name: "مدير النظام" },
  { code: "sales_manager", name: "مدير المبيعات" },
  { code: "accounts_manager", name: "مدير الحسابات" },
  { code: "operations_manager", name: "مدير العمليات" },
  { code: "operations_admin", name: "إداري العمليات" },
  { code: "branch_manager", name: "مدير فرع" },
  { code: "sales_user", name: "مندوب مبيعات" },
  { code: "call_center_agent", name: "مندوب كول سنتر" },
  { code: "customer_service_agent", name: "مندوب خدمة عملاء" },
  { code: "marketing_executive", name: "تنفيذي التسويق" },
  { code: "marketing_user", name: "مستخدم التسويق (قديم)" },
  { code: "operations_user", name: "مستخدم العمليات (قديم)" },
  { code: "tracking_user", name: "مستخدم التراكينج" },
];

export const SYSTEM_SEEDS: SystemSeed[] = [
  { code: "operations", name: "العمليات", order: 10 },
  { code: "tracking", name: "التراكينج", order: 20 },
  { code: "marketing", name: "التسويق", order: 30 },
  { code: "crm", name: "CRM", order: 40 },
  { code: "core", name: "الإعدادات المركزية", order: 50 },
];

export const PAGE_SEEDS: PageSeed[] = [
  { system: "operations", code: "dashboard", name: "الداش بورد", route: "/operations", order: 10 },
  { system: "operations", code: "database", name: "قاعدة البيانات والمخزون", route: "/operations/database", order: 20 },
  { system: "operations", code: "movement", name: "حركة السيارات", route: "/operations/movement", order: 30 },
  { system: "operations", code: "requests", name: "طلبات العمليات", route: "/operations/requests", order: 40 },
  { system: "operations", code: "history", name: "سجل الحركات", route: "/operations/history", order: 50 },
  { system: "operations", code: "archive", name: "الأرشيف", route: "/operations/archive", order: 60 },
  { system: "operations", code: "settings", name: "إعدادات العمليات", route: "/settings?section=operations", order: 70 },
  { system: "tracking", code: "orders", name: "طلبات التتبع", route: "/tracking", order: 10 },
  { system: "tracking", code: "public_tracking", name: "صفحة تتبع العميل العامة", route: "/tracking/public", order: 20 },
  { system: "tracking", code: "settings", name: "إعدادات التراكينج", route: "/settings?section=tracking", order: 30 },
  { system: "marketing", code: "dashboard", name: "لوحة التحكم", route: "/marketing", order: 10 },
  { system: "marketing", code: "campaigns", name: "إدارة الحملات", route: "/marketing/campaigns", order: 20 },
  { system: "marketing", code: "agenda", name: "إدارة الأجندة", route: "/marketing/agenda", order: 30 },
  { system: "marketing", code: "publishing", name: "تجهيز وجدولة النشر", route: "/marketing/publishing", order: 40 },
  { system: "marketing", code: "calendar", name: "التقويم", route: "/marketing/calendar", order: 50 },
  { system: "marketing", code: "settings", name: "إعدادات التسويق", route: "/settings?section=marketing", order: 60 },
  { system: "crm", code: "dashboard", name: "الداش بورد", route: "/crm", order: 10 },
  { system: "crm", code: "database", name: "قاعدة البيانات", route: "/crm/database", order: 20 },
  { system: "crm", code: "manual_leads", name: "إضافة العملاء", route: "/crm/manual-leads", order: 30 },
  { system: "crm", code: "finance_history", name: "سجل عملاء التمويل", route: "/crm/finance-history", order: 40 },
  { system: "crm", code: "inbox", name: "صندوق الوارد", route: "/crm/inbox", order: 50 },
  { system: "crm", code: "inbox_agent", name: "وكيل صندوق الوارد", route: "/crm/inbox-agent", order: 60 },
  { system: "crm", code: "ownership", name: "سجل ملكية العملاء", route: "/crm/ownership", order: 70 },
  { system: "crm", code: "reports", name: "التقارير", route: "/crm/reports", order: 80 },
  { system: "crm", code: "kpi", name: "تقييم المناديب KPI", route: "/crm/kpi", order: 90 },
  { system: "crm", code: "settings", name: "إعدادات CRM", route: "/settings?section=crm", order: 100 },
  { system: "core", code: "users", name: "المستخدمون", route: "/settings", order: 10 },
  { system: "core", code: "roles", name: "الأدوار وقوالب الصلاحيات", route: "/settings?section=users&tab=roles", order: 20 },
  { system: "core", code: "organization", name: "الفروع والأقسام", route: "/settings?section=users&tab=organization", order: 30 },
  { system: "core", code: "permissions", name: "دليل الصلاحيات", route: "/settings?section=users&tab=permissions", order: 40 },
  { system: "core", code: "audit", name: "سجلات الصلاحيات والأمن", route: "/settings?section=users&tab=audit", order: 50 },
];

const p = (
  code: string,
  system: string,
  page: string | null,
  action: string,
  name: string,
  category: PermissionSeed["category"],
  order: number,
  sensitive = false,
): PermissionSeed => ({ code, system, page, action, name, category, order, sensitive });

export const PERMISSION_SEEDS: PermissionSeed[] = [
  p("system.operations.access", "operations", null, "access", "الدخول إلى نظام العمليات", "system", 1),
  p("system.tracking.access", "tracking", null, "access", "الدخول إلى نظام التراكينج", "system", 2),
  p("system.marketing.access", "marketing", null, "access", "الدخول إلى نظام التسويق", "system", 3),
  p("system.crm.access", "crm", null, "access", "الدخول إلى نظام CRM", "system", 4),
  p("settings.access", "core", null, "access", "فتح صفحة الإعدادات", "settings", 5, true),

  p("settings.users.view", "core", "users", "view", "مشاهدة المستخدمين", "settings", 10, true),
  p("settings.users.create", "core", "users", "create", "إضافة مستخدم", "settings", 11, true),
  p("settings.users.update", "core", "users", "update", "تعديل مستخدم", "settings", 12, true),
  p("settings.users.disable", "core", "users", "disable", "تعطيل وإعادة تفعيل مستخدم", "settings", 13, true),
  p("settings.roles.manage", "core", "roles", "manage", "إدارة الأدوار وقوالب الصلاحيات", "settings", 20, true),
  p("settings.permissions.manage", "core", "permissions", "manage", "إدارة الصلاحيات الفردية", "settings", 21, true),
  p("settings.branches.manage", "core", "organization", "manage", "إدارة الفروع والأقسام", "settings", 22, true),
  p("settings.audit.view", "core", "audit", "view", "مشاهدة سجل تعديلات الصلاحيات", "settings", 23, true),
  p("settings.security.view", "core", "audit", "security_view", "مشاهدة سجل النشاط الأمني", "settings", 24, true),

  p("operations.dashboard.view", "operations", "dashboard", "view", "مشاهدة داش بورد العمليات", "page", 100),
  p("operations.database.view", "operations", "database", "view", "مشاهدة السيارات والمخزون", "page", 110),
  p("operations.vehicle.create", "operations", "database", "create", "إضافة سيارة", "action", 111, true),
  p("operations.vehicle.update", "operations", "database", "update", "تعديل سيارة", "action", 112, true),
  p("operations.vehicle.delete", "operations", "database", "delete", "حذف سيارة", "action", 113, true),
  p("operations.vehicle.export", "operations", "database", "export", "تصدير السيارات", "action", 114, true),
  p("operations.movement.view", "operations", "movement", "view", "مشاهدة حركة السيارات", "page", 120),
  p("operations.movement.execute", "operations", "movement", "execute", "تنفيذ حركة سيارة", "action", 121, true),
  p("operations.requests.view", "operations", "requests", "view", "مشاهدة طلبات العمليات", "page", 130),
  p("operations.request.create", "operations", "requests", "create", "إنشاء طلب عمليات", "action", 131),
  p("operations.request.send", "operations", "requests", "send", "إرسال طلب عمليات", "action", 132),
  p("operations.request.receive_order", "operations", "requests", "receive_order", "مرحلة استلام الطلب", "workflow", 133),
  p("operations.request.send_car", "operations", "requests", "send_car", "مرحلة إرسال السيارة", "workflow", 134),
  p("operations.request.receive_car", "operations", "requests", "receive_car", "مرحلة استلام السيارة", "workflow", 135),
  p("operations.request.finish_order", "operations", "requests", "finish_order", "مرحلة إنهاء الطلب", "workflow", 136),
  p("operations.request.rollback", "operations", "requests", "rollback", "التراجع عن مرحلة طلب", "workflow", 137, true),
  p("operations.request.delete", "operations", "requests", "delete", "حذف طلب عمليات", "action", 138, true),
  p("operations.history.view", "operations", "history", "view", "مشاهدة سجل الحركات", "page", 140),
  p("operations.settings.view", "operations", "settings", "view", "مشاهدة إعدادات العمليات", "page", 150, true),
  p("operations.settings.manage", "operations", "settings", "manage", "تعديل إعدادات العمليات", "action", 151, true),

  p("tracking.orders.view", "tracking", "orders", "view", "مشاهدة طلبات التراكينج", "page", 200),
  p("tracking.order.open", "tracking", "orders", "open", "فتح طلب التراكينج", "action", 201),
  p("tracking.link.create", "tracking", "orders", "create_link", "إنشاء رابط تتبع", "action", 202),
  p("tracking.link.copy", "tracking", "orders", "copy_link", "نسخ رابط التتبع", "action", 203),
  p("tracking.sms.send", "tracking", "orders", "send_sms", "إرسال SMS", "action", 204, true),
  p("tracking.order.archive", "tracking", "orders", "archive", "أرشفة الطلب", "action", 205, true),
  p("tracking.settings.view", "tracking", "settings", "view", "مشاهدة إعدادات التراكينج", "page", 206, true),
  p("tracking.settings.manage", "tracking", "settings", "manage", "تعديل إعدادات التراكينج", "action", 207, true),
  ...Array.from({ length: 10 }, (_, index) => {
    const stage = String(index + 1).padStart(2, "0");
    return p(`tracking.stage.${stage}.complete`, "tracking", "orders", `stage_${stage}_complete`, `تنفيذ المرحلة ${index + 1}`, "workflow", 210 + index);
  }),
  ...Array.from({ length: 10 }, (_, index) => {
    const stage = String(index + 1).padStart(2, "0");
    return p(`tracking.stage.${stage}.rollback`, "tracking", "orders", `stage_${stage}_rollback`, `التراجع عن المرحلة ${index + 1}`, "workflow", 230 + index, true);
  }),

  p("marketing.dashboard.view", "marketing", "dashboard", "view", "مشاهدة لوحة التسويق", "page", 300),
  p("marketing.campaigns.view", "marketing", "campaigns", "view", "مشاهدة الحملات", "page", 310),
  p("marketing.campaign.create", "marketing", "campaigns", "create", "إنشاء حملة", "action", 311),
  p("marketing.campaign.edit", "marketing", "campaigns", "edit", "تعديل حملة", "action", 312),
  p("marketing.campaign.delete", "marketing", "campaigns", "delete", "حذف حملة", "action", 313, true),
  p("marketing.structure.approve", "marketing", "campaigns", "structure_approve", "اعتماد الهيكل", "workflow", 314, true),
  p("marketing.structure.reject", "marketing", "campaigns", "structure_reject", "رفض الهيكل", "workflow", 315, true),
  p("marketing.task_template.download", "marketing", "campaigns", "task_template_download", "تحميل قالب Task Template", "action", 316),
  p("marketing.task_template.upload", "marketing", "campaigns", "task_template_upload", "رفع Task Template", "action", 317),
  p("marketing.task_template.reupload", "marketing", "campaigns", "task_template_reupload", "إعادة رفع Task Template", "action", 318),
  p("marketing.task_template.approve", "marketing", "campaigns", "task_template_approve", "اعتماد Task Template", "workflow", 319, true),
  p("marketing.assignment_actions.execute", "marketing", "campaigns", "assignment_execute", "تنفيذ إجراء تكليف مسند", "workflow", 320),
  p("marketing.assignment_actions.approve", "marketing", "campaigns", "assignment_approve", "اعتماد إجراءات التكليف", "workflow", 321, true),
  p("marketing.final_file.upload", "marketing", "campaigns", "final_file_upload", "رفع الملف النهائي", "action", 322),
  p("marketing.task.reopen", "marketing", "campaigns", "task_reopen", "إعادة فتح التاسك", "workflow", 323, true),
  p("marketing.agenda.view", "marketing", "agenda", "view", "مشاهدة الأجندة", "page", 330),
  p("marketing.agenda.create", "marketing", "agenda", "create", "إنشاء أجندة", "action", 331),
  p("marketing.agenda.edit", "marketing", "agenda", "edit", "تعديل أجندة", "action", 332),
  p("marketing.agenda.delete", "marketing", "agenda", "delete", "حذف أجندة", "action", 333, true),
  p("marketing.publishing.view", "marketing", "publishing", "view", "مشاهدة تجهيز النشر", "page", 340),
  p("marketing.publishing.manage", "marketing", "publishing", "manage", "تعديل تجهيز وجدولة النشر", "action", 341, true),
  p("marketing.calendar.view", "marketing", "calendar", "view", "مشاهدة التقويم", "page", 350),
  p("marketing.settings.view", "marketing", "settings", "view", "مشاهدة إعدادات التسويق", "page", 360),
  p("marketing.settings.manage", "marketing", "settings", "manage", "تعديل إعدادات التسويق", "action", 361, true),

  p("crm.dashboard.view", "crm", "dashboard", "view", "مشاهدة داش بورد CRM", "page", 400),
  p("crm.database.view", "crm", "database", "view", "مشاهدة قاعدة بيانات العملاء", "page", 410),
  p("crm.customer.view", "crm", "database", "customer_view", "فتح بيانات العميل", "action", 411),
  p("crm.customer.create", "crm", "manual_leads", "create", "إضافة عميل", "action", 412),
  p("crm.customer.update", "crm", "database", "update", "تعديل بيانات العميل", "action", 413),
  p("crm.customer.change_status", "crm", "database", "change_status", "تغيير حالة العميل", "action", 414),
  p("crm.customer.add_note", "crm", "database", "add_note", "إضافة ملاحظة للعميل", "action", 415),
  p("crm.customer.change_owner", "crm", "database", "change_owner", "تغيير مسؤول العميل", "action", 416, true),
  p("crm.customer.transfer", "crm", "database", "transfer", "نقل العميل", "action", 417, true),
  p("crm.customer.delete", "crm", "database", "delete", "حذف العميل", "action", 418, true),
  p("crm.customer.export", "crm", "database", "export", "تصدير العملاء", "action", 419, true),
  p("crm.manual_leads.view", "crm", "manual_leads", "view", "فتح صفحة إضافة العملاء", "page", 420),
  p("crm.manual_lead.create", "crm", "manual_leads", "create_request", "إنشاء طلب إضافة عميل", "action", 421),
  p("crm.manual_lead.approve_duplicate", "crm", "manual_leads", "approve_duplicate", "اعتماد أو رفض العميل المكرر", "action", 422, true),
  p("crm.manual_lead.delete", "crm", "manual_leads", "delete_request", "حذف طلب إضافة عميل", "action", 423, true),
  p("crm.finance_history.view", "crm", "finance_history", "view", "مشاهدة سجل عملاء التمويل", "page", 430),
  p("crm.inbox.view", "crm", "inbox", "view", "مشاهدة صندوق الوارد", "page", 440),
  p("crm.conversation.view", "crm", "inbox", "conversation_view", "فتح المحادثة", "action", 441),
  p("crm.conversation.send_text", "crm", "inbox", "send_text", "إرسال نص", "action", 442),
  p("crm.conversation.send_template", "crm", "inbox", "send_template", "إرسال قالب", "action", 443),
  p("crm.conversation.send_media", "crm", "inbox", "send_media", "إرسال وسائط", "action", 444),
  p("crm.conversation.download_attachment", "crm", "inbox", "download_attachment", "تحميل مرفق", "action", 445),
  p("crm.conversation.mark_read", "crm", "inbox", "mark_read", "تغيير حالة القراءة", "action", 446),
  p("crm.inbox_agent.view", "crm", "inbox_agent", "view", "مشاهدة وكيل صندوق الوارد", "page", 450),
  p("crm.inbox_agent.manage", "crm", "inbox_agent", "manage", "إدارة وكيل صندوق الوارد", "action", 451, true),
  p("crm.ownership.view", "crm", "ownership", "view", "مشاهدة سجل ملكية العملاء", "page", 460),
  p("crm.reports.view", "crm", "reports", "view", "مشاهدة تقارير CRM", "page", 470),
  p("crm.reports.export", "crm", "reports", "export", "تصدير تقارير CRM", "action", 471, true),
  p("crm.kpi.view", "crm", "kpi", "view", "مشاهدة KPI", "page", 480),
  p("crm.kpi.manage", "crm", "kpi", "manage", "إضافة وتعديل تقييمات المناديب", "action", 481, true),
  p("crm.kpi.export", "crm", "kpi", "export", "تصدير تقارير KPI", "action", 482, true),
  p("crm.settings.view", "crm", "settings", "view", "مشاهدة إعدادات CRM", "page", 490, true),
  p("crm.settings.manage", "crm", "settings", "manage", "تعديل إعدادات CRM", "action", 491, true),
];

const roleDefaults: Record<string, string[]> = {
  sales_manager: ["system.crm.access", ...PERMISSION_SEEDS.filter((item) => item.system === "crm" && !item.code.startsWith("crm.settings.")).map((item) => item.code)],
  branch_manager: [
    "system.crm.access", "crm.dashboard.view", "crm.database.view", "crm.customer.view", "crm.customer.update",
    "crm.customer.change_status", "crm.customer.add_note", "crm.manual_leads.view", "crm.manual_lead.create",
    "crm.inbox.view", "crm.conversation.view", "crm.conversation.send_text", "crm.conversation.send_template",
    "crm.conversation.send_media", "crm.conversation.download_attachment", "crm.conversation.mark_read",
    "crm.finance_history.view", "crm.reports.view", "crm.kpi.view", "crm.kpi.manage",
  ],
  call_center_agent: [
    "system.crm.access", "crm.dashboard.view", "crm.database.view", "crm.customer.view", "crm.customer.update",
    "crm.customer.change_status", "crm.customer.add_note", "crm.manual_leads.view", "crm.manual_lead.create",
    "crm.inbox.view", "crm.conversation.view", "crm.conversation.send_text", "crm.conversation.send_template",
    "crm.conversation.send_media", "crm.conversation.download_attachment", "crm.conversation.mark_read",
  ],
  sales_user: [
    "system.crm.access", "crm.dashboard.view", "crm.database.view", "crm.customer.view", "crm.customer.update",
    "crm.customer.change_status", "crm.customer.add_note", "crm.manual_leads.view", "crm.manual_lead.create",
    "crm.inbox.view", "crm.conversation.view", "crm.conversation.send_text", "crm.conversation.send_template",
    "crm.conversation.send_media", "crm.conversation.download_attachment", "crm.conversation.mark_read",
  ],
  marketing_user: [
    "system.marketing.access", "marketing.dashboard.view", "marketing.campaigns.view", "marketing.agenda.view",
    "marketing.task_template.download", "marketing.task_template.upload", "marketing.task_template.reupload",
    "marketing.assignment_actions.execute", "marketing.final_file.upload", "marketing.calendar.view", "marketing.publishing.view",
  ],
  operations_manager: ["system.operations.access", ...PERMISSION_SEEDS.filter((item) => item.system === "operations").map((item) => item.code)],
  operations_admin: [
    "system.operations.access", "operations.dashboard.view", "operations.database.view", "operations.movement.view",
    "operations.movement.execute", "operations.requests.view", "operations.request.create", "operations.request.send",
    "operations.history.view",
  ],
  operations_user: [
    "system.operations.access", "operations.dashboard.view", "operations.database.view", "operations.movement.view",
    "operations.movement.execute", "operations.requests.view", "operations.request.create", "operations.request.send",
    "operations.history.view",
  ],
  customer_service_agent: [
    "system.crm.access", "crm.dashboard.view", "crm.database.view", "crm.customer.view", "crm.customer.update",
    "crm.customer.change_status", "crm.customer.add_note", "crm.inbox.view", "crm.conversation.view",
    "crm.conversation.send_text", "crm.conversation.send_template", "crm.conversation.send_media",
    "crm.conversation.download_attachment", "crm.conversation.mark_read",
  ],
  marketing_executive: [
    "system.marketing.access", "marketing.dashboard.view", "marketing.campaigns.view", "marketing.agenda.view",
    "marketing.task_template.download", "marketing.task_template.upload", "marketing.task_template.reupload",
    "marketing.assignment_actions.execute", "marketing.final_file.upload", "marketing.calendar.view", "marketing.publishing.view",
  ],
  tracking_user: ["system.tracking.access", "tracking.orders.view", "tracking.order.open", "tracking.link.create", "tracking.link.copy"],
};

let ensurePromise: Promise<void> | null = null;

export function resetAccessControlSchemaCache() {
  ensurePromise = null;
}

export async function ensureAccessControlSchema() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await runSqlScript(ACCESS_CONTROL_SCHEMA_SQL);
    const sql = getSql();

    for (const role of ROLE_SEEDS) {
      await sql`
        insert into core.roles(code, name, is_system)
        values (${role.code}, ${role.name}, true)
        on conflict (code) do update set name=excluded.name, is_system=true
      `;
    }

    await sql`
      insert into core.branches(code, name, sort_order, is_active)
      values ('warehouse', 'المستودع', 70, true)
      on conflict (code) do update set name=excluded.name, is_active=true
    `;

    for (const system of SYSTEM_SEEDS) {
      await sql`
        insert into core.systems(code, name_ar, sort_order, is_active, updated_at)
        values (${system.code}, ${system.name}, ${system.order}, true, now())
        on conflict (code) do update set name_ar=excluded.name_ar, sort_order=excluded.sort_order, is_active=true, updated_at=now()
      `;
    }

    for (const page of PAGE_SEEDS) {
      await sql`
        insert into core.system_pages(system_code, code, name_ar, route, sort_order, is_active, updated_at)
        values (${page.system}, ${page.code}, ${page.name}, ${page.route}, ${page.order}, true, now())
        on conflict (system_code, code) do update
        set name_ar=excluded.name_ar, route=excluded.route, sort_order=excluded.sort_order, is_active=true, updated_at=now()
      `;
    }

    for (const permission of PERMISSION_SEEDS) {
      await sql`
        insert into core.permissions(
          code, name, name_ar, system_code, page_code, action_code, category, is_sensitive, is_active, sort_order, updated_at
        ) values (
          ${permission.code}, ${permission.name}, ${permission.name}, ${permission.system}, ${permission.page}, ${permission.action},
          ${permission.category}, ${Boolean(permission.sensitive)}, true, ${permission.order}, now()
        )
        on conflict (code) do update set
          name=excluded.name,
          name_ar=excluded.name_ar,
          system_code=excluded.system_code,
          page_code=excluded.page_code,
          action_code=excluded.action_code,
          category=excluded.category,
          is_sensitive=excluded.is_sensitive,
          is_active=true,
          sort_order=excluded.sort_order,
          updated_at=now()
      `;
    }

    const [adminRole] = await sql<{ id: string }[]>`select id::text from core.roles where code='admin' limit 1`;
    if (adminRole) {
      await sql`
        insert into core.role_permissions(role_id, permission_id)
        select ${adminRole.id}::uuid, p.id from core.permissions p where p.is_active=true
        on conflict do nothing
      `;
    }

    for (const [roleCode, permissionCodes] of Object.entries(roleDefaults)) {
      const [role] = await sql<{ id: string }[]>`select id::text from core.roles where code=${roleCode} limit 1`;
      if (!role || permissionCodes.length === 0) continue;
      await sql`
        insert into core.role_permissions(role_id, permission_id)
        select ${role.id}::uuid, p.id
        from core.permissions p
        where p.code = any(${permissionCodes}::text[])
        on conflict do nothing
      `;
    }

    await sql`
      insert into core.user_systems(user_id, system_code, is_enabled, role_id, data_scope)
      select distinct ur.user_id,
        case
          when r.code in ('sales_manager','branch_manager','call_center_agent','customer_service_agent','sales_user') then 'crm'
          when r.code in ('marketing_user','marketing_executive') then 'marketing'
          when r.code in ('operations_user','operations_admin','operations_manager','accounts_manager') then 'operations'
          when r.code='tracking_user' then 'tracking'
          else s.code
        end,
        true,
        case when r.code='admin' then null else r.id end,
        case when r.code in ('admin','sales_manager','operations_manager') then 'all' else 'assigned' end
      from core.user_roles ur
      join core.roles r on r.id=ur.role_id
      cross join lateral (
        select code from core.systems
        where r.code='admin' or code = case
          when r.code in ('sales_manager','branch_manager','call_center_agent','customer_service_agent','sales_user') then 'crm'
          when r.code in ('marketing_user','marketing_executive') then 'marketing'
          when r.code in ('operations_user','operations_admin','operations_manager','accounts_manager') then 'operations'
          when r.code='tracking_user' then 'tracking'
          else '__none__'
        end
      ) s
      on conflict (user_id, system_code) do nothing
    `;
  })().catch((error) => {
    ensurePromise = null;
    throw error;
  });
  return ensurePromise;
}
