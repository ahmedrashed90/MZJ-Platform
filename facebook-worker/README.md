# MZJ Facebook Worker v2.0.4

Worker تقني فقط لاستقبال وإرسال Facebook Messenger. لا يحتوي على رسائل أو اختيارات أو أسئلة أو توزيع؛ منصة MZJ هي المصدر الوحيد لإعدادات الأوتوميشن.

## Secrets
- `MZJ_GATEWAY_SECRET`
- `FB_VERIFY_TOKEN`
- `FB_PAGE_ACCESS_TOKEN`
- `FB_APP_SECRET` (موصى به)
- `MANYCHAT_API_TOKEN` (Fallback اختياري للنص)
- `MANYCHAT_WEBHOOK_SECRET` (اختياري لمسار التوافق)

## Routes
- `GET /` و`GET /health`
- `GET/POST /meta/webhook` مع aliases القديمة
- `POST /automation` كتوافق نقل تقني فقط
- `POST /send/facebook` مع aliases القديمة

## Social chat identity
- الـPSID الحقيقي فقط هو هوية Messenger القابلة للإرسال.
- Social comment/like IDs لا تُعامل كـPSID.
- لو العميل جاي من Facebook Comment ولسه مفيش PSID، أول رسالة نصية تستخدم Facebook Private Replies على `commentId`؛ بعد رد العميل يتم اعتماد PSID الحقيقي من Messenger webhook.
- عند وصول هوية Messenger الحقيقية يتم ربطها بنفس العميل/المحادثة في المنصة.
- النسخة المستقلة المطابقة: `workers/MZJ-Facebook-Worker-v2.0.4-FULL.js`.

## Provider-confirmed manual send
- الإرسال اليدوي من CRM ينتظر رد الـWorker بدل إرجاع queued قبل معرفة النتيجة.
- Facebook Graph يرسل افتراضيًا إلى `/{PAGE_ID}/messages` ويعيد خطأ Meta الحقيقي عند الرفض.
- أي Social Lead غير مربوط بـPSID حقيقي لا يتم إرسال Social Actor ID له على أنه PSID.
