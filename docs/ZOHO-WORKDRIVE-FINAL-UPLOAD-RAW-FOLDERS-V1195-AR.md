# ربط Zoho WorkDrive للملف النهائي وإصلاح فولدرات RAW

## نطاق التعديل

تم تنفيذ الربط داخل السورس الأساسي مباشرة، بدون تغيير منطق إنشاء الحملة أو إنشاء الأجندة، وبدون تغيير شروط أو توقيت ظهور زر **رفع الملف النهائي**.

التعديل يخص فقط:

1. ربط زر رفع الملف النهائي الحالي بـZoho WorkDrive.
2. دعم فيديو/ريل واحد، صورة واحدة، أو عدة صور مرتبة ككاروسيل واحد.
3. حفظ بيانات الربط والترتيب والحالة داخل PostgreSQL.
4. إظهار الملفات النهائية المرتبطة بالتاسكات التنفيذية في تجهيز النشر.
5. منع النشر حتى اكتمال الملف، الموعد، المنصة، نوع النشر، الكابشن والهاشتاج.
6. إصلاح استدعاء سيرفر إنشاء فولدرات RAW للحملات والأجندات.

## مسار Zoho OAuth

المسارات المضافة:

```text
GET /api/integrations/zoho/start
GET /api/integrations/zoho/callback
GET /api/integrations/zoho/status
```

مسار الرجوع المسجل في Zoho API Console:

```text
https://mzj-platform.vercel.app/api/integrations/zoho/callback
```

التوكنات تُشفّر في PostgreSQL باستخدام مفتاح تشفير المنصة، ولا تُرسل للمتصفح أو تُخزن داخل Cloudflare Worker.

## مسار رفع الملف النهائي

```text
زر رفع الملف النهائي الحالي
    ↓
التحقق من نوع الملفات وترتيبها
    ↓
تقسيم كل ملف إلى أجزاء 20MB في المتصفح
    ↓
Cloudflare Gateway Worker
    ↓
R2 مؤقت للأجزاء فقط
    ↓
Streaming إلى Zoho WorkDrive السعودية
    ↓
حذف الأجزاء المؤقتة من R2
    ↓
حفظ Resource ID والترتيب في PostgreSQL
    ↓
ربط المجموعة بالتاسك التنفيذي
```

- الفيديو أو الريل: ملف واحد.
- البوست بصورة واحدة: ملف واحد.
- الكاروسيل: عدة صور محفوظة بترتيب اختيار اليوزر.
- الحد البرمجي الحالي: 30 صورة في المجموعة الواحدة.
- الملفات تُرفع إلى الفولدر الجذر المحدد في `ZOHO_PUBLISH_ROOT_FOLDER_ID`.
- اسم الملف داخل Zoho يأخذ Prefix من نوع المصدر ومعرفاته ورقم الترتيب لمنع تعارض الملفات المتشابهة، بينما يظل الاسم الأصلي ظاهرًا داخل المنصة.
- هذا الإصدار لا ينشئ فولدرات فرعية تلقائية داخل Zoho؛ الربط يعتمد على الـTask ID ومجموعة الملفات داخل PostgreSQL.

## متغيرات Vercel المطلوبة

```env
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_ACCOUNT_EMAIL=marketing@mzjcars.com
ZOHO_ACCOUNTS_URL=https://accounts.zoho.sa
ZOHO_API_DOMAIN=https://www.zohoapis.sa
ZOHO_UPLOAD_DOMAIN=https://files.zoho.sa
ZOHO_REDIRECT_URI=https://mzj-platform.vercel.app/api/integrations/zoho/callback
ZOHO_PUBLISH_ROOT_FOLDER_ID=efosi67f34a771f13446c8d01545192eb1829
ZOHO_UPLOAD_GATEWAY_URL=https://<gateway-worker-domain>

MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY=<random-secret-at-least-32-characters>
MZJ_GATEWAY_SECRET=<same-secret-used-by-worker>

MZJ_RAW_API_URL=http://152.239.121.92:8080/api/create-raw-folders
MZJ_RAW_API_TOKEN=<current-raw-server-token>
MZJ_RAW_ALLOW_LEGACY_TOKEN=false
```

أثناء النقل فقط يمكن ترك:

```env
MZJ_RAW_ALLOW_LEGACY_TOKEN=true
```

وفي هذه الحالة يستخدم النظام توكن التوافق الموجود في السورس القديم عند عدم ضبط `MZJ_RAW_API_TOKEN`. الأفضل ضبط التوكن الصحيح في Vercel ثم تحويل القيمة إلى `false`.

## إعداد Cloudflare Gateway Worker

داخل `gateway-worker/wrangler.toml` تأكد من:

```toml
[vars]
PLATFORM_API_BASE_URL = "https://mzj-platform.vercel.app/api"

[[r2_buckets]]
binding = "ZOHO_UPLOAD_STAGING"
bucket_name = "mzj-zoho-upload-staging"
```

أنشئ Bucket باسم `mzj-zoho-upload-staging` أو غيّر الاسم في الإعداد. الـBinding نفسه يجب أن يبقى:

```text
ZOHO_UPLOAD_STAGING
```

أضف Secret للـWorker:

```bash
wrangler secret put GATEWAY_SECRET
```

القيمة يجب أن تطابق `MZJ_GATEWAY_SECRET` في Vercel.

بعد نشر الـWorker، ضع الدومين العام الخاص به داخل:

```env
ZOHO_UPLOAD_GATEWAY_URL=https://<gateway-worker-domain>
```

## تفعيل اتصال Zoho بعد النشر

1. افتح سيستم التسويق.
2. افتح صفحة **ربط المنصات**.
3. من كارت Zoho WorkDrive اضغط **ربط Zoho**.
4. سجل الدخول بحساب `marketing@mzjcars.com`.
5. وافق على الصلاحيات.
6. تأكد أن الكارت يعرض حالة الاتصال والفولدر الجذر.

## تجهيز النشر

صفحة تجهيز النشر تتعامل مع التاسكات التنفيذية التابعة للحملة أو الأجندة وتتحقق من:

- وجود الملف النهائي أو مجموعة الصور على Zoho.
- اكتمال رفع كل الملفات بالترتيب.
- وجود ميعاد النشر.
- اختيار منصة واحدة على الأقل.
- اختيار نوع نشر لكل منصة.
- وجود الكابشن.
- وجود الهاشتاج.

كل منصة تنفذ كعملية مستقلة. الصور المتعددة تُنشر ككاروسيل واحد وبنفس ترتيب الملفات المحفوظ.

## اختبار ما بعد النشر

اختبر بالترتيب:

1. ربط Zoho OAuth بحساب `marketing@mzjcars.com`.
2. رفع صورة واحدة من تاسك حملة.
3. رفع عدة صور والتأكد من ترتيبها في تجهيز النشر.
4. رفع فيديو بين 200 و300MB.
5. رفع ملف نهائي من تاسك أجندة.
6. إنشاء فولدرات RAW لحملة.
7. إنشاء فولدرات RAW لأجندة.
8. التأكد أن زر النشر لا يتفعل عند نقص أي شرط.
9. نشر صورة واحدة على منصة تجريبية.
10. نشر كاروسيل بالترتيب على Meta.
11. تجربة أكثر من منصة والتأكد أن نتيجة كل منصة مستقلة.

## ملاحظات أمنية

- لا تضع `ZOHO_CLIENT_SECRET` أو Refresh Token داخل الواجهة أو Cloudflare Worker.
- لا تجعل ملفات Zoho Public؛ التنزيل والنشر يمران من Media Gateway بتذكرة مؤقتة.
- R2 هنا مساحة مؤقتة للأجزاء أثناء الرفع فقط، وليست نسخة النشر أو الأرشيف.
- نسخة النشر النهائية تبقى في Zoho WorkDrive، وبياناتها المرجعية داخل PostgreSQL.
