# MZJ Integration Gateway v1.12.0

وركر النقل الخاص بالمنصة الموحدة. لا يحفظ بيانات CRM؛ الحفظ الوحيد في PostgreSQL داخل المنصة، والوسائط تحفظ في R2.

## مسارات مرسال الثابتة

- `POST /send/mersal`: إرسال النص الحر أو القالب أو الوسائط.
- `POST /webhook/mersal`: استقبال رسائل العملاء من مرسال.
- `POST /templates/mersal`: سحب القوالب المعتمدة.
- `GET /`: فحص حالة الوركر وعرض المسارات الفعالة.

لا توجد أسماء بديلة لمسارات واتساب، ولا اختيار تلقائي لرابط إرسال آخر.

## عقد الإرسال من المنصة إلى الوركر

### نص حر

```json
{
  "type": "text",
  "phone": "9665XXXXXXXX",
  "template_name": "",
  "message": "نص الرسالة"
}
```

### قالب

```json
{
  "type": "template",
  "phone": "9665XXXXXXXX",
  "template_name": "approved_template_name",
  "template_language": "ar",
  "components": []
}
```

### وسائط

```json
{
  "type": "media",
  "phone": "9665XXXXXXXX",
  "template_name": "",
  "media_url": "https://signed-r2-url.example/file",
  "media_type": "image",
  "file_name": "file.jpg",
  "caption": ""
}
```

الوركر يرفض أي نوع غير `text` أو `template` أو `media`، ويرفض خلط اسم قالب مع النص الحر أو الوسائط.

## متغيرات Cloudflare Worker

المتغيرات العامة موضحة في `wrangler.toml` و`.dev.vars.example`. الأسرار الإلزامية:

- `GATEWAY_SECRET`: يطابق قيمة متغير Vercel المسجل اسمه في إعدادات Endpoint.
- `MERSAL_TOKEN`: إرسال النص والقالب والوسائط.
- `MERSAL_API_TOKEN`: قراءة محادثات ورسائل مرسال وحل روابط الوسائط ومزامنة القوالب.

يجب ضبط `MERSAL_TEMPLATES_URL` على Endpoint القوالب المعتمدة الخاص بحساب مرسال.

## استقبال الوسائط

1. يستقبل الوركر رسالة مرسال بالـMessage ID الأصلي.
2. يحل رابط الوسائط من مرسال عند كون الرابط محميًا أو غير موجود في الـWebhook.
3. ينقل الملف إلى R2 بحد أقصى 50MB.
4. يرسل الحدث إلى `/api/integrations/whatsapp` مع `storageKey`.
5. المنصة تسجل الرسالة والوسيط في PostgreSQL مرة واحدة باستخدام هوية الرسالة الأصلية.
