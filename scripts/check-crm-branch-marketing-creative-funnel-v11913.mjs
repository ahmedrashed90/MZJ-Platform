import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const packageJson = JSON.parse(read("package.json"));
const reports = read("server/crm/reports.ts");
const marketingServer = read("server/marketing/index.ts");
const permissions = read("server/_api-permissions.ts");
const types = read("src/marketing/types.ts");
const editor = read("src/marketing/components/CreativeEditor.tsx");
const manager = read("src/marketing/components/EntityCreativeManager.tsx");
const funnel = read("src/marketing/components/FunnelSelect.tsx");
const campaign = read("src/marketing/pages/CreateCampaignPage.tsx");
const database = read("src/marketing/pages/MarketingDatabasePage.tsx");
const dashboard = read("src/marketing/pages/MarketingDashboardPage.tsx");
const publishPrep = read("src/marketing/pages/PublishPrepPage.tsx");
const engagementServer = read("server/_marketing-engagement.ts");

const checks = [];
function check(label, condition) {
  checks.push([label, Boolean(condition)]);
}

const salesFactsStart = reports.indexOf("const salesFacts = await sql<any[]>`");
const salesFactsEnd = reports.indexOf("const [storedQuality]", salesFactsStart);
const salesFacts = reports.slice(salesFactsStart, salesFactsEnd);
const taskSnapshotStart = marketingServer.indexOf("function creativeTaskFlowSnapshot");
const taskSnapshotEnd = marketingServer.indexOf("async function replaceCreativeBudgets", taskSnapshotStart);
const taskSnapshot = marketingServer.slice(taskSnapshotStart, taskSnapshotEnd);

check("release retains the v1.19.13 canonical fixes", ["1.19.13", "1.19.14", "1.19.15", "1.19.16"].includes(packageJson.version));

check("CRM sold metric remains canonical sales transactions", salesFacts.includes("from crm.sales_transactions st"));
check("missing sale branch falls back to the representative primary CRM branch", reports.includes("coalesce(nullif(st.branch_code,''),assigned_primary_branch.code,nullif(l.branch_code,''))"));
check("wholesale sales keep one canonical branch identity", reports.includes("const transactionWholesaleIdentitySql") && reports.includes("then coalesce(nullif(st.branch_code,''),nullif(l.branch_code,''),assigned_primary_branch.code,${wholesaleBranchFallbackSql})"));
check("representative branch comes from central CRM assignments", reports.includes("from core.user_system_branches usb") && reports.includes("usb.system_code='crm'"));
check("sales display uses the effective transaction branch", salesFacts.includes("(${transactionBranchCodeSql}) as branch_code"));
check("sales data scope uses the same effective branch", salesFacts.includes("(${transactionBranchCodeSql})=any(${scope.branchCodes}::text[])"));
check("explicit branch filtering uses the same effective branch in summary and drill-down", (reports.match(/\(\$\{transactionBranchCodeSql\}\)=\$\{branch \|\| null\}/g) || []).length >= 2);
check("agent sold drill-down joins the same representative branch", reports.includes("agent_sale_rows as") && reports.includes(") assigned_primary_branch on true"));
check("ERP orders are not added as a second sold metric", !salesFacts.includes("integrations.erpnext_sales_orders"));
check("lead sold quantity is not added as a second sold metric", !salesFacts.includes("l.sold_quantity"));

check("creative draft has a first-class name", /export type CreativeDraft[\s\S]*?name: string;/.test(types));
check("campaign creation shows creative name and hides quantity", campaign.includes("showNameField showQuantity={false}"));
check("agenda quantity behavior remains available", editor.includes("showQuantity = true") && editor.includes("{showQuantity ? <label>"));
check("creative name is limited and required for campaigns", editor.includes("maxLength={160}") && marketingServer.includes("اسم الكرييتيف يجب ألا يزيد عن 160 حرف"));
check("new campaign creatives store one row and the custom name", marketingServer.includes("${creativeTypeId}::uuid,1,'required',${instanceCode},${creativeName}") && marketingServer.includes("creativeName,"));
check("existing campaign creative loads and updates the same central name", manager.includes("name: String(row?.name") && marketingServer.includes("status=case when ${taskFlowChanged} then 'required' else status end,name=${creativeName}"));
check("campaign creative quantity is normalized to one without changing agenda quantity", marketingServer.includes("quantity=${sourceType === 'campaign' ? 1 : Math.max(1, numberValue(rawCreative.quantity, 1))}"));
check("name-only edits do not reset task flow", !taskSnapshot.includes("name:"));
check("name-only edits preserve unchanged shared budget items", marketingServer.includes("function creativeBudgetSnapshot") && marketingServer.includes("(!existingId || budgetsChanged)") && marketingServer.includes("creativeBudgetSnapshot(currentBudgets) !== creativeBudgetSnapshot(budgetInputs)"));
check("name-only edits preserve unchanged publishing schedule", marketingServer.includes("function creativeScheduleSnapshot") && marketingServer.includes("(!existingId || scheduleChanged)") && marketingServer.includes("groupedScheduleSnapshotRows(currentScheduleRows)"));

check("campaign budget total is no longer multiplied by linked creatives", !campaign.includes("platformTotal * creativeCount") && campaign.includes("return item.platformAmounts.reduce"));
check("database grand total sums each stored budget item once", database.includes("budgetItems.reduce((sum: number, item: any) => sum + budgetItemTotal(item), 0)") && !database.includes("budgetPerCreativeTotal"));
check("database budget display does not cross-product creatives and platforms", database.includes("marketing-budget-overview") && database.includes("budgetOverview") && !database.includes("creativeEntries.flatMap"));

check("new Funnel can be added inline in creation and edit", funnel.includes('action: "create_funnel"') && campaign.includes("<FunnelSelect") && manager.includes("<FunnelSelect"));
check("adding a Funnel during creative edit does not reset the editor", !manager.includes("[open, creativeRow, detail, meta.funnels]") && manager.includes("setFunnels(meta.funnels);") && manager.includes("}, [meta.funnels]);"));
check("Funnel creation is handled by the canonical marketing API", marketingServer.includes("async function createFunnel") && marketingServer.includes("action==='create_funnel'"));
check("Funnel API keeps campaign create or edit permission checks", marketingServer.includes('hasPermission(user, "marketing.campaign.create")') && marketingServer.includes('hasPermission(user, "marketing.campaign.edit")'));
check("gateway recognizes Funnel creation without bypassing handler checks", permissions.includes('create_funnel: "system.marketing.access"'));

check("dashboard TASK display uses the central creative name", dashboard.includes("task.creative_name"));
check("publish preparation displays the central creative name", publishPrep.includes("row.creative_name") && marketingServer.includes("c.name as creative_name"));
check("engagement displays the central creative name", engagementServer.includes("coalesce(cr.name,cr.instance_code,cr.creative_type,'—') as creative_name"));
check("no schema migration is introduced for this release", !fs.existsSync(path.join(root, "database/migrations/20260808_crm_branch_marketing_creative_funnel_v11913.sql")));

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) failed += 1;
}
console.log(`CRM branch + marketing creative/Funnel checks: ${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);
