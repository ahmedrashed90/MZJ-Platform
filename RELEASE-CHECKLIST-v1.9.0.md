# MZJ Platform v1.9.0 Release Checklist

## قبل الرفع

- احتفظ بنسخة قاعدة بيانات قبل تطبيق Migration v1.9.
- أضف في Vercel: `DATABASE_URL`, `MZJ_SETUP_KEY`, `MZJ_GATEWAY_SECRET`, `AUTOMATION_SCHEDULER_SECRET`.
- أضف بيانات R2 الخاصة: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- لا تضف `MERSAL_TOKEN` داخل Vercel.

## Cloudflare Worker

- ارفع `workers/MZJ-WhatsApp-Mersal-Gateway-v2.0.0-FULL.txt` كاملًا.
- أضف: `MZJ_GATEWAY_SECRET`, `MERSAL_TOKEN`, `MZJ_PLATFORM_URL`.
- أضف `MERSAL_API_TOKEN` إذا كان مختلفًا عن توكن الإرسال.
- اختبر `/health` و`/env-check`.
- لا تغيّر Webhook مرسال قبل نجاح اختبارات المنصة والوسائط.

## إعداد Endpoint واتساب في المنصة

- Text URL: `https://WORKER/outbound/whatsapp/v1/text`
- Template URL: `https://WORKER/outbound/whatsapp/v1/template`
- Media URL: `https://WORKER/outbound/whatsapp/v1/media`
- Templates Sync URL: `https://WORKER/templates/mersal/v1/sync`
- Inbound Webhook URL: `https://WORKER/webhooks/mersal/v1/messages`
- Health URL: `https://WORKER/health`
- Secret name: `MZJ_GATEWAY_SECRET`

## اختبارات الاعتماد

- رسالة عميل جديدة: تُحفظ بدون ليد، وتصل رسالة اختيار الخدمة مرة واحدة.
- اختيار كاش/تمويل/خدمة العملاء: ينشأ طلب واحد ويتم التوزيع داخليًا بدون سؤال الفرع.
- رسالة ثانية وبعد يومين: تدخل نفس المحادثة ولا تكرر العميل أو الطلب المفتوح.
- حالة نهائية: يغلق الطلب، والعودة التالية تبدأ اختيار خدمة جديد لنفس Contact.
- وكيل صندوق الوارد يتوقف عند رد بشري ويصعّد حسب الإعدادات عند عدم الرد.
- نقل عميل يسجل المسؤول السابق والجديد والسبب والمنفذ.
- القالب المرتبط بالحالة يظهر داخل مكان الكتابة، ولا يرسل قبل استكمال المتغيرات.
- استقبال وإرسال: صورة، صوت، فيديو، وPDF، مع فتح وتحميل بصلاحية.
- العميل يسار، ومستخدم CRM/الوكيل يمين.

## الانتقال النهائي

1. ارفع المنصة وشغّل Migration وتأكد من صفحات CRM.
2. ارفع Worker الجديد واختبر الإرسال والقوالب والوسائط بدون تغيير Webhook.
3. اضبط Endpoints الجديدة داخل المنصة.
4. نفذ اختبارًا فعليًا على رقم تجريبي.
5. غيّر Webhook مرسال للمسار الجديد بعد نجاح جميع الاختبارات فقط.
