# نظام العمليات Native — MZJ Platform v1.13.3

## المصدر المعتمد

تم البناء داخل نسخة كاملة من `MZJ-Platform-v1.13.2-Tracking-FULL` فقط. استُخدم سورس العمليات القديم لفهم الفلو والحقول والحالات، ولم تُنسخ منه صفحات HTML أو JavaScript أو CSS أو Firebase أو صلاحيات مبنية على الإيميل.

## التبويبات النهائية

1. مخزون السيارات.
2. إدارة السيارات.
3. الحركة.
4. طلبات النقل.
5. الموافقات.
6. جميع السيارات.
7. سجل الحركات.
8. الأرشيف.

لا توجد Dashboard عمليات مستقلة، ولا Login مستقل، ولا Tracking أو Media قديمان داخل وحدة العمليات.

## مصادر الحقيقة

- السيارة والمكان والحالة الحالية: PostgreSQL داخل `operations.vehicles` و`operations.locations` و`operations.vehicle_statuses`.
- حركة السيارة: `operations.movements` مع `operations.movement_batches` للحركة الجماعية.
- دورة موافقات التسليم: `operations.vehicle_approval_cycles`، وتاريخ الإجراءات في `operations.vehicle_approval_events`.
- طلب النقل ومراحله: `operations.transfer_requests` و`operations.transfer_request_vehicles` و`operations.transfer_request_events`.
- حالة Tracking ونسبة تقدمه: نظام Tracking نفسه. العمليات تقرأ البيانات بصورة مجمعة ولا تعيد حساب النسبة.
- سجل الحذف النهائي للسيارة: `audit.vehicle_deletions`، وهو مستقل عن سجل السيارة حتى يبقى بعد الحذف.
- الأحداث القابلة للاستخدام في نظام الإشعارات المركزي: `operations.event_outbox`.

## قاعدة البيانات

المهاجرة الرئيسية:

`database/migrations/20260720_operations_native.sql`

المهاجرة Additive وغير تدميرية قدر الإمكان، وتشمل:

- كتالوج الحالات الفعلية للسيارة.
- ربط المواقع بالفروع.
- سجل ملاحظات الحالات.
- التشيك الحالي وتاريخه لكل عنصر.
- دفعات الحركة والحركات الفردية.
- دورات الموافقات والتراجع والملاحظات.
- مراحل وأحداث طلبات النقل.
- دفعات وصفوف استيراد Excel.
- الأرشيف وسجل الحذف المستقل.
- Event Outbox.
- Source identity وSource fingerprint للتراكينج.
- صلاحيات العمليات وحذف طلب التراكينج.
- إزالة الاعتماد على `orderNumber` بوصفه هوية فريدة وحيدة.

المهاجرة قابلة لإعادة التشغيل. توجد آلية `operations.system_migrations` وقفل Advisory لمنع تشغيلها المتزامن من أكثر من Request.

## الفلوهات الأساسية

### الحركة

- تبويب واحد يدعم سيارة أو عدة سيارات.
- لكل سيارة State وتشيك وملاحظات مستقلة.
- يمنع اختيار السيارة مرتين.
- يتم إنشاء سجل الحركة قبل أي سجل تابع يحتاج `movement_id`.
- الحركة الجماعية Atomic؛ فشل سيارة واحدة يعمل Rollback للجميع.
- تغيير الموقع والحالة والحركة وسجل الملاحظات يتم داخل Transaction.
- لا يقبل `مباع تم التسليم` إلا بعد مرور السيارة بـ`مباع تحت التسليم` واكتمال الموافقة المالية والإدارية في دورة التسليم الحالية.

### الموافقات

- المالية والإدارية مستقلتان.
- التراجع أو مسح الموافقات يتطلب سببًا.
- تعديل بيانات السيارة لا يصفر الموافقات.
- اكتمال الموافقتين لا يغير حالة السيارة تلقائيًا.
- الانتقال إلى `مباع تم التسليم` يظل حركة رسمية مستقلة.

### طلبات النقل

- إنشاء طلب لسيارة أو عدة سيارات داخل Transaction واحدة.
- المراحل: تم استلام الطلب ← تم إرسال السيارة ← تم استلام السيارة ← تم الانتهاء.
- استلام السيارة يحدث تحديث المكان وإنشاء الحركة وتحديث مرحلة الطلب داخل Transaction واحدة.
- حذف الطلب مسموح قبل أول إجراء فعلي فقط، مع سبب وسجل تدقيق.
- بعد بدء التنفيذ يستخدم إلغاء الطلب، مع الاحتفاظ بكل التاريخ.
- صلاحيات المرحلة تتحقق من الفرع أو الموقع المسؤول على السيرفر.

### استيراد Excel

الأوضاع:

1. استبدال كامل.
2. إضافة فوق الحالي.
3. تحديث من الشيت.

القواعد:

- Preview قبل التنفيذ مع عدد الإضافات والتحديثات والتجاوزات والأخطاء.
- الاستبدال الكامل له Permission مستقلة وتأكيد صريح.
- الاستبدال لا يحذف تاريخ السيارة؛ السيارات غير الموجودة في الملف تُؤرشف مع Snapshot وتاريخها كامل.
- الحقول الفارغة لا تمسح القيم القديمة في التحديث.
- الشيت لا يعدل الحركة أو الموافقات أو Tracking أو Audit.
- لا يسمح بإدخال `مباع تحت التسليم` أو `مباع تم التسليم` من Excel لتجنب تجاوز فلو الحركة والموافقات.
- VIN يعامل كنص ويحافظ على الأصفار في بدايته.

### مسح السيارة

- Permission: `operations.vehicle.delete` أو `system_admin`.
- السبب إجباري.
- يعاد فحص العلاقات داخل Transaction وبعد قفل السيارة.
- يرفض الحذف إذا وجدت حركات أو موافقات أو تشيك أو طلبات نقل أو Tracking أو أرشيف أو Audit تشغيلي أو Events مرتبطة.
- لا يعتمد على Cascade لحذف التاريخ.
- يحفظ Snapshot كاملًا في `audit.vehicle_deletions` قبل الحذف.

### مسح طلب Tracking

- Permission: `tracking.orders.delete`.
- يتطلب كتابة رقم الطلب كاملًا وسبب الحذف.
- يحفظ Snapshot للطلب والسيارات والمراحل والأحداث والرسائل وهوية المصدر.
- يحذف بيانات الطلب من Tracking داخل Transaction ولا يحذف سيارات العمليات.
- لا ينشئ حظرًا دائمًا على رقم الطلب.
- نفس نسخة المصدر القديمة لا تعود، لكن طلبًا جديدًا بنفس رقم الطلب ومن Source identity جديدة يُقبل.
- لا يغير صف Google Sheet القديم أو `PlatformSynced` من داخل المنصة.

## الجدول الاحترافي

جدول المخزون:

- ممتد بعرض الكارت.
- رأس ثابت.
- تمرير أفقي من أعلى وأسفل ومتزامن في الاتجاهين.
- تغيير عرض الأعمدة بالسحب باستخدام Pointer Events.
- Double click للضبط التلقائي.
- Reset للمقاسات.
- حفظ المقاسات في Local Storage كتفضيل واجهة فقط، وليس كمصدر بيانات أو صلاحيات.
- Pagination وفلترة من السيرفر.
- التصدير يجلب جميع النتائج المطابقة للفلاتر والصلاحيات، وليس الصفحة الحالية فقط.

## Structured Errors

الـAPI يعيد Contract موحدًا يحتوي على:

- `code`
- `message`
- `fieldErrors` عند الحاجة
- `requestId`
- تفاصيل آمنة فقط

ويستخدم Codes مثل:

`VALIDATION_ERROR`, `VEHICLE_NOT_FOUND`, `VEHICLE_NOT_ELIGIBLE`, `INVALID_STATUS_TRANSITION`, `APPROVALS_REQUIRED`, `DUPLICATE_VIN`, `DUPLICATE_ACTIVE_REQUEST`, `VEHICLE_HAS_HISTORY`, `FORBIDDEN`, `CONFLICT`, `IMPORT_VALIDATION_FAILED`.

## الصلاحيات

أضيفت Permissions مركزية، منها:

- `operations.view`
- `operations.vehicle.create`
- `operations.vehicle.edit`
- `operations.vehicle.delete`
- `operations.vehicle.archive`
- `operations.movement.execute`
- `operations.transfer.create`
- `operations.transfer.advance`
- `operations.transfer.cancel`
- `operations.transfer.delete`
- `operations.approval.financial`
- `operations.approval.administrative`
- `operations.approval.reset`
- `operations.import`
- `operations.import.replace`
- `operations.export`
- `operations.settings.manage`
- `tracking.orders.delete`

يتم تحميل Permissions داخل Session وفحصها في Backend. إخفاء الزر في الواجهة ليس الحماية الوحيدة.

## الداش بورد الموحدة

- تم فصل اختبار اتصال PostgreSQL عن استعلامات Widgets.
- فشل قسم واحد لا يحول الداش بورد كلها إلى `connected: false`.
- كل قسم يعيد Error مستقلًا مع `requestId`.
- لا تظهر رسالة «PostgreSQL غير مربوط» إلا عند فشل اختبار الاتصال الحقيقي.
- تم توحيد قواعد كارت الموافقات وطلبات النقل مع الجداول الجديدة.

## التشغيل

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

اختبار PostgreSQL خارجي مخصص:

```bash
TEST_DATABASE_URL='postgresql://...' pnpm run test:operations:postgres
```

السكربت يرفض استخدام `DATABASE_URL` نفسها حتى لا يعمل بالخطأ على Production.

## تحسينات الإغلاق النهائي

- تفاصيل طلب النقل تُفتح داخل نافذة مستقلة وتعرض السيارات والمراحل والأحداث وسجل التنفيذ.
- البحث في طلبات النقل يدعم رقم الطلب وVIN واسم السيارة، مع تصدير النتائج طبقًا للصلاحيات.
- إجراءات الموافقة والتراجع ومسح الموافقات تستخدم نوافذ المنصة وسببًا إلزاميًا بدل `window.prompt` أو `window.confirm`.
- الحركة تعرض بيانات كل سيارة وموافقاتها وتشيك الوكالة، ثم نافذة مراجعة نهائية قبل تنفيذ Transaction.
- إعدادات المواقع تسمح بربط الموقع بأكثر من فرع من خلال `operations.location_branches` مع الاحتفاظ بالفرع الأساسي للتوافق.
- واجهات التفاصيل والجداول والاستعراض متجاوبة على الشاشات الصغيرة دون تغيير تصميم المنصة العام.
