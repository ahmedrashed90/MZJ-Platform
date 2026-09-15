import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const assert = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
};

const dashboardData = read("server/_dashboard-data.ts");
const trackingOrders = read("server/tracking/orders.ts");
const trackingCounts = read("server/_tracking-counts.ts");
const dashboardPage = read("src/pages/DashboardPage.tsx");
const crmPage = read("src/crm/pages/CrmDashboardPage.tsx");
const crmDashboardApi = read("server/crm/dashboard.ts");
const styles = read("src/styles.css");

assert(trackingCounts.includes("export async function getTrackingCountSummary"), "Tracking counters have one canonical server helper");
assert(trackingCounts.includes("status='not_started'") && trackingCounts.includes("status='in_progress'") && trackingCounts.includes("status='completed'"), "Canonical Tracking helper counts the three active statuses");
assert(dashboardData.includes("const counts = await getTrackingCountSummary(sql, user);"), "Unified dashboard uses canonical all-active Tracking counters");
assert(!dashboardData.includes("data.operations.salesTracking.notStarted ="), "Unified dashboard no longer maintains a separate drifting not-started query");
assert(trackingOrders.includes("getTrackingCountSummary(sql, user, { from, to })"), "Tracking orders page uses the same canonical counter helper");

const trackingListStart = dashboardPage.indexOf("async function openTrackingList");
const trackingListEnd = dashboardPage.indexOf("async function openTrackingOrder", trackingListStart);
const trackingListBlock = dashboardPage.slice(trackingListStart, trackingListEnd);
assert(trackingListStart >= 0 && trackingListEnd > trackingListStart, "Unified dashboard Tracking list opener is present");
assert(!trackingListBlock.includes("appliedRange"), "Unified dashboard Tracking drawers use the same unbounded active list as Tracking");
assert(dashboardPage.includes('title="إجمالي المخزون" badge={operations?.inventory.actualTotal ?? null}'), "Inventory card exposes its total in the card header");
assert(dashboardPage.includes('badge !== undefined ? "operation-card-has-badge"'), "Operation cards mark headers that contain total badges");
assert(styles.includes(".dashboard-operation-widget .operation-card-has-badge .operation-card-head { padding-left: 52px; }"), "Operation total badge is clear of the drag handle");

assert(crmPage.includes('const [agent, setAgent] = useState("");'), "CRM dashboard has a representative filter state");
assert(crmPage.includes("queryString({ department, q, branch, agent })"), "CRM dashboard lead request includes the representative filter");
assert(crmPage.includes("queryString({ department, q, branch, agent, summaryOnly: 1 })"), "CRM dashboard summary cards follow the representative filter");
assert(crmPage.includes('<option value="">كل المناديب</option>'), "CRM dashboard renders the representatives dropdown next to branches");
assert(crmDashboardApi.includes("const agent = clean(request.query.agent);"), "CRM dashboard API reads the representative filter");
assert(crmDashboardApi.includes("l.assigned_to = ${agent || null}::uuid"), "CRM dashboard API filters customers by their assigned representative");
assert(!crmPage.includes("الكول سنتر:"), "Finance dashboard cards no longer show the call-center unassigned line");
assert(styles.includes("grid-template-columns: minmax(300px,1fr) 190px 190px auto"), "CRM toolbar layout accommodates both branch and representative filters");

console.log("Unified dashboard Tracking, CRM filters, and visible totals checks passed.");
