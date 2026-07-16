# MZJ Platform v1.2

منصة React/Vite موحدة لمجموعة محمد بن ذعار العجمي، تعمل على Vercel مع PostgreSQL وتسجيل دخول حقيقي.

## ما تم تنفيذه في هذه النسخة

- لا توجد أسماء أو أرقام أو حسابات تجريبية.
- فحص تلقائي لاتصال PostgreSQL عند فتح المنصة.
- تهيئة قاعدة البيانات من داخل المنصة لأول مرة.
- إنشاء أول حساب «مدير النظام» بالبيانات التي يدخلها المستخدم فقط.
- تسجيل دخول حقيقي بالبريد أو الجوال أو رقم الموظف.
- جلسة دخول آمنة داخل Cookie من نوع HttpOnly.
- حماية API الداش بورد والإعدادات والمستخدمين من الوصول بدون تسجيل دخول.
- إدارة المستخدمين متاحة لمدير النظام فقط.
- إنشاء المستخدمين مع القسم والفرع والدور وخيارات استقبال العملاء والتاسكات.
- تسجيل عمليات التهيئة والدخول وإنشاء المستخدمين في سجل النشاط بقاعدة البيانات.

## إعداد Vercel

1. ارفع محتويات المشروع إلى جذر Repository.
2. Framework Preset: `Vite`.
3. Build Command: `npm run build`.
4. Output Directory: `dist`.
5. اربط PostgreSQL من Vercel Marketplace بنفس المشروع.
6. تأكد من وجود `DATABASE_URL` في Environment Variables.
7. أضف `MZJ_SETUP_KEY` بقيمة سرية طويلة من اختيارك.
8. يمكن إضافة `MZJ_GATEWAY_SECRET` لاحقًا عند تشغيل الـWorker المركزي.
9. اعمل Redeploy بدون Build Cache.

## أول تشغيل

- لو PostgreSQL غير مربوطة ستظهر صفحة الربط فقط.
- بعد ربطها ستظهر صفحة تهيئة المنصة.
- أدخل بيانات مدير النظام ومفتاح `MZJ_SETUP_KEY`.
- المنصة تنشئ الجداول والإعدادات الأساسية وأول حساب إداري ثم تسجل دخوله تلقائيًا.

## ملاحظات

- `database/seed.sql` يحتوي على الفروع والأقسام والأدوار الأساسية فقط، ولا ينشئ أي مستخدم أو بيانات عملاء أو سيارات.
- لا تضع `DATABASE_URL` أو `MZJ_SETUP_KEY` داخل GitHub. ضعها في Vercel Environment Variables فقط.

## v1.2.1 Vercel TypeScript fix

- All relative imports inside `api/` use explicit `.js` extensions for Vercel's NodeNext compilation.
- `tsconfig.node.json` now uses `module` and `moduleResolution` set to `NodeNext` so the same class of error is caught before deployment.
- The build runs an API import validation before TypeScript and Vite.
- The SPA rewrite excludes `/api/` routes.
