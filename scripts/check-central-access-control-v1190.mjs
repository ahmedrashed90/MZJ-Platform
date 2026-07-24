import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
function expect(label, condition) { checks.push([label, Boolean(condition)]); }
function contains(file, ...tokens) { const text = read(file); return tokens.every((token) => text.includes(token)); }
function excludes(file, ...tokens) { const text = read(file); return tokens.every((token) => !text.includes(token)); }

const catalog = read("shared/access-control.ts");
const permissionCodes = [...catalog.matchAll(/\bp\("([^"]+)"/g)].map((match) => match[1]);
const pageKeys = [...read("shared/access-control.ts").matchAll(/\{ system: "([^"]+)", code: "([^"]+)"/g)].map((match) => `${match[1]}.${match[2]}`);
const unique = (items) => new Set(items).size === items.length;

expect("Package version is 1.19.1", JSON.parse(read("package.json")).version === "1.19.1");
expect("Four systems exist in central catalog", ["crm", "marketing", "operations", "tracking"].every((code) => catalog.includes(`code: "${code}"`)));
expect("Permission catalog is large enough for all systems", permissionCodes.length >= 180);
expect("Permission codes are unique", unique(permissionCodes));
expect("Page catalog entries are unique", unique(pageKeys));
expect("System access permissions exist", ["system.crm.access", "system.marketing.access", "system.operations.access", "system.tracking.access"].every((code) => permissionCodes.includes(code)));
expect("Central settings permissions exist", ["settings.users.view", "settings.roles.manage", "settings.permissions.manage", "settings.branches.manage", "settings.departments.manage", "settings.audit.view", "settings.security.view"].every((code) => permissionCodes.includes(code)));
expect("Legacy per-system settings permissions are absent", !["crm.settings.view", "crm.settings.manage", "marketing.settings.view", "marketing.settings.manage", "operations.settings.view", "operations.settings.manage", "tracking.settings.view", "tracking.settings.manage"].some((code) => permissionCodes.includes(code)));
expect("CRM data review has separate view and execute permissions", ["crm.data_review.view", "crm.data_review.execute"].every((code) => permissionCodes.includes(code)));
expect("CRM routing and automation are separate permissions", ["crm.routing.manage", "crm.automation.manage"].every((code) => permissionCodes.includes(code)));
expect("All ten tracking stages generate complete rollback and SMS permissions", contains("shared/access-control.ts", "Array.from({ length: 10 }", "tracking.stage.${stage}.complete", "tracking.stage.${stage}.rollback", "tracking.stage.${stage}.sms"));
expect("Marketing workflow permissions exist", ["marketing.structure.approve", "marketing.task_template.upload", "marketing.task_template.approve", "marketing.assignment_action.execute", "marketing.assignment_actions.approve", "marketing.task.final_file.upload", "marketing.publish.now"].every((code) => permissionCodes.includes(code)));
expect("Operations workflow permissions exist", ["operations.request.receive_order", "operations.request.send_car", "operations.request.receive_car", "operations.request.finish_order", "operations.request.rollback", "operations.request.skip"].every((code) => permissionCodes.includes(code)));

expect("Central schema creates user systems", contains("server/_access-control-schema.ts", "create table if not exists core.user_systems", "core.user_system_branches", "core.user_system_departments"));
expect("Central schema creates user overrides", contains("server/_access-control-schema.ts", "core.user_permission_overrides", "check(effect in ('allow','deny'))"));
expect("Central schema creates permission change log", contains("server/_access-control-schema.ts", "core.permission_change_log"));
expect("Central migration preserves and increments permission versions", contains("database/migrations/20260724_central_access_control_v1190.sql", "permission_version", "core.sessions"));
expect("Central migration deactivates duplicated settings pages", contains("database/migrations/20260724_central_access_control_v1190.sql", "code='settings'", "system_code in ('crm','marketing','operations','tracking')"));
expect("Rollback migration exists", fs.existsSync("database/migrations/20260724_central_access_control_v1190_rollback.sql"));
expect("Runtime schema contains every catalog permission", permissionCodes.every((code) => read("server/_access-control-schema.ts").includes(`'${code}'`)));
expect("SQL migration contains every catalog permission", permissionCodes.every((code) => read("database/migrations/20260724_central_access_control_v1190.sql").includes(`'${code}'`)));

expect("Session loads effective central access", contains("server/_auth.ts", "getEffectiveAccess", "...access"));
expect("Disabled user sessions are rejected", contains("server/_auth.ts", "is_active", "core.sessions"));
expect("Permission version invalidates stale sessions", contains("server/_auth.ts", "s.permission_version=u.permission_version"));
expect("Explicit deny is evaluated before superadmin", contains("shared/access-control.ts", "user.deniedPermissions?.includes(code)", "platform.superadmin"));
expect("Disabled systems block their non-core permissions", contains("shared/access-control.ts", "!user.systemAccess?.[system]?.enabled"));
expect("Backend permission guard logs rejection", contains("server/_access-control.ts", "permission_denied", "result: \"denied\""));
expect("Access control blocks self-edit", contains("server/access-control.ts", "لا يمكن تعديل الحساب الحالي من نفس الجلسة"));
expect("Access control blocks self-role edit", contains("server/access-control.ts", "لا يمكن تعديل دورك الحالي من نفس الجلسة"));
expect("System roles and per-system self roles cannot be edited indirectly", contains("server/access-control.ts", "before?.role?.is_system", "لا يمكن تعديل قالب دور نظامي", "select 1 from core.user_systems where user_id=${actor.id}::uuid and role_id=${id}::uuid"));
expect("Managers cannot grant permissions above their own", contains("server/access-control.ts", "actorCanGrant", "لا يمكنك منح صلاحية أو دور أعلى"));
expect("Role permission templates require permission-management authority", contains("server/access-control.ts", "permissionsChanged", "settings.permissions.manage", "تعديل صلاحيات قالب الدور يحتاج صلاحية إدارة الصلاحيات") && contains("src/access-control/UsersPermissionsPanel.tsx", "disabled={!canManagePermissions}"));
expect("Managers cannot grant scopes above their own", contains("server/access-control.ts", "actorCanGrantScope", "لا يمكنك منح نطاق بيانات أو فروع أو أقسام خارج نطاقك"));
expect("User updates invalidate sessions", contains("server/access-control.ts", "delete from core.sessions where user_id"));
expect("Permission changes are audited", contains("server/access-control.ts", "core.permission_change_log", "logSecurityEvent"));
expect("Passwords are hashed", contains("server/access-control.ts", "crypt(${password},gen_salt('bf'))"));
expect("Password hashes are excluded from snapshots", contains("server/access-control.ts", "to_jsonb(u)-'password_hash'"));

expect("Unified settings contains the only users and permissions UI", contains("src/pages/SettingsPage.tsx", "UsersPermissionsPanel", "المستخدمون والصلاحيات"));
expect("Unified settings separates all four system settings", contains("src/pages/SettingsPage.tsx", "إعدادات CRM", "إعدادات التسويق", "إعدادات العمليات", "إعدادات التتبع"));
expect("Settings sections use specific permissions", contains("src/pages/SettingsPage.tsx", "settings.crm.view", "settings.marketing.view", "settings.operations.view", "settings.tracking.view"));
expect("User editor contains four system tabs", contains("src/access-control/UsersPermissionsPanel.tsx", '"operations", "tracking", "marketing", "crm"'));
expect("User editor supports allow deny and inherit", contains("src/access-control/UsersPermissionsPanel.tsx", 'type OverrideEffect = "inherit" | "allow" | "deny"'));
expect("User editor supports per-system data scope branches and departments", contains("src/access-control/UsersPermissionsPanel.tsx", "dataScope", "branchIds", "departmentIds"));
expect("Role templates include core permissions", contains("src/access-control/UsersPermissionsPanel.tsx", 'const roleSystemOrder: AccessSystemCode[] = ["core", ...systemOrder]'));
expect("User access can be copied from another user", contains("src/access-control/UsersPermissionsPanel.tsx", "copyAccessFromUser", "نسخ صلاحيات مستخدم"));
expect("Individual overrides can be reset to role templates", contains("src/access-control/UsersPermissionsPanel.tsx", "resetToRoleTemplates", "إعادة ضبط لقوالب الأدوار"));
expect("User editor previews final role and override permissions", contains("src/access-control/UsersPermissionsPanel.tsx", "previewPermissions", "inheritedPermissions", "deniedPermissions"));
expect("Primary branch and department are explicit per system", contains("src/access-control/UsersPermissionsPanel.tsx", "primaryBranchId", "primaryDepartmentId", "الفرع الأساسي", "القسم الأساسي") && contains("server/access-control.ts", "primary_branch_id", "primary_department_id"));
expect("Users can be filtered by role system branch and department", contains("src/access-control/UsersPermissionsPanel.tsx", "filterRoleId", "filterSystemCode", "filterBranchId", "filterDepartmentId"));
expect("User list shows last access change and actor", contains("server/access-control.ts", "last_access_change_at", "last_access_changed_by") && contains("src/access-control/UsersPermissionsPanel.tsx", "آخر تعديل"));
expect("Old CRM admin route redirects to central settings", contains("src/App.tsx", 'path="admin" element={<Navigate to="/settings?section=crm" replace />}'));
expect("Old marketing settings route redirects centrally", contains("src/App.tsx", 'path="departments" element={<Navigate to="/settings?section=marketing&tab=departments" replace />}'));

expect("API gateway applies permission requirement before handler", contains("api/index.ts", "resolveApiPermission", "requirePermissionForUser"));
expect("Integrations are protected by gateway secrets", contains("server/integrations/[source].ts", "MZJ_GATEWAY_SECRET", "safeSecretEquals"));
expect("Automation scheduler is protected by a secret", contains("server/internal/automation-job.ts", "AUTOMATION_SCHEDULER_SECRET", "safeSecretEquals"));
expect("ERPNext webhook is protected by a key", contains("server/integrations/erpnext-sales-order.ts", "ERPNEXT_WEBHOOK_KEY", "safeSecretEquals"));

expect("CRM lists are filtered in SQL by scope", contains("server/crm/leads.ts", "scope.includeAssigned", "scope.departmentCodes", "scope.branchCodes"));
expect("CRM data review has exact permission checks", contains("server/crm/data-review.ts", "crm.data_review.execute", "crm.data_review.view"));
expect("CRM data review applies server-side scope", contains("server/crm/data-review.ts", "scope.callCenterOnly", "l.department_code=any(${scope.departmentCodes}"));
expect("CRM data review locks rows before correction", contains("server/crm/data-review.ts", "for update"));
expect("CRM branch mutation is disabled in old settings endpoint", contains("server/crm/settings.ts", "إدارة الفروع نُقلت إلى الإعدادات المركزية"));
expect("CRM no longer renders branch management tab", excludes("src/crm/pages/CrmAdminPage.tsx", '{ key: "branches"', 'tab === "branches"'));
expect("CRM assignment rules require routing permission", contains("server/crm/settings.ts", "crm.routing.manage", "لا توجد صلاحية لإدارة قواعد توزيع العملاء"));
expect("CRM automation requires central and specialized permissions", contains("server/crm/automation-settings.ts", "settings.crm.manage", "crm.automation.manage"));
expect("CRM settings have read-only mode", contains("src/crm/pages/CrmAdminPage.tsx", "readOnly", "صلاحية مشاهدة فقط"));

expect("Tracking public page uses a token", contains("server/tracking/public.ts", "tracking_token"));
expect("Public tracking no longer accepts VIN/order as public identifier", excludes("server/tracking/public.ts", "request.query.vin", "request.query.orderNo", "sales_order_no=${"));
expect("Tracking token is unique and backfilled", contains("server/_tracking-schema.ts", "tracking_token", "unique"));
expect("Tracking stage actions use exact permissions", contains("server/tracking/orders.ts", "tracking.stage.", ".rollback"));
expect("Tracking SMS uses global and per-stage permissions", contains("server/_api-permissions.ts", "tracking.sms.send") && contains("server/tracking/sms.ts", "tracking.stage.${stageNo}.sms"));
expect("Tracking settings use central keys", contains("server/tracking/settings.ts", "settings.tracking.view", "settings.tracking.manage"));

expect("Marketing queries use scope and assignment checks", contains("server/marketing/index.ts", "marketingAccess", "dataScope"));
expect("Marketing actions use exact task permissions", contains("server/marketing/index.ts", "marketing.task_template.upload", "marketing.assignment_action.execute", "marketing.task.final_file.upload"));
expect("Marketing settings use central keys", contains("server/_api-permissions.ts", "settings.marketing.view", "settings.marketing.manage"));
expect("Marketing settings have read-only mode", contains("src/marketing/components/MarketingSettingsPanel.tsx", "readOnly", "settings-readonly-fieldset"));

expect("Operations queries use per-system scope", contains("server/operations/index.ts", 'getSystemAccess(user, "operations")', "dataScope"));
expect("Operations stages have exact permissions", contains("server/_api-permissions.ts", "operations.request.receive_order", "operations.request.send_car", "operations.request.receive_car", "operations.request.finish_order"));
expect("Operations VIN changes use an exact sensitive permission", permissionCodes.includes("operations.vehicle.vin.update") && contains("server/operations/index.ts", "operations.vehicle.vin.update", "لا توجد لديك صلاحية تعديل رقم الهيكل") && contains("src/operations/pages/VehicleManagementPage.tsx", "canEditVin"));
expect("Operations completion requires its exact permission and remains creator-only", contains("server/operations/index.ts", 'nextStatus === "completed"', 'hasPermission(user, "operations.request.finish_order") && row.requested_by === user.id'));
expect("Operations request deletion has no creator or admin bypass", contains("server/operations/index.ts", 'if (!hasPermission(user, "operations.transfer.delete"))') && excludes("server/operations/index.ts", 'r.requested_by !== user.id && !hasPermission(user, "operations.transfer.delete")'));
expect("Operations request cancellation has no creator or admin bypass", contains("server/operations/index.ts", 'if (!hasPermission(user, "operations.transfer.cancel"))') && excludes("server/operations/index.ts", 'r.requested_by !== user.id && !hasPermission(user, "operations.transfer.cancel")'));
expect("Operations API maps delete and cancel to exact permissions", contains("server/_api-permissions.ts", 'delete: "operations.transfer.delete"', 'cancel: "operations.transfer.cancel"'));
expect("Operations settings use central permission", contains("server/_api-permissions.ts", "settings.operations.manage"));

const appFiles = [];
for (const root of ["src", "server", "api", "shared"]) {
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = `${dir}/${entry.name}`; if (entry.isDirectory()) walk(file); else if (/\.tsx?$/.test(entry.name)) appFiles.push(file); } };
  walk(root);
}
const appSource = appFiles.map(read).join("\n");
const hardcodedEmailComparison = /(?:\bemail\b\s*(?:===|==)\s*["'][^"']+@[^"']+["']|["'][^"']+@[^"']+["']\s*(?:===|==)\s*\bemail\b)/i;
expect("No hardcoded admin email comparisons remain in app code", !hardcodedEmailComparison.test(appSource));
expect("No literal company user emails are used as permission conditions", !/@(?:gmail|outlook|hotmail|mzj|mzj-platform)\.[a-z]+/i.test(appSource));
expect("No always-true transfer bypass remains", !/canTransfer\s*=\s*true/.test(appSource));
expect("Operations actions no longer use a platform-admin shortcut", excludes("server/operations/index.ts", "isSystemAdmin("));
expect("No localStorage permission source remains", !/localStorage[^\n]*(?:permission|pagesAccess|allowedTabs)/i.test(appSource));

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) failed += 1;
}
console.log(`\nCentral access control checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
