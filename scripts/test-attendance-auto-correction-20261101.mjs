import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url), ts=require('typescript');
const root=process.cwd();
const backend=readFileSync('server/attendance.ts','utf8');
const ui=readFileSync('src/attendance/AttendancePage.tsx','utf8');
const schema=readFileSync('server/_attendance-schema.ts','utf8');
const login=readFileSync('server/auth/login.ts','utf8');
const sidebar=readFileSync('src/components/Sidebar.tsx','utf8');
let done=0;
async function check(label,fn) { await fn();console.log('PASS',label);done++ }
const from=backend.indexOf('const ATTENDANCE_CORRECTION_ADMIN_EMAIL = '),to=backend.indexOf('async function authorizeEarlyDeparture(',from);
assert.ok(from>=0&&to>from);
const source=backend.slice(from,to)+'\nexports.account = attendanceCorrectionAccount; exports.correct = correctAttendanceRecord;';
const compiled=ts.transpileModule(source,{fileName:'test.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const employeeId='123e4567-e89b-42d3-a456-426614174000',periodId='123e4567-e89b-42d3-a456-426614174001',adminId='123e4567-e89b-42d3-a456-426614174002',recordId='123e4567-e89b-42d3-a456-426614174003',assignmentId='123e4567-e89b-42d3-a456-426614174004',scheduleId='123e4567-e89b-42d3-a456-426614174005';
const admin={id:adminId,email:'mr.ahmed_rashed@outlook.sa',permissions:['platform.superadmin']};
const body={userId:employeeId,periodId,workDate:'2026-10-31',checkInTime:'09:04',checkOutTime:'12:00',reason:'تصحيح توقيت اختبار'};
function create({stored=true,editorEmail=admin.email,failAudit=false}={}) {
 const calls=[];
 const previous=stored?{id:recordId,assignment_id:assignmentId,schedule_id:scheduleId,period_id:periodId,
  work_date:'2026-10-31',scheduled_start_at:'2026-10-31T06:00:00.000Z',scheduled_end_at:'2026-10-31T09:00:00.000Z',grace_minutes:0,check_in:'2026-10-31T06:15:00.000Z',check_out:'2026-10-31T09:00:00.000Z',delay_minutes:15,work_minutes:165}:null;
 const tag=async(strings,...args)=>{
  const q=strings.join(' ').replace(/\s+/g,' ').trim();calls.push({q,args});
  if(q.includes('select email from core.users')) return [{email:editorEmail}];
  if(q.includes('select id::text from core.users')) return [{id:employeeId}];
  if(q.includes('from core.attendance_records') && q.includes('for update')) return stored?[previous]:[];
  if(q.includes('from core.attendance_user_schedules')) return [{id:assignmentId,schedule_id:scheduleId,period_ids:[periodId],period_overrides:{},weekly_off_day:null}];
  if(q.includes('from core.attendance_periods')) return [{id:periodId,name:'الفترة الصباحية',start_time:'09:00',end_time:'12:00',grace_minutes:0,sort_order:1}];
  if(q.includes('from core.attendance_settings')) return [{friday_start_time:null,friday_end_time:null}];
  if(q.startsWith('update core.attendance_records')) return [{id:recordId}];
  if(q.startsWith('insert into core.attendance_records')) return [{id:recordId}];
  if(q.startsWith('insert into core.attendance_record_corrections')) {if(failAudit)throw new Error('Audit failure');return []}
  throw new Error(`Unexpected query: ${q.slice(0,110)}`);
 };
 const context={exports:{},getSql:()=>({begin: async fn=>fn(tag)}),
  clean:v=>String(v??'').trim(),validUuid:v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v),
  validDate:v=>/^\d{4}-\d{2}-\d{2}$/.test(v),validTime:v=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v),
  currentRiyadhDate:()=> '2026-11-01',weekdayForDate:()=>6,parseWeeklyOffDay:v=>v==null?null:Number(v),
  normalizedIdList: arr=>(arr||[]).slice(),normalizePeriodOverrides:v=>v||{},resolveAssignedPeriodTimes:p=>({startTime:p.start_time,endTime:p.end_time}),
  AttendanceError:class AttendanceError extends Error{constructor(code,msg,status=400){super(msg);this.code=code;this.status=status}},
  Date,Number,Boolean,Math,String,RegExp,Array,Promise,Set,console};
 vm.runInNewContext(compiled,context,{timeout:2000});
 return {correct:context.exports.correct,account:context.exports.account,calls};
}
await check('Permission requires specific email and superadmin role together', async()=>{
 const h=create();assert.equal(h.account(admin),true);
 assert.equal(h.account({...admin,permissions:[]}),false);
 assert.equal(h.account({...admin,email:'other@example.com'}),false);
});
await check('Unauthorized editor is denied before touching the database', async()=>{
 const h=create();await assert.rejects(()=>h.correct(body,{...admin,email:'other@example.com'}),e=>e.code==='CORRECTION_FORBIDDEN');assert.equal(h.calls.length,0);
});
await check('Database email must match the verified privileged account', async()=>{
 const h=create({editorEmail:'other@example.com'});await assert.rejects(()=>h.correct(body,admin),e=>e.code==='CORRECTION_FORBIDDEN');assert.equal(h.calls.length,1);
});
await check('Future or ill-ordered times and missing reason rejected', async()=>{
 const h=create();
 await assert.rejects(()=>h.correct({...body,checkOutTime:'08:00'},admin),e=>e.code==='CORRECTION_CHECKOUT_BEFORE_CHECKIN');
 await assert.rejects(()=>h.correct({...body,workDate:'2027-01-01'},admin),e=>e.code==='CORRECTION_DATE_RANGE');
 await assert.rejects(()=>h.correct({...body,reason:'no'},admin),e=>e.code==='CORRECTION_REASON_REQUIRED');
 assert.equal(h.calls.length,0);
});
await check('Existing real attendance corrected and audit inserted in same transaction', async()=>{
 const h=create(),r=await h.correct(body,admin);assert.equal(r.ok,true);
 assert.ok(h.calls.some(x=>x.q.startsWith('update core.attendance_records')));
 assert.ok(h.calls.some(x=>x.q.startsWith('insert into core.attendance_record_corrections')));
 const u=h.calls.find(x=>x.q.startsWith('update core.attendance_records'));
 assert.ok(u.args.includes(4),'delay recalculated to 4 minutes');
 assert.ok(u.args.includes(176),'worked time recalculated to 176 minutes');
 assert.ok(u.args.includes('late'));
});
await check('Missing punch can be inserted only for an assigned valid period and audited', async()=>{
 const h=create({stored:false}),r=await h.correct({...body,checkOutTime:''},admin);
 assert.equal(r.ok,true);
 assert.ok(h.calls.some(x=>x.q.startsWith('insert into core.attendance_records')));
 assert.ok(h.calls.some(x=>x.q.startsWith('insert into core.attendance_record_corrections')));
});
await check('Audit failure propagates out of the transaction', async()=>{
 const h=create({failAudit:true});await assert.rejects(()=>h.correct(body,admin),/Audit failure/);
});
await check('New schema keeps permanent correction log and corrected checkout source',()=>{
 assert.match(schema,/create table if not exists core\.attendance_record_corrections/);
 assert.match(schema,/old_check_in timestamptz/);
 assert.match(schema,/check \(checkout_source in \('manual','auto','legacy','authorized','corrected'\)\)/);
});
await check('Report exposes editor flag and two correction controls while retaining normal reports',()=>{
 assert.match(backend,/canCorrectAttendance: attendanceCorrectionAccount\(admin\)/);
 assert.match(backend,/action === "correct_attendance_record"/);
 assert.match(ui,/report\?\.canCorrectAttendance/);
 assert.equal(ui.match(/className="attendance-correct-time-button"/g)?.length,2);
 assert.match(ui,/action: ['"']correct_attendance_record['"']/);
});
await check('Automatic login and restored sessions do not punch secondary devices',()=>{
 assert.match(login,/registerExemptLoginAttendance\(userId, true\)/);
 assert.match(login,/confirmCheckIn: true, forceEnforcement: true/);
 assert.match(login,/verifiedDeviceIsPrimary !== false/);
 assert.match(sidebar,/\['primary', 'exempt'\]/);
 assert.match(sidebar,/autoCheckInAttempts/);
});
console.log(`Attendance automatic checkin and admin correction: ${done}/${done} passed`);
