# MZJ Operations — Full VIN History (Clean)

التعديل محصور في سجل الحركات عند البحث برقم هيكل مطابق بالكامل.

## مصادر السجل في المنصة الجديدة
- `operations.movements`
- `audit.activity_log` لجميع أحداث `operations / vehicle` المرتبطة بالسيارة
- `operations.transfer_request_events`
- `operations.vehicle_archive_events`
- `operations.vehicle_check_history`
- `operations.approval_events`
- `operations.vehicle_status_notes`
- `tracking.stage_events` المرتبطة بنفس سيارة العمليات / VIN

## السجل القديم
يبقى الربط القديم قراءة فقط عبر `/api/operations/legacy-history` باستخدام Service Account للقراءة من:
- `logs`
- `requests`
- `transfers`
- `cars/{VIN}` لاستكمال العرض فقط

لا يوجد أي نقل أو مزامنة أو كتابة أو تعديل أو حذف في Firebase القديم.

## الواجهة
تم إظهار عمود `نوع الحركة` داخل سجل الحركات وإضافته إلى Excel. تصدير PDF كان يعرض نوع الحركة بالفعل.
