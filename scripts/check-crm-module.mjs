import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "server/crm/dashboard.ts",
  "server/crm/leads.ts",
  "server/crm/conversations.ts",
  "server/crm/manual-leads.ts",
  "server/crm/history.ts",
  "server/crm/reports.ts",
  "server/crm/kpi.ts",
  "server/crm/inbox-agent.ts",
  "server/crm/settings.ts",
  "server/_crm-customer-fields.ts",
  "src/crm/pages/CrmDashboardPage.tsx",
  "src/crm/pages/CrmDatabasePage.tsx",
  "src/crm/pages/CrmManualLeadsPage.tsx",
  "src/crm/pages/CrmFinanceHistoryPage.tsx",
  "src/crm/pages/CrmReportsPage.tsx",
  "src/crm/pages/CrmKpiPage.tsx",
  "src/crm/pages/CrmInboxAgentPage.tsx",
  "src/crm/pages/CrmAdminPage.tsx",
];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing CRM module file: ${file}`);
}

const schema = fs.readFileSync(path.join(root, "server/_crm-schema.ts"), "utf8");
const requiredStatuses = [
  "عميل جديد",
  "تم الاتصال",
  "لم يتم الرد",
  "غير مؤهل",
  "مؤجل",
  "مؤهل - لم يتم إرسال الأوراق",
  "مؤهل - تأخر في إرسال الأوراق",
  "مؤهل - تم إرسال الأوراق",
  "تم رفع الطلب الى جهة التمويل",
  "طلب إستكمال أوراق",
  "تم إختيار السيارة",
  "تم توقيع العقد",
  "تم الإنتهاء - إنشاء طلب البيع",
];
for (const status of requiredStatuses) {
  if (!schema.includes(status)) throw new Error(`Missing CRM status: ${status}`);
}

const customerFieldsHelper = fs.readFileSync(path.join(root, "server/_crm-customer-fields.ts"), "utf8");
const customerDrawer = fs.readFileSync(path.join(root, "src/crm/components/LeadDrawer.tsx"), "utf8");
const crmSettings = fs.readFileSync(path.join(root, "server/crm/settings.ts"), "utf8");
const crmLeads = fs.readFileSync(path.join(root, "server/crm/leads.ts"), "utf8");
const crmDashboard = fs.readFileSync(path.join(root, "server/crm/dashboard.ts"), "utf8");
const dynamicFieldChecks = [
  [schema.includes("crm.customer_field_definitions"), "Missing customer field definitions migration"],
  [customerFieldsHelper.includes("include_in_completion"), "Completion settings are not read from customer fields"],
  [customerFieldsHelper.includes("department_keys.includes(department)"), "Completion does not respect department-specific fields"],
  [customerDrawer.includes("meta?.customerFields"), "Customer drawer is not generated from field settings"],
  [crmSettings.includes('section === "customer_field"'), "Customer field settings API is missing"],
  [crmLeads.includes("sanitizeCustomFieldValues"), "Customer custom values are not persisted safely"],
  [crmDashboard.includes("calculateLeadCompletion(row, customerFields)"), "Dashboard completion is not recalculated dynamically"],
];
for (const [passed, message] of dynamicFieldChecks) {
  if (!passed) throw new Error(String(message));
}

const filesToScan = ["src", "api", "server", "database"];
const forbidden = ["أحمد محمد", "Ahmed Mohamed", "عميل تجريبي"];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (/\.(ts|tsx|js|jsx|sql)$/.test(entry.name)) {
      const text = fs.readFileSync(target, "utf8");
      for (const value of forbidden) {
        if (text.includes(value)) throw new Error(`Forbidden sample data '${value}' in ${path.relative(root, target)}`);
      }
    }
  }
}
for (const directory of filesToScan) walk(path.join(root, directory));
console.log("CRM module structure and no-sample-data check passed.");
