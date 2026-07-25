import { getSql, runSqlScript, withDatabaseAdvisoryLock } from "./_db.js";

export const ACCESS_CONTROL_SQL = String.raw`-- MZJ centralized access control. Safe and idempotent.

create table if not exists core.systems (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists core.system_pages (
  id uuid primary key default gen_random_uuid(),
  system_code text not null,
  code text not null,
  name_ar text not null,
  route text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
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
update core.permissions set name_ar=coalesce(nullif(name_ar,''),name), description_ar=coalesce(nullif(description_ar,''),name) where name_ar is null or description_ar is null;

alter table core.roles add column if not exists description_ar text;
alter table core.roles add column if not exists is_active boolean not null default true;
alter table core.roles add column if not exists updated_at timestamptz not null default now();

alter table core.users add column if not exists permission_version bigint not null default 1;
alter table core.users add column if not exists disabled_at timestamptz;
alter table core.users add column if not exists disabled_by uuid references core.users(id);
alter table core.users add column if not exists disabled_reason text;
alter table core.sessions add column if not exists permission_version bigint not null default 1;
update core.sessions s set permission_version=u.permission_version from core.users u where u.id=s.user_id;

create table if not exists core.user_systems (
  user_id uuid not null references core.users(id) on delete cascade,
  system_code text not null,
  is_enabled boolean not null default false,
  role_id uuid references core.roles(id) on delete set null,
  data_scope text not null default 'assigned' check (data_scope in ('self','assigned','created_by_me','branch','branches','department','departments','branch_and_department','source_branch','destination_branch','workflow_assigned','all')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,system_code)
);

create table if not exists core.user_system_branches (
  user_id uuid not null references core.users(id) on delete cascade,
  system_code text not null,
  branch_id uuid not null references core.branches(id) on delete cascade,
  is_primary boolean not null default false,
  primary key(user_id,system_code,branch_id)
);

create table if not exists core.user_system_departments (
  user_id uuid not null references core.users(id) on delete cascade,
  system_code text not null,
  department_id uuid not null references core.departments(id) on delete cascade,
  is_primary boolean not null default false,
  primary key(user_id,system_code,department_id)
);

create table if not exists core.user_permission_overrides (
  user_id uuid not null references core.users(id) on delete cascade,
  permission_id uuid not null references core.permissions(id) on delete cascade,
  effect text not null check(effect in ('allow','deny')),
  reason text,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,permission_id)
);

create table if not exists core.permission_change_log (
  id bigserial primary key,
  target_user_id uuid references core.users(id) on delete set null,
  target_role_id uuid references core.roles(id) on delete set null,
  changed_by uuid references core.users(id) on delete set null,
  change_type text not null,
  permission_code text,
  system_code text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  request_id text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists permission_change_log_target_user_idx on core.permission_change_log(target_user_id,created_at desc);
create index if not exists permission_change_log_changed_by_idx on core.permission_change_log(changed_by,created_at desc);

alter table audit.activity_log add column if not exists user_email text;
alter table audit.activity_log add column if not exists user_role text;
alter table audit.activity_log add column if not exists page_code text;
alter table audit.activity_log add column if not exists permission_code text;
alter table audit.activity_log add column if not exists branch_code text;
alter table audit.activity_log add column if not exists department_code text;
alter table audit.activity_log add column if not exists user_agent text;
alter table audit.activity_log add column if not exists result text;
alter table audit.activity_log add column if not exists rejection_reason text;
alter table audit.activity_log add column if not exists rollback_reason text;
alter table audit.activity_log add column if not exists request_id text;
create index if not exists activity_log_security_idx on audit.activity_log(result,created_at desc);

insert into core.systems(code,name_ar,sort_order,is_active) values
('operations','العمليات',10,true),
('tracking','التراكينج',20,true),
('marketing','التسويق',30,true),
('crm','CRM',40,true)
on conflict(code) do update set name_ar=excluded.name_ar,sort_order=excluded.sort_order,is_active=true,updated_at=now();

insert into core.systems(code,name_ar,sort_order,is_active) values ('core','المنصة المركزية',0,true) on conflict(code) do update set name_ar=excluded.name_ar,is_active=true,updated_at=now();

insert into core.system_pages(system_code,code,name_ar,route,sort_order,is_active) values
('core','dashboard','الداش بورد الموحد','/',10,true),
('core','reports','التقارير الموحدة','/reports',20,true),
('core','database','قاعدة البيانات الموحدة','/database',30,true),
('core','settings','الإعدادات','/settings',40,true),
('core','activity','سجل النشاط','/activity',50,true),
('crm','dashboard','الداش بورد','/crm',10,true),
('crm','database','قاعدة البيانات','/crm/database',20,true),
('crm','manual_leads','إضافة العملاء','/crm/manual-leads',30,true),
('crm','finance_history','سجل عملاء التمويل','/crm/finance-history',40,true),
('crm','inbox','رسائل غير مصنفة','/crm/inbox',50,true),
('crm','contacts','جهات الاتصال','/crm/contacts',60,true),
('crm','inbox_agent','وكيل صندوق الوارد','/crm/inbox-agent',70,true),
('crm','reports','التقارير','/crm/reports',80,true),
('crm','kpi','تقييم المناديب KPI','/crm/kpi',90,true),
('marketing','dashboard','الداش بورد','/marketing',10,true),
('marketing','create_campaign','إنشاء حملة','/marketing/create-campaign',20,true),
('marketing','create_agenda','إنشاء أجندة','/marketing/create-agenda',30,true),
('marketing','database','قاعدة البيانات','/marketing/database',40,true),
('marketing','packages','إدارة الباقات','/marketing/packages',50,true),
('marketing','platforms','ربط المنصات','/marketing/platforms',60,true),
('marketing','publish_prep','تجهيز النشر','/marketing/publish-prep',70,true),
('marketing','monitoring','المتابعة','/marketing/monitoring',80,true),
('marketing','calendar','التقويم','/marketing/calendar',90,true),
('marketing','receipt_calendar','تقويم الاستلام','/marketing/receipt-calendar',100,true),
('marketing','stock','الاستوك','/marketing/stock',110,true),
('marketing','attendance','الحضور والانصراف','/marketing/attendance',120,true),
('operations','inventory','مخزون السيارات','/operations',10,true),
('operations','manage','إدارة السيارات','/operations/manage',20,true),
('operations','movement','الحركة','/operations/movement',30,true),
('operations','transfers','الطلبات','/operations/transfers',40,true),
('operations','approvals','الموافقات','/operations/approvals',50,true),
('operations','all','جميع السيارات','/operations/all',60,true),
('operations','movements','سجل الحركات','/operations/movements',70,true),
('operations','archive','الأرشيف','/operations/archive',80,true),
('tracking','orders','طلبات التراكينج','/tracking',10,true),
('tracking','archive','أرشيف الطلبات','/tracking/archive',20,true),
('tracking','delete','حذف طلبات التراكينج','/tracking/delete',30,true)
on conflict(system_code,code) do update set name_ar=excluded.name_ar,route=excluded.route,sort_order=excluded.sort_order,is_active=true,updated_at=now();

insert into core.permissions(code,name,system_code,page_code,action_code,name_ar,description_ar,category,is_sensitive,sort_order,is_active) values
('platform.superadmin','صلاحية مدير النظام العليا','core','settings','superadmin','صلاحية مدير النظام العليا','تجاوز إداري كامل عبر قالب مدير النظام فقط','security',true,10,true),
('platform.dashboard.view','مشاهدة الداش بورد الموحد','core','dashboard','view','مشاهدة الداش بورد الموحد','مشاهدة الداش بورد الموحد','page',false,20,true),
('platform.reports.view','مشاهدة التقارير الموحدة','core','reports','view','مشاهدة التقارير الموحدة','مشاهدة التقارير الموحدة','page',false,30,true),
('platform.database.view','مشاهدة قاعدة البيانات الموحدة','core','database','view','مشاهدة قاعدة البيانات الموحدة','مشاهدة قاعدة البيانات الموحدة','page',false,40,true),
('platform.activity.view','مشاهدة سجل النشاط','core','activity','view','مشاهدة سجل النشاط','مشاهدة سجل النشاط التشغيلي','page',true,50,true),
('settings.view','فتح الإعدادات','core','settings','view','فتح الإعدادات','فتح الإعدادات','settings',false,60,true),
('settings.users.view','مشاهدة المستخدمين','core','settings','users_view','مشاهدة المستخدمين','مشاهدة المستخدمين وتفاصيل صلاحياتهم','settings',true,70,true),
('settings.users.create','إنشاء مستخدم','core','settings','users_create','إنشاء مستخدم','إنشاء حساب مستخدم جديد','settings',true,80,true),
('settings.users.update','تعديل مستخدم','core','settings','users_update','تعديل مستخدم','تعديل بيانات المستخدم وربطه','settings',true,90,true),
('settings.users.disable','تعطيل وتفعيل مستخدم','core','settings','users_disable','تعطيل وتفعيل مستخدم','تعطيل الحساب وإبطال جلساته','settings',true,100,true),
('settings.roles.manage','إدارة الأدوار وقوالب الصلاحيات','core','settings','roles_manage','إدارة الأدوار وقوالب الصلاحيات','إنشاء وتعديل الأدوار وقوالبها','settings',true,110,true),
('settings.permissions.manage','إدارة الصلاحيات الفردية','core','settings','permissions_manage','إدارة الصلاحيات الفردية','منح ومنع الصلاحيات الفردية','settings',true,120,true),
('settings.branches.manage','إدارة الفروع','core','settings','branches_manage','إدارة الفروع','إضافة وتعديل الفروع','settings',true,130,true),
('settings.departments.manage','إدارة الأقسام','core','settings','departments_manage','إدارة الأقسام','إضافة وتعديل الأقسام','settings',true,140,true),
('settings.audit.view','مشاهدة سجل تعديلات الصلاحيات','core','settings','audit_view','مشاهدة سجل تعديلات الصلاحيات','مشاهدة قبل وبعد كل تعديل صلاحيات','security',true,150,true),
('settings.security.view','مشاهدة سجل النشاط الأمني','core','settings','security_view','مشاهدة سجل النشاط الأمني','مشاهدة محاولات الدخول والرفض والتغييرات الحساسة','security',true,160,true),
('settings.crm.view','مشاهدة إعدادات CRM','core','settings','crm_view','مشاهدة إعدادات CRM','مشاهدة إعدادات CRM','settings',false,170,true),
('settings.crm.manage','تعديل إعدادات CRM','core','settings','crm_manage','تعديل إعدادات CRM','تعديل إعدادات CRM التشغيلية','settings',true,180,true),
('settings.marketing.view','مشاهدة إعدادات التسويق','core','settings','marketing_view','مشاهدة إعدادات التسويق','مشاهدة إعدادات التسويق','settings',false,190,true),
('settings.marketing.manage','تعديل إعدادات التسويق','core','settings','marketing_manage','تعديل إعدادات التسويق','تعديل إعدادات التسويق التشغيلية','settings',true,200,true),
('settings.operations.view','مشاهدة إعدادات العمليات','core','settings','operations_view','مشاهدة إعدادات العمليات','مشاهدة إعدادات العمليات','settings',false,210,true),
('settings.operations.manage','تعديل إعدادات العمليات','core','settings','operations_manage','تعديل إعدادات العمليات','تعديل إعدادات العمليات التشغيلية','settings',true,220,true),
('settings.tracking.view','مشاهدة إعدادات التتبع','core','settings','tracking_view','مشاهدة إعدادات التتبع','مشاهدة إعدادات التتبع','settings',false,230,true),
('settings.tracking.manage','تعديل إعدادات التتبع','core','settings','tracking_manage','تعديل إعدادات التتبع','تعديل إعدادات التتبع التشغيلية','settings',true,240,true),
('system.crm.access','دخول نظام CRM','crm','dashboard','access','دخول نظام CRM','دخول نظام CRM','system',false,250,true),
('crm.dashboard.view','مشاهدة داش بورد CRM','crm','dashboard','view','مشاهدة داش بورد CRM','مشاهدة داش بورد CRM','page',false,260,true),
('crm.database.view','مشاهدة قاعدة بيانات CRM','crm','database','view','مشاهدة قاعدة بيانات CRM','مشاهدة قاعدة بيانات CRM','page',false,270,true),
('crm.manual_leads.view','فتح إضافة العملاء','crm','manual_leads','view','فتح إضافة العملاء','فتح إضافة العملاء','page',false,280,true),
('crm.finance_history.view','مشاهدة سجل عملاء التمويل','crm','finance_history','view','مشاهدة سجل عملاء التمويل','مشاهدة سجل عملاء التمويل','page',false,290,true),
('crm.inbox.view','مشاهدة الرسائل غير المصنفة','crm','inbox','view','مشاهدة الرسائل غير المصنفة','مشاهدة الرسائل غير المصنفة','page',false,300,true),
('crm.contacts.view','مشاهدة جهات الاتصال','crm','contacts','view','مشاهدة جهات الاتصال','مشاهدة جهات الاتصال','page',false,310,true),
('crm.inbox_agent.view','فتح وكيل صندوق الوارد','crm','inbox_agent','view','فتح وكيل صندوق الوارد','فتح وكيل صندوق الوارد','page',false,320,true),
('crm.reports.view','مشاهدة تقارير CRM','crm','reports','view','مشاهدة تقارير CRM','مشاهدة تقارير CRM','page',false,330,true),
('crm.kpi.view','مشاهدة KPI','crm','kpi','view','مشاهدة KPI','مشاهدة KPI','page',false,340,true),
('crm.customer.view','فتح بيانات العميل','crm','database','customer_view','فتح بيانات العميل','فتح بيانات العميل','action',false,360,true),
('crm.customer.create','إنشاء عميل','crm','manual_leads','customer_create','إنشاء عميل','إنشاء عميل','action',false,370,true),
('crm.customer.update','تعديل بيانات العميل','crm','database','customer_update','تعديل بيانات العميل','تعديل بيانات العميل','action',false,380,true),
('crm.customer.status.update','تعديل حالة العميل','crm','database','status_update','تعديل حالة العميل','تعديل حالة العميل','action',false,390,true),
('crm.customer.note.add','إضافة ملاحظة للعميل','crm','database','note_add','إضافة ملاحظة للعميل','إضافة ملاحظة للعميل','action',false,400,true),
('crm.customer.owner.change','تغيير مسؤول العميل','crm','database','owner_change','تغيير مسؤول العميل','تغيير مندوب المبيعات','action',true,410,true),
('crm.customer.call_center.change','تغيير مندوب الكول سنتر','crm','database','call_center_change','تغيير مندوب الكول سنتر','تغيير مندوب الكول سنتر','action',true,420,true),
('crm.customer.transfer','نقل عميل','crm','database','transfer','نقل عميل','نقل العميل بين الأقسام','action',true,430,true),
('crm.customer.bulk_transfer','نقل مجموعة عملاء','crm','database','bulk_transfer','نقل مجموعة عملاء','نقل مجموعة من العملاء','action',true,440,true),
('crm.customer.delete','حذف عميل','crm','database','delete','حذف عميل','حذف العميل منطقيًا','action',true,450,true),
('crm.customer.restore','استعادة عميل','crm','database','restore','استعادة عميل','استعادة عميل','action',false,460,true),
('crm.customer.export','تصدير العملاء','crm','database','export','تصدير العملاء','تصدير البيانات داخل النطاق','action',true,470,true),
('crm.customer.history.view','مشاهدة سجل العميل','crm','finance_history','history_view','مشاهدة سجل العميل','مشاهدة سجل العميل','action',false,480,true),
('crm.customer.ownership.view','مشاهدة سجل ملكية العملاء','crm','finance_history','ownership_view','مشاهدة سجل ملكية العملاء','مشاهدة سجل ملكية العملاء','action',false,490,true),
('crm.manual_lead.request','إنشاء طلب إضافة عميل','crm','manual_leads','request','إنشاء طلب إضافة عميل','إنشاء طلب إضافة عميل','action',false,500,true),
('crm.manual_lead.view_own','مشاهدة طلبات الإضافة الخاصة','crm','manual_leads','view_own','مشاهدة طلبات الإضافة الخاصة','مشاهدة طلبات الإضافة الخاصة','action',false,510,true),
('crm.manual_lead.view_all','مشاهدة كل طلبات الإضافة','crm','manual_leads','view_all','مشاهدة كل طلبات الإضافة','مشاهدة كل طلبات الإضافة','action',false,520,true),
('crm.manual_lead.duplicate.approve','اعتماد العميل المكرر','crm','manual_leads','duplicate_approve','اعتماد العميل المكرر','اعتماد طلب عميل مكرر','action',true,530,true),
('crm.manual_lead.reject','رفض طلب إضافة العميل','crm','manual_leads','reject','رفض طلب إضافة العميل','رفض الطلب','action',true,540,true),
('crm.manual_lead.delete','حذف طلب إضافة العميل','crm','manual_leads','delete','حذف طلب إضافة العميل','حذف الطلب','action',true,550,true),
('crm.manual_lead.redistribute','إعادة توزيع العملاء','crm','manual_leads','redistribute','إعادة توزيع العملاء','إعادة توزيع العملاء','action',true,560,true),
('crm.conversation.view','مشاهدة المحادثة','crm','inbox_agent','conversation_view','مشاهدة المحادثة','مشاهدة المحادثة','action',false,570,true),
('crm.conversation.send_text','إرسال رسالة نصية','crm','inbox_agent','send_text','إرسال رسالة نصية','إرسال نص للعميل','action',true,580,true),
('crm.conversation.send_template','إرسال قالب','crm','inbox_agent','send_template','إرسال قالب','إرسال قالب معتمد','action',true,590,true),
('crm.conversation.send_media','إرسال مرفق','crm','inbox_agent','send_media','إرسال مرفق','إرسال صورة أو فيديو أو ملف','action',true,600,true),
('crm.conversation.download','تحميل مرفق','crm','inbox_agent','download','تحميل مرفق','تحميل مرفق','action',false,610,true),
('crm.conversation.mark_read','تعليم المحادثة كمقروءة','crm','inbox_agent','mark_read','تعليم المحادثة كمقروءة','تعليم المحادثة كمقروءة','action',false,620,true),
('crm.conversation.mark_unread','تعليم المحادثة كغير مقروءة','crm','inbox_agent','mark_unread','تعليم المحادثة كغير مقروءة','تعليم المحادثة كغير مقروءة','action',false,630,true),
('crm.conversation.classify','تصنيف المحادثة','crm','inbox','classify','تصنيف المحادثة','ربط المحادثة بالخدمة','action',true,640,true),
('crm.conversation.link','ربط محادثة بعميل','crm','inbox','link','ربط محادثة بعميل','ربط المحادثة بملف عميل','action',true,650,true),
('crm.conversation.view_all','مشاهدة كل المحادثات','crm','inbox_agent','view_all','مشاهدة كل المحادثات','مشاهدة كل المحادثات','action',false,660,true),
('crm.conversation.view_assigned','مشاهدة المحادثات المسندة','crm','inbox_agent','view_assigned','مشاهدة المحادثات المسندة','مشاهدة المحادثات المسندة','action',false,670,true),
('crm.reports.departments','مشاهدة تقارير الأقسام','crm','reports','departments','مشاهدة تقارير الأقسام','مشاهدة تقارير الأقسام','action',false,680,true),
('crm.reports.agents','مشاهدة تقارير المناديب','crm','reports','agents','مشاهدة تقارير المناديب','مشاهدة تقارير المناديب','action',false,690,true),
('crm.reports.customer_details','فتح تفاصيل عملاء التقارير','crm','reports','customer_details','فتح تفاصيل عملاء التقارير','فتح تفاصيل عملاء التقارير','action',false,700,true),
('crm.reports.export','تصدير تقارير CRM','crm','reports','export','تصدير تقارير CRM','تصدير التقارير داخل النطاق','action',true,710,true),
('crm.data_review.view','مشاهدة مراجعة أخطاء البيانات','crm','reports','data_review_view','مشاهدة مراجعة أخطاء البيانات','فحص أخطاء البيانات داخل نطاق المستخدم','action',false,715,true),
('crm.data_review.execute','تنفيذ تصحيح أخطاء البيانات','crm','reports','data_review_execute','تنفيذ تصحيح أخطاء البيانات','تنفيذ تصحيحات جماعية مسجلة في Audit Log','action',true,716,true),
('crm.kpi.rating.create','إضافة تقييم','crm','kpi','rating_create','إضافة تقييم','إضافة تقييم','action',false,720,true),
('crm.kpi.rating.update','تعديل تقييم','crm','kpi','rating_update','تعديل تقييم','تعديل تقييم','action',false,730,true),
('crm.kpi.rating.delete','حذف تقييم','crm','kpi','rating_delete','حذف تقييم','حذف تقييم مندوب','action',true,740,true),
('crm.kpi.rate_branch','تقييم مندوبي الفرع','crm','kpi','rate_branch','تقييم مندوبي الفرع','تقييم مندوبي الفرع','action',false,750,true),
('crm.kpi.rate_all','تقييم جميع المناديب','crm','kpi','rate_all','تقييم جميع المناديب','تقييم خارج نطاق الفرع','action',true,760,true),
('crm.routing.manage','إدارة قواعد التوزيع','crm','settings','routing_manage','إدارة قواعد التوزيع','إدارة التوزيع الآلي','settings',true,780,true),
('crm.automation.manage','إدارة الأتمتة','crm','settings','automation_manage','إدارة الأتمتة','إدارة تدفقات الأتمتة','settings',true,790,true),
('crm.contacts.purge','حذف ملف جهة اتصال بالكامل','crm','contacts','purge','حذف ملف جهة اتصال بالكامل','حذف الملف وطلباته ومحادثاته','action',true,800,true),
('system.operations.access','دخول نظام العمليات','operations','inventory','access','دخول نظام العمليات','دخول نظام العمليات','system',false,810,true),
('operations.inventory.view','مشاهدة مخزون السيارات','operations','inventory','view','مشاهدة مخزون السيارات','مشاهدة مخزون السيارات','page',false,820,true),
('operations.manage.view','فتح إدارة السيارات','operations','manage','view','فتح إدارة السيارات','فتح إدارة السيارات','page',false,830,true),
('operations.movement.view','فتح صفحة الحركة','operations','movement','view','فتح صفحة الحركة','فتح صفحة الحركة','page',false,840,true),
('operations.transfers.view','مشاهدة طلبات العمليات','operations','transfers','view','مشاهدة طلبات العمليات','مشاهدة طلبات العمليات','page',false,850,true),
('operations.approvals.view','مشاهدة الموافقات','operations','approvals','view','مشاهدة الموافقات','مشاهدة الموافقات','page',false,860,true),
('operations.all.view','مشاهدة جميع السيارات','operations','all','view','مشاهدة جميع السيارات','مشاهدة جميع السيارات','page',false,870,true),
('operations.movements.view','مشاهدة سجل الحركات','operations','movements','view','مشاهدة سجل الحركات','مشاهدة سجل الحركات','page',false,880,true),
('operations.archive.view','مشاهدة أرشيف السيارات','operations','archive','view','مشاهدة أرشيف السيارات','مشاهدة أرشيف السيارات','page',false,890,true),
('operations.vehicle.view','فتح بيانات السيارة','operations','inventory','vehicle_view','فتح بيانات السيارة','فتح بيانات السيارة','action',false,910,true),
('operations.vehicle.create','إضافة سيارة','operations','manage','create','إضافة سيارة','إضافة سيارة','action',false,920,true),
('operations.vehicle.edit','تعديل سيارة','operations','manage','edit','تعديل سيارة','تعديل سيارة','action',false,930,true),
('operations.vehicle.vin.update','تعديل رقم الهيكل VIN','operations','manage','vin_update','تعديل رقم الهيكل VIN','تعديل رقم الهيكل المسجل','action',true,935,true),
('operations.vehicle.delete','حذف سيارة','operations','manage','delete','حذف سيارة','حذف السيارة','action',true,940,true),
('operations.vehicle.archive','أرشفة سيارة','operations','archive','archive','أرشفة سيارة','أرشفة سيارة','action',false,950,true),
('operations.vehicle.restore','استعادة سيارة','operations','archive','restore','استعادة سيارة','استعادة سيارة','action',false,960,true),
('operations.vehicle.import','استيراد السيارات','operations','manage','import','استيراد السيارات','استيراد جماعي','action',true,970,true),
('operations.vehicle.export','تصدير السيارات','operations','inventory','export','تصدير السيارات','تصدير داخل النطاق','action',true,980,true),
('operations.vehicle.template.download','تحميل قالب السيارات','operations','manage','template_download','تحميل قالب السيارات','تحميل قالب السيارات','action',false,990,true),
('operations.vehicle.location.update','تعديل موقع السيارة','operations','manage','location_update','تعديل موقع السيارة','تعديل موقع السيارة','action',false,1000,true),
('operations.vehicle.status.update','تعديل حالة السيارة','operations','manage','status_update','تعديل حالة السيارة','تعديل حالة السيارة','action',false,1010,true),
('operations.vehicle.notes.update','تعديل ملاحظات السيارة','operations','manage','notes_update','تعديل ملاحظات السيارة','تعديل ملاحظات السيارة','action',false,1020,true),
('operations.vehicle.checklist.update','تعديل Checklist السيارة','operations','manage','checklist_update','تعديل Checklist السيارة','تعديل Checklist السيارة','action',false,1030,true),
('operations.movement.create','تنفيذ حركة سيارات','operations','movement','create','تنفيذ حركة سيارات','تغيير موقع أو حالة السيارات','action',true,1040,true),
('operations.movement.delivered','تنفيذ حركة مباع تم التسليم','operations','movement','delivered','تنفيذ حركة مباع تم التسليم','تنفيذ حركة التسليم النهائي','workflow',true,1050,true),
('operations.movement.export','تصدير سجل الحركات','operations','movements','export','تصدير سجل الحركات','تصدير سجل الحركات','action',true,1060,true),
('operations.transfer.create','إنشاء طلب عمليات','operations','transfers','create','إنشاء طلب عمليات','إنشاء طلب نقل أو تصوير','action',true,1070,true),
('operations.transfer.edit','تعديل مسودة الطلب','operations','transfers','edit','تعديل مسودة الطلب','تعديل مسودة الطلب','action',false,1080,true),
('operations.transfer.send','إرسال طلب العمليات','operations','transfers','send','إرسال طلب العمليات','إرسال الطلب للتنفيذ','workflow',true,1090,true),
('operations.transfer.note.add','إضافة ملاحظة للطلب','operations','transfers','note_add','إضافة ملاحظة للطلب','إضافة ملاحظة للطلب','action',false,1100,true),
('operations.transfer.attachment.manage','إدارة مرفقات الطلب','operations','transfers','attachment_manage','إدارة مرفقات الطلب','إدارة مرفقات الطلب','action',false,1110,true),
('operations.transfer.print','طباعة الطلب','operations','transfers','print','طباعة الطلب','طباعة الطلب','action',false,1120,true),
('operations.transfer.export','تصدير الطلب','operations','transfers','export','تصدير الطلب','تصدير الطلب','action',false,1130,true),
('operations.transfer.delete','حذف طلب العمليات','operations','transfers','delete','حذف طلب العمليات','حذف الطلب','action',true,1140,true),
('operations.transfer.cancel','إلغاء طلب العمليات','operations','transfers','cancel','إلغاء طلب العمليات','إلغاء الطلب','workflow',true,1150,true),
('operations.transfer.reopen','إعادة فتح طلب العمليات','operations','transfers','reopen','إعادة فتح طلب العمليات','إعادة فتح طلب مكتمل','workflow',true,1160,true),
('operations.request.receive_order','مرحلة تم استلام الطلب','operations','transfers','receive_order','مرحلة تم استلام الطلب','مرحلة تم استلام الطلب','workflow',false,1170,true),
('operations.request.send_car','مرحلة تم إرسال السيارة','operations','transfers','send_car','مرحلة تم إرسال السيارة','مرحلة تم إرسال السيارة','workflow',false,1180,true),
('operations.request.receive_car','مرحلة تم استلام السيارة','operations','transfers','receive_car','مرحلة تم استلام السيارة','مرحلة تم استلام السيارة','workflow',false,1190,true),
('operations.request.finish_order','مرحلة تم الانتهاء','operations','transfers','finish_order','مرحلة تم الانتهاء','مرحلة تم الانتهاء','workflow',false,1200,true),
('operations.request.rollback','التراجع عن مرحلة طلب','operations','transfers','rollback','التراجع عن مرحلة طلب','التراجع مع تسجيل السبب','workflow',true,1210,true),
('operations.request.skip','تخطي مرحلة طلب','operations','transfers','skip','تخطي مرحلة طلب','تخطي الترتيب الطبيعي','workflow',true,1220,true),
('operations.approval.financial','الموافقة المالية','operations','approvals','financial','الموافقة المالية','اعتماد أو إلغاء الاعتماد المالي','workflow',true,1230,true),
('operations.approval.administrative','الموافقة الإدارية','operations','approvals','administrative','الموافقة الإدارية','اعتماد أو إلغاء الاعتماد الإداري','workflow',true,1240,true),
('system.tracking.access','دخول نظام التراكينج','tracking','orders','access','دخول نظام التراكينج','دخول نظام التراكينج','system',false,1260,true),
('tracking.orders.view','مشاهدة طلبات التراكينج','tracking','orders','view','مشاهدة طلبات التراكينج','مشاهدة طلبات التراكينج','page',false,1270,true),
('tracking.archive.view','مشاهدة أرشيف التراكينج','tracking','archive','view','مشاهدة أرشيف التراكينج','مشاهدة أرشيف التراكينج','page',false,1280,true),
('tracking.delete.view','فتح صفحة حذف التراكينج','tracking','delete','view','فتح صفحة حذف التراكينج','صفحة حذف حساسة','page',true,1290,true),
('tracking.order.open','فتح طلب التتبع','tracking','orders','open','فتح طلب التتبع','فتح طلب التتبع','action',false,1310,true),
('tracking.order.search','البحث في طلبات التتبع','tracking','orders','search','البحث في طلبات التتبع','البحث في طلبات التتبع','action',false,1320,true),
('tracking.vehicle.select','اختيار رقم الهيكل','tracking','orders','vehicle_select','اختيار رقم الهيكل','اختيار رقم الهيكل','action',false,1330,true),
('tracking.link.create','إنشاء رابط التتبع','tracking','orders','link_create','إنشاء رابط التتبع','إنشاء رابط عام آمن','action',true,1340,true),
('tracking.link.copy','نسخ رابط التتبع','tracking','orders','link_copy','نسخ رابط التتبع','نسخ رابط التتبع','action',false,1350,true),
('tracking.order.archive','أرشفة طلب التتبع','tracking','orders','archive','أرشفة طلب التتبع','أرشفة طلب التتبع','action',false,1360,true),
('tracking.order.restore','استعادة طلب التتبع','tracking','archive','restore','استعادة طلب التتبع','استعادة طلب التتبع','action',false,1370,true),
('tracking.order.delete','حذف طلب التتبع','tracking','delete','delete','حذف طلب التتبع','حذف الطلب مع السبب','action',true,1380,true),
('tracking.order.deleted.restore','حذف سجل طلب محذوف','tracking','delete','restore_deleted','حذف سجل طلب محذوف','حذف سجل الطلب المحذوف للسماح باستقباله مجددًا','action',true,1390,true),
('tracking.sms.send','إرسال SMS','tracking','orders','sms_send','إرسال SMS','إرسال رسالة نصية للعميل','action',true,1400,true),
('tracking.stage.skip','تخطي مراحل التتبع','tracking','orders','stage_skip','تخطي مراحل التتبع','تخطي ترتيب المراحل','workflow',true,1410,true),
('system.marketing.access','دخول نظام التسويق','marketing','dashboard','access','دخول نظام التسويق','دخول نظام التسويق','system',false,1430,true),
('marketing.dashboard.view','مشاهدة داش بورد التسويق','marketing','dashboard','view','مشاهدة داش بورد التسويق','مشاهدة داش بورد التسويق','page',false,1440,true),
('marketing.create_campaign.view','فتح إنشاء حملة','marketing','create_campaign','view','فتح إنشاء حملة','فتح إنشاء حملة','page',false,1450,true),
('marketing.create_agenda.view','فتح إنشاء أجندة','marketing','create_agenda','view','فتح إنشاء أجندة','فتح إنشاء أجندة','page',false,1460,true),
('marketing.database.view','مشاهدة قاعدة بيانات التسويق','marketing','database','view','مشاهدة قاعدة بيانات التسويق','مشاهدة قاعدة بيانات التسويق','page',false,1470,true),
('marketing.packages.view','مشاهدة إدارة الباقات','marketing','packages','view','مشاهدة إدارة الباقات','مشاهدة إدارة الباقات','page',false,1480,true),
('marketing.platforms.view','مشاهدة ربط المنصات','marketing','platforms','view','مشاهدة ربط المنصات','مشاهدة ربط المنصات','page',false,1490,true),
('marketing.publish_prep.view','مشاهدة تجهيز النشر','marketing','publish_prep','view','مشاهدة تجهيز النشر','مشاهدة تجهيز النشر','page',false,1500,true),
('marketing.monitoring.view','مشاهدة المتابعة','marketing','monitoring','view','مشاهدة المتابعة','مشاهدة المتابعة','page',false,1510,true),
('marketing.calendar.view','مشاهدة تقويم التسويق','marketing','calendar','view','مشاهدة تقويم التسويق','مشاهدة تقويم التسويق','page',false,1520,true),
('marketing.receipt_calendar.view','مشاهدة تقويم الاستلام','marketing','receipt_calendar','view','مشاهدة تقويم الاستلام','مشاهدة تقويم الاستلام','page',false,1530,true),
('marketing.stock.view','مشاهدة استوك التسويق','marketing','stock','view','مشاهدة استوك التسويق','مشاهدة استوك التسويق','page',false,1540,true),
('marketing.attendance.view','مشاهدة الحضور والانصراف','marketing','attendance','view','مشاهدة الحضور والانصراف','مشاهدة الحضور والانصراف','page',false,1550,true),
('marketing.campaign.create','إنشاء حملة','marketing','create_campaign','create','إنشاء حملة','إنشاء حملة جديدة','action',true,1570,true),
('marketing.campaign.edit','تعديل حملة','marketing','database','edit','تعديل حملة','تعديل بيانات حملة','action',true,1580,true),
('marketing.campaign.delete','حذف حملة','marketing','database','delete','حذف حملة','حذف حملة','action',true,1590,true),
('marketing.campaign.archive','أرشفة حملة','marketing','database','archive','أرشفة حملة','أرشفة حملة','action',false,1600,true),
('marketing.agenda.create','إنشاء أجندة','marketing','create_agenda','create','إنشاء أجندة','إنشاء أجندة جديدة','action',true,1610,true),
('marketing.agenda.edit','تعديل أجندة','marketing','database','edit','تعديل أجندة','تعديل أجندة','action',true,1620,true),
('marketing.agenda.delete','حذف أجندة','marketing','database','delete','حذف أجندة','حذف أجندة','action',true,1630,true),
('marketing.structure.approve','اعتماد الهيكل','marketing','database','structure_approve','اعتماد الهيكل','اعتماد هيكل الحملة أو الأجندة','workflow',true,1640,true),
('marketing.structure.reject','رفض أو طلب تعديل الهيكل','marketing','database','structure_reject','رفض أو طلب تعديل الهيكل','رفض الهيكل أو إرجاعه','workflow',true,1650,true),
('marketing.task.view_assigned','مشاهدة التاسكات المسندة','marketing','dashboard','task_view_assigned','مشاهدة التاسكات المسندة','مشاهدة التاسكات المسندة','action',false,1660,true),
('marketing.task.view_all','مشاهدة كل التاسكات','marketing','dashboard','task_view_all','مشاهدة كل التاسكات','مشاهدة تاسكات كل المستخدمين','action',true,1670,true),
('marketing.task.receive','استلام التاسك','marketing','dashboard','task_receive','استلام التاسك','استلام التاسك','workflow',false,1680,true),
('marketing.task_template.download','تحميل قالب Task Template','marketing','dashboard','template_download','تحميل قالب Task Template','تحميل قالب Task Template','action',false,1690,true),
('marketing.task_template.upload','رفع Task Template','marketing','dashboard','template_upload','رفع Task Template','رفع Task Template','workflow',false,1700,true),
('marketing.task_template.reupload','إعادة رفع Task Template','marketing','dashboard','template_reupload','إعادة رفع Task Template','إعادة رفع Task Template','workflow',false,1710,true),
('marketing.task_template.view_feedback','مشاهدة ملاحظات Task Template','marketing','dashboard','template_feedback','مشاهدة ملاحظات Task Template','مشاهدة ملاحظات Task Template','action',false,1720,true),
('marketing.task_template.approve','اعتماد Task Template','marketing','dashboard','template_approve','اعتماد Task Template','اعتماد التعليمات','workflow',true,1730,true),
('marketing.task_template.reject','رفض أو طلب تعديل Task Template','marketing','dashboard','template_reject','رفض أو طلب تعديل Task Template','رفض أو إرجاع التعليمات','workflow',true,1740,true),
('marketing.assignment_action.execute','تنفيذ إجراء تكليف','marketing','dashboard','assignment_execute','تنفيذ إجراء تكليف','تنفيذ إجراء تكليف','workflow',false,1750,true),
('marketing.assignment_action.admin','تنفيذ إجراء أدمن','marketing','dashboard','assignment_admin','تنفيذ إجراء أدمن','تنفيذ إجراء مخصص للإدارة','workflow',true,1760,true),
('marketing.assignment_actions.approve','اعتماد إجراءات التكليف','marketing','dashboard','assignment_approve','اعتماد إجراءات التكليف','اعتماد إجراءات التكليف','workflow',true,1770,true),
('marketing.task.final_file.upload','رفع الملف النهائي','marketing','dashboard','final_file_upload','رفع الملف النهائي','رفع الملف النهائي','action',false,1780,true),
('marketing.task.reopen','إعادة فتح التاسك','marketing','dashboard','task_reopen','إعادة فتح التاسك','إعادة فتح التاسك المكتمل','workflow',true,1790,true),
('marketing.file.upload','رفع ملف','marketing','database','file_upload','رفع ملف','رفع ملف','action',false,1800,true),
('marketing.file.download','تحميل ملف','marketing','database','file_download','تحميل ملف','تحميل ملف','action',false,1810,true),
('marketing.file.delete','حذف ملف','marketing','database','file_delete','حذف ملف','حذف ملف','action',true,1820,true),
('marketing.file.view_others','مشاهدة ملفات مستخدم آخر','marketing','database','file_view_others','مشاهدة ملفات مستخدم آخر','مشاهدة ملفات خارج الإسناد','action',true,1830,true),
('marketing.publish_prep.manage','تعديل تجهيز النشر','marketing','publish_prep','manage','تعديل تجهيز النشر','تعديل بيانات النشر','action',true,1840,true),
('marketing.publish.now','النشر الآن','marketing','publish_prep','publish_now','النشر الآن','تنفيذ النشر المباشر','action',true,1850,true),
('marketing.photo_request.create','إنشاء طلب تصوير','marketing','stock','photo_request_create','إنشاء طلب تصوير','إنشاء طلب تصوير مرتبط بالعمليات','action',true,1860,true),
('marketing.photo_request.complete','إنهاء طلب تصوير','marketing','stock','photo_request_complete','إنهاء طلب تصوير','إنهاء طلب تصوير','workflow',false,1870,true),
('marketing.attendance.manage','إدارة الحضور والانصراف','marketing','attendance','manage','إدارة الحضور والانصراف','تعديل إعدادات وتقارير الحضور','action',true,1880,true),
('marketing.connections.manage','إدارة ربط المنصات','marketing','platforms','manage','إدارة ربط المنصات','حفظ وفصل التوكنات','settings',true,1890,true),
('tracking.stage.01.complete','تنفيذ المرحلة 1','tracking','orders','stage_01_complete','تنفيذ المرحلة 1','إكمال مرحلة التتبع رقم 1','workflow',false,1910,true),
('tracking.stage.01.rollback','التراجع عن المرحلة 1','tracking','orders','stage_01_rollback','التراجع عن المرحلة 1','التراجع عن مرحلة التتبع رقم 1','workflow',true,1920,true),
('tracking.stage.01.sms','إرسال SMS للمرحلة 1','tracking','orders','stage_01_sms','إرسال SMS للمرحلة 1','إرسال رسالة المرحلة رقم 1','workflow',true,1930,true),
('tracking.stage.02.complete','تنفيذ المرحلة 2','tracking','orders','stage_02_complete','تنفيذ المرحلة 2','إكمال مرحلة التتبع رقم 2','workflow',false,1940,true),
('tracking.stage.02.rollback','التراجع عن المرحلة 2','tracking','orders','stage_02_rollback','التراجع عن المرحلة 2','التراجع عن مرحلة التتبع رقم 2','workflow',true,1950,true),
('tracking.stage.02.sms','إرسال SMS للمرحلة 2','tracking','orders','stage_02_sms','إرسال SMS للمرحلة 2','إرسال رسالة المرحلة رقم 2','workflow',true,1960,true),
('tracking.stage.03.complete','تنفيذ المرحلة 3','tracking','orders','stage_03_complete','تنفيذ المرحلة 3','إكمال مرحلة التتبع رقم 3','workflow',false,1970,true),
('tracking.stage.03.rollback','التراجع عن المرحلة 3','tracking','orders','stage_03_rollback','التراجع عن المرحلة 3','التراجع عن مرحلة التتبع رقم 3','workflow',true,1980,true),
('tracking.stage.03.sms','إرسال SMS للمرحلة 3','tracking','orders','stage_03_sms','إرسال SMS للمرحلة 3','إرسال رسالة المرحلة رقم 3','workflow',true,1990,true),
('tracking.stage.04.complete','تنفيذ المرحلة 4','tracking','orders','stage_04_complete','تنفيذ المرحلة 4','إكمال مرحلة التتبع رقم 4','workflow',false,2000,true),
('tracking.stage.04.rollback','التراجع عن المرحلة 4','tracking','orders','stage_04_rollback','التراجع عن المرحلة 4','التراجع عن مرحلة التتبع رقم 4','workflow',true,2010,true),
('tracking.stage.04.sms','إرسال SMS للمرحلة 4','tracking','orders','stage_04_sms','إرسال SMS للمرحلة 4','إرسال رسالة المرحلة رقم 4','workflow',true,2020,true),
('tracking.stage.05.complete','تنفيذ المرحلة 5','tracking','orders','stage_05_complete','تنفيذ المرحلة 5','إكمال مرحلة التتبع رقم 5','workflow',false,2030,true),
('tracking.stage.05.rollback','التراجع عن المرحلة 5','tracking','orders','stage_05_rollback','التراجع عن المرحلة 5','التراجع عن مرحلة التتبع رقم 5','workflow',true,2040,true),
('tracking.stage.05.sms','إرسال SMS للمرحلة 5','tracking','orders','stage_05_sms','إرسال SMS للمرحلة 5','إرسال رسالة المرحلة رقم 5','workflow',true,2050,true),
('tracking.stage.06.complete','تنفيذ المرحلة 6','tracking','orders','stage_06_complete','تنفيذ المرحلة 6','إكمال مرحلة التتبع رقم 6','workflow',false,2060,true),
('tracking.stage.06.rollback','التراجع عن المرحلة 6','tracking','orders','stage_06_rollback','التراجع عن المرحلة 6','التراجع عن مرحلة التتبع رقم 6','workflow',true,2070,true),
('tracking.stage.06.sms','إرسال SMS للمرحلة 6','tracking','orders','stage_06_sms','إرسال SMS للمرحلة 6','إرسال رسالة المرحلة رقم 6','workflow',true,2080,true),
('tracking.stage.07.complete','تنفيذ المرحلة 7','tracking','orders','stage_07_complete','تنفيذ المرحلة 7','إكمال مرحلة التتبع رقم 7','workflow',false,2090,true),
('tracking.stage.07.rollback','التراجع عن المرحلة 7','tracking','orders','stage_07_rollback','التراجع عن المرحلة 7','التراجع عن مرحلة التتبع رقم 7','workflow',true,2100,true),
('tracking.stage.07.sms','إرسال SMS للمرحلة 7','tracking','orders','stage_07_sms','إرسال SMS للمرحلة 7','إرسال رسالة المرحلة رقم 7','workflow',true,2110,true),
('tracking.stage.08.complete','تنفيذ المرحلة 8','tracking','orders','stage_08_complete','تنفيذ المرحلة 8','إكمال مرحلة التتبع رقم 8','workflow',false,2120,true),
('tracking.stage.08.rollback','التراجع عن المرحلة 8','tracking','orders','stage_08_rollback','التراجع عن المرحلة 8','التراجع عن مرحلة التتبع رقم 8','workflow',true,2130,true),
('tracking.stage.08.sms','إرسال SMS للمرحلة 8','tracking','orders','stage_08_sms','إرسال SMS للمرحلة 8','إرسال رسالة المرحلة رقم 8','workflow',true,2140,true),
('tracking.stage.09.complete','تنفيذ المرحلة 9','tracking','orders','stage_09_complete','تنفيذ المرحلة 9','إكمال مرحلة التتبع رقم 9','workflow',false,2150,true),
('tracking.stage.09.rollback','التراجع عن المرحلة 9','tracking','orders','stage_09_rollback','التراجع عن المرحلة 9','التراجع عن مرحلة التتبع رقم 9','workflow',true,2160,true),
('tracking.stage.09.sms','إرسال SMS للمرحلة 9','tracking','orders','stage_09_sms','إرسال SMS للمرحلة 9','إرسال رسالة المرحلة رقم 9','workflow',true,2170,true),
('tracking.stage.10.complete','تنفيذ المرحلة 10','tracking','orders','stage_10_complete','تنفيذ المرحلة 10','إكمال مرحلة التتبع رقم 10','workflow',false,2180,true),
('tracking.stage.10.rollback','التراجع عن المرحلة 10','tracking','orders','stage_10_rollback','التراجع عن المرحلة 10','التراجع عن مرحلة التتبع رقم 10','workflow',true,2190,true),
('tracking.stage.10.sms','إرسال SMS للمرحلة 10','tracking','orders','stage_10_sms','إرسال SMS للمرحلة 10','إرسال رسالة المرحلة رقم 10','workflow',true,2200,true)
on conflict(code) do update set name=excluded.name,system_code=excluded.system_code,page_code=excluded.page_code,action_code=excluded.action_code,name_ar=excluded.name_ar,description_ar=excluded.description_ar,category=excluded.category,is_sensitive=excluded.is_sensitive,sort_order=excluded.sort_order,is_active=true;

update core.permissions
set is_active=false
where code in ('marketing.manage','tracking.orders.delete','crm.settings.manage','crm.settings.view','marketing.settings.manage','marketing.settings.view','operations.settings.manage','operations.settings.view','tracking.settings.manage','tracking.settings.view');

update core.system_pages
set is_active=false,updated_at=now()
where code='settings' and system_code in ('crm','marketing','operations','tracking');

insert into core.roles(code,name,description_ar,is_system,is_active) values
('admin','مدير النظام','صلاحية كاملة للمنصة',true),
('system_admin','مدير النظام','قالب توافق لمدير النظام',true),
('sales_manager','مدير المبيعات','إدارة المبيعات داخل النطاق',true),
('accounts_manager','مدير الحسابات','صلاحيات الحسابات والموافقات',true),
('operations_manager','مدير العمليات','إدارة نظام العمليات',true),
('operations_admin','إداري العمليات','إجراءات العمليات المحددة',true),
('branch_manager','مدير فرع','إدارة بيانات الفرع المحدد',true),
('sales_user','مندوب مبيعات','العملاء المسندون للمندوب',true),
('call_center_agent','مندوب كول سنتر','عملاء الكول سنتر المسندون',true),
('customer_service_agent','مندوب خدمة عملاء','طلبات خدمة العملاء المسندة',true),
('marketing_admin','مدير التسويق','إدارة نظام التسويق',true),
('marketing_user','تنفيذي التسويق','التاسكات المسندة للمستخدم',true),
('finance_manager','مدير المالية','الموافقات المالية',true),
('operations_user','مستخدم العمليات','إجراءات العمليات داخل النطاق',true),
('tracking_user','مستخدم التتبع','مراحل التتبع المسموحة',true)
on conflict(code) do update set name=excluded.name,description_ar=excluded.description_ar,is_system=excluded.is_system,is_active=true,updated_at=now();

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('crm.automation.manage','crm.contacts.purge','crm.contacts.view','crm.conversation.classify','crm.conversation.download','crm.conversation.link','crm.conversation.mark_read','crm.conversation.mark_unread','crm.conversation.send_media','crm.conversation.send_template','crm.conversation.send_text','crm.conversation.view','crm.conversation.view_all','crm.conversation.view_assigned','crm.customer.bulk_transfer','crm.customer.call_center.change','crm.customer.create','crm.customer.delete','crm.customer.export','crm.customer.history.view','crm.customer.note.add','crm.customer.owner.change','crm.customer.ownership.view','crm.customer.restore','crm.customer.status.update','crm.customer.transfer','crm.customer.update','crm.customer.view','crm.dashboard.view','crm.database.view','crm.finance_history.view','crm.inbox.view','crm.inbox_agent.view','crm.kpi.rate_all','crm.kpi.rate_branch','crm.kpi.rating.create','crm.kpi.rating.delete','crm.kpi.rating.update','crm.kpi.view','crm.manual_lead.delete','crm.manual_lead.duplicate.approve','crm.manual_lead.redistribute','crm.manual_lead.reject','crm.manual_lead.request','crm.manual_lead.view_all','crm.manual_lead.view_own','crm.manual_leads.view','crm.reports.agents','crm.reports.customer_details','crm.reports.departments','crm.reports.export','crm.reports.view','crm.routing.manage','settings.crm.manage','settings.crm.view','marketing.agenda.create','marketing.agenda.delete','marketing.agenda.edit','marketing.assignment_action.admin','marketing.assignment_action.execute','marketing.assignment_actions.approve','marketing.attendance.manage','marketing.attendance.view','marketing.calendar.view','marketing.campaign.archive','marketing.campaign.create','marketing.campaign.delete','marketing.campaign.edit','marketing.connections.manage','marketing.create_agenda.view','marketing.create_campaign.view','marketing.dashboard.view','marketing.database.view','marketing.file.delete','marketing.file.download','marketing.file.upload','marketing.file.view_others','marketing.monitoring.view','marketing.packages.view','marketing.photo_request.complete','marketing.photo_request.create','marketing.platforms.view','marketing.publish.now','marketing.publish_prep.manage','marketing.publish_prep.view','marketing.receipt_calendar.view','settings.marketing.manage','settings.marketing.view','marketing.stock.view','marketing.structure.approve','marketing.structure.reject','marketing.task.final_file.upload','marketing.task.receive','marketing.task.reopen','marketing.task.view_all','marketing.task.view_assigned','marketing.task_template.approve','marketing.task_template.download','marketing.task_template.reject','marketing.task_template.reupload','marketing.task_template.upload','marketing.task_template.view_feedback','operations.all.view','operations.approval.administrative','operations.approval.financial','operations.approvals.view','operations.archive.view','operations.inventory.view','operations.manage.view','operations.movement.create','operations.movement.delivered','operations.movement.export','operations.movement.view','operations.movements.view','operations.request.finish_order','operations.request.receive_car','operations.request.receive_order','operations.request.rollback','operations.request.send_car','operations.request.skip','settings.operations.manage','settings.operations.view','operations.transfer.attachment.manage','operations.transfer.cancel','operations.transfer.create','operations.transfer.delete','operations.transfer.edit','operations.transfer.export','operations.transfer.note.add','operations.transfer.print','operations.transfer.reopen','operations.transfer.send','operations.transfers.view','operations.vehicle.archive','operations.vehicle.checklist.update','operations.vehicle.create','operations.vehicle.delete','operations.vehicle.edit','operations.vehicle.export','operations.vehicle.import','operations.vehicle.location.update','operations.vehicle.notes.update','operations.vehicle.restore','operations.vehicle.status.update','operations.vehicle.template.download','operations.vehicle.view','platform.activity.view','platform.dashboard.view','platform.database.view','platform.reports.view','platform.superadmin','settings.audit.view','settings.branches.manage','settings.departments.manage','settings.permissions.manage','settings.roles.manage','settings.security.view','settings.tracking.manage','settings.tracking.view','settings.users.create','settings.users.disable','settings.users.update','settings.users.view','settings.view','system.crm.access','system.marketing.access','system.operations.access','system.tracking.access','tracking.archive.view','tracking.delete.view','tracking.link.copy','tracking.link.create','tracking.order.archive','tracking.order.delete','tracking.order.deleted.restore','tracking.order.open','tracking.order.restore','tracking.order.search','tracking.orders.view','tracking.sms.send','tracking.stage.01.complete','tracking.stage.01.rollback','tracking.stage.01.sms','tracking.stage.02.complete','tracking.stage.02.rollback','tracking.stage.02.sms','tracking.stage.03.complete','tracking.stage.03.rollback','tracking.stage.03.sms','tracking.stage.04.complete','tracking.stage.04.rollback','tracking.stage.04.sms','tracking.stage.05.complete','tracking.stage.05.rollback','tracking.stage.05.sms','tracking.stage.06.complete','tracking.stage.06.rollback','tracking.stage.06.sms','tracking.stage.07.complete','tracking.stage.07.rollback','tracking.stage.07.sms','tracking.stage.08.complete','tracking.stage.08.rollback','tracking.stage.08.sms','tracking.stage.09.complete','tracking.stage.09.rollback','tracking.stage.09.sms','tracking.stage.10.complete','tracking.stage.10.rollback','tracking.stage.10.sms','tracking.stage.skip','tracking.vehicle.select') where r.code='admin'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('crm.automation.manage','crm.contacts.purge','crm.contacts.view','crm.conversation.classify','crm.conversation.download','crm.conversation.link','crm.conversation.mark_read','crm.conversation.mark_unread','crm.conversation.send_media','crm.conversation.send_template','crm.conversation.send_text','crm.conversation.view','crm.conversation.view_all','crm.conversation.view_assigned','crm.customer.bulk_transfer','crm.customer.call_center.change','crm.customer.create','crm.customer.delete','crm.customer.export','crm.customer.history.view','crm.customer.note.add','crm.customer.owner.change','crm.customer.ownership.view','crm.customer.restore','crm.customer.status.update','crm.customer.transfer','crm.customer.update','crm.customer.view','crm.dashboard.view','crm.database.view','crm.finance_history.view','crm.inbox.view','crm.inbox_agent.view','crm.kpi.rate_all','crm.kpi.rate_branch','crm.kpi.rating.create','crm.kpi.rating.delete','crm.kpi.rating.update','crm.kpi.view','crm.manual_lead.delete','crm.manual_lead.duplicate.approve','crm.manual_lead.redistribute','crm.manual_lead.reject','crm.manual_lead.request','crm.manual_lead.view_all','crm.manual_lead.view_own','crm.manual_leads.view','crm.reports.agents','crm.reports.customer_details','crm.reports.departments','crm.reports.export','crm.reports.view','crm.routing.manage','settings.crm.manage','settings.crm.view','marketing.agenda.create','marketing.agenda.delete','marketing.agenda.edit','marketing.assignment_action.admin','marketing.assignment_action.execute','marketing.assignment_actions.approve','marketing.attendance.manage','marketing.attendance.view','marketing.calendar.view','marketing.campaign.archive','marketing.campaign.create','marketing.campaign.delete','marketing.campaign.edit','marketing.connections.manage','marketing.create_agenda.view','marketing.create_campaign.view','marketing.dashboard.view','marketing.database.view','marketing.file.delete','marketing.file.download','marketing.file.upload','marketing.file.view_others','marketing.monitoring.view','marketing.packages.view','marketing.photo_request.complete','marketing.photo_request.create','marketing.platforms.view','marketing.publish.now','marketing.publish_prep.manage','marketing.publish_prep.view','marketing.receipt_calendar.view','settings.marketing.manage','settings.marketing.view','marketing.stock.view','marketing.structure.approve','marketing.structure.reject','marketing.task.final_file.upload','marketing.task.receive','marketing.task.reopen','marketing.task.view_all','marketing.task.view_assigned','marketing.task_template.approve','marketing.task_template.download','marketing.task_template.reject','marketing.task_template.reupload','marketing.task_template.upload','marketing.task_template.view_feedback','operations.all.view','operations.approval.administrative','operations.approval.financial','operations.approvals.view','operations.archive.view','operations.inventory.view','operations.manage.view','operations.movement.create','operations.movement.delivered','operations.movement.export','operations.movement.view','operations.movements.view','operations.request.finish_order','operations.request.receive_car','operations.request.receive_order','operations.request.rollback','operations.request.send_car','operations.request.skip','settings.operations.manage','settings.operations.view','operations.transfer.attachment.manage','operations.transfer.cancel','operations.transfer.create','operations.transfer.delete','operations.transfer.edit','operations.transfer.export','operations.transfer.note.add','operations.transfer.print','operations.transfer.reopen','operations.transfer.send','operations.transfers.view','operations.vehicle.archive','operations.vehicle.checklist.update','operations.vehicle.create','operations.vehicle.delete','operations.vehicle.edit','operations.vehicle.export','operations.vehicle.import','operations.vehicle.location.update','operations.vehicle.notes.update','operations.vehicle.restore','operations.vehicle.status.update','operations.vehicle.template.download','operations.vehicle.view','platform.activity.view','platform.dashboard.view','platform.database.view','platform.reports.view','platform.superadmin','settings.audit.view','settings.branches.manage','settings.departments.manage','settings.permissions.manage','settings.roles.manage','settings.security.view','settings.tracking.manage','settings.tracking.view','settings.users.create','settings.users.disable','settings.users.update','settings.users.view','settings.view','system.crm.access','system.marketing.access','system.operations.access','system.tracking.access','tracking.archive.view','tracking.delete.view','tracking.link.copy','tracking.link.create','tracking.order.archive','tracking.order.delete','tracking.order.deleted.restore','tracking.order.open','tracking.order.restore','tracking.order.search','tracking.orders.view','tracking.sms.send','tracking.stage.01.complete','tracking.stage.01.rollback','tracking.stage.01.sms','tracking.stage.02.complete','tracking.stage.02.rollback','tracking.stage.02.sms','tracking.stage.03.complete','tracking.stage.03.rollback','tracking.stage.03.sms','tracking.stage.04.complete','tracking.stage.04.rollback','tracking.stage.04.sms','tracking.stage.05.complete','tracking.stage.05.rollback','tracking.stage.05.sms','tracking.stage.06.complete','tracking.stage.06.rollback','tracking.stage.06.sms','tracking.stage.07.complete','tracking.stage.07.rollback','tracking.stage.07.sms','tracking.stage.08.complete','tracking.stage.08.rollback','tracking.stage.08.sms','tracking.stage.09.complete','tracking.stage.09.rollback','tracking.stage.09.sms','tracking.stage.10.complete','tracking.stage.10.rollback','tracking.stage.10.sms','tracking.stage.skip','tracking.vehicle.select') where r.code='system_admin'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('crm.contacts.view','crm.conversation.classify','crm.conversation.download','crm.conversation.link','crm.conversation.mark_read','crm.conversation.mark_unread','crm.conversation.send_media','crm.conversation.send_template','crm.conversation.send_text','crm.conversation.view','crm.conversation.view_all','crm.conversation.view_assigned','crm.customer.bulk_transfer','crm.customer.call_center.change','crm.customer.create','crm.customer.delete','crm.customer.export','crm.customer.history.view','crm.customer.note.add','crm.customer.owner.change','crm.customer.ownership.view','crm.customer.restore','crm.customer.status.update','crm.customer.transfer','crm.customer.update','crm.customer.view','crm.dashboard.view','crm.database.view','crm.finance_history.view','crm.inbox.view','crm.inbox_agent.view','crm.kpi.rate_all','crm.kpi.rate_branch','crm.kpi.rating.create','crm.kpi.rating.delete','crm.kpi.rating.update','crm.kpi.view','crm.manual_lead.delete','crm.manual_lead.duplicate.approve','crm.manual_lead.redistribute','crm.manual_lead.reject','crm.manual_lead.request','crm.manual_lead.view_all','crm.manual_lead.view_own','crm.manual_leads.view','crm.reports.agents','crm.reports.customer_details','crm.reports.departments','crm.reports.export','crm.reports.view','settings.crm.view','system.crm.access') where r.code='sales_manager'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('crm.contacts.view','crm.conversation.classify','crm.conversation.download','crm.conversation.link','crm.conversation.mark_read','crm.conversation.mark_unread','crm.conversation.send_media','crm.conversation.send_template','crm.conversation.send_text','crm.conversation.view','crm.conversation.view_all','crm.conversation.view_assigned','crm.customer.call_center.change','crm.customer.create','crm.customer.delete','crm.customer.export','crm.customer.history.view','crm.customer.note.add','crm.customer.owner.change','crm.customer.ownership.view','crm.customer.restore','crm.customer.status.update','crm.customer.transfer','crm.customer.update','crm.customer.view','crm.dashboard.view','crm.database.view','crm.finance_history.view','crm.inbox.view','crm.inbox_agent.view','crm.kpi.rate_branch','crm.kpi.rating.create','crm.kpi.rating.delete','crm.kpi.rating.update','crm.kpi.view','crm.manual_lead.delete','crm.manual_lead.duplicate.approve','crm.manual_lead.redistribute','crm.manual_lead.reject','crm.manual_lead.request','crm.manual_lead.view_all','crm.manual_lead.view_own','crm.manual_leads.view','crm.reports.agents','crm.reports.customer_details','crm.reports.departments','crm.reports.export','crm.reports.view','settings.crm.view','system.crm.access') where r.code='branch_manager'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('crm.contacts.view','crm.conversation.download','crm.conversation.mark_read','crm.conversation.mark_unread','crm.conversation.send_media','crm.conversation.send_template','crm.conversation.send_text','crm.conversation.view','crm.conversation.view_assigned','crm.customer.create','crm.customer.history.view','crm.customer.note.add','crm.customer.status.update','crm.customer.update','crm.customer.view','crm.dashboard.view','crm.database.view','crm.finance_history.view','crm.inbox_agent.view','crm.manual_lead.request','crm.manual_lead.view_own','crm.manual_leads.view','system.crm.access') where r.code='sales_user'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('crm.contacts.view','crm.conversation.classify','crm.conversation.download','crm.conversation.mark_read','crm.conversation.mark_unread','crm.conversation.send_media','crm.conversation.send_template','crm.conversation.send_text','crm.conversation.view','crm.conversation.view_assigned','crm.customer.note.add','crm.customer.status.update','crm.customer.update','crm.customer.view','crm.dashboard.view','crm.database.view','crm.inbox.view','crm.inbox_agent.view','system.crm.access') where r.code='call_center_agent'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('crm.contacts.view','crm.conversation.send_template','crm.conversation.send_text','crm.conversation.view','crm.conversation.view_assigned','crm.customer.note.add','crm.customer.status.update','crm.customer.update','crm.customer.view','crm.dashboard.view','crm.database.view','crm.inbox_agent.view','system.crm.access') where r.code='customer_service_agent'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('marketing.agenda.create','marketing.agenda.delete','marketing.agenda.edit','marketing.assignment_action.admin','marketing.assignment_action.execute','marketing.assignment_actions.approve','marketing.attendance.manage','marketing.attendance.view','marketing.calendar.view','marketing.campaign.archive','marketing.campaign.create','marketing.campaign.delete','marketing.campaign.edit','marketing.connections.manage','marketing.create_agenda.view','marketing.create_campaign.view','marketing.dashboard.view','marketing.database.view','marketing.file.delete','marketing.file.download','marketing.file.upload','marketing.file.view_others','marketing.monitoring.view','marketing.packages.view','marketing.photo_request.complete','marketing.photo_request.create','marketing.platforms.view','marketing.publish.now','marketing.publish_prep.manage','marketing.publish_prep.view','marketing.receipt_calendar.view','settings.marketing.manage','settings.marketing.view','marketing.stock.view','marketing.structure.approve','marketing.structure.reject','marketing.task.final_file.upload','marketing.task.receive','marketing.task.reopen','marketing.task.view_all','marketing.task.view_assigned','marketing.task_template.approve','marketing.task_template.download','marketing.task_template.reject','marketing.task_template.reupload','marketing.task_template.upload','marketing.task_template.view_feedback','system.marketing.access') where r.code='marketing_admin'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('marketing.assignment_action.execute','marketing.attendance.view','marketing.calendar.view','marketing.dashboard.view','marketing.database.view','marketing.file.download','marketing.file.upload','marketing.photo_request.complete','marketing.receipt_calendar.view','marketing.stock.view','marketing.task.final_file.upload','marketing.task.receive','marketing.task.view_assigned','marketing.task_template.download','marketing.task_template.reupload','marketing.task_template.upload','marketing.task_template.view_feedback','system.marketing.access') where r.code='marketing_user'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('operations.all.view','operations.approval.administrative','operations.approval.financial','operations.approvals.view','operations.archive.view','operations.inventory.view','operations.manage.view','operations.movement.create','operations.movement.delivered','operations.movement.export','operations.movement.view','operations.movements.view','operations.request.finish_order','operations.request.receive_car','operations.request.receive_order','operations.request.rollback','operations.request.send_car','operations.request.skip','settings.operations.manage','settings.operations.view','operations.transfer.attachment.manage','operations.transfer.cancel','operations.transfer.create','operations.transfer.delete','operations.transfer.edit','operations.transfer.export','operations.transfer.note.add','operations.transfer.print','operations.transfer.reopen','operations.transfer.send','operations.transfers.view','operations.vehicle.archive','operations.vehicle.checklist.update','operations.vehicle.create','operations.vehicle.delete','operations.vehicle.edit','operations.vehicle.export','operations.vehicle.import','operations.vehicle.location.update','operations.vehicle.notes.update','operations.vehicle.restore','operations.vehicle.status.update','operations.vehicle.template.download','operations.vehicle.view','system.operations.access') where r.code='operations_manager'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('operations.inventory.view','operations.manage.view','operations.movement.create','operations.movement.export','operations.movement.view','operations.movements.view','operations.request.finish_order','operations.request.receive_car','operations.request.receive_order','operations.request.send_car','operations.transfer.attachment.manage','operations.transfer.create','operations.transfer.edit','operations.transfer.export','operations.transfer.note.add','operations.transfer.print','operations.transfer.send','operations.transfers.view','operations.vehicle.checklist.update','operations.vehicle.create','operations.vehicle.edit','operations.vehicle.export','operations.vehicle.import','operations.vehicle.location.update','operations.vehicle.notes.update','operations.vehicle.status.update','operations.vehicle.template.download','operations.vehicle.view','system.operations.access') where r.code='operations_admin'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('operations.inventory.view','operations.manage.view','operations.movement.create','operations.movement.export','operations.movement.view','operations.movements.view','operations.request.finish_order','operations.request.receive_car','operations.request.receive_order','operations.request.send_car','operations.transfer.attachment.manage','operations.transfer.create','operations.transfer.edit','operations.transfer.export','operations.transfer.note.add','operations.transfer.print','operations.transfer.send','operations.transfers.view','operations.vehicle.checklist.update','operations.vehicle.create','operations.vehicle.edit','operations.vehicle.export','operations.vehicle.import','operations.vehicle.location.update','operations.vehicle.notes.update','operations.vehicle.status.update','operations.vehicle.template.download','operations.vehicle.view','system.operations.access') where r.code='operations_user'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('operations.approval.financial','operations.approvals.view','operations.inventory.view','operations.vehicle.view','system.operations.access') where r.code='finance_manager'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('operations.approval.financial','operations.approvals.view','operations.inventory.view','operations.movement.export','operations.vehicle.view','system.operations.access','system.tracking.access','tracking.order.open','tracking.order.search','tracking.orders.view') where r.code='accounts_manager'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('system.tracking.access','tracking.link.copy','tracking.link.create','tracking.order.open','tracking.order.search','tracking.orders.view','tracking.stage.01.complete','tracking.stage.02.complete','tracking.stage.03.complete','tracking.stage.04.complete','tracking.stage.05.complete','tracking.stage.06.complete','tracking.stage.07.complete','tracking.stage.08.complete','tracking.stage.09.complete','tracking.stage.10.complete','tracking.vehicle.select') where r.code='tracking_user'
on conflict do nothing;


insert into core.user_systems(user_id,system_code,is_enabled,role_id,data_scope)
select u.id,s.code,true,
  case when s.code='crm' then (select r.id from core.roles r join core.user_roles ur on ur.role_id=r.id where ur.user_id=u.id and r.code in ('sales_manager','branch_manager','sales_user','call_center_agent','customer_service_agent') order by case r.code when 'sales_manager' then 1 when 'branch_manager' then 2 else 3 end limit 1)
       when s.code='marketing' then (select r.id from core.roles r join core.user_roles ur on ur.role_id=r.id where ur.user_id=u.id and r.code in ('marketing_admin','marketing_user') order by case r.code when 'marketing_admin' then 1 else 2 end limit 1)
       when s.code='operations' then (select r.id from core.roles r join core.user_roles ur on ur.role_id=r.id where ur.user_id=u.id and r.code in ('operations_manager','operations_admin','operations_user','finance_manager','accounts_manager') order by case r.code when 'operations_manager' then 1 when 'operations_admin' then 2 else 3 end limit 1)
       when s.code='tracking' then (select r.id from core.roles r join core.user_roles ur on ur.role_id=r.id where ur.user_id=u.id and r.code='tracking_user' limit 1)
  end,
  case
    when exists(select 1 from core.user_roles ur join core.roles r on r.id=ur.role_id where ur.user_id=u.id and r.code in ('admin','system_admin')) then 'all'
    when s.code='marketing' then 'workflow_assigned'
    when s.code='tracking' then 'branch_and_department'
    when exists(select 1 from core.user_roles ur join core.roles r on r.id=ur.role_id where ur.user_id=u.id and r.code in ('sales_user','call_center_agent','customer_service_agent')) then 'assigned'
    else 'branch_and_department'
  end
from core.users u cross join core.systems s
where s.code in ('crm','marketing','operations','tracking')
  and (
    exists(select 1 from core.user_roles ur join core.roles r on r.id=ur.role_id where ur.user_id=u.id and r.code in ('admin','system_admin'))
    or exists(select 1 from core.user_departments ud join core.departments d on d.id=ud.department_id where ud.user_id=u.id and d.system_code=s.code)
    or exists(select 1 from core.user_roles ur join core.roles r on r.id=ur.role_id where ur.user_id=u.id and (
      (s.code='crm' and r.code in ('sales_manager','branch_manager','sales_user','call_center_agent','customer_service_agent'))
      or (s.code='marketing' and r.code in ('marketing_admin','marketing_user'))
      or (s.code='operations' and r.code in ('operations_manager','operations_admin','operations_user','finance_manager','accounts_manager'))
      or (s.code='tracking' and r.code='tracking_user')
    ))
  )
on conflict(user_id,system_code) do nothing;

insert into core.user_system_branches(user_id,system_code,branch_id,is_primary)
select us.user_id,us.system_code,ub.branch_id,ub.is_primary
from core.user_systems us join core.user_branches ub on ub.user_id=us.user_id
on conflict do nothing;

insert into core.user_system_departments(user_id,system_code,department_id,is_primary)
select us.user_id,us.system_code,ud.department_id,ud.is_primary
from core.user_systems us join core.user_departments ud on ud.user_id=us.user_id
join core.departments d on d.id=ud.department_id and d.system_code=us.system_code
on conflict do nothing;


insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('crm.data_review.view','crm.data_review.execute')
where r.code in ('admin','system_admin')
on conflict do nothing;


create table if not exists core.access_control_schema_state (
  id smallint primary key default 1 check(id=1),
  version integer not null,
  updated_at timestamptz not null default now()
);
insert into core.access_control_schema_state(id,version,updated_at)
values(1,1192,now())
on conflict(id) do update set version=greatest(core.access_control_schema_state.version,excluded.version),updated_at=now();

`;


const ACCESS_CONTROL_SCHEMA_VERSION = 1192;
let accessControlSchemaPromise: Promise<void> | null = null;

async function accessControlSchemaReady() {
  const sql = getSql();
  const [shape] = await sql<{ ready: boolean }[]>`
    select
      exists(select 1 from information_schema.tables where table_schema='core' and table_name='access_control_schema_state')
      and exists(select 1 from information_schema.tables where table_schema='core' and table_name='user_systems')
      and exists(select 1 from information_schema.tables where table_schema='core' and table_name='user_permission_overrides')
      and exists(select 1 from information_schema.columns where table_schema='core' and table_name='users' and column_name='permission_version')
      and exists(select 1 from information_schema.columns where table_schema='core' and table_name='sessions' and column_name='permission_version')
      and exists(select 1 from information_schema.columns where table_schema='audit' and table_name='activity_log' and column_name='permission_code')
      as ready
  `;
  if (!shape?.ready) return false;
  const [state] = await sql<{ version: number }[]>`
    select version::int from core.access_control_schema_state where id=1
  `;
  return Number(state?.version || 0) >= ACCESS_CONTROL_SCHEMA_VERSION;
}

/**
 * Ensures the centralized access-control schema exists before authentication uses it.
 * The readiness check is cheap; the full idempotent migration runs only when required.
 * An advisory lock prevents concurrent serverless instances from applying DDL together.
 */
export function ensureAccessControlSchema() {
  if (!accessControlSchemaPromise) {
    accessControlSchemaPromise = (async () => {
      if (await accessControlSchemaReady()) return;
      await withDatabaseAdvisoryLock(
        `mzj:access-control-schema:${ACCESS_CONTROL_SCHEMA_VERSION}`,
        async () => {
          if (await accessControlSchemaReady()) return;
          await runSqlScript(ACCESS_CONTROL_SQL);
          if (!(await accessControlSchemaReady())) {
            throw new Error("ACCESS_CONTROL_SCHEMA_NOT_READY");
          }
        },
      );
    })().catch((error) => {
      accessControlSchemaPromise = null;
      throw error;
    });
  }
  return accessControlSchemaPromise;
}
