import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const core = readFileSync('server/_attendance.ts', 'utf8');
const login = readFileSync('server/auth/login.ts', 'utf8');
const api = readFileSync('server/attendance.ts', 'utf8');
const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');
const loginScreen = readFileSync('src/pages/LoginPage.tsx', 'utf8');
const device = readFileSync('server/_device-agent.ts', 'utf8');

const extract = (source, name, isExported = false) => {
  const prefix = isExported ? 'export async function' : 'async function';
  const start = source.indexOf(`${prefix} ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} must have a function ending`);
  return source.slice(start, end + 3);
};
const transpiled = ts.transpileModule([
  extract(core, 'registerExemptLoginAttendance', true),
  extract(login, 'finishAttendanceLogin'),
  'exports.loginWithAttendance = finishAttendanceLogin;',
].join('\n'), {
  fileName: 'device-exempt-login-test.ts',
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true },
});
const syntaxErrors = transpiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) || [];
assert.equal(syntaxErrors.length, 0, 'Login and attendance helper must parse correctly');

let passed = 0;
async function check(name, callback) {
  await callback();
  passed += 1;
  console.log(`PASS ${name}`);
}

function harness({ required = false, activePeriod = true, existingCheckIn = false, existingCheckOut = false, requestCheckIn = true, primary = null } = {}) {
  const calls = { read: 0, write: 0, gate: 0, requiredAttendance: 0, session: 0, security: 0 };
  const period = activePeriod ? { period_id: 'shift-one', work_date: '2026-11-01' } : null;
  const record = existingCheckIn || existingCheckOut ? { check_in: existingCheckIn ? '2026-11-01T09:00:00Z' : null, check_out: existingCheckOut ? '2026-11-01T12:00:00Z' : null } : null;
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  };
  const context = {
    exports: {},
    AttendanceError: class AttendanceError extends Error {},
    isDeviceVerificationRequired: async () => required,
    getLoginAttendanceState: async () => { calls.read++; return { activePeriod: period, record }; },
    registerAttendanceCheckIn: async (_userId, p) => { assert.equal(p, period); calls.write++; },
    requireVerifiedDeviceWorkPeriod: async () => { calls.gate++; },
    requireAttendanceForLogin: async (_userId, opts) => {
      calls.requiredAttendance++;
      assert.equal(opts.forceEnforcement, true);
      assert.equal(opts.confirmCheckIn, true);
    },
    getSql: () => async (_strings) => [],
    createSession: async () => { calls.session++; },
    loadUserProfile: async () => ({ id: 'employee' }),
    logSecurityEvent: async () => { calls.security++; },
    requestIp: () => '127.0.0.1',
  };
  vm.runInNewContext(transpiled.outputText, context, { timeout: 3000 });
  return {
    calls,
    response,
    login: () => context.exports.loginWithAttendance({}, response, 'employee', requestCheckIn, required ? 'verified-device' : null, primary),
  };
}

await check('Exempt employee login during assigned shift records real check-in and still creates session', async () => {
  const h = harness();
  await h.login();
  assert.deepEqual(h.calls, { read: 1, write: 1, gate: 0, requiredAttendance: 0, session: 1, security: 1 });
  assert.equal(h.response.payload.ok, true);
});
await check('Exempt employee login outside working hours is allowed without false attendance', async () => {
  const h = harness({ activePeriod: false });
  await h.login();
  assert.equal(h.calls.write, 0);
  assert.equal(h.calls.session, 1);
});
await check('Exempt employee login on day off is allowed without inventing a punch', async () => {
  const h = harness({ activePeriod: false });
  await h.login();
  assert.equal(h.calls.write, 0);
  assert.equal(h.calls.session, 1);
});
await check('Exempt employee without an active assignment is still allowed into platform', async () => {
  const h = harness({ activePeriod: false });
  await h.login();
  assert.equal(h.calls.write, 0);
  assert.equal(h.calls.session, 1);
});
await check('Already clocked-in exempt employee is not checked in a second time', async () => {
  const h = harness({ existingCheckIn: true });
  await h.login();
  assert.equal(h.calls.write, 0);
  assert.equal(h.calls.session, 1);
});
await check('Closed attendance period is not re-opened for exempt employee', async () => {
  const h = harness({ existingCheckIn: true, existingCheckOut: true });
  await h.login();
  assert.equal(h.calls.write, 0);
  assert.equal(h.calls.session, 1);
});
await check('Login automatically checks in exempt employee even without the legacy attendance flag', async () => {
  const h = harness({ requestCheckIn: false });
  await h.login();
  assert.equal(h.calls.read, 1);
  assert.equal(h.calls.write, 1);
  assert.equal(h.calls.session, 1);
});
await check('Required primary verified device retains original work-period and attendance gates', async () => {
  const h = harness({ required: true, primary: true });
  await h.login();
  assert.equal(h.calls.gate, 1);
  assert.equal(h.calls.requiredAttendance, 1);
  assert.equal(h.calls.read, 0);
  assert.equal(h.calls.write, 0);
});
await check('Required secondary device retains access gate without creating attendance', async () => {
  const h = harness({ required: true, primary: false });
  await h.login();
  assert.equal(h.calls.gate, 1);
  assert.equal(h.calls.requiredAttendance, 0);
  assert.equal(h.calls.write, 0);
  assert.equal(h.calls.session, 1);
});
await check('UI login automatically requests attendance and sidebar supports restored sessions', () => {
  assert.match(loginScreen, /attendanceCheckIn:\s*true/);
  assert.match(sidebar, /action:\s*"self_check_in"/);
  assert.match(sidebar, /autoCheckInAttempts/);
  assert.match(sidebar, /void handleCheckIn\(\)/);
  assert.match(api, /if \(deviceRole === "secondary" \|\| deviceRole === "unverified"\)/);
  assert.match(device, /if \(!policy\?\.verification_required\) return "exempt"/);
});
await check('Reports derive attended status from saved check-in rather than device policy', () => {
  assert.match(api, /else if \(record\?\.check_in\)\s*\{/);
  assert.match(api, /result = `\$\{statusText\} .*\$\{workText\}/);
  assert.doesNotMatch(api.slice(api.indexOf('async function reportData('), api.indexOf('async function authorizeEarlyDeparture(')), /verification_required/);
});
await check('Original normal attendance record save and scheduled auto-checkout remain intact', () => {
  assert.match(core, /insert into core\.attendance_records\(/);
  assert.match(core, /check_in=coalesce\(core\.attendance_records\.check_in,excluded\.check_in\)/);
  assert.match(core, /check_out=r\.scheduled_end_at/);
});
for (const path of ['server/_attendance.ts', 'server/auth/login.ts', 'server/attendance.ts']) {
  await check(`${path} parses as TypeScript`, () => {
    const result = ts.transpileModule(readFileSync(path, 'utf8'), {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    assert.equal((result.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  });
}
console.log(`Attendance device exemption login regression: ${passed}/${passed} passed`);
