import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const schema = read("server/_marketing-schema.ts");
const migration = read("database/migrations/20260724_marketing_native_clean_rebuild.sql");
const api = read("server/marketing/index.ts");
const packageJson = JSON.parse(read("package.json"));

const checks = [];
function check(label, condition) {
  const passed = Boolean(condition);
  checks.push([label, passed]);
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
}

const categoryCreatedBy = "alter table marketing.package_categories add column if not exists created_by uuid references core.users(id)";
const salesTypeCreatedBy = "alter table marketing.package_sales_types add column if not exists created_by uuid references core.users(id)";

check("release baseline version remains 1.19.16", packageJson.version === "1.19.16");
check("runtime schema upgrades legacy package categories with created_by", schema.includes(categoryCreatedBy));
check("runtime schema upgrades legacy package sales types with created_by", schema.includes(salesTypeCreatedBy));
check("SQL migration upgrades legacy package categories with created_by", migration.includes(categoryCreatedBy));
check("SQL migration upgrades legacy package sales types with created_by", migration.includes(salesTypeCreatedBy));
check("legacy category lookup fields are idempotently upgraded", ["is_active", "sort_order", "created_at", "updated_at"].every((field) => schema.includes(`alter table marketing.package_categories add column if not exists ${field}`)));
check("legacy sales type lookup fields are idempotently upgraded", ["is_active", "sort_order", "created_at", "updated_at"].every((field) => schema.includes(`alter table marketing.package_sales_types add column if not exists ${field}`)));
check("package settings API still records creator for new categories and sales types", api.includes("insert into ${config.table}(name,sort_order,created_by)") && api.includes("[name,sortOrder,user.id]"));
check("no release-specific patch or diff file was added", !fs.readdirSync(root).some((name) => /\.(patch|diff)$/i.test(name)));

const passed = checks.filter(([, ok]) => ok).length;
console.log(`Marketing package lookup legacy schema v46 checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
