# MZJ Platform

منصة React موحدة لمجموعة محمد بن ذعار العجمي، جاهزة للرفع على Vercel.

## ملاحظات مهمة

- لا توجد أسماء أو أرقام افتراضية داخل الواجهة.
- عند عدم ربط PostgreSQL تظهر شرطات ورسالة توضح عدم الاتصال.
- الداش بورد بعرض الصفحة كاملًا بعد خصم السايد بار فقط.
- كروت سيستم العمليات لا تحتوي على زر حذف.
- جميع الأرقام وأزرار «عرض» تفتح التفاصيل.

## التشغيل

```bash
npm install
npm run dev
```

## قاعدة البيانات

1. أنشئ PostgreSQL على Neon أو Vercel Postgres.
2. نفّذ الملف `database/schema.sql`.
3. نفّذ الملف `database/seed.sql` لإضافة الفروع والأقسام والأدوار الأساسية بدون إنشاء أي مستخدم وهمي.
4. أضف `DATABASE_URL` في Environment Variables على Vercel.

## Vercel

- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

## Vercel deployment
- Node.js: 22.x
- Install: `npm ci --registry=https://registry.npmjs.org/`
- Build: `npm run build`
- Output: `dist`
