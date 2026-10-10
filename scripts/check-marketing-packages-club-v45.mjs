import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const schema = read("server/_marketing-schema.ts");
const marketingApi = read("server/marketing/index.ts");
const packagesPage = read("src/marketing/pages/PackagesPage.tsx");
const ownersApi = read("server/owners-public.ts");
const ownersPortal = read("src/owners/OwnersPortalPage.tsx");
const styles = read("src/styles.css");
const packageJson = JSON.parse(read("package.json"));

const checks = [];
function check(label, condition) {
  const passed = Boolean(condition);
  checks.push([label, passed]);
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
}

check("release baseline version remains 1.19.16", packageJson.version === "1.19.16");
check("package schema stores insurance description", schema.includes("insurance_description text") && schema.includes("add column if not exists insurance_description text"));
check("package form models insurance description", packagesPage.includes("insuranceDescription: string") && packagesPage.includes("وصف التأمين"));
check("insurance description field only renders when insurance is selected", packagesPage.includes("form.insurance ? <label className=\"marketing-insurance-description\""));
check("unchecking insurance clears its description", packagesPage.includes('insuranceDescription: event.target.checked ? form.insuranceDescription : ""'));
check("package save persists insurance description", marketingApi.includes("insurance_description=${insuranceDescription||null}") && marketingApi.includes("insurance_description,issuance_fees"));
check("marketing package card displays saved insurance description", packagesPage.includes("row.insurance_description ? <small>{row.insurance_description}</small>"));
check("marketing PDF includes insurance description", packagesPage.includes("row.insurance_description ? ` — ${row.insurance_description}`"));
check("owners package catalog comes from active Marketing packages", ownersApi.includes("from marketing.packages p") && ownersApi.includes("where p.is_active=true"));
check("owners package catalog returns category and insurance detail", ownersApi.includes("packageCategories:") && ownersApi.includes("insuranceDescription: clean(row.insurance_description)"));
check("membership page has a dedicated packages tab", ownersPortal.includes('setPortalTab(\"packages\")') && ownersPortal.includes("> الباقات</button>"));
check("membership packages are filtered by selected category", ownersPortal.includes("item.categoryId === activePackageCategoryId") && ownersPortal.includes("اختر التصنيف لعرض الباقات المتاحة داخله"));
check("membership package detail uses the agreed sections", ownersPortal.includes("الإجراءات") && ownersPortal.includes("العناية بالسيارة") && ownersPortal.includes("التوصيل"));
check("membership package insurance shows its custom description", ownersPortal.includes("item.insuranceDescription ? <small>{item.insuranceDescription}</small>"));
check("package catalog is responsive and not a 20-card flat dump", styles.includes(".owners-portal-tabs") && styles.includes(".owners-package-grid") && ownersPortal.includes("visiblePackages.map"));
check("no release-specific patch or diff file was added", !fs.readdirSync(root).some((name) => /\.(patch|diff)$/i.test(name)));

const passed = checks.filter(([, ok]) => ok).length;
console.log(`Marketing packages + MZJ Club v45 checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
