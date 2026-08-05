# رفع الملف النهائي إلى Zoho WorkDrive عبر API المنصة

## نطاق النسخة

تم تعديل السورس نفسه وإزالة مسار الرفع الذي كان يرسل الطلب من المتصفح إلى Zoho مباشرة. لا توجد طبقة Patch إضافية، ولم يتغير:

- إنشاء الحملة.
- إنشاء الأجندة.
- إنشاء التاسكات التنفيذية.
- شروط أو توقيت ظهور رفع الملف النهائي.
- نسب التقدم أو اعتماد Task Template.

المرحلة الحالية تضبط رفع الملف النهائي فقط. منطق النشر على المنصات يظل كما هو إلى أن يتم اختبار الرفع واعتماده.

## مسار الرفع المعتمد

```text
متصفح اليوزر داخل تفاصيل التاسك
    ↓
API المنصة /api/marketing
    ↓
Zoho WorkDrive
    ↓
حفظ Resource ID وترتيب الملفات في PostgreSQL
    ↓
ربط مجموعة الملفات بالتاسك التنفيذي
```

تم حذف إرسال Access Token إلى المتصفح، وحذف استدعاء Zoho من JavaScript في الواجهة. لا يستخدم رفع الملف النهائي:

- Cloudflare Worker.
- Cloudflare R2.
- رابط Zoho مباشر من المتصفح.

المنصة تستخدم ربط OAuth المحفوظ والمشفر، وتجدد Access Token على الخادم ثم ترسل الملف إلى Zoho.

## واجهة الرفع داخل تفاصيل التاسك

داخل نفس مكان رفع الملف النهائي الحالي يظهر:

- مربع ضغط أو سحب وإفلات.
- اسم كل ملف وحجمه.
- نسبة رفع كل ملف.
- إجمالي نسبة العملية.
- سرعة الرفع الحالية.
- الحجم المرفوع من الحجم الكلي.
- الوقت التقريبي المتبقي.
- زر إلغاء الرفع.

الأنواع المدعومة:

- فيديو أو ريل: ملف واحد.
- بوست صورة: ملف واحد.
- كاروسيل: عدة صور ترفع بالتتابع وتحفظ حسب ترتيب اختيارها.

لا يتم استبدال الملف النهائي النشط في التاسك إلا بعد نجاح رفع كل الملفات وربط المجموعة بالتاسك.

## Zoho OAuth

المسارات:

```text
GET /api/integrations/zoho/start
GET /api/integrations/zoho/callback
GET /api/integrations/zoho/status
```

رابط Callback:

```text
https://mzj-platform.vercel.app/api/integrations/zoho/callback
```

يظل Client Secret وRefresh Token مشفرين على الخادم ولا يرسلان إلى المتصفح.

## متغيرات Vercel

```env
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_ACCOUNT_EMAIL=marketing@mzjcars.com
ZOHO_ACCOUNTS_URL=https://accounts.zoho.sa
ZOHO_API_DOMAIN=https://www.zohoapis.sa
ZOHO_REDIRECT_URI=https://mzj-platform.vercel.app/api/integrations/zoho/callback
ZOHO_PUBLISH_ROOT_FOLDER_ID=efosi67f34a771f13446c8d01545192eb1829
MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY=<random-secret-at-least-32-characters>

MZJ_RAW_API_URL=http://152.239.121.92:8080/api/create-raw-folders
MZJ_RAW_API_TOKEN=<current-raw-server-token>
MZJ_RAW_ALLOW_LEGACY_TOKEN=false
```

لا يحتاج رفع الملف النهائي إلى:

```text
ZOHO_UPLOAD_GATEWAY_URL
MZJ_GATEWAY_SECRET
ZOHO_UPLOAD_STAGING
R2 Binding
Cloudflare Worker
```

## فولدرات RAW

إصلاح استدعاء إنشاء فولدرات الخام للحملات والأجندات موجود في نفس السورس. إظهار روابط RAW وOUTPUT داخل كل تاسك يتم استكماله بصورة مستقلة بعد استقرار الرفع.

## اختبار ما بعد النشر

1. نشر السورس وعمل Redeploy.
2. لا حاجة لإعادة ربط Zoho إذا كانت شاشة الربط تعرض «متصل».
3. تجربة صورة صغيرة من تاسك حملة.
4. تجربة عدة صور والتأكد من ترتيبها.
5. تجربة الإلغاء أثناء الرفع.
6. تجربة تاسك تابع لأجندة.
7. مراجعة ظهور الملفات داخل تفاصيل التاسك بعد اكتمال الرفع.
