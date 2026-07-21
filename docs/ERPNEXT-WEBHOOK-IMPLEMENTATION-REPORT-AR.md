# تقرير تنفيذ ربط ERPNext المباشر بالتراكينج

## ما تم تنفيذه

- إضافة Endpoint جديد:
  - `/api/integrations/erpnext/sales-order`
- استقبال Sales Order مباشرة من ERPNext عند `on_submit`.
- تحويل بيانات ERPNext إلى نفس العقد الداخلي المستخدم حاليًا في Google Sheet.
- استخدام نفس دالة الكتابة في PostgreSQL بدل إنشاء منطق إدخال موازٍ.
- دعم أكثر من سيارة داخل طلب البيع الواحد.
- فصل صف رسوم التسجيل عن السيارات وإضافة قيمته إلى إجمالي الطلب.
- منع تكرار الطلب أثناء تشغيل ERPNext وGoogle Sheet معًا بالاعتماد على رقم طلب البيع.
- منع تكرار السيارة داخل الطلب بالاعتماد على VIN ثم ItemNo.
- دعم Custom Fields الشائعة داخل صفوف ERPNext مع رد تشخيصي `warnings` للحقول غير المعروفة.
- حماية الرابط بمفتاح `ERPNEXT_WEBHOOK_KEY` وإرجاع خطأ واضح إذا لم يتم ضبطه.
- الإبقاء على مسار Google Sheet الحالي كما هو:
  - `/api/integrations/tracking/orders`
- عدم تعديل واجهة التراكينج أو CRM أو العمليات أو الصلاحيات أو تصميم المنصة.
- لا يوجد Migration جديد لقاعدة البيانات؛ الربط يستخدم الجداول الحالية.

## الملفات المعدلة

- `.env.example`
- `api/index.ts`
- `server/integrations/tracking-orders.ts`
- `scripts/check-tracking-module-v112.mjs`

## الملفات الجديدة

- `server/integrations/erpnext-sales-order.ts`
- `docs/ERPNEXT-WEBHOOK-TRACKING-AR.md`
- `docs/ERPNEXT-WEBHOOK-IMPLEMENTATION-REPORT-AR.md`
- `integration-assets/MZJ-ERPNext-Sales-Order-Webhook-JSON.txt`

## الاختبارات المنفذة

- فحص امتدادات Imports الخاصة بـVercel API: ناجح.
- فحص Tracking module بعد إضافة المسار الجديد: ناجح.
- TypeScript strict check للملفين المعدلين والجديد مع تعريفات اختبار محلية: ناجح.
- Runtime normalization test لطلب يحتوي على سيارة + رسوم تسجيل + ضريبة 15%: ناجح.
- تم التأكد من استخراج رقم الطلب والعميل والمندوب وبيانات السيارة وVIN والألوان والمورد والمبالغ.

## ملاحظة بيئة الاختبار

تعذر تشغيل `pnpm install` و`pnpm build` الكاملين داخل بيئة العمل بسبب عدم توفر اتصال بسجل npm لتنزيل pnpm والحزم. لم يتم تغيير أي Dependency أو Lockfile، وتمت مراجعة الملفات الجديدة TypeScript وتشغيل اختبارات التحويل والفحوصات المحلية المذكورة أعلاه.
