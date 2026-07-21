import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const pkg = read("package.json");
const dashboardData = read("server/_dashboard-data.ts");
const dashboardPage = read("src/pages/DashboardPage.tsx");
const crmDashboard = read("server/crm/dashboard.ts");
const operationsApi = read("server/operations/index.ts");
const dashboardModal = read("src/operations/components/DashboardOperationsModal.tsx");
const inventoryPage = read("src/operations/pages/InventoryPage.tsx");
const vehicleTable = read("src/operations/components/VehicleTable.tsx");
const vehicleDetail = read("src/operations/components/VehicleDetailModal.tsx");
const movementPage = read("src/operations/pages/MovementHistoryPage.tsx");
const styles = read("src/styles.css");

const shortageFields = ["car_name", "statement", "model_year", "exterior_color", "interior_color"];
const pdfHeaders = [
  "رقم الهيكل (VIN)", "السيارة", "البيان", "الوكيل", "اللون الداخلي", "اللون الخارجي", "موديل", "اللوحة",
  "اسم الدفعة بالتاريخ", "التاريخ", "المكان السابق", "المكان الحالي", "ملاحظات في السيارة", "حجز - نواقص - تحديد مكان",
  "الحالة السابقة", "الحالة الحالية", "حساس", "كاميرا", "مكيف", "مسجل", "شاشة", "ريموت", "فرشات", "طفاية",
  "شنطة سلامة", "اسبير", "الموافقة المالية", "الموافقة الإدارية", "منفذ الحركة", "رقم الطلب",
];

const checks = [
  ["Version is 1.16.1", pkg.includes('"version": "1.16.1"')],
  ["Department cards use department-specific open conversation totals", ["openCashConversations", "openFinanceConversations", "openServiceConversations"].every((key) => dashboardData.includes(key) && dashboardPage.includes(key))],
  ["Open conversations exclude closed rows", dashboardData.includes("status='open' and closed_at is null") && dashboardData.includes("classification_state,'')<>'closed'")],
  ["Transferred conversations follow the current lead department", dashboardData.includes("coalesce(nullif(l.department_code,''),nullif(c.department_code,''))")],
  ["Shortages use the five-field vehicle combination", shortageFields.every((field) => dashboardData.includes(field) && operationsApi.includes(field))],
  ["Shortages use only active available, reserved, and note statuses", dashboardData.includes("v.status_code in ('available_for_sale','reserved','has_notes')") && operationsApi.includes("v.status_code in ('available_for_sale','reserved','has_notes')")],
  ["Shortages exclude agency and use the four requested stock locations", dashboardData.includes("l.code in ('warehouse','hall','multaqa','qadisiyah')") && operationsApi.includes("l.code in ('warehouse','hall','multaqa','qadisiyah')")],
  ["Accessory statements are excluded from shortages", dashboardData.includes("شنطةسلامة|اسبير|إسبير") && operationsApi.includes("شنطةسلامة|اسبير|إسبير")],
  ["Shortage total counts missing combinations by branch", dashboardData.includes("multaqa_qty=0") && dashboardData.includes("hall_qty=0") && dashboardData.includes("qadisiyah_qty=0") && dashboardData.includes("warehouse_qty+hall_qty+multaqa_qty+qadisiyah_qty")],
  ["Dashboard shortage card opens complete shortage details", dashboardPage.includes('mode: "shortages"') && dashboardModal.includes('resource: "dashboard_shortages"') && dashboardModal.includes("الإجمالي المتاح")],
  ["Dashboard popups use wrapping wide layouts", styles.includes("dashboard-drilldown-table") && styles.includes("overflow-wrap: anywhere") && styles.includes("dashboard-shortages-table")],
  ["Inventory search applies while typing without Enter", inventoryPage.includes("setTimeout") && inventoryPage.includes("setAppliedSearch(search.trim())") && !inventoryPage.includes('onKeyDown={(event) => { if (event.key === "Enter")')],
  ["Tracking is restored as a progress button", vehicleTable.includes("operations-tracking-open") && vehicleTable.includes("tracking_progress") && vehicleTable.includes("<button")],
  ["Vehicle detail tabs remain centered and tracking opens as a button", vehicleDetail.includes("operations-tracking-detail-button") && styles.includes(".operations-detail-tabs { justify-content: center")],
  ["Movement filters use the upgraded apply action", movementPage.includes("operations-apply-filters-button") && styles.includes("operations-apply-filters-button")],
  ["Movement history provides A3 landscape PDF export", movementPage.includes("@page{size:A3 landscape") && movementPage.includes("تصدير PDF A3")],
  ["A3 PDF contains every requested column", pdfHeaders.every((header) => movementPage.includes(header))],
  ["A3 PDF renders present as correct and absent as wrong", movementPage.includes("mark yes") && movementPage.includes("mark no") && movementPage.includes('=== "ok"')],
  ["Movement API returns the requested vehicle, check, approval, actor, and request data", ["agent_name", "interior_color", "exterior_color", "plate_no", "batch_no", "sensor_status", "camera_status", "financial_approved", "administrative_approved", "request_no"].every((field) => operationsApi.includes(field))],
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
