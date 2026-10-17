// Tests executable production functions with in-memory SQL stubs. No live DB writes.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = fs.readFileSync('server/marketing/index.ts', 'utf8');
const page = fs.readFileSync('src/marketing/pages/StockPage.tsx', 'utf8');
const css = fs.readFileSync('src/marketing/marketing.css', 'utf8');
let tests = 0;
function check(title, callback) {
  return Promise.resolve().then(callback).then(() => { ++tests; console.log('PASS:', title); });
}
function extractFunction(file, name, isTsx = false) {
  const parsed = ts.createSourceFile(name + (isTsx ? '.tsx' : '.ts'), file, ts.ScriptTarget.Latest, true, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let sourceText = null;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) sourceText = node.getText(parsed);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert(sourceText, `${name} missing`);
  return ts.transpileModule(sourceText, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
}
const createPhotoRequest = new Function('arrayValue','clean','isoDate','dbJson',extractFunction(source,'createPhotoRequest')+'\nreturn createPhotoRequest;')(
  x=>Array.isArray(x)?x:[],
  x=>String(x??'').trim(),
  x=>/^\d{4}-\d\d-\d\d$/.test(String(x))?String(x):'',
  x=>JSON.parse(JSON.stringify(x))
);
const uid = num => `00000000-0000-4000-8000-${String(num).padStart(12,'0')}`;
const cars = Array.from({length:5},(_,i)=>({id:uid(i+1),vin:`VIN-${i+1}`,location_id:uid(i%3+100),status_code:'available_for_sale',location_code:'MAIN',branch_code:'BRANCH',vehicle_id_text:uid(i+1)}));
function mockDb({blocks=[]}={}) {
  const actions=[];
  const sql=(strings,...values)=>{
    if(Array.isArray(strings)&&!Object.hasOwn(strings,'raw')) return strings;
    const query=strings.join('?').replace(/\s+/g,' ');
    actions.push({query,values});
    if(query.includes('select id::text,code,name,branch_code from operations.locations'))return [{id:uid(100),code:'STUDIO',name:'Studio',branch_code:'BRANCH'}];
    if(query.includes('select v.*,v.id::text as vehicle_id_text'))return cars;
    if(query.includes('select distinct on (rv.vehicle_id)'))return blocks;
    if(query.includes("nextval('operations.transfer_request_no_seq')"))return [{n:12}];
    if(query.includes('insert into operations.transfer_requests('))return [{id:uid(600),status:'created'}];
    if(query.includes('insert into operations.transfer_request_vehicles('))return [];
    if(query.includes('insert into operations.transfer_request_events('))return [];
    throw Error('Unexpected SQL: '+query);
  };
  sql.begin=fn=>fn(sql); sql.json=x=>x;
  return {sql,actions};
}
const user={id:uid(98),fullName:'User',roles:['admin'],branches:['BRANCH']};
const body={vehicles:cars.map((v,i)=>({vehicleId:v.id,note:`note-${i}`})),destinationLocationId:uid(100),photographyDate:'2026-10-18',note:'Photo request'};
(async()=>{
  await check('Bulk picker adds more than two VINs in one action',()=>{
    const fn=extractFunction(page,'addCarsByVin',true);
    const selectedCars=[{id:'first',vin:'FIRST'}];
    const rows=[...['VIN-B','VIN-C','VIN-D','VIN-E'].map((vin,i)=>({id:String(i),vin,active_transfer_requests:0})),{id:'blocked',vin:'BLOCKED',active_transfer_requests:1,active_request_details:[{requestNo:'TR-222',requestKind:'transfer',status:'created'}]}];
    let result=[],warning='',remaining='';
    const testFn=new Function('vinBatch','stockRows','selectedCars','blockingRequestDescription','setRequestError','setVinBatch','setSelectedCars',fn+'\nreturn addCarsByVin;')(
      'VIN-B VIN-C, VIN-D\nVIN-E; BLOCKED\nNOT-FOUND',rows,selectedCars,()=>'طلب نقل TR-222',v=>warning=v,v=>remaining=v,updater=>result=updater(selectedCars));
    testFn();
    assert.equal(result.length,5);
    assert(warning.includes('NOT-FOUND'));
    assert(warning.includes('TR-222'));
    assert(remaining.includes('BLOCKED'));
  });
  await check('Server creates one request with five different VINs and source locations',async()=>{
    const db=mockDb();
    const result=await createPhotoRequest(db.sql,body,user);
    assert.equal(result.ok,true);
    assert.equal(db.actions.filter(a=>a.query.includes('insert into operations.transfer_request_vehicles(')).length,5);
    assert.equal(db.actions.filter(a=>a.query.includes('select v.*,v.id::text as vehicle_id_text')).length,1);
    assert.equal(db.actions.filter(a=>a.query.includes('select distinct on (rv.vehicle_id)')).length,1);
    assert.equal(db.actions.filter(a=>a.query.includes('insert into operations.transfer_requests(')).length,1);
    assert.equal(db.actions.filter(a=>a.query.includes('insert into operations.transfer_request_events(')).length,1);
  });
  await check('A real active transport request still blocks creation with its number',async()=>{
    const db=mockDb({blocks:[{vehicle_id:cars[2].id,request_no:'TR-777',request_kind:'transfer',status:'vehicle_sent'}]});
    await assert.rejects(()=>createPhotoRequest(db.sql,body,user),e=>e.message.includes('TR-777')&&e.message.includes('طلب نقل')&&e.message.includes('VIN-3'));
    assert.equal(db.actions.filter(a=>a.query.includes('insert into operations.transfer_requests(')).length,0);
  });
  await check('Duplicate VIN IDs are rejected before any database write',async()=>{
    const db=mockDb();
    await assert.rejects(()=>createPhotoRequest(db.sql,{...body,vehicles:[body.vehicles[0],body.vehicles[0]]},user),/أكثر من مرة/);
    assert.equal(db.actions.length,0);
  });
  await check('Create failure from API stays visible in the photo-request dialog', async()=>{
    let modalError='',busy=false;
    const fn=extractFunction(page,'createRequest',true);
    const runner=new Function('selectedCars','destinationLocationId','photographyDate','blockedSelectedCars','setBusy','setRequestError','setMessage','marketingFetch','setPageTab','setRequestTab','load','resetRequest','notes','requestNote','blockingRequestDescription',fn+'\nreturn createRequest;')(
      [cars[0],cars[1],cars[2]],uid(100),'2026-10-18',[],value=>busy=value,value=>modalError=value,()=>{},async()=>{throw Error('Test database failure')},()=>{},()=>{},async()=>{},()=>{},{} ,'',()=>'' );
    await runner();
    assert.equal(modalError,'Test database failure');
    assert.equal(busy,false);
  });
  await check('Stock query gives active request kind, number, and status, not anonymous count',()=>{
    assert(source.includes("'requestNo',r.request_no")&&source.includes("'requestKind',r.request_kind")&&source.includes("'status',r.status"));
    assert(source.includes("r.is_deleted=false and r.cancelled_at is null and r.status<>'completed'"));
  });
  await check('Creation errors are inside modal footer and follow-up errors inside detail modal',()=>{
    assert(page.includes('className="operations-alert error marketing-photo-dialog-error"'));
    assert(page.includes('setRequestError(failure instanceof Error ? failure.message : "تعذر إنشاء طلب التصوير")'));
    assert(page.includes('setFollowupError(failure instanceof Error ? failure.message : "تعذر إنهاء طلب التصوير")'));
    assert(css.includes('.marketing-photo-request-modal .mzj-modal-footer'));
  });
  await check('Old operations screens and logic are outside of this change',()=>{
    assert(!page.includes('setPageTab("operations")'));
    assert(page.includes('blockingRequestDescription(row)'));
    assert(page.includes('refreshRequestLocks()'));
  });
  console.log(`${tests}/${tests} stock photography tests passed (mocked SQL + extracted UI logic; no live database).`);
})().catch(error=>{console.error(error);process.exitCode=1});
