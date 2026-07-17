# بنية إرسال واستقبال CRM — PostgreSQL فقط

## المقارنة مع MZJ-CRM-main (19)

### النظام القديم

- المتصفح كان يرسل مباشرة إلى `/send/mersal`.
- بعد الإرسال كان المتصفح يكتب الرسالة في `wa_conversations` ويحدث العميل.
- الاستقبال والـUnread كانا يعتمدان على listeners ومجموعات المحادثات في قاعدة النظام القديمة.
- منطق الواجهة كان يقبل عدة أسماء للحقول ومسارات وترتيبات مختلفة للرسائل والوسائط.

### النسخة النظيفة v1.12.0

- المتصفح لا يتصل بمرسال مباشرة.
- API المنصة ينشئ الرسالة و`integrations.outbound_jobs` في PostgreSQL أولًا.
- API يستدعي Endpoint واحدًا مسجلًا في `crm.integration_endpoints.send_url`.
- الوركر يرسل إلى Endpoint مرسال المطابق لنوع الطلب، ثم يحدث Job والرسالة في PostgreSQL.
- مرسال يرسل إلى `/webhook/mersal`، والوركر يوحد الحدث ويرسله إلى `/api/integrations/whatsapp`.
- `integrations.inbound_events` و`crm.messages.provider_message_id` يمنعان معالجة الرسالة نفسها مرتين.
- الوسائط الواردة تنتقل إلى R2، وتخزن بياناتها في `crm.media_assets` و`crm.messages`.

## مصادر الحقيقة

- بيانات العملاء والمحادثات والرسائل والحالات والـUnread والوظائف: PostgreSQL.
- ملفات الصور والصوت والفيديو وPDF: R2، مع المفاتيح والبيانات الوصفية في PostgreSQL.
- مسار الإرسال ومزامنة القوالب والاستقبال واسم السر: صف المصدر في `crm.integration_endpoints`.
- لا توجد متغيرات Vercel لتجاوز رابط الوركر، ولا يوجد مسار تخزين ثانٍ.

## إعداد واتساب/مرسال داخل CRM

صف `source_code = whatsapp` يجب أن يحتوي على:

- `send_url`: ينتهي بـ `/send/mersal`.
- `templates_sync_url`: ينتهي بـ `/templates/mersal`.
- `inbound_webhook_url`: ينتهي بـ `/webhook/mersal`.
- `secret_name`: اسم متغير السر الموجود في Vercel، مثل `MZJ_GATEWAY_SECRET`.

## ترتيب الإرسال

1. التحقق من المحادثة والقناة والصلاحيات.
2. إنشاء Job ورسالة بحالة `queued` داخل معاملة PostgreSQL المنطقية.
3. إرسال الطلب للوركر المحدد فقط.
4. تحديث Job والرسالة إلى `sent` أو `failed` بناءً على رد الوركر.

## ترتيب الاستقبال

1. استخراج Message ID ورقم العميل من Webhook مرسال.
2. عند وجود وسائط: حل الرابط، تنزيل الملف، رفعه إلى R2.
3. إرسال الحدث الموحّد للمنصة مع `x-event-id`.
4. إدخال `integrations.inbound_events` مرة واحدة.
5. ربط/إنشاء المحادثة في PostgreSQL وإضافة الرسالة مرة واحدة.
6. تحديث Preview وUnread ووقت آخر رسالة وتشغيل الأتمتة.
