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
