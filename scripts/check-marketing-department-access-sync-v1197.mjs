import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
const expect = (label, condition) => checks.push([label, Boolean(condition)]);
const contains = (file, ...tokens) => {
  const source = read(file);
  return tokens.every((token) => source.includes(token));
};

expect("Marketing departments have a stable central department link", contains(
  "server/_marketing-schema.ts",
  "add column if not exists core_department_id",
  "'marketing_'||replace(md.id::text,'-','')",
  "marketing_departments_core_department_uq",
));
expect("Marketing Settings is the membership source of truth", contains(
  "server/_marketing-schema.ts",
  "department_membership_source_v1197",
  "join marketing.department_users du",
  "delete from core.user_system_departments usd",
));
expect("Legacy allowed-department assignments are preserved once", contains(
  "server/_marketing-schema.ts",
  "marketing.integration_state",
  "lower(trim(legacy.name))=lower(trim(md.name))",
  "on conflict(department_id,user_id) do nothing",
));
expect("Old central marketing departments are deactivated", contains(
  "server/_marketing-schema.ts",
  "update core.departments cd",
  "not exists (\n    select 1 from marketing.departments md",
));
expect("Department settings load all active system users", contains(
  "server/marketing/index.ts",
  "const [users, allUsers, departments",
  "coalesce(u.disabled_reason,'') not like 'ACCOUNT_DELETED:%'",
  "return { ok: true, users, allUsers, departments",
));
expect("Campaign and agenda department users come from allowed departments", contains(
  "server/marketing/index.ts",
  "left join core.user_system_departments usd",
  "usd.department_id=d.core_department_id and usd.system_code='marketing'",
));
expect("Saving a marketing department exact-syncs both membership stores", contains(
  "server/marketing/index.ts",
  "delete from marketing.department_users where department_id",
  "insert into marketing.department_users(department_id,user_id)",
  "delete from core.user_system_departments",
  "insert into core.user_system_departments(user_id,system_code,department_id,is_primary)",
));
expect("Department user selector uses every active system user", contains(
  "src/marketing/pages/DepartmentsPage.tsx",
  "meta?.allUsers || meta?.users || []",
  "user.email ? ` — ${user.email}`",
));
expect("Marketing allowed departments are read-only in central user settings", contains(
  "src/access-control/UsersPermissionsPanel.tsx",
  "disabled={!canManagePermissions || systemTab === \"marketing\"}",
));
expect("Backend ignores stale central edits to marketing membership", contains(
  "server/access-control.ts",
  "const previousMarketingSystem",
  "departmentIds: creating ? [] : array(previousMarketingSystem?.departmentIds)",
));
expect("Marketing departments cannot be separately created in organization settings", contains(
  "server/access-control.ts",
  "تتم إضافة وتعديل أقسام التسويق من تبويب إعدادات التسويق",
) && contains(
  "src/access-control/UsersPermissionsPanel.tsx",
  "filter((item) => item.system_code !== \"marketing\")",
));
expect("Duplicate visible role templates are grouped", contains(
  "src/access-control/UsersPermissionsPanel.tsx",
  "groupRolesByDisplayName",
  "roleGroups.map((group)",
  "group.permissionCodes.length",
));
expect("Legacy duplicate marketing role is consolidated", contains(
  "server/_access-control-schema.ts",
  "legacy.code='marketing_executive'",
  "canonical.code='marketing_user'",
  "set is_active=false",
));
expect("Access schema migration version was increased", contains(
  "server/_access-control-schema.ts",
  "ACCESS_CONTROL_SCHEMA_VERSION = 119702",
  "values(1,119702,now())",
));
expect("Access bootstrap ensures the marketing department bridge", contains(
  "server/access-control.ts",
  "await ensureOperationsSchema();",
  "await ensureMarketingSchema();",
));

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) failed += 1;
}
console.log(`\nMarketing department/access sync checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
