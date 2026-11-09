import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const dashboardData = read("server/_dashboard-data.ts");
const operationsApi = read("server/operations/index.ts");
const queryScope = read("server/_operations-query-scope.ts");
const dashboardPage = read("src/pages/DashboardPage.tsx");
const dashboardModal = read("src/operations/components/DashboardOperationsModal.tsx");
const requestsPage = read("src/operations/pages/TransferRequestsPage.tsx");
const vehicleManagement = read("src/operations/pages/VehicleManagementPage.tsx");
const styles = read("src/styles.css");

const checks = [];
function expect(label, condition) {
  checks.push({ label, ok: Boolean(condition) });
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
}

expect(
  "Dashboard transfer and photography counts use the canonical transfer_requests source only",
  dashboardData.includes("from operations.transfer_requests r") && !dashboardData.includes("operations.photography_requests"),
);
expect(
  "Dashboard and Operations request list share one access scope",
  dashboardData.includes("operationsRequestAccessScope(sql, user)")
    && operationsApi.includes("operationsRequestAccessScope(sql, user)")
    && queryScope.includes("export function operationsRequestAccessScope"),
);
expect(
  "Archived vehicles remove completed requests from active dashboard and list counts",
  queryScope.includes("active_request_v.archived_at is null")
    && queryScope.includes("active_request_v.is_inventory_active=true")
    && dashboardData.includes("r.cancelled_at is not null or ${requestHasActiveVehicle}")
    && operationsApi.includes("r.cancelled_at is not null or ${activeVehicleScope}"),
);
expect(
  "Every live request stage has a dedicated dashboard count and drilldown",
  ["request_received", "vehicle_received", "vehicle_sent", "completed"].every(
    (status) => dashboardData.includes(`r.status='${status}'`) && dashboardPage.includes(`status: "${status}"`),
  ),
);
expect(
  "Request drilldown uses the same canonical listTransfers query",
  operationsApi.includes("async function dashboardRequests")
    && operationsApi.includes("return listTransfers(sql")
    && dashboardModal.includes('resource: "dashboard_requests"'),
);
expect(
  "Dashboard request totals distinguish transfer and photography request_kind values",
  dashboardData.includes("r.request_kind='transfer'")
    && dashboardData.includes("r.request_kind='photography'")
    && dashboardModal.includes('setKind("transfer")')
    && dashboardModal.includes('setKind("photography")'),
);
expect(
  "Cancelled requests can be deleted while normal requests preserve the pre-execution rule",
  operationsApi.includes("if (r.cancelled_at && action !== \"delete\")")
    && operationsApi.includes("const cancelledRequest = Boolean(r.cancelled_at)")
    && operationsApi.includes("if (!cancelledRequest)")
    && operationsApi.includes('can_delete: (cancelled || row.status === "created")')
    && requestsPage.includes("حذف الطلب الملغي"),
);
expect(
  "Dashboard approval counts and approvals page share one visibility scope",
  dashboardData.includes("operationsApprovalVisibilityScope(sql, user)")
    && operationsApi.includes("operationsApprovalVisibilityScope(sql, user)")
    && queryScope.includes("export function operationsApprovalVisibilityScope"),
);
expect(
  "Vehicle-management edit search is anchored to its panel and closes after selection",
  vehicleManagement.includes("operations-management-vehicle-search")
    && vehicleManagement.includes("setResults([]); setSearch(\"\")")
    && styles.includes(".operations-management-vehicle-search { position: relative")
    && styles.includes(".operations-management-vehicle-search .operations-search-results"),
);
expect(
  "Operations destructive buttons keep readable white text",
  styles.includes(".operations-detail-actions .danger,.mzj-modal-footer .danger { background: #a92d35; color: #fff!important")
    && styles.includes(".crm-automation-row-actions .danger,.crm-automation-choice-body footer .danger")
    && !styles.includes(".crm-automation-row-actions button,.crm-automation-choice-body footer button { color:#a52f36!important"),
);
expect(
  "Vehicle-management search results collapse to one column on small screens",
  styles.includes(".operations-management-vehicle-search .operations-search-results button { grid-template-columns: 1fr; }"),
);

const failed = checks.filter((check) => !check.ok);
if (failed.length) {
  console.error(`\nOperations dashboard consistency checks failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}
console.log(`\nOperations dashboard consistency checks passed: ${checks.length}/${checks.length}`);
