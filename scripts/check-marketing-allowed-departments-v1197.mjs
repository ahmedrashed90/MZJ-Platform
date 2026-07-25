import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const api = read("server/marketing/index.ts");
const schema = read("server/_marketing-schema.ts");
const settings = read("src/marketing/pages/DepartmentsPage.tsx");
const editor = read("src/marketing/components/CreativeEditor.tsx");

const checks = [
  ["campaign users come from centralized department memberships", api.includes("left join core.user_system_departments usd")],
  ["all allowed departments are matched, not only primary", api.includes("usd.department_id=d.core_department_id") && !api.includes("usd.is_primary=true")],
  ["legacy duplicate department ids are migrated", schema.includes("duplicate_links") && schema.includes("core.user_system_departments.is_primary or excluded.is_primary")],
  ["marketing departments have a canonical core id", schema.includes("core_department_id") && schema.includes("marketing_departments_core_department_uidx")],
  ["legacy department users are not the live source", !api.includes("left join marketing.department_users du on du.department_id=d.id")],
  ["marketing settings no longer assigns users", !settings.includes("userIds") && !settings.includes("multiple value={department")],
  ["campaign empty state points to users and permissions", editor.includes("الأقسام المسموحة")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log(`PASS: ${checks.length}/${checks.length} marketing allowed-department checks`);
