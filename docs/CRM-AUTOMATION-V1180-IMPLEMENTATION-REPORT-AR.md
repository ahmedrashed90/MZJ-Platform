# تقرير إعادة بناء إعدادات الأوتوميشن — MZJ Platform v1.18.0

## 1. ملخص التنفيذ

تمت إعادة بناء نظام إعدادات أوتوميشن دخول العملاء من المصدر الأساسي للمنصة، بدون إضافة طبقة إصلاح فوق التنفيذ القديم. أصبح تعريف الفلو والرسائل والاختيارات والخطوات وسياسة التشغيل محفوظًا مركزيًا داخل PostgreSQL، بينما أصبح Facebook Worker مسؤولًا عن النقل التقني فقط.

الإصدار الناتج:

- المنصة: `1.18.0`
- Migration: `crm-automation-flow-rebuild-v1.18.0`
- Facebook Worker: `mzj-facebook-transport-v2.0.0`

## 2. الفلو الافتراضي بعد تشغيل الـMigration

### البداية

1. مرحباً بك في مجموعة محمد بن ذعار العجمي للسيارات 👋
2. برجاء اختيار الخدمة:
   - 💰 مبيعات الكاش
   - 🏦 مبيعات التمويل
   - 🛠 خدمة العملاء

### مبيعات الكاش

- تصنيف الطلب كاش.
- استدعاء محرك دخول وتوزيع العملاء المركزي.
- عدم اختيار المندوب داخل الأوتوميشن أو الـWorker.
- إرسال رسالة النهاية مرة واحدة بعد نجاح الإجراء النهائي.

### مبيعات التمويل

الترتيب الافتراضي المحفوظ في قاعدة البيانات:

1. برجاء إدخال بيانات التمويل 👇\nالاسم
2. السيارة
3. رقم الجوال
4. التحقق من رقم الجوال السعودي وتطبيعه.
5. إنشاء أو تحديث العميل وطلب التمويل.
6. استدعاء محرك التوزيع المركزي لمندوب التمويل والكول سنتر.
7. إرسال رسالة النهاية بعد نجاح الخطوات والإجراء النهائي.

### خدمة العملاء

- تصنيف الطلب كخدمة عملاء.
- استدعاء محرك التوزيع المركزي لخدمة العملاء.
- إرسال رسالة النهاية مرة واحدة بعد نجاح الإجراء النهائي.

## 3. صفحة إعدادات الأوتوميشن

تم إنشاء صفحة احترافية داخل:

`الإعدادات → إعدادات CRM → إعدادات الأوتوميشن`

وتحتوي على:

- الاسم والحالة العامة.
- سياسات التشغيل: كل رسالة، مرة كل 24 ساعة، مدة مخصصة بالدقائق أو الساعات أو الأيام.
- المنصات والـWorkers وحالة الربط وHealth Check وآخر نجاح وآخر خطأ.
- رسائل البداية مع الإضافة والحذف والتفعيل وإعادة الترتيب.
- الاختيارات والردود المقبولة والنصوص والأرقام وPayloads.
- خطوات من نوع رسالة فقط، سؤال نصي، رقم جوال، واختيار.
- ربط إجابة الخطوة بحقل العميل.
- قواعد التحقق ورسائل الخطأ وعدد المحاولات.
- إعداد الإجراء النهائي لكل اختيار.
- معاينة مباشرة للفلو.

الحذف من الواجهة يتم كأرشفة منطقية حتى لا تعود العناصر المحذوفة بعد الحفظ، مع إبقاء السجلات التاريخية للجلسات سليمة.

## 4. الفصل المعماري

### إعدادات الأوتوميشن مسؤولة عن

- متى يبدأ الفلو.
- الرسائل والاختيارات والخطوات.
- التحقق من الإجابات وحفظها.
- استدعاء الإجراء النهائي.
- اختيار المنصة والـWorker المرتبط.

### دخول وتوزيع العملاء مسؤول عن

- الأقسام والفروع.
- الموظفين المؤهلين.
- Round Robin وترتيب الدور.
- مندوب المبيعات أو خدمة العملاء.
- مندوب الكول سنتر.
- تسجيل نتيجة التوزيع.

لا توجد نسخة ثانية من منطق التوزيع داخل محرك الأوتوميشن أو داخل Facebook Worker.

## 5. إعادة تنظيم التنفيذ القديم

كانت جداول `automation_settings` و`automation_events` و`automation_jobs` مستخدمة لمهام داخلية وتنبيهات لا تمثل فلو العملاء. تم فصلها كما يلي:

- `crm.automation_settings` → `crm.crm_runtime_settings`
- `crm.automation_events` → `crm.background_events`
- `crm.automation_jobs` → `crm.background_jobs`

ثم تم تخصيص نطاق `automation_*` الجديد لفلو العملاء فقط. تم حذف الملف القديم المختلط `server/_crm-automation.ts` واستبداله بخدمتين منفصلتين:

- `server/_crm-background-jobs.ts`
- `server/_crm-flow-engine.ts`

## 6. قاعدة البيانات

ملف الترحيل:

`database/migrations/20260723_crm_automation_flow_rebuild_v1180.sql`

الـMigration ينفذ داخل Transaction واحدة، وينقل مهام الخلفية القديمة إلى أسمائها الجديدة، ثم يحذف بيانات وجداول فلو الأوتوميشن السابقة ويعيد إنشاء النظام الجديد والبيانات الافتراضية.

الجداول الجديدة:

- `crm.automation_definitions`
- `crm.automation_platforms`
- `crm.automation_start_messages`
- `crm.automation_choices`
- `crm.automation_choice_replies`
- `crm.automation_steps`
- `crm.automation_step_options`
- `crm.automation_sessions`
- `crm.automation_inbound_events`
- `crm.automation_answers`
- `crm.automation_outbound_messages`
- `crm.automation_final_actions`

تمت إضافة Constraints وUnique Indexes لمنع:

- جلستين نشطتين لنفس المحادثة أو جهة الاتصال.
- تكرار الحدث الوارد.
- تكرار إجابة نفس الحدث والخطوة.
- تكرار الرسالة الصادرة بنفس مفتاح Idempotency.
- تكرار الإجراء النهائي للجلسة.

> تحذير: هذا الملف يحذف بيانات فلو الأوتوميشن السابقة عمدًا ويزرع الفلو الافتراضي الجديد. يجب أخذ نسخة احتياطية من قاعدة البيانات قبل تشغيله في الإنتاج.

## 7. محرك الجلسات ومنع التكرار

- قفل Advisory Lock لكل محادثة داخل PostgreSQL.
- معالجة الرسائل المتزامنة بالترتيب دون `setTimeout`.
- تسجيل كل حدث وارد قبل المعالجة.
- إرسال كل سؤال برسالة صادرة لها Idempotency Key ثابت.
- عدم الانتقال للخطوة التالية إلا بعد نجاح حقيقي من مزود الرسائل.
- الاحتفاظ بالإجابة الصحيحة إذا فشل إرسال السؤال التالي.
- إعادة محاولة السؤال أو الإجراء النهائي دون تكرار الإجابة أو العميل أو التوزيع.
- حماية الاسم الذي يكتبه العميل من استبداله لاحقًا باسم حساب Facebook.
- دمج جهة الاتصال عند اكتشاف رقم جوال مكرر باستخدام خدمة الدمج المركزية.

## 8. Facebook Worker

المسارات المتوافقة المحفوظة:

- `GET /` و`GET /health`
- `GET/POST /meta/webhook`
- aliases القديمة للـWebhook
- `POST /automation` وaliases القديمة
- `POST /send/facebook` وaliases القديمة

مسؤولياته الحالية فقط:

- التحقق من Meta Webhook والتوقيع.
- استقبال النصوص وQuick Replies وPostbacks والوسائط.
- تحديد PSID الصحيح.
- توليد Event ID ثابت.
- تمرير الحدث للمنصة.
- إرسال النصوص والأزرار والوسائط.
- استخدام Facebook Graph API كمسار أساسي، مع ManyChat كـfallback للنص عند تهيئته.
- إعادة Provider Message ID وHTTP Status والخطأ الحقيقي.

تم حذف أي معرفة داخله برسائل أو خطوات كاش أو تمويل أو خدمة عملاء.

## 9. الملفات الرئيسية المعدلة

### ملفات جديدة

- `database/migrations/20260723_crm_automation_flow_rebuild_v1180.sql`
- `server/_crm-background-jobs.ts`
- `server/_crm-flow-engine.ts`
- `server/crm/automation-settings.ts`
- `src/crm/components/CrmAutomationSettings.tsx`
- `scripts/check-crm-automation-flow-v1180.mjs`
- `facebook-worker/*`
- `workers/MZJ-Facebook-Worker-v2.0.0-FULL.js`

### ملفات حُذفت

- `server/_crm-automation.ts`
- `scripts/check-crm-entry-distribution-v192.mjs`

### ملفات محدثة

- `api/index.ts`
- `package.json`
- `server/_db.ts`
- `server/_crm-schema.ts`
- `server/_crm-auto-template.ts`
- `server/_crm-lifecycle.ts`
- `server/_crm-messaging.ts`
- `server/_integration-processor.ts`
- `server/crm/contacts.ts`
- `server/crm/conversations.ts`
- `server/crm/entry-routing.ts`
- `server/crm/settings.ts`
- `server/internal/automation-job.ts`
- `src/crm/components/CrmEntryRoutingSettings.tsx`
- `src/crm/pages/CrmAdminPage.tsx`
- `src/styles.css`

## 10. نتيجة الاختبارات

نجح فعليًا داخل بيئة العمل:

- Transpile syntax لجميع ملفات TypeScript/TSX: `126/126 PASS`.
- API/server import extension check: `PASS`.
- اختبارات معمارية الأوتوميشن والفلوهات الافتراضية: `PASS`.
- محاكاة كاش وتمويل ورقم خاطئ ثم صحيح وخدمة عملاء ومنع التكرار وسياسات التشغيل: `PASS`.
- اختبارات Facebook Worker باستخدام Fetch mocks: `PASS`.
- جميع اختبارات التوافق المتاحة لـCRM والتقارير والإعدادات والتراكينج والعمليات وERPNext: `PASS`.

لم يمكن تشغيل اختبار PostgreSQL حي أو بناء Vite كامل داخل بيئة التسليم لأن `DATABASE_URL` غير مهيأ، وحزم المشروع غير مثبتة، ومحاولة تنزيلها لم تتوفر لها شبكة. تشغيل `tsc -b` وصل إلى أخطاء Missing Modules مثل React وNode types، وليس أخطاء Syntax من الملفات المعدلة. لذلك يلزم تنفيذ اختبار النشر النهائي أدناه على بيئة Staging المتصلة بقاعدة البيانات والـWorkers قبل اعتماد الإنتاج.

## 11. خطوات نشر المنصة على Vercel

1. أخذ Backup من PostgreSQL.
2. تشغيل ملف SQL مرة واحدة على قاعدة Staging.
3. نشر السورس على Vercel.
4. التأكد من متغيرات المنصة الحالية، وأهمها:
   - `DATABASE_URL`
   - `MZJ_GATEWAY_SECRET`
   - متغيرات الجلسات والمصادقة الحالية.
5. فتح إعدادات CRM ثم إعدادات الأوتوميشن.
6. ربط منصة Facebook بالـWorker المسجل في إعدادات التكامل.
7. التحقق من ظهور Worker كجاهز ومسار الإرسال وHealth Check.
8. تنفيذ اختبارات القبول من حساب Facebook تجريبي.

## 12. خطوات نشر Facebook Worker على Cloudflare

من مجلد `facebook-worker`:

```bash
npm install
npx wrangler secret put MZJ_GATEWAY_SECRET
npx wrangler secret put FB_VERIFY_TOKEN
npx wrangler secret put FB_APP_SECRET
npx wrangler secret put FB_PAGE_ACCESS_TOKEN
npx wrangler secret put MANYCHAT_API_TOKEN
npx wrangler deploy
```

المتغيرات المطلوبة أو الموصى بها:

- `PLATFORM_INBOUND_URL`
- `MZJ_GATEWAY_SECRET`
- `FB_VERIFY_TOKEN`
- `FB_APP_SECRET`
- `FB_PAGE_ACCESS_TOKEN`
- `FB_PAGE_ID`
- `MANYCHAT_API_TOKEN` اختياري كـfallback.
- `PLATFORM_MEDIA_URL` اختياري إذا كان مختلفًا عن المسار الافتراضي.
- `DEBUG_KV` اختياري.

لا يتم وضع قيم الأسرار داخل السورس أو التقرير.

## 13. اختبارات القبول المطلوبة على Staging

1. كاش: رسالة أولى → ترحيب → اختيار كاش → إنشاء وتصنيف وتوزيع → رسالة النهاية.
2. تمويل: ترحيب → اختيار تمويل → الاسم → السيارة → جوال خاطئ → رسالة تحقق → جوال صحيح → إنشاء وتوزيع مندوب التمويل والكول سنتر → رسالة النهاية.
3. خدمة العملاء: اختيار الخدمة → إنشاء وتصنيف وتوزيع → رسالة النهاية.
4. إعادة إرسال نفس Webhook والتأكد من عدم تكرار الرسائل أو العميل أو التوزيع.
5. اختبار كل سياسة تشغيل.
6. إيقاف الأوتوميشن والتأكد أن الرسائل الواردة تظل محفوظة دون بدء جلسة.
7. إيقاف Worker أو المنصة والتأكد أن الفلو لا يبدأ وأن الخطأ يظهر في الإعدادات دون كشف Secrets.
