import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
function expect(label, condition) { checks.push([label, Boolean(condition)]); }
function contains(file, ...tokens) { const text = read(file); return tokens.every((token) => text.includes(token)); }

const ui = read("src/access-control/UsersPermissionsPanel.tsx");
const api = read("server/access-control.ts");
const runtimeSchema = read("server/_access-control-schema.ts");
const packageJson = JSON.parse(read("package.json"));

expect("Package version is 1.19.5", packageJson.version === "1.19.5");
expect("General roles are grouped by normalized display name", ui.includes("groupRolesByDisplayName") && ui.includes("normalizedRoleName") && ui.includes("roleGroups.map"));
expect("Finance manager keeps its distinct central label", contains("server/_operations-schema.ts", "('finance_manager','مدير المالية',true)"));
expect("Duplicate role labels use one canonical choice without rewriting existing assignments", ui.includes("canonicalRoleIdById") && ui.includes("normalizeSelectedRoleIds") && ui.includes("group.roleIds.includes(currentSystem.roleId) ? currentSystem.roleId : group.canonical.id") && ui.includes("roleIds: form.roleIds, systems: form.systems"));
expect("User editor exposes a protected delete action", contains("src/access-control/UsersPermissionsPanel.tsx", "settings.users.delete", "openDeleteDialog", "حذف الحساب"));
expect("Delete confirmation requires a reason and exact user name", contains("src/access-control/UsersPermissionsPanel.tsx", "deleteReason.trim()", "deleteConfirmation.trim()", "اكتب اسم المستخدم للتأكيد"));
expect("Backend has a dedicated delete permission and action", api.includes('settings.users.delete') && api.includes("action==='delete_user'") && api.includes("async function deleteUser"));
expect("Backend prevents deleting the current user", api.includes("لا يمكن حذف الحساب الحالي من نفس الجلسة"));
expect("Backend protects the last active superadmin", api.includes("لا يمكن حذف آخر حساب مدير نظام فعال") && api.includes("platform.superadmin"));
expect("Deleted users are hidden from list and detail", api.includes("where u.deleted_at is null") && api.includes("and deleted_at is null"));
expect("Delete revokes sessions and access assignments", contains("server/access-control.ts", "delete from core.sessions", "delete from core.user_roles", "delete from core.user_systems", "delete from core.user_permission_overrides"));
expect("Delete preserves history while clearing login identifiers", contains("server/access-control.ts", "email=null", "password_hash=null", "deleted_at=now()", "user_deleted"));
expect("Login and session loading reject deleted users", contains("server/auth/login.ts", "u.deleted_at is null") && contains("server/_auth.ts", "u.deleted_at is null"));
expect("Runtime schema is bumped and checks deletion columns", runtimeSchema.includes("ACCESS_CONTROL_SCHEMA_VERSION = 1195") && runtimeSchema.includes("column_name='deleted_at'") && runtimeSchema.includes("column_name='deleted_reason'"));
expect("Delete permission exists in all catalogs", ["shared/access-control.ts", "server/_access-control-schema.ts", "database/migrations/20260724_central_access_control_v1190.sql", "database/seeds/20260724_central_access_catalog.sql", "database/migrations/20260724_central_access_user_delete_v1195.sql"].every((file) => read(file).includes("settings.users.delete")));
expect("Admin roles receive delete permission", contains("server/_access-control-schema.ts", "p.code='settings.users.delete'", "r.code in ('admin','system_admin')") && contains("database/migrations/20260724_central_access_user_delete_v1195.sql", "r.code in ('admin','system_admin')"));
expect("Security log includes successful user deletion", api.includes("'user_deleted') order by"));

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) failed += 1;
}
console.log(`\nCentral users v1.19.5 checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
