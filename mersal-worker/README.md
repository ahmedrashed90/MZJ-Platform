# MZJ Mersal Worker

الوركر الوحيد لواتساب في المنصة الموحدة.

## المسارات

- `POST /send/mersal`: النص الحر والقالب والوسائط.
- `POST /webhook/mersal`: استقبال رد العميل وتحويله مباشرة إلى PostgreSQL من خلال `PLATFORM_INBOUND_URL`.
- `GET /debug/last`: آخر Webhook وآخر نتيجة تحويل عند ربط `DEBUG_KV`.

## Secrets

```bash
wrangler secret put MZJ_GATEWAY_SECRET
wrangler secret put MERSAL_TOKEN
wrangler secret put MERSAL_API_TOKEN
```

قيمة `MZJ_GATEWAY_SECRET` يجب أن تطابق نفس المتغير داخل Vercel.

لا يحتوي هذا الوركر على Firebase أو Firestore ولا يحفظ CRM داخله.


## v1.12.3

Every recognized service button is forwarded as a trusted explicit reclassification instruction. The platform keeps the same contact and message history, closes the previous open request only when the selected service changes, then creates and redistributes the new request.
