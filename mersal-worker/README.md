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
