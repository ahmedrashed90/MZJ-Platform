import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const read = (f) => fs.readFileSync(f, 'utf8');
const api = read('server/attendance.ts');
const attendance = read('server/_attendance.ts');
const login = read('server/auth/login.ts');
const screen = read('src/attendance/AttendancePage.tsx');
const auth = read('server/_auth.ts');
let passed = 0;
function check(label, callback) { callback(); passed++; console.log('PASS:', label); }
check('Saving permission updates permission record only, not punch timestamps', () => {
  const body = api.slice(api.indexOf('async function authorizeEarlyDeparture'), api.indexOf('async function deleteEarlyDeparturePermission'));
  assert.match(body, /insert into core\.attendance_early_departure_permissions/);
  assert.doesNotMatch(body, /update core\.attendance_records|set check_out=|set check_in=/);
});
check('Deleting permission does not modify original punch records', () => {
  const body = api.slice(api.indexOf('async function deleteEarlyDeparturePermission'), api.indexOf('async function selfAttendanceStateForSession'));
  assert.match(body, /delete from core\.attendance_early_departure_permissions/);
  assert.doesNotMatch(body, /update core\.attendance_records/);
});
check('Selected permission interval is still used in daily credit without overlap', () => {
  assert.match(api, /permission\.from_at/);
  assert.match(api, /permission\.to_at/);
  assert.match(api, /const overlap = Math\.max/);
});
check('Permission details can be opened without changing records', () => {
  assert.match(screen, /onView\(permission, row\)/);
  assert.match(screen, /role="dialog"/);
  assert.match(screen, /viewedPermission\.permission\.reason/);
  assert.match(screen, /viewedPermission\.permission\.fromAt/);
  assert.match(screen, /viewedPermission\.permission\.toAt/);
});
check('Verified users are blocked outside shifts before challenge and after verification', () => {
  assert.match(login, /await requireVerifiedDeviceWorkPeriod\(user\.id\)/);
  assert.match(login, /await requireVerifiedDeviceWorkPeriod\(userId\)/);
  assert.match(attendance, /export async function requireVerifiedDeviceWorkPeriod/);
});
check('Device exemption bypasses shift restriction, required policy is checked on sessions', () => {
  assert.match(attendance, /if \(!device\.verification_required\) return true/);
  assert.match(attendance, /if \(!activePeriod\) return false/);
  assert.match(auth, /isAttendanceSessionAllowed\(session\.user_id, session\.verified_device_id\)/);
});
check('Both primary and secondary devices require an active shift, only primary requires punch', () => {
  const active = attendance.indexOf('if (!activePeriod) return false;');
  const secondary = attendance.indexOf('if (device.is_primary === false) return true;');
  const record = attendance.indexOf('from core.attendance_records', secondary);
  assert.ok(active > 0 && secondary > active && record > secondary);
  assert.match(login, /forceEnforcement: true/);
});
check('No changes to nonattendance modules in this regression test', () => {
  assert.match(login, /createDeviceLoginChallenge/);
  assert.match(auth, /tokenHash\(token\)/);
});
for (const path of ['server/attendance.ts','server/_attendance.ts','server/auth/login.ts','src/attendance/AttendancePage.tsx']) {
  check(`${path} parses as TypeScript`, () => {
    const result = ts.transpileModule(read(path), { fileName: path, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
    const errors = (result.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, {getCanonicalFileName:x=>x,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));
  });
}
console.log(`Attendance permission/access regression: ${passed}/${passed} passed`);

// Exercise the actual session-gate function with mocked database responses.
// The mock uses only the query's identity and never touches production data.
const sessionFunction = attendance.match(/export async function isAttendanceSessionAllowed\([^]*?\n}\n/);
assert.ok(sessionFunction);
const executable = ts.transpileModule(`${sessionFunction[0].replace('export async function','async function')}\nexports.allowed = isAttendanceSessionAllowed;`, {
  fileName: 'session-check.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const vm = await import('node:vm');
async function evaluateGate({ required, status, primary, period, punch, deviceId = 'approved-id' }) {
  const context = {
    exports: {},
    ensureAttendanceSchema: async () => {},
    getActiveAttendancePeriod: async () => period ? { period_id: 'period', work_date: '2026-10-31' } : null,
    getSql: () => async (strings) => {
      const query = strings.join('?');
      if (query.includes('core.user_device_policies')) return [{ verification_required: required, status, is_primary: primary }];
      if (query.includes('core.attendance_records')) return punch ? [{ check_in: '2026-10-31T09:00:00Z', check_out: null, checkout_source: null }] : [];
      throw new Error('Unexpected query');
    },
  };
  vm.runInNewContext(executable, context);
  return context.exports.allowed('user-id', deviceId);
}
async function checkAsync(label, callback) { await callback(); passed++; console.log('PASS:', label); }
await checkAsync('Exempt user may access outside shift', async () => assert.equal(await evaluateGate({ required:false, period:false }), true));
await checkAsync('Verified primary cannot access outside shift', async () => assert.equal(await evaluateGate({ required:true, status:'approved', primary:true, period:false }), false));
await checkAsync('Verified secondary cannot access outside shift', async () => assert.equal(await evaluateGate({ required:true, status:'approved', primary:false, period:false }), false));
await checkAsync('Verified secondary can access during shift', async () => assert.equal(await evaluateGate({ required:true, status:'approved', primary:false, period:true }), true));
await checkAsync('Verified primary without attendance is denied during shift', async () => assert.equal(await evaluateGate({ required:true, status:'approved', primary:true, period:true, punch:false }), false));
await checkAsync('Verified primary with attendance is allowed during shift', async () => assert.equal(await evaluateGate({ required:true, status:'approved', primary:true, period:true, punch:true }), true));
await checkAsync('Revoked device cannot access during shift', async () => assert.equal(await evaluateGate({ required:true, status:'revoked', primary:true, period:true, punch:true }), false));
await checkAsync('Required user without verified device cannot access', async () => assert.equal(await evaluateGate({ required:true, status:null, primary:null, period:true, punch:true, deviceId:'' }), false));
console.log(`Attendance permission/access full regression: ${passed}/${passed} passed`);
