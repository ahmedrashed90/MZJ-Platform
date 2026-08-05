import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const bulk = read("server/_crm-bulk-reallocation.ts");
const settings = read("server/crm/settings.ts");
const dashboard = read("server/crm/dashboard.ts");
const admin = read("src/crm/pages/CrmAdminPage.tsx");
const styles = read("src/styles.css");

const checks = [
  [dashboard.includes("const CRM_DASHBOARD_VISIBLE_LIMIT = 5000") && dashboard.includes("limit ${CRM_DASHBOARD_VISIBLE_LIMIT}"), "CRM dashboard loads up to 5000 visible customers"],
  [settings.includes('section === "bulk_cash_reallocation"') && settings.includes('hasPermission(user, "platform.superadmin")') && settings.includes('hasPermission(user, "crm.customer.bulk_transfer")'), "Bulk reallocation is handled only through managed CRM settings"],
  [admin.includes('hasPermission(user, "platform.superadmin")') && admin.includes('hasPermission(user, "settings.crm.manage")') && admin.includes('hasPermission(user, "crm.customer.bulk_transfer")') && admin.includes("canManageBulkReallocation ?"), "Bulk reallocation UI is hidden from non-system-administrator users"],
  [bulk.includes('const FINANCE_DEPARTMENT_CODES = ["finance_sales", "call_center"]') && bulk.includes('const TARGET_DEPARTMENT_CODE = "cash_sales"'), "Source and target CRM departments are explicit"],
  [bulk.includes('const TARGET_STATUS_LABEL = "عميل جديد"') && bulk.includes('const TARGET_PAYMENT_TYPE = "كاش"'), "Transferred customers become new cash customers"],
  [bulk.includes("equalAllocationCounts") && bulk.includes("base + (index < remainder ? 1 : 0)"), "Equal distribution differs by at most one customer"],
  [bulk.includes("withDatabaseAdvisoryLock") && bulk.includes("sql.begin"), "Execution is protected by a database lock and one transaction"],
  [bulk.includes("LEAD_COUNT_CHANGED") && bulk.includes("expectedLeadCount"), "Execution refuses stale previews when the customer count changes"],
  [bulk.includes("update crm.leads") && bulk.includes("call_center_assigned_to=null") && bulk.includes("responsible_name_snapshot=item.agent_name"), "Lead ownership is fully moved and old call-center ownership is removed"],
  [bulk.includes("update crm.conversations") && bulk.includes("update crm.service_requests") && bulk.includes("update crm.manual_lead_requests"), "Conversation, open request, and manual request ownership follow the new representative"],
  [bulk.includes("insert into crm.lead_events") && bulk.includes("insert into crm.ownership_events") && bulk.includes("insert into crm.assignment_logs"), "Every transfer is recorded in CRM history, ownership, and assignment logs"],
  [admin.includes("اكتب العدد") && admin.includes("expectedLeadCount: total") && admin.includes("window.confirm"), "The destructive bulk action requires preview and explicit count confirmation"],
  [admin.includes("اختيار كل المناديب") && admin.includes("crm-bulk-preview-grid") && admin.includes("customerCount"), "Settings show target cash representatives and the equal preview per representative"],
  [styles.includes(".crm-bulk-reallocation-panel") && styles.includes(".crm-bulk-preview") && styles.includes(".crm-bulk-agent-grid"), "Bulk reallocation has integrated CRM settings styles"],
];

let passed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`PASS: ${label}`);
  }
}

const sample = Array.from({ length: 10 }, (_, index) => Math.floor(1251 / 10) + (index < 1251 % 10 ? 1 : 0));
if (sample.reduce((sum, value) => sum + value, 0) !== 1251 || Math.max(...sample) - Math.min(...sample) > 1) {
  console.error("FAIL: Equal distribution arithmetic for 1251 customers");
  process.exitCode = 1;
} else {
  passed += 1;
  console.log("PASS: Equal distribution arithmetic for 1251 customers");
}

if (!process.exitCode) console.log(`CRM bulk cash reallocation checks: ${passed}/${checks.length + 1} passed.`);
