# تسليم MZJ Platform v1.14.0 — Operations Native

تاريخ التسليم: 19 يوليو 2026

## المصدر المعتمد

تم التنفيذ داخل سورس المنصة النظيفة بعد إضافة Tracking، ولم يتم البناء على أي محاولة سابقة لإضافة العمليات. سورس العمليات القديم استُخدم كمرجع للفلو والحقول والشروط فقط، ولم يتم نسخ صفحات HTML أو JavaScript أو Firebase منه.

## ما تم تنفيذه

- وحدة عمليات Native داخل React وTypeScript وتصميم المنصة وقائمتها الحالية.
- صلاحيات Server-Side مركزية ودعم الدور `system_admin` كأعلى صلاحية، مع استمرار تطبيق قواعد سلامة البيانات.
- مخزون السيارات بترتيب الأعمدة المطلوب، بحث جزئي في VIN، فلاتر، Pagination، تفاصيل السيارة وسجلاتها.
- إدارة السيارات: إضافة، تعديل، منع VIN المكرر، الحفاظ على الأصفار، قالب Excel، تصدير، واستيراد XLSX/CSV مع تقرير صفوف كامل.
- تشيك مستقل لكل عنصر ولكل سيارة، مع سجل تغييرات.
- حركة فردية داخل Transaction واحدة.
- حركة جماعية Batch مع State وتشيك وملاحظات مستقلة لكل سيارة وRollback كامل عند فشل أي سيارة.
- طلبات نقل وتصوير مستقلة، تبويبات الصادر والوارد والمكتمل والملغي، مراحل مرتبة، قفل ومنع التكرار، وحذف قبل بدء التنفيذ أو إلغاء بعده.
- تحديث مكان السيارة وإنشاء حركة رسمية عند مرحلة استلام السيارة.
- الموافقة المالية والإدارية كدورتين مستقلتين مع الموافقة والتراجع والملاحظات ومسح الموافقات مع الاحتفاظ بالتاريخ.
- منع الانتقال إلى «مباع تم التسليم» داخل الـAPI قبل اكتمال الموافقتين.
- صفحة جميع السيارات، سجل الحركات، الأرشيف، والموافقات.
- أرشفة منطقية مشروطة بالحالة النهائية والموافقات والحركة وTracking المكتمل وعدم وجود طلب نقل متعارض.
- تكامل Tracking تلقائي باستخدام `vehicle_id` مع VIN كمرجع إضافي وBackfill للطلبات القديمة، وعرض الحالة والنسبة وفتح الطلب حسب الصلاحية.
- ربط Tracking بصورة مجمعة بدل API منفصلة لكل صف.
- Audit Trail وEvent Outbox لأحداث العمليات وتجهيز نظام الإشعارات المركزي مستقبلًا.
- تحديث استعلامات الداش بورد لتستخدم السيارات النشطة وآخر دورة موافقات ومصدر بيانات العمليات الجديد دون إنشاء داش بورد عمليات منفصلة.
- إعدادات العمليات داخل صفحة إعدادات المنصة.
- إغلاق Modals بزر Esc، حالات Loading، ومنع الضغط المتكرر في الإجراءات الرئيسية.

## أهم الملفات الجديدة

### قاعدة البيانات
- `database/migrations/20260719_operations_native_v1.sql`
- `server/_operations-schema.ts`

### Backend وAPI
- `server/_operations-auth.ts`
- `server/_operations-utils.ts`
- `server/_operations-data.ts`
- `server/operations/meta.ts`
- `server/operations/vehicles.ts`
- `server/operations/movements.ts`
- `server/operations/requests.ts`
- `server/operations/approvals.ts`
- `server/operations/archive.ts`
- `server/operations/settings.ts`
- `server/operations/reports.ts`

### واجهة العمليات
- `src/operations/OperationsLayout.tsx`
- `src/operations/OperationsSettingsPanel.tsx`
- `src/operations/api.ts`
- `src/operations/excel.ts`
- `src/operations/components/OperationsModal.tsx`
- `src/operations/components/VehiclePicker.tsx`
- جميع الصفحات داخل `src/operations/pages/`

### ملفات الربط المركزية المعدلة
- `api/index.ts`
- `server/_auth.ts`
- `src/auth/AuthContext.tsx`
- `server/_tracking-auth.ts`
- `server/integrations/tracking-orders.ts`
- `server/_dashboard-data.ts`
- `src/App.tsx`
- `src/components/Sidebar.tsx`
- `src/pages/SettingsPage.tsx`
- `src/tracking/pages/TrackingOrdersPage.tsx`
- `src/styles.css`
- `package.json`

## تشغيل الـMigration

### قبل التنفيذ
1. أخذ Backup كامل من PostgreSQL.
2. تنفيذ النسخة أولًا على قاعدة Staging مطابقة للإنتاج.
3. مراجعة تقرير `operations.tracking_link_reviews` بعد الربط القديم باستخدام VIN.

### التنفيذ التلقائي
وحدة العمليات تستدعي `ensureOperationsSchema()` قبل تشغيل APIs، وهي تشغّل Tracking schema أولًا ثم Migration العمليات بصورة Idempotent قدر الإمكان.

### التنفيذ اليدوي البديل
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/20260719_operations_native_v1.sql
```

## التحقق المنفذ

نجح الأمر:
```bash
npm run build
```

وشمل فعليًا:
- فحوص Imports وRoutes.
- اختبارات البنية الحالية لـCRM.
- اختبارات Tracking Native الحالية.
- فحص بنية عمليات v1.14 وعدم وجود Firebase أو iframe أو إيميلات Hardcoded داخل الوحدة.
- فحص وجود Transactions والحركات الجماعية وقفل مراحل الطلبات والموافقات المستقلة وتكامل Tracking.
- `tsc -b` بدون أخطاء.
- Vite Production Build بنجاح.

التفاصيل الكاملة موجودة في:
- `docs/BUILD-VERIFICATION-V1.14.txt`

## نقطة لم تُنفذ داخل بيئة التسليم

لم يكن متغير `DATABASE_URL` متوفرًا، لذلك لم يتم تشغيل الـMigration على قاعدة PostgreSQL حقيقية ولم يتم إجراء اختبارات تكامل على بيانات الإنتاج. لا يُدّعى خلاف ذلك. يجب تنفيذ Migration واختبارات السيناريوهات التشغيلية على Staging قبل النشر النهائي.
