# إصلاح تقارير تم البيع - v1.19.7

تمت إعادة بناء منطق «تم البيع» في `server/crm/reports.ts` من سورس v1.19.4 النظيف مباشرة.

## القاعدة المعتمدة

- المصدر الوحيد لأرقام المبيعات هو `crm.sales_transactions`.
- تاريخ الشهر من `sales_transactions.sale_at`.
- العدد من `sales_transactions.quantity`.
- المندوب من `sales_transactions.assigned_to / assigned_name`.
- القسم والفرع من snapshot المعاملة.
- تستبعد فقط المعاملات التي `is_cancelled = true`.

## ما تم إلغاؤه من منطق التقرير

- جمع أوامر ERP كمصدر مبيعات موازٍ.
- إضافة `crm.leads.sold_quantity` كـ fallback.
- توزيع المبيعات على المالك الحالي للعميل بدل مندوب المعاملة.
- استخدام قسم أو فرع العميل الحالي بدل snapshot المعاملة في أرقام البيع.

## الفحوصات

- TypeScript: نجح `npx tsc --noEmit`.
- فحص CRM sales history: ناجح.
- فحص محاذاة sold quantity: ناجح.
- فحص operations movement sales count: ناجح.

تعذر تشغيل `pnpm run build` في بيئة العمل فقط لعدم توفر pnpm وعدم السماح بتنزيل الحزمة من npm، وليس بسبب خطأ TypeScript أو فشل في الفحوصات المعدلة.
