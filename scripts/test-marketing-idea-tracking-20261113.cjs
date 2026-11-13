'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const source=fs.readFileSync('shared/marketing-idea-identity.ts','utf8');
const compiled=ts.transpileModule(source,{fileName:'marketing-idea-identity.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exported={};vm.runInNewContext(compiled,{exports:exported,console});
const {strategyCodeMap,calculateIdeaTracking}=exported;
const marker={source:'mzj-content-strategy',planId:'plan-1',ideaCodes:['V01','I02'],clientKeys:['a','b','c'],itemIdeaCodes:['V01','V01','I02']};
const items=[
 {id:'1',client_key:'a',idea_name:'فيديو عن المحرك',sort_order:0,status:'submitted',delivery_mode:'drive_link',in_agenda:false,in_campaign:false},
 {id:'2',client_key:'b',idea_name:'فيديو عن المحرك',sort_order:1,status:'approved',delivery_mode:'files',in_agenda:true,in_campaign:false},
 {id:'3',client_key:'c',idea_name:'صورة عن البنزين',sort_order:2,status:'approved',delivery_mode:'files',in_agenda:true,in_campaign:true},
];
const map=strategyCodeMap(marker,items);assert.equal(map.get('1'),'V01');assert.equal(map.get('2'),'V01');assert.equal(map.get('3'),'I02');
const actual=calculateIdeaTracking('task-1','TSK-000168','2026-11-12',marker,items);
assert.equal(actual.assignment,2);assert.equal(actual.execution,2);assert.equal(actual.executionPercent,100);
assert.equal(actual.publishing,2);assert.equal(actual.publishingPercent,100);assert.equal(actual.funding,1);assert.equal(actual.fundingPercent,50);
// Photographer and editor count once; same idea in multiple agenda/campaign rows is already collapsed by SQL EXISTS.
const historical={source:'mzj-content-strategy',planId:'plan-1',ideaCodes:['V01','I02'],clientKeys:['a','b','c']};
const historicalMapping=strategyCodeMap(historical,items);
assert.equal(historicalMapping.get('2'),'V01');assert.equal(historicalMapping.get('3'),'I02');
const ambiguous=items.map(x=>({...x,idea_name:'مشترك'}));
assert.equal(strategyCodeMap(historical,ambiguous).size,0,'Ambiguous historical names must never invent an idea identity');
const partial=[...items];partial[1]={...partial[1],status:'revision'};
assert.equal(calculateIdeaTracking('task','TASK','2026-11-11',marker,partial).execution,1,'Executions only count approved production items');
const api=fs.readFileSync('server/marketing/workflow.ts','utf8');
const page=fs.readFileSync('src/marketing/pages/MarketingIdeaTrackingPage.tsx','utf8');
const nav=fs.readFileSync('src/marketing/MarketingLayout.tsx','utf8');
const plan=fs.readFileSync('src/marketing/workflow/PlanDetail.tsx','utf8');
assert(api.includes("resource === 'work_marketing_tracking'"));
assert(api.includes('itemIdeaCodes: input.items.map'));
assert(api.includes('strategyProductIdentities(sql'));
assert(api.includes("p.kind='agenda'")&&api.includes("p.kind='campaign'"));
assert(page.includes('التنفيذ')&&page.includes('النشر')&&page.includes('التمويل'));
assert(!page.includes('إضافة تراكينج'));
assert(nav.includes('التراكينج') && nav.includes('marketing.idea_tracking.view'));
assert(page.includes('title="التراكينج"'));
assert(fs.readFileSync('src/marketing/marketing-tracking.css','utf8').includes('color:#fff'));
assert(fs.readFileSync('src/App.tsx','utf8').includes('permission="marketing.idea_tracking.view"'));
assert(fs.readFileSync('server/_api-permissions.ts','utf8').includes('work_marketing_tracking: "marketing.idea_tracking.view"')); 
assert(plan.includes('productChoiceLabel(item)'));
assert(fs.readFileSync('src/marketing/workflow/CreatePage.tsx','utf8').includes('productChoiceLabel(candidate)'));
// Execute the production read-only projection with mocked PostgreSQL rows,
// exercising its real SQL shape and permission/date guard without touching a DB.
const begin=api.indexOf('async function marketingIdeaTracking('),end=api.indexOf('\nasync function products(',begin);
assert(begin>=0&&end>begin);
const fnSource=api.slice(begin,end)+'\nglobalThis.__trackingTest=marketingIdeaTracking;';
const compiledTracking=ts.transpileModule(fnSource,{fileName:'tracking-sql.ts',compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
const ctx={console,calculateIdeaTracking,requirePermission:(_,p)=>{if(p!=='marketing.idea_tracking.view')throw Error('Denied');},isManager:()=>true,
  isWorkDate:value=>/^\d{4}-\d{2}-\d{2}$/.test(value),
  text:(value,max)=>String(value??'').slice(0,max).trim(),W:{denied:'Denied',invalid:'Invalid'}};
vm.createContext(ctx);vm.runInContext(compiledTracking,ctx);
(async()=>{
  let calls=0;
  const sql=(strings,...params)=>{
    calls++;
    const query=strings.join('?');
    for(const fragment of ["h.action='strategy_assigned'","p.kind='agenda'","p.kind='campaign'",'t.is_deleted=false','t.created_by'])
      assert(query.includes(fragment),`Automatic tracking must enforce ${fragment}`);
    assert(params.some(value=>value==='2026-11-01'));
    return items.map(entry=>({...entry,task_id:'task-1',task_no:'TSK-000168',created_at:'2026-11-12',source:marker}));
  };
  const result=await ctx.__trackingTest(sql,{id:'user-1'},{from:'2026-11-01',to:'2026-11-30'});
  assert.equal(calls,1,'One read-only projection query per request');
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].assignment,2);
  assert.equal(result.rows[0].fundingPercent,50);
  await assert.rejects(()=>ctx.__trackingTest(sql,{id:'user-1'},{from:'2026-12-31',to:'2026-11-01'}),/Invalid/);
  ctx.requirePermission=()=>{throw Error('Denied');};
  await assert.rejects(()=>ctx.__trackingTest(sql,{id:'user-1'},{}),/Denied/,'Permission must be checked on the server');
  console.log('PASS: task/idea code tracking SQL projection, permission/date checks, counts and plans are read-only.');
})().catch(error=>{console.error(error);process.exitCode=1;});
console.log('PASS: stable strategy idea codes, historical linkage, unique per-stage counts, product details and automatic read-only tracking.');
