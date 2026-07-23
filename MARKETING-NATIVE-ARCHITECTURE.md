# معمارية نظام التسويق Native داخل منصة MZJ

## المبادئ

1. React + TypeScript في `src/marketing`.
2. Serverless API معزول في `server/marketing` ومربوط من `api/index.ts`.
3. PostgreSQL داخل Schema `marketing` مع الاعتماد على `core.users` و`core.departments` وPermissions المركزية.
4. تعديل محدود للعمليات فقط لربط طلب التصوير بالسجل المشترك في `operations.transfer_requests`.
5. كل عمليات الإنشاء والتحولات الحساسة داخل Transactions مع Audit.
6. IDs ثابتة وعلاقات UUID؛ لا تعتمد العلاقات على الاسم العربي.

## الخدمات المركزية

- Campaign creation/update and code allocation: `server/marketing/campaigns.ts`.
- Task transitions, Task Template review, files and progress: `server/marketing/tasks.ts`.
- Dashboard, calendars and reports: `server/marketing/dashboard.ts`.
- Publish Prep, OAuth and platform state: `server/marketing/publishing.ts`.
- Platform adapters: `server/marketing/platforms/*`.
- Shared stock and photography flow: `server/marketing/stock.ts` و`server/operations/photography-requests.ts`.
- Settings/catalogs: `server/marketing/settings.ts`.
- Attendance: `server/marketing/attendance.ts`.

## حماية الأنظمة القائمة

- لا توجد تعديلات داخل ملفات CRM أو Tracking.
- تعديلات Operations محصورة في عرض ومتابعة طلب التصوير المشترك مع التسويق.
- Queries مخزن السيارات قراءة فقط من التسويق.
- بيانات السيارة لا تُحدَّث عند إنشاء طلب تصوير.
- Dashboard العمليات يقرأ طلبات التصوير الجديدة من نفس سجل `operations.transfer_requests`.
