# MZJ Platform v1.9.4 — Worker Route Discovery

## سبب الإصدار
استجابة الإرسال كانت `404 Not found` من Worker لأن الرابط المنشور قد يكون واحدًا من ثلاثة أشكال مستخدمة في المشروع:

- Worker مرسال الفعلي: `/send/mersal`
- Mersal Transport Gateway v2: `/outbound/whatsapp/v1/text` و`/template` و`/media`
- Multi-channel Gateway: `/send/whatsapp`

## التعديل
- المنصة تبدأ بالمسار المحفوظ في الإعدادات.
- عند `404/405 Not found` فقط، تجرب المسارات المعروفة الأخرى على نفس Origin.
- لا تعيد المحاولة على أخطاء التوكن أو الصلاحيات أو أخطاء مرسال حتى لا تخفي السبب الحقيقي.
- القوالب ترسل `params` و`components` للتوافق مع كل نسخ الـWorker.
- رد API عند الفشل يعرض `workerRoute` و`workerAttempts` بدون أي أسرار.

## الاختبارات
- TypeScript.
- فحوص CRM السابقة.
- فحص Route Discovery v1.9.4.
- Production build.
- فك ZIP في مجلد نظيف ثم npm ci وbuild.
