# الملفات المعدلة في الإصدار 1.19.15

## ملفات التنفيذ

- `src/crm/components/LeadDrawer.tsx`
  - إضافة قسم الجملة إلى قائمة القسم في تعديل عميل قاعدة البيانات.
  - دعم `wholesale` و`wholesale_sales` من التكليفات المركزية.
  - الحفاظ على الجملة كقسم بلا فرع وتصفية المسؤولين حسب القسم.
- `src/marketing/pages/MarketingDatabasePage.tsx`
  - إضافة أنواع TypeScript صريحة لبنود ومنصات عرض الميزانية.
  - إصلاح callbacks التي سببت أخطاء Vercel `TS7006` دون تغيير المنطق.

## ملفات الإصدار والفحص

- `package.json`
- `scripts/check-crm-database-wholesale-department-v11915.mjs`
- `scripts/check-customer-registry-operations-budget-v11914.mjs` — توسيع قبول الإصدار الجديد فقط.
- `scripts/check-crm-branch-marketing-creative-funnel-v11913.mjs` — توسيع قبول الإصدار الجديد فقط.
- `docs/CRM-DATABASE-WHOLESALE-DEPARTMENT-V11915-AR.md`
- `docs/MODIFIED_FILES_V11915_AR.md`
- `test-results/V11915-FOCUSED-CHECK.txt`
- `test-results/V11915-PACKAGE-STATIC-TESTS.txt`
- `test-results/V11915-TYPESCRIPT-SYNTAX.txt`
- `DELIVERY_MANIFEST_AR.md`

لا توجد Migration جديدة، ولا Endpoint بديل، ولا جدول موازٍ، ولا ملف Patch تشغيلي.
