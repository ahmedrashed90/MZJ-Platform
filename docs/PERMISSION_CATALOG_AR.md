# كتالوج مفاتيح الصلاحيات

إجمالي المفاتيح: **215**.

## التوزيع

- المنصة المركزية: 24 صلاحية.
- العمليات: 43 صلاحية.
- التراكينج: 45 صلاحية.
- التسويق: 46 صلاحية.
- CRM: 56 صلاحية.

## القائمة الكاملة

| المفتاح | النظام | الصفحة | النوع | حساس | الاسم |
|---|---|---|---|---:|---|
| `platform.superadmin` | المنصة المركزية | `settings` | أمني | نعم | صلاحية مدير النظام العليا |
| `platform.dashboard.view` | المنصة المركزية | `dashboard` | صفحة | لا | مشاهدة الداش بورد الموحد |
| `platform.reports.view` | المنصة المركزية | `reports` | صفحة | لا | مشاهدة التقارير الموحدة |
| `platform.database.view` | المنصة المركزية | `database` | صفحة | لا | مشاهدة قاعدة البيانات الموحدة |
| `platform.activity.view` | المنصة المركزية | `activity` | صفحة | نعم | مشاهدة سجل النشاط |
| `settings.view` | المنصة المركزية | `settings` | إعدادات | لا | فتح الإعدادات |
| `settings.users.view` | المنصة المركزية | `settings` | إعدادات | نعم | مشاهدة المستخدمين |
| `settings.users.create` | المنصة المركزية | `settings` | إعدادات | نعم | إنشاء مستخدم |
| `settings.users.update` | المنصة المركزية | `settings` | إعدادات | نعم | تعديل مستخدم |
| `settings.users.disable` | المنصة المركزية | `settings` | إعدادات | نعم | تعطيل وتفعيل مستخدم |
| `settings.roles.manage` | المنصة المركزية | `settings` | إعدادات | نعم | إدارة الأدوار وقوالب الصلاحيات |
| `settings.permissions.manage` | المنصة المركزية | `settings` | إعدادات | نعم | إدارة الصلاحيات الفردية |
| `settings.branches.manage` | المنصة المركزية | `settings` | إعدادات | نعم | إدارة الفروع |
| `settings.departments.manage` | المنصة المركزية | `settings` | إعدادات | نعم | إدارة الأقسام |
| `settings.audit.view` | المنصة المركزية | `settings` | أمني | نعم | مشاهدة سجل تعديلات الصلاحيات |
| `settings.security.view` | المنصة المركزية | `settings` | أمني | نعم | مشاهدة سجل النشاط الأمني |
| `settings.crm.view` | المنصة المركزية | `settings` | إعدادات | لا | مشاهدة إعدادات CRM |
| `settings.crm.manage` | المنصة المركزية | `settings` | إعدادات | نعم | تعديل إعدادات CRM |
| `settings.marketing.view` | المنصة المركزية | `settings` | إعدادات | لا | مشاهدة إعدادات التسويق |
| `settings.marketing.manage` | المنصة المركزية | `settings` | إعدادات | نعم | تعديل إعدادات التسويق |
| `settings.operations.view` | المنصة المركزية | `settings` | إعدادات | لا | مشاهدة إعدادات العمليات |
| `settings.operations.manage` | المنصة المركزية | `settings` | إعدادات | نعم | تعديل إعدادات العمليات |
| `settings.tracking.view` | المنصة المركزية | `settings` | إعدادات | لا | مشاهدة إعدادات التتبع |
| `settings.tracking.manage` | المنصة المركزية | `settings` | إعدادات | نعم | تعديل إعدادات التتبع |
| `system.crm.access` | CRM | `dashboard` | دخول النظام | لا | دخول نظام CRM |
| `crm.dashboard.view` | CRM | `dashboard` | صفحة | لا | مشاهدة داش بورد CRM |
| `crm.database.view` | CRM | `database` | صفحة | لا | مشاهدة قاعدة بيانات CRM |
| `crm.manual_leads.view` | CRM | `manual_leads` | صفحة | لا | فتح إضافة العملاء |
| `crm.finance_history.view` | CRM | `finance_history` | صفحة | لا | مشاهدة سجل عملاء التمويل |
| `crm.inbox.view` | CRM | `inbox` | صفحة | لا | مشاهدة الرسائل غير المصنفة |
| `crm.contacts.view` | CRM | `contacts` | صفحة | لا | مشاهدة جهات الاتصال |
| `crm.inbox_agent.view` | CRM | `inbox_agent` | صفحة | لا | فتح وكيل صندوق الوارد |
| `crm.reports.view` | CRM | `reports` | صفحة | لا | مشاهدة تقارير CRM |
| `crm.kpi.view` | CRM | `kpi` | صفحة | لا | مشاهدة KPI |
| `crm.customer.view` | CRM | `database` | إجراء | لا | فتح بيانات العميل |
| `crm.customer.create` | CRM | `manual_leads` | إجراء | لا | إنشاء عميل |
| `crm.customer.update` | CRM | `database` | إجراء | لا | تعديل بيانات العميل |
| `crm.customer.status.update` | CRM | `database` | إجراء | لا | تعديل حالة العميل |
| `crm.customer.note.add` | CRM | `database` | إجراء | لا | إضافة ملاحظة للعميل |
| `crm.customer.owner.change` | CRM | `database` | إجراء | نعم | تغيير مسؤول العميل |
| `crm.customer.call_center.change` | CRM | `database` | إجراء | نعم | تغيير مندوب الكول سنتر |
| `crm.customer.transfer` | CRM | `database` | إجراء | نعم | نقل عميل |
| `crm.customer.bulk_transfer` | CRM | `database` | إجراء | نعم | نقل مجموعة عملاء |
| `crm.customer.delete` | CRM | `database` | إجراء | نعم | حذف عميل |
| `crm.customer.restore` | CRM | `database` | إجراء | لا | استعادة عميل |
| `crm.customer.export` | CRM | `database` | إجراء | نعم | تصدير العملاء |
| `crm.customer.history.view` | CRM | `finance_history` | إجراء | لا | مشاهدة سجل العميل |
| `crm.customer.ownership.view` | CRM | `finance_history` | إجراء | لا | مشاهدة سجل ملكية العملاء |
| `crm.manual_lead.request` | CRM | `manual_leads` | إجراء | لا | إنشاء طلب إضافة عميل |
| `crm.manual_lead.view_own` | CRM | `manual_leads` | إجراء | لا | مشاهدة طلبات الإضافة الخاصة |
| `crm.manual_lead.view_all` | CRM | `manual_leads` | إجراء | لا | مشاهدة كل طلبات الإضافة |
| `crm.manual_lead.duplicate.approve` | CRM | `manual_leads` | إجراء | نعم | اعتماد العميل المكرر |
| `crm.manual_lead.reject` | CRM | `manual_leads` | إجراء | نعم | رفض طلب إضافة العميل |
| `crm.manual_lead.delete` | CRM | `manual_leads` | إجراء | نعم | حذف طلب إضافة العميل |
| `crm.manual_lead.redistribute` | CRM | `manual_leads` | إجراء | نعم | إعادة توزيع العملاء |
| `crm.conversation.view` | CRM | `inbox_agent` | إجراء | لا | مشاهدة المحادثة |
| `crm.conversation.send_text` | CRM | `inbox_agent` | إجراء | نعم | إرسال رسالة نصية |
| `crm.conversation.send_template` | CRM | `inbox_agent` | إجراء | نعم | إرسال قالب |
| `crm.conversation.send_media` | CRM | `inbox_agent` | إجراء | نعم | إرسال مرفق |
| `crm.conversation.download` | CRM | `inbox_agent` | إجراء | لا | تحميل مرفق |
| `crm.conversation.mark_read` | CRM | `inbox_agent` | إجراء | لا | تعليم المحادثة كمقروءة |
| `crm.conversation.mark_unread` | CRM | `inbox_agent` | إجراء | لا | تعليم المحادثة كغير مقروءة |
| `crm.conversation.classify` | CRM | `inbox` | إجراء | نعم | تصنيف المحادثة |
| `crm.conversation.link` | CRM | `inbox` | إجراء | نعم | ربط محادثة بعميل |
| `crm.conversation.view_all` | CRM | `inbox_agent` | إجراء | لا | مشاهدة كل المحادثات |
| `crm.conversation.view_assigned` | CRM | `inbox_agent` | إجراء | لا | مشاهدة المحادثات المسندة |
| `crm.reports.departments` | CRM | `reports` | إجراء | لا | مشاهدة تقارير الأقسام |
| `crm.reports.agents` | CRM | `reports` | إجراء | لا | مشاهدة تقارير المناديب |
| `crm.reports.customer_details` | CRM | `reports` | إجراء | لا | فتح تفاصيل عملاء التقارير |
| `crm.reports.export` | CRM | `reports` | إجراء | نعم | تصدير تقارير CRM |
| `crm.data_review.view` | CRM | `reports` | إجراء | لا | مشاهدة مراجعة أخطاء البيانات |
| `crm.data_review.execute` | CRM | `reports` | إجراء | نعم | تنفيذ تصحيح أخطاء البيانات |
| `crm.kpi.rating.create` | CRM | `kpi` | إجراء | لا | إضافة تقييم |
| `crm.kpi.rating.update` | CRM | `kpi` | إجراء | لا | تعديل تقييم |
| `crm.kpi.rating.delete` | CRM | `kpi` | إجراء | نعم | حذف تقييم |
| `crm.kpi.rate_branch` | CRM | `kpi` | إجراء | لا | تقييم مندوبي الفرع |
| `crm.kpi.rate_all` | CRM | `kpi` | إجراء | نعم | تقييم جميع المناديب |
| `crm.routing.manage` | CRM | `settings` | إعدادات | نعم | إدارة قواعد التوزيع |
| `crm.automation.manage` | CRM | `settings` | إعدادات | نعم | إدارة الأتمتة |
| `crm.contacts.purge` | CRM | `contacts` | إجراء | نعم | حذف ملف جهة اتصال بالكامل |
| `system.operations.access` | العمليات | `inventory` | دخول النظام | لا | دخول نظام العمليات |
| `operations.inventory.view` | العمليات | `inventory` | صفحة | لا | مشاهدة مخزون السيارات |
| `operations.manage.view` | العمليات | `manage` | صفحة | لا | فتح إدارة السيارات |
| `operations.movement.view` | العمليات | `movement` | صفحة | لا | فتح صفحة الحركة |
| `operations.transfers.view` | العمليات | `transfers` | صفحة | لا | مشاهدة طلبات العمليات |
| `operations.approvals.view` | العمليات | `approvals` | صفحة | لا | مشاهدة الموافقات |
| `operations.all.view` | العمليات | `all` | صفحة | لا | مشاهدة جميع السيارات |
| `operations.movements.view` | العمليات | `movements` | صفحة | لا | مشاهدة سجل الحركات |
| `operations.archive.view` | العمليات | `archive` | صفحة | لا | مشاهدة أرشيف السيارات |
| `operations.vehicle.view` | العمليات | `inventory` | إجراء | لا | فتح بيانات السيارة |
| `operations.vehicle.create` | العمليات | `manage` | إجراء | لا | إضافة سيارة |
| `operations.vehicle.edit` | العمليات | `manage` | إجراء | لا | تعديل سيارة |
| `operations.vehicle.vin.update` | العمليات | `manage` | إجراء | نعم | تعديل رقم الهيكل VIN |
| `operations.vehicle.delete` | العمليات | `manage` | إجراء | نعم | حذف سيارة |
| `operations.vehicle.archive` | العمليات | `archive` | إجراء | لا | أرشفة سيارة |
| `operations.vehicle.restore` | العمليات | `archive` | إجراء | لا | استعادة سيارة |
| `operations.vehicle.import` | العمليات | `manage` | إجراء | نعم | استيراد السيارات |
| `operations.vehicle.export` | العمليات | `inventory` | إجراء | نعم | تصدير السيارات |
| `operations.vehicle.template.download` | العمليات | `manage` | إجراء | لا | تحميل قالب السيارات |
| `operations.vehicle.location.update` | العمليات | `manage` | إجراء | لا | تعديل موقع السيارة |
| `operations.vehicle.status.update` | العمليات | `manage` | إجراء | لا | تعديل حالة السيارة |
| `operations.vehicle.notes.update` | العمليات | `manage` | إجراء | لا | تعديل ملاحظات السيارة |
| `operations.vehicle.checklist.update` | العمليات | `manage` | إجراء | لا | تعديل Checklist السيارة |
| `operations.movement.create` | العمليات | `movement` | إجراء | نعم | تنفيذ حركة سيارات |
| `operations.movement.delivered` | العمليات | `movement` | مرحلة سير عمل | نعم | تنفيذ حركة مباع تم التسليم |
| `operations.movement.export` | العمليات | `movements` | إجراء | نعم | تصدير سجل الحركات |
| `operations.transfer.create` | العمليات | `transfers` | إجراء | نعم | إنشاء طلب عمليات |
| `operations.transfer.edit` | العمليات | `transfers` | إجراء | لا | تعديل مسودة الطلب |
| `operations.transfer.send` | العمليات | `transfers` | مرحلة سير عمل | نعم | إرسال طلب العمليات |
| `operations.transfer.note.add` | العمليات | `transfers` | إجراء | لا | إضافة ملاحظة للطلب |
| `operations.transfer.attachment.manage` | العمليات | `transfers` | إجراء | لا | إدارة مرفقات الطلب |
| `operations.transfer.print` | العمليات | `transfers` | إجراء | لا | طباعة الطلب |
| `operations.transfer.export` | العمليات | `transfers` | إجراء | لا | تصدير الطلب |
| `operations.transfer.delete` | العمليات | `transfers` | إجراء | نعم | حذف طلب العمليات |
| `operations.transfer.cancel` | العمليات | `transfers` | مرحلة سير عمل | نعم | إلغاء طلب العمليات |
| `operations.transfer.reopen` | العمليات | `transfers` | مرحلة سير عمل | نعم | إعادة فتح طلب العمليات |
| `operations.request.receive_order` | العمليات | `transfers` | مرحلة سير عمل | لا | مرحلة تم استلام الطلب |
| `operations.request.send_car` | العمليات | `transfers` | مرحلة سير عمل | لا | مرحلة تم إرسال السيارة |
| `operations.request.receive_car` | العمليات | `transfers` | مرحلة سير عمل | لا | مرحلة تم استلام السيارة |
| `operations.request.finish_order` | العمليات | `transfers` | مرحلة سير عمل | لا | مرحلة تم الانتهاء |
| `operations.request.rollback` | العمليات | `transfers` | مرحلة سير عمل | نعم | التراجع عن مرحلة طلب |
| `operations.request.skip` | العمليات | `transfers` | مرحلة سير عمل | نعم | تخطي مرحلة طلب |
| `operations.approval.financial` | العمليات | `approvals` | مرحلة سير عمل | نعم | الموافقة المالية |
| `operations.approval.administrative` | العمليات | `approvals` | مرحلة سير عمل | نعم | الموافقة الإدارية |
| `system.tracking.access` | التراكينج | `orders` | دخول النظام | لا | دخول نظام التراكينج |
| `tracking.orders.view` | التراكينج | `orders` | صفحة | لا | مشاهدة طلبات التراكينج |
| `tracking.archive.view` | التراكينج | `archive` | صفحة | لا | مشاهدة أرشيف التراكينج |
| `tracking.delete.view` | التراكينج | `delete` | صفحة | نعم | فتح صفحة حذف التراكينج |
| `tracking.order.open` | التراكينج | `orders` | إجراء | لا | فتح طلب التتبع |
| `tracking.order.search` | التراكينج | `orders` | إجراء | لا | البحث في طلبات التتبع |
| `tracking.vehicle.select` | التراكينج | `orders` | إجراء | لا | اختيار رقم الهيكل |
| `tracking.link.create` | التراكينج | `orders` | إجراء | نعم | إنشاء رابط التتبع |
| `tracking.link.copy` | التراكينج | `orders` | إجراء | لا | نسخ رابط التتبع |
| `tracking.order.archive` | التراكينج | `orders` | إجراء | لا | أرشفة طلب التتبع |
| `tracking.order.restore` | التراكينج | `archive` | إجراء | لا | استعادة طلب التتبع |
| `tracking.order.delete` | التراكينج | `delete` | إجراء | نعم | حذف طلب التتبع |
| `tracking.order.deleted.restore` | التراكينج | `delete` | إجراء | نعم | حذف سجل طلب محذوف |
| `tracking.sms.send` | التراكينج | `orders` | إجراء | نعم | إرسال SMS |
| `tracking.stage.01.complete` | التراكينج | `orders` | مرحلة سير عمل | لا | تنفيذ المرحلة 1 |
| `tracking.stage.01.rollback` | التراكينج | `orders` | مرحلة سير عمل | نعم | التراجع عن المرحلة 1 |
| `tracking.stage.01.sms` | التراكينج | `orders` | مرحلة سير عمل | نعم | إرسال SMS للمرحلة 1 |
| `tracking.stage.02.complete` | التراكينج | `orders` | مرحلة سير عمل | لا | تنفيذ المرحلة 2 |
| `tracking.stage.02.rollback` | التراكينج | `orders` | مرحلة سير عمل | نعم | التراجع عن المرحلة 2 |
| `tracking.stage.02.sms` | التراكينج | `orders` | مرحلة سير عمل | نعم | إرسال SMS للمرحلة 2 |
| `tracking.stage.03.complete` | التراكينج | `orders` | مرحلة سير عمل | لا | تنفيذ المرحلة 3 |
| `tracking.stage.03.rollback` | التراكينج | `orders` | مرحلة سير عمل | نعم | التراجع عن المرحلة 3 |
| `tracking.stage.03.sms` | التراكينج | `orders` | مرحلة سير عمل | نعم | إرسال SMS للمرحلة 3 |
| `tracking.stage.04.complete` | التراكينج | `orders` | مرحلة سير عمل | لا | تنفيذ المرحلة 4 |
| `tracking.stage.04.rollback` | التراكينج | `orders` | مرحلة سير عمل | نعم | التراجع عن المرحلة 4 |
| `tracking.stage.04.sms` | التراكينج | `orders` | مرحلة سير عمل | نعم | إرسال SMS للمرحلة 4 |
| `tracking.stage.05.complete` | التراكينج | `orders` | مرحلة سير عمل | لا | تنفيذ المرحلة 5 |
| `tracking.stage.05.rollback` | التراكينج | `orders` | مرحلة سير عمل | نعم | التراجع عن المرحلة 5 |
| `tracking.stage.05.sms` | التراكينج | `orders` | مرحلة سير عمل | نعم | إرسال SMS للمرحلة 5 |
| `tracking.stage.06.complete` | التراكينج | `orders` | مرحلة سير عمل | لا | تنفيذ المرحلة 6 |
| `tracking.stage.06.rollback` | التراكينج | `orders` | مرحلة سير عمل | نعم | التراجع عن المرحلة 6 |
| `tracking.stage.06.sms` | التراكينج | `orders` | مرحلة سير عمل | نعم | إرسال SMS للمرحلة 6 |
| `tracking.stage.07.complete` | التراكينج | `orders` | مرحلة سير عمل | لا | تنفيذ المرحلة 7 |
| `tracking.stage.07.rollback` | التراكينج | `orders` | مرحلة سير عمل | نعم | التراجع عن المرحلة 7 |
| `tracking.stage.07.sms` | التراكينج | `orders` | مرحلة سير عمل | نعم | إرسال SMS للمرحلة 7 |
| `tracking.stage.08.complete` | التراكينج | `orders` | مرحلة سير عمل | لا | تنفيذ المرحلة 8 |
| `tracking.stage.08.rollback` | التراكينج | `orders` | مرحلة سير عمل | نعم | التراجع عن المرحلة 8 |
| `tracking.stage.08.sms` | التراكينج | `orders` | مرحلة سير عمل | نعم | إرسال SMS للمرحلة 8 |
| `tracking.stage.09.complete` | التراكينج | `orders` | مرحلة سير عمل | لا | تنفيذ المرحلة 9 |
| `tracking.stage.09.rollback` | التراكينج | `orders` | مرحلة سير عمل | نعم | التراجع عن المرحلة 9 |
| `tracking.stage.09.sms` | التراكينج | `orders` | مرحلة سير عمل | نعم | إرسال SMS للمرحلة 9 |
| `tracking.stage.10.complete` | التراكينج | `orders` | مرحلة سير عمل | لا | تنفيذ المرحلة 10 |
| `tracking.stage.10.rollback` | التراكينج | `orders` | مرحلة سير عمل | نعم | التراجع عن المرحلة 10 |
| `tracking.stage.10.sms` | التراكينج | `orders` | مرحلة سير عمل | نعم | إرسال SMS للمرحلة 10 |
| `tracking.stage.skip` | التراكينج | `orders` | مرحلة سير عمل | نعم | تخطي مراحل التتبع |
| `system.marketing.access` | التسويق | `dashboard` | دخول النظام | لا | دخول نظام التسويق |
| `marketing.dashboard.view` | التسويق | `dashboard` | صفحة | لا | مشاهدة داش بورد التسويق |
| `marketing.create_campaign.view` | التسويق | `create_campaign` | صفحة | لا | فتح إنشاء حملة |
| `marketing.create_agenda.view` | التسويق | `create_agenda` | صفحة | لا | فتح إنشاء أجندة |
| `marketing.database.view` | التسويق | `database` | صفحة | لا | مشاهدة قاعدة بيانات التسويق |
| `marketing.packages.view` | التسويق | `packages` | صفحة | لا | مشاهدة إدارة الباقات |
| `marketing.platforms.view` | التسويق | `platforms` | صفحة | لا | مشاهدة ربط المنصات |
| `marketing.publish_prep.view` | التسويق | `publish_prep` | صفحة | لا | مشاهدة تجهيز النشر |
| `marketing.monitoring.view` | التسويق | `monitoring` | صفحة | لا | مشاهدة المتابعة |
| `marketing.calendar.view` | التسويق | `calendar` | صفحة | لا | مشاهدة تقويم التسويق |
| `marketing.receipt_calendar.view` | التسويق | `receipt_calendar` | صفحة | لا | مشاهدة تقويم الاستلام |
| `marketing.stock.view` | التسويق | `stock` | صفحة | لا | مشاهدة استوك التسويق |
| `marketing.attendance.view` | التسويق | `attendance` | صفحة | لا | مشاهدة الحضور والانصراف |
| `marketing.campaign.create` | التسويق | `create_campaign` | إجراء | نعم | إنشاء حملة |
| `marketing.campaign.edit` | التسويق | `database` | إجراء | نعم | تعديل حملة |
| `marketing.campaign.delete` | التسويق | `database` | إجراء | نعم | حذف حملة |
| `marketing.campaign.archive` | التسويق | `database` | إجراء | لا | أرشفة حملة |
| `marketing.agenda.create` | التسويق | `create_agenda` | إجراء | نعم | إنشاء أجندة |
| `marketing.agenda.edit` | التسويق | `database` | إجراء | نعم | تعديل أجندة |
| `marketing.agenda.delete` | التسويق | `database` | إجراء | نعم | حذف أجندة |
| `marketing.structure.approve` | التسويق | `database` | مرحلة سير عمل | نعم | اعتماد الهيكل |
| `marketing.structure.reject` | التسويق | `database` | مرحلة سير عمل | نعم | رفض أو طلب تعديل الهيكل |
| `marketing.task.view_assigned` | التسويق | `dashboard` | إجراء | لا | مشاهدة التاسكات المسندة |
| `marketing.task.view_all` | التسويق | `dashboard` | إجراء | نعم | مشاهدة كل التاسكات |
| `marketing.task.receive` | التسويق | `dashboard` | مرحلة سير عمل | لا | استلام التاسك |
| `marketing.task_template.download` | التسويق | `dashboard` | إجراء | لا | تحميل قالب Task Template |
| `marketing.task_template.upload` | التسويق | `dashboard` | مرحلة سير عمل | لا | رفع Task Template |
| `marketing.task_template.reupload` | التسويق | `dashboard` | مرحلة سير عمل | لا | إعادة رفع Task Template |
| `marketing.task_template.view_feedback` | التسويق | `dashboard` | إجراء | لا | مشاهدة ملاحظات Task Template |
| `marketing.task_template.approve` | التسويق | `dashboard` | مرحلة سير عمل | نعم | اعتماد Task Template |
| `marketing.task_template.reject` | التسويق | `dashboard` | مرحلة سير عمل | نعم | رفض أو طلب تعديل Task Template |
| `marketing.assignment_action.execute` | التسويق | `dashboard` | مرحلة سير عمل | لا | تنفيذ إجراء تكليف |
| `marketing.assignment_action.admin` | التسويق | `dashboard` | مرحلة سير عمل | نعم | تنفيذ إجراء أدمن |
| `marketing.assignment_actions.approve` | التسويق | `dashboard` | مرحلة سير عمل | نعم | اعتماد إجراءات التكليف |
| `marketing.task.final_file.upload` | التسويق | `dashboard` | إجراء | لا | رفع الملف النهائي |
| `marketing.task.reopen` | التسويق | `dashboard` | مرحلة سير عمل | نعم | إعادة فتح التاسك |
| `marketing.file.upload` | التسويق | `database` | إجراء | لا | رفع ملف |
| `marketing.file.download` | التسويق | `database` | إجراء | لا | تحميل ملف |
| `marketing.file.delete` | التسويق | `database` | إجراء | نعم | حذف ملف |
| `marketing.file.view_others` | التسويق | `database` | إجراء | نعم | مشاهدة ملفات مستخدم آخر |
| `marketing.publish_prep.manage` | التسويق | `publish_prep` | إجراء | نعم | تعديل تجهيز النشر |
| `marketing.publish.now` | التسويق | `publish_prep` | إجراء | نعم | النشر الآن |
| `marketing.photo_request.create` | التسويق | `stock` | إجراء | نعم | إنشاء طلب تصوير |
| `marketing.photo_request.complete` | التسويق | `stock` | مرحلة سير عمل | لا | إنهاء طلب تصوير |
| `marketing.attendance.manage` | التسويق | `attendance` | إجراء | نعم | إدارة الحضور والانصراف |
| `marketing.connections.manage` | التسويق | `platforms` | إعدادات | نعم | إدارة ربط المنصات |
