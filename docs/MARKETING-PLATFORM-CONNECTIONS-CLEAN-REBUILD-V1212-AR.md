# إعادة بناء تبويب ربط المنصات — سيستم التسويق

## نطاق التنفيذ

تمت إعادة بناء تبويب **ربط المنصات** الموجود داخل سيستم التسويق من داخل السورس الأساسي نفسه، بدون إنشاء صفحة جانبية وبدون الإبقاء على نموذج إدخال التوكنات اليدوي القديم.

النطاق المنفذ:

- Meta: ربط Facebook Page وحساب Instagram Professional المرتبط بها.
- TikTok: OAuth وربط الحساب وتجديد التوكن وفحصه وفصله.
- YouTube: Google OAuth وربط القناة وتجديد التوكن وفحصه وفصله.
- PostgreSQL كمصدر الحقيقة الوحيد لحالة الربط.
- تشفير جميع التوكنات في الخادم وعدم إعادتها للواجهة.
- صلاحيات المنصة المركزية نفسها دون إنشاء نظام صلاحيات موازٍ.

> هذا التسليم يعيد بناء **الربط وإدارته**. النشر الحالي في سيستم التسويق يظل كما هو لـFacebook وInstagram. لا يدّعي التبويب أن نشر TikTok أوYouTube جاهز قبل بناء مسار النشر الخاص بهما واختباره منفصلًا.

## ما تم إلغاؤه نهائيًا

- إدخال Access Token يدويًا من الواجهة.
- عرض أو إعادة Access Token أوRefresh Token للمتصفح.
- الاعتماد على Cookies كمصدر مركزي لحالة الربط.
- إجراءات `save_connection` و`disconnect_connection` و`migrate_connection_env` القديمة.
- متغيرات التوكنات اليدوية القديمة داخل `.env.example`.
- اعتبار أي ربط يدوي قديم اتصالًا موثوقًا؛ بعد تطبيق Migration يظهر أنه يحتاج إلى إعادة ربط OAuth.

## المعمارية الجديدة

### الواجهة

الصفحة الموجودة نفسها أصبحت تعرض ثلاث بطاقات:

1. Meta
2. TikTok
3. YouTube

كل بطاقة تعرض:

- حالة الإعداد والاتصال.
- اسم الحساب أوالقناة.
- المعرف العام غير السري.
- آخر فحص للربط.
- انتهاء التوكن عند توفره.
- الصلاحيات الممنوحة.
- آخر خطأ.
- Callback URL مع زر نسخ.
- أزرار ربط/إعادة ربط، فحص الربط، وفصل الربط.

كما يعرض التبويب سجلًا لآخر عمليات الربط والفحص والفصل.

### الـAPI

المسار الموحد:

```text
GET  /api/marketing/platform-connections
POST /api/marketing/platform-connections
```

إجراءات POST:

```text
start_oauth
select_meta_page
cancel_oauth_draft
validate
disconnect
```

Callbacks:

```text
GET /api/marketing/platform-connections/callback/meta
GET /api/marketing/platform-connections/callback/tiktok
GET /api/marketing/platform-connections/callback/youtube
```

### قاعدة البيانات

الجداول المستخدمة:

- `marketing.platform_connections`
- `marketing.platform_oauth_states`
- `marketing.platform_connection_drafts`
- `marketing.platform_connection_events`

`platform_connections` يحتفظ بالحالة العامة والهوية والتوكنات المشفرة وتواريخ الصلاحية وآخر فحص وآخر خطأ ومستخدم الربط أوالفصل.

`platform_oauth_states` يحتفظ بقيمة OAuth State كـHash فقط، مرتبطة بالمستخدم والمنصة وتنتهي بعد مدة قصيرة وتُستهلك مرة واحدة.

`platform_connection_drafts` يستخدم مؤقتًا عند وجود أكثر من Facebook Page، حتى يختار المستخدم الصفحة المطلوبة بدون قطع ربط Meta الحالي قبل نجاح الاختيار.

`platform_connection_events` يسجل العمليات الإدارية بدون حفظ أي توكنات.

## الأمان

- تشفير AES-256-GCM داخل الخادم.
- مفتاح تشفير إلزامي لا يقل عن 32 حرفًا.
- لا يوجد Development Fallback لمفتاح التشفير.
- OAuth State عشوائي، مخزن كـHash، مربوط بالمستخدم، وينتهي تلقائيًا.
- Callback يحتاج جلسة منصة صالحة وصلاحية إدارة ربط المنصات.
- القراءة تحتاج `marketing.platforms.view`.
- الربط والفحص والفصل يحتاج `marketing.connections.manage`.
- الواجهة لا تستقبل التوكنات في أي Response.
- فصل الربط يحاول Revoke لدى مزود الخدمة ثم يمسح جميع التوكنات والهوية المحلية حتى عند تعذر الـRevoke، مع تسجيل تحذير واضح.

## فلو Meta

1. المستخدم يضغط **ربط Meta** أو**إعادة الربط**.
2. الخادم ينشئ OAuth State مربوطًا بالمستخدم.
3. تفتح نافذة Meta الرسمية.
4. بعد Callback يتم التحقق من State والصلاحيات.
5. يتم جلب الصفحات المتاحة وحساب Instagram Professional المرتبط بكل صفحة.
6. لو توجد صفحة واحدة، يتم حفظ الربط مباشرة.
7. لو توجد أكثر من صفحة، تظهر قائمة اختيار داخل التبويب.
8. الربط الحالي يظل فعالًا حتى اختيار الصفحة الجديدة بنجاح.
9. يتم حفظ Facebook Page وInstagram Account كتسجيلين مترابطين في PostgreSQL.
10. زر الفصل يلغي منح Meta عند الإمكان ويمسح بيانات الربط المحلية.

## فلو TikTok

1. OAuth باستخدام Client Key الرسمي.
2. التحقق من الصلاحيات المطلوبة.
3. حفظ Access Token وRefresh Token مشفرين.
4. جلب بيانات الحساب العامة.
5. فحص الاتصال الحقيقي من TikTok.
6. تجديد Access Token عند الحاجة باستخدام Refresh Token.
7. Revoke عند الفصل ثم إزالة كل بيانات الربط المحلية.

## فلو YouTube

1. Google OAuth مع `access_type=offline` وطلب الموافقة.
2. الحصول على Access Token وRefresh Token.
3. التحقق من Scopes.
4. جلب القناة المرتبطة وعرض اسمها.
5. تجديد Access Token عند الانتهاء.
6. فحص القناة فعليًا بدل الاعتماد على حالة مخزنة فقط.
7. Revoke لدى Google عند الفصل ثم إزالة بيانات الربط المحلية.

## متغيرات البيئة المطلوبة

```env
MZJ_PUBLIC_BASE_URL=https://mzj-platform.vercel.app
MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY=

META_APP_ID=
META_APP_SECRET=
META_CONFIG_ID=
META_REDIRECT_URI=https://mzj-platform.vercel.app/api/marketing/platform-connections/callback/meta
META_GRAPH_VERSION=v25.0
META_SCOPES=public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish

TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=https://mzj-platform.vercel.app/api/marketing/platform-connections/callback/tiktok
TIKTOK_SCOPES=user.info.basic,video.upload,video.publish

YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=https://mzj-platform.vercel.app/api/marketing/platform-connections/callback/youtube
YOUTUBE_SCOPES=https://www.googleapis.com/auth/youtube.upload,https://www.googleapis.com/auth/youtube.readonly
```

لتوليد مفتاح قوي:

```bash
openssl rand -base64 48
```

لا يتم تغيير مفتاح التشفير بعد حفظ توكنات حقيقية إلا ضمن عملية تدوير مخططة؛ تغييره مباشرة يجعل التوكنات القديمة غير قابلة للفك ويستلزم إعادة الربط.

## إعداد تطبيقات مزودي الخدمة

### Meta

- التنفيذ يستخدم **Facebook Login for Business** فقط، وليس Facebook Login العادي.
- أنشئ Configuration من نوع **User access token** وضع رقمها في `META_CONFIG_ID`.
- رابط OAuth يرسل `config_id` بدل `scope`، ويستخدم Authorization Code Grant مع `response_type=code`.
- أضف `META_REDIRECT_URI` حرفيًا ضمن Valid OAuth Redirect URIs.
- اضبط داخل Configuration الصلاحيات المطلوبة: `pages_show_list` و`pages_read_engagement` و`pages_manage_posts` و`instagram_basic` و`instagram_content_publish`، ويمكن أن تتضمن `business_management` إذا كانت مطلوبة لإدارة أصول الـBusiness.
- حساب Instagram يجب أن يكون Professional ومربوطًا بصفحة Facebook.
- أي صلاحية تحتاج مراجعة أوAdvanced Access يجب اعتمادها على تطبيق Meta قبل الاستخدام العام.

### TikTok

- أضف Redirect URI نفسه حرفيًا في TikTok for Developers.
- فعّل Login Kit والصلاحيات المطلوبة.
- لا تعتبر `video.upload` أو`video.publish` جاهزة لمجرد نجاح الربط؛ يلزم اعتماد المنتج ومسار النشر واختباره منفصلًا.

### Google / YouTube

- فعّل YouTube Data API v3.
- أنشئ OAuth Web Client.
- أضف Redirect URI نفسه حرفيًا.
- اضبط OAuth Consent Screen والمستخدمين أوحالة النشر المطلوبة.

## خطوات النشر

1. خذ نسخة احتياطية من PostgreSQL.
2. شغّل Migration:

```text
database/migrations/20260730_marketing_platform_connections_clean_rebuild.sql
```

3. أضف متغيرات البيئة ومفتاح التشفير.
4. أضف Callback URLs نفسها في لوحات Meta وTikTok وGoogle.
5. انشر السورس.
6. افتح سيستم التسويق ← ربط المنصات.
7. أعد ربط أي حساب ظهر بحالة **يلزم إعادة الربط**.
8. نفّذ **فحص الربط** لكل منصة بعد الربط.

## ملاحظات الانتقال من التنفيذ القديم

Migration يتعامل مع الاتصال اليدوي القديم كالتالي:

- يغيّر الحالة إلى `reauthorization_required`.
- يمسح جميع التوكنات القديمة.
- لا يحاول تحويل Token يدوي إلى OAuth موثوق.
- لا يحذف بيانات بقية سيستم التسويق.

هذا انتقال مقصود ونظيف، وليس Patch فوق المنطق القديم.
