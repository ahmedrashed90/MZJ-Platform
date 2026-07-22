# MZJ Facebook Automation Transport v1.18.0

هذا الـWorker مسؤول عن النقل التقني فقط. إعدادات الأوتوميشن، الجلسات، الأسئلة، إنشاء العميل، والتوزيع موجودة داخل منصة MZJ.

## المسارات

- `GET /` و`GET /health`
- `GET/POST /meta/webhook` مع المسارات البديلة القديمة
- `POST /automation` مسار توافق قديم؛ يستقبل الطلب ويؤجله دائمًا إلى Meta Webhook حتى لا يعمل فلو ManyChat بالتوازي
- `POST /send/facebook` مع المسارات البديلة القديمة

## الأسرار المطلوبة

- `MZJ_GATEWAY_SECRET`
- `FB_VERIFY_TOKEN`
- `FB_APP_SECRET`
- `FB_PAGE_ACCESS_TOKEN`

## متغيرات مطلوبة أو موصى بها

- `PLATFORM_INBOUND_URL`
- `FB_PAGE_ID`
- `MANYCHAT_API_TOKEN` اختياري كـfallback للنصوص
- `MANYCHAT_WEBHOOK_SECRET` اختياري لحماية `/automation`
- `PLATFORM_MEDIA_URL` اختياري، وإلا يُشتق من رابط المنصة
- `FACEBOOK_SEND_IDEMPOTENCY_KV` موصى به لمنع إعادة إرسال نفس الطلب للعميل عند إعادة المحاولة
- `DEBUG_KV` اختياري للتشخيص، ويعمل كـfallback لمنع تكرار الإرسال عند عدم ربط KV مستقل

## النشر

```bash
cd facebook-worker
pnpm install
pnpm run check
wrangler secret put MZJ_GATEWAY_SECRET
wrangler secret put FB_VERIFY_TOKEN
wrangler secret put FB_APP_SECRET
wrangler secret put FB_PAGE_ACCESS_TOKEN
wrangler deploy
```

بعد النشر، حدّث Worker الخاص بمنصة Facebook من **إعدادات CRM → إعدادات الأوتوميشن → المنصات والـWorkers** ثم نفّذ Health Check.
