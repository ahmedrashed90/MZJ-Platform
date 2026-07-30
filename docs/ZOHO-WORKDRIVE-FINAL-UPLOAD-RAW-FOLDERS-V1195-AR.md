# رفع الملف النهائي مباشرة إلى Zoho WorkDrive وإصلاح فولدرات RAW

## نطاق النسخة

تم تعديل السورس الأساسي نفسه وإزالة مسار رفع Zoho السابق الذي كان يعتمد على Cloudflare Worker وR2. لا توجد طبقة Patch إضافية، ولم يتغير:

- إنشاء الحملة.
- إنشاء الأجندة.
- إنشاء التاسكات التنفيذية.
- شروط أو توقيت ظهور رفع الملف النهائي.
- نسب التقدم أو اعتماد Task Template.

المرحلة الحالية تضبط **رفع الملف النهائي فقط**. منطق النشر على المنصات يُختبر ويُضبط في مرحلة مستقلة بعد التأكد من الرفع الفعلي.

## مسار الرفع الحالي

```text
متصفح اليوزر داخل تفاصيل التاسك
    ↓
Zoho WorkDrive مباشرة
    ↓
تأكيد Resource ID من خادم المنصة
    ↓
حفظ بيانات الملف وترتيبه في PostgreSQL
    ↓
ربط مجموعة الملفات بالتاسك التنفيذي
```

لا تمر بايتات الملف النهائي عبر:

- Cloudflare Worker.
- Cloudflare R2.
- Vercel Function.

خادم المنصة مسؤول فقط عن التحقق من صلاحية اليوزر والتاسك، تجهيز جلسة الرفع، تجديد Zoho Access Token، التحقق من نتيجة الرفع، ثم حفظ المرجع داخل PostgreSQL.

## واجهة الرفع داخل تفاصيل التاسك

داخل نفس مكان رفع الملف النهائي الحالي يظهر:

- مربع ضغط أو سحب وإفلات.
- اسم كل ملف وحجمه.
- نسبة رفع كل ملف.
- إجمالي نسبة العملية.
- سرعة الرفع الحالية.
- الحجم المرفوع من الحجم الكلي.
- الوقت التقريبي المتبقي.
- حالة الرفع والتحقق.
- زر إلغاء الرفع.

الأنواع المدعومة:

- فيديو أو ريل: ملف واحد.
- بوست صورة: ملف واحد.
- كاروسيل: عدة صور تُرفع بالتتابع وتُحفظ حسب ترتيب اختيارها.

لا يتم استبدال الملف النهائي النشط في التاسك إلا بعد نجاح رفع كل الملفات والتحقق منها.

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

الصلاحيات المطلوبة في موافقة Zoho:

```text
WorkDrive.files.CREATE
WorkDrive.files.READ
WorkDrive.users.READ
ZohoFiles.files.CREATE
```

بسبب إضافة `WorkDrive.users.READ` يلزم تنفيذ **إعادة ربط Zoho** بعد نشر هذه النسخة وقبول الصلاحيات من حساب `marketing@mzjcars.com`.

`Client Secret` و`Refresh Token` يظلان مشفرين على الخادم. عند بدء رفع فعلي، يحصل اليوزر المصرح له فقط على Access Token مؤقت لتنفيذ طلب الرفع المباشر، ولا يتم حفظه في Local Storage أو قاعدة بيانات المتصفح.

## متغيرات Vercel

```env
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_ACCOUNT_EMAIL=marketing@mzjcars.com
ZOHO_ACCOUNTS_URL=https://accounts.zoho.sa
ZOHO_API_DOMAIN=https://www.zohoapis.sa
ZOHO_UPLOAD_DOMAIN=https://files.zoho.sa
ZOHO_REDIRECT_URI=https://mzj-platform.vercel.app/api/integrations/zoho/callback
ZOHO_PUBLISH_ROOT_FOLDER_ID=efosi67f34a771f13446c8d01545192eb1829

MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY=<random-secret-at-least-32-characters>

MZJ_RAW_API_URL=http://152.239.121.92:8080/api/create-raw-folders
MZJ_RAW_API_TOKEN=<current-raw-server-token>
MZJ_RAW_ALLOW_LEGACY_TOKEN=false
```

لا تضف متغيرات الرفع القديمة:

```text
ZOHO_UPLOAD_GATEWAY_URL
ZOHO_UPLOAD_STAGING
```

ولا يحتاج رفع Zoho النهائي إلى R2 Binding أو Worker Secret.

## فولدرات RAW

إصلاح استدعاء إنشاء فولدرات الخام للحملات والأجندات موجود في نفس السورس، مع دعم:

- `MZJ_RAW_API_URL`.
- `MZJ_RAW_API_TOKEN`.
- وضع التوافق المؤقت `MZJ_RAW_ALLOW_LEGACY_TOKEN=true` عند الحاجة.

إظهار روابط RAW وOUTPUT داخل كل تاسك ليس ضمن تعديل رفع Zoho الحالي، ويُستكمل بصورة مستقلة بعد استقرار الرفع.

## اختبار ما بعد النشر

1. إضافة متغيرات Zoho إلى Vercel.
2. عمل Redeploy.
3. فتح التسويق ثم ربط المنصات.
4. الضغط على **إعادة ربط Zoho** وقبول الصلاحيات الجديدة.
5. تجربة صورة واحدة من تاسك حملة.
6. تجربة عدة صور والتأكد من ترتيبها.
7. تجربة فيديو صغير.
8. تجربة فيديو كبير.
9. تجربة الإلغاء أثناء الرفع.
10. تجربة تاسك تابع لأجندة.
11. مراجعة ظهور الملفات داخل تفاصيل التاسك بعد اكتمال الرفع.

## ملاحظة اختبار حقيقية

تم فحص بنية السورس ومسارات التحقق وواجهة التقدم والإلغاء محليًا. لا يمكن إثبات نجاح طلب الرفع المباشر الفعلي أو سياسة CORS الخاصة بحساب Zoho إلا بعد نشر النسخة، إعادة ربط الحساب، وتجربة الرفع من دومين المنصة الحقيقي.
