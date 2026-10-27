import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const dashboard = read('src/pages/DashboardPage.tsx');
const dashboardApi = read('server/dashboard.ts');
const dashboardData = read('server/_dashboard-data.ts');
const operations = read('server/operations/index.ts');
const operationsPage = read('src/operations/pages/SalesOrdersFollowupPage.tsx');
const gatewayPermissions = read('server/_api-permissions.ts');
const approvalModal = read('src/operations/components/SalesFollowupQuickApprovalModal.tsx');
const reports = read('server/crm/reports.ts');
const crmScope = read('server/_crm-utils.ts');
const crmPage = read('src/crm/pages/CrmReportsPage.tsx');
const checks = [];
function verify(label, condition) {
  assert.ok(condition, label);
  checks.push(label);
  console.log(`PASS ${label}`);
}

// Actual evaluation of the month calculation, not a text-presence-only check.
const monthSnippet = dashboard.match(/function dashboardMonthRange\(month: string\) \{[\s\S]*?\n\}/)?.[0];
verify('Calendar month formatter is present', Boolean(monthSnippet));
const monthJs = ts.transpileModule(`${monthSnippet}\nmodule.exports = dashboardMonthRange`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const obj = { exports: {} };
new Function('module', monthJs)(obj);
verify('October month range is full 1-31 inclusive', JSON.stringify(obj.exports('2026-10')) === JSON.stringify({ from: '2026-10-01', to: '2026-10-31' }));
verify('February non-leap and leap years are correct', obj.exports('2027-02').to === '2027-02-28' && obj.exports('2028-02').to === '2028-02-29');
verify('Invalid month is rejected', obj.exports('2026-13') === null);
verify('Dashboard default uses calendar month in Riyadh', dashboard.includes('dashboardMonthRange(riyadhDateKey(new Date()).slice(0, 7))'));
verify('Dashboard has a month picker and custom dates', dashboard.includes('type="month"') && dashboard.includes('type="date"') && dashboard.includes('onChange={(event) => { const range = dashboardMonthRange(event.target.value);'));
verify('Dashboard API fallback uses full month', dashboardApi.includes('`${currentMonth}-01`') && dashboardApi.includes('`${currentMonth}-${String(lastCalendarDay).padStart(2, "0")}`'));
verify('Tracking dashboard count and popup use the same selected range', dashboardData.includes('getTrackingCountSummary(sql, user, { from, to })') && dashboard.includes('archived: false, from: appliedRange.from, to: appliedRange.to'));

// Actual role scope calculation with mocks - manager scope must never be all.
const scopeSnippet = crmScope.match(/export function userScope\(user: SessionUser\): Scope \{[\s\S]*?\n\}/)?.[0];
verify('CRM userScope implementation is present', Boolean(scopeSnippet));
const scopeJs = ts.transpileModule(`${scopeSnippet}\nmodule.exports = userScope`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const scopeModule = { exports: {} };
new Function('module', 'exports', 'getSystemAccess', 'hasPermission', scopeJs)(scopeModule, scopeModule.exports, user => user.access, (user, permission) => user.permissions?.includes(permission));
const userScope = scopeModule.exports;
const manager = userScope({ id: 'test-manager', roleCodes: ['branch_manager'], permissions: [], access: { roleCode: 'branch_manager', dataScope: 'all', branchCodes: ['hall', 'wholesale'], departmentCodes: [] } });
verify('Manager with stale global all-scope is restricted to PRIMARY hall only', manager.branchManager === true && manager.all === false && manager.branchRestricted === true && manager.branchCodes.length === 1 && manager.branchCodes[0] === 'hall');
const admin = userScope({ id: 'test-admin', roleCodes: ['branch_manager'], permissions: ['platform.superadmin'], access: { roleCode: 'admin', dataScope: 'all', branchCodes: ['hall', 'wholesale'], departmentCodes: [] } });
verify('Platform administrator retains unrestricted all-branch scope', admin.branchManager === false && admin.all === true);
verify('CRM sales transaction branch is authoritative for a manager', reports.includes('const transactionAccessBranchSql = scope.branchManager ? transactionBranchCodeSql : transactionCurrentBranchCodeSql') && (reports.match(/\(\$\{transactionAccessBranchSql\}\)=any\(\$\{scope.branchCodes\}::text\[\]\)/g) || []).length === 4);
verify('CRM manager dropdown is constrained to the permitted branch', crmPage.includes('disabled={managerIsBranchRestricted}') && crmPage.includes('const reportBranchValue = managerIsBranchRestricted ? managerBranch : filters.branch'));
verify('CRM API responds with enforced manager branch', reports.includes('branch: scope.branchManager ? scope.branchCodes[0] || "" : branch'));

verify('Operations approval button appears only to platform administrators', operationsPage.includes('const canUseQuickApprovals = isPlatformAdmin(user)') && operationsPage.includes('canUseQuickApprovals ? <button') && operationsPage.includes('<SalesFollowupQuickApprovalModal'));
verify('Gateway checks administrator permission for both quick approval routes', gatewayPermissions.includes('sales_followup_approval_candidates: "platform.superadmin"') && gatewayPermissions.includes('sales_followup_approval_action: "platform.superadmin"'));
verify('Operations candidates GET is permission checked on the server', operations.includes('resource === "sales_followup_approval_candidates"') && operations.includes('requireOperationsPermission(user, "platform.superadmin", response)'));
verify('Operations quick approval POST is permission checked on the server', operations.includes('action === "sales_followup_approval_action"') && operations.includes('return approvalAction(sql, {'));
verify('Quick approval lists all missing approvals, including delivered/historical rows in followup', operations.includes('(stage_6_completed=false or stage_7_completed=false)') && !operations.includes("and operations_status_code='under_delivery'") && !operations.includes('and order_archived=false'))
verify('Delivered sales are documented without starting another delivery', operations.includes('async function recordDeliveredSalesFollowupApproval(') && operations.includes('return recordDeliveredSalesFollowupApproval('));
verify('Quick approval verifies the exact selected linked tracking vehicle', operations.includes('tv.id=${trackingVehicleId}::uuid and v.id=${vehicleId}::uuid') && operations.includes('coalesce(o.is_cancelled,false)=false') && operations.includes('o.sales_followup_completed_at is null'));
verify('Quick approval uses canonical approval history/stage synchronization', operations.includes('return approvalAction(sql, {') && operations.includes('await syncTrackingApprovalStagesForOperationsVehicle(tx, vehicleId'));
verify('Modal sends a specific VIN choice, and supports both approval types', approvalModal.includes('name="sales-followup-approval-vehicle"') && approvalModal.includes('approvalType: type') && approvalModal.includes('approve("financial")') && approvalModal.includes('approve("administrative")'));

const modifiedTs = [
  'src/pages/DashboardPage.tsx', 'src/crm/pages/CrmReportsPage.tsx',
  'src/operations/pages/SalesOrdersFollowupPage.tsx', 'src/operations/components/SalesFollowupQuickApprovalModal.tsx',
  'server/dashboard.ts', 'server/_dashboard-data.ts', 'server/_crm-utils.ts',
  'server/crm/reports.ts', 'server/operations/index.ts', 'server/_api-permissions.ts',
];
for (const filename of modifiedTs) {
  const result = ts.transpileModule(read(filename), {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  });
  const errors = (result.diagnostics || []).filter(error => error.category === ts.DiagnosticCategory.Error);
  verify(`${filename}: no TypeScript/TSX syntax errors`, !errors.length);
}
console.log(`Dashboard, operations and branch scoping regression tests: ${checks.length}/${checks.length} passed`);
