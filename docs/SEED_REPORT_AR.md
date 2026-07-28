# تقرير الـSeed والترحيل

## الملفات

- Migration رئيسية: `database/migrations/20260724_central_access_control_v1190.sql`
- Seed مستقل: `database/seeds/20260724_central_access_catalog.sql`
- Rollback: `database/migrations/20260724_central_access_control_v1190_rollback.sql`

## محتوى الـSeed

- 5 نطاقات كتالوجية عند احتساب المنصة المركزية مع الأنظمة الأربعة.
- 37 صفحة.
- 215 مفتاح صلاحية.
- 15 قالب دور أساسي.
- صلاحيات افتراضية محافظة لكل قالب.

## خصائص التشغيل

- Idempotent باستخدام `ON CONFLICT`.
- لا ينشئ مستخدمين تجريبيين.
- لا يغير كلمات مرور المستخدمين.
- لا يغير User IDs.
- لا يحذف ارتباطات تشغيلية.

## تقرير الاستيراد الفعلي

لا يمكن إصدار أعداد مستخدمين جدد أو محدثين قبل تشغيل Migration على قاعدة البيانات الفعلية. يجب تسجيل نتائج التشغيل الفعلية من بيئة الرفع: created / updated / unchanged / conflicts.
