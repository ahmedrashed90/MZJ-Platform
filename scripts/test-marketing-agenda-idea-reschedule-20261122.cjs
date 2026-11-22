'use strict';
/** Regression for approved 36-idea agenda scheduling, 316 platform rows,
 * product order/funding reconciliation, and sticky tracking headings. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let ts;
try { ts = require('typescript'); }
catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root,'server/marketing/agenda-idea-schedule.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: 'agenda-idea-schedule.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
});
assert.equal(compiled.diagnostics.filter(error=>error.category===ts.DiagnosticCategory.Error).length,0,'backend TypeScript parses');
const mod = { exports: {} };
const mockPermissions = { allowed: true };
function validDate(str) {
  if(!/^\d{4}-\d\d-\d\d$/.test(str)) return false;
  const date = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(str);
}
vm.runInNewContext(compiled.outputText, {
  module: mod, exports: mod.exports,
  require: name => name.includes('system-access') ? {hasPermission:()=>mockPermissions.allowed} :
    name.includes('workflow-labels') ? { W:{invalid:'invalid',denied:'denied',notFound:'not found'} } :
    name.includes('marketing-workflow') ? {isWorkDate:validDate} : (()=>{throw Error(name)})(),
});
const { summarizeAgendaIdeas, validateAgendaIdeaChanges, getAgendaIdeaSchedule, saveAgendaIdeaSchedule } = mod.exports;
const user = {id:'user-a',fullName:'Tester'};
const plan = {id:'plan-a',created_by:'user-a',kind:'agenda',review_status:'publishing',is_deleted:false,plan_no:'AGD-000037'};
const rows = [];
for (let i=0; i<36; i++) {
  const code = `IDEA-${String(i+1).padStart(3,'0')}`;
  const count = i < 28 ? 9 : 8;
  for(let j=0;j<count;j++) rows.push({
    line_id:`line-${i}-${j}`, product_id:`item-${i}`,post_type_id:`type-${j}`,
    idea_code:code,idea_name:`Idea ${i+1}`,scheduled_on:'2026-12-01',
    blocked_target_count:0,platform_name:['Meta','TikTok','Snapchat','YouTube'][j%4],
  });
}
let passed=0;
function ok(label,fn){ fn(); passed++; console.log('PASS:',label); }
async function test(label,fn){ await fn(); passed++; console.log('PASS:',label); }
const summary = summarizeAgendaIdeas(rows);
ok('36 distinct ideas across 316 actual platform/format rows',()=>{
  assert.equal(summary.ideas.length,36);assert.equal(summary.totalPosts,316);assert.equal(summary.unmappedPosts,0);
  assert.equal(summary.ideas.reduce((sum,idea)=>sum+idea.postCount,0),316);
});
ok('all rows share a stable idea code, not the visible title',()=>{
  assert.equal(summary.ideas[0].postCount,9);
  assert.equal(summary.ideas[35].postCount,8);
  assert.equal(summary.ideas[0].platforms.length,4);
});
ok('missing identity is surfaced, never silently assigned a guessed idea',()=>{
  const unlinked=summarizeAgendaIdeas([...rows,{...rows[0],line_id:'missing',idea_code:''}]);
  assert.equal(unlinked.unmappedPosts,1);assert.equal(unlinked.totalPosts,317);
});
ok('already published or externally scheduled posts block the entire idea',()=>{
  const locked=summarizeAgendaIdeas([...rows.slice(0,1).map(x=>({...x,blocked_target_count:1})),...rows.slice(1)]);
  assert.equal(locked.ideas[0].blockedPosts,1);
});
ok('invalid dates and duplicate change codes are rejected',()=>{
  assert.throws(()=>validateAgendaIdeaChanges([{ideaCode:'A',date:'2026-02-30',expectedDates:[]}]),/invalid/);
  assert.throws(()=>validateAgendaIdeaChanges([{ideaCode:'A',date:'2026-12-10',expectedDates:[]},{ideaCode:'A',date:'2026-12-11',expectedDates:[]}]),/invalid/);
});
ok('one valid change covers all original dates, without platform input',()=>{
  const values=validateAgendaIdeaChanges([{ideaCode:'IDEA-001',date:'2026-12-15',expectedDates:['2026-12-01']}]);
  assert.equal(values.length,1); assert.equal(values[0].ideaCode,'IDEA-001');
});
function mockDb(overrides={}){
  const events=[];
  const currentRows=overrides.rows || rows;
  function tx(parts,...values){
    const sql=parts.join('?').replace(/\s+/g,' ').trim(); events.push({sql,values});
    if(sql.startsWith('select id::text,created_by::text')) return Promise.resolve([overrides.plan || plan]);
    if(sql.startsWith('select id::text,product_id::text')) return Promise.resolve(currentRows.map(x=>({id:x.line_id,product_id:x.product_id,post_type_id:x.post_type_id,scheduled_on:x.scheduled_on})));
    if(sql.startsWith('select l.id::text as line_id,l.product_id::text')) return Promise.resolve(currentRows);
    if(sql.startsWith('select target.line_id::text')) return Promise.resolve(overrides.targets || []);
    return Promise.resolve([]);
  }
  tx.json=value=>value;
  tx.begin=async function(fn){return fn(tx)};
  return {tx,events};
}
(async()=>{
  await test('read endpoint summarizes all 316 posts in one agenda',async()=>{
    const db=mockDb();const result=await getAgendaIdeaSchedule(db.tx,user,'12e7bc40-5aac-4303-9122-d08e400630fa',true);
    assert.equal(result.totalPosts,316);assert.equal(result.ideas.length,36);
  });
  await test('single idea date update touches every related row and queued publication record',async()=>{
    const db=mockDb(); const result=await saveAgendaIdeaSchedule(db.tx,user,'12e7bc40-5aac-4303-9122-d08e400630fa',false,[
      {ideaCode:'IDEA-001',date:'2026-12-15',expectedDates:['2026-12-01']},
    ]);
    assert.equal(result.updatedIdeas,1);assert.equal(result.updatedPosts,9);
    const updates=db.events.filter(e=>e.sql.startsWith('update marketing.work_plan_items set scheduled_on'));
    assert.equal(updates.length,1);assert.equal(updates[0].values[0].length,9);
    assert.ok(db.events.some(e=>e.sql.startsWith('update marketing.publish_schedule schedule set publish_date')));
    assert.ok(db.events.some(e=>e.sql.startsWith('update marketing.creatives creative set schedule_day')));
    assert.ok(db.events.some(e=>e.sql.startsWith('update marketing.strategy_plan_draft_entries e set')));
    assert.ok(db.events.some(e=>e.sql.startsWith('insert into audit.activity_log')));
    assert.ok(db.events.some(e=>e.sql.startsWith('update marketing.agendas set publish_start')));
    assert.ok(!db.events.some(e=>/set review_status=/.test(e.sql)),'approved status stays intact');
  });
  await test('two distinct ideas update a total of 18 posts in one transaction',async()=>{
    const db=mockDb(); const result=await saveAgendaIdeaSchedule(db.tx,user,'12e7bc40-5aac-4303-9122-d08e400630fa',false,[
      {ideaCode:'IDEA-001',date:'2026-12-15',expectedDates:['2026-12-01']},
      {ideaCode:'IDEA-002',date:'2026-12-16',expectedDates:['2026-12-01']},
    ]);
    assert.equal(result.updatedPosts,18);assert.equal(result.updatedIdeas,2);
  });
  await test('all 36 ideas update 316 rows with a single batch per table and one audit record',async()=>{
    const db=mockDb();
    const changes=summary.ideas.map((idea,index)=>({ideaCode:idea.ideaCode,date:`2026-12-${String(index%20+5).padStart(2,'0')}`,expectedDates:idea.currentDates}));
    const result=await saveAgendaIdeaSchedule(db.tx,user,'12e7bc40-5aac-4303-9122-d08e400630fa',false,changes);
    assert.equal(result.updatedPosts,316);assert.equal(result.updatedIdeas,36);
    assert.equal(db.events.filter(e=>e.sql.startsWith('update marketing.work_plan_items set scheduled_on')).length,1);
    assert.equal(db.events.filter(e=>e.sql.startsWith('update marketing.strategy_plan_draft_entries e set')).length,1);
    assert.equal(db.events.filter(e=>e.sql.startsWith('update marketing.publish_schedule schedule set')).length,1);
    assert.equal(db.events.filter(e=>e.sql.startsWith('update marketing.creatives creative set')).length,1);
    assert.equal(db.events.filter(e=>e.sql.startsWith('insert into audit.activity_log')).length,1);
    assert.equal(db.events.find(e=>e.sql.startsWith('update marketing.work_plan_items set scheduled_on')).values[0].length,316);
  });
  await test('stale dates are refused before the first mutation',async()=>{
    const db=mockDb(); await assert.rejects(saveAgendaIdeaSchedule(db.tx,user,'12e7bc40-5aac-4303-9122-d08e400630fa',false,[
      {ideaCode:'IDEA-001',date:'2026-12-15',expectedDates:['2026-12-06']},
    ]),/changed since/);
    assert.equal(db.events.filter(x=>x.sql.startsWith('update ')).length,0);
  });
  await test('published links block modification even without a provider target',async()=>{
    const db=mockDb({rows:rows.map((row,i)=>i===0?{...row,manual_published_on:'2026-11-22'}:row)});
    await assert.rejects(saveAgendaIdeaSchedule(db.tx,user,'12e7bc40-5aac-4303-9122-d08e400630fa',false,[
      {ideaCode:'IDEA-001',date:'2026-12-15',expectedDates:['2026-12-01']},
    ]),/published/);
    assert.equal(db.events.filter(x=>x.sql.startsWith('update ')).length,0);
  });
  await test('externally queued posts cannot be rescheduled by a database-only change',async()=>{
    const db=mockDb({targets:[{line_id:'line-0-0',schedule_id:'a',status:'scheduled'}]});
    await assert.rejects(saveAgendaIdeaSchedule(db.tx,user,'12e7bc40-5aac-4303-9122-d08e400630fa',false,[
      {ideaCode:'IDEA-001',date:'2026-12-15',expectedDates:['2026-12-01']},
    ]),/externally/);
    assert.equal(db.events.filter(x=>x.sql.startsWith('update ')).length,0);
  });
  await test('role and identity restrictions protect an approved agenda',async()=>{
    const db=mockDb({plan:{...plan,created_by:'user-other'}});
    await assert.rejects(getAgendaIdeaSchedule(db.tx,user,'12e7bc40-5aac-4303-9122-d08e400630fa',false),/denied/);
    mockPermissions.allowed=false;
    await assert.rejects(getAgendaIdeaSchedule(db.tx,user,'12e7bc40-5aac-4303-9122-d08e400630fa',true),/denied/);
    mockPermissions.allowed=true;
  });
  await test('product listing retains agenda AND campaign code and funding date separately',async()=>{
    const source=fs.readFileSync(path.join(root,'server/marketing/strategy-drafts.ts'),'utf8');
    assert.match(source,/placementsByItem/);assert.match(source,/linkedByItem/);
    assert.match(source,/itemPlacements\.filter\(link => link\.kind === 'campaign'\)/);
    assert.match(source,/itemLinks\.filter\(link => link\.kind === 'agenda'\)/);
    assert.match(source,/orderRefs: orders/);
  });
  await test('both sticky tracking header rows have distinct vertical offsets',async()=>{
    const css=fs.readFileSync(path.join(root,'src/marketing/workflow/strategyDrafts.css'),'utf8');
    assert.match(css,/thea[d] tr:first-child th.*position:sticky; top:0/);
    assert.match(css,/thea[d] tr:nth-child\(2\) th.*position:sticky; top:45px/);
  });
  console.log(`${passed}/${passed} approved agenda and product tracking checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
