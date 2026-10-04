# Operations Legacy VIN History - Read Only

تم تعديل **سجل الحركات فقط** لدمج تاريخ رقم الهيكل من النظام القديم مع سجل المنصة الجديدة عند البحث برقم VIN.

## نطاق التعديل
- لا يوجد أي تعديل أو نقل بيانات في PostgreSQL.
- لا يوجد أي تعديل أو كتابة في Firebase القديم.
- الاتصال القديم يستخدم فقط:
  - قراءة `logs` برقم الهيكل (`vin` و `payload.vin`).
  - قراءة مستند السيارة من `cars/{VIN}` لإكمال بيانات العرض القديمة.
- لا يتم استخدام الاتصال القديم في أي صفحة أو سيستم آخر.
- الحركات الجديدة تظل من `operations.movements` والمنطق الحالي كما هو.

## منع تداخل القديم مع الجديد
يتم استبعاد أي حركة من Firebase القديم تقع عند أو بعد تاريخ التحويل المحدد في:

`OPERATIONS_LEGACY_CUTOFF_AT`

القيمة الافتراضية في السورس:

`2026-08-01T00:00:00+03:00`

يمكن ضبطها على تاريخ التحويل الفعلي بدون تعديل الكود.

## إعداد الاتصال القديم
المشروع القديم مضبوط افتراضيا على:

`mzj-workflow`

أضف في Vercel Environment Variables بيانات Service Account مستقلة للقراءة فقط:

- `OPERATIONS_LEGACY_FIREBASE_SERVICE_ACCOUNT_JSON`

أو:

- `OPERATIONS_LEGACY_FIREBASE_CLIENT_EMAIL`
- `OPERATIONS_LEGACY_FIREBASE_PRIVATE_KEY`

الموصى به أن تكون الـService Account عليها IAM Role:

`Cloud Datastore Viewer (roles/datastore.viewer)`

وبذلك تكون الصلاحية نفسها **قراءة فقط** حتى خارج منطق الكود.

## الملفات التي تم تعديلها
- `server/operations/index.ts`
- `src/operations/pages/MovementHistoryPage.tsx`
- `.env.example`

## الملف الجديد
- `server/_operations-legacy-history.ts`

هذا الملف لا يحتوي على أي عمليات كتابة إلى Firestore القديم؛ استعلامات البيانات هي قراءة فقط، وPOST المستخدم هو `documents:runQuery` الخاص بالاستعلام وليس إنشاء مستند.
