import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const root=new URL('../server/strategy-integration.ts',import.meta.url);
const workspace=await mkdtemp(join(tmpdir(),'mzj-strategy-api-test-'));
const queries=[];
let callCount=0;
const actor='a0000000-0000-4000-8000-000000000001';
const uuid=n=>`b0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const rows={stock:[{car_name:'Hyundai',statement:'Accent',model_year:'2026',exterior_color:'black',interior_color:'cream'}],
  executors:[{user_id:uuid(10),full_name:'Test User',department_id:uuid(11),department_name:'Marketing'}],
  types:[{id:uuid(20),name:'Basic Task'}],formats:[{id:uuid(30),name:'Image Post',width:1080,height:1080,platform_name:'Instagram',platform_code:'instagram'}]};
let usedReadOnly=false;
try {
  const source=await readFile(root,'utf8');
  const js=ts.transpileModule(source,{fileName:'strategy-integration.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const rewritten=js.replace(/from ['"](?:\.\.?\/)[^'"]+['"]/g,"from './mocks.mjs'");
  await writeFile(join(workspace,'handler.mjs'),rewritten);
  await writeFile(join(workspace,'package.json'),'{"type":"module"}');
  const mocks=`export const calls=[];\nexport let queries=[];\nlet readOnly=false;\nfunction tx(strings,...values){const q=strings.join(' ').toLowerCase();queries.push(q);if(q.includes('set transaction read only')){readOnly=true;return Promise.resolve([])}if(q.includes('set local'))return Promise.resolve([]);if(!readOnly)throw Error('Missing transaction read only');if(q.includes('from operations.vehicles'))return Promise.resolve(${JSON.stringify(rows.stock)});if(q.includes('from marketing.departments'))return Promise.resolve(${JSON.stringify(rows.executors)});if(q.includes('from marketing.campaign_types'))return Promise.resolve(${JSON.stringify(rows.types)});if(q.includes('from marketing.platform_post_types'))return Promise.resolve(${JSON.stringify(rows.formats)});if(q.includes('from marketing.work_tasks'))return Promise.resolve([]);if(q.includes('from marketing.work_items'))return Promise.resolve([]);return Promise.resolve([])}\ntx.begin=async callback=>{readOnly=false;return await callback(tx)};\nexport function getSql(){return tx};\nexport async function loadUserProfile(id){return id==='${actor}'?{id,fullName:'Test Manager'}:null};\nexport function hasPermission(){return true};\nexport function canAccessSystem(){return true};\nexport function supportsWorkMedia(kind,name){return kind==='image'||kind==='video'};\nexport function supportsWorkMediaOn(kind,name,date){return kind==='image'||kind==='video'};\nexport async function assertMarketingWorkflowReady(){};\nexport async function createStrategyWorkflowTask(sql,input,user){calls.push(input);return {ok:true,id:'${uuid(51)}',taskNo:'TSK-000051',items:input.items.map(item=>({id:'${uuid(52)}',client_key:item.clientKey}))}};\nexport async function listStrategyApprovedProducts(){return {ok:true,products:[]}};\nexport async function createStrategyWorkflowAgenda(sql,input,user){calls.push({agenda:input});return {ok:true,id:'${uuid(55)}',planNo:'AGD-000055',reviewStatus:'submitted'}};\nexport const placementCalls=[];\nexport async function validateStrategyPlacements(sql,placements){if(placements.some(p=>p.name==='CLOSED'))throw Error('Invalid placement: المسودة المختارة لم تعد مسودة');}\nexport async function applyStrategyPlacements(sql,user,input){placementCalls.push(input);return input.placements.map(p=>({id:'${uuid(60)}',kind:p.kind,name:p.name||'x',planNo:'AGD-000060'}))};\nexport async function deleteStrategyDraftFromIntegration(sql,id){return {ok:true,id,name:'أجندة ديسمبر'}};\nexport async function listOpenStrategyDrafts(){return {ok:true,ready:true,drafts:[{id:'${uuid(60)}',kind:'agenda',name:'أجندة ديسمبر',planNo:'AGD-000060',ideaCount:4}]}};\nexport function validAgendaUuid(value){return /^[0-9a-f-]{36}$/.test(value||'')};\nexport async function buildAgendaPublicationSnapshot(sql,id){return {ok:true,agenda:{id},entries:[{id:'one'}]}};\nexport async function streamApprovedAgendaMedia(sql,planId,fileId,response){return response.status(200).json({ok:true,planId,fileId,bytes:'test-binary'})};\n`;
  await writeFile(join(workspace,'mocks.mjs'),mocks);
  const {default:handler}=await import(pathToFileURL(join(workspace,'handler.mjs')));
  const mock=await import(pathToFileURL(join(workspace,'mocks.mjs')));
  process.env.MZJ_STRATEGY_READ_KEY='R'.repeat(48);
  process.env.MZJ_STRATEGY_ASSIGN_KEY='A'.repeat(48);
  process.env.MZJ_STRATEGY_INTEGRATION_USER_ID=actor;
  process.env.MZJ_STRATEGY_PUBLISH_SYNC_KEY='S'.repeat(48);
  async function req(method,resource,key='',body=undefined,query={}){
    const input={method,headers:{authorization:`Bearer ${key}`},query,body};
    let status=0,result;const output={setHeader(){return output},status(n){status=n;return output},json(x){result=x;return output}};
    await handler(input,output,resource);return {status,result};
  }
  let pub=await req('GET','publication-agenda',process.env.MZJ_STRATEGY_READ_KEY,undefined,{planId:uuid(55)});
  assert.equal(pub.status,401,'ordinary strategy read secret cannot fetch agenda publishing data');
  pub=await req('GET','publication-agenda',process.env.MZJ_STRATEGY_PUBLISH_SYNC_KEY,undefined,{planId:uuid(55)});
  assert.equal(pub.status,200);assert.equal(pub.result.agenda.id,uuid(55));
  pub=await req('GET','publication-file',process.env.MZJ_STRATEGY_PUBLISH_SYNC_KEY,undefined,{planId:uuid(55),fileId:uuid(61)});
  assert.equal(pub.status,200);assert.equal(pub.result.bytes,'test-binary');
  pub=await req('GET','publication-file',process.env.MZJ_STRATEGY_ASSIGN_KEY,undefined,{planId:uuid(55),fileId:uuid(61)});
  assert.equal(pub.status,401,'ordinary strategy assignment key cannot fetch media');
  let r=await req('GET','stock');assert.equal(r.status,401);
  r=await req('GET','stock',process.env.MZJ_STRATEGY_READ_KEY);assert.equal(r.status,200);
  assert.equal(r.result.cars.length,1);assert.deepEqual(Object.keys(r.result.cars[0]).sort(),['car_name','statement','model_year','exterior_color','interior_color'].sort());
  assert(mock.queries.some(q=>q.includes('set transaction read only')));
  const query=mock.queries.find(q=>q.includes('from operations.vehicles'));assert(query.includes('select distinct'));assert(!/\bvin\b|vehicle_id/.test(query));
  r=await req('GET','executors',process.env.MZJ_STRATEGY_READ_KEY);assert.equal(r.status,200);assert.equal(r.result.executors.length,1);
  r=await req('GET','catalog',process.env.MZJ_STRATEGY_READ_KEY);assert.equal(r.status,200);assert.equal(r.result.taskTypes.length,1);
  const payload={requestKey:uuid(1),typeId:uuid(20),name:'Strategy idea',source:{planId:'plan-test',ideaCodes:['V01']},items:[{clientKey:uuid(2),departmentId:uuid(11),assigneeId:uuid(10),mediaKind:'video',ideaName:'Idea',idea:'Full storyboard',explanation:'',dueOn:'2026-12-02',formatIds:[uuid(30)]}]};
  r=await req('POST','assignments',process.env.MZJ_STRATEGY_READ_KEY,payload);assert.equal(r.status,401);
  r=await req('POST','assignments',process.env.MZJ_STRATEGY_ASSIGN_KEY,payload);assert.equal(r.status,201);assert.equal(mock.calls.length,1);
  r=await req('POST','assignments',process.env.MZJ_STRATEGY_ASSIGN_KEY,{...payload,vehicles:[{vin:'SENSITIVE'}]});assert.equal(r.status,400);assert.equal(mock.calls.length,1);
  r=await req('POST','assignments',process.env.MZJ_STRATEGY_ASSIGN_KEY,{...payload,items:[{...payload.items[0],dueOn:'2026-02-31'}]});assert.equal(r.status,400);
  // A deliberate Clear must reach the real workflow, which validates the
  // selected employee against the database before inserting a nullable date.
  r=await req('POST','assignments',process.env.MZJ_STRATEGY_ASSIGN_KEY,{...payload,items:[{...payload.items[0],dueOn:''}]});
  assert.equal(r.status,201);assert.equal(mock.calls.at(-1).items[0].dueOn,'');
  for(const invalidDate of [null,undefined,' ','invalid']){
    r=await req('POST','assignments',process.env.MZJ_STRATEGY_ASSIGN_KEY,{...payload,items:[{...payload.items[0],dueOn:invalidDate}]});assert.equal(r.status,400);
  }
  r=await req('GET','agenda-products',process.env.MZJ_STRATEGY_READ_KEY);
  assert.equal(r.status,200);assert.deepEqual(r.result.products,[]);
  const agenda={requestKey:uuid(9),sourcePlanId:'plan-test',name:'Agenda',
    agendaFrom:'2026-12-10',agendaTo:'2026-12-20',
    entries:[{ideaCode:'V01',productId:uuid(52),date:'2026-12-11',
      platforms:[{platformId:uuid(53),postTypes:[{postTypeId:uuid(30),budget:0}]}]}]};
  r=await req('POST','agenda',process.env.MZJ_STRATEGY_READ_KEY,agenda);assert.equal(r.status,401);
  r=await req('POST','agenda',process.env.MZJ_STRATEGY_ASSIGN_KEY,agenda);assert.equal(r.status,201);
  assert.equal(mock.calls.at(-1).agenda.name,'Agenda');
  r=await req('POST','agenda',process.env.MZJ_STRATEGY_ASSIGN_KEY,{...agenda,other:'bad'});assert.equal(r.status,400);
  r=await req('POST','agenda',process.env.MZJ_STRATEGY_ASSIGN_KEY,{...agenda,entries:[{...agenda.entries[0],platforms:[{...agenda.entries[0].platforms[0],postTypes:[{postTypeId:uuid(30),budget:100}]}]}]});assert.equal(r.status,400);
  // Strategy flow: per-idea destination (agenda publish date / campaign funding date).
  r=await req('GET','plan-drafts',process.env.MZJ_STRATEGY_READ_KEY);assert.equal(r.status,200);assert.equal(r.result.drafts[0].name,'أجندة ديسمبر');
  r=await req('GET','plan-drafts');assert.equal(r.status,401);
  const placed={...payload,requestKey:uuid(3),items:[{...payload.items[0],clientKey:uuid(4),ideaCode:'V01'}],
    placements:[{ideaCode:'V01',kind:'agenda',name:'أجندة ديسمبر',date:'2026-12-01',category:'تعريفي - بالبراند'}]};
  r=await req('POST','assignments',process.env.MZJ_STRATEGY_ASSIGN_KEY,placed);assert.equal(r.status,201);
  assert.equal(mock.placementCalls.length,1);assert.equal(mock.placementCalls[0].placements[0].name,'أجندة ديسمبر');
  assert.equal(mock.placementCalls[0].itemIdeaCodes.get(uuid(4)),'V01');assert.equal(r.result.drafts.length,1);
  r=await req('POST','assignments',process.env.MZJ_STRATEGY_ASSIGN_KEY,{...placed,placements:[{ideaCode:'V01',kind:'campaign',draftId:uuid(60),date:'2026-12-20',category:''}]});assert.equal(r.status,201);
  // «مشتركة»: one idea may carry an agenda AND a campaign in the same assignment.
  r=await req('POST','assignments',process.env.MZJ_STRATEGY_ASSIGN_KEY,{...placed,placements:[
    {ideaCode:'V01',kind:'agenda',name:'أجندة ديسمبر',date:'2026-12-01',category:''},
    {ideaCode:'V01',kind:'campaign',name:'حملة ديسمبر',date:'2026-12-20',category:''}]});
  assert.equal(r.status,201,'agenda + campaign for the same idea is accepted');
  assert.equal(mock.placementCalls.at(-1).placements.length,2);
  assert.deepEqual(mock.placementCalls.at(-1).placements.map(p=>p.kind),['agenda','campaign']);
  // ...but never two destinations of the same kind for one idea.
  r=await req('POST','assignments',process.env.MZJ_STRATEGY_ASSIGN_KEY,{...placed,placements:[
    {ideaCode:'V01',kind:'agenda',name:'أجندة ديسمبر',date:'2026-12-01',category:''},
    {ideaCode:'V01',kind:'agenda',name:'أجندة يناير',date:'2026-12-02',category:''}]});
  assert.equal(r.status,400,'two agendas for the same idea stay rejected');
  const before=mock.calls.length;
  r=await req('POST','assignments',process.env.MZJ_STRATEGY_ASSIGN_KEY,{...placed,placements:[{ideaCode:'X99',kind:'agenda',name:'n',date:'2026-12-01',category:''}]});assert.equal(r.status,400);
  r=await req('POST','assignments',process.env.MZJ_STRATEGY_ASSIGN_KEY,{...placed,placements:[{ideaCode:'V01',kind:'agenda',name:'n',draftId:uuid(60),date:'2026-12-01',category:''}]});assert.equal(r.status,400);
  r=await req('POST','assignments',process.env.MZJ_STRATEGY_ASSIGN_KEY,{...placed,placements:[{ideaCode:'V01',kind:'other',name:'n',date:'2026-12-01',category:''}]});assert.equal(r.status,400);
  r=await req('POST','assignments',process.env.MZJ_STRATEGY_ASSIGN_KEY,{...placed,placements:[{ideaCode:'V01',kind:'agenda',name:'CLOSED',date:'2026-12-01',category:''}]});
  assert.equal(r.status,409);assert.equal(r.result.error,'المسودة المختارة لم تعد مسودة');
  assert.equal(mock.calls.length,before,'an invalid destination never creates a task');
  r=await req('POST','plan-drafts',process.env.MZJ_STRATEGY_ASSIGN_KEY,{draftId:uuid(60)});assert.equal(r.status,200);assert.equal(r.result.id,uuid(60));
  r=await req('POST','plan-drafts',process.env.MZJ_STRATEGY_READ_KEY,{draftId:uuid(60)});assert.equal(r.status,401);
  r=await req('POST','plan-drafts',process.env.MZJ_STRATEGY_ASSIGN_KEY,{draftId:'x',other:1});assert.equal(r.status,400);
  r=await req('DELETE','stock',process.env.MZJ_STRATEGY_ASSIGN_KEY);assert.equal(r.status,405);
  console.log('PASS: read-only SQL; exact 5 fields; API tokens scoped; assignment and agenda writes; strict payload validation; strategy draft placements');
} finally {await rm(workspace,{recursive:true,force:true});}
