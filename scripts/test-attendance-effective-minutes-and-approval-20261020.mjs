import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');

const attendanceServer = fs.readFileSync('server/attendance.ts', 'utf8');
const attendanceScreen = fs.readFileSync('src/attendance/AttendancePage.tsx', 'utf8');
const workflow = fs.readFileSync('server/marketing/workflow.ts', 'utf8');
let count = 0;
function check(message, assertion) { assertion(); count++; console.log('PASS: ' + message); }
const helpers = [
  'validDate', 'validTime', 'timeMinutes', 'liveWorkMinutes',
  'reportDateFromTimestamp', 'reportTimeMinutesFromTimestamp',
  'attendanceReportTimelineMinute', 'attendanceReportCreditedMinutes',
];
const helperText = helpers.map(name => {
  const block = attendanceServer.match(new RegExp(`function ${name}\\([^]*?\\n}\\n`));
  assert.ok(block, `missing function ${name}`);
  return block[0];
}).join('\n');
const exports = {};
const commonJs = ts.transpileModule(`${helperText}\nexports.credit = attendanceReportCreditedMinutes;`, {
  fileName: 'hours-test.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInNewContext(commonJs, { exports, Date, Intl, Math, Number, String, ATTENDANCE_TIME_ZONE: 'Asia/Riyadh' }, { timeout: 3000 });
const credit = exports.credit;
const day = '2026-10-18';
const at = time => `${day}T${time}:00+03:00`;
const morning = { check_in: at('09:12'), check_out: at('12:00'), checkout_source: 'auto', work_minutes: 168 };
const evening = { check_in: at('15:16'), check_out: at('21:00'), checkout_source: 'auto', work_minutes: 344 };
check('Grace-adjusted morning with 2 minutes of penalty credits 178 minutes', () => assert.equal(credit(morning, day, '09:00', '12:00', 2, null), 178));
check('Grace-adjusted evening with 6 minutes of penalty credits 354 minutes', () => assert.equal(credit(evening, day, '15:00', '21:00', 6, null), 354));
check('Example report is 8h52 actual and 8 minutes required minus actual', () => {
  const actual = credit(morning, day, '09:00', '12:00', 2, null) + credit(evening, day, '15:00', '21:00', 6, null);
  assert.equal(actual, 532);
  assert.equal(540 - actual, 8);
});
check('Approved early leave in evening credits its own interval without losing worked part', () => {
  const attendance = { check_in: at('15:00'), check_out: at('18:00'), checkout_source: 'authorized' };
  const permission = { permission_type: 'departure', from_at: at('18:00'), to_at: at('21:00') };
  assert.equal(credit(attendance, day, '15:00', '21:00', 0, permission), 360);
  assert.equal(credit(morning, day, '09:00', '12:00', 2, null), 178);
});
check('Early departure without approval deducts missing shift time', () => {
  const attendance = { check_in: at('15:00'), check_out: at('18:00'), checkout_source: 'auto' };
  assert.equal(credit(attendance, day, '15:00', '21:00', 0, null), 180);
});
check('Approved early departure without check-in credits only authorized interval', () => {
  const permission = { permission_type: 'departure', from_at: at('16:00'), to_at: at('18:00') };
  assert.equal(credit(null, day, '15:00', '21:00', 0, permission), 120);
});
check('Permission does not invent hours before/after its authorized bounds', () => {
  const permission = { permission_type: 'departure', from_at: at('17:30'), to_at: at('18:30') };
  const attendance = { check_in: at('15:00'), check_out: at('17:00'), checkout_source: 'authorized' };
  assert.equal(credit(attendance, day, '15:00', '21:00', 0, permission), 180);
});
check('Vacation is never treated as worked time', () => {
  assert.equal(credit(null, day, '15:00', '21:00', 0, { permission_type: 'vacation', from_at: at('15:00'), to_at: at('21:00') }), 0);
});
check('No check-in and no permission are zero credited minutes', () => assert.equal(credit(null, day, '09:00', '12:00', 0, null), 0));
check('A completed shift preserves explicitly logged post-shift overtime', () => {
  const overtime = { check_in: at('09:00'), check_out: at('12:30'), checkout_source: 'manual' };
  assert.equal(credit(overtime, day, '09:00', '12:00', 0, null), 210);
});
check('Report period maps only its selected authorized permission', () => {
  assert.match(attendanceServer, /earlyDeparturePermission\.period_id === clean\(slot\.id\)/);
  assert.match(attendanceServer, /attendanceReportCreditedMinutes\(record, day, slot\.startTime, slot\.endTime, delayMinutes, permissionForShift\)/);
});
check('Summary, per-day report, PDF and Excel use same credited minutes function', () => {
  assert.match(attendanceScreen, /period\.creditedMinutes \?\? period\.workMinutes/);
  assert.ok((attendanceScreen.match(/attendanceHourTotals\(/g) || []).length >= 7);
});
check('Vacation day/shift exemption and Friday exemption are preserved', () => {
  assert.match(attendanceScreen, /if \(row\.isDayOff\) return total;/);
  assert.match(attendanceScreen, /if \(fullDayVacation\) return total;/);
  assert.match(attendanceScreen, /periodId === 'friday'/);
});
check('Existing authorized checkout export label remains unchanged', () => {
  assert.match(attendanceScreen, /if \(period\.checkoutSource === "authorized"\) return "إجازة";/);
});
check('Marketing item badges require final approval, not merely submitted files', () => {
  assert.match(workflow, /case when i\.status='approved' and i\.approved_at is not null and i\.submitted_at is not null/);
});
check('Marketing dashboard counters count only approved items', () => {
  assert.equal((workflow.match(/count\(i\.id\) filter\(where i\.status='approved' and i\.approved_at is not null/g) || []).length, 2);
});
check('Marketing punctuality is still determined by original submission date', () => {
  assert.match(workflow, /\(i\.submitted_at at time zone 'Asia\/Riyadh'\)::date <= i\.due_on/);
  assert.match(workflow, /\(i\.submitted_at at time zone 'Asia\/Riyadh'\)::date > i\.due_on/);
});
console.log(`${count}/${count} approved delivery + credited attendance checks passed`);
