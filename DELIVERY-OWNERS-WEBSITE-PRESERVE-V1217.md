# MZJ Platform v1.21.7 — Owners Website CRM Preserve

هذا الإصدار مبني مباشرة على السورس المعتمد `v1.21.6-OWNERS-REWARDS-ALL-USAGES-FULL`.

## نطاق التعديل
التعديل محصور في مسار **MZJ Owners Community Commerce API** عند استخدام كود الخصم والمكافآت داخل طلب الموقع.

## السلوك المعتمد
- كود الخصم والمكافآت لا ينشئ ولا يعيد توزيع عميل CRM من نفسه.
- لا يغير `source_code` أو `source_name` أو `branch_code` أو `department_code` أو `assigned_to` للعميل.
- مسار طلب الموقع / Next ERP يظل المصدر الوحيد لتحديد بيانات CRM الخاصة بطلب الموقع، وبالتالي تبقى القيم المعتمدة للطلب الإلكتروني كما يحددها الفلو الأصلي:
  - المصدر: `website`
  - الفرع: الموقع الإلكتروني
  - القسم: مبيعات الكاش
  - المسؤول: Website
- Owners Commerce API يسجل فقط علاقة الإحالة والمكافأة داخل جداول `owners.*`.
- عند وصول البيع من Next ERP، `processOwnerSaleForLead()` يربط الإحالة بالعميل الصحيح عن طريق رقم الجوال ويكمل فلو النقاط/البيع الحالي.

## غير متأثر
CRM العام، التوزيع، Cash QR، Tracking، Operations، Marketing، Next ERP integration، ونظام المكافآت واستخداماتها لم تتغير.
