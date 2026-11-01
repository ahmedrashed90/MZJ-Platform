'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync('server/marketing/workflow.ts','utf8');
const a=source.indexOf('async function changePlanReview(');
const b=source.indexOf('\nasync function updatePlanRows(',a);
assert.ok(a>=0 && b>a,'Server review handler exists');
const code=ts.transpileModule(`${source.slice(a,b)}\nexports.review=changePlanReview;`,{fileName:'marketing-workflow.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const out={};
vm.runInNewContext(code,{exports:out,id:x=>String(x),text:(v,max)=>String(v??'').slice(0,max),W:{saved:'saved',denied:'denied',invalid:'invalid',notFound:'notFound'},canReviewPlan:()=>true,planLines:async()=>[{id:'line'}]});
const user={id:'user-uuid',fullName:'مراجع الشركة'};
let checks=0;
const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log('PASS '+label)};
async function scenario(body){
 const queries=[];
 const query=async function(parts,...params){
  const s=parts.join('?').replace(/\s+/g,' ').trim(); queries.push({s,params});
  if(s.includes('select * from marketing.work_plans'))return [{id:'plan-uuid',review_status:'submitted',created_by:'different-user',activated_at:null,review_note:''}];
  if(s.includes('select id from marketing.work_review_categories'))return [{id:'existing-category'}];
  return [];
 };
 query.begin=async fn=>fn(query);
 const response=await out.review(query,user,{planId:'plan-uuid',decision:'revision',note:'تعديل المحتوى',...body});
 check(response.ok===true,'Reviewer action succeeds');
 const update=queries.find(x=>x.s.startsWith('update marketing.work_plans'));
 const insert=queries.find(x=>x.s.startsWith('insert into marketing.work_plan_reviews'));
 check(!!update&&!!insert,'Review note is written to both plan and immutable history');
 return {update,insert};
}
(async()=>{
 const custom=await scenario({categoryName:'ملاحظة عامة'});
 check(custom.update.params.some(v=>String(v).includes('نوع الملاحظة: ملاحظة عامة\nتعديل المحتوى')),'Typed category is preserved together with the review on the plan');
 check(custom.insert.params.some(v=>String(v).includes('نوع الملاحظة: ملاحظة عامة\nتعديل المحتوى')),'Typed category survives in historical review records');
 const empty=await scenario({});
 check(empty.insert.params.includes('تعديل المحتوى'),'No category selection is required for a free-form note');
 check(empty.insert.params.every(v=>!String(v).includes('نوع الملاحظة:')),'Free-form note without category has no injected prefix');
 const existing=await scenario({categoryId:'existing-category',categoryName:'نوع قائم'});
 check(existing.insert.params.includes('تعديل المحتوى'),'Existing predefined category remains supported without replacing the note text');
 check(existing.insert.params.includes('existing-category'),'Existing category ID remains stored and filterable');
 console.log(`Marketing plan free review server: ${checks}/${checks} tests passed`);
})().catch(err=>{console.error(err);process.exitCode=1});
