import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const checks = [];
function expect(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`FAILED: ${name}`);
}

const activityApi = read("server/activity.ts");
const activityDetails = read("server/_activity-details.ts");
const activityPage = read("src/pages/ActivityPage.tsx");
const dashboardApi = read("server/dashboard.ts");
const dashboardData = read("server/_dashboard-data.ts");
const dashboardPage = read("src/pages/DashboardPage.tsx");
const reports = read("server/crm/reports.ts");
const meta = read("server/crm/meta.ts");
const kpi = read("server/crm/kpi.ts");
const erpSync = read("server/_erpnext-sales-order-sync.ts");

expect("Activity API builds human-readable activity details", activityApi.includes("buildActivityDetails") && activityApi.includes("activity_vehicle_vin"));
expect("Activity API deletes only a selected date range", activityApi.includes('request.method === "DELETE"') && activityApi.includes("dateFrom") && activityApi.includes("dateTo") && activityApi.includes("activity_log_deleted"));
expect("Activity deletion is restricted to platform super admin", activityApi.includes('const canDeleteActivity = hasPermission(user, "platform.superadmin")'));
expect("Activity detail recognizes ERP vehicle status changes", activityDetails.includes("erpnext_vehicle_status_synced") && activityDetails.includes("تم تغيير حالة السيارة من"));
expect("Activity modal renders activity summary instead of raw before/after JSON", activityPage.includes("النشاط الذي تم داخل السيستم") && activityPage.includes("selected.activity_title") && !activityPage.includes("JSON.stringify(selected.before_data"));

expect("Dashboard API accepts a validated custom date range", dashboardApi.includes("requestedFrom") && dashboardApi.includes("requestedTo") && dashboardApi.includes("getDashboardData(user, { from, to })"));
expect("Dashboard data queries receive and use the selected range", dashboardData.includes("range: { from: string; to: string }") && dashboardData.includes("between ${from}::date and ${to}::date"));
expect("Dashboard UI exposes from/to selection", dashboardPage.includes("مدة بيانات الداش بورد") && dashboardPage.includes("applyDashboardRange") && dashboardPage.includes("new URLSearchParams(appliedRange)"));

expect("CRM reports resolve the salesperson from the ERP mapping or lead assignment", reports.includes("coalesce(erp.platform_user_id,l.assigned_to)") && reports.includes("report_assigned_name"));
expect("CRM reports use the primary CRM department", reports.includes("core.user_system_departments") && reports.includes("usd.system_code='crm'"));
expect("Wholesale reporting is branchless", reports.includes("primary_department.code in ('wholesale','wholesale_sales') then null") && reports.includes('"قسم الجملة"'));
expect("CRM metadata exposes system-specific CRM departments", meta.includes("core.user_system_departments") && meta.includes("crm_departments.codes"));
expect("ERP sales allow wholesale without assigning a branch", erpSync.includes("allowsBranchlessCrmSales") && erpSync.includes("candidate.branch_code = null"));
expect("KPI agents require a sales department and primary CRM branch", kpi.includes("primary_department.code in ('cash_sales','finance_sales')") && kpi.includes("core.user_system_branches"));
expect("Branch KPI visibility is not widened by speed/efficiency edit rights", kpi.includes('scope.all || hasPermission(user, "crm.kpi.rate_all")') && !kpi.includes("evaluatorCanSeeAllAgents"));

console.log(`Activity/dashboard/Nabil regression checks passed (${checks.length}).`);
