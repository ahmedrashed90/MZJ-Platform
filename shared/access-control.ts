export type PlatformSystem = "crm" | "marketing" | "operations" | "tracking";
export type AccessSystemCode = PlatformSystem | "core";
export type DataScope =
  | "self"
  | "assigned"
  | "created_by_me"
  | "branch"
  | "branches"
  | "department"
  | "departments"
  | "branch_and_department"
  | "source_branch"
  | "destination_branch"
  | "workflow_assigned"
  | "all";

export type SystemAccessConfig = {
  enabled: boolean;
  dataScope: DataScope;
  roleId: string | null;
  roleCode: string | null;
  branchCodes: string[];
  departmentCodes: string[];
};

export type AccessUserShape = {
  permissions: string[];
  deniedPermissions?: string[];
  systemAccess?: Partial<Record<PlatformSystem, SystemAccessConfig>>;
};

export type CatalogPage = {
  system: AccessSystemCode;
  code: string;
  name: string;
  route: string;
  sortOrder: number;
};

export type CatalogPermission = {
  code: string;
  name: string;
  description: string;
  system: AccessSystemCode;
  page: string;
  action: string;
  category: "system" | "page" | "action" | "workflow" | "settings" | "security";
  sensitive?: boolean;
  sortOrder: number;
};

export const DATA_SCOPE_OPTIONS: Array<{ code: DataScope; name: string }> = [
  { code: "self", name: "المستخدم نفسه" },
  { code: "assigned", name: "المسند إليه" },
  { code: "created_by_me", name: "الذي أنشأه المستخدم" },
  { code: "branch", name: "الفرع الأساسي" },
  { code: "branches", name: "الفروع المسموحة" },
  { code: "department", name: "القسم الأساسي" },
  { code: "departments", name: "الأقسام المسموحة" },
  { code: "branch_and_department", name: "الفروع والأقسام المسموحة" },
  { code: "source_branch", name: "الفرع المصدر" },
  { code: "destination_branch", name: "الفرع المستهدف" },
  { code: "workflow_assigned", name: "مراحل العمل المسندة" },
  { code: "all", name: "كل البيانات" },
];

export const SYSTEM_CATALOG: Array<{ code: PlatformSystem; name: string; sortOrder: number }> = [
  { code: "operations", name: "العمليات", sortOrder: 10 },
  { code: "tracking", name: "التراكينج", sortOrder: 20 },
  { code: "marketing", name: "التسويق", sortOrder: 30 },
  { code: "crm", name: "CRM", sortOrder: 40 },
];

export const PAGE_CATALOG: CatalogPage[] = [
  { system: "core", code: "dashboard", name: "الداش بورد الموحد", route: "/", sortOrder: 10 },
  { system: "core", code: "reports", name: "التقارير الموحدة", route: "/reports", sortOrder: 20 },
  { system: "core", code: "database", name: "قاعدة البيانات الموحدة", route: "/database", sortOrder: 30 },
  { system: "core", code: "settings", name: "الإعدادات", route: "/settings", sortOrder: 40 },
  { system: "core", code: "activity", name: "سجل النشاط", route: "/activity", sortOrder: 50 },

  { system: "crm", code: "dashboard", name: "الداش بورد", route: "/crm", sortOrder: 10 },
  { system: "crm", code: "database", name: "قاعدة البيانات", route: "/crm/database", sortOrder: 20 },
  { system: "crm", code: "manual_leads", name: "إضافة العملاء", route: "/crm/manual-leads", sortOrder: 30 },
  { system: "crm", code: "finance_history", name: "سجل عملاء التمويل", route: "/crm/finance-history", sortOrder: 40 },
  { system: "crm", code: "inbox", name: "رسائل غير مصنفة", route: "/crm/inbox", sortOrder: 50 },
  { system: "crm", code: "contacts", name: "جهات الاتصال", route: "/crm/contacts", sortOrder: 60 },
  { system: "crm", code: "inbox_agent", name: "وكيل صندوق الوارد", route: "/crm/inbox-agent", sortOrder: 70 },
  { system: "crm", code: "reports", name: "التقارير", route: "/crm/reports", sortOrder: 80 },
  { system: "crm", code: "kpi", name: "تقييم المناديب KPI", route: "/crm/kpi", sortOrder: 90 },

  { system: "marketing", code: "dashboard", name: "الداش بورد", route: "/marketing", sortOrder: 10 },
  { system: "marketing", code: "create_campaign", name: "إنشاء حملة", route: "/marketing/create-campaign", sortOrder: 20 },
  { system: "marketing", code: "create_agenda", name: "إنشاء أجندة", route: "/marketing/create-agenda", sortOrder: 30 },
  { system: "marketing", code: "database", name: "قاعدة البيانات", route: "/marketing/database", sortOrder: 40 },
  { system: "marketing", code: "packages", name: "إدارة الباقات", route: "/marketing/packages", sortOrder: 50 },
  { system: "marketing", code: "platforms", name: "ربط المنصات", route: "/marketing/platforms", sortOrder: 60 },
  { system: "marketing", code: "publish_prep", name: "تجهيز النشر", route: "/marketing/publish-prep", sortOrder: 70 },
  { system: "marketing", code: "monitoring", name: "المتابعة", route: "/marketing/monitoring", sortOrder: 80 },
  { system: "marketing", code: "calendar", name: "التقويم", route: "/marketing/calendar", sortOrder: 90 },
  { system: "marketing", code: "receipt_calendar", name: "تقويم الاستلام", route: "/marketing/receipt-calendar", sortOrder: 100 },
  { system: "marketing", code: "stock", name: "الاستوك", route: "/marketing/stock", sortOrder: 110 },
  { system: "marketing", code: "attendance", name: "الحضور والانصراف", route: "/marketing/attendance", sortOrder: 120 },

  { system: "operations", code: "inventory", name: "مخزون السيارات", route: "/operations", sortOrder: 10 },
  { system: "operations", code: "manage", name: "إدارة السيارات", route: "/operations/manage", sortOrder: 20 },
  { system: "operations", code: "movement", name: "الحركة", route: "/operations/movement", sortOrder: 30 },
  { system: "operations", code: "transfers", name: "الطلبات", route: "/operations/transfers", sortOrder: 40 },
  { system: "operations", code: "approvals", name: "الموافقات", route: "/operations/approvals", sortOrder: 50 },
  { system: "operations", code: "all", name: "جميع السيارات", route: "/operations/all", sortOrder: 60 },
  { system: "operations", code: "movements", name: "سجل الحركات", route: "/operations/movements", sortOrder: 70 },
  { system: "operations", code: "archive", name: "الأرشيف", route: "/operations/archive", sortOrder: 80 },

  { system: "tracking", code: "orders", name: "طلبات التراكينج", route: "/tracking", sortOrder: 10 },
  { system: "tracking", code: "archive", name: "أرشيف الطلبات", route: "/tracking/archive", sortOrder: 20 },
  { system: "tracking", code: "delete", name: "حذف طلبات التراكينج", route: "/tracking/delete", sortOrder: 30 },
];

let permissionOrder = 0;
function p(
  code: string,
  name: string,
  system: AccessSystemCode,
  page: string,
  action: string,
  category: CatalogPermission["category"],
  description = name,
  sensitive = false,
): CatalogPermission {
  permissionOrder += 10;
  return { code, name, description, system, page, action, category, sensitive, sortOrder: permissionOrder };
}

export const PERMISSION_CATALOG: CatalogPermission[] = [
  p("platform.superadmin", "صلاحية مدير النظام العليا", "core", "settings", "superadmin", "security", "تجاوز إداري كامل عبر قالب مدير النظام فقط", true),
  p("platform.dashboard.view", "مشاهدة الداش بورد الموحد", "core", "dashboard", "view", "page"),
  p("platform.reports.view", "مشاهدة التقارير الموحدة", "core", "reports", "view", "page"),
  p("platform.database.view", "مشاهدة قاعدة البيانات الموحدة", "core", "database", "view", "page"),
  p("platform.activity.view", "مشاهدة سجل النشاط", "core", "activity", "view", "page", "مشاهدة سجل النشاط التشغيلي", true),
  p("settings.view", "فتح الإعدادات", "core", "settings", "view", "settings"),
  p("settings.users.view", "مشاهدة المستخدمين", "core", "settings", "users_view", "settings", "مشاهدة المستخدمين وتفاصيل صلاحياتهم", true),
  p("settings.users.create", "إنشاء مستخدم", "core", "settings", "users_create", "settings", "إنشاء حساب مستخدم جديد", true),
  p("settings.users.update", "تعديل مستخدم", "core", "settings", "users_update", "settings", "تعديل بيانات المستخدم وربطه", true),
  p("settings.users.disable", "تعطيل وتفعيل مستخدم", "core", "settings", "users_disable", "settings", "تعطيل الحساب وإبطال جلساته", true),
  p("settings.roles.manage", "إدارة الأدوار وقوالب الصلاحيات", "core", "settings", "roles_manage", "settings", "إنشاء وتعديل الأدوار وقوالبها", true),
  p("settings.permissions.manage", "إدارة الصلاحيات الفردية", "core", "settings", "permissions_manage", "settings", "منح ومنع الصلاحيات الفردية", true),
  p("settings.branches.manage", "إدارة الفروع", "core", "settings", "branches_manage", "settings", "إضافة وتعديل الفروع", true),
  p("settings.departments.manage", "إدارة الأقسام", "core", "settings", "departments_manage", "settings", "إضافة وتعديل الأقسام", true),
  p("settings.audit.view", "مشاهدة سجل تعديلات الصلاحيات", "core", "settings", "audit_view", "security", "مشاهدة قبل وبعد كل تعديل صلاحيات", true),
  p("settings.security.view", "مشاهدة سجل النشاط الأمني", "core", "settings", "security_view", "security", "مشاهدة محاولات الدخول والرفض والتغييرات الحساسة", true),
  p("settings.crm.view", "مشاهدة إعدادات CRM", "core", "settings", "crm_view", "settings"),
  p("settings.crm.manage", "تعديل إعدادات CRM", "core", "settings", "crm_manage", "settings", "تعديل إعدادات CRM التشغيلية", true),
  p("settings.marketing.view", "مشاهدة إعدادات التسويق", "core", "settings", "marketing_view", "settings"),
  p("settings.marketing.manage", "تعديل إعدادات التسويق", "core", "settings", "marketing_manage", "settings", "تعديل إعدادات التسويق التشغيلية", true),
  p("settings.operations.view", "مشاهدة إعدادات العمليات", "core", "settings", "operations_view", "settings"),
  p("settings.operations.manage", "تعديل إعدادات العمليات", "core", "settings", "operations_manage", "settings", "تعديل إعدادات العمليات التشغيلية", true),
  p("settings.tracking.view", "مشاهدة إعدادات التتبع", "core", "settings", "tracking_view", "settings"),
  p("settings.tracking.manage", "تعديل إعدادات التتبع", "core", "settings", "tracking_manage", "settings", "تعديل إعدادات التتبع التشغيلية", true),

  p("system.crm.access", "دخول نظام CRM", "crm", "dashboard", "access", "system"),
  p("crm.dashboard.view", "مشاهدة داش بورد CRM", "crm", "dashboard", "view", "page"),
  p("crm.database.view", "مشاهدة قاعدة بيانات CRM", "crm", "database", "view", "page"),
  p("crm.manual_leads.view", "فتح إضافة العملاء", "crm", "manual_leads", "view", "page"),
  p("crm.finance_history.view", "مشاهدة سجل عملاء التمويل", "crm", "finance_history", "view", "page"),
  p("crm.inbox.view", "مشاهدة الرسائل غير المصنفة", "crm", "inbox", "view", "page"),
  p("crm.contacts.view", "مشاهدة جهات الاتصال", "crm", "contacts", "view", "page"),
  p("crm.inbox_agent.view", "فتح وكيل صندوق الوارد", "crm", "inbox_agent", "view", "page"),
  p("crm.reports.view", "مشاهدة تقارير CRM", "crm", "reports", "view", "page"),
  p("crm.kpi.view", "مشاهدة KPI", "crm", "kpi", "view", "page"),
  p("crm.customer.view", "فتح بيانات العميل", "crm", "database", "customer_view", "action"),
  p("crm.customer.create", "إنشاء عميل", "crm", "manual_leads", "customer_create", "action"),
  p("crm.customer.update", "تعديل بيانات العميل", "crm", "database", "customer_update", "action"),
  p("crm.customer.status.update", "تعديل حالة العميل", "crm", "database", "status_update", "action"),
  p("crm.customer.note.add", "إضافة ملاحظة للعميل", "crm", "database", "note_add", "action"),
  p("crm.customer.owner.change", "تغيير مسؤول العميل", "crm", "database", "owner_change", "action", "تغيير مندوب المبيعات", true),
  p("crm.customer.call_center.change", "تغيير مندوب الكول سنتر", "crm", "database", "call_center_change", "action", "تغيير مندوب الكول سنتر", true),
  p("crm.customer.transfer", "نقل عميل", "crm", "database", "transfer", "action", "نقل العميل بين الأقسام", true),
  p("crm.customer.bulk_transfer", "نقل مجموعة عملاء", "crm", "database", "bulk_transfer", "action", "نقل مجموعة من العملاء", true),
  p("crm.customer.delete", "حذف عميل", "crm", "database", "delete", "action", "حذف العميل منطقيًا", true),
  p("crm.customer.restore", "استعادة عميل", "crm", "database", "restore", "action"),
  p("crm.customer.export", "تصدير العملاء", "crm", "database", "export", "action", "تصدير البيانات داخل النطاق", true),
  p("crm.customer.history.view", "مشاهدة سجل العميل", "crm", "finance_history", "history_view", "action"),
  p("crm.customer.ownership.view", "مشاهدة سجل ملكية العملاء", "crm", "finance_history", "ownership_view", "action"),
  p("crm.manual_lead.request", "إنشاء طلب إضافة عميل", "crm", "manual_leads", "request", "action"),
  p("crm.manual_lead.view_own", "مشاهدة طلبات الإضافة الخاصة", "crm", "manual_leads", "view_own", "action"),
  p("crm.manual_lead.view_all", "مشاهدة كل طلبات الإضافة", "crm", "manual_leads", "view_all", "action"),
  p("crm.manual_lead.duplicate.approve", "اعتماد العميل المكرر", "crm", "manual_leads", "duplicate_approve", "action", "اعتماد طلب عميل مكرر", true),
  p("crm.manual_lead.reject", "رفض طلب إضافة العميل", "crm", "manual_leads", "reject", "action", "رفض الطلب", true),
  p("crm.manual_lead.delete", "حذف طلب إضافة العميل", "crm", "manual_leads", "delete", "action", "حذف الطلب", true),
  p("crm.manual_lead.redistribute", "إعادة توزيع العملاء", "crm", "manual_leads", "redistribute", "action", "إعادة توزيع العملاء", true),
  p("crm.conversation.view", "مشاهدة المحادثة", "crm", "inbox_agent", "conversation_view", "action"),
  p("crm.conversation.send_text", "إرسال رسالة نصية", "crm", "inbox_agent", "send_text", "action", "إرسال نص للعميل", true),
  p("crm.conversation.send_template", "إرسال قالب", "crm", "inbox_agent", "send_template", "action", "إرسال قالب معتمد", true),
  p("crm.conversation.send_media", "إرسال مرفق", "crm", "inbox_agent", "send_media", "action", "إرسال صورة أو فيديو أو ملف", true),
  p("crm.conversation.download", "تحميل مرفق", "crm", "inbox_agent", "download", "action"),
  p("crm.conversation.mark_read", "تعليم المحادثة كمقروءة", "crm", "inbox_agent", "mark_read", "action"),
  p("crm.conversation.mark_unread", "تعليم المحادثة كغير مقروءة", "crm", "inbox_agent", "mark_unread", "action"),
  p("crm.conversation.classify", "تصنيف المحادثة", "crm", "inbox", "classify", "action", "ربط المحادثة بالخدمة", true),
  p("crm.conversation.link", "ربط محادثة بعميل", "crm", "inbox", "link", "action", "ربط المحادثة بملف عميل", true),
  p("crm.conversation.view_all", "مشاهدة كل المحادثات", "crm", "inbox_agent", "view_all", "action"),
  p("crm.conversation.view_assigned", "مشاهدة المحادثات المسندة", "crm", "inbox_agent", "view_assigned", "action"),
  p("crm.reports.departments", "مشاهدة تقارير الأقسام", "crm", "reports", "departments", "action"),
  p("crm.reports.agents", "مشاهدة تقارير المناديب", "crm", "reports", "agents", "action"),
  p("crm.reports.customer_details", "فتح تفاصيل عملاء التقارير", "crm", "reports", "customer_details", "action"),
  p("crm.reports.export", "تصدير تقارير CRM", "crm", "reports", "export", "action", "تصدير التقارير داخل النطاق", true),
  p("crm.data_review.view", "مشاهدة مراجعة أخطاء البيانات", "crm", "reports", "data_review_view", "action", "فحص أخطاء البيانات داخل نطاق المستخدم"),
  p("crm.data_review.execute", "تنفيذ تصحيح أخطاء البيانات", "crm", "reports", "data_review_execute", "action", "تنفيذ تصحيحات جماعية مسجلة في Audit Log", true),
  p("crm.kpi.rating.create", "إضافة تقييم", "crm", "kpi", "rating_create", "action"),
  p("crm.kpi.rating.update", "تعديل تقييم", "crm", "kpi", "rating_update", "action"),
  p("crm.kpi.rating.delete", "حذف تقييم", "crm", "kpi", "rating_delete", "action", "حذف تقييم مندوب", true),
  p("crm.kpi.rate_branch", "تقييم مندوبي الفرع", "crm", "kpi", "rate_branch", "action"),
  p("crm.kpi.rate_all", "تقييم جميع المناديب", "crm", "kpi", "rate_all", "action", "تقييم خارج نطاق الفرع", true),
  p("crm.routing.manage", "إدارة قواعد التوزيع", "crm", "settings", "routing_manage", "settings", "إدارة التوزيع الآلي", true),
  p("crm.automation.manage", "إدارة الأتمتة", "crm", "settings", "automation_manage", "settings", "إدارة تدفقات الأتمتة", true),
  p("crm.contacts.purge", "حذف ملف جهة اتصال بالكامل", "crm", "contacts", "purge", "action", "حذف الملف وطلباته ومحادثاته", true),

  p("system.operations.access", "دخول نظام العمليات", "operations", "inventory", "access", "system"),
  p("operations.inventory.view", "مشاهدة مخزون السيارات", "operations", "inventory", "view", "page"),
  p("operations.manage.view", "فتح إدارة السيارات", "operations", "manage", "view", "page"),
  p("operations.movement.view", "فتح صفحة الحركة", "operations", "movement", "view", "page"),
  p("operations.transfers.view", "مشاهدة طلبات العمليات", "operations", "transfers", "view", "page"),
  p("operations.approvals.view", "مشاهدة الموافقات", "operations", "approvals", "view", "page"),
  p("operations.all.view", "مشاهدة جميع السيارات", "operations", "all", "view", "page"),
  p("operations.movements.view", "مشاهدة سجل الحركات", "operations", "movements", "view", "page"),
  p("operations.archive.view", "مشاهدة أرشيف السيارات", "operations", "archive", "view", "page"),
  p("operations.vehicle.view", "فتح بيانات السيارة", "operations", "inventory", "vehicle_view", "action"),
  p("operations.vehicle.create", "إضافة سيارة", "operations", "manage", "create", "action"),
  p("operations.vehicle.edit", "تعديل سيارة", "operations", "manage", "edit", "action"),
  p("operations.vehicle.vin.update", "تعديل رقم الهيكل VIN", "operations", "manage", "vin_update", "action", "تعديل رقم الهيكل المسجل", true),
  p("operations.vehicle.delete", "حذف سيارة", "operations", "manage", "delete", "action", "حذف السيارة", true),
  p("operations.vehicle.archive", "أرشفة سيارة", "operations", "archive", "archive", "action"),
  p("operations.vehicle.restore", "استعادة سيارة", "operations", "archive", "restore", "action"),
  p("operations.vehicle.import", "استيراد السيارات", "operations", "manage", "import", "action", "استيراد جماعي", true),
  p("operations.vehicle.export", "تصدير السيارات", "operations", "inventory", "export", "action", "تصدير داخل النطاق", true),
  p("operations.vehicle.template.download", "تحميل قالب السيارات", "operations", "manage", "template_download", "action"),
  p("operations.vehicle.location.update", "تعديل موقع السيارة", "operations", "manage", "location_update", "action"),
  p("operations.vehicle.status.update", "تعديل حالة السيارة", "operations", "manage", "status_update", "action"),
  p("operations.vehicle.notes.update", "تعديل ملاحظات السيارة", "operations", "manage", "notes_update", "action"),
  p("operations.vehicle.checklist.update", "تعديل Checklist السيارة", "operations", "manage", "checklist_update", "action"),
  p("operations.movement.create", "تنفيذ حركة سيارات", "operations", "movement", "create", "action", "تغيير موقع أو حالة السيارات", true),
  p("operations.movement.delivered", "تنفيذ حركة مباع تم التسليم", "operations", "movement", "delivered", "workflow", "تنفيذ حركة التسليم النهائي", true),
  p("operations.movement.export", "تصدير سجل الحركات", "operations", "movements", "export", "action", "تصدير سجل الحركات", true),
  p("operations.transfer.create", "إنشاء طلب عمليات", "operations", "transfers", "create", "action", "إنشاء طلب نقل أو تصوير", true),
  p("operations.transfer.edit", "تعديل مسودة الطلب", "operations", "transfers", "edit", "action"),
  p("operations.transfer.send", "إرسال طلب العمليات", "operations", "transfers", "send", "workflow", "إرسال الطلب للتنفيذ", true),
  p("operations.transfer.note.add", "إضافة ملاحظة للطلب", "operations", "transfers", "note_add", "action"),
  p("operations.transfer.attachment.manage", "إدارة مرفقات الطلب", "operations", "transfers", "attachment_manage", "action"),
  p("operations.transfer.print", "طباعة الطلب", "operations", "transfers", "print", "action"),
  p("operations.transfer.export", "تصدير الطلب", "operations", "transfers", "export", "action"),
  p("operations.transfer.delete", "حذف طلب العمليات", "operations", "transfers", "delete", "action", "حذف الطلب", true),
  p("operations.transfer.cancel", "إلغاء طلب العمليات", "operations", "transfers", "cancel", "workflow", "إلغاء الطلب", true),
  p("operations.transfer.reopen", "إعادة فتح طلب العمليات", "operations", "transfers", "reopen", "workflow", "إعادة فتح طلب مكتمل", true),
  p("operations.request.receive_order", "مرحلة تم استلام الطلب", "operations", "transfers", "receive_order", "workflow"),
  p("operations.request.send_car", "مرحلة تم إرسال السيارة", "operations", "transfers", "send_car", "workflow"),
  p("operations.request.receive_car", "مرحلة تم استلام السيارة", "operations", "transfers", "receive_car", "workflow"),
  p("operations.request.finish_order", "مرحلة تم الانتهاء", "operations", "transfers", "finish_order", "workflow"),
  p("operations.request.rollback", "التراجع عن مرحلة طلب", "operations", "transfers", "rollback", "workflow", "التراجع مع تسجيل السبب", true),
  p("operations.request.skip", "تخطي مرحلة طلب", "operations", "transfers", "skip", "workflow", "تخطي الترتيب الطبيعي", true),
  p("operations.approval.financial", "الموافقة المالية", "operations", "approvals", "financial", "workflow", "اعتماد أو إلغاء الاعتماد المالي", true),
  p("operations.approval.administrative", "الموافقة الإدارية", "operations", "approvals", "administrative", "workflow", "اعتماد أو إلغاء الاعتماد الإداري", true),

  p("system.tracking.access", "دخول نظام التراكينج", "tracking", "orders", "access", "system"),
  p("tracking.orders.view", "مشاهدة طلبات التراكينج", "tracking", "orders", "view", "page"),
  p("tracking.archive.view", "مشاهدة أرشيف التراكينج", "tracking", "archive", "view", "page"),
  p("tracking.delete.view", "فتح صفحة حذف التراكينج", "tracking", "delete", "view", "page", "صفحة حذف حساسة", true),
  p("tracking.order.open", "فتح طلب التتبع", "tracking", "orders", "open", "action"),
  p("tracking.order.search", "البحث في طلبات التتبع", "tracking", "orders", "search", "action"),
  p("tracking.vehicle.select", "اختيار رقم الهيكل", "tracking", "orders", "vehicle_select", "action"),
  p("tracking.link.create", "إنشاء رابط التتبع", "tracking", "orders", "link_create", "action", "إنشاء رابط عام آمن", true),
  p("tracking.link.copy", "نسخ رابط التتبع", "tracking", "orders", "link_copy", "action"),
  p("tracking.order.archive", "أرشفة طلب التتبع", "tracking", "orders", "archive", "action"),
  p("tracking.order.restore", "استعادة طلب التتبع", "tracking", "archive", "restore", "action"),
  p("tracking.order.delete", "حذف طلب التتبع", "tracking", "delete", "delete", "action", "حذف الطلب مع السبب", true),
  p("tracking.order.deleted.restore", "حذف سجل طلب محذوف", "tracking", "delete", "restore_deleted", "action", "حذف سجل الطلب المحذوف للسماح باستقباله مجددًا", true),
  p("tracking.sms.send", "إرسال SMS", "tracking", "orders", "sms_send", "action", "إرسال رسالة نصية للعميل", true),
  ...Array.from({ length: 10 }, (_, index) => {
    const stage = String(index + 1).padStart(2, "0");
    return [
      p(`tracking.stage.${stage}.complete`, `تنفيذ المرحلة ${index + 1}`, "tracking", "orders", `stage_${stage}_complete`, "workflow", `إكمال مرحلة التتبع رقم ${index + 1}`),
      p(`tracking.stage.${stage}.rollback`, `التراجع عن المرحلة ${index + 1}`, "tracking", "orders", `stage_${stage}_rollback`, "workflow", `التراجع عن مرحلة التتبع رقم ${index + 1}`, true),
      p(`tracking.stage.${stage}.sms`, `إرسال SMS للمرحلة ${index + 1}`, "tracking", "orders", `stage_${stage}_sms`, "workflow", `إرسال رسالة المرحلة رقم ${index + 1}`, true),
    ];
  }).flat(),
  p("tracking.stage.skip", "تخطي مراحل التتبع", "tracking", "orders", "stage_skip", "workflow", "تخطي ترتيب المراحل", true),

  p("system.marketing.access", "دخول نظام التسويق", "marketing", "dashboard", "access", "system"),
  p("marketing.dashboard.view", "مشاهدة داش بورد التسويق", "marketing", "dashboard", "view", "page"),
  p("marketing.create_campaign.view", "فتح إنشاء حملة", "marketing", "create_campaign", "view", "page"),
  p("marketing.create_agenda.view", "فتح إنشاء أجندة", "marketing", "create_agenda", "view", "page"),
  p("marketing.database.view", "مشاهدة قاعدة بيانات التسويق", "marketing", "database", "view", "page"),
  p("marketing.packages.view", "مشاهدة إدارة الباقات", "marketing", "packages", "view", "page"),
  p("marketing.platforms.view", "مشاهدة ربط المنصات", "marketing", "platforms", "view", "page"),
  p("marketing.publish_prep.view", "مشاهدة تجهيز النشر", "marketing", "publish_prep", "view", "page"),
  p("marketing.monitoring.view", "مشاهدة المتابعة", "marketing", "monitoring", "view", "page"),
  p("marketing.calendar.view", "مشاهدة تقويم التسويق", "marketing", "calendar", "view", "page"),
  p("marketing.receipt_calendar.view", "مشاهدة تقويم الاستلام", "marketing", "receipt_calendar", "view", "page"),
  p("marketing.stock.view", "مشاهدة استوك التسويق", "marketing", "stock", "view", "page"),
  p("marketing.attendance.view", "مشاهدة الحضور والانصراف", "marketing", "attendance", "view", "page"),
  p("marketing.campaign.create", "إنشاء حملة", "marketing", "create_campaign", "create", "action", "إنشاء حملة جديدة", true),
  p("marketing.campaign.edit", "تعديل حملة", "marketing", "database", "edit", "action", "تعديل بيانات حملة", true),
  p("marketing.campaign.delete", "حذف حملة", "marketing", "database", "delete", "action", "حذف حملة", true),
  p("marketing.campaign.archive", "أرشفة حملة", "marketing", "database", "archive", "action"),
  p("marketing.agenda.create", "إنشاء أجندة", "marketing", "create_agenda", "create", "action", "إنشاء أجندة جديدة", true),
  p("marketing.agenda.edit", "تعديل أجندة", "marketing", "database", "edit", "action", "تعديل أجندة", true),
  p("marketing.agenda.delete", "حذف أجندة", "marketing", "database", "delete", "action", "حذف أجندة", true),
  p("marketing.structure.approve", "اعتماد الهيكل", "marketing", "database", "structure_approve", "workflow", "اعتماد هيكل الحملة أو الأجندة", true),
  p("marketing.structure.reject", "رفض أو طلب تعديل الهيكل", "marketing", "database", "structure_reject", "workflow", "رفض الهيكل أو إرجاعه", true),
  p("marketing.task.view_assigned", "مشاهدة التاسكات المسندة", "marketing", "dashboard", "task_view_assigned", "action"),
  p("marketing.task.view_all", "مشاهدة كل التاسكات", "marketing", "dashboard", "task_view_all", "action", "مشاهدة تاسكات كل المستخدمين", true),
  p("marketing.task.receive", "استلام التاسك", "marketing", "dashboard", "task_receive", "workflow"),
  p("marketing.task_template.download", "تحميل قالب Task Template", "marketing", "dashboard", "template_download", "action"),
  p("marketing.task_template.upload", "رفع Task Template", "marketing", "dashboard", "template_upload", "workflow"),
  p("marketing.task_template.reupload", "إعادة رفع Task Template", "marketing", "dashboard", "template_reupload", "workflow"),
  p("marketing.task_template.view_feedback", "مشاهدة ملاحظات Task Template", "marketing", "dashboard", "template_feedback", "action"),
  p("marketing.task_template.approve", "اعتماد Task Template", "marketing", "dashboard", "template_approve", "workflow", "اعتماد التعليمات", true),
  p("marketing.task_template.reject", "رفض أو طلب تعديل Task Template", "marketing", "dashboard", "template_reject", "workflow", "رفض أو إرجاع التعليمات", true),
  p("marketing.assignment_action.execute", "تنفيذ إجراء تكليف", "marketing", "dashboard", "assignment_execute", "workflow"),
  p("marketing.assignment_action.admin", "تنفيذ إجراء أدمن", "marketing", "dashboard", "assignment_admin", "workflow", "تنفيذ إجراء مخصص للإدارة", true),
  p("marketing.assignment_actions.approve", "اعتماد إجراءات التكليف", "marketing", "dashboard", "assignment_approve", "workflow", "اعتماد إجراءات التكليف", true),
  p("marketing.task.final_file.upload", "رفع الملف النهائي", "marketing", "dashboard", "final_file_upload", "action"),
  p("marketing.task.reopen", "إعادة فتح التاسك", "marketing", "dashboard", "task_reopen", "workflow", "إعادة فتح التاسك المكتمل", true),
  p("marketing.file.upload", "رفع ملف", "marketing", "database", "file_upload", "action"),
  p("marketing.file.download", "تحميل ملف", "marketing", "database", "file_download", "action"),
  p("marketing.file.delete", "حذف ملف", "marketing", "database", "file_delete", "action", "حذف ملف", true),
  p("marketing.file.view_others", "مشاهدة ملفات مستخدم آخر", "marketing", "database", "file_view_others", "action", "مشاهدة ملفات خارج الإسناد", true),
  p("marketing.publish_prep.manage", "تعديل تجهيز النشر", "marketing", "publish_prep", "manage", "action", "تعديل بيانات النشر", true),
  p("marketing.publish.now", "النشر الآن", "marketing", "publish_prep", "publish_now", "action", "تنفيذ النشر المباشر", true),
  p("marketing.photo_request.create", "إنشاء طلب تصوير", "marketing", "stock", "photo_request_create", "action", "إنشاء طلب تصوير مرتبط بالعمليات", true),
  p("marketing.photo_request.complete", "إنهاء طلب تصوير", "marketing", "stock", "photo_request_complete", "workflow"),
  p("marketing.attendance.manage", "إدارة الحضور والانصراف", "marketing", "attendance", "manage", "action", "تعديل إعدادات وتقارير الحضور", true),
  p("marketing.connections.manage", "إدارة ربط المنصات", "marketing", "platforms", "manage", "settings", "حفظ وفصل التوكنات", true),
];

export const PERMISSION_BY_CODE = new Map(PERMISSION_CATALOG.map((item) => [item.code, item]));

export function permissionSystem(code: string): AccessSystemCode {
  return PERMISSION_BY_CODE.get(code)?.system || "core";
}

export function hasPermission(user: AccessUserShape | null | undefined, code: string) {
  if (!user) return false;
  if (user.deniedPermissions?.includes(code)) return false;
  if (code !== "platform.superadmin" && user.permissions.includes("platform.superadmin")) return true;
  const system = permissionSystem(code);
  if (system !== "core" && !user.systemAccess?.[system]?.enabled) return false;
  return user.permissions.includes(code);
}

export function canAccessSystem(user: AccessUserShape | null | undefined, system: PlatformSystem) {
  return Boolean(user?.systemAccess?.[system]?.enabled && hasPermission(user, `system.${system}.access`));
}

export function canOpenSettings(user: AccessUserShape | null | undefined) {
  return PERMISSION_CATALOG.some((permission) => permission.system === "core" && permission.page === "settings" && hasPermission(user, permission.code));
}

export function isPlatformAdmin(user: AccessUserShape | null | undefined) {
  return hasPermission(user, "platform.superadmin");
}

export function firstAllowedPage(user: AccessUserShape | null | undefined, system: PlatformSystem) {
  const pages = PAGE_CATALOG.filter((page) => page.system === system).sort((a, b) => a.sortOrder - b.sortOrder);
  return pages.find((page) => hasPermission(user, `${system}.${page.code}.view`))?.route || `/${system}`;
}
