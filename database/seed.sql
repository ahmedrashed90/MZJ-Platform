insert into core.branches(code, name, sort_order) values
('hall', 'فرع الصالة', 10),
('qadisiyah', 'فرع القادسية', 20),
('multaqa', 'فرع الملتقى', 30),
('online', 'فرع الاونلاين', 40),
('customer_service', 'خدمة العملاء', 50),
('call_center_branch', 'الكول سنتر', 60)
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order, is_active = true;

insert into core.departments(code, name, system_code) values
('cash_sales', 'مبيعات الكاش', 'crm'),
('finance_sales', 'مبيعات التمويل', 'crm'),
('customer_service', 'خدمة العملاء', 'crm'),
('call_center', 'كول سنتر', 'crm'),
('marketing', 'التسويق', 'marketing'),
('operations', 'العمليات', 'operations'),
('tracking', 'التتبع', 'tracking')
on conflict (code) do update set name = excluded.name, system_code = excluded.system_code, is_active = true;

insert into core.roles(code, name, is_system) values
('admin', 'مدير النظام', true),
('sales_manager', 'مدير المبيعات', true),
('branch_manager', 'مدير فرع', true),
('call_center_agent', 'مندوب كول سنتر', true),
('sales_user', 'مندوب مبيعات', true),
('marketing_user', 'مستخدم التسويق', true),
('operations_user', 'مستخدم العمليات', true),
('tracking_user', 'مستخدم التتبع', true)
on conflict (code) do update set name = excluded.name;
insert into core.permissions(code,name,system_code) values
('operations.view','دخول نظام العمليات','operations'),
('operations.vehicles.view','عرض السيارات والمخزون','operations'),
('operations.vehicles.create','إضافة سيارة','operations'),
('operations.vehicles.update','تعديل سيارة','operations'),
('operations.vehicles.import','استيراد السيارات','operations'),
('operations.vehicles.export','تصدير السيارات','operations'),
('operations.vehicles.archive','أرشفة السيارات','operations'),
('operations.movements.view','عرض حركة السيارات','operations'),
('operations.movements.create','تنفيذ حركة سيارات','operations'),
('operations.requests.view','عرض طلبات النقل والتصوير','operations'),
('operations.requests.create','إنشاء طلب نقل أو تصوير','operations'),
('operations.requests.receive','استلام طلب العمليات','operations'),
('operations.requests.dispatch','إرسال السيارة','operations'),
('operations.requests.confirm_receipt','تأكيد استلام السيارة','operations'),
('operations.requests.complete','إنهاء الطلب','operations'),
('operations.requests.delete_before_receipt','حذف الطلب قبل استلام السيارة','operations'),
('operations.approvals.financial','الاعتماد المالي للسيارات','operations'),
('operations.approvals.administrative','الاعتماد الإداري للسيارات','operations'),
('operations.reports.all_cars','عرض تقرير جميع السيارات','operations'),
('operations.logs.view','عرض سجل الحركات','operations'),
('operations.logs.export','تصدير سجل الحركات','operations'),
('operations.settings.manage','إدارة إعدادات العمليات','operations')
on conflict (code) do update set name=excluded.name, system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='admin' and p.system_code='operations'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='operations_user' and p.system_code='operations' and p.code<>'operations.settings.manage'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='sales_manager' and p.code in (
  'operations.view','operations.vehicles.view','operations.vehicles.export',
  'operations.movements.view','operations.requests.view',
  'operations.approvals.financial','operations.approvals.administrative',
  'operations.reports.all_cars','operations.logs.view','operations.logs.export'
)
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='branch_manager' and p.code in (
  'operations.view','operations.vehicles.view','operations.movements.view',
  'operations.requests.view','operations.reports.all_cars','operations.logs.view'
)
on conflict do nothing;

