# MZJ Marketing Native Integration — Architecture

## النطاق المنفذ

تم بناء أساس موديول تسويق Native واسع داخل منصة MZJ باستخدام React وTypeScript وVercel API وPostgreSQL، بدون تشغيل تطبيق التسويق القديم داخل iframe، وبدون نسخ `merged-patches.js` أو إضافة Firebase إلى Runtime التسويق.

هذه النسخة تنفذ الأساس المعماري والفلوهات المركزية والواجهات المطلوبة، لكنها لا تدّعي اكتمال التكاملات الخارجية التي تحتاج مفاتيح واعتمادات واختبارات إنتاجية، ولا Parser كامل لمحتوى XLSX، ولا Rendering فيديو فعلي داخل Electron.

## البنية

- `src/marketing/**`: Layout، الصفحات، المكونات، API client، domain labels، وCSS معزول.
- `server/marketing/**`: Auth، API dispatcher، إنشاء الحملات والأجندة، المهام، الاعتمادات، التقدم، الملفات، Publish Prep، الحضور، الاستوك، الباقات، التقارير، الإعدادات، والأجهزة.
- `database/migrations/20260723_marketing_native_phase1.sql`: توسيع الجداول الحالية وإضافة الجداول العلائقية للموديول.
- `database/migrations/20260723_marketing_publisher_runtime.sql`: خطط النشر المحلي والـJobs والـLeases.
- `database/migrations/20260723_marketing_publish_reconciliation.sql`: ربط Targets تجهيز النشر بTargets الجدول الأصلي لمنع التكرار.
- `marketing-publisher-agent/**`: عميل Node محلي لمسح مجلدات الأجندة وربطها بالمنصة عبر Device Token فقط.

## قواعد البيانات

تم الحفاظ على الجداول الأصلية التالية وتوسيعها Additive:

- `marketing.campaigns`
- `marketing.creatives`
- `marketing.tasks`

الجداول الجديدة تفصل الكتالوج، العلاقات، الميزانية، الجدول، Task Template، الإجراءات، الملفات، Publish Prep، المنصات، الحضور، الباقات، Checklist، التصوير، والأجهزة. لم يتم إنشاء `campaigns_v2` أو Tasks موازية.

## الفلو الأساسي

- إنشاء حملة: 5 خطوات.
- إنشاء أجندة: 3 خطوات وتستخدم نفس نظام الحملات والمهام.
- كل Creative Instance مستقل بالـUUID.
- كل Execution User × Content User ينتج Pair ثابتًا.
- لكل Pair مهمة محتوى ومهمة تنفيذ تعتمد على Content Task ID الدقيقة.
- اعتماد Template يفتح مهمة التنفيذ المرتبطة بنفس Pair فقط.
- Progress مركزي ويمنع اكتمال المهمة التي تتطلب ملفًا نهائيًا دون ملف فعال.
- Task Template والملفات النهائية ترفع فعليًا إلى R2 عبر Presigned URL؛ لا توجد مسارات `pending-upload` شكلية.

## الأمن

- جلسة المنصة المركزية للواجهات والـAPI.
- صلاحيات مستقلة للتسويق وتحقق Server-side.
- فحص ملكية المهمة قبل الرفع والتنزيل.
- فحص امتداد وحجم وMIME ومسار التخزين.
- Device Tokens عشوائية؛ المخزن في PostgreSQL هو SHA-256 فقط.
- Agent لا يتصل بـPostgreSQL أو Firebase ولا يقرأ توكنات المنصات.
- الاستوك Read-only من `operations.vehicles`؛ البيانات التسويقية تخزن في `marketing.*`.
- لا يتم إرجاع Secrets للواجهة.

## حالة التكاملات الخارجية

تم بناء Models وصفحات الحالة والـCapability boundaries، لكن النشر الإنتاجي وOAuth الفعلي يحتاجان مفاتيح واعتمادات خارجية واختبارات بيئة حقيقية. TikTok يظل Sandbox/Review وSnapchat يظل Waiting Allowlist حتى وصول الموافقات.
