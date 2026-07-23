# مراجعة وإصلاح Schema التسويق — MZJ Platform v1.19.4

## السبب الجذري

قاعدة البيانات الحالية تحتوي على جداول تسويق أُنشئت بإصدارات أو محاولات سابقة. أمر PostgreSQL التالي:

```sql
create table if not exists ...
```

لا يضيف الأعمدة الناقصة إلى جدول موجود بالفعل. لذلك كان جدول `marketing.activity_log` موجودًا، لكن بدون العمود `entity_type`، ثم فشل إنشاء الفهرس أو استعلامات النظام برسالة:

```text
column "entity_type" does not exist
```

المشكلة لم تكن في الواجهة، ولم يكن الحل الصحيح إضافة العمود وحده كترقيع منفصل.

## التنفيذ النهائي

1. إنشاء مصدر واحد نهائي لـSchema التسويق:
   - `database/marketing_native_schema.sql`
2. مزامنة نفس النص حرفيًا مع:
   - `server/_marketing-schema.ts`
   - `database/migrations/20260723_marketing_native_rebuild.sql`
3. تعريف الشكل النهائي الكامل لكل جدول بدل توزيع تعريف الجدول بين `CREATE TABLE` ومجموعة تعديلات متراكمة.
4. إضافة عقد توافق للجداول الموجودة:
   - كل عمود مطلوب في كل جدول له `ADD COLUMN IF NOT EXISTS` قبل أي فهرس أو استعلام يعتمد عليه.
   - يغطي 28 جدولًا و295 عمودًا.
5. إصلاح `marketing.activity_log` مع الحفاظ على السجلات القديمة:
   - إضافة `actor_id`, `actor_name`, `action`, `entity_type`, `entity_id`, `details`, `created_at` عند غياب أي منها.
   - توحيد أنواع الحقول النصية إلى `text` و`details` إلى `jsonb` عند وجود نوع قديم مختلف.
   - تعبئة السجلات القديمة بقيم آمنة فقط عندما تكون الحقول فارغة.
6. الحفاظ على توافق `marketing.attendance_settings` مع المفتاح القديم سواء كان `boolean` أو `text`، بدون مقارنة المفتاح داخل Runtime API وبدون تحويل نوعه.
7. تشغيل Schema التسويق بالكامل داخل Transaction واحدة:
   - أي خطأ يلغي العملية كلها.
   - لا تظل قاعدة البيانات في حالة نصف محدثة.
8. استخدام PostgreSQL advisory lock لمنع تنفيذ تحديث Schema نفسه بالتوازي من أكثر من Vercel Function باردة.
9. إضافة Postcheck داخل PostgreSQL يفحص وجود جميع الجداول والأعمدة قبل `COMMIT`.
10. ضمان تشغيل Schema التسويق قبل استعلامات الداش بورد أيضًا، وليس عند فتح صفحة التسويق فقط.

## منع تكرار المشكلة

أضيفت الأدوات التالية داخل السورس:

- `scripts/check-marketing-schema-contract.mjs`
  - يثبت تطابق ملفات Schema الثلاثة.
  - يثبت وجود ترقية للجداول الموجودة لكل عمود.
  - يثبت أن إصلاح `entity_type` يسبق إنشاء الفهرس.
- `scripts/check-marketing-api-schema-usage.mjs`
  - يراجع 163 استعلام SQL داخل Marketing API مقابل Schema النهائي.
  - تحقق من 258 استخدامًا فعليًا للأعمدة.
- `scripts/test-marketing-schema-upgrade-scenarios.mjs`
  - يحاكي الترقية من قاعدة فارغة.
  - يحاكي جداول التسويق الأساسية في منصة v1.18.
  - يحاكي جدول Activity Log ناقصًا.
  - يحاكي اختلاف نوع مفتاح Attendance Settings.
- `scripts/sync-marketing-schema.mjs`
  - يمنع تعديل Runtime Schema أو Migration بشكل منفصل عن الملف الأساسي.

## النشر

- ارفع السورس الكامل v1.19.4.
- اعمل Redeploy بدون Build Cache.
- لا تشغل Patch SQL منفصلًا.
- عند أول فتح للداش بورد أو العمليات أو التسويق، ينفذ Runtime Schema العقد الكامل داخل Transaction واحدة.
