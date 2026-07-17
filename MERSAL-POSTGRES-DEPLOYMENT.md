# Mersal / PostgreSQL deployment

## المشكلة التي تم إصلاحها

1. كان الوركر يعتبر الإرسال ناجحًا أو فاشلًا من HTTP فقط. مرسال قد يعيد دليل قبول مثل `message_wamid` حتى عندما تكون حالة HTTP غير ناجحة، فتصل الرسالة ويظهر داخل CRM «فشل الإرسال».
2. كان `/webhook/mersal` يكتب الرد داخل Firestore فقط. لذلك رد العميل من الهاتف لا يدخل PostgreSQL ولا يظهر في المنصة الموحدة.

## المسار النهائي

- المنصة ترسل إلى: `https://mersal-crm.next-erp-mzj.workers.dev/send/mersal`
- مرسال يرسل Webhook إلى: `https://mersal-crm.next-erp-mzj.workers.dev/webhook/mersal`
- الوركر يرسل الرسالة الواردة إلى: `https://mzj-platform.vercel.app/api/integrations/whatsapp`
- الصور والصوت والفيديو وPDF الواردة تُرفع إلى R2 عبر: `https://mzj-platform.vercel.app/api/integrations/media`
- المحادثات والرسائل والـUnread والـJobs تُحفظ في PostgreSQL فقط.

## Cloudflare Worker secrets

```bash
cd mersal-crm-worker
wrangler secret put MZJ_GATEWAY_SECRET
wrangler secret put MERSAL_TOKEN
wrangler secret put MERSAL_API_TOKEN
wrangler deploy
```

`MZJ_GATEWAY_SECRET` يجب أن تكون نفس القيمة الموجودة في Vercel.

## إعدادات CRM

داخل الإعدادات ← إعدادات CRM ← Endpoints / Workers، اختار المصدر `واتساب` واضبط:

- إرسال النص والقوالب: `https://mersal-crm.next-erp-mzj.workers.dev/send/mersal`
- مزامنة القوالب: `https://mersal-crm.next-erp-mzj.workers.dev/templates/mersal`
- استقبال Webhook: `https://mersal-crm.next-erp-mzj.workers.dev/webhook/mersal`
- اسم متغير السر: `MZJ_GATEWAY_SECRET`

لا توجد مسارات احتياطية أو أسماء مصادر بديلة لواتساب.
