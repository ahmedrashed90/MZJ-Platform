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
  'clean', 'validDate', 'validTime', 'timeMinutes', 'liveWorkMinutes',
  'reportDateFromTimestamp', 'reportTimeMinutesFromTimestamp',
  'attendanceReportTimelineMinute', 'attendanceReportCreditedMinutes', 'permissionForReportShift',
];
const helperText = helpers.map(name => {
  const block = attendanceServer.match(new RegExp(`function ${name}\\([^]*?\\n}\\n`));
  assert.ok(block, `missing function ${name}`);
  return block[0];
}).join('\n');
const exports = {};
const commonJs = ts.transpileModule(`${helperText}\nexports.credit = attendanceReportCreditedMinutes; exports.permissionForShift = permissionForReportShift;`, {
  fileName: 'hours-test.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInNewContext(commonJs, { exports, Date, Intl, Math, Number, String, ATTENDANCE_TIME_ZONE: 'Asia/Riyadh' }, { timeout: 3000 });
const credit = exports.credit;
const permissionForShift = exports.permissionForShift;
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
check('Approved vacation credits the entire assigned shift without fake check-in', () => {
  assert.equal(credit(null, day, '15:00', '21:00', 0, { permission_type: 'vacation', from_at: at('15:00'), to_at: at('21:00') }), 360);
  assert.equal(credit(null, day, '09:00', '12:00', 0, { permission_type: 'vacation', from_at: at('09:00'), to_at: at('12:00') }), 180);
});
check('Exceptional permission credits only authorized minutes, not the entire shift', () => {
  assert.equal(credit(null, day, '09:00', '12:00', 0, { permission_type: 'exceptional', from_at: at('10:00'), to_at: at('11:00') }), 60);
});
check('Exceptional permission overlapping recorded work does not double count', () => {
  const attendance = { check_in: at('09:00'), check_out: at('10:30'), checkout_source: 'manual' };
  const permission = { permission_type: 'exceptional', from_at: at('10:00'), to_at: at('12:00') };
  assert.equal(credit(attendance, day, '09:00', '12:00', 0, permission), 180);
});
check('Vacation morning plus worked evening gives full scheduled 9 hours', () => {
  assert.equal(credit(null, day, '09:00', '12:00', 0, { permission_type: 'vacation', from_at: at('09:00'), to_at: at('12:00') }) +
    credit({check_in:at('15:00'),check_out:at('21:00'),checkout_source:'auto'}, day,'15:00','21:00',0,null), 540);
});
check('No check-in and no permission are zero credited minutes', () => assert.equal(credit(null, day, '09:00', '12:00', 0, null), 0));
check('A completed shift preserves explicitly logged post-shift overtime', () => {
  const overtime = { check_in: at('09:00'), check_out: at('12:30'), checkout_source: 'manual' };
  assert.equal(credit(overtime, day, '09:00', '12:00', 0, null), 210);
});
check('Report period maps only its own authorized permission even with two shifts', () => {
  const morningPermission = { period_id: 'morning', permission_type:'vacation' };
  const eveningPermission = { period_id: 'evening', permission_type:'exceptional' };
  assert.equal(permissionForShift([morningPermission, eveningPermission], 'morning', false), morningPermission);
  assert.equal(permissionForShift([morningPermission, eveningPermission], 'evening', false), eveningPermission);
  assert.equal(permissionForShift([morningPermission, eveningPermission], 'not-assigned', false), null);
  assert.match(attendanceServer, /attendanceReportCreditedMinutes\(record, day, slot\.startTime, slot\.endTime, delayMinutes, permissionForShift\)/);
});
check('Summary, per-day report, PDF and Excel use same credited minutes function', () => {
  assert.match(attendanceScreen, /period\.creditedMinutes \?\? period\.workMinutes/);
  assert.ok((attendanceScreen.match(/attendanceHourTotals\(/g) || []).length >= 7);
});
check('Weekly rest stays excluded while paid vacation and exceptional permission count', () => {
  assert.match(attendanceScreen, /if \(row\.isDayOff\) return total;/);
  assert.doesNotMatch(attendanceScreen, /if \(fullDayVacation\) return total;/);
  assert.match(attendanceScreen, /earlyDeparturePermissions: ReportPermission\[\]/);
});
check('Exports name checkout, vacation and exceptional authorizations correctly', () => {
  assert.match(attendanceScreen, /period\.permission\?\.permissionType === 'vacation'/);
  assert.match(attendanceScreen, /period\.permission\?\.permissionType === 'exceptional'/);
  assert.match(attendanceScreen, /period\.checkoutSource === "authorized" \|\| period\.permission\?\.permissionType === 'departure'/);
});
const attendanceSchema = fs.readFileSync('server/_attendance-schema.ts', 'utf8');
check('Schema migrates old day uniqueness to independently writable shift permissions', () => {
  assert.match(attendanceSchema, /drop index if exists core\.attendance_early_departure_user_day_unique;/);
  assert.match(attendanceSchema, /attendance_early_departure_user_day_period_unique/);
  assert.match(attendanceSchema, /on core\.attendance_early_departure_permissions\(user_id,work_date,period_id\)/);
  assert.match(attendanceServer, /on conflict\(user_id,work_date,period_id\) do update set/);
  assert.doesNotMatch(attendanceServer, /on conflict\(user_id,work_date\) do update set/);
});
check('Schema accepts exceptional authorization and preserves old rows', () => {
  assert.match(attendanceSchema, /permission_type in \('departure','vacation','exceptional'\)/);
  assert.match(attendanceSchema, /alter table core\.attendance_early_departure_permissions add column if not exists period_id/);
  assert.doesNotMatch(attendanceSchema, /delete from core\.attendance_early_departure_permissions/);
});
check('Report collects every saved authorization instead of overwriting morning with evening', () => {
  assert.match(attendanceServer, /const permissionMap = new Map<string, any\[\]>/);
  assert.match(attendanceServer, /permissionMap\.get\(key\)!\.push\(permission\)/);
  assert.match(attendanceServer, /earlyDeparturePermissions: mappedPermissions/);
  assert.match(attendanceScreen, /permissions\.map\(permission =>/);
});
check('Saving a second period never resets a different existing permission', () => {
  assert.match(attendanceServer, /and period_id=\$\{item\.periodId\} for update/);
  assert.match(attendanceServer, /if \(previousPermission\?\.permission_type === 'departure'/);
  assert.match(attendanceServer, /if \(item\.permissionType === 'departure'\) await tx/);
});
check('Friday-shift and legacy day-wide permission handling stay compatible', () => {
  const fridayPermission = { period_id: 'friday', permission_type: 'exceptional' };
  const olderPermission = { period_id: '', permission_type: 'vacation' };
  const exactPermission = { period_id: 'morning', permission_type: 'departure' };
  assert.equal(permissionForShift([fridayPermission], 'morning', true), fridayPermission);
  assert.equal(permissionForShift([olderPermission], 'evening', false), olderPermission);
  assert.equal(permissionForShift([olderPermission, exactPermission], 'morning', false), exactPermission);
});
check('Vacation auto-selects complete scheduled shift and makes it read-only', () => {
  assert.match(attendanceScreen, /if \(field === 'permissionType' && value === 'vacation'\)/);
  assert.match(attendanceScreen, /entry\.fromTime = shift\.startTime/);
  assert.match(attendanceScreen, /entry\.permissionType === 'vacation'/);
});
check('Exceptional option and independent permission deletion are exposed to admin', () => {
  assert.match(attendanceScreen, /<option value="exceptional">إذن استثنائي<\/option>/);
  assert.match(attendanceScreen, /onDelete\(permission\.id\)/);
  assert.match(attendanceScreen, /<EarlyPermissionCell row=\{row\}/);
});
const uiHelpers = [ 'clockMinutes', 'formatDurationMinutes', 'scheduledMinutes', 'attendanceHourTotals', 'wholeHoursText', 'hoursDifferenceText' ];
const uiChunks = uiHelpers.map(name => {
  const match = attendanceScreen.match(new RegExp(`function ${name}\\([^]*?\\n}\\n`));
  assert.ok(match, `Missing attendance UI helper ${name}`);
  return match[0];
}).join('\n');
const uiExports = {};
vm.runInNewContext(ts.transpileModule(`${uiChunks}\nexports.totals = attendanceHourTotals;`, {
  fileName: 'report-helper.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: uiExports, Number, Math }, { timeout: 3000 });
check('Employee report and exports use vacation-credit totals with no false three-hour deficit', () => {
  const morning = { startTime: '09:00', endTime: '12:00', creditedMinutes: 180, checkIn: null };
  const evening = { startTime: '15:00', endTime: '21:00', creditedMinutes: 360, checkIn: true };
  const totals = uiExports.totals([{ isDayOff: false, periods: [morning, evening] }]);
  assert.equal(totals.expected, 540);
  assert.equal(totals.actual, 540);
});
check('Only the weekly rest day stays outside monthly expected and credited hours', () => {
  const off = { isDayOff: true, periods: [{startTime:'09:00',endTime:'12:00',creditedMinutes:180}] };
  assert.deepEqual(JSON.parse(JSON.stringify(uiExports.totals([off]))), {expected:0,actual:0});
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
