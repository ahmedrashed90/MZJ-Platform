# تشغيل ونشر إعادة بناء نظام التسويق Native v2.0

## 1. النسخة الأساسية

هذه النسخة مبنية داخل سورس منصة MZJ الموحدة. نظام التسويق يستخدم تسجيل الدخول والمستخدمين والصلاحيات وواجهة المنصة، ويستخدم PostgreSQL وواجهة API الموحدة `/api/marketing`.

## 2. متغيرات البيئة المطلوبة

اضبط متغيرات المنصة المعتادة، وأهمها:

```env
DATABASE_URL=
MZJ_SETUP_KEY=

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

رفع ملفات Task Template والملفات النهائية وملفات نتائج الحملات يحتاج إعداد R2.

إنشاء فولدرات الخام والتسليم على السيرفر اختياري ويحتاج:

```env
MZJ_RAW_API_URL=
MZJ_RAW_API_KEY=
```

`MZJ_RAW_API_KEY` يبقى في بيئة السيرفر فقط ولا يُرسل إلى المتصفح.

## 3. قاعدة البيانات

ملف إعادة البناء النهائي:

```text
database/migrations/20260723_marketing_native_rebuild_v200.sql
```

الملف يعيد إنشاء **Schema التسويق فقط** باسم `marketing`، ولا يحذف جداول CRM أو التراكينج أو العمليات. قبل تشغيله على قاعدة تحتوي بيانات تسويق سابقة، خذ نسخة احتياطية من Schema `marketing` لأن الملف يحذف التنفيذ السابق للتسويق ثم ينشئ المخطط الجديد النظيف.

تشغيل SQL يدويًا:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/20260723_marketing_native_rebuild_v200.sql
```

كما أن تهيئة المنصة عبر `/api/setup/initialize` تستدعي `ensureMarketingSchema()`، وواجهة `/api/marketing` تتحقق من إصدار Schema قبل الاستخدام.

## 4. التثبيت والفحص والبناء

استخدم Node.js 22 وpnpm 9.15.9:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

التحقق الخاص بإعادة بناء التسويق يعمل ضمن `typecheck` ويمكن تشغيله منفردًا:

```bash
node scripts/check-marketing-native-v200.mjs
```

## 5. النشر

بعد نجاح `pnpm run build`:

```bash
vercel --prod
```

أو انشر من مشروع Vercel المرتبط بالمستودع بعد إضافة متغيرات البيئة السابقة.

## 6. الربط المشترك لطلبات التصوير

طلبات التصوير تُحفظ كسجل واحد داخل جداول العمليات:

```text
operations.photography_requests
operations.photography_request_vehicles
```

وتظهر من المصدر نفسه في:

- التسويق ← الاستوك / متابعة الطلبات.
- العمليات ← طلبات النقل ← طلبات التصوير.

لا توجد نسخة مستقلة من طلب التصوير داخل Schema التسويق.
