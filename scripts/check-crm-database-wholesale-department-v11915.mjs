import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function versionAtLeast(current, minimum) {
  const a = String(current || "0.0.0").split(".").map((part) => Number(part) || 0);
  const b = String(minimum || "0.0.0").split(".").map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] || 0;
    const right = b[index] || 0;
    if (left !== right) return left > right;
  }
  return true;
}
const packageJson = JSON.parse(read("package.json"));
const drawer = read("src/crm/components/LeadDrawer.tsx");
const crmApi = read("server/crm/leads.ts");
const marketingDatabase = read("src/marketing/pages/MarketingDatabasePage.tsx");

const checks = [];
function check(label, condition) {
  const passed = Boolean(condition);
  checks.push([label, passed]);
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
}

check("release keeps the v1.19.15 database-edit foundation", versionAtLeast(packageJson.version, "1.19.15"));
check("CRM database edit keeps the canonical department selector", drawer.includes('>القسم</span><select value={activeForm.departmentCode}') && drawer.includes("changeDatabaseDepartment"));
check("wholesale is a selectable CRM department", drawer.includes('label: "قسم الجملة"') && drawer.includes('serviceKey: "cash" as ServiceKey'));
check("both wholesale department codes are supported", drawer.includes('code === "wholesale"') && drawer.includes('code === "wholesale_sales"'));
check("the configured wholesale code is resolved from central CRM users", drawer.includes('configuredCodes.has("wholesale")') && drawer.includes('configuredCodes.has("wholesale_sales")'));
check("wholesale now keeps a selectable required branch", drawer.includes('required={isWholesaleDepartmentCode(activeForm.departmentCode)}') && drawer.includes("اختر فرع قسم الجملة") && !/<select[^>]*disabled=\{isWholesaleDepartmentCode\(activeForm\.departmentCode\)\}/.test(drawer));
check("wholesale branch choices use central CRM assignments", drawer.includes("userMatchesDepartment(user, departmentCode)") && drawer.includes("userBranchCodes.has(branch.code)"));
check("wholesale assignment is limited to users in the selected department", drawer.includes("userMatchesDepartment(user, nextDepartmentCode)") && drawer.includes("currentAgentIsValid"));
check("database edit still updates the same customer row", drawer.includes('payload.databaseEdit = true') && drawer.includes('method: "PATCH"') && crmApi.includes('update crm.leads set'));
check("department and service key remain persisted through the canonical CRM endpoint", drawer.includes('addChangedField(payload, "serviceKey"') && drawer.includes('addChangedField(payload, "departmentCode"') && crmApi.includes('department_code=${input.departmentCode}'));
check("marketing budget overview has explicit item and platform types", marketingDatabase.includes("type BudgetOverviewItem") && marketingDatabase.includes("type BudgetOverviewPlatform"));
check("the Vercel implicit-any budget callbacks are explicitly typed", marketingDatabase.includes("(item: BudgetOverviewItem, index: number)") && marketingDatabase.includes("(name: string, nameIndex: number)") && marketingDatabase.includes("(platform: BudgetOverviewPlatform)"));
check("no release-specific database migration or patch was added", !fs.existsSync(path.join(root, "database/migrations/20260808_crm_database_wholesale_department_v11915.sql")) && !fs.existsSync(path.join(root, "database/migrations/20260808_v11915_patch.sql")));

const failed = checks.filter(([, passed]) => !passed);
console.log(`CRM database wholesale department checks: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
