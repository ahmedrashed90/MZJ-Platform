# استجابات أخطاء API العمليات

كل استجابة خطأ تحتوي قدر الإمكان على:

- `ok: false`
- `code`
- `message` و`error` برسالة آمنة للمستخدم
- `fieldErrors` عند أخطاء الحقول
- `requestId` للتتبع
- `details` آمنة عند الحاجة

## أمثلة

### Validation

```json
{
  "ok": false,
  "code": "VALIDATION_ERROR",
  "message": "أكمل الحقول الإلزامية",
  "fieldErrors": {
    "vin": "رقم الهيكل مطلوب"
  },
  "requestId": "..."
}
```

### سيارة غير موجودة

```json
{
  "ok": false,
  "code": "VEHICLE_NOT_FOUND",
  "message": "السيارة غير موجودة أو غير متاحة",
  "requestId": "..."
}
```

### طلب نشط متعارض

```json
{
  "ok": false,
  "code": "DUPLICATE_ACTIVE_REQUEST",
  "message": "السيارة مرتبطة بطلب جارٍ",
  "requestId": "..."
}
```

### مصدر أو وجهة غير صحيحة

```json
{
  "ok": false,
  "code": "INVALID_SOURCE_LOCATION",
  "message": "يجب أن تكون جميع سيارات الطلب في مكان مصدر واحد",
  "fieldErrors": {
    "vehicleIds": "اختر سيارات من مكان مصدر واحد"
  },
  "requestId": "..."
}
```

### صلاحية مرفوضة

```json
{
  "ok": false,
  "code": "FORBIDDEN",
  "message": "ليس لديك صلاحية تنفيذ هذا النوع من الموافقات",
  "requestId": "..."
}
```

### خطأ قاعدة البيانات

```json
{
  "ok": false,
  "code": "DATABASE_ERROR",
  "message": "تعذر تنفيذ العملية. تم تسجيل الخطأ للمراجعة.",
  "requestId": "..."
}
```

التفاصيل التقنية لا تعاد للواجهة، وتكتب في Logs مع `requestId`.
