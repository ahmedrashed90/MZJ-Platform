import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const packageJson = JSON.parse(read("package.json"));
const drawer = read("src/crm/components/LeadDrawer.tsx");
const leadsApi = read("server/crm/leads.ts");
const reports = read("server/crm/reports.ts");
const erpSync = read("server/_erpnext-sales-order-sync.ts");
const contacts = read("server/crm/contacts.ts");
const budgetManager = read("src/marketing/components/CampaignBudgetManager.tsx");
const marketingDatabase = read("src/marketing/pages/MarketingDatabasePage.tsx");
const marketingCss = read("src/marketing/marketing.css");

const checks = [];
function check(label, condition) {
  const passed = Boolean(condition);
  checks.push([label, passed]);
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
}

check("release version is 1.19.16", packageJson.version === "1.19.16");

check("wholesale remains a first-class department in customer edit", drawer.includes('label: "قسم الجملة"') && drawer.includes("isWholesaleDepartmentCode"));
check("both wholesale department codes share the same user pool", drawer.includes("function userMatchesDepartment") && drawer.includes("codes.some((code) => isWholesaleDepartmentCode(code))"));
check("wholesale branch selector is enabled and required", drawer.includes('value={activeForm.branchCode} required={isWholesaleDepartmentCode(activeForm.departmentCode)}') && !/<select[^>]*disabled=\{isWholesaleDepartmentCode\(activeForm\.departmentCode\)\}/.test(drawer));
check("wholesale branch selector asks for a real branch", drawer.includes("اختر فرع قسم الجملة") && !drawer.includes("قسم الجملة بدون فرع"));
check("the central wholesale branch is always available in the selector", drawer.includes("isWholesaleBranch(branch) || userBranchCodes.has(branch.code)") && drawer.includes("isWholesaleBranch(branch) || allowedBranchCodes.has(branch.code)"));
check("customer edit validates wholesale branch in UI and API", drawer.includes("اختر فرع قسم الجملة قبل حفظ بيانات العميل") && leadsApi.includes("اختر فرع قسم الجملة قبل حفظ بيانات العميل"));
check("customer edit still updates the same canonical CRM lead", drawer.includes('payload.databaseEdit = true') && drawer.includes('method: "PATCH"') && leadsApi.includes("update crm.leads set"));

check("lead reports canonicalize the wholesale department by department or branch", reports.includes("raw_effective.department_code in ('wholesale','wholesale_sales')") && reports.includes("raw_effective_branch.name,'') ilike '%الجملة%"));
check("historic wholesale leads without branch resolve to the master wholesale branch", reports.includes("then coalesce(raw_effective.branch_code,wholesale_branch.code)") && reports.includes("then coalesce(nullif(l.branch_code,''),wholesale_branch.code)"));
check("sales transactions on the wholesale branch canonicalize to wholesale", reports.includes("const transactionWholesaleIdentitySql") && reports.includes("transaction_branch.name,'') ilike '%الجملة%'"));
check("transaction department, display, scope, and filter share the canonical identity", reports.includes("const transactionDepartmentCodeSql") && reports.includes("(${transactionDepartmentCodeSql}) as department_code") && reports.includes("(${transactionDepartmentCodeSql})=any(${scope.departmentCodes}::text[])") && reports.includes("(${transactionBranchCodeSql})=${branch || null}"));
check("department report groups by the same canonical department and branch", reports.includes("`${row.department_code || \"__none__\"}|${row.branch_code || \"__none__\"}`") && reports.includes("`${fact.department_code || \"__none__\"}|${fact.branch_code || \"__none__\"}`"));
check("future ERP wholesale sales retain or resolve a branch", erpSync.includes("coalesce(br.code,wholesale_branch.code)") && !erpSync.includes("allowsBranchlessCrmSales"));
check("sales-order customer reassignment retains the wholesale branch", contacts.includes("coalesce(crm_branch.code,global_branch.code,wholesale_branch.code)") && contacts.includes("const salespersonBranchCode = clean(salesperson.branch_code) || null"));

check("campaign budget editor opens as a full-screen modal", budgetManager.includes("marketing-campaign-budget-modal-fullscreen") && marketingCss.includes(".mzj-modal-card.marketing-campaign-budget-modal-fullscreen") && marketingCss.includes("inset: 0"));
check("budget editor keeps simple fields as direct labels and inputs", budgetManager.includes("marketing-campaign-budget-simple-fields") && marketingCss.includes(".marketing-campaign-budget-simple-fields label { min-width: 0; display: grid") && !marketingCss.includes(".marketing-campaign-budget-simple-fields label { min-height:"));
check("platform rows have no outer card", marketingCss.includes(".marketing-campaign-budget-platforms > section {") && marketingCss.includes("border: 0;") && marketingCss.includes("background: transparent;") && marketingCss.includes("border-bottom: 1px solid"));
check("only the platform amount remains an input box", budgetManager.includes('placeholder="قيمة المنصة"') && marketingCss.includes(".marketing-campaign-budget-platforms > section > input") && marketingCss.includes("border: 1px solid #d8cbc5"));
check("budget display is a clean detail table", marketingDatabase.includes("marketing-budget-details-table") && ["Funnel", "الكرييتيف", "المنصات والميزانية", "عدد الإعلانات", "هدف المحتوى", "الهدف المتوقع", "إجمالي البند"].every((label) => marketingDatabase.includes(`>${label}<`)));
check("budget display uses the custom creative name first", marketingDatabase.includes("creative?.name || creative?.creative_type_name") && budgetManager.includes("creative.name || creative.creative_type_name"));
check("budget totals are recalculated from platform amounts before legacy stored totals", marketingDatabase.includes("if (platformDetails.length)") && marketingDatabase.indexOf("if (platformDetails.length)") < marketingDatabase.indexOf("const storedTotal = Number(item?.total)"));
check("Funnel total remains one sum regardless of linked creatives", budgetManager.includes("item.platformAmounts.reduce") && !budgetManager.includes("creativeIds.length *"));
check("no release-specific migration or patch file exists", !fs.existsSync(path.join(root, "database/migrations/20260808_crm_wholesale_branch_marketing_budget_v11916.sql")) && !fs.existsSync(path.join(root, "database/migrations/20260808_v11916_patch.sql")));

const failed = checks.filter(([, passed]) => !passed);
console.log(`CRM wholesale branch + marketing budget checks: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
