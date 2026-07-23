# نشر دمج التسويق داخل منصة MZJ

## 1. النسخ الاحتياطي

1. خذ Backup كامل من PostgreSQL.
2. احفظ Environment Variables الحالية في Vercel/Cloudflare بدون وضعها داخل السورس.
3. نفذ النشر أولًا على Preview/Staging.

## 2. تثبيت الاعتمادات والفحص

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

يجب عدم النشر إذا فشل أي Check موجود للـCRM أو العمليات أو التراكينج أو التسويق.

## 3. قاعدة البيانات

نفذ بالترتيب:

```text
database/migrations/20260723_marketing_native_phase1.sql
database/migrations/20260723_marketing_publisher_runtime.sql
database/migrations/20260723_marketing_publish_reconciliation.sql
```

الـMigrations إضافية داخل `marketing` فقط، مع إضافة Permissions/Seeds مركزية للتسويق. لا تنفذ ALTER يدويًا داخل CRM أو `operations` أو `tracking`.

## 4. Environment Variables

أضف القيم المطلوبة من `.env.example`، وأهمها:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
MARKETING_TOKEN_ENCRYPTION_KEY
MARKETING_PUBLIC_BASE_URL
MARKETING_AUTO_PUBLISH_ENABLED
TIKTOK_MARKETING_*
SNAPCHAT_MARKETING_*
MERSAL_MARKETING_*
```

لا تفعل OAuth أو Auto Publish قبل توفير المفاتيح ومراجعة Redirect URIs وCapabilities.

## 5. إعداد CORS لتخزين R2

رفع Task Template والملفات النهائية يتم من المتصفح مباشرة إلى R2 باستخدام Presigned PUT. أضف دومين المنصة ودومين Preview المسموح إلى CORS الخاص بالـBucket، مع السماح بـ:

```text
Methods: PUT, GET, HEAD
Headers: Content-Type
Expose headers: ETag
```

لا تستخدم `*` في الإنتاج إذا كانت الدومينات النهائية معروفة.

## 6. التحقق بعد النشر

- تسجيل الدخول والخروج.
- الداش بورد الموحدة.
- CRM والعمليات والتراكينج.
- ظهور التسويق حسب الصلاحية.
- إنشاء حملة اختبار 5 خطوات.
- إنشاء أجندة اختبار 3 خطوات.
- التحقق من Pair Tasks وعدم فتح مهمة غير مرتبطة بعد اعتماد Template.
- رفع Task Template فعلي وفتحه من رابط تنزيل محمي.
- رفع ملف نهائي والتأكد من منع إنهاء المهمة بدونه.
- التحقق من Publish Prep وتقويم النشر بدون تكرار الجدول الأصلي.
- الحضور والاستوك Read-only والباقات والتقارير.
- الصفحات العامة لـMZJ Publish بدون Login.

## 7. Local Publisher Agent

1. يسجل الأدمن جهازًا من صفحة النشر المحلي ويحصل على Device Token مرة واحدة.
2. يخزن التوكن على الجهاز فقط.
3. يحدد مجلد الأجندة ويشغل Agent.
4. Agent يرسل Metadata/Plan إلى `agent-runtime` عبر HTTPS.

النسخة الحالية من Agent تنفذ التسجيل والـHeartbeat ومسح المجلد واستيراد الخطة والـJob lease والنتيجة/الفشل. رفع وسائط Agent الكبيرة واستدعاء Platform Adapters للنشر الفعلي ما زالا بحاجة إلى التوصيل والاختبار باستخدام حسابات المنصات الحقيقية.

## 8. Cutover بيانات Firebase القديمة

لم يتم تنفيذ Migration تاريخية تلقائية. عند توفر Export فعلي، يجب تنفيذ Dry Run، Mapping لليوزرات والأقسام، ثم Import مرة واحدة بدون Dual Write.
