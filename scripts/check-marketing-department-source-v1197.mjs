import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const expect = (label, condition) => checks.push([label, Boolean(condition)]);
const contains = (file, ...tokens) => {
  const source = read(file);
  return tokens.every((token) => source.includes(token));
};

expect("Access schema stays on the existing deployed version", contains(
  "server/_access-control-schema.ts",
  "ACCESS_CONTROL_SCHEMA_VERSION = 1192",
  "values(1,1192,now())",
));
expect("Role seed has matching target columns and values", contains(
  "server/_access-control-schema.ts",
  "insert into core.roles(code,name,description_ar,is_system) values",
));
expect("No runtime role-id migration was added to access bootstrap", !read("server/_access-control-schema.ts").includes("legacy.code='marketing_executive'"));
expect("Marketing departments have one stable central department", contains(
  "server/_marketing-schema.ts",
  "add column if not exists core_department_id uuid",
  "marketing_departments_core_department_uq",
));
expect("Marketing Settings owns department membership", contains(
  "server/_marketing-schema.ts",
  "department_membership_source_v1197",
  "join marketing.department_users du",
  "delete from core.user_system_departments usd",
));
expect("Campaign step reads department users from allowed departments", contains(
  "server/marketing/index.ts",
  "left join core.user_system_departments usd",
  "usd.department_id=d.core_department_id and usd.system_code='marketing'",
));
expect("Department settings lists all active platform users", contains(
  "server/marketing/index.ts",
  "const [users, allUsers, departments",
  "coalesce(u.disabled_reason,'') not like 'ACCOUNT_DELETED:%'",
  "return { ok: true, users, allUsers, departments",
) && contains(
  "src/marketing/pages/DepartmentsPage.tsx",
  "meta?.allUsers || meta?.users || []",
));
expect("Saving department exact-syncs marketing and allowed memberships", contains(
  "server/marketing/index.ts",
  "delete from marketing.department_users where department_id",
  "insert into marketing.department_users(department_id,user_id)",
  "delete from core.user_system_departments",
  "insert into core.user_system_departments(user_id,system_code,department_id,is_primary)",
));
expect("Central user save preserves marketing membership using database field names", contains(
  "server/access-control.ts",
  "clean(item.system_code) === \"marketing\"",
  "previousMarketingSystem?.department_ids",
  "previousMarketingSystem?.primary_department_id",
));
expect("Marketing allowed departments are read-only in central users", contains(
  "src/access-control/UsersPermissionsPanel.tsx",
  "disabled={!canManagePermissions || systemTab === \"marketing\"}",
));
expect("Marketing departments are edited only from Marketing Settings", contains(
  "server/access-control.ts",
  "تتم إضافة وتعديل أقسام التسويق من تبويب إعدادات التسويق",
) && contains(
  "src/access-control/UsersPermissionsPanel.tsx",
  "filter((item) => item.system_code !== \"marketing\")",
));
expect("Duplicate role templates are grouped without a database migration", contains(
  "src/access-control/UsersPermissionsPanel.tsx",
  "groupRolesByDisplayName",
  "roleGroups.map((group)",
  "group.permissionCodes.length",
));
expect("Access endpoint initializes only the marketing bridge", contains(
  "server/access-control.ts",
  "await ensureMarketingSchema();",
) && !read("server/access-control.ts").includes("ensureOperationsSchema"));
expect("Legacy aggregate updates are limited to marketing departments", contains(
  "server/marketing/index.ts",
  "delete from core.user_departments ud",
  "d.system_code='marketing'",
  "where usd.system_code='marketing'",
));

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) failed += 1;
}
console.log(`\nMarketing department source checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
