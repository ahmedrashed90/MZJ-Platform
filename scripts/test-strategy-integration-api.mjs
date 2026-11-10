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
  const mocks=`export const calls=[];\nexport let queries=[];\nlet readOnly=false;\nfunction tx(strings,...values){const q=strings.join(' ').toLowerCase();queries.push(q);if(q.includes('set transaction read only')){readOnly=true;return Promise.resolve([])}if(q.includes('set local'))return Promise.resolve([]);if(!readOnly)throw Error('Missing transaction read only');if(q.includes('from operations.vehicles'))return Promise.resolve(${JSON.stringify(rows.stock)});if(q.includes('from marketing.departments'))return Promise.resolve(${JSON.stringify(rows.executors)});if(q.includes('from marketing.campaign_types'))return Promise.resolve(${JSON.stringify(rows.types)});if(q.includes('from marketing.platform_post_types'))return Promise.resolve(${JSON.stringify(rows.formats)});if(q.includes('from marketing.work_tasks'))return Promise.resolve([]);if(q.includes('from marketing.work_items'))return Promise.resolve([]);return Promise.resolve([])}\ntx.begin=async callback=>{readOnly=false;return await callback(tx)};\nexport function getSql(){return tx};\nexport async function loadUserProfile(id){return id==='${actor}'?{id,fullName:'Test Manager'}:null};\nexport function hasPermission(){return true};\nexport function canAccessSystem(){return true};\nexport function supportsWorkMedia(kind,name){return kind==='image'||kind==='video'};\nexport async function assertMarketingWorkflowReady(){};\nexport async function createStrategyWorkflowTask(sql,input,user){calls.push(input);return {ok:true,id:'${uuid(51)}',taskNo:'TSK-000051',items:input.items.map(item=>({id:'${uuid(52)}',client_key:item.clientKey}))}};\n`;
  await writeFile(join(workspace,'mocks.mjs'),mocks);
  const {default:handler}=await import(pathToFileURL(join(workspace,'handler.mjs')));
  const mock=await import(pathToFileURL(join(workspace,'mocks.mjs')));
  process.env.MZJ_STRATEGY_READ_KEY='R'.repeat(48);
  process.env.MZJ_STRATEGY_ASSIGN_KEY='A'.repeat(48);
  process.env.MZJ_STRATEGY_INTEGRATION_USER_ID=actor;
  async function req(method,resource,key='',body=undefined,query={}){
    const input={method,headers:{authorization:`Bearer ${key}`},query,body};
    let status=0,result;const output={setHeader(){return output},status(n){status=n;return output},json(x){result=x;return output}};
    await handler(input,output,resource);return {status,result};
  }
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
  r=await req('DELETE','stock',process.env.MZJ_STRATEGY_ASSIGN_KEY);assert.equal(r.status,405);
  console.log('PASS: read-only SQL; exact 5 fields; API tokens scoped; assignment-only writes; strict payload validation');
} finally {await rm(workspace,{recursive:true,force:true});}
