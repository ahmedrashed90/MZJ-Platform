'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync('src/attendance/AttendancePage.tsx','utf8');
const start = source.indexOf('function buildAttendancePdf(payload: ReportPayload) {');
const end = source.indexOf('\nfunction buildExcelDocument(',start);
assert.ok(start >= 0 && end > start, 'PDF generator exists');
const block = source.slice(start,end);
const helper=ts.transpileModule(`${block}\nexports.make=buildAttendancePdf;`,{fileName:'report.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const x={};
const escape=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const ctx={exports:x,ATTENDANCE_SUMMARY_HEADERS:['م','الفرع','الموظف','اليوم','التاريخ','حضور الفترة الأولى','انصراف الفترة الأولى','تأخير الفترة الأولى','غياب الفترة الأولى','حضور الفترة الثانية','انصراف الفترة الثانية','تأخير الفترة الثانية','غياب الفترة الثانية','ساعات الدوام المفترضة','ساعات العمل الفعلية','الفرق (مفترض − فعلي)'],
  exportRowsByEmployee:payload=>[...new Map(payload.rows.map(row=>[row.userId,0])).keys()].map(id=>({name:payload.rows.find(row=>row.userId===id).name,branch:payload.rows.find(row=>row.userId===id).branch,userId:id,employeeNo:null,rows:payload.rows.filter(row=>row.userId===id)})),
  htmlEscape:escape,formatAttendanceDate:v=>v,formatAttendanceDay:()=>'الأحد',exportPeriods:row=>[row.periods[0],row.periods[1]],
  attendanceHourTotals:row=>({expected:540,actual:480}),exportCheckIn:p=>p?.checkIn??'—',exportCheckOut:p=>p?.checkOut??'—',
  exportDelay:()=> '—',exportAbsence:()=> '—',wholeHoursText:v=>`${v} دقيقة`,hoursDifferenceText:()=>'+60 دقيقة'};
vm.runInNewContext(helper,ctx);
let passed=0;const check=(v,name)=>{assert.ok(v,name);passed++;console.log('PASS '+name)};
const rows=[{userId:'u1',name:'أحمد <مدير>',branch:'الصالة',date:'2026-11-01',periods:[{checkIn:'09:00',checkOut:'12:00'},{checkIn:'15:00',checkOut:'21:00'}]},
 {userId:'u2',name:'محمود',branch:'القادسية',date:'2026-11-01',periods:[{checkIn:'09:01',checkOut:'12:00'}]},
 {userId:'u1',name:'أحمد <مدير>',branch:'الصالة',date:'2026-11-02',periods:[{checkIn:'09:15'}]}];
const html=x.make({from:'2026-11-01',to:'2026-11-02',rows});
check((html.match(/class="employee-report"/g)||[]).length===2,'One employee section for each selected employee');
check((html.match(/تقرير الحضور والانصراف - ملخص الفترة/g)||[]).length===3,'Only summary headings occur (title and two employees)');
check(!html.includes('تقرير تفصيلي'),'Second detailed PDF section is removed');
check(html.includes('.employee-report+.employee-report{break-before:page;page-break-before:always}'),'Employees have independent printed pages');
check(html.includes('أحمد &lt;مدير&gt;')&&!html.includes('أحمد <مدير>'),'HTML-unsafe names are escaped');
check(html.includes('حضور الفترة الأولى')&&html.includes('حضور الفترة الثانية'),'Both work shifts are shown in the same daily summary row');
check(html.includes('A4 landscape') && html.includes('Tajawal'),'Landscape orientation and Arabic-friendly typography are preserved');
check(source.includes('worksheet("ملخص الفترة"')&&source.includes('worksheet("تقرير تفصيلي"'),'Excel export remains unchanged');
if(process.env.ATTENDANCE_PDF_PREVIEW_PATH)fs.writeFileSync(process.env.ATTENDANCE_PDF_PREVIEW_PATH,html);
console.log(`Attendance PDF one-summary-per-employee: ${passed}/${passed} tests passed`);
