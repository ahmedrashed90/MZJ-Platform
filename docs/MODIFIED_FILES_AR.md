# قائمة الملفات المعدلة — MZJ Platform v1.19.1

- ملفات جديدة: **29**.
- ملفات موجودة تم تعديلها: **66**.
- ملفات محذوفة: **0**.
- إجمالي الملفات المختلفة عن v1.18.0: **95**.

## ملفات جديدة

- `DELIVERY_MANIFEST_AR.md`
- `database/migrations/20260724_central_access_control_v1190.sql`
- `database/migrations/20260724_central_access_control_v1190_rollback.sql`
- `database/seeds/20260724_central_access_catalog.sql`
- `database/user-access-import-template.csv`
- `docs/ACCESS_CONTROL_SCHEMA_AR.md`
- `docs/CENTRAL_ACCESS_CONTROL_IMPLEMENTATION_AR.md`
- `docs/CENTRAL_ACCESS_CONTROL_REVIEW_AR.md`
- `docs/CONFLICTS_REPORT_AR.md`
- `docs/DEPLOYMENT_ROLLBACK_AR.md`
- `docs/MODIFIED_FILES_AR.md`
- `docs/OLD_SYSTEMS_REFERENCE_REVIEW_AR.md`
- `docs/PERMISSION_CATALOG_AR.md`
- `docs/SECURITY_CLEANUP_AR.md`
- `docs/SEED_REPORT_AR.md`
- `docs/SYSTEM_PAGES_ACTIONS_AR.md`
- `docs/TEST_RESULTS_AR.md`
- `docs/USER_ACCESS_REPORT_AR.md`
- `scripts/check-central-access-control-v1190.mjs`
- `server/_access-control-schema.ts`
- `server/_access-control.ts`
- `server/_api-permissions.ts`
- `server/access-control.ts`
- `shared/access-control.ts`
- `src/access-control/UsersPermissionsPanel.tsx`
- `src/access-control/api.ts`
- `src/access-control/types.ts`
- `test-results/all-static-checks-final.log`
- `test-results/check-central-access-control-v1190.log`

## ملفات معدلة

- `README.md`
- `api/index.ts`
- `package.json`
- `scripts/check-crm-automation-flow-v1180.mjs`
- `scripts/check-crm-manual-leads-v1160.mjs`
- `scripts/check-dashboard-operations-v1161.mjs`
- `scripts/check-erpnext-unified-sales-link-v1166.mjs`
- `scripts/check-operations-native-v2.mjs`
- `scripts/check-tracking-module-v112.mjs`
- `server/_auth.ts`
- `server/_crm-utils.ts`
- `server/_dashboard-data.ts`
- `server/_marketing-schema.ts`
- `server/_operations-auth.ts`
- `server/_operations-schema.ts`
- `server/_tracking-schema.ts`
- `server/_tracking-utils.ts`
- `server/auth/login.ts`
- `server/auth/logout.ts`
- `server/crm/automation-settings.ts`
- `server/crm/contacts.ts`
- `server/crm/conversations.ts`
- `server/crm/dashboard.ts`
- `server/crm/data-review.ts`
- `server/crm/entry-routing.ts`
- `server/crm/history.ts`
- `server/crm/leads.ts`
- `server/crm/mersal-templates.ts`
- `server/crm/reports.ts`
- `server/crm/settings.ts`
- `server/crm/unread.ts`
- `server/dashboard.ts`
- `server/marketing/index.ts`
- `server/operations/index.ts`
- `server/setup/initialize.ts`
- `server/tracking/delete.ts`
- `server/tracking/orders.ts`
- `server/tracking/public.ts`
- `server/tracking/settings.ts`
- `server/tracking/sms.ts`
- `server/users.ts`
- `shared/system-access.ts`
- `src/App.tsx`
- `src/auth/AuthContext.tsx`
- `src/components/Sidebar.tsx`
- `src/crm/CrmLayout.tsx`
- `src/crm/pages/CrmAdminPage.tsx`
- `src/marketing/MarketingLayout.tsx`
- `src/marketing/components/MarketingSettingsPanel.tsx`
- `src/marketing/components/TaskDetailModal.tsx`
- `src/marketing/pages/AttendancePage.tsx`
- `src/marketing/pages/CreateAgendaPage.tsx`
- `src/marketing/pages/CreateCampaignPage.tsx`
- `src/marketing/pages/MarketingDatabasePage.tsx`
- `src/marketing/pages/PublishPrepPage.tsx`
- `src/marketing/types.ts`
- `src/operations/OperationsLayout.tsx`
- `src/operations/pages/VehicleManagementPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/styles.css`
- `src/systemAccess.ts`
- `src/tracking/TrackingLayout.tsx`
- `src/tracking/components/TrackingSettingsPanel.tsx`
- `src/tracking/pages/PublicTrackingPage.tsx`
- `src/tracking/pages/TrackingDeletePage.tsx`
- `src/tracking/pages/TrackingOrdersPage.tsx`

## ملفات محذوفة

- لا يوجد.

## سلامة التاريخ

- `database/migrations/20260720_operations_native_v2.sql` مطابق حرفيًا للسورس المعتمد.
- `database/migrations/20260720_operations_native_v2_rollback.sql` مطابق حرفيًا للسورس المعتمد.
- لم يتم تعديل أي Migration تاريخية؛ كل تحويلات الصلاحيات الجديدة داخل Migration v1.19.0 فقط.

## سجلات الفحص المرفقة

- `test-results/check-central-access-control-v1190.log`
- `test-results/all-static-checks-final.log`

## إصلاح Build في v1.19.1

- `server/_access-control.ts`: فصل RowList عن الصف الأول عند حساب الصلاحيات الفعلية.
- `server/_auth.ts`: فصل RowList عن صف المستخدم عند تحميل الجلسة.
- `shared/system-access.ts`: إضافة امتداد `.js` المتوافق مع NodeNext.
- `scripts/check-build-types-v1191.mjs`: اختبار رجوع للمشكلة.
- `docs/V1191-BUILD-TYPE-FIX-AR.md`: شرح سبب المشكلة والإصلاح.
- لا توجد Migration جديدة ولا تغيير في أي فلو تشغيلي.


## v1.19.2 — إصلاح تسجيل الدخول بعد الترقية

- `server/_access-control-schema.ts`: إضافة فحص إصدار المخطط وخدمة Bootstrap مركزية تحت advisory lock.
- `server/_auth.ts`: ضمان جاهزية المخطط قبل الجلسات وملف المستخدم.
- `server/auth/login.ts`: تجهيز المخطط قبل المصادقة ورسالة خطأ دقيقة عند تعذر DDL.
- `server/setup/initialize.ts`: استخدام نفس خدمة Bootstrap بدل مسار تهيئة مكرر.
- `database/migrations/20260724_central_access_control_v1192_login_bootstrap.sql`: حالة إصدار المخطط.
- `scripts/check-login-schema-bootstrap-v1192.mjs`: اختبار رجوع جديد.

## v1.19.3 — إصلاح صياغة SQL المركزي

- `database/migrations/20260724_central_access_control_v1190.sql`
- `database/seeds/20260724_central_access_catalog.sql`
- `server/_access-control-schema.ts`
- `scripts/check-central-access-sql-v1193.mjs`
- `scripts/check-central-access-control-v1190.mjs`
- `package.json`
- `README.md`
- `DELIVERY_MANIFEST_AR.md`
- `docs/V1193-CENTRAL-SQL-SYNTAX-FIX-AR.md`
- `docs/TEST_RESULTS_AR.md`
- `docs/MODIFIED_FILES_AR.md`

لم يتم تعديل أي فلو أو صلاحية أو API وظيفية.

