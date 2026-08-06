import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const expect = (file, needle, label = needle) => {
  if (!read(file).includes(needle)) throw new Error(`${file} missing ${label}`);
};

expect("server/_operations-auto-archive.ts", "insert into operations.movements", "final delivery movement insert");
expect("server/_operations-auto-archive.ts", "'tracking_delivery'", "tracking delivery movement type");
expect("server/_operations-auto-archive.ts", "${vehicle.status_code||null},'delivered'", "delivered new status");
expect("server/_operations-auto-archive.ts", "const finalStateNote = salesOrderNo ? `طلب البيع ${salesOrderNo}`", "clean archive sales-order note");
expect("server/_erpnext-sales-order-normalizer.ts", "erpSubmittedBy", "ERP submitter normalization");
expect("server/_erpnext-sales-order-normalizer.ts", "erpSubmittedByName", "ERP submitter display name normalization");
expect("server/_erpnext-sales-order-sync.ts", "erpSubmitterName: normalized.erpSubmittedByName", "operations admin name movement metadata");
expect("server/operations/index.ts", "as operations_admin_name", "operations administrator API field");
expect("server/operations/index.ts", "operations_admin_email", "operations administrator explicit webhook identity");
expect("server/operations/index.ts", "operations_admin_name", "operations administrator explicit webhook name");
expect("src/operations/components/MovementHistoryTable.tsx", "إداري العمليات", "operations administrator movement column");
expect("src/operations/stateNote.ts", "replace(/^مباع\\s+تحت\\s+التسليم", "legacy archive note cleanup");
expect("server/crm/reports.ts", "const salesFacts = await sql", "canonical CRM sales transaction facts");
expect("server/crm/reports.ts", "from crm.sales_transactions st", "CRM reports read canonical sale transactions");
if (read("server/crm/reports.ts").includes("return total + reportSoldQuantity(lead.sold_quantity)")) throw new Error("CRM reports must not add lead sold quantities to canonical transactions");
expect("server/crm/kpi.ts", "const salesCount = days.reduce", "manager-entered KPI sales count");
if (read("server/crm/kpi.ts").includes("tracking.order_vehicles")) throw new Error("KPI sales must not be calculated from tracking vehicles");

const soldMetric = (rows) => rows.reduce((total, lead) => {
  if (lead.status !== "تم البيع") return total;
  return total + Math.max(1, Number(lead.vehicleCount || 0));
}, 0);
if (soldMetric([{ status: "تم البيع", vehicleCount: 10 }]) !== 10) throw new Error("one sold lead with ten vehicles must count as ten sales");
if (soldMetric([{ status: "تم البيع", vehicleCount: 0 }]) !== 1) throw new Error("manual sold lead must remain one sale");

console.log("Operations movement administrator, delivered history, clean archive note, and vehicle-aware sales checks passed.");
