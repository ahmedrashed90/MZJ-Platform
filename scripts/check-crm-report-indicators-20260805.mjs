import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (name, condition) => {
  if (!condition) throw new Error(`FAIL: ${name}`);
  checks.push(name);
  console.log(`PASS: ${name}`);
};

const admin = read("src/crm/pages/CrmAdminPage.tsx");
const dashboard = read("src/crm/pages/CrmDashboardPage.tsx");
const reports = read("server/crm/reports.ts");
const schema = read("server/_crm-schema.ts");
const migration = read("database/migrations/20260805_crm_report_indicators_settings.sql");

check("CRM settings exposes total, not-contacted, qualified, marketing and sales equations",
  ["إجمالي العملاء", "لم يتم الاتصال", "مؤهل", "جودة التسويق", "جودة المبيعات", "حالات البسط", "حالات المقام"].every((text) => admin.includes(text)));
check("Total-customer setting explicitly excludes customer service", admin.includes("كل العملاء بعد الفلاتر بدون خدمة العملاء"));
check("Dashboard report cards use the saved settings order", dashboard.includes("configuredDashboardReportCards") && dashboard.includes("reportSummary?.quality?.summary_cards"));
check("Cash and finance aliases use the same department mapping as the CRM dashboard",
  reports.includes("='cash' and l.report_department_code in ('cash_sales','wholesale','wholesale_sales')")
    && reports.includes("='finance' and l.report_department_code in ('finance_sales','call_center')"));
check("Report totals and source sections exclude customer-service customers",
  reports.includes('const reportRows = leads.filter((row) => row.department_code !== "customer_service")')
    && reports.includes("totals: makeMetrics(reportRows, reportFacts)")
    && reports.includes("const sourceRows = group(reportRows, reportFacts"));
check("Source drill-down uses the same customer-service exclusion as source totals",
  reports.includes("detailKind}='source' and l.report_department_code<>'customer_service'"));
check("Status indicators count unique customers", reports.includes("new Set(\n      rows.filter((lead) => set.has(norm(lead.status_label)))"));
check("Automatic migration installs the requested formulas once",
  schema.includes("crm-report-indicators-settings-20260805")
    && migration.includes("not_contacted_statuses=array['عميل جديد']")
    && migration.includes("sales_numerator_statuses=array['تم البيع']")
    && migration.includes("where value not in ('عميل جديد','لم يتم الرد')"));
check("Qualified default excludes non-qualified workflow states shown unchecked in the reference",
  migration.includes("'تم البيع','تم الانتهاء','تم الإنتهاء','جاري العمل'"));

const runtimeFiles = [];
for (const base of ["src", "server"]) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) runtimeFiles.push(rel);
    }
  };
  walk(base);
}
const runtimeText = runtimeFiles.map((file) => `${file}\n${read(file)}`).join("\n");
check("Arabic locale formatters force Latin digits",
  !/toLocale(?:String|DateString|TimeString)\(\s*["']ar-SA["']/.test(runtimeText)
    && !/Intl\.(?:NumberFormat|DateTimeFormat)\(\s*["']ar-SA["']/.test(runtimeText)
    && runtimeText.includes("ar-SA-u-nu-latn"));
check("No malformed duplicate Unicode locale extension remains", !runtimeText.includes("u-nu-latn-u-"));
const arabicDigitFiles = runtimeFiles.filter((file) => /[٠-٩]/.test(read(file)));
check("Arabic-Indic digits remain only in input-normalization helpers",
  arabicDigitFiles.every((file) => ["server/data-management.ts", "server/_phone-utils.ts"].includes(file)));

console.log(`CRM report indicators 20260805 checks passed (${checks.length}).`);
