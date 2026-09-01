# MZJ Platform - Marketing Package Lookup Legacy Schema CLEAN v46

نسخة كاملة مبنية من سورس v45 الكامل.

## سبب الخطأ
كانت جداول `marketing.package_categories` و `marketing.package_sales_types` موجودة في بعض قواعد البيانات من إصدار أقدم قبل إضافة عمود `created_by`. جملة `CREATE TABLE IF NOT EXISTS` لا تضيف الأعمدة المفقودة للجدول الموجود، بينما API إعدادات الباقات يسجل `created_by` عند إنشاء تصنيف أو نوع مبيعات جديد.

## الإصلاح
- إضافة ترقية idempotent داخل runtime schema للجداول القديمة.
- إضافة نفس الترقية داخل ملف migration الأساسي.
- إضافة `created_by` للجداول القديمة مع مرجع `core.users`.
- تأمين الحقول التي يعتمد عليها API الحالي: `is_active`, `sort_order`, `created_at`, `updated_at`.
- الإبقاء على تسجيل منشئ التصنيف/نوع المبيعات بدل حذف الـaudit field من الـAPI.
- تغطية `package_categories` و `package_sales_types` معًا حتى لا يظهر نفس الخطأ في الخطوة التالية.

لا توجد ملفات Patch أو Diff، ولم يتم تغيير منطق الباقات أو MZJ Club أو CRM أو التسويق الآخر.
