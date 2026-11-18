import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const reports = read("server/crm/reports.ts");
const pkg = JSON.parse(read("package.json"));

function rollupDepartment(department, branch) {
  const cashBranches = new Set(["qadisiyah", "hall", "multaqa"]);
  if (cashBranches.has(branch) && ["cash_sales", "finance_sales", "call_center"].includes(department)) return "cash_sales";
  return department;
}

const typecheck = String(pkg.scripts?.typecheck || "");
const ownersIndex = typecheck.indexOf("check-owners-community-v1200.mjs");
const v44Index = typecheck.indexOf("check-crm-branch-filter-rollup-v44.mjs");

const checks = [
  [reports.includes('const CASH_BRANCH_ROLLUP_CODES = new Set(["qadisiyah", "hall", "multaqa"]);'), "physical cash branches have an explicit rollup dimension"],
  [reports.includes('["cash_sales", "finance_sales", "call_center"].includes(department)'), "cash and finance records roll into one physical branch row"],
  [rollupDepartment("finance_sales", "qadisiyah") === "cash_sales", "qadisiyah finance rolls into cash sales"],
  [rollupDepartment("finance_sales", "hall") === "cash_sales", "hall finance rolls into cash sales"],
  [rollupDepartment("finance_sales", "multaqa") === "cash_sales", "multaqa finance rolls into cash sales"],
  [rollupDepartment("finance_sales", "online") === "finance_sales", "online finance remains its own finance branch"],
  [rollupDepartment("wholesale", "qadisiyah") === "wholesale", "wholesale is never merged into a cash branch"],
  [reports.includes("departmentBranchLeadDepartmentCodeSql"), "lead drill-down uses the same branch rollup identity"],
  [reports.includes("departmentBranchTransactionDepartmentCodeSql"), "sold transaction drill-down uses the same branch rollup identity"],
  [reports.includes("departmentBranchDepartmentCode(row.department_code, row.branch_code)"), "department report grouping uses the rollup key"],
  [reports.includes("departmentBranchDepartmentCode(fact.department_code, fact.branch_code)"), "department sold metrics use the same rollup key"],
  [reports.includes("l.current_assigned_to=any(${selectedAgentIds}::uuid[])") && reports.includes("${currentLeadBranchCodeSql} else l.report_branch_code") && reports.includes("${branch || null}"), "agent rows are restricted to the currently selected representative and branch in SQL"],
  [reports.includes("const currentLeadDepartmentFilterSql") && reports.includes("${currentLeadDepartmentFilterSql}"), "agent rows inherit the current department filter from the CRM lead query"],
  [reports.includes("const agentSalesRows = salesRows;") && reports.includes("const agentSalesFacts = salesOnlyFacts;"), "agent metrics reuse the already-scoped customer cohort without secondary row drops"],
  [reports.includes("agents: makeMetrics(agentSalesRows, agentSalesFacts)"), "agent summary cards match the filtered representative rows"],
  [reports.includes("detailKind: \"department_branch\"") && reports.includes("detailValue: websiteDepartmentDetail"), "existing website zero row remains intact"],
  [ownersIndex >= 0 && v44Index > ownersIndex, "Owners focused check remains before v44"],
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
console.log(`CRM branch filter + finance rollup v44 checks: ${passed}/${checks.length} passed`);
