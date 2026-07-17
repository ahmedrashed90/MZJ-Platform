# MZJ Mersal CRM Worker

الوركر الوحيد المسؤول عن واتساب/مرسال في المنصة الموحدة.

## المسارات

- `POST /send/mersal`: إرسال النص أو القالب أو الوسائط.
- `POST /webhook/mersal`: استقبال رسائل العميل وإرسالها مباشرة إلى PostgreSQL عبر API المنصة.
- `POST /templates/mersal`: مزامنة قوالب مرسال.
- `GET /debug/last`: آخر Webhook عند ربط `DEBUG_KV`.

## الأسرار المطلوبة

```bash
wrangler secret put MZJ_GATEWAY_SECRET
wrangler secret put MERSAL_TOKEN
wrangler secret put MERSAL_API_TOKEN
```

قيمة `MZJ_GATEWAY_SECRET` يجب أن تطابق المتغير نفسه في Vercel.

لا يحتوي الوركر على Firebase أو Firestore، ولا يكتب بيانات CRM بنفسه. كل المحادثات والرسائل والحالات تُحفظ في PostgreSQL داخل المنصة.
