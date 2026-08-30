# MZJ Platform v34 — Club + Marketing + NEXT ERP invoice Connections

هذه نسخة كاملة مبنية من سورس v30 الأساسي، وليست Patch على v31/v32/v33.

## إصلاح فواتير NEXT ERP
- أزيل الاستعلام المباشر عن Child DocType: `Sales Invoice Item` عبر `/api/resource`.
- جلب العلاقة Sales Order → Sales Invoice يتم الآن من endpoint الرسمي الذي تستخدمه Frappe لعرض تبويب Connections:
  `frappe.desk.form.linked_with.get`.
- بعد الحصول على أسماء الفواتير، يتم قراءة Sales Invoice الأصلية والتحقق من `docstatus` والحالة، ومع وجود `items` يتم التأكد مرة أخرى من أن `sales_order` يساوي طلب البيع المطلوب.
- تحميل PDF ما زال Live من `frappe.utils.print_format.download_pdf`.
- لا يتم كشف مفاتيح NEXT ERP للمتصفح.

## محفوظ من نفس السورس الكامل
- فئات MZJ Club والفلاتر وظهر بطاقة العضوية والفئة التاريخية.
- فصل كتالوج المكافآت عن بطاقة العضوية.
- السيارة الفعلية داخل سجل حركة الشراء وتحميل الفاتورة.
- إصلاح تعديل Creative في التسويق وإزالة Creative من قاعدة البيانات وفق الضوابط الحالية.

## ملاحظة
الإصدار الداخلي للمشروع بقي `1.19.16` حتى يظل متوافقًا مع اختبارات السورس الأصلية.
