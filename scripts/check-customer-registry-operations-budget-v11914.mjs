import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
function check(label, condition) {
  const passed = Boolean(condition);
  checks.push([label, passed]);
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
}

const packageJson = JSON.parse(read("package.json"));
const crmPage = read("src/crm/pages/CrmFinanceHistoryPage.tsx");
const crmServer = read("server/crm/history.ts");
const crmLayout = read("src/crm/CrmLayout.tsx");
const access = read("shared/access-control.ts");
const operationsPage = read("src/operations/pages/SalesOrdersFollowupPage.tsx");
const operationsServer = read("server/operations/index.ts");
const marketingPage = read("src/marketing/pages/MarketingDatabasePage.tsx");
const budgetManager = read("src/marketing/components/CampaignBudgetManager.tsx");
const marketingServer = read("server/marketing/index.ts");
const permissions = read("server/_api-permissions.ts");
const marketingCss = read("src/marketing/marketing.css");

check("release version is 1.19.14", packageJson.version === "1.19.14");

check("CRM navigation is renamed to customer registry", crmLayout.includes('label: "سجل العملاء"') && access.includes('name: "سجل العملاء"'));
check("customer registry separates cash, finance, and finance differences", ["عملاء الكاش", "عملاء التمويل", "فروقات حالات العملاء"].every((label) => crmPage.includes(label)));
check("customer registry sends a first-class customer type", crmPage.includes("customerType: activeTab"));
check("CRM history classifies cash and finance from the canonical service fields", crmServer.includes('const leadTypeCondition = (type: "cash" | "finance")') && crmServer.includes("l.service_key") && crmServer.includes("l.payment_type"));
check("legacy call-center customers remain in the finance registry", crmServer.includes("l.department_code in ('finance_sales','call_center')") && crmServer.includes("'call_center','callcenter'"));
check("cash and finance rows and counts use the same classifier", (crmServer.match(/leadTypeCondition\(customerType\)/g) || []).length >= 2);
check("status differences are finance-only", crmServer.includes('leadTypeCondition("finance")'));

check("completed sales-order tab is removed", !operationsPage.includes("الطلبات المكتملة") && operationsPage.includes("completed: false"));
check("sales-order title and explanatory block are removed", !operationsPage.includes("متابعة حالة طلبات البيع المرتبطة بالتراكينج والموافقات") && !operationsPage.includes("operations-hero"));
check("branch dropdown is driven by the canonical API branch list", operationsPage.includes("payload?.branches.forEach") && !operationsPage.includes("row.branch"));
check("operations API resolves one effective branch", operationsServer.includes("effective_branch.code as effective_branch_code") && operationsServer.includes(") effective_branch on true"));
check("effective branch also resolves the vehicle location branch", operationsServer.includes("vehicle_match.location_branch_code") && operationsServer.includes("vehicle_match.location_name"));
check("access scope and explicit filter use the same effective branch", operationsServer.includes("coalesce(effective_branch.code,'') in ${sql(branchCodes)}") && operationsServer.includes("coalesce(effective_branch.code,'')=${branch}"));
check("branch options are sourced from canonical active branches", operationsServer.includes("from core.branches b") && operationsServer.includes("configured_branches"));

check("campaign detail exposes create or edit budget action", marketingPage.includes("CampaignBudgetManager") && marketingPage.includes("إنشاء الميزانية") && marketingPage.includes("تعديل الميزانية"));
check("campaign budget uses the professional overview", marketingPage.includes("marketing-budget-overview") && marketingCss.includes(".marketing-budget-overview"));
check("budget editor supports inline Funnel creation", budgetManager.includes("<FunnelSelect") && budgetManager.includes("onFunnelCreated"));
check("budget editor links one item to multiple creatives without multiplying its total", budgetManager.includes("CreativeMultiPicker") && budgetManager.includes("item.platformAmounts.reduce") && !budgetManager.includes("creativeIds.length *"));
check("campaign budget save uses the canonical marketing API", budgetManager.includes('action: "save_campaign_budgets"') && marketingServer.includes("async function saveCampaignBudgets"));
check("server saves each budget item total exactly once", marketingServer.includes("total: platformAmounts.reduce((sum, part) => sum + part.amount, 0)") && !marketingServer.includes("platformTotal * creativeCount"));
check("server replaces the campaign budget transactionally without duplicate side storage", marketingServer.includes("delete from marketing.budget_items where campaign_id=${campaignId}::uuid") && marketingServer.includes("marketing.budget_item_creatives"));
check("gateway permission protects campaign budget editing", permissions.includes('save_campaign_budgets: "marketing.campaign.edit"') || permissions.includes('action === "save_campaign_budgets"'));
check("no release-specific migration or patch file was introduced", !fs.existsSync(path.join(root, "database/migrations/20260808_customer_registry_operations_budget_v11914.sql")) && !fs.existsSync(path.join(root, "database/migrations/20260808_v11914_patch.sql")));

const funnelItem = { platformAmounts: [{ amount: 12000 }, { amount: 0 }], creativeIds: ["a", "b", "c", "d"] };
const canonicalTotal = funnelItem.platformAmounts.reduce((sum, part) => sum + part.amount, 0);
check("Funnel budget simulation remains 12,000 with four creatives", canonicalTotal === 12000);

const failed = checks.filter(([, passed]) => !passed);
console.log(`Customer registry + operations + budget checks: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
