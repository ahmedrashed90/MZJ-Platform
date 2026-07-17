# MZJ Integration Gateway

الـGateway العام مسؤول عن Facebook وInstagram وTikTok والاستيرادات فقط.

واتساب/مرسال غير موجود هنا؛ له Worker مستقل داخل `mersal-crm-worker` حتى لا يوجد أكثر من مسار إرسال أو استقبال لنفس القناة.

## المتغيرات الأساسية

- `PLATFORM_API_BASE_URL=https://YOUR-DOMAIN/api`
- Secret باسم `GATEWAY_SECRET` ويطابق `MZJ_GATEWAY_SECRET` في Vercel.
- Secret منفصل لكل مصدر وارد.
