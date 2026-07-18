# جدول صفحات وإجراءات كل نظام

## العمليات

| الصفحة | المسار | عدد المفاتيح | مفاتيح الإجراءات/المراحل |
|---|---|---:|---|
| دخول النظام | — | 1 | `system.operations.access` |
| الداش بورد | `/operations` | 1 | `operations.dashboard.view` |
| قاعدة البيانات والمخزون | `/operations/database` | 5 | `operations.database.view`، `operations.vehicle.create`، `operations.vehicle.update`، `operations.vehicle.delete`، `operations.vehicle.export` |
| حركة السيارات | `/operations/movement` | 2 | `operations.movement.view`، `operations.movement.execute` |
| طلبات العمليات | `/operations/requests` | 9 | `operations.requests.view`، `operations.request.create`، `operations.request.send`، `operations.request.receive_order`، `operations.request.send_car`، `operations.request.receive_car`، `operations.request.finish_order`، `operations.request.rollback`، `operations.request.delete` |
| سجل الحركات | `/operations/history` | 1 | `operations.history.view` |
| الأرشيف | `/operations/archive` | 0 | — |
| إعدادات العمليات | `/settings?section=operations` | 2 | `operations.settings.view`، `operations.settings.manage` |

## التراكينج

| الصفحة | المسار | عدد المفاتيح | مفاتيح الإجراءات/المراحل |
|---|---|---:|---|
| دخول النظام | — | 1 | `system.tracking.access` |
| طلبات التتبع | `/tracking` | 26 | `tracking.orders.view`، `tracking.order.open`، `tracking.link.create`، `tracking.link.copy`، `tracking.sms.send`، `tracking.order.archive`، `tracking.stage.01.complete`، `tracking.stage.02.complete`، `tracking.stage.03.complete`، `tracking.stage.04.complete`، `tracking.stage.05.complete`، `tracking.stage.06.complete`، `tracking.stage.07.complete`، `tracking.stage.08.complete`، `tracking.stage.09.complete`، `tracking.stage.10.complete`، `tracking.stage.01.rollback`، `tracking.stage.02.rollback`، `tracking.stage.03.rollback`، `tracking.stage.04.rollback`، `tracking.stage.05.rollback`، `tracking.stage.06.rollback`، `tracking.stage.07.rollback`، `tracking.stage.08.rollback`، `tracking.stage.09.rollback`، `tracking.stage.10.rollback` |
| صفحة تتبع العميل العامة | `/tracking/public` | 0 | — |
| إعدادات التراكينج | `/settings?section=tracking` | 2 | `tracking.settings.view`، `tracking.settings.manage` |

## التسويق

| الصفحة | المسار | عدد المفاتيح | مفاتيح الإجراءات/المراحل |
|---|---|---:|---|
| دخول النظام | — | 1 | `system.marketing.access` |
| لوحة التحكم | `/marketing` | 1 | `marketing.dashboard.view` |
| إدارة الحملات | `/marketing/campaigns` | 14 | `marketing.campaigns.view`، `marketing.campaign.create`، `marketing.campaign.edit`، `marketing.campaign.delete`، `marketing.structure.approve`، `marketing.structure.reject`، `marketing.task_template.download`، `marketing.task_template.upload`، `marketing.task_template.reupload`، `marketing.task_template.approve`، `marketing.assignment_actions.execute`، `marketing.assignment_actions.approve`، `marketing.final_file.upload`، `marketing.task.reopen` |
| إدارة الأجندة | `/marketing/agenda` | 4 | `marketing.agenda.view`، `marketing.agenda.create`، `marketing.agenda.edit`، `marketing.agenda.delete` |
| تجهيز وجدولة النشر | `/marketing/publishing` | 2 | `marketing.publishing.view`، `marketing.publishing.manage` |
| التقويم | `/marketing/calendar` | 1 | `marketing.calendar.view` |
| إعدادات التسويق | `/settings?section=marketing` | 2 | `marketing.settings.view`، `marketing.settings.manage` |

## CRM

| الصفحة | المسار | عدد المفاتيح | مفاتيح الإجراءات/المراحل |
|---|---|---:|---|
| دخول النظام | — | 1 | `system.crm.access` |
| الداش بورد | `/crm` | 1 | `crm.dashboard.view` |
| قاعدة البيانات | `/crm/database` | 9 | `crm.database.view`، `crm.customer.view`، `crm.customer.update`، `crm.customer.change_status`، `crm.customer.add_note`، `crm.customer.change_owner`، `crm.customer.transfer`، `crm.customer.delete`، `crm.customer.export` |
| إضافة العملاء | `/crm/manual-leads` | 5 | `crm.customer.create`، `crm.manual_leads.view`، `crm.manual_lead.create`، `crm.manual_lead.approve_duplicate`، `crm.manual_lead.delete` |
| سجل عملاء التمويل | `/crm/finance-history` | 1 | `crm.finance_history.view` |
| صندوق الوارد | `/crm/inbox` | 7 | `crm.inbox.view`، `crm.conversation.view`، `crm.conversation.send_text`، `crm.conversation.send_template`، `crm.conversation.send_media`، `crm.conversation.download_attachment`، `crm.conversation.mark_read` |
| وكيل صندوق الوارد | `/crm/inbox-agent` | 2 | `crm.inbox_agent.view`، `crm.inbox_agent.manage` |
| سجل ملكية العملاء | `/crm/ownership` | 1 | `crm.ownership.view` |
| التقارير | `/crm/reports` | 2 | `crm.reports.view`، `crm.reports.export` |
| تقييم المناديب KPI | `/crm/kpi` | 3 | `crm.kpi.view`، `crm.kpi.manage`، `crm.kpi.export` |
| إعدادات CRM | `/settings?section=crm` | 2 | `crm.settings.view`، `crm.settings.manage` |

## الإعدادات المركزية

| الصفحة | المسار | عدد المفاتيح | مفاتيح الإجراءات/المراحل |
|---|---|---:|---|
| دخول النظام | — | 1 | `settings.access` |
| المستخدمون | `/settings` | 4 | `settings.users.view`، `settings.users.create`، `settings.users.update`، `settings.users.disable` |
| الأدوار وقوالب الصلاحيات | `/settings?section=users&tab=roles` | 1 | `settings.roles.manage` |
| الفروع والأقسام | `/settings?section=users&tab=organization` | 1 | `settings.branches.manage` |
| دليل الصلاحيات | `/settings?section=users&tab=permissions` | 1 | `settings.permissions.manage` |
| سجلات الصلاحيات والأمن | `/settings?section=users&tab=audit` | 2 | `settings.audit.view`، `settings.security.view` |

