# صفحات وإجراءات الأنظمة

إجمالي الصفحات المسجلة: **37**.

## المنصة المركزية

### الداش بورد الموحد — `/`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `platform.dashboard.view` | صفحة | مشاهدة الداش بورد الموحد |

### التقارير الموحدة — `/reports`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `platform.reports.view` | صفحة | مشاهدة التقارير الموحدة |

### قاعدة البيانات الموحدة — `/database`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `platform.database.view` | صفحة | مشاهدة قاعدة البيانات الموحدة |

### الإعدادات — `/settings`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `platform.superadmin` | أمني | صلاحية مدير النظام العليا |
| `settings.view` | إعدادات | فتح الإعدادات |
| `settings.users.view` | إعدادات | مشاهدة المستخدمين |
| `settings.users.create` | إعدادات | إنشاء مستخدم |
| `settings.users.update` | إعدادات | تعديل مستخدم |
| `settings.users.disable` | إعدادات | تعطيل وتفعيل مستخدم |
| `settings.roles.manage` | إعدادات | إدارة الأدوار وقوالب الصلاحيات |
| `settings.permissions.manage` | إعدادات | إدارة الصلاحيات الفردية |
| `settings.branches.manage` | إعدادات | إدارة الفروع |
| `settings.departments.manage` | إعدادات | إدارة الأقسام |
| `settings.audit.view` | أمني | مشاهدة سجل تعديلات الصلاحيات |
| `settings.security.view` | أمني | مشاهدة سجل النشاط الأمني |
| `settings.crm.view` | إعدادات | مشاهدة إعدادات CRM |
| `settings.crm.manage` | إعدادات | تعديل إعدادات CRM |
| `settings.marketing.view` | إعدادات | مشاهدة إعدادات التسويق |
| `settings.marketing.manage` | إعدادات | تعديل إعدادات التسويق |
| `settings.operations.view` | إعدادات | مشاهدة إعدادات العمليات |
| `settings.operations.manage` | إعدادات | تعديل إعدادات العمليات |
| `settings.tracking.view` | إعدادات | مشاهدة إعدادات التتبع |
| `settings.tracking.manage` | إعدادات | تعديل إعدادات التتبع |

### سجل النشاط — `/activity`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `platform.activity.view` | صفحة | مشاهدة سجل النشاط |

## العمليات

### مخزون السيارات — `/operations`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `system.operations.access` | دخول النظام | دخول نظام العمليات |
| `operations.inventory.view` | صفحة | مشاهدة مخزون السيارات |
| `operations.vehicle.view` | إجراء | فتح بيانات السيارة |
| `operations.vehicle.export` | إجراء | تصدير السيارات |

### إدارة السيارات — `/operations/manage`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `operations.manage.view` | صفحة | فتح إدارة السيارات |
| `operations.vehicle.create` | إجراء | إضافة سيارة |
| `operations.vehicle.edit` | إجراء | تعديل سيارة |
| `operations.vehicle.vin.update` | إجراء حساس | تعديل رقم الهيكل VIN |
| `operations.vehicle.delete` | إجراء | حذف سيارة |
| `operations.vehicle.import` | إجراء | استيراد السيارات |
| `operations.vehicle.template.download` | إجراء | تحميل قالب السيارات |
| `operations.vehicle.location.update` | إجراء | تعديل موقع السيارة |
| `operations.vehicle.status.update` | إجراء | تعديل حالة السيارة |
| `operations.vehicle.notes.update` | إجراء | تعديل ملاحظات السيارة |
| `operations.vehicle.checklist.update` | إجراء | تعديل Checklist السيارة |

### الحركة — `/operations/movement`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `operations.movement.view` | صفحة | فتح صفحة الحركة |
| `operations.movement.create` | إجراء | تنفيذ حركة سيارات |
| `operations.movement.delivered` | مرحلة سير عمل | تنفيذ حركة مباع تم التسليم |

### الطلبات — `/operations/transfers`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `operations.transfers.view` | صفحة | مشاهدة طلبات العمليات |
| `operations.transfer.create` | إجراء | إنشاء طلب عمليات |
| `operations.transfer.edit` | إجراء | تعديل مسودة الطلب |
| `operations.transfer.send` | مرحلة سير عمل | إرسال طلب العمليات |
| `operations.transfer.note.add` | إجراء | إضافة ملاحظة للطلب |
| `operations.transfer.attachment.manage` | إجراء | إدارة مرفقات الطلب |
| `operations.transfer.print` | إجراء | طباعة الطلب |
| `operations.transfer.export` | إجراء | تصدير الطلب |
| `operations.transfer.delete` | إجراء | حذف طلب العمليات |
| `operations.transfer.cancel` | مرحلة سير عمل | إلغاء طلب العمليات |
| `operations.transfer.reopen` | مرحلة سير عمل | إعادة فتح طلب العمليات |
| `operations.request.receive_order` | مرحلة سير عمل | مرحلة تم استلام الطلب |
| `operations.request.send_car` | مرحلة سير عمل | مرحلة تم إرسال السيارة |
| `operations.request.receive_car` | مرحلة سير عمل | مرحلة تم استلام السيارة |
| `operations.request.finish_order` | مرحلة سير عمل | مرحلة تم الانتهاء |
| `operations.request.rollback` | مرحلة سير عمل | التراجع عن مرحلة طلب |
| `operations.request.skip` | مرحلة سير عمل | تخطي مرحلة طلب |

### الموافقات — `/operations/approvals`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `operations.approvals.view` | صفحة | مشاهدة الموافقات |
| `operations.approval.financial` | مرحلة سير عمل | الموافقة المالية |
| `operations.approval.administrative` | مرحلة سير عمل | الموافقة الإدارية |

### جميع السيارات — `/operations/all`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `operations.all.view` | صفحة | مشاهدة جميع السيارات |

### سجل الحركات — `/operations/movements`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `operations.movements.view` | صفحة | مشاهدة سجل الحركات |
| `operations.movement.export` | إجراء | تصدير سجل الحركات |

### الأرشيف — `/operations/archive`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `operations.archive.view` | صفحة | مشاهدة أرشيف السيارات |
| `operations.vehicle.archive` | إجراء | أرشفة سيارة |
| `operations.vehicle.restore` | إجراء | استعادة سيارة |

## التراكينج

### طلبات التراكينج — `/tracking`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `system.tracking.access` | دخول النظام | دخول نظام التراكينج |
| `tracking.orders.view` | صفحة | مشاهدة طلبات التراكينج |
| `tracking.order.open` | إجراء | فتح طلب التتبع |
| `tracking.order.search` | إجراء | البحث في طلبات التتبع |
| `tracking.vehicle.select` | إجراء | اختيار رقم الهيكل |
| `tracking.link.create` | إجراء | إنشاء رابط التتبع |
| `tracking.link.copy` | إجراء | نسخ رابط التتبع |
| `tracking.order.archive` | إجراء | أرشفة طلب التتبع |
| `tracking.sms.send` | إجراء | إرسال SMS |
| `tracking.stage.01.complete` | مرحلة سير عمل | تنفيذ المرحلة 1 |
| `tracking.stage.01.rollback` | مرحلة سير عمل | التراجع عن المرحلة 1 |
| `tracking.stage.01.sms` | مرحلة سير عمل | إرسال SMS للمرحلة 1 |
| `tracking.stage.02.complete` | مرحلة سير عمل | تنفيذ المرحلة 2 |
| `tracking.stage.02.rollback` | مرحلة سير عمل | التراجع عن المرحلة 2 |
| `tracking.stage.02.sms` | مرحلة سير عمل | إرسال SMS للمرحلة 2 |
| `tracking.stage.03.complete` | مرحلة سير عمل | تنفيذ المرحلة 3 |
| `tracking.stage.03.rollback` | مرحلة سير عمل | التراجع عن المرحلة 3 |
| `tracking.stage.03.sms` | مرحلة سير عمل | إرسال SMS للمرحلة 3 |
| `tracking.stage.04.complete` | مرحلة سير عمل | تنفيذ المرحلة 4 |
| `tracking.stage.04.rollback` | مرحلة سير عمل | التراجع عن المرحلة 4 |
| `tracking.stage.04.sms` | مرحلة سير عمل | إرسال SMS للمرحلة 4 |
| `tracking.stage.05.complete` | مرحلة سير عمل | تنفيذ المرحلة 5 |
| `tracking.stage.05.rollback` | مرحلة سير عمل | التراجع عن المرحلة 5 |
| `tracking.stage.05.sms` | مرحلة سير عمل | إرسال SMS للمرحلة 5 |
| `tracking.stage.06.complete` | مرحلة سير عمل | تنفيذ المرحلة 6 |
| `tracking.stage.06.rollback` | مرحلة سير عمل | التراجع عن المرحلة 6 |
| `tracking.stage.06.sms` | مرحلة سير عمل | إرسال SMS للمرحلة 6 |
| `tracking.stage.07.complete` | مرحلة سير عمل | تنفيذ المرحلة 7 |
| `tracking.stage.07.rollback` | مرحلة سير عمل | التراجع عن المرحلة 7 |
| `tracking.stage.07.sms` | مرحلة سير عمل | إرسال SMS للمرحلة 7 |
| `tracking.stage.08.complete` | مرحلة سير عمل | تنفيذ المرحلة 8 |
| `tracking.stage.08.rollback` | مرحلة سير عمل | التراجع عن المرحلة 8 |
| `tracking.stage.08.sms` | مرحلة سير عمل | إرسال SMS للمرحلة 8 |
| `tracking.stage.09.complete` | مرحلة سير عمل | تنفيذ المرحلة 9 |
| `tracking.stage.09.rollback` | مرحلة سير عمل | التراجع عن المرحلة 9 |
| `tracking.stage.09.sms` | مرحلة سير عمل | إرسال SMS للمرحلة 9 |
| `tracking.stage.10.complete` | مرحلة سير عمل | تنفيذ المرحلة 10 |
| `tracking.stage.10.rollback` | مرحلة سير عمل | التراجع عن المرحلة 10 |
| `tracking.stage.10.sms` | مرحلة سير عمل | إرسال SMS للمرحلة 10 |
| `tracking.stage.skip` | مرحلة سير عمل | تخطي مراحل التتبع |

### أرشيف الطلبات — `/tracking/archive`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `tracking.archive.view` | صفحة | مشاهدة أرشيف التراكينج |
| `tracking.order.restore` | إجراء | استعادة طلب التتبع |

### حذف طلبات التراكينج — `/tracking/delete`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `tracking.delete.view` | صفحة | فتح صفحة حذف التراكينج |
| `tracking.order.delete` | إجراء | حذف طلب التتبع |
| `tracking.order.deleted.restore` | إجراء | حذف سجل طلب محذوف |

## التسويق

### الداش بورد — `/marketing`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `system.marketing.access` | دخول النظام | دخول نظام التسويق |
| `marketing.dashboard.view` | صفحة | مشاهدة داش بورد التسويق |
| `marketing.task.view_assigned` | إجراء | مشاهدة التاسكات المسندة |
| `marketing.task.view_all` | إجراء | مشاهدة كل التاسكات |
| `marketing.task.receive` | مرحلة سير عمل | استلام التاسك |
| `marketing.task_template.download` | إجراء | تحميل قالب Task Template |
| `marketing.task_template.upload` | مرحلة سير عمل | رفع Task Template |
| `marketing.task_template.reupload` | مرحلة سير عمل | إعادة رفع Task Template |
| `marketing.task_template.view_feedback` | إجراء | مشاهدة ملاحظات Task Template |
| `marketing.task_template.approve` | مرحلة سير عمل | اعتماد Task Template |
| `marketing.task_template.reject` | مرحلة سير عمل | رفض أو طلب تعديل Task Template |
| `marketing.assignment_action.execute` | مرحلة سير عمل | تنفيذ إجراء تكليف |
| `marketing.assignment_action.admin` | مرحلة سير عمل | تنفيذ إجراء أدمن |
| `marketing.assignment_actions.approve` | مرحلة سير عمل | اعتماد إجراءات التكليف |
| `marketing.task.final_file.upload` | إجراء | رفع الملف النهائي |
| `marketing.task.reopen` | مرحلة سير عمل | إعادة فتح التاسك |

### إنشاء حملة — `/marketing/create-campaign`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `marketing.create_campaign.view` | صفحة | فتح إنشاء حملة |
| `marketing.campaign.create` | إجراء | إنشاء حملة |

### إنشاء أجندة — `/marketing/create-agenda`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `marketing.create_agenda.view` | صفحة | فتح إنشاء أجندة |
| `marketing.agenda.create` | إجراء | إنشاء أجندة |

### قاعدة البيانات — `/marketing/database`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `marketing.database.view` | صفحة | مشاهدة قاعدة بيانات التسويق |
| `marketing.campaign.edit` | إجراء | تعديل حملة |
| `marketing.campaign.delete` | إجراء | حذف حملة |
| `marketing.campaign.archive` | إجراء | أرشفة حملة |
| `marketing.agenda.edit` | إجراء | تعديل أجندة |
| `marketing.agenda.delete` | إجراء | حذف أجندة |
| `marketing.structure.approve` | مرحلة سير عمل | اعتماد الهيكل |
| `marketing.structure.reject` | مرحلة سير عمل | رفض أو طلب تعديل الهيكل |
| `marketing.file.upload` | إجراء | رفع ملف |
| `marketing.file.download` | إجراء | تحميل ملف |
| `marketing.file.delete` | إجراء | حذف ملف |
| `marketing.file.view_others` | إجراء | مشاهدة ملفات مستخدم آخر |

### إدارة الباقات — `/marketing/packages`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `marketing.packages.view` | صفحة | مشاهدة إدارة الباقات |

### ربط المنصات — `/marketing/platforms`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `marketing.platforms.view` | صفحة | مشاهدة ربط المنصات |
| `marketing.connections.manage` | إعدادات | إدارة ربط المنصات |

### تجهيز النشر — `/marketing/publish-prep`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `marketing.publish_prep.view` | صفحة | مشاهدة تجهيز النشر |
| `marketing.publish_prep.manage` | إجراء | تعديل تجهيز النشر |
| `marketing.publish.now` | إجراء | النشر الآن |

### المتابعة — `/marketing/monitoring`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `marketing.monitoring.view` | صفحة | مشاهدة المتابعة |

### التقويم — `/marketing/calendar`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `marketing.calendar.view` | صفحة | مشاهدة تقويم التسويق |

### تقويم الاستلام — `/marketing/receipt-calendar`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `marketing.receipt_calendar.view` | صفحة | مشاهدة تقويم الاستلام |

### الاستوك — `/marketing/stock`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `marketing.stock.view` | صفحة | مشاهدة استوك التسويق |
| `marketing.photo_request.create` | إجراء | إنشاء طلب تصوير |
| `marketing.photo_request.complete` | مرحلة سير عمل | إنهاء طلب تصوير |

### الحضور والانصراف — `/marketing/attendance`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `marketing.attendance.view` | صفحة | مشاهدة الحضور والانصراف |
| `marketing.attendance.manage` | إجراء | إدارة الحضور والانصراف |

## CRM

### الداش بورد — `/crm`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `system.crm.access` | دخول النظام | دخول نظام CRM |
| `crm.dashboard.view` | صفحة | مشاهدة داش بورد CRM |

### قاعدة البيانات — `/crm/database`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `crm.database.view` | صفحة | مشاهدة قاعدة بيانات CRM |
| `crm.customer.view` | إجراء | فتح بيانات العميل |
| `crm.customer.update` | إجراء | تعديل بيانات العميل |
| `crm.customer.status.update` | إجراء | تعديل حالة العميل |
| `crm.customer.note.add` | إجراء | إضافة ملاحظة للعميل |
| `crm.customer.owner.change` | إجراء | تغيير مسؤول العميل |
| `crm.customer.call_center.change` | إجراء | تغيير مندوب الكول سنتر |
| `crm.customer.transfer` | إجراء | نقل عميل |
| `crm.customer.bulk_transfer` | إجراء | نقل مجموعة عملاء |
| `crm.customer.delete` | إجراء | حذف عميل |
| `crm.customer.restore` | إجراء | استعادة عميل |
| `crm.customer.export` | إجراء | تصدير العملاء |

### إضافة العملاء — `/crm/manual-leads`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `crm.manual_leads.view` | صفحة | فتح إضافة العملاء |
| `crm.customer.create` | إجراء | إنشاء عميل |
| `crm.manual_lead.request` | إجراء | إنشاء طلب إضافة عميل |
| `crm.manual_lead.view_own` | إجراء | مشاهدة طلبات الإضافة الخاصة |
| `crm.manual_lead.view_all` | إجراء | مشاهدة كل طلبات الإضافة |
| `crm.manual_lead.duplicate.approve` | إجراء | اعتماد العميل المكرر |
| `crm.manual_lead.reject` | إجراء | رفض طلب إضافة العميل |
| `crm.manual_lead.delete` | إجراء | حذف طلب إضافة العميل |
| `crm.manual_lead.redistribute` | إجراء | إعادة توزيع العملاء |

### سجل عملاء التمويل — `/crm/finance-history`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `crm.finance_history.view` | صفحة | مشاهدة سجل عملاء التمويل |
| `crm.customer.history.view` | إجراء | مشاهدة سجل العميل |
| `crm.customer.ownership.view` | إجراء | مشاهدة سجل ملكية العملاء |

### رسائل غير مصنفة — `/crm/inbox`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `crm.inbox.view` | صفحة | مشاهدة الرسائل غير المصنفة |
| `crm.conversation.classify` | إجراء | تصنيف المحادثة |
| `crm.conversation.link` | إجراء | ربط محادثة بعميل |

### جهات الاتصال — `/crm/contacts`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `crm.contacts.view` | صفحة | مشاهدة جهات الاتصال |
| `crm.contacts.purge` | إجراء | حذف ملف جهة اتصال بالكامل |

### وكيل صندوق الوارد — `/crm/inbox-agent`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `crm.inbox_agent.view` | صفحة | فتح وكيل صندوق الوارد |
| `crm.conversation.view` | إجراء | مشاهدة المحادثة |
| `crm.conversation.send_text` | إجراء | إرسال رسالة نصية |
| `crm.conversation.send_template` | إجراء | إرسال قالب |
| `crm.conversation.send_media` | إجراء | إرسال مرفق |
| `crm.conversation.download` | إجراء | تحميل مرفق |
| `crm.conversation.mark_read` | إجراء | تعليم المحادثة كمقروءة |
| `crm.conversation.mark_unread` | إجراء | تعليم المحادثة كغير مقروءة |
| `crm.conversation.view_all` | إجراء | مشاهدة كل المحادثات |
| `crm.conversation.view_assigned` | إجراء | مشاهدة المحادثات المسندة |

### التقارير — `/crm/reports`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `crm.reports.view` | صفحة | مشاهدة تقارير CRM |
| `crm.reports.departments` | إجراء | مشاهدة تقارير الأقسام |
| `crm.reports.agents` | إجراء | مشاهدة تقارير المناديب |
| `crm.reports.customer_details` | إجراء | فتح تفاصيل عملاء التقارير |
| `crm.reports.export` | إجراء | تصدير تقارير CRM |
| `crm.data_review.view` | إجراء | مشاهدة مراجعة أخطاء البيانات |
| `crm.data_review.execute` | إجراء | تنفيذ تصحيح أخطاء البيانات |

### تقييم المناديب KPI — `/crm/kpi`

| الصلاحية | النوع | الإجراء |
|---|---|---|
| `crm.kpi.view` | صفحة | مشاهدة KPI |
| `crm.kpi.rating.create` | إجراء | إضافة تقييم |
| `crm.kpi.rating.update` | إجراء | تعديل تقييم |
| `crm.kpi.rating.delete` | إجراء | حذف تقييم |
| `crm.kpi.rate_branch` | إجراء | تقييم مندوبي الفرع |
| `crm.kpi.rate_all` | إجراء | تقييم جميع المناديب |
