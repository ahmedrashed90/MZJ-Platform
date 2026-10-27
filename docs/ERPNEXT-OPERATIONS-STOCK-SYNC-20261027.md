# MZJ — NEXT ERP Purchase Receipt → Operations Inventory (2026-10-27)

## النطاق

- تم البناء على آخر سورس كامل للمنصة المرفوع بتاريخ 27 أكتوبر 2026، دون تغيير صفحات أو منطق CRM/Marketing/Tracking.
- الوركر الأصلي `MZJ NEXT ERP -> WordPress Car Sync` ما زال ينفذ نفس `processPurchaseReceipt()` و`wordpressSyncCar()` ونفس Payload للموقع، بما فيها أحداث `on_cancel`.
- الإضافة الجديدة للمخزون مستقلة، وتعمل على `on_submit` فقط. لا يتم حذف سيارات العمليات أو عكس تاريخ البيع عند إلغاء إيصال الاستلام.
- لا يتم تحديث أي سيارة موجودة بنفس الهيكل؛ إدخال جديد فقط. حالات تحت التسليم/تم التسليم/مؤرشفة محفوظة ولا يمكن إرجاعها من هذا التكامل.
- تكامل حالات Serial No الحالي تم تحصينه لإبقاء السيارات ذات الملاحظات أو حالات البيع/التسليم بدون تغيير.

## الحقول

المصدر هو `items[].serial_no` داخل Purchase Receipt نفسه، وليس فلتر `Serial No.purchase_document_no` الذي قد يتغير بعد حركة مخزنية. لكل هيكل نقرأ `Serial No/<VIN>` لمعرفة الوضع الحالي.

| NEXT Serial No | منصة MZJ - العمليات |
| --- | --- |
| `serial_no` / `name` | `vin` (نص؛ الاحتفاظ بالأصفار البادئة) |
| `type` | `car_name` |
| `class` | `statement` |
| `agent` | `agent_name` |
| `custom_color` | `interior_color` |
| `custom_external_color` | `exterior_color` |
| `model` | `model_year` |
| `warehouse` | `location_id` عبر جدول صريح |
| `car_status` | `status_code` مع أولوية الملاحظة |
| `detail` | `state_note` (عمود ملاحظات الظاهر في المخزون) |

المكان: `الصالة - منزل → hall`، `معرض القادسية → qadisiyah`، `معرض الملتقي - ممزال → multaqa`، `خارج الصالة - ممزال → hall_out`.

الحالة: وجود نص في `detail` → `has_notes` مهما كانت حالة ERP، ثم `محجوزة → reserved`، ثم `متاحة للحجز → available_for_sale`. المستودعات والحالات غير المعروفة لا نخمّنها ولا نضعها خطأً؛ الطلب يفشل بوضوح ويظل قابلاً لإعادة المحاولة.

اللوحة لا يوجد لها حقل في البيانات المؤكدة؛ تظل فارغة في السيارات الجديدة، ولا نلمس لوحة سيارة موجودة.

## 1 — نشر منصة MZJ أولًا

ارفع ZIP الكامل كآخر سورس للمنصة، ثم أضف في Vercel Environment Variables:

`ERPNEXT_STOCK_SYNC_KEY` = قيمة سرية طويلة عشوائية (نفس قيمة Cloudflare `MZJ_STOCK_SYNC_KEY`).

نقطة الاستقبال الجديدة (محمية بالمفتاح، لا تعتمد على Cookie):

`POST https://mzj-platform.vercel.app/api/integrations/erpnext/purchase-receipt-stock`

Header: `X-MZJ-Stock-Key: <SECRET>`

مثال طلب Postman (لا يكتب في قاعدة البيانات):

```json
{
  "receipt": "MAT-PRE-2026-00145",
  "event": "on_submit",
  "dryRun": true,
  "vehicles": [
    {"serial_no":"283956","type":"ستاريا","class":"بنزين 9 راكب اتوماتيك 3500 سي سي","agent":"المجدوعي","model":"2027","custom_color":"اسود","custom_external_color":"اسود","warehouse":"معرض الملتقي - ممزال","car_status":"متاحة للحجز","detail":"يوجد خدش بالسقف باب الراكب + السائق"},
    {"serial_no":"283542","type":"ستاريا","class":"بنزين 9 راكب اتوماتيك 3500 سي سي","agent":"المجدوعي","model":"2027","custom_color":"اسود","custom_external_color":"اسود","warehouse":"خارج الصالة - ممزال","car_status":"محجوزة","detail":""}
  ]
}
```

Expected: `ok:true`, `dryRun:true`, `writes:0`, نتائج `would_insert` أو `existing_unchanged`. نتيجة `existing_unchanged` تعني أن السيارة موجودة ولن تتغير إطلاقًا، حتى لو مباعة.

**تنبيه:** `dryRun` لا ينفذ INSERT/UPDATE ولا يستدعي `ensureOperationsSchema`، لكنه يحتاج قاعدة بيانات المنصة نفسها متاحة للقراءة. لا يمكن التأكد من الحالة الحقيقية دون نشر المنصة على بيئة الاختبار/الإنتاج.

## 2 — اختبار الوركر بدون لمس WordPress

احتفظ بكل متغيرات الوركر الأصلية (NEXT_API_KEY/NEXT_API_SECRET/WP_USERNAME/WP_APP_PASSWORD/FRAPPE_WEBHOOK_SECRET/WORKER_ADMIN_TOKEN...) كما هي.

أضف إلى Secrets / Variables:

- `MZJ_PLATFORM_URL`: عنوان المنصة (مثال `https://mzj-platform.vercel.app`)
- `MZJ_STOCK_SYNC_KEY`: **نفس** `ERPNEXT_STOCK_SYNC_KEY` على Vercel.

يمكن عمل Preview قبل إعداد D1 أو Queue:

`POST https://<YOUR-WORKER>.workers.dev/operations/preview`

Headers: `Authorization: Bearer <WORKER_ADMIN_TOKEN>` + `Content-Type: application/json`

```json
{"receipt":"MAT-PRE-2026-00145","checkPlatform":true}
```

هذه العملية تقرأ إيصال الاستلام وكل Serial No الحالية، ثم تستدعي نقطة استقبال المنصة مع `dryRun:true`، ولا تستدعي WordPress ولا تكتب سيارات.

## 3 — التفعيل الآمن وإعادة المحاولة الدائمة

**لا تفعّل المزامنة التلقائية إلا بعد نجاح Postman.** التفعيل يحتاج Cloudflare D1 (Outbox دائم)، وCloudflare Queue اختياري لكنه مطلوب لتنفيذ الفواصل الدقيقة 5/15 ثانية. مع D1 فقط، تحصل محاولات لاحقة عبر Cron كل دقيقة تقريبًا.

1. أنشئ D1 Database باسم `mzj-operations-stock` واربطه بالوركر باسم Binding: `MZJ_STOCK_DB`.
2. نفّذ SQL الموجود في `cloudflare-worker/stock-sync-d1.sql` داخل قاعدة D1 في Cloudflare (مرة واحدة فقط).
3. أنشئ Queue باسم `mzj-operations-stock`، وأضفها Producer binding باسم `MZJ_STOCK_QUEUE` وConsumer إلى **نفس الوركر**.
4. اضبط Consumer `max_retries` إلى `100` (الحد الأقصى الحالي في Cloudflare)، ويفضل `max_batch_size=1`. حتى إذا انتهت محاولات Queue، تظل المهمة معلقة في D1 ويستأنفها Cron.
5. أضف Scheduled Trigger `* * * * *` لنفس الوركر.
6. احتفظ بجميع متغيرات إعداد الموقع القديمة كما هي، وحدث كود الوركر الكامل فقط بعد اختبار المنصة والـ Preview.

ملف `cloudflare-worker/wrangler-ops-example.toml` مثال للـBindings/Triggers، **وليس** ملف نشر جاهز بدون ضبط الاسم والـD1 ID؛ ادمجه في إعداد الوركر القائم فقط.

**التجربة الفعلية اليدوية بعد الموافقة:**

`POST https://<YOUR-WORKER>.workers.dev/operations/manual`

Header: `Authorization: Bearer <WORKER_ADMIN_TOKEN>`

```json
{"receipt":"MAT-PRE-2026-00145","event":"on_submit"}
```

الطلب يحفظ مهمة في D1 أولًا ثم يرسلها عبر Queue؛ كل إرسال يُعاد بأمان لأن API لا يعدّل سيارة موجودة. لا تستخدم `/manual` القديم للاختبار ده؛ المسار القديم كما هو لمزامنة الموقع.

## 4 — التتبع عند حدوث فشل

استعلام D1 للمتابعة:

```sql
select receipt,state,attempts,next_attempt_at,last_error,delivered_at
from mzj_operations_stock_jobs
order by updated_at desc limit 100;
```

محاولات: الأولى فور تسليم Queue؛ بعد الفشل 5 ثوانٍ، ثم 15 ثانية، ثم 60/120/... حتى ساعة. يستمر Cron في المحاولة طالما `state='pending'` حتى لو انتهت صلاحية Queue. لن تُعتبر المهمة ناجحة إلا إذا ردت المنصة بنتيجة تغطي كل الهياكل.

إذا فشل ربط مستودع جديد غير معتمد، تظل المهمة معلقة ويظهر اسم المستودع في `last_error`؛ يلزم إضافة مطابقته إلى `ERP_WAREHOUSE_LOCATIONS` في سورس المنصة بعد اعتمادها.

## 5 — المعالجة عند إلغاء الاستلام

حدث `on_cancel` يستمر في مسار WordPress الأصلي دون تغيير. لا يحذف تكامل العمليات أي هيكل تلقائيًا؛ طلبات البيع والتسليم والحركة تتطلب تسوية بشرية، ولذلك يتم تجاهل الإلغاء في مسار العمليات فقط. إذا وصل تكرار قديم لـ `on_submit` بعد إلغاء المستند، فلن يُستورد لأن docstatus لم يعد 1.

## نطاق الاختبارات التي تم تنفيذها محليًا

- فحص بناء جاف لكود الوركر (`node --check`) ناجح.
- اختبار قراءة 2 VIN من مستند الاستلام الأصلي، حتى لو تغيير `purchase_document_no` للسيارة الثانية؛ ناجح باستخدام Fake NEXT API.
- اختبار `dryRun` في نقطة المنصة: `writes=0`، ملاحظة → `has_notes`، محجوزة → `reserved`، وسجل قديم مباَع → `existing_unchanged`؛ ناجح.
- اختبار Outbox/Queue بمحاكاة فشل HTTP 503 ثم نجاح: حفظ المهمة، `retry 5s`، ثم إغلاقها، بدون استدعاء WordPress؛ ناجح.
- **لم يتم نشر أي سورس أو إرسال طلب إلى قاعدة إنتاج فعلية**. لم يتوفر اتصال باختبار فعلي لـPostgreSQL/Cloudflare من بيئة التسليم. اختبارات Runtime السابقة باستخدام Mock وليس ببيانات إنتاج.
