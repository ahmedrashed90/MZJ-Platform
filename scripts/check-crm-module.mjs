import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "api/crm/dashboard.ts",
  "api/crm/leads.ts",
  "api/crm/conversations.ts",
  "api/crm/manual-leads.ts",
  "api/crm/history.ts",
  "api/crm/reports.ts",
  "api/crm/kpi.ts",
  "api/crm/inbox-agent.ts",
  "api/crm/settings.ts",
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

const schema = fs.readFileSync(path.join(root, "api/_crm-schema.ts"), "utf8");
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

const filesToScan = ["src", "api", "database"];
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
