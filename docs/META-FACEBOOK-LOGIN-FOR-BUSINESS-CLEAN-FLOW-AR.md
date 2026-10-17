# ربط Meta عبر Facebook Login for Business — التنفيذ الأصلي

## النطاق

تم تعديل مسار Meta الأصلي داخل `server/_platform-connections.ts` فقط ليستخدم Configuration الخاصة بـFacebook Login for Business. لا يوجد Endpoint بديل، ولا ملف Patch، ولا fallback إلى Facebook Login العادي.

## متغيرات البيئة

```env
META_APP_ID=
META_APP_SECRET=
META_CONFIG_ID=1516332383114076
META_REDIRECT_URI=https://mzj-platform.vercel.app/api/marketing/platform-connections/callback/meta
META_GRAPH_VERSION=v25.0
META_SCOPES=public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish
```

`META_CONFIG_ID` ليس توكنًا، لكن يظل إعدادًا خاصًا بالتطبيق ويوضع في Vercel بدل تثبيته داخل الكود.

## فلو OAuth

رابط البداية يرسل:

- `client_id`
- `redirect_uri`
- `state`
- `config_id`
- `response_type=code`
- `override_default_response_type=true`

لا يتم إرسال `scope` في رابط Meta؛ الصلاحيات تأتي من Configuration نفسها. بعد الـCallback يتم تبادل `code` من الخادم، ثم قراءة الصلاحيات الممنوحة والتحقق منها قبل حفظ أي اتصال.

## Configuration المطلوبة

- Login variation: Facebook Login for Business.
- Access token: User access token.
- الصلاحيات الأساسية المستخدمة فعليًا:
  - `pages_show_list`
  - `pages_read_engagement`
  - `pages_manage_posts`
  - `instagram_basic`
  - `instagram_content_publish`
- `business_management` يمكن أن تبقى داخل Configuration إذا كانت مطلوبة لإدارة أصول Business Portfolio.

## التشغيل

بعد إضافة `META_CONFIG_ID=1516332383114076` إلى Vercel، اعمل Redeploy ثم ابدأ من زر «إعادة الربط» داخل تبويب ربط المنصات. لا تفتح Callback URL يدويًا.
