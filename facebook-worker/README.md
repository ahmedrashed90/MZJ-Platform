# MZJ Facebook Worker v2

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
