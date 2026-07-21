# MZJ Integration Gateway

Worker مركزي واحد لاستقبال Webhooks وإرسال رسائل CRM.

## المتغيرات الأساسية

- `PLATFORM_API_BASE_URL=https://YOUR-DOMAIN/api`
- Secret باسم `GATEWAY_SECRET` ويطابق `MZJ_GATEWAY_SECRET` في Vercel.
- `INBOUND_SHARED_SECRET` أو Secret منفصل لكل مصدر مثل `INSTAGRAM_WEBHOOK_SECRET`.

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
