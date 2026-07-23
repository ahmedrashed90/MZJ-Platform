# تقرير Regression لإعادة بناء التسويق

## نتيجة الفحوصات

كل فحوصات المصدر الثابتة المتاحة للـCRM والعمليات والتراكينج والـWorkers نجحت بعد دمج التسويق.

## ملفات الأنظمة المحمية

- لم يتم تعديل أي ملف داخل `src/crm` أو `server/crm`.
- لم يتم تعديل أي ملف داخل `src/tracking` أو منطق التراكينج.
- تعديلات العمليات محصورة في التكامل المطلوب صراحة لطلبات التصوير المشتركة:
  - `server/operations/index.ts`
  - `server/operations/photography-requests.ts`
  - `src/operations/pages/TransferRequestsPage.tsx`
  - `src/operations/types.ts`
  - قراءة عداد/تفاصيل طلب التصوير المشترك في داش بورد العمليات.

## نقاط الربط العامة

- `src/App.tsx`: Routes التسويق فقط.
- `src/components/Sidebar.tsx`: ظهور نظام التسويق حسب الصلاحية.
- `src/pages/SettingsPage.tsx`: تبويب إعدادات التسويق الموحد.
- `api/index.ts`: Dispatcher لنظام التسويق وCron النشر.
- Schema/Seed: إضافات التسويق فقط، وإضافة أعمدة نوع طلب التصوير في سجل طلبات النقل.

## ملاحظات صادقة

لم يُنفذ Full Build داخل بيئة العمل بسبب تعذر الوصول إلى npm. يجب اعتبار نجاح CI/Vercel TypeScript وBuild شرطًا قبل Production Deploy.
