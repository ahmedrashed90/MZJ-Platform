# الملفات المعدلة في الإصدار 1.19.13

## منطق CRM

- `server/crm/reports.ts`
  - توحيد فرع عمليات البيع القديمة عند غياب لقطة الفرع.
  - استخدام نفس الفرع الفعلي في العد والفلترة والصلاحيات والبحث وتفاصيل المندوب.

## API ومنطق التسويق

- `server/marketing/index.ts`
  - حفظ وتعديل اسم الكرييتيف المركزي.
  - تثبيت كمية كرييتيف الحملة على سجل واحد.
  - حماية تعديل الاسم من إعادة إنشاء التاسكات أو الميزانية أو جدول النشر دون تغيير فعلي.
  - إضافة Funnel جديد عبر API التسويق الحالي.
- `server/_api-permissions.ts`
  - تعريف إجراء `create_funnel` داخل بوابة الصلاحيات، مع بقاء فحص صلاحية الإنشاء أو التعديل داخل معالج التسويق.

## واجهة التسويق

- `src/marketing/types.ts`
- `src/marketing/components/CreativeEditor.tsx`
- `src/marketing/components/EntityCreativeManager.tsx`
- `src/marketing/components/FunnelSelect.tsx` — مكوّن جديد داخل المسار الأصلي للمكونات.
- `src/marketing/pages/CreateCampaignPage.tsx`
- `src/marketing/pages/MarketingDatabasePage.tsx`
- `src/marketing/freshImport.ts`
- `src/marketing/marketing.css`

## الإصدار والفحوص

- `package.json`
- `scripts/check-crm-branch-marketing-creative-funnel-v11913.mjs`
- `scripts/check-crm-sold-date-report-correction-v11912.mjs`
- `scripts/check-central-access-control-v1190.mjs`
- `scripts/check-erpnext-cancel-tracking-sync-v1194.mjs`
- `docs/CRM-BRANCH-MARKETING-CREATIVE-FUNNEL-V11913-AR.md`
- `docs/MODIFIED_FILES_V11913_AR.md`
- `test-results/CRM-BRANCH-MARKETING-CREATIVE-FUNNEL-V11913.txt`

لا توجد ملفات Migration جديدة، ولا توجد تغييرات في مخطط قاعدة البيانات.
