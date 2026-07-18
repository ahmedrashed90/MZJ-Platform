# دليل مفاتيح الصلاحيات المركزي

إجمالي المفاتيح: **119**.

## الإعدادات المركزية

| المفتاح | الصفحة | النوع | الوصف | حساس |
|---|---|---|---|---|
| `settings.access` | دخول النظام | settings | فتح صفحة الإعدادات | نعم |
| `settings.audit.view` | audit | settings | مشاهدة سجل تعديلات الصلاحيات | نعم |
| `settings.security.view` | audit | settings | مشاهدة سجل النشاط الأمني | نعم |
| `settings.branches.manage` | organization | settings | إدارة الفروع والأقسام | نعم |
| `settings.permissions.manage` | permissions | settings | إدارة الصلاحيات الفردية | نعم |
| `settings.roles.manage` | roles | settings | إدارة الأدوار وقوالب الصلاحيات | نعم |
| `settings.users.view` | users | settings | مشاهدة المستخدمين | نعم |
| `settings.users.create` | users | settings | إضافة مستخدم | نعم |
| `settings.users.update` | users | settings | تعديل مستخدم | نعم |
| `settings.users.disable` | users | settings | تعطيل وإعادة تفعيل مستخدم | نعم |

## العمليات

| المفتاح | الصفحة | النوع | الوصف | حساس |
|---|---|---|---|---|
| `system.operations.access` | دخول النظام | system | الدخول إلى نظام العمليات | لا |
| `operations.dashboard.view` | dashboard | page | مشاهدة داش بورد العمليات | لا |
| `operations.database.view` | database | page | مشاهدة السيارات والمخزون | لا |
| `operations.vehicle.create` | database | action | إضافة سيارة | نعم |
| `operations.vehicle.update` | database | action | تعديل سيارة | نعم |
| `operations.vehicle.delete` | database | action | حذف سيارة | نعم |
| `operations.vehicle.export` | database | action | تصدير السيارات | نعم |
| `operations.history.view` | history | page | مشاهدة سجل الحركات | لا |
| `operations.movement.view` | movement | page | مشاهدة حركة السيارات | لا |
| `operations.movement.execute` | movement | action | تنفيذ حركة سيارة | نعم |
| `operations.requests.view` | requests | page | مشاهدة طلبات العمليات | لا |
| `operations.request.create` | requests | action | إنشاء طلب عمليات | لا |
| `operations.request.send` | requests | action | إرسال طلب عمليات | لا |
| `operations.request.receive_order` | requests | workflow | مرحلة استلام الطلب | لا |
| `operations.request.send_car` | requests | workflow | مرحلة إرسال السيارة | لا |
| `operations.request.receive_car` | requests | workflow | مرحلة استلام السيارة | لا |
| `operations.request.finish_order` | requests | workflow | مرحلة إنهاء الطلب | لا |
| `operations.request.rollback` | requests | workflow | التراجع عن مرحلة طلب | نعم |
| `operations.request.delete` | requests | action | حذف طلب عمليات | نعم |
| `operations.settings.view` | settings | page | مشاهدة إعدادات العمليات | نعم |
| `operations.settings.manage` | settings | action | تعديل إعدادات العمليات | نعم |

## التراكينج

| المفتاح | الصفحة | النوع | الوصف | حساس |
|---|---|---|---|---|
| `system.tracking.access` | دخول النظام | system | الدخول إلى نظام التراكينج | لا |
| `tracking.orders.view` | orders | page | مشاهدة طلبات التراكينج | لا |
| `tracking.order.open` | orders | action | فتح طلب التراكينج | لا |
| `tracking.link.create` | orders | action | إنشاء رابط تتبع | لا |
| `tracking.link.copy` | orders | action | نسخ رابط التتبع | لا |
| `tracking.sms.send` | orders | action | إرسال SMS | نعم |
| `tracking.order.archive` | orders | action | أرشفة الطلب | نعم |
| `tracking.stage.01.complete` | orders | workflow | تنفيذ المرحلة 1 | لا |
| `tracking.stage.02.complete` | orders | workflow | تنفيذ المرحلة 2 | لا |
| `tracking.stage.03.complete` | orders | workflow | تنفيذ المرحلة 3 | لا |
| `tracking.stage.04.complete` | orders | workflow | تنفيذ المرحلة 4 | لا |
| `tracking.stage.05.complete` | orders | workflow | تنفيذ المرحلة 5 | لا |
| `tracking.stage.06.complete` | orders | workflow | تنفيذ المرحلة 6 | لا |
| `tracking.stage.07.complete` | orders | workflow | تنفيذ المرحلة 7 | لا |
| `tracking.stage.08.complete` | orders | workflow | تنفيذ المرحلة 8 | لا |
| `tracking.stage.09.complete` | orders | workflow | تنفيذ المرحلة 9 | لا |
| `tracking.stage.10.complete` | orders | workflow | تنفيذ المرحلة 10 | لا |
| `tracking.stage.01.rollback` | orders | workflow | التراجع عن المرحلة 1 | نعم |
| `tracking.stage.02.rollback` | orders | workflow | التراجع عن المرحلة 2 | نعم |
| `tracking.stage.03.rollback` | orders | workflow | التراجع عن المرحلة 3 | نعم |
| `tracking.stage.04.rollback` | orders | workflow | التراجع عن المرحلة 4 | نعم |
| `tracking.stage.05.rollback` | orders | workflow | التراجع عن المرحلة 5 | نعم |
| `tracking.stage.06.rollback` | orders | workflow | التراجع عن المرحلة 6 | نعم |
| `tracking.stage.07.rollback` | orders | workflow | التراجع عن المرحلة 7 | نعم |
| `tracking.stage.08.rollback` | orders | workflow | التراجع عن المرحلة 8 | نعم |
| `tracking.stage.09.rollback` | orders | workflow | التراجع عن المرحلة 9 | نعم |
| `tracking.stage.10.rollback` | orders | workflow | التراجع عن المرحلة 10 | نعم |
| `tracking.settings.view` | settings | page | مشاهدة إعدادات التراكينج | نعم |
| `tracking.settings.manage` | settings | action | تعديل إعدادات التراكينج | نعم |

## التسويق

| المفتاح | الصفحة | النوع | الوصف | حساس |
|---|---|---|---|---|
| `system.marketing.access` | دخول النظام | system | الدخول إلى نظام التسويق | لا |
| `marketing.agenda.view` | agenda | page | مشاهدة الأجندة | لا |
| `marketing.agenda.create` | agenda | action | إنشاء أجندة | لا |
| `marketing.agenda.edit` | agenda | action | تعديل أجندة | لا |
| `marketing.agenda.delete` | agenda | action | حذف أجندة | نعم |
| `marketing.calendar.view` | calendar | page | مشاهدة التقويم | لا |
| `marketing.campaigns.view` | campaigns | page | مشاهدة الحملات | لا |
| `marketing.campaign.create` | campaigns | action | إنشاء حملة | لا |
| `marketing.campaign.edit` | campaigns | action | تعديل حملة | لا |
| `marketing.campaign.delete` | campaigns | action | حذف حملة | نعم |
| `marketing.structure.approve` | campaigns | workflow | اعتماد الهيكل | نعم |
| `marketing.structure.reject` | campaigns | workflow | رفض الهيكل | نعم |
| `marketing.task_template.download` | campaigns | action | تحميل قالب Task Template | لا |
| `marketing.task_template.upload` | campaigns | action | رفع Task Template | لا |
| `marketing.task_template.reupload` | campaigns | action | إعادة رفع Task Template | لا |
| `marketing.task_template.approve` | campaigns | workflow | اعتماد Task Template | نعم |
| `marketing.assignment_actions.execute` | campaigns | workflow | تنفيذ إجراء تكليف مسند | لا |
| `marketing.assignment_actions.approve` | campaigns | workflow | اعتماد إجراءات التكليف | نعم |
| `marketing.final_file.upload` | campaigns | action | رفع الملف النهائي | لا |
| `marketing.task.reopen` | campaigns | workflow | إعادة فتح التاسك | نعم |
| `marketing.dashboard.view` | dashboard | page | مشاهدة لوحة التسويق | لا |
| `marketing.publishing.view` | publishing | page | مشاهدة تجهيز النشر | لا |
| `marketing.publishing.manage` | publishing | action | تعديل تجهيز وجدولة النشر | نعم |
| `marketing.settings.view` | settings | page | مشاهدة إعدادات التسويق | لا |
| `marketing.settings.manage` | settings | action | تعديل إعدادات التسويق | نعم |

## CRM

| المفتاح | الصفحة | النوع | الوصف | حساس |
|---|---|---|---|---|
| `system.crm.access` | دخول النظام | system | الدخول إلى نظام CRM | لا |
| `crm.dashboard.view` | dashboard | page | مشاهدة داش بورد CRM | لا |
| `crm.database.view` | database | page | مشاهدة قاعدة بيانات العملاء | لا |
| `crm.customer.view` | database | action | فتح بيانات العميل | لا |
| `crm.customer.update` | database | action | تعديل بيانات العميل | لا |
| `crm.customer.change_status` | database | action | تغيير حالة العميل | لا |
| `crm.customer.add_note` | database | action | إضافة ملاحظة للعميل | لا |
| `crm.customer.change_owner` | database | action | تغيير مسؤول العميل | نعم |
| `crm.customer.transfer` | database | action | نقل العميل | نعم |
| `crm.customer.delete` | database | action | حذف العميل | نعم |
| `crm.customer.export` | database | action | تصدير العملاء | نعم |
| `crm.finance_history.view` | finance_history | page | مشاهدة سجل عملاء التمويل | لا |
| `crm.inbox.view` | inbox | page | مشاهدة صندوق الوارد | لا |
| `crm.conversation.view` | inbox | action | فتح المحادثة | لا |
| `crm.conversation.send_text` | inbox | action | إرسال نص | لا |
| `crm.conversation.send_template` | inbox | action | إرسال قالب | لا |
| `crm.conversation.send_media` | inbox | action | إرسال وسائط | لا |
| `crm.conversation.download_attachment` | inbox | action | تحميل مرفق | لا |
| `crm.conversation.mark_read` | inbox | action | تغيير حالة القراءة | لا |
| `crm.inbox_agent.view` | inbox_agent | page | مشاهدة وكيل صندوق الوارد | لا |
| `crm.inbox_agent.manage` | inbox_agent | action | إدارة وكيل صندوق الوارد | نعم |
| `crm.kpi.view` | kpi | page | مشاهدة KPI | لا |
| `crm.kpi.manage` | kpi | action | إضافة وتعديل تقييمات المناديب | نعم |
| `crm.kpi.export` | kpi | action | تصدير تقارير KPI | نعم |
| `crm.customer.create` | manual_leads | action | إضافة عميل | لا |
| `crm.manual_leads.view` | manual_leads | page | فتح صفحة إضافة العملاء | لا |
| `crm.manual_lead.create` | manual_leads | action | إنشاء طلب إضافة عميل | لا |
| `crm.manual_lead.approve_duplicate` | manual_leads | action | اعتماد أو رفض العميل المكرر | نعم |
| `crm.manual_lead.delete` | manual_leads | action | حذف طلب إضافة عميل | نعم |
| `crm.ownership.view` | ownership | page | مشاهدة سجل ملكية العملاء | لا |
| `crm.reports.view` | reports | page | مشاهدة تقارير CRM | لا |
| `crm.reports.export` | reports | action | تصدير تقارير CRM | نعم |
| `crm.settings.view` | settings | page | مشاهدة إعدادات CRM | نعم |
| `crm.settings.manage` | settings | action | تعديل إعدادات CRM | نعم |
