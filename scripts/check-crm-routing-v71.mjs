import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const cash = read("server/crm/cash-qr.ts");
const utils = read("server/_crm-utils.ts");
const schema = read("server/_crm-schema.ts");
const normalizer = read("server/_erpnext-sales-order-normalizer.ts");
const sync = read("server/_erpnext-sales-order-sync.ts");

const checks = [
  ["QR lead keeps Website as source", cash.includes('const WEBSITE_SOURCE_CODE = "website"') && cash.includes('const WEBSITE_SOURCE_NAME = "Website"')],
  ["QR route uses dedicated source-independent assignment helper", cash.includes("chooseCashQrAssignment()") && cash.includes("routingIndependentOfSource: true")],
  ["QR no longer assigns the virtual Website user directly", !cash.includes("WEBSITE_OWNER_EMPLOYEE_NO") && !cash.includes("websiteOwner.id")],
  ["QR writes the selected real branch and representative", cash.includes("${assignment.branchCode}") && cash.includes("${assignment.assignedTo}::uuid")],
  ["QR helper can honor QR-compatible configured cash rules", utils.includes('chooseFromConfiguredRule("cash_sales", "", "qr")')],
  ["QR fallback excludes virtual Website identity and branch", utils.includes("coalesce(u.employee_no,'')<>'SYSTEM-WEBSITE'") && utils.includes("b.code<>'website'")],
  ["QR fallback requires active lead-receiving cash-sales users", utils.includes("u.can_receive_leads=true") && utils.includes("d.code='cash_sales'")],
  ["QR fallback persists round-robin state", utils.includes('const poolKey = "cash_qr:cash_sales:all_branches"') && utils.includes("cash_qr_fallback")],
  ["runtime schema no longer forces existing cash_qr leads onto Website", !schema.includes("where l.platform_code='cash_qr'\n          and u.employee_no='SYSTEM-WEBSITE'")],
  ["Website virtual user remains available for confirmed online orders", schema.includes("SYSTEM-WEBSITE") && schema.includes("values('website','الموقع الإلكتروني'")],
  ["WC purchase-order marker classifies website checkout", normalizer.includes('/^WC-\\d+$/i.test(purchaseOrderReference)')],
  ["online website sale resolves dedicated Website CRM owner", sync.includes("resolveWebsiteCrmOwner") && sync.includes("crmOwnerMapping = websiteOrder ? websiteCrmOwner : mapping")],
  ["manual NEXT sale keeps mapped salesperson as CRM owner", sync.includes("crmOwnerMapping = websiteOrder ? websiteCrmOwner : mapping") && sync.includes("mapping: crmOwnerMapping")],
  ["sale updates lead ownership and branch at sale time", sync.includes("assigned_to=${mapping.id}::uuid") && sync.includes("responsible_name_snapshot=${mapping.full_name}") && sync.includes("branch_code=${branchCode}")],
  ["online/manual ownership change remains cancel-restorable", sync.includes("crm_previous_state") && sync.includes("Cancellation restores")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log(`CRM routing v71 checks: ${checks.length}/${checks.length} passed.`);
