# MZJ Integration Gateway

Worker مركزي لاستقبال Webhooks وإرسال رسائل CRM، ويعمل كذلك كبوابة Streaming لملفات Zoho WorkDrive.

## المتغيرات الأساسية

- `PLATFORM_API_BASE_URL=https://mzj-platform.vercel.app/api`
- Secret باسم `GATEWAY_SECRET` ويطابق `MZJ_GATEWAY_SECRET` في Vercel.
- `INBOUND_SHARED_SECRET` أو Secret منفصل لكل مصدر مثل `INSTAGRAM_WEBHOOK_SECRET`.

## Zoho WorkDrive

المسارات المضافة:

- `POST /zoho/upload-part?ticket=...`: يستقبل أجزاء 20MB ويحفظها مؤقتًا في R2.
- `POST /zoho/upload-finalize?ticket=...`: يجمع الأجزاء كـStream إلى Zoho ثم يحذفها من R2.
- `POST /zoho/upload?ticket=...`: مسار توافق للملفات الصغيرة فقط، وليس المسار الأساسي في واجهة المنصة.
- `GET /zoho/media/:fileId?ticket=...`: يقدم رابطًا مؤقتًا للملف الخاص وقت التنزيل أو النشر.

لا يتم تخزين Zoho Access Token داخل الـWorker. كل عملية تطلب Token قصير المدة من Vercel عبر مسار داخلي محمي بـ`GATEWAY_SECRET`.

## Facebook

- `FB_VERIFY_TOKEN`
- `FB_APP_SECRET`
- `FB_PAGE_ACCESS_TOKEN`
- `MANYCHAT_FACEBOOK_TOKEN` أو `MANYCHAT_API_TOKEN`

## Instagram

- `INSTAGRAM_WEBHOOK_SECRET`
- `MANYCHAT_INSTAGRAM_TOKEN` أو `MANYCHAT_API_TOKEN`

## TikTok

- `TIKTOK_WEBHOOK_SECRET`
- `MANYCHAT_TIKTOK_TOKEN` أو `MANYCHAT_API_KEY`
- `MANYCHAT_MESSAGE_FIELD_ID`
- `MANYCHAT_TRIGGER_TAG_ID`

## Imports

- `TIKTOK_SNAPCHAT_WEBHOOK_SECRET`
- `INSTALLMENT_CALCULATOR_WEBHOOK_SECRET`

## WhatsApp / Mersal

واتساب لا يمر من هذا الـGateway. استخدم الوركر المستقل داخل `mersal-worker/` بالمسارين `/send/mersal` و`/webhook/mersal`.

### رفع الملفات الكبيرة بدون حد 100MB

واجهة المنصة تقسم كل ملف إلى أجزاء 20MB. الـWorker يحفظ الأجزاء مؤقتًا في R2 ثم يجمعها كـStream إلى Zoho ويحذفها فور اكتمال الرفع. لذلك يجب إضافة R2 binding باسم:

```toml
[[r2_buckets]]
binding = "ZOHO_UPLOAD_STAGING"
bucket_name = "mzj-zoho-upload-staging"
```

يمكن استخدام Bucket منفصل فارغ؛ الملفات داخله مؤقتة فقط. المساران المستخدمان من الواجهة هما:

- `POST /zoho/upload-part?ticket=...&partNumber=...&totalParts=...`
- `POST /zoho/upload-finalize?ticket=...&totalParts=...`
