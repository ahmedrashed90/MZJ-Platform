# MZJ Platform - Website Vehicle Image Manager - Clean V50

## Scope
إضافة صفحة جديدة فقط داخل نظام **الموقع الإلكتروني** باسم **إدارة صور السيارات** على المسار:

`/website/images`

لم يتم تعديل منطق CRM أو Operations أو Marketing أو Tracking أو MZJ Club Community.

## WordPress storage contract
التنفيذ يحتاج البلجن المستقلة:

`MZJ Vehicle Image Manager - Platform Bridge v1.0.0`

كل الملفات ترفع من المتصفح مباشرة إلى WordPress Media Library. منصة Vercel لا تستقبل ملف الصورة ولا تخزنه.

- الصورة الرئيسية: `main_img` + Featured Image.
- صور اللون الخارجي: `_mzjpan_next_color_images_v1`، وهو نفس العقد الذي يقرأه Panorama.
- صور اللون الداخلي: `_mzj_image_manager_interior_images_v1`، والملفات تكون Attachments مرتبطة ببوست السيارة فتدخل في اكتشاف الجاليري الحالي بدون تعديل Panorama.
- الألوان المتاحة: `_mzj_vehicle_exact_color_matrix` التي يكتبها Checkout.
- الاستوك: `_mzj_vehicle_exact_match_qty` / عقد Checkout الحالي.

## Security
- قراءة السيارات من WordPress تستخدم نفس `MZJ_CARS_BRIDGE_SECRET` الحالي.
- السر لا يرسل للمتصفح.
- عند الحفظ، Platform يصدر HMAC ticket لمدة 5 دقائق للسيارة المحددة.
- المتصفح يرسل الصور مباشرة إلى `/wp-json/mzj-image-manager/v1/upload` مع التذكرة.
- Origin الافتراضي للرفع المباشر: `https://mzj-platform.vercel.app`.

## Platform files changed
- `src/App.tsx` - Route فرعي فقط داخل Website.
- `src/website/WebsiteLayout.tsx` - رابط الصفحة الجديدة فقط.
- `src/website/api.ts` - قراءة مدير الصور + ticket + direct upload.
- `server/website.ts` - نفس Website API مع scope/action خاصين بالصور.
- `src/styles.css` - CSS معزول بأسماء `website-images-*`.

## Platform files added
- `src/website/WebsiteImagesPage.tsx`
- `server/_website-images.ts`
- `scripts/check-website-vehicle-image-manager-v50.mjs`
- هذا الملف.

## Existing WordPress plugins
لم يتم تعديل أي ملف داخل:
- MZJ Platform Cars Bridge - All Stock
- MZJ Vehicle Friend Invite Description Checkout
- MZJ Cars Panorama ERP Adaptive Full Gallery
