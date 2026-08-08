# الملفات المعدلة — v1.19.9

تمت مقارنة النسخة النهائية بالسورس النظيف v1.19.7.

## ملفات التنفيذ

- `package.json` — إضافة فحص الرجوع الخاص بالإصلاح.
- `server/_access-control-schema.ts` — إزالة قيد اسم القسم العالمي القديم.
- `server/_marketing-schema.ts` — إصلاح وتوحيد أقسام التسويق القديمة المتعارضة.
- `server/marketing/index.ts` — تحميل وحفظ الأقسام دون تعارض وإعادة استخدام القسم الموجود.
- `src/access-control/UsersPermissionsPanel.tsx` — إخفاء تكرار قوالب الأدوار في العرض فقط.
- `src/marketing/pages/DepartmentsPage.tsx` — اختيار متعدد لكل حسابات المنصة الفعالة.
- `src/pages/SettingsPage.tsx` — تنظيم صفحة الإعدادات.
- `src/styles.css` — تنسيق صفحة الإعدادات واختيار يوزرات الأقسام.
- `scripts/check-marketing-department-access-v1199.mjs` — فحوصات الرجوع.

## ملفات التوثيق والاختبار

- `docs/MARKETING-DEPARTMENTS-ROLES-FIX-V1199-AR.md`
- `docs/MODIFIED_FILES_V1199_AR.md`
- `test-results/v1199/`
- `DELIVERY_MANIFEST_AR.md`
- `README.md`
