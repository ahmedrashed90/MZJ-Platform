# إصلاح Build وTypeScript — v1.19.1

## سبب المشكلة

استعلامات مكتبة `postgres` ترجع قائمة صفوف. في خدمتي الصلاحيات والجلسة تم فك نتيجة `Promise.all` إلى متغيرات ثم التعامل مع قائمة الصفوف كأنها صف واحد، لذلك رفض TypeScript خصائص مثل `effective_permissions` و`id`.

كما كان ملف `shared/system-access.ts` يستخدم مسار Import نسبيًا دون امتداد، وهو غير مقبول في مشروع السيرفر الذي يستخدم `moduleResolution: NodeNext`.

## الإصلاح الجذري

- الاحتفاظ بنتائج الاستعلامات كقوائم مسماة: `versionRows` و`permissionRows` و`rows`.
- استخراج الصف الأول صراحة بعد اكتمال الاستعلام: `versionRows[0]` و`permissionRows[0]` و`rows[0]`.
- إضافة الامتداد `.js` إلى Import المشترك المتوافق مع NodeNext.
- إضافة اختبار رجوع `scripts/check-build-types-v1191.mjs` ضمن أمر `typecheck`.

لم يتم تغيير أي فلو أو صلاحية أو Migration أو تصميم أو منطق تشغيلي في الأنظمة الأربعة.
