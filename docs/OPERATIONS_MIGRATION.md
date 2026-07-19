# تشغيل Migration نظام العمليات

## الملف

`database/migrations/20260719_operations_native.sql`

## قبل التنفيذ

1. خذ نسخة احتياطية كاملة من PostgreSQL.
2. نفذ الـMigration أولًا على نسخة Staging مطابقة للإنتاج.
3. تأكد من وجود `DATABASE_URL` وصلاحية المستخدم في إنشاء Schemas وTables وIndexes وConstraints.
4. أوقف أي عمليات كتابة على جداول العمليات القديمة خلال نافذة الترحيل إذا كانت مستخدمة فعليًا.

## أمر التنفيذ

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/20260719_operations_native.sql
```

## ما تنشئه الـMigration

- Schema باسم `operations`.
- المواقع والحالات والسيارات وملاحظات الحالات والنواقص.
- عناصر وقيم وسجل تغييرات التشيك.
- دورات الموافقات وسجل أحداثها.
- Batches الحركات وسجل حركة مستقل لكل سيارة.
- طلبات النقل والتصوير وسيارات الطلب ومراحله وأحداثه.
- الأرشيف وروابط Tracking وAudit Trail وEvent Outbox.
- Constraints وForeign Keys وIndexes اللازمة.
- الأدوار والصلاحيات المركزية اللازمة لنظام العمليات و`system_admin`.
- عمود ربط السيارة في طلبات Tracking عند الحاجة.
- ترحيل Idempotent للبيانات المتاحة من جداول طلبات النقل القديمة، مع الاحتفاظ بـ Legacy ID وعدم حذف الجداول القديمة.

## خصائص الأمان

- لا يحتوي الملف على `DROP TABLE` أو `TRUNCATE` أو حذف جماعي للبيانات.
- يستخدم `IF NOT EXISTS` وكتلًا شرطية بقدر الإمكان ليكون قابلًا لإعادة التشغيل.
- يحافظ على الجداول القديمة ولا يعتبرها مصدر الحقيقة بعد اكتمال التحقق والترحيل.
- يجب اختبار عدد السيارات والطلبات والموافقات قبل وبعد التنفيذ.

## فحوص ما بعد التنفيذ

```sql
select count(*) from operations.vehicles;
select count(*) from operations.requests;
select count(*) from operations.movements;
select count(*) from operations.vehicle_approvals where is_current = true;
select count(*) from operations.audit_log;
```

ثم تحقق من:

- عدم وجود VIN مكرر.
- تطابق أرقام الداش بورد مع صفحات العمليات.
- ظهور طلبات Tracking المرتبطة.
- عمل صلاحيات مدير النظام ومدير الحسابات ومدير العمليات.
- نجاح إنشاء حركة تجريبية وRollback عند إدخال سيارة غير صالحة ضمن Batch.
