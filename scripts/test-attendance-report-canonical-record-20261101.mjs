import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync('server/attendance.ts', 'utf8');
const start = source.indexOf('function attendanceReportPeriodKey(');
const end = source.indexOf('function weekdayForDate(', start);
const reportStart = source.indexOf('async function reportData(');
const reportEnd = source.indexOf('// Attendance correction is an explicitly assigned sensitive', reportStart);
assert(start > 0 && end > start && reportStart > 0 && reportEnd > reportStart,
  'Canonical report selection must remain in the actual attendance module');
const code = ts.transpileModule(`${source.slice(start, end)}\n${source.slice(reportStart, reportEnd)}\nexports.select = selectAttendanceReportSlots; exports.report = reportData;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const uuid = (last) => `10000000-1000-4000-8000-${String(last).padStart(12, '0')}`;
const employeeId = uuid(1);
const assignmentId = uuid(2);
const periodId = uuid(3);
const oldPeriodId = uuid(4);
const currentRecordId = uuid(5);
const oldRecordId = uuid(6);
const scheduleId = uuid(7);
const workDate = '2026-11-01';
const canonicalTime = '2026-11-01T09:10:00.000Z'; // 12:10 in Riyadh
const oldTime = '2026-11-01T12:39:00.000Z'; // 15:39 in Riyadh

const canonical = {
  id: currentRecordId, user_id: employeeId, period_id: periodId, assignment_id: assignmentId,
  work_date: workDate, check_in: canonicalTime, check_out: null,
  period_name: 'فترة واحدة', period_sort_order: 1, status: 'late', legacy_source_key: null,
  scheduled_start_at: '2026-11-01T06:00:00.000Z', scheduled_end_at: '2026-11-01T19:00:00.000Z',
  grace_minutes: 0, delay_minutes: 190, work_minutes: 0,
};
const historical = {
  ...canonical, id: oldRecordId, period_id: oldPeriodId, assignment_id: uuid(8),
  check_in: oldTime, period_name: 'فترة واحدة', legacy_source_key: 'former-schedule:sample',
};

function makeHarness(records) {
  const queries = [];
  const sql = async (strings, ...values) => {
    const query = strings.join(' ');
    queries.push(query);
    if (query.includes('from core.attendance_settings')) return [{official_day_end:'22:00', friday_start_time:null, friday_end_time:null}];
    if (query.includes('from core.users u')) return [{id:employeeId, full_name:'موظف اختبار', employee_no:'001',branch_name:'الصالة',branch_id:uuid(9)}];
    if (query.includes('from core.attendance_user_schedules a')) return [{
      id:assignmentId,user_id:employeeId,schedule_id:scheduleId,branch_id:uuid(9), attendance_branch_name:'',
      daily_work_hours:9, period_ids:[periodId],period_overrides:{},weekly_off_day:null,
      effective_from:'2026-10-01',effective_to:null,created_at:'2026-10-01T00:00:00Z',schedule_name:'فترة واحدة',
      branch_name:'الصالة',
    }];
    if (query.includes('from core.attendance_periods')) return [{id:periodId,schedule_id:scheduleId,name:'فترة واحدة',start_time:'09:00',end_time:'22:00',grace_minutes:0,sort_order:1,is_active:true}];
    if (query.includes('from core.attendance_records')) return records;
    if (query.includes('from core.attendance_early_departure_permissions')) return [];
    throw new Error(`Unexpected query: ${query.slice(0, 120)}`);
  };
  const sqlTag = (strings, ...values) => {
    if (Array.isArray(strings) && !Object.hasOwn(strings, 'raw')) return `(${strings.join(',')})`;
    return sql(strings, ...values);
  };
  const key = (name) => String(name || '').trim().toLowerCase();
  const ctx = {
    exports: {},
    getSql: () => sqlTag,
    clean: value => String(value ?? '').trim(),
    dateOnlyValue: value => String(value ?? '').slice(0,10),
    currentRiyadhDate: () => workDate,
    currentRiyadhTimeMinutes: () => 18 * 60,
    validUuid: value => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value),
    validDate: value => /^\d{4}-\d{2}-\d{2}$/.test(value),
    validTime: value => /^\d{2}:\d{2}$/.test(value),
    timeMinutes: value => {const [h,m]=String(value).split(':').map(Number);return h*60+m;},
    dateRange: () => [workDate],
    normalizedIdList: ids => [...ids].sort(),
    normalizePeriodOverrides: value => value || {},
    resolveAssignedPeriodTimes: period => ({startTime:period.start_time,endTime:period.end_time}),
    reportDateFromTimestamp: value => value ? String(value).slice(0,10) : '',
    reportClock: value => value ? `${new Date(value).getUTCHours()+3}:${new Date(value).getUTCMinutes()}` : '',
    report24HourTime: value => value ? '09:00' : '',
    reportDelayMinutes: () => 0,
    parseWeeklyOffDay: () => null,
    weekdayForDate: () => 0,
    permissionForReportShift: () => null,
    attendanceReportExpectedMinutes: slots => slots.length * 540,
    attendanceReportCreditedMinutes: record => record?.check_in ? 120 : 0,
    attendanceReportCapAuthorizedCredits: () => {},
    liveWorkMinutes: () => 120,
    formatMinutes: value => String(value),
    ATTENDANCE_TIME_ZONE:'Asia/Riyadh',
    Date, Math, Number, Boolean, String, Object, Set, Map, Promise, Intl, console,
  };
  vm.runInNewContext(code, ctx, { timeout: 2000 });
  return { report: ctx.exports.report, pick: ctx.exports.select, queries };
}
const request = {query:{view:'report',from:workDate,to:workDate,employeeIds:employeeId}};
let count=0;
const check = async (label, test) => { await test();count++;console.log(`PASS: ${label}`);};
await check('A corrected punch outranks a legacy punch with the same period title', async () => {
  const h=makeHarness([canonical, historical]);
  const report=await h.report(request);
  assert.equal(report.rows.length,1);
  assert.equal(report.rows[0].periods.length,1);
  assert.equal(report.rows[0].periods[0].recordId,currentRecordId);
  assert.equal(report.rows[0].periods[0].checkIn,canonicalTime);
  assert.equal(report.rows[0].expectedMinutes,540,'duplicate record must not double the expected hours');
  assert.equal(report.periodHeaders.length,1);
});
await check('The report is independent of SQL record ordering', async () => {
  const report=await makeHarness([historical,canonical]).report(request);
  assert.equal(report.rows[0].periods[0].recordId,currentRecordId);
  assert.equal(report.rows[0].periods[0].checkIn,canonicalTime);
});
await check('Historical punch remains visible when there is no current-shift punch', async () => {
  const report=await makeHarness([historical]).report(request);
  assert.equal(report.rows[0].periods[0].recordId,oldRecordId);
  assert.equal(report.rows[0].periods[0].checkIn,oldTime);
});
await check('Current assigned punch is preferred even if the old record has a later timestamp', async () => {
  const report=await makeHarness([canonical,{...historical,check_in:'2026-11-01T15:00:00Z'}]).report(request);
  assert.equal(report.rows[0].periods[0].recordId,currentRecordId);
});
await check('An empty current-shift placeholder never hides a real earlier punch', async () => {
  const emptyCurrent = { ...canonical, check_in:null, delay_minutes:0 };
  const report=await makeHarness([emptyCurrent, historical]).report(request);
  assert.equal(report.rows[0].periods[0].recordId,oldRecordId);
  assert.equal(report.rows[0].periods[0].checkIn,oldTime);
});
await check('Distinct shift names remain separate', async () => {
  const slots=[
    {name:'صباحية',id:periodId,isAssigned:true,record:canonical,sortOrder:1},
    {name:'مسائية',id:oldPeriodId,isAssigned:true,record:historical,sortOrder:2},
  ];
  const picked=makeHarness([]).pick(slots,workDate,assignmentId);
  assert.equal(picked.length,2);
  assert.equal(picked[0].name,'صباحية');
  assert.equal(picked[1].name,'مسائية');
});
console.log(`Attendance report canonical correction regression: ${count}/${count} passed`);
