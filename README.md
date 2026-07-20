# MZJ Platform v1.7.0

منصة React/Vite موحدة لمجموعة محمد بن ذعار العجمي، تعمل على Vercel مع PostgreSQL وتسجيل دخول حقيقي.

## ما تم تنفيذه في هذه النسخة

- لا توجد أسماء أو أرقام أو حسابات تجريبية.
- فحص تلقائي لاتصال PostgreSQL عند فتح المنصة.
- تهيئة قاعدة البيانات من داخل المنصة لأول مرة.
- إنشاء أول حساب «مدير النظام» بالبيانات التي يدخلها المستخدم فقط.
- تسجيل دخول حقيقي بالبريد أو الجوال أو رقم الموظف.
- جلسة دخول آمنة داخل Cookie من نوع HttpOnly.
- حماية API الداش بورد والإعدادات والمستخدمين من الوصول بدون تسجيل دخول.
- إدارة المستخدمين متاحة لمدير النظام فقط.
- إنشاء المستخدمين مع القسم والفرع والدور وخيارات استقبال العملاء والتاسكات.
- تسجيل عمليات التهيئة والدخول وإنشاء المستخدمين في سجل النشاط بقاعدة البيانات.

## إعداد Vercel

1. ارفع محتويات المشروع إلى جذر Repository.
2. Framework Preset: `Vite`.
3. Build Command: `npm run build`.
4. Output Directory: `dist`.
5. اربط PostgreSQL من Vercel Marketplace بنفس المشروع.
6. تأكد من وجود `DATABASE_URL` في Environment Variables.
7. أضف `MZJ_SETUP_KEY` بقيمة سرية طويلة من اختيارك.
8. يمكن إضافة `MZJ_GATEWAY_SECRET` لاحقًا عند تشغيل الـWorker المركزي.
9. اعمل Redeploy بدون Build Cache.

## أول تشغيل

- لو PostgreSQL غير مربوطة ستظهر صفحة الربط فقط.
- بعد ربطها ستظهر صفحة تهيئة المنصة.
- أدخل بيانات مدير النظام ومفتاح `MZJ_SETUP_KEY`.
- المنصة تنشئ الجداول والإعدادات الأساسية وأول حساب إداري ثم تسجل دخوله تلقائيًا.

## ملاحظات

- `database/seed.sql` يحتوي على الفروع والأقسام والأدوار الأساسية فقط، ولا ينشئ أي مستخدم أو بيانات عملاء أو سيارات.
- لا تضع `DATABASE_URL` أو `MZJ_SETUP_KEY` داخل GitHub. ضعها في Vercel Environment Variables فقط.

## v1.2.1 Vercel TypeScript fix

- All relative imports inside `api/` use explicit `.js` extensions for Vercel's NodeNext compilation.
- `tsconfig.node.json` now uses `module` and `moduleResolution` set to `NodeNext` so the same class of error is caught before deployment.
- The build runs an API import validation before TypeScript and Vite.
- The SPA rewrite excludes `/api/` routes.

## v1.3.1 - Vercel single API function
- تم نقل كل خدمات ومسارات الخادم إلى `server/`.
- يوجد ملف Vercel Function واحد فقط: `api/index.ts`.
- جميع عناوين `/api/*` تستمر كما هي عبر Rewrite مركزي.
- هذا يمنع Vercel من اعتبار ملفات الخدمات والمساعدات Functions مستقلة، ويقلل البناء إلى Function واحدة.
- إصدار Node في المشروع موحّد على `24.x` ليتطابق مع إعداد Vercel الحالي.


## v1.3.2 - Call Center assignment query fix
- Rebuilt the call-center candidate query without SELECT DISTINCT.
- Uses EXISTS against user departments to prevent duplicate users.
- Keeps the same active-user, can-receive-leads, and round-robin behavior.
- Fixes PostgreSQL error 42P10 caused by ORDER BY with DISTINCT.


## v1.4.0 - CRM Arabic sources, centralized sending and old-system screens
- إعادة بناء عرض داش بورد CRM للأقسام الثلاثة، مع ترتيب الحالات من إعدادات الإدارة وفتح ملف العميل والمحادثة من الكارت.
- توحيد عرض أسماء المصادر بالعربي في الداش بورد وقاعدة البيانات والإضافة اليدوية والسجل والتقارير والتصدير.
- إضافة خدمة إرسال مركزية في السيرفر تختار قناة الإرسال تلقائيًا من مصدر العميل، بدون اختيار Endpoint من الواجهة:
  - واتساب: نص حر أو قالب.
  - فيسبوك / إنستجرام / تيك توك محادثات: Endpoint المنصة نفسها.
  - تيك توك ليد / سناب شات ليد / حاسبة التقسيط / العميل اليدوي: واتساب بقوالب مرسال فقط.
- التحقق من رقم واتساب السعودي ومنع النص الحر للمصادر المقيدة بالقوالب على مستوى السيرفر والواجهة.
- شاشة عميل موحدة تضم المحادثة وبيانات العميل والمسؤول والكول سنتر والمصدر والحالة وكامل بيانات التمويل.
- صفحة إضافة العملاء أصبحت تحتوي على تبويبي الإضافة والعملاء المسجلين داخل نفس الصفحة.
- تطوير سجل عملاء التمويل مع الفلاتر والإحصاءات والخط الزمني وفتح المحادثة.
- التقارير أصبحت صفحة واحدة متصلة تشمل المؤشرات والمصادر والأقسام والفروع والمناديب والكول سنتر وخدمة العملاء، مع PDF وExcel.
- إعادة بناء KPI بتبويبات السرعة والكفاءة والانضباط والقيمة والنتيجة، ونقل نفس معادلات KPI الموجودة في النظام القديم إلى API PostgreSQL.
- لا توجد بيانات تجريبية أو أسماء وهمية، وجميع الأرقام تأتي من PostgreSQL.


## v1.5.0 - Unified settings, centralized sources and professional distribution
- نقل إعدادات CRM كاملة إلى صفحة الإعدادات الموحدة وإلغاء تبويب الإدارة المنفصل من شريط CRM.
- إضافة سجل مصادر مركزي مشترك بين CRM والتسويق مع الإضافة والتعديل والترتيب والتفعيل والإيقاف والحذف الآمن.
- توحيد اسم المصدر العربي في الداش بورد وقاعدة البيانات والمحادثات والسجل والتقارير والإضافة اليدوية.
- عرض حالات CRM بنظام Kanban، خمس حالات في كل صف على سطح المكتب، مع 3 إلى 4 كروت ظاهرة وScroll داخلي لكل عمود.
- حساب نسبة اكتمال ملف العميل من الحقول الأساسية فقط مع استبعاد الملاحظات.
- نقل معادلة الحد الائتماني من CRM القديم: 45% أو 55% أو 65% حسب نوع التمويل، وخصم الالتزامات، والتأهيل من 650 ريال.
- إضافة إدارة احترافية لقواعد توزيع العملاء حسب القسم والفرع والمصدر والموظفين المؤهلين، مع التتابع وآخر/تالي مندوب وعدد التوزيعات والسجل.
- توسيط شريط تبويبات الأنظمة الداخلي.
- توحيد أكواد مصادر التكامل القديمة مثل installment-calculator مع المصدر المركزي بدون تغيير الاسم العربي المعروض.

## v1.5.1 - Customer data form cleanup
- Rebuilt the CRM customer data form to match the approved legacy field set exactly.
- Removed user-visible extra fields without deleting legacy database columns or historical data.
- Department transfer now resets the status and runs the centralized assignment logic for the target department.

## v1.6.0 - Dynamic customer data fields
- إعادة بناء نموذج «بيانات العميل» ليُنشأ بالكامل من إعدادات CRM بدل تثبيت الحقول داخل الواجهة.
- إضافة قسم «بيانات العميل» داخل الإعدادات الموحدة لإدارة اسم الحقل ونوعه وترتيبه والأقسام التي يظهر فيها وتفعيله وإلزامه واختيارات القوائم.
- إضافة اختيار مستقل لكل حقل يحدد هل يدخل في نسبة اكتمال الملف أم لا، مع بقاء الملاحظات خارج النسبة افتراضيًا.
- حساب نسبة الاكتمال لحظيًا من الحقول النشطة المطبقة على قسم العميل؛ إضافة حقل أو إيقافه تغير البسط والمقام تلقائيًا بدون تعديل السورس.
- حفظ الحقول المخصصة داخل `crm.leads.extra_data` مع السماح بإيقاف الحقول المستخدمة تاريخيًا بدون حذف قيم العملاء القديمة.
- حماية الحقول المرتبطة بمنطق النظام والتوزيع وحساب الحد الائتماني من الحذف أو تغيير بنيتها، مع الإبقاء على تعديل الاسم والترتيب والدخول في النسبة حيث يكون آمنًا.
- توحيد الحساب الديناميكي في الداش بورد وقاعدة البيانات وإنشاء وتحديث العملاء والتكاملات الخارجية.

## v1.7.0 - CRM reference v27 logic
- اعتماد `MZJ-CRM-main-v27-unread-customers-first-in-status-cards.zip` كمرجع وحيد لمنطق هذه المرحلة.
- إضافة تبويبي «سجل العملاء» و«فروقات حالات العملاء» في سجل عملاء التمويل.
- حساب فروقات الحالات من آخر حالة وصل إليها كل عميل حتى نهاية يوم البداية ونهاية يوم النهاية بتوقيت الرياض، وليس من عدد حركات التغيير.
- فتح محادثة العميل من سجل التمويل في تبويب متصفح جديد مع بقاء الصفحة والفلاتر كما هي.
- إضافة حقل «الفئة» كحقل مستقل لكل أقسام CRM وإدخاله ضمن نسبة اكتمال ملف العميل.
- إضافة كارت «الرسائل غير المقروءة» كآخر كارت في كل قسم، مع بقاء العميل في كارت حالته وترتيبه أولًا داخل الحالة عند وجود رسالة غير مقروءة.
- الاستماع الحي إلى `collectionGroup(messages)` بترتيب `createdAt desc` واعتماد الرسائل ذات `direction = in` فقط.
- حفظ حالة غير المقروءة في PostgreSQL بالحقول المتوافقة مع المرجع، وإزالتها عند فتح المحادثة وفق صلاحيات المستخدم الحالية.
- توحيد منطق تعليم القراءة/عدم القراءة في خدمة خادم واحدة لمنع التكرار بين التكاملات ومستمع Firestore.


## CRM settings v1.8.0
- Full-width editors with full-width tables for statuses, customer fields, sources, templates/messages, and status-template mappings.
- Server-side Mersal template synchronization using `MERSAL_TOKEN` and optional `MERSAL_API_ENDPOINT`.
- Rebuilt customer distribution settings with ordered members, rule preview, rule cards, and full assignment log.

## WhatsApp / Mersal worker v1.8.1

قوالب مرسال والإرسال لا يتصلان بمرسال مباشرة من Vercel. التوكن يبقى داخل Cloudflare Worker فقط.

1. ارفع الملف الكامل `workers/MZJ-WhatsApp-Mersal-Worker-v1.0.0-FULL.txt` في Worker مستقل.
2. أضف داخل Cloudflare Secrets:
   - `MZJ_GATEWAY_SECRET`
   - `MERSAL_TOKEN`
3. داخل Vercel احتفظ بنفس قيمة `MZJ_GATEWAY_SECRET`.
4. داخل الإعدادات > إعدادات CRM > Endpoints / Workers احفظ واتساب كالتالي:
   - Send URL: `https://YOUR-WORKER/send/mersal`
   - Health URL: `https://YOUR-WORKER/health`
   - Secret name: `MZJ_GATEWAY_SECRET`
5. زر مزامنة القوالب يشتق تلقائيًا `https://YOUR-WORKER/templates/mersal` من Send URL.


## v1.9.1 - Unified CRM automation core and transport-only channel Workers

- أُعيد بناء دورة المحادثة حول `Contact` واحد دائمًا، مع `Service Request` مستقل لكل طلب كاش أو تمويل أو خدمة عملاء.
- الرسالة الأولى تُحفظ كجهة اتصال ومحادثة ورسالة فقط، ولا يتم إنشاء ليد أو توزيعه قبل تحديد الخدمة، إلا للمصادر الموثوقة المعروفة مسبقًا مثل حاسبة التقسيط.
- رسالة اختيار الخدمة ونصها وترتيب الاختيارات والكلمات المقبولة والحالات النهائية تُدار من صفحة «قواعد الأوتوميشن»، بدون سؤال العميل عن الفرع.
- إضافة محرك قواعد مركزي مع Idempotency وسجل تشغيل ومهام مؤجلة، ونقل قرار وكيل صندوق الوارد والتصعيد من Worker إلى المنصة.
- إضافة سجل ملكية العميل: المسؤول السابق والجديد، القسم والفرع، السبب، المنفذ، والتاريخ، مع صفحة «عملاء تم نقلهم مني».
- فصل مسارات القناة إلى استقبال، نص، قالب، وسائط، ومزامنة قوالب. Worker واتساب/مرسال أصبح Transport فقط ولا يحتوي على توزيع أو حالات أو أوتوميشن.
- دعم الصور والصوت والفيديو وPDF واردًا وصادرًا مع تخزين R2 خاص وروابط مؤقتة وسجل تحميل حسب صلاحيات المستخدم.
- القالب المرتبط بالحالة يظهر داخل مكان الكتابة للمراجعة واستكمال المتغيرات قبل الإرسال.
- اتجاه المحادثة ثابت: رسالة العميل يسار، ورسالة مستخدم CRM أو الوكيل يمين.

### WhatsApp / Mersal Worker الحالي

استخدم الوركر الكامل داخل `workers/MZJ-Mersal-CRM-Worker-v1.11.5-Postgres-Inbound-FULL.txt`.

المسارات المعتمدة فقط:

- Inbound Webhook: `/webhook/mersal`
- Send text/template/media: `/send/mersal`
- Template Sync: `/templates/mersal`
- Health: `/health`

## Automation scheduling without Vercel Cron

هذه النسخة لا تستخدم Vercel Cron. المهام المؤجلة يتم تسجيلها داخل PostgreSQL ثم إرسال وقت الاستيقاظ إلى Cloudflare Queue عبر Worker مستقل. عند حلول الموعد، يستدعي Worker المسار الداخلي `/api/internal/automation-job`، والمنصة نفسها هي التي تفحص الشروط وتنفذ منطق الأوتوميشن.

متغيرات Vercel المطلوبة:
- `AUTOMATION_SCHEDULER_URL`
- `AUTOMATION_SCHEDULER_SECRET`

متغيرات Worker المجدول:
- `PLATFORM_AUTOMATION_CALLBACK_URL`
- Secret باسم `AUTOMATION_SCHEDULER_SECRET`
- Queue binding باسم `AUTOMATION_QUEUE`

## v1.9.3 - WhatsApp/Mersal unified send route fix

- واتساب/مرسال يعتمد مسار CRM واحدًا للنص الحر والقوالب: `/send/mersal`.
- عند إرسال قالب واتساب، المنصة تفضّل `text_send_url` ثم `send_url`، ولا تستخدم مسار قالب قديم منفصل إذا كان ما زال محفوظًا من نسخة سابقة.
- تهيئة CRM تنظف صفوف `whatsapp` و`mersal` القديمة وتوحّد `send_url` و`text_send_url` و`template_send_url` على نفس المسار.
- لم يتم تغيير Payload القالب: `waId`/`phone` مع `template_name` و`template_language` و`params`.
- لا يحتاج Worker واتساب/مرسال إلى تعديل لهذه المشكلة.

## v1.11.4 — إصلاح الإرسال والاستقبال الحالي لمرسال

- القالب الذي تقبله مرسال ويحمل `message_wamid` يظهر «تم الإرسال» حتى لو رجع HTTP غير متوقع.
- النص الحر يرسل من نفس المسار `/send/mersal` بعقد واضح `type=text` بدون خلطه بالقالب.
- الرد القادم من الهاتف عبر `/webhook/mersal` ينتقل إلى `/api/integrations/whatsapp` ويتخزن في PostgreSQL داخل نفس محادثة العميل.
- الوركر الكامل موجود في `workers/MZJ-Mersal-CRM-Worker-v1.11.5-Postgres-Inbound-FULL.txt` ومجلد `mersal-worker/`.
- لا توجد كتابة Firebase أو Firestore داخل وركر مرسال.


## v1.11.5 — إظهار رد العميل داخل الشات

- `/webhook/mersal` لا يكتب رسائل العميل في Firebase أو Firestore.
- كل رسالة واردة تُرسل مباشرة إلى `/api/integrations/whatsapp`.
- المنصة تحفظ الرسالة في PostgreSQL داخل `crm.messages` وتربطها بالمحادثة الموجودة حسب رقم العميل.
- لو PostgreSQL لم يقبل الرسالة، الوركر يعيد HTTP 502 حتى لا تضيع الرسالة بصمت.
- رابط المنصة الافتراضي داخل الوركر هو `https://mzj-platform.vercel.app/api/integrations/whatsapp`.
- يجب أن تكون قيمة `MZJ_GATEWAY_SECRET` واحدة في Vercel وCloudflare Worker.
