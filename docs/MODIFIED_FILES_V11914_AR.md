# الملفات المعدلة في الإصدار 1.19.14

## ملفات التنفيذ

- `src/crm/CrmLayout.tsx`
- `src/crm/pages/CrmFinanceHistoryPage.tsx`
- `server/crm/history.ts`
- `shared/access-control.ts`
- `server/_access-control-schema.ts`
- `database/seeds/20260724_central_access_catalog.sql`
- `database/migrations/20260724_central_access_control_v1190.sql` — تحديث الاسم داخل تعريف التثبيت النظيف الموجود، دون إنشاء Migration جديدة.
- `src/operations/pages/SalesOrdersFollowupPage.tsx`
- `server/operations/index.ts`
- `src/marketing/components/CampaignBudgetManager.tsx` — مكوّن جديد داخل نفس نظام التسويق الحالي.
- `src/marketing/pages/MarketingDatabasePage.tsx`
- `src/marketing/marketing.css`
- `server/marketing/index.ts`
- `server/_api-permissions.ts`

## ملفات الإصدار والفحص

- `package.json`
- `scripts/check-customer-registry-operations-budget-v11914.mjs`
- `scripts/check-crm-branch-marketing-creative-funnel-v11913.mjs`
- `scripts/check-crm-reference-v27.mjs`
- `scripts/check-marketing-ui-batch-v1208.mjs`
- `scripts/check-erpnext-advance-paid-sales-followup-20260805.mjs`
- `docs/CRM-CUSTOMER-REGISTRY-OPERATIONS-BUDGET-V11914-AR.md`
- `docs/MODIFIED_FILES_V11914_AR.md`
- `DELIVERY_MANIFEST_AR.md`
- `test-results/V11914-FOCUSED-CHECK.txt`
- `test-results/V11914-ALL-STATIC-TESTS.txt`
- `test-results/V11914-TYPESCRIPT-SYNTAX.txt`

لا توجد ملفات Migration جديدة، ولا Endpoint بديل، ولا جدول موازٍ، ولا ملفات Patch للتشغيل.
