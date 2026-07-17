# MZJ Unified Platform v1.12.0

نسخة React نظيفة للمنصة الموحدة، مع CRM يعمل على PostgreSQL فقط وتخزين وسائط CRM في Cloudflare R2.

## تشغيل المشروع

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm run dev
```

Node.js المطلوب: `22.x`، وPackage Manager: `pnpm@9.15.9`.

## إعداد Vercel

انسخ القيم المطلوبة من `.env.example`. أهمها:

- `DATABASE_URL`
- `MZJ_SETUP_KEY`
- `MZJ_GATEWAY_SECRET`
- إعدادات R2 الأربعة

روابط الـWorkers لا تقرأ من Environment Variables؛ تدار من صفحة إعدادات CRM وتخزن في PostgreSQL.

## واتساب / مرسال

المسارات المعتمدة:

- إرسال: `/send/mersal`
- استقبال: `/webhook/mersal`
- مزامنة قوالب: `/templates/mersal`

تفاصيل العقد والتدفق موجودة في:

- `MESSAGING-ARCHITECTURE.md`
- `gateway-worker/README.md`
- `RELEASE-CHECKLIST-v1.12.0.md`

## قاعدة البيانات

يتم إنشاء وتحديث مخطط CRM من `server/_crm-schema.ts`. الرسائل الواردة محمية من التكرار بواسطة:

- Unique Event: `integrations.inbound_events(source, event_key)`
- Unique Message: `crm.messages(conversation_id, provider_message_id)`

## الوسائط

- الرسائل الواردة: الوركر ينقل الملف إلى R2 ثم يرسل `storageKey` للمنصة.
- الرسائل الصادرة: المنصة تنشئ Signed URL مؤقتًا من R2 ويرسله الوركر لمرسال.
- الحد الأقصى للملف: 50MB.
