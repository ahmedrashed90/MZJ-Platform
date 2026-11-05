import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ownersApi = read("server/owners-public.ts");
const portal = read("src/owners/OwnersPortalPage.tsx");
const styles = read("src/styles.css");
const packageJson = JSON.parse(read("package.json"));

const checks = [];
function check(label, condition) {
  const passed = Boolean(condition);
  checks.push([label, passed]);
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
}

check("release baseline version remains 1.19.16", packageJson.version === "1.19.16");
check("public package catalog loads active sales types", ownersApi.includes("from marketing.package_sales_types where is_active=true"));
check("public package catalog exposes sales type lookup list", ownersApi.includes("packageSalesTypes: salesTypes.map"));
check("public package rows expose sales type id", ownersApi.includes("p.sales_type_id::text") && ownersApi.includes('salesTypeId: row.sales_type_id || ""'));
check("membership page stores selected package sales type", portal.includes('const [packageSalesTypeId, setPackageSalesTypeId] = useState("")'));
check("membership only shows sales types that have active packages", portal.includes("salesTypeIdsWithPackages") && portal.includes("visiblePackageSalesTypes"));
check("membership categories are reduced to the selected sales type", portal.includes("categoryIdsForSalesType") && portal.includes("visiblePackageCategories"));
check("membership packages are filtered by both sales type and category", portal.includes("item.salesTypeId === activePackageSalesTypeId") && portal.includes("item.categoryId === activePackageCategoryId"));
check("changing cash/installment selection resets the category", portal.includes('setPackageSalesTypeId(item.id); setPackageCategoryId("")'));
check("membership page renders sales-type choices before category selector", portal.includes('className="owners-package-sales-filter"') && portal.includes("نوع المبيعات") && portal.indexOf('className="owners-package-sales-filter"') < portal.indexOf('className="owners-package-category-filter"'));
check("membership keeps existing category selector after sales type", portal.includes('className="owners-package-category-filter"') && portal.includes("visiblePackageCategories.map"));
check("membership does not add an all-packages sales type that mixes cash and installments", !portal.includes('>الكل</button>') && !portal.includes('value="all"'));
check("sales-type selector has responsive visual styling", styles.includes(".owners-package-sales-filter") && styles.includes(".owners-package-category-filter") && styles.includes(".owners-package-sales-filter button.active"));
check("no release-specific patch or diff file was added", !fs.readdirSync(root).some((name) => /\.(patch|diff)$/i.test(name)));

const passed = checks.filter(([, ok]) => ok).length;
console.log(`MZJ Club package sales-type filter v47 checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
