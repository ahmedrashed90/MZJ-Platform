import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const dashboardData = read("server/_dashboard-data.ts");
const operationsApi = read("server/operations/index.ts");
const dashboardPage = read("src/pages/DashboardPage.tsx");
const dashboardModal = read("src/operations/components/DashboardOperationsModal.tsx");
const movementHistory = read("src/operations/pages/MovementHistoryPage.tsx");
const types = read("src/types.ts");
const styles = read("src/styles.css");

const operationsBlock = dashboardData.slice(
  dashboardData.indexOf('if (canAccessSystem(user, "operations"))'),
  dashboardData.indexOf("data.generatedAt = new Date().toISOString()"),
);

const checks = [];
function expect(label, condition) {
  checks.push({ label, ok: Boolean(condition) });
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
}

expect(
  "Current inventory snapshot is not restricted by the dashboard date range",
  !operationsBlock.includes("(v.updated_at at time zone 'Asia/Riyadh')::date between ${from}::date and ${to}::date"),
);
expect(
  "Agency count uses the same exact location and actual-stock condition as its drilldown",
  dashboardData.includes("l.code='agency' and coalesce(s.is_actual_stock,true)")
    && operationsApi.includes("metric === \"actual_total\"")
    && operationsApi.includes("coalesce(s.is_actual_stock,true)"),
);
expect(
  "Dashboard inventory counts use both canonical branch and vehicle-status scopes",
  dashboardData.includes("l.code in ${sql(operationBranches)} or l.branch_code in ${sql(operationBranches)}")
    && dashboardData.includes("operationStatusUnrestricted")
    && dashboardData.includes("v.status_code in ${sql(operationStatusCodes)}"),
);
expect(
  "Dashboard shortages use the same current-state and status scope as the details popup",
  dashboardData.includes("and (${operationStatusUnrestricted}=true or v.status_code in ${sql(operationStatusCodes)})")
    && !operationsBlock.includes("and (v.updated_at at time zone 'Asia/Riyadh')::date between ${from}::date and ${to}::date"),
);
expect(
  "Approval totals and popup share the canonical active approval scope without a date-only mismatch",
  dashboardData.includes("with visible_approvals as")
    && dashboardData.includes("where ${approvalVisibilityScope}")
    && operationsApi.includes("const visibilityScope = operationsApprovalVisibilityScope(sql, user)")
    && !dashboardData.includes("(a.updated_at at time zone 'Asia/Riyadh')::date between ${from}::date and ${to}::date"),
);
expect(
  "Latest financial and administrative notes are exposed on the dashboard card",
  types.includes("recentNotes: Array")
    && dashboardData.includes("financialNote")
    && dashboardData.includes("administrativeNote")
    && dashboardPage.includes("آخر ملاحظات الموافقات"),
);
expect(
  "Approval popup contains complete notes, actors, dates, vehicle details, and a full detail view",
  ["financial_note", "administrative_note", "financial_approved_by_name", "administrative_approved_by_name", "status_name", "state_note", "shortage_note"].every((field) => operationsApi.includes(field))
    && dashboardModal.includes("الملاحظة المالية")
    && dashboardModal.includes("الملاحظة الإدارية")
    && dashboardModal.includes("عرض كامل")
    && dashboardModal.includes("dashboard-approval-detail-modal")
    && styles.includes("dashboard-approval-detail-content"),
);
expect(
  "Movement PDF uses a real A3 landscape page with a complete fixed-width table",
  movementHistory.includes("@page { size: 420mm 297mm")
    && movementHistory.includes("table-layout: fixed")
    && movementHistory.includes('colspan="29"')
    && movementHistory.includes("نوع الحركة والطلب"),
);
expect(
  "Movement PDF keeps prior/current state and all notes without adding narrow duplicate columns",
  movementHistory.includes('lines([["الحالي", row.to_location_name], ["السابق", row.from_location_name]])')
    && movementHistory.includes('lines([["الحالية", row.new_status_name || row.new_status], ["السابقة", row.old_status_name || row.old_status]])')
    && movementHistory.includes('["الحركة", row.note]')
    && movementHistory.includes('["الحالة", row.state_note]'),
);
expect(
  "Movement PDF waits for fonts before printing and repeats table headers across pages",
  movementHistory.includes("win.document.fonts?.ready")
    && movementHistory.includes("thead { display: table-header-group; }")
    && movementHistory.includes("page-break-inside: avoid"),
);

const failed = checks.filter((check) => !check.ok);
if (failed.length) {
  console.error(`\nClean operations dashboard/PDF checks failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}
console.log(`\nClean operations dashboard/PDF checks passed: ${checks.length}/${checks.length}`);
