# CRM — تصحيح الوقت الفعلي لـ «تاريخ تم البيع»

## المشكلة
كان وقت `sold_at` يُنشأ كوقت ثابت بدل وقت طلب البيع الحقيقي:

- مزامنة NEXT ERP كانت تحوّل تاريخ الطلب إلى `12:00 م` بشكل صريح.
- طلبات البيع المنشأة من CRM كانت تمرر تاريخًا فقط، فيتحول إلى بداية اليوم بدل وقت إنشاء الطلب.

## التصحيح المعتمد
تم توحيد تكوين وقت البيع في `server/_crm-sale-timestamp.ts` بحيث:

1. يبقى **تاريخ العملية** هو تاريخ طلب البيع.
2. يؤخذ **الوقت** من وقت إنشاء/دخول طلب البيع الفعلي.
3. يتم تفسير توقيت ERPNext غير المزود بمنطقة زمنية كتوقيت الرياض، بدون الاعتماد على توقيت السيرفر.
4. يظل `crm.sales_transactions.sale_at` هو مصدر الحقيقة الوحيد، ثم تتجدد منه لقطة `crm.leads.sold_at`.
5. تعديل تاريخ البيع يدويًا يغيّر اليوم فقط ويحافظ على وقت العملية الأصلي.
6. عرض CRM مثبت على `Asia/Riyadh` لمنع اختلاف الوقت باختلاف جهاز المستخدم.

## معالجة السجلات السابقة
ملف الترحيل `20260817_crm_sales_order_actual_time_v1216.sql` يعالج السجلات المرتبطة بطلبات بيع التي تحمل وقتًا افتراضيًا `00:00` أو `12:00`، ويستبدل الوقت بوقت دخول معاملة البيع الفعلي، ثم يعيد مزامنة `sold_at` و`sold_quantity` في العميل.

## الملفات الرئيسية
- `server/_crm-sale-timestamp.ts`
- `server/_erpnext-sales-order-normalizer.ts`
- `server/_erpnext-sales-order-sync.ts`
- `server/crm/contacts.ts`
- `server/_crm-sales-history.ts`
- `server/_crm-schema.ts`
- `src/crm/api.ts`
- `database/migrations/20260817_crm_sales_order_actual_time_v1216.sql`
- `scripts/check-crm-sale-timestamp-v1216.mjs`
