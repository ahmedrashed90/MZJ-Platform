import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const server = readFileSync('server/attendance.ts', 'utf8');
const ui = readFileSync('src/attendance/AttendancePage.tsx', 'utf8');
const extract = (source, name) => {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n}\\n`));
  assert.ok(match, `Missing ${name}`);
  return match[0];
};
const compile = (code) => ts.transpileModule(code, {
  fileName: 'test-fixture.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const serverExports = {};
vm.runInNewContext(compile([
  'validTime', 'timeMinutes', 'attendanceReportExpectedMinutes', 'attendanceReportCapAuthorizedCredits',
].map(name => extract(server, name)).join('\n') +
  '\nexports.expected = attendanceReportExpectedMinutes; exports.cap = attendanceReportCapAuthorizedCredits;'),
{ exports: serverExports, Number, Math }, { timeout: 3000 });
const uiExports = {};
vm.runInNewContext(compile([
  'clockMinutes', 'scheduledMinutes', 'attendanceHourTotals', 'formatDurationMinutes', 'hoursDifferenceText',
].map(name => extract(ui, name)).join('\n') +
  '\nexports.totals = attendanceHourTotals; exports.diff = hoursDifferenceText;'),
{ exports: uiExports, Number, Math }, { timeout: 3000 });
const { expected, cap } = serverExports;
const { totals, diff } = uiExports;
const shift = (startTime, endTime) => ({ startTime, endTime });
const single = [shift('15:00', '21:00')];
const split = [shift('09:00', '12:00'), shift('15:00', '21:00')];
let checks = 0;
const check = (name, test) => { test(); checks++; console.log(`PASS ${name}`); };

check('Employee-specific daily work hours override identical nominal shift lengths', () => {
  assert.equal(expected(single, 6, false, false), 360);
  assert.equal(expected(single, 7.5, false, false), 450);
  assert.equal(expected(split, 8, false, false), 480);
  assert.equal(expected(split, 9, false, false), 540);
});
check('Daily work hour overrides support decimal hours rounded to minutes', () => {
  assert.equal(expected(single, 6.25, false, false), 375);
  assert.equal(expected(single, '7.75', false, false), 465);
});
check('Unconfigured targets preserve schedule-based behavior and no shifts mean zero', () => {
  for (const value of [null, undefined, '', 'not a number', 0, 25]) {
    assert.equal(expected(split, value, false, false), 540);
  }
  assert.equal(expected([], 8, false, false), 0);
});
check('Weekly rest is excluded even when daily work hours were configured', () => {
  assert.equal(expected(single, 8, true, false), 0);
  assert.equal(expected(split, null, true, false), 0);
});
check('Friday special shift keeps its actual shorter scheduled length', () => {
  const friday = [shift('16:00', '21:00')];
  assert.equal(expected(friday, 8, false, true), 300);
  assert.equal(expected(friday, 4, false, true), 240);
});
check('Each filtered employee has an independent target, total, and deficit', () => {
  const todayA = { userId: 'employee-A', isDayOff: false, expectedMinutes: expected(single, 6, false, false), periods: [{ ...single[0], creditedMinutes: 345 }] };
  const todayB = { userId: 'employee-B', isDayOff: false, expectedMinutes: expected(single, 8, false, false), periods: [{ ...single[0], creditedMinutes: 360 }] };
  assert.deepEqual(JSON.parse(JSON.stringify(totals([todayA]))), { expected: 360, actual: 345 });
  assert.deepEqual(JSON.parse(JSON.stringify(totals([todayB]))), { expected: 480, actual: 360 });
  assert.equal(diff(totals([todayA]).expected, totals([todayA]).actual), '+15 دقيقة');
  assert.equal(diff(totals([todayB]).expected, totals([todayB]).actual), '+2 ساعة');
});
check('Historical shifts use their effective daily target for that date', () => {
  const rows = [
    { isDayOff: false, expectedMinutes: expected(single, 6, false, false), periods: [{ ...single[0], creditedMinutes: 360 }] },
    { isDayOff: false, expectedMinutes: expected(single, 7.5, false, false), periods: [{ ...single[0], creditedMinutes: 450 }] },
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(totals(rows))), { expected: 810, actual: 810 });
});
check('Approved leave cannot produce fictitious overtime over employee daily target', () => {
  const morningVacation = { period: { creditedMinutes: 180 }, attendedMinutes: 0 };
  const eveningVacation = { period: { creditedMinutes: 360 }, attendedMinutes: 0 };
  cap([morningVacation, eveningVacation], 480);
  assert.equal(morningVacation.period.creditedMinutes + eveningVacation.period.creditedMinutes, 480);
  const firstWorked = { period: { creditedMinutes: 180 }, attendedMinutes: 180 };
  const secondVacation = { period: { creditedMinutes: 360 }, attendedMinutes: 0 };
  cap([firstWorked, secondVacation], 480);
  assert.equal(firstWorked.period.creditedMinutes + secondVacation.period.creditedMinutes, 480);
});
check('Clocked overtime remains real while leave credits are capped', () => {
  const actualWorked = { period: { creditedMinutes: 600 }, attendedMinutes: 600 };
  const extraPermission = { period: { creditedMinutes: 120 }, attendedMinutes: 0 };
  cap([actualWorked, extraPermission], 480);
  assert.equal(actualWorked.period.creditedMinutes, 600);
  assert.equal(extraPermission.period.creditedMinutes, 0);
});
check('Permissions and weekly rest remain consistently handled in UI totals', () => {
  const fullVacation = { isDayOff: false, expectedMinutes: 360, periods: [{ ...single[0], creditedMinutes: 360, workMinutes: 0 }] };
  const off = { isDayOff: true, expectedMinutes: 0, periods: [{ ...single[0], creditedMinutes: 0 }] };
  assert.deepEqual(JSON.parse(JSON.stringify(totals([fullVacation, off]))), { expected: 360, actual: 360 });
});
check('Old reports remain readable without expectedMinutes field', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(totals([{ isDayOff: false, periods: [{ ...single[0], creditedMinutes: 330 }] }]))), { expected: 360, actual: 330 });
  assert.equal(totals([{ isDayOff: false, expectedMinutes: 0, periods: single }]).expected, 0);
});
check('Server calculates expected from effective assignment and client uses same totals in report and export', () => {
  assert.match(server, /slots, assignment\?\.daily_work_hours, isDayOff, isFriday && fridayScheduleEnabled/);
  assert.match(server, /expectedMinutes,\s*earlyDeparturePermissions/);
  assert.match(server, /attendanceReportCapAuthorizedCredits\(creditedShifts, expectedMinutes\)/);
  assert.match(ui, /typeof row\.expectedMinutes === 'number'/);
  assert.ok((ui.match(/attendanceHourTotals\(/g) || []).length >= 8);
  assert.match(ui, /buildAttendancePdf\(payload\)/);
  assert.match(ui, /buildExcelDocument\(payload\)/);
});
console.log(`Attendance employee-specific hours: ${checks}/${checks} passed`);
