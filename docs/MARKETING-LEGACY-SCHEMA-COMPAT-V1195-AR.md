# تقرير توافق Schema التسويق القديم — الإصدار 1.19.5

## المشكلة التي ظهرت في الإنتاج

ظهر الخطأ التالي عند فتح نظام التسويق:

`null value in column "prefix" of relation "campaign_types" violates not-null constraint`

السبب الجذري أن قاعدة البيانات الحالية تحتوي على نسخة قديمة من جدول `marketing.campaign_types` تستخدم العمودين `code` و`prefix` كأعمدة إجبارية، بينما التنفيذ الـNative الجديد يستخدم `short_code` و`code_prefix`. إنشاء الجدول بشرط `IF NOT EXISTS` لا يغير قيود الأعمدة القديمة، ولذلك كانت عمليات الـSeed الجديدة تُرفض قبل اكتمال تهيئة النظام.

## المعالجة الجذرية

تم تعديل عقد Schema التسويق نفسه، وليس إضافة استعلام منفصل أو ملف إصلاح مؤقت:

1. نقل القيم القديمة من `code` و`prefix` إلى `short_code` و`code_prefix` مع الحفاظ على البيانات الموجودة.
2. استكمال قيم العقد الجديد قبل فرض قيود `NOT NULL` عليه.
3. فحص جميع الأعمدة الإضافية الموروثة داخل جداول Schema `marketing`.
4. إسقاط شرط `NOT NULL` فقط من العمود القديم الإضافي الذي:
   - لا ينتمي إلى العقد الـNative النهائي.
   - لا يملك قيمة افتراضية.
   - ليس Identity أو Generated.
   - ليس جزءًا من المفتاح الأساسي.
5. عدم حذف الأعمدة القديمة وعدم تغيير المفاتيح الأساسية أو بيانات السجلات السابقة.
6. إضافة فحص نهائي داخل نفس الـTransaction يوقف العملية ويعمل Rollback إذا ظل أي عمود قديم يمنع عمليات الكتابة الجديدة.
7. الحفاظ على نسخة واحدة متطابقة من Schema في:
   - `database/marketing_native_schema.sql`
   - `database/migrations/20260723_marketing_native_rebuild.sql`
   - `server/_marketing-schema.ts`

## نطاق المراجعة

- 28 جدولًا داخل نظام التسويق.
- 295 عمودًا ضمن العقد النهائي.
- 163 قالب SQL مستخدمًا في API والسيرفر.
- 258 مرجعًا فعليًا للأعمدة داخل الاستعلامات.
- مراجعة كل عمليات Seed للتأكد من عدم إغفال أي عمود إلزامي بدون Default.
- محاكاة 6 حالات لترقية قواعد بيانات قديمة، من بينها الحالة المطابقة للخطأ الحالي: `campaign_types.code` و`campaign_types.prefix` كلاهما `NOT NULL` وبدون Default.

## الملفات المعدلة

- `database/marketing_native_schema.sql`
- `database/migrations/20260723_marketing_native_rebuild.sql`
- `server/_marketing-schema.ts`
- `scripts/check-marketing-schema-contract.mjs`
- `scripts/test-marketing-schema-upgrade-scenarios.mjs`
- `scripts/check-source-syntax.mjs`
- `package.json`
- `README.md`

## طريقة النشر

1. ارفع السورس الكامل للإصدار 1.19.5.
2. نفّذ Redeploy بدون Build Cache.
3. لا تشغّل ملف SQL منفصلًا ولا تعدّل الجدول يدويًا.
4. أول استدعاء للسيرفر سيشغّل عقد Schema داخل Transaction واحدة وتحت Advisory Lock.

## حدود التحقق داخل بيئة التنفيذ

تم تشغيل فحص TypeScript الدلالي الكامل لملفات السيرفر وجميع اختبارات البنية والمنطق المذكورة في ملف النتائج. لم يتوفر داخل بيئة التنفيذ محرك PostgreSQL محلي أو اتصال بقاعدة الإنتاج، لذلك تم اختبار ترقية الجداول بمحاكي Schema مخصص يشمل حالة `prefix/code` حرفيًا. كذلك لم يكتمل Frontend bundle محليًا بسبب عدم توفر حزم React في البيئة وتعذر الوصول إلى npm registry؛ لم تُعدّل ملفات الواجهة في هذا الإصدار.
