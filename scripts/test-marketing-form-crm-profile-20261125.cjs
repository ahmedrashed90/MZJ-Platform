const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,imports={},extra=''){
 const result=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
 assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
 const mod={exports:{}};
 new Function('require','module','exports',result.outputText+'\n'+extra)(id=>imports[id]||{},mod,mod.exports);
 return mod.exports;
}
const mapping=load('shared/lead-form-crm-fields.ts');
const {resolveFormCrmField:resolve,exactFormCrmNumber:num,formCrmAnswers:parse}=mapping;
for(const [label,field] of [
 ['ما السيارة اللي ترغب فيها؟','car_type'],['إيه السيارة اللي بتدور عليها؟','car_type'],['الماركة','car_type'],
 ['متى تتوقع تشتري السيارة؟','notes'],['ما نوع وظيفتك؟','notes'],['كم راتبك الشهري؟','salary'],
 ['كم إجمالي التزاماتك الشهرية؟ (تشمل تابي وتمارا)','obligation'],['ما البنك اللي ينزل عليه راتبك؟','salary_bank'],
 ['ما عمرك؟','age'],['المدينة','location'],['موديل السيارة','car_model'],['الفئة','car_category'],['اللون','color'],['أي سؤال جديد','notes'],
])assert.equal(resolve('field_123',label),field,label);
assert.equal(resolve('vehicle','ما نوع وظيفتك؟'),'notes');
assert.equal(resolve('x','كم راتبك الشهري؟','notes'),'notes');
assert.equal(resolve('x','الدخل','salary'),'salary');
assert.equal(resolve('x','كيف تفضل الدفع؟','department_code'),'notes');
assert.equal(resolve('salary','Question'),'salary');
assert.equal(mapping.sanitizeFormCrmField('assigned_to'),undefined);
for(const [text,expected] of [['7,000 ريال',7000],['٧٬٠٠٠٫٥٠ ريال سعودي',7000.5],['۷۰۰۰',7000],['5000.25 SAR',5000.25],['0',0],['1,000,000',1000000],['من 3,000 إلى 6,000 ريال',null],['أقل من 3000',null],['3,000+',null],['أكثر من 6,000 ريال',null],['حوالي 5000',null],['5-6000',null],['-500',null],['3,00',null],['1e3',null],['1000000000000',null]])assert.equal(num(text,'salary'),expected,text);
assert.equal(num('لا يوجد','obligation'),0);
assert.equal(num('بدون التزامات','obligation'),0);
assert.equal(num('لا يوجد','salary'),null);
assert.equal(num('٢٥ سنة','age'),25);
assert.equal(num('20.5','age'),null);
assert.equal(num('250','age'),null);
console.log('PASS exact Arabic/Latin numeric conversion, range preservation, safe field allowlist and automatic Arabic mapping');
const row={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',created_at:'2026-11-25T16:27:00Z',answers:{v:'أكسنت',t:'خلال الشهر الحالي',j:'موظف حكومي',s:'٧٬٠٠٠ ريال',o:'أقل من 3,000 ريال',b:'الراجحي',m:'2026',c:'ستاندر',cl:'أبيض',city:'الرياض',age:'29',custom:'["A","B"]'},answer_labels:{v:'ما السيارة اللي ترغب فيها؟',t:'متى تتوقع تشتري السيارة؟',j:'ما نوع وظيفتك؟',s:'كم راتبك الشهري؟',o:'كم إجمالي التزاماتك الشهرية؟',b:'ما البنك اللي ينزل عليه راتبك؟',m:'الموديل',c:'الفئة',cl:'اللون',city:'المدينة',age:'العمر',custom:'خيارات أخرى'}};
// Exercise the actual CRM edit helpers, not a copy of their logic.
const crmEdit=load('server/crm/leads.ts',{
 '../_crm-utils.js':{clean:x=>String(x??'').trim(),departmentKey:()=> 'finance',normalizePhone:x=>x,sourceLabel:x=>x,departmentCodeFromKey:()=> 'finance_sales',branchForDepartment:()=> ''},
 '../../shared/lead-form-crm-fields.js':mapping,
},'exports.leadPayload=leadPayload;exports.applyFinanceProfileEdit=applyFinanceProfileEdit;');
const storedFinance={mzj_form_salary_range:'من 6,000 إلى أقل من 10,000 ريال',mzj_form_obligation_range:'من 3000 الى 6000 ريال',other:'keep'};
const editable=crmEdit.leadPayload({salary:null,obligation:null,extra_data:{...storedFinance}});
crmEdit.applyFinanceProfileEdit(editable,{customerName:'Test'});
assert.deepEqual(editable.extraData,storedFinance);
assert.equal(mapping.hasFinanceProfileRange(editable),true);
crmEdit.applyFinanceProfileEdit(editable,{salary:'8500'});
assert.equal(editable.salary,8500);assert.equal(editable.extraData.mzj_form_salary_range,undefined);assert.equal(mapping.hasFinanceProfileRange(editable),true);
crmEdit.applyFinanceProfileEdit(editable,{obligation:'3000'});
assert.equal(editable.obligation,3000);assert.equal(mapping.hasFinanceProfileRange(editable),false);assert.equal(editable.extraData.other,'keep');
crmEdit.applyFinanceProfileEdit(editable,{salary:'من 6000 إلى أقل من 10000 ريال'});
assert.equal(editable.salary,null);assert.equal(editable.extraData.mzj_form_salary_range,'من 6000 إلى أقل من 10000 ريال');
crmEdit.applyFinanceProfileEdit(editable,{salary:''});assert.equal(editable.salary,null);assert.equal(editable.extraData.mzj_form_salary_range,undefined);
console.log('PASS explicit CRM finance edits, preservation on unrelated saves, exact numeric replacement and clearing');
const leadId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const fieldsKeys=['age','salary','obligation','salary_bank','location','car_type','car_name','car_model','car_category','color'];
let db;
let failEvent=false;
let transactions=0;
function fresh(current={}){db={current:{notes:'[قديم] ملاحظة المندوب',department_code:'finance_sales',assigned_to:'rep',branch_code:'hall',status_label:'عميل جديد',...current},events:[]};}
const sql={begin:async work=>{
 transactions++;
 const draft=structuredClone(db);
 const tx=async(parts,...values)=>{
  const q=parts.join('?').replace(/\s+/g,' ').trim().toLowerCase();
  if(q.includes('from crm.leads l')&&q.includes('for update of l')){assert.equal(values[1],leadId);assert.match(q,/r\.metadata->>'eventkey'=\?/);return draft.current?[{...draft.current}]:[];}
  if(q.startsWith('select id::text,details')){const event=draft.events.find(e=>e.formLeadId===values[1]);return event?[{id:'1',finance_ranges_version:event.financeRangesVersion==null?null:String(event.financeRangesVersion)}]:[];}
  if(q.startsWith('update crm.lead_events set')){assert.equal(values[1],'1');assert.equal(values[2],leadId);Object.assign(draft.events[0],values[0]);return [];}
  if(q.startsWith('update crm.leads set extra_data=')){assert.equal(values[4],leadId);draft.current.extra_data={...draft.current.extra_data,...values[0]};draft.current.notes=values[1];if(values[2])draft.current.credit_limit=null;if(values[3])draft.current.credit_qualified=null;return [];}
  if(q.startsWith('update crm.leads set')){
   assert.doesNotMatch(q,/\b(?:department_code|assigned_to|branch_code|payment_type|status_label|source_code)\s*=/);
   // PostgreSQL must be able to infer BOTH note placeholders independently.
   // The second placeholder is an argument to polymorphic concat_ws (42P18).
   assert.match(q,/notes=case when \?::text='' then notes else concat_ws\(.*?,nullif\(notes,''\),\?::text\) end/);
   assert.equal(values[10],values[11]);
   assert.equal(values[15],leadId);
   assert.match(q,/extra_data=coalesce\(extra_data,'\{\}'::jsonb\)\|\|\?::jsonb/);
   draft.current.extra_data={...draft.current.extra_data,...values[12]};if(values[13])draft.current.credit_limit=null;if(values[14])draft.current.credit_qualified=null;
   for(let i=0;i<fieldsKeys.length;i++)if(values[i]!==null)draft.current[fieldsKeys[i]]=values[i];
   if(values[10])draft.current.notes=[draft.current.notes,values[11]].filter(Boolean).join('\n\n');
   return [];
  }
  if(q.startsWith('insert into crm.lead_events')){if(failEvent)throw new Error('simulated failure');draft.events.push(values[1]);return [];}
  throw new Error(q);
 };
 tx.json=x=>x;
 const result=await work(tx);db=draft;return result;
}};
const profile=load('server/marketing/form-crm-profile.ts',{'../_db.js':{getSql:()=>sql},'../../shared/lead-form-crm-fields.js':mapping});
(async()=>{
 fresh({car_name:'أكسنت',car_type:'أكسنت'});
 await profile.saveMarketingFormProfile(leadId,row,true);
 assert.equal(db.current.salary,7000);assert.equal(db.current.salary_bank,'الراجحي');assert.equal(db.current.car_model,'2026');assert.equal(db.current.car_category,'ستاندر');assert.equal(db.current.color,'أبيض');assert.equal(db.current.location,'الرياض');assert.equal(db.current.age,29);assert.equal(db.current.obligation,undefined);
 assert.match(db.current.notes,/\[25\/11\/2026 19:27\] إجابات فورم المنصات/);
 assert.ok(db.current.notes.includes('متى تتوقع تشتري السيارة؟: خلال الشهر الحالي'));
 assert.ok(db.current.notes.includes('ما نوع وظيفتك؟: موظف حكومي'));
 assert.equal(db.current.extra_data.mzj_form_obligation_range,'أقل من 3,000 ريال');
 assert.ok(!db.current.notes.includes('أقل من 3,000 ريال'));
 assert.ok(db.current.notes.includes('A، B'));
 assert.ok(db.current.notes.startsWith('[قديم] ملاحظة المندوب'));
 const first=structuredClone(db);
 assert.equal(await profile.saveMarketingFormProfile(leadId,row,false),false);
 assert.deepEqual(db,first,'Retry must not duplicate notes or change fields');
 assert.equal(db.events.length,1);
 fresh({salary:9000,salary_bank:'الأهلي',same_submission:false});
 await profile.saveMarketingFormProfile(leadId,row,false);
 assert.equal(db.current.salary,9000);assert.equal(db.current.salary_bank,'الأهلي');assert.equal(db.current.age,undefined);
 assert.ok(db.current.notes.includes('٧٬٠٠٠ ريال'));assert.ok(db.current.notes.includes('الراجحي'));
 assert.equal(db.current.assigned_to,'rep');assert.equal(db.current.department_code,'finance_sales');
 fresh({same_submission:true,salary:9000});
 await profile.saveMarketingFormProfile(leadId,row,false);
 assert.equal(db.current.salary,9000);assert.equal(db.current.salary_bank,'الراجحي');assert.ok(db.current.notes.includes('٧٬٠٠٠ ريال'));
 fresh({same_submission:true});
 const before=structuredClone(db);failEvent=true;
 await assert.rejects(()=>profile.saveMarketingFormProfile(leadId,row,true),/simulated failure/);
 assert.deepEqual(db,before,'Profile and note marker rollback together');failEvent=false;
 assert.equal(await profile.saveMarketingFormProfile(leadId,row,false),true);
 assert.equal(db.current.salary,7000);assert.equal(db.events.length,1);
 fresh();const range={...row,answers:{s:'من 7,000 إلى 10,000 ريال',o:'لا يوجد',b:'الراجحي'},answer_labels:row.answer_labels};
 await profile.saveMarketingFormProfile(leadId,range,true);
 assert.equal(db.current.salary,undefined);assert.equal(db.current.obligation,0);assert.equal(db.current.extra_data.mzj_form_salary_range,'من 7,000 إلى 10,000 ريال');assert.ok(!db.current.notes.includes('من 7,000 إلى 10,000 ريال'));
 // Reproduce the reported Test123 shape: ranges and multiple selections stay
 // verbatim in their corresponding fields, bank is a real text field, ownership is untouched.
 fresh({same_submission:true,car_name:'cc',car_type:'cc'});
 const reported={...row,answers:{v:'cc',j:'قطاع خاص (يشترط راتب معتمد)',s:'من 6,000 إلى أقل من 10,000 ريال',t:'خلال شهرين',o:'أقل من 3000 ريال، من 3000 إلى 6000 ريال',b:'البلاد'}};
 assert.equal(await profile.saveMarketingFormProfile(leadId,reported,false),true);
 assert.equal(db.current.salary_bank,'البلاد');assert.equal(db.current.salary,undefined);assert.equal(db.current.obligation,undefined);
 for(const key of ['j','t'])assert.ok(db.current.notes.includes(reported.answers[key]));
 for(const key of ['s','o'])assert.ok(!db.current.notes.includes(reported.answers[key]));
 assert.equal(db.current.extra_data.mzj_form_salary_range,reported.answers.s);
 assert.equal(db.current.extra_data.mzj_form_obligation_range,reported.answers.o);
 assert.equal(mapping.financeProfileValue(null,db.current.extra_data,'salary'),reported.answers.s);
 assert.equal(mapping.financeProfileValue(8000,db.current.extra_data,'salary'),8000);
 assert.equal(mapping.hasFinanceProfileRange(db.current),true);
 assert.equal(mapping.hasFinanceProfileRange({salary:7000,obligation:0}),false);
 assert.equal(mapping.hasFinanceProfileRange({salary:7000,obligation:null,extra_data:{mzj_form_obligation_range:reported.answers.o}}),true);
 assert.equal(db.current.assigned_to,'rep');assert.equal(db.current.department_code,'finance_sales');
 const recoveredSnapshot=structuredClone(db);
 assert.equal(await profile.saveMarketingFormProfile(leadId,reported,false),true);
 assert.deepEqual(db,recoveredSnapshot);
 // Legacy linked lead: move only the generated lines, once; preserve manual notes.
 const oldAnswers=parse(reported.answers,reported.answer_labels).filter(a=>['salary','obligation','notes'].includes(a.field));
 const oldNote=profile.formProfileNote(oldAnswers,reported.created_at);
 fresh({same_submission:true,notes:'[قديم] ملاحظة المندوب\n\n'+oldNote+'\n\n[لاحق] ملاحظة أخرى',extra_data:{other:'keep'},credit_limit:1200,credit_qualified:true});
 db.events.push({formLeadId:reported.id});
 await profile.saveMarketingFormProfile(leadId,reported,false);
 assert.equal(db.current.extra_data.mzj_form_salary_range,reported.answers.s);
 assert.equal(db.current.extra_data.mzj_form_obligation_range,reported.answers.o);
 assert.equal(db.current.extra_data.other,'keep');assert.equal(db.current.credit_limit,null);assert.equal(db.current.credit_qualified,null);
 assert.equal(db.current.notes,'[قديم] ملاحظة المندوب\n\n'+profile.formProfileNote(oldAnswers.filter(a=>a.field==='notes'),reported.created_at)+'\n\n[لاحق] ملاحظة أخرى');
 assert.equal(db.events.length,1);assert.equal(db.events[0].financeRangesVersion,2);
 // A representative's later explicit change or clear must not be undone by re-sync.
 delete db.current.extra_data.mzj_form_salary_range;db.current.salary=8500;
 const edited=structuredClone(db);await profile.saveMarketingFormProfile(leadId,reported,false);assert.deepEqual(db,edited);
 fresh({same_submission:true,salary:9000,notes:oldNote});db.events.push({formLeadId:reported.id});
 await profile.saveMarketingFormProfile(leadId,reported,false);assert.equal(db.current.salary,9000);assert.ok(db.current.notes.includes(reported.answers.s));assert.ok(!db.current.notes.includes(reported.answers.o));
 const parsed=parse({x:'1000',y:'بنك الرياض',z:'4000'},{x:'سؤال مخصص',y:'اسم البنك',z:'راتبك'},{x:'salary',y:'notes',z:'salary'});
 const plan=profile.planFormProfile(parsed,{},true);
 assert.equal(plan.fields.salary,1000);assert.deepEqual(plan.notes.map(a=>a.id),['y','z']);
 console.log('PASS profile writes, original notes, numeric zero, exact text/ranges, manual edits, retry dedupe, transaction rollback and safe existing-lead enrichment');
 const bridge=fs.readFileSync(path.join(root,'server/marketing/lead-forms-crm.ts'),'utf8');
 assert.ok(bridge.indexOf('await saveMarketingFormProfile(crmLeadId,row,!result.existedBefore);')<bridge.indexOf('const crmStatus = result.existedBefore'));
 const handler=fs.readFileSync(path.join(root,'server/marketing/lead-forms.ts'),'utf8');
 assert.match(handler,/answerCrmFields\[field.id\]=resolveFormCrmField\(field.id,field.label,field.crmField\)/);
 assert.match(handler,/sql\.json\(answerCrmFields\)/);
 assert.match(handler,/sanitizeFormCrmField\(\(f as any\).crmField\)/);
 const schema=fs.readFileSync(path.join(root,'server/_marketing-lead-forms-schema.ts'),'utf8');
 assert.equal((schema.match(/count\(\*\)=6/g)||[]).length,2);assert.match(schema,/add column if not exists answer_crm_fields jsonb/);
 console.log('PASS published mapping snapshot, runtime schema upgrade, profile before CRM status, no routing changes');
})().catch(e=>{console.error(e);process.exitCode=1;});
