import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];
const checks = [];
function check(name, condition) {
  checks.push({ name, condition: Boolean(condition) });
  if (!condition) failures.push(name);
}

const schema = read("server/_access-control-schema.ts");
const permissions = read("server/_permissions.ts");
const accessApi = read("server/access-control.ts");
const settings = read("src/pages/settings/UsersPermissionsSection.tsx");
const app = read("src/App.tsx");
const sidebar = read("src/components/Sidebar.tsx");
const usersApi = read("server/users.ts");
const crmUtils = read("server/_crm-utils.ts");
const dashboardData = read("server/_dashboard-data.ts");
const dashboardApi = read("server/dashboard.ts");
const dashboardPage = read("src/pages/DashboardPage.tsx");
const metaApi = read("server/meta.ts");

for (const key of [
  "settings.users.view",
  "settings.users.create",
  "settings.users.update",
  "settings.users.disable",
  "settings.roles.manage",
  "settings.permissions.manage",
  "settings.audit.view",
  "settings.security.view",
]) check(`permission key ${key}`, schema.includes(`\"${key}\"`));

for (const label of [
  "المستخدمون",
  "الأدوار وقوالب الصلاحيات",
  "الفروع والأقسام",
  "دليل الصلاحيات",
  "سجل تعديلات الصلاحيات",
  "سجل النشاط الأمني",
]) check(`central tab ${label}`, settings.includes(label));

for (const system of ["operations", "tracking", "marketing", "crm"])
  check(`per-user tab ${system}`, settings.includes(`\"${system}\"`));

check("disabled system stored without deleting permissions", accessApi.includes("on conflict (user_id, system_code) do update") && !accessApi.includes("delete from core.user_systems"));
check("explicit override order removes denies", permissions.includes("for (const code of denied) effective.delete(code)"));
check("disabled systems filter inherited permissions", permissions.includes("permissionEnabled(row.system_code)"));
check("enabled system toggle grants system access", permissions.includes("effective.add(`system.${row.system_code}.access`)"));
check("system grant escalation is checked", accessApi.includes("enabledSystemAccessCodes"));
check("higher-privileged target cannot be downgraded by lower actor", accessApi.includes("currentGrantCodes"));
check("role removal escalation is checked", accessApi.includes("oldRows.map((row) => row.code)"));
check("permission version invalidation", permissions.includes("permission_version=permission_version+1") || accessApi.includes("bumpPermissionVersion"));
check("legacy CRM admin route redirects", app.includes('path="admin" element={<Navigate to="/settings?section=crm"'));
check("legacy activity route redirects", app.includes('path="/activity" element={<Navigate to="/settings?section=users&tab=security"'));
check("settings route requires explicit permission", app.includes("<AnyPermissionRoute permissions={settingsPermissions}>") && sidebar.includes("settings.permissions.manage"));
check("user API uses explicit permissions", usersApi.includes("settings.users.create") && usersApi.includes("settings.users.update") && usersApi.includes("settings.users.disable"));
check("new user role escalation is blocked", usersApi.includes("assertGrantablePermissions(currentUser"));
check("no CRM manager role authorization helper", !crmUtils.includes("isCrmManager"));
check("no direct role admin authorization in access API", !accessApi.includes('roleCodes.includes("admin")'));
check("central schema migration exists", fs.existsSync(path.join(root, "database/migrations/20260718_central_access_control.sql")));
check("central seed exists", fs.existsSync(path.join(root, "database/seed-central-access-control.sql")));
check("unified dashboard receives the authenticated user", dashboardApi.includes("getDashboardData(user)"));
check("unified dashboard queries are permission gated", dashboardData.includes('hasPermission(user, \"system.crm.access\")') && dashboardData.includes("canReadAllSystemData"));
check("unified CRM dashboard SQL applies user scope", dashboardData.includes("const scope = userScope(user)") && dashboardData.includes("scope.departmentCodes"));
check("dashboard UI hides unauthorized system sections", dashboardPage.includes("canViewCrm") && dashboardPage.includes("canViewOperations") && dashboardPage.includes("hasDashboardSection"));
check("metadata API requires explicit settings permission", metaApi.includes("requireAnyPermission") && metaApi.includes("settings.users.view"));

const endpointExpectations = {
  "server/crm/dashboard.ts": ["crm.dashboard.view"],
  "server/crm/leads.ts": ["crm.database.view", "crm.customer.create", "crm.customer.update", "crm.customer.delete"],
  "server/crm/manual-leads.ts": ["crm.manual_leads.view", "crm.manual_lead.create", "crm.manual_lead.approve_duplicate", "crm.manual_lead.delete"],
  "server/crm/conversations.ts": ["crm.inbox.view", "crm.conversation.view", "crm.conversation.send_text"],
  "server/crm/media.ts": ["crm.conversation.send_media", "crm.conversation.download_attachment"],
  "server/crm/reports.ts": ["crm.reports.view"],
  "server/crm/kpi.ts": ["crm.kpi.view", "crm.kpi.manage"],
  "server/crm/transfer.ts": ["crm.customer.transfer"],
  "server/crm/settings.ts": ["crm.settings.view", "crm.settings.manage"],
  "server/crm/inbox-agent.ts": ["crm.inbox_agent.view", "crm.inbox_agent.manage"],
  "server/crm/history.ts": ["crm.finance_history.view"],
  "server/crm/ownership.ts": ["crm.ownership.view"],
};
for (const [file, keys] of Object.entries(endpointExpectations)) {
  const text = read(file);
  for (const key of keys) check(`${file} protects ${key}`, text.includes(key));
}

for (const item of checks) console.log(`${item.condition ? "PASS" : "FAIL"}: ${item.name}`);
if (failures.length) {
  console.error(`\nCentral access-control validation failed (${failures.length}).`);
  process.exit(1);
}
console.log(`\nCentral access-control validation passed (${checks.length} checks).`);
