# ربط ERPNext مباشرة بنظام التراكينج

هذه النسخة تضيف مسارًا مباشرًا لطلبات البيع مع الإبقاء على مسار Google Sheet الحالي بدون إيقافه أو تغييره.

## الفلو الجديد

```text
ERPNext Sales Order (Submit)
        ↓
Webhook POST
        ↓
/api/integrations/erpnext/sales-order
        ↓
نفس دالة الإدخال الحالية للتراكينج
        ↓
PostgreSQL + مراحل التراكينج
```

## 1) إعداد Vercel

أضف Environment Variable جديدًا:

```text
ERPNEXT_WEBHOOK_KEY=ضع-هنا-مفتاحًا-سريًا-طويلًا
```

يمكن استخدام `TRACKING_INGEST_KEY` بدلًا منه، لكن وجود مفتاح مستقل لـERPNext أفضل في الإدارة.

بعد إضافة المتغير اعمل Redeploy للمنصة.

## 2) إعداد Webhook داخل ERPNext

استخدم القيم التالية:

```text
Name: MZJ Tracking - Sales Order
DocType: Sales Order
Doc Event: on_submit
Enabled: Yes
Condition: فارغة
Request Method: POST
Request Structure: JSON
Is Dynamic URL: No
Request URL: https://mzj-platform.vercel.app/api/integrations/erpnext/sales-order
Request Timeout: 15
```

أضف Header:

```text
Key: X-MZJ-ERPNext-Key
Value: نفس قيمة ERPNEXT_WEBHOOK_KEY الموجودة في Vercel
```

## 3) JSON Request Body

انسخ النص التالي داخل JSON Request Body:

```json
{
  "event": "sales_order.submitted",
  "doc": {
    "name": "{{ doc.name }}",
    "creation": "{{ doc.creation }}",
    "modified": "{{ doc.modified }}",
    "status": "{{ doc.status }}",
    "docstatus": "{{ doc.docstatus }}",
    "customer": "{{ doc.customer }}",
    "customer_name": "{{ doc.customer_name }}",
    "tax_id": "{{ doc.tax_id }}",
    "contact_mobile": "{{ doc.contact_mobile }}",
    "branch": "{{ doc.branch }}",
    "transaction_date": "{{ doc.transaction_date }}",
    "delivery_date": "{{ doc.delivery_date }}",
    "net_total": "{{ doc.net_total }}",
    "total_taxes_and_charges": "{{ doc.total_taxes_and_charges }}",
    "grand_total": "{{ doc.grand_total }}",
    "sales_team": {{ doc["sales_team"] | tojson }},
    "items": {{ doc["items"] | tojson }},
    "taxes": {{ doc["taxes"] | tojson }}
  }
}
```

جدول `items` يُرسل كاملًا، بما في ذلك أي Custom Fields موجودة داخل صف السيارة. المستقبل داخل المنصة يبحث تلقائيًا عن أسماء شائعة لحقول النوع والفئة والموديل ورقم الهيكل والألوان والمورد.

## 4) منطق الإدخال

- كل صف سيارة غير رسوم التسجيل يدخل كسجل سيارة داخل الطلب.
- صف يحمل اسم `رسوم التسجيل` أو `Registration Fee` لا يدخل كسيارة؛ تُضاف قيمته إلى رسوم التسجيل.
- المفتاح الأساسي للمصدر هو رقم طلب البيع.
- مفتاح السيارة يعتمد على رقم الهيكل، ثم رقم الصف عند عدم وجود رقم هيكل.
- إعادة إرسال نفس Webhook تعمل Update ولا تنشئ نسخة جديدة.
- تشغيل Google Sheet وERPNext معًا أثناء الاختبار لا ينشئ طلبًا ثانيًا لنفس رقم طلب البيع، ولا سيارة ثانية لنفس VIN أو ItemNo داخل الطلب.
- لو رقم الهيكل غير موجود، يُنشأ رقم مؤقت بنفس منطق التراكينج الحالي.
- الاستجابة ترجع `warnings` لو بعض حقول السيارة لم يتم التعرف عليها، وتعرض أسماء الحقول التي وصلت من ERPNext لتسهيل ضبط أي Custom Field غير معتاد.

## 5) الاختبار الأول

1. اترك Trigger Google Sheet الحالي يعمل مؤقتًا.
2. أنشئ طلب بيع تجريبي جديد واعتمد الطلب بـSubmit.
3. افتح Webhook Request Log في ERPNext.
4. يجب أن تكون الاستجابة HTTP 200 وبالشكل التقريبي:

```json
{
  "ok": true,
  "orderNo": "SAL-ORD-2026-00001",
  "importedVehicles": 1,
  "registrationFeeRowsIgnoredAsVehicles": 1,
  "warnings": []
}
```

5. افتح صفحة التراكينج وتأكد من رقم الطلب وبيانات العميل والسيارة والمبالغ.
6. لو ظهرت عناصر داخل `warnings`، راجع `receivedFields` في نفس الاستجابة لمعرفة الاسم الداخلي للحقل المخصص داخل ERPNext.

## 6) الرجوع للمسار القديم

لا تحتاج إلى حذف أي كود. يكفي إلغاء تفعيل Webhook من ERPNext، وسيستمر مسار الإيميل ثم Google Sheet كما كان.
