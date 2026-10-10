# التسليم الكامل — تفاعل النشر من Meta ومتابعة المتابعين

**النطاق:** سيستم التسويق فقط، من آخر السورس المرفق. لا تغيير على منطق النشر والجدولة أو إنشاء عملاء CRM أو أنظمة المنصة الأخرى.

## ما الذي تم تنفيذه؟

1. اكتشاف منشورات Facebook Page من `/PAGE_ID/posts` ومنشورات Instagram من `/IG_USER_ID/media`، عبر توكن الحسابات المشفرة الموجودة في إعدادات منصات التسويق.
2. قراءة أرقام التفاعل التي تُرجعها Meta؛ إذا غاب مؤشر مثل `shares` لا يجري تفسيره صفرًا.
3. استيراد تاريخ المنشورات المتاح على دفعات **70 منشورًا لكل حساب في كل تشغيل**، مع حفظ cursor لاستكمال الأرشيف دون الرجوع للبداية، واكتشاف أحدث 15 منشورًا بكل تشغيل أيضًا. لا يتم تخزين روابط paging التي قد تحتوي على توكنات.
4. المزامنة بعد اكتمال الأرشيف تحدث آخر المنشورات وتدور تدريجيًا على 4 منشورات تاريخية لكل حساب في كل تشغيل حتى تتابع تغير الأرقام بحدود Graph API.
5. منع التكرار حسب معرف المنشور والمعرف الإعلامي الأصلي ورابطه عند وجوده في سجلات النشر الداخلية. لا ينسخ المنشور المنشور داخليًا إلى شاشة التفاعل مرتين.
6. تبويب «الحسابات والمتابعون» يجلب العدد الحالي لمتابعي Facebook وInstagram، ويحفظ لقطات يومية تُستخدم لحساب النمو من أول تاريخ مزامنة حقيقي؛ لا يخترع بيانات تاريخية غير متاحة.
7. فلتر «كل المنشورات / نشر من السيستم / نشر من Meta» بداخل شاشة «تفاعل النشر»، وزر للمزامنة اليدوية، مع الإبقاء على صفحات نتائج الحملات والأجندات.
8. الأرشفة أو الإخفاء للمنشور الخارجي يخص سجله المحلي فقط ولا يحذفه من Meta؛ الإخفاء يبقى محفوظًا عند تكرار المزامنة.
9. المزامنة التلقائية كل 15 دقيقة باستخدام Cron محمي بـ `CRON_SECRET` من إعدادات Vercel.

## القرارات التي تحافظ على السلوك القديم

- الملفات والجداول الأصلية `marketing.publish_schedule`, `marketing.published_posts`, `marketing.post_engagements` وعمليات إنشاء CRM تظل مصدر نشر السيستم فقط.
- الجدول **`marketing.meta_external_posts`** للمنشورات الخارجية مستقل؛ لا يجري إنشاء سجلات نشر أو عملاء CRM عند استيرادها. تتبع التعليقات والـWebhook المنشورات الموجودة بالسيستم كما كان.
- تبويبا نتائج الحملات والأجندات يعتمدان على سجلات السيستم فقط. لا يُحتسب منشور Meta غير المرتبط بحملة ضمن نتائجها.
- صلاحية المزامنة اليدوية تستخدم `marketing.engagement.refresh` القائمة؛ عرض الصفحة يتم عبر `marketing.engagement.view`.

## التشغيل بعد رفع السورس

1. رفع السورس ZIP بالكامل وتشغيل النشر المعتاد في Vercel، مع بقاء بيانات البيئة الحالية كما هي وعدم وضع Access Tokens في الكود.
2. تأكيد أن `DATABASE_URL` الحالي صالح؛ دالة `ensureMarketingSchema()` تنشئ الجداول الثلاثة الجديدة بصورة إضافية مع الإبقاء على بيانات التسويق الأخرى.
3. يجب تعريف **`CRON_SECRET`** بسر عشوائي قوي في Vercel حتى تعمل وظيفة المزامنة التلقائية؛ وظيفة المزامنة الجديدة ترفض التشغيل إذا كان المتغير غائبًا.
4. من سيستم التسويق → تفاعل النشر اضغط «مزامنة Meta والأرشيف» لتنفيذ أول دفعة فورية. ستبدأ الأرقام بالظهور تدريجيًا ويتم استكمال باقي الأرشيف بجدولة كل 15 دقيقة. العدد المتاح يعتمد على واجهة Meta وصلاحياتها.
5. إذا كان الربط الإنتاجي يستخدم توكنًا قديمًا لم يحصل على `read_insights`، أعد تفويض Meta من إعدادات الربط **بعد التأكد من الحفاظ على توكن النشر القديم حتى اكتمال الربط الجديد**. تغير نطاقات OAuth يتم طلبه الآن في السورس، ووجود الصلاحية في Explorer منفصل عن منحها لتوكن الربط الإنتاجي.
6. **ألغِ واستبدل التوكنات التي سبق كشفها في الدردشة/الصور** باستخدام طريقة تدوير مدروسة تمنع تعطيل النشر الإنتاجي. لا تشارك التوكنات في التذاكر أو الدردشة أو روابط `paging.next`.

## ملاحظات القياس

- البيانات التاريخية لتطور عدد المتابعين تبدأ **من أول يوم مزامنة**، لا من تاريخ إنشاء الحساب.
- مخزون Instagram المعلن بواسطة `media_count` لا يضمن الوصول لكل الأنواع التاريخية، مثل القصص المحذوفة أو العناصر غير المدعومة من Meta.
- قد لا تُرجع Meta كل أرقام الـReels والمشاركات والوصول لكل نوع؛ تُعرض المؤشرات غير المتاحة بـ«—» وليس صفرًا مفترضًا.
- عملية backfill تستكمل تدريجيًا؛ قد تحتاج ساعات بحسب عدد المنشورات والـAPI، ولا تُجرى آلاف الطلبات ضمن استدعاء Vercel واحد.
- لا يوجد في بيئة إعداد الحزمة اتصال مباشر بحسابات Meta أو قاعدة Neon الإنتاجية؛ اختبارات الاتصال النهائية تُجرى بعد النشر، مع مراقبة أخطاء المزامنة داخل تبويب المتابعين.

## الفحوصات المنفذة محليًا

- `scripts/check-marketing-meta-discovery-clean-v1240.mjs`: تطبيع المقاييس، عدم تكرار المنشورات، عزل CRM، حماية cron، فلاتر واجهة العرض.
- `scripts/test-marketing-meta-sync-v1240.mjs`: محاكاة Graph API وSQL في ثلاثة تشغيلات، مع تقدم الـcursor وتكرار الاستعلامات دون تكرار السجلات، وعدد المتابعين والتحقق من إرسال التوكن في Authorization بدل الرابط.
- اجتياز فحوصات التفاعل وCRM وربط المنصات الموجودة مسبقًا.
- لم يُشغّل `pnpm run build` كاملًا لأن الاعتماديات غير مثبتة في بيئة العمل ولا يمكن الوصول إلى سجل npm منها؛ يجب تنفيذ بناء Vercel الفعلي قبل اعتماد النشر.

## تصحيح بناء Vercel والتحقق من نوع البيانات

- تم تصحيح توقف البناء `TS2367` داخل `server/_marketing-meta-sync.ts` بحذف مقارنة ثابتة مستحيلة بين صيغ حقول الاستعلام الأساسي والاحتياطي؛ مسار إعادة المحاولة نفسه لم يتغير.
- تحقق دلالي حقيقي باستخدام TypeScript `strict` على وحدة المزامنة كاملة: **قبل التصحيح TS2367 واحد، وبعد التصحيح 0 أخطاء**. هذا تحقق دلالي وليس مجرد تحويل TS إلى JavaScript.
- **43/43** من فحوصات التسويق والتفاعل والربط وCRM ذات الصلة نجحت بعد التصحيح، إضافة إلى **18/18** فحصًا للتطوير الجديد ومحاكاة تتابع الاستيراد.
- تم استبعاد ملفات `*.tsbuildinfo` المولدة مسبقًا من ZIP لضمان بناء جديد دون حالة TypeScript متبقية من جهاز آخر.
- **لم يتم تنفيذ `pnpm run build` كاملاً داخل بيئة الفحص**، لأن حزم npm غير متوفرة محليًا ولا يمكن تنزيلها من registry؛ يجب التأكد من نجاح الـDeployment على Vercel قبل اعتماد التشغيل الإنتاجي.

## نتيجة فحوصات الرجوع (Regression) من النسخة الأصلية

- من 62 ملف فحص متعلق بالتسويق/CRM/الصلاحيات/استيرادات API: **57 نجح**.
- الخمسة الباقية فشلت **بالشكل نفسه على السورس الأصلي قبل أي تعديل**، وليست إخفاقات أحدثها هذا التطوير. الأسماء: `check-marketing-manual-publish-multimedia-v1229`, `check-marketing-publish-types-manual-engagement-v1226`, `check-crm-finance-combined-details-v1180`, `check-crm-report-indicators-20260805`, `check-crm-sale-timestamp-v1216`.
- فحوصات التطوير الجديد **18/18**، ومحاكاة مزامنة Facebook وInstagram المتكررة **ناجحة**. فحص صياغة TypeScript/TSX للملفات المعدلة **ناجح**؛ البناء المتكامل لم يتم لغياب الاعتماديات واتصال npm في بيئة العمل.


## 2026-10-11: Clean scheduler redesign after Vercel 504

- Production logs showed `Vercel Runtime Timeout Error: Task timed out after 120 seconds` on the Meta sync route. The code previously re-ran the entire marketing DDL on each cold Cron invocation and performed a separate INSERT for up to 70 historical posts plus 15 recent posts per account, with multiple per-item API calls. This created a high timeout risk.
- The scheduled route now checks the existence of its three tables without re-running the global marketing schema. If not initialized, it responds 503 with `META_SYNC_SCHEMA_NOT_READY`; opening the Marketing area initializes the schema via its unchanged normal path.
- Graph pages are now saved with **one atomic jsonb_to_recordset UPSERT per page**. Historical batch size remains 70/account/run, but each completed page advances its saved cursor only after a successful write. Failed pages are safely retried without duplicated posts, and existing archive/delete flags remain unchanged.
- Each invocation has a bounded 72-second work window (headroom under Vercel's 120 seconds), with time checks before requests and a max 8-second timeout on Meta fetches. Unsupported-field fallback is attempted only for relevant Graph errors, not timeouts/invalid access. Old-media refresh and recent Instagram insight enrichment are bounded to avoid unbounded request sequences. The first historical page includes recent posts and is not fetched twice.
- The Meta job takes a **non-blocking** advisory lock shared with the existing lock key. Concurrent calls skip safely instead of waiting for each other. Account ordering alternates to avoid starving Facebook or Instagram when work is deferred. No change to attendance Cron or the existing marketing publish/CRM flow.
- The engagement page now polls its **stored database data** every 60 seconds while visible. It never calls Meta in the polling loop and never triggers manual sync automatically.
- `Vercel Settings > Cron Jobs > /api/internal/meta-engagement-sync > View Logs`: look for `Meta engagement scheduler completed`, HTTP 200 and import counts after deploy. An error from Graph for a particular account can appear in stored sync state even if the HTTP request returns 200; check account warnings and import progress.
- Runtime/Graph/DB validation on production is still required after deployment. Do not increase the function timeout, modify the attendance schedule, or paste tokens into logs.

## 2026-10-11: تحديث أرقام Meta تلقائيًا عند فتح تفاعل النشر

- يبدأ العرض بقراءة **البيانات المحفوظة فورًا**، ثم ينفذ تلقائيًا **مرة واحدة عند فتح تبويب «تفاعل النشر»** عملية تحديث أرقام أحدث 15 منشورًا من كل حساب Facebook أو Instagram متصل، من غير أن يضغط المستخدم زرًا.
- التحديث التلقائي **منفصل تمامًا عن استيراد الأرشيف**: يقرأ صفحتين صغيرتين من Graph API ويحفظهما باستعلامات UPSERT مجمّعة، ثم يعيد جلب الأرقام المحفوظة لعرض اللايكات والتعليقات الجديدة. حالة التحديث التلقائي تظهر أسفل عنوان «جميع المنشورات».
- إجراء التحديث الخفيف يستخدم مسار التصاريح نفسه `marketing.engagement.refresh` والجلسة الفعلية، لكنه لا يعيد تنفيذ جميع ترحيلات التسويق والعمليات في كل فتح للصفحة؛ يتحقق فقط من وجود الجداول الموجودة بالفعل. **لا توجد صلاحية جديدة أو إعداد بيئي جديد.**
- التحديث يشترك في القفل غير المنتظر مع Cron: لو بدأ Cron أولًا تُعرض البيانات المحفوظة، ويستمر فحص قاعدة البيانات مرة في الدقيقة؛ لا تُرسل طلبات Graph متزامنة إضافية.
- القراءة الدورية كل دقيقة تجلب **البيانات المحفوظة فقط**، ولا تكرر النداء إلى Meta أو تحدث التفاعل في حلقة مستمرة، لتجنب الضغط على حدود Graph API.
- المنشورات الأقدم من أحدث 15 لكل حساب تتحدث بدوران Cron أو بزر «تحديث» الموجود في صف المنشور. الزر اليدوي «تحديث الأرقام الآن» يظل متاحًا، والنشر والـCRM والحضور لا تتغير.
- اختبار محاكاة منشور توسان رقم `17910769611525659`: تخزين `like_count=0`، ثم Graph API يرجع `1`، وبعد التحديث التلقائي تصبح القيمة المحفوظة `1` وتظهر بعد إعادة تحميل بيانات الجدول. تم اختبار تجاوز التشغيل تلقائيًا عند انشغال قفل Cron أيضًا.
- نتيجة الفحص الدلالي `strict` لوحدة المزامنة: **صفر أخطاء**، مع نجاح اختبارات المزامنة وCRM/التفاعل ذات الصلة. يلزم اختبار البناء النهائي والنشر في Vercel؛ لم تتوفر اعتماديات npm لإجراء بناء الإنتاج كاملًا في بيئة الفحص.
