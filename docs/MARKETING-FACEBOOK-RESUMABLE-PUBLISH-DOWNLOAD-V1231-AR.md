# Facebook Reel Binary Upload + تنزيل الملفات النهائية — V1231

## نطاق العمل
تم تنفيذ التعديل على السورس `MZJ-Platform-v1.20.7-MULTI-FIRST-FINAL-FILES-FIX(1)` مباشرة، بدون تطبيق Patch على نسخة معدلة أخرى.

## 1) إصلاح Facebook Error 422 في Reel

### السبب في المسار السابق
مسار Reel كان يبدأ جلسة الرفع من Meta ثم يرسل رابط الملف في Header باسم `file_url` إلى `upload_url`.
عند وجود الملف النهائي على Zoho WorkDrive يكون رابط التنزيل محميًا ويحتاج `Zoho-oauthtoken`، لذلك لا يمكن لخوادم Meta تنزيل الفيديو من الرابط بنفسها.

### المسار الجديد
تم إنشاء خدمة مستقلة:

- `server/_facebook-video-publisher.ts`

وتعمل كالتالي:

1. تبدأ جلسة Facebook Reel أو Video Story عبر Graph API.
2. تنزل الفيديو داخل Backend من Zoho باستخدام OAuth أو من R2 عبر الرابط الموقّع.
3. تمرر Bytes الفيديو مباشرة إلى `upload_url` الذي أعادته Meta.
4. يرسل الرفع إلى Meta بالـheaders المطلوبة: `Authorization`, `offset=0`, `file_size` و`application/octet-stream`.
5. بعد اكتمال الرفع يتم تنفيذ مرحلة `finish` والنشر.
6. لا يتم استخدام `file_url` في مسار Reel أو Video Story الجديد.

### تفاصيل الأخطاء
رسائل Meta لم تعد تختصر إلى `(422)` فقط. عند توفر البيانات يتم الاحتفاظ بـ:

- HTTP status
- Meta error code
- Meta error subcode
- Error type
- `fbtrace_id`
- `error_user_msg` / `error_user_title`

وبالتالي تظهر نفس التفاصيل في نتيجة تجهيز النشر وسجل فشل النشر.

## 2) زر تنزيل الملف النهائي في تجهيز النشر

في صفحة:

- `/marketing/publish-prep`

تم إضافة زر واضح داخل خانة **الملف النهائي**:

- ملف واحد: `تحميل الملف`
- أكثر من ملف: `تحميل الملفات`

عند وجود عدة ملفات، يتم بدء تنزيل كل ملف كتنزيل مستقل من المتصفح، بدون إنشاء ZIP وبدون دمج الملفات.

تمت إضافة وضع `download=1` إلى endpoint الملف ليعيد `Content-Disposition: attachment` مع المحافظة على وضع العرض الحالي `inline` عند فتح الملف.

يدعم التنزيل الإجباري ملفات Zoho وR2.

## الملفات البرمجية الرئيسية المعدلة

- `server/_facebook-video-publisher.ts` — جديد
- `server/marketing/index.ts`
- `src/marketing/api.ts`
- `src/marketing/pages/PublishPrepPage.tsx`
- `src/marketing/marketing.css`
- `package.json`

## الاختبارات المضافة

- `scripts/check-facebook-resumable-publish-v1231.mjs`
- `scripts/test-facebook-resumable-publisher-v1231.mjs`
- `scripts/check-publish-prep-final-download-v1231.mjs`
