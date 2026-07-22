# خطوات نشر MZJ CRM Automation v1.18.0

## أولًا: نسخة احتياطية

قبل النشر خذ نسخة احتياطية من PostgreSQL ومن إعدادات Vercel وCloudflare Worker الحالية.

## ثانيًا: نشر المنصة على Vercel

1. ارفع سورس المنصة النهائي.
2. تأكد من وجود متغيرات البيئة الحالية، خصوصًا اتصال PostgreSQL وأسرار بوابة الـWorkers.
3. نفّذ التثبيت والبناء:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

4. انشر على Vercel.
5. الـMigration مدمجة داخل `ensureCrmSchema` وتعمل مرة واحدة باستخدام `core.schema_migrations`.
6. يمكن بدلًا من ذلك تنفيذ ملف Migration يدويًا قبل النشر، وهو Idempotent؛ لا تعدّل الـSchema من API وقت التشغيل.
7. شغّل ملف التحقق:

```text
database/verification/20260722_crm_automation_v1180_postcheck.sql
```

## ثالثًا: نشر Facebook Worker على Cloudflare

```bash
cd facebook-worker
pnpm install
pnpm run check
```

أضف الأسرار:

```bash
wrangler secret put MZJ_GATEWAY_SECRET
wrangler secret put FB_VERIFY_TOKEN
wrangler secret put FB_APP_SECRET
wrangler secret put FB_PAGE_ACCESS_TOKEN
```

اختياري:

```bash
wrangler secret put MANYCHAT_API_TOKEN
wrangler secret put MANYCHAT_WEBHOOK_SECRET
```

أنشئ Cloudflare KV Namespace لمنع تكرار الإرسال واربطه باسم:

```text
FACEBOOK_SEND_IDEMPOTENCY_KV
```

ثم انشر:

```bash
wrangler deploy
```

## رابعًا: ربط Meta

- Callback URL: `https://<facebook-worker-domain>/meta/webhook`
- Verify Token: نفس قيمة `FB_VERIFY_TOKEN`.
- اشترك في Messenger message events المطلوبة.
- لا تستخدم ManyChat Automation كفلو استقبال موازٍ؛ Route `/automation` أصبح للتوافق ويؤجل الحدث إلى Meta Webhook.

## خامسًا: ربط Worker داخل المنصة

من:

`إعدادات CRM → ربط المنصات والـWorkers`

اضبط Facebook Worker بحيث يكون:

- كود المنصة/المصدر: `facebook`
- Text Send URL: `https://<facebook-worker-domain>/send/facebook`
- Media Send URL: نفس المسار أو المسار المعتمد.
- Health URL: `https://<facebook-worker-domain>/health`
- Secret Name: اسم متغير سر البوابة الموجود في Vercel.

ثم من:

`إعدادات CRM → إعدادات الأوتوميشن → المنصات والـWorkers`

- فعّل Facebook.
- اختر Worker `facebook`.
- نفّذ Health Check.

## سادسًا: اختبارات القبول الحية

1. رسالة جديدة ثم كاش، ومراجعة إنشاء الطلب والتوزيع والرسالة النهائية.
2. رسالة جديدة ثم تمويل، ثم الاسم والسيارة والجوال الصحيح، ومراجعة مندوب التمويل والكول سنتر.
3. جوال خاطئ ثم صحيح، والتأكد من بقاء الجلسة في نفس الخطوة.
4. رسالة جديدة ثم خدمة العملاء، ومراجعة التوزيع.
5. إعادة نفس Webhook والتأكد من عدم تكرار الرسالة أو العميل أو التوزيع.
6. إرسال طلب الإرسال نفسه للـWorker مرتين بنفس Idempotency Key والتأكد من وجود Graph Call واحدة.
7. تجربة سياسات التشغيل الثلاث.
8. مراجعة جداول الجلسات والأحداث والرسائل والإجراءات النهائية باستخدام ملف Post-check.
