/* Snapchat Pixel regression tests: validate calls to the real SDK handler, not its loading queue.
 * No API calls or CRM mutations are involved.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/marketing/lead-forms/pixel-tracking.ts');
const output = ts.transpileModule(fs.readFileSync(filename,'utf8'), {
  fileName: filename,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  reportDiagnostics:true,
});
assert.deepEqual((output.diagnostics||[]).filter(e=>e.category===ts.DiagnosticCategory.Error),[]);
const pixel='0013dd43-0c92-4403-bb53-1793e1f5d077';
const pixels={snapchat:{id:pixel,enabled:true},meta:{id:'',enabled:false},tiktok:{id:'',enabled:false}};
const flush=async()=>{for(let i=0;i<16;i++) await Promise.resolve();};
function harness(search='?utm_source=snapchat') {
  const scripts=[];const store=new Map();const received=[];
  const location={pathname:'/forms/mmzj-leed-2026',search};
  const window={location,localStorage:{
    getItem: k=>store.get(k)||null,
    setItem:(k,v)=>store.set(k,v),
    removeItem:k=>store.delete(k),
  }};
  const document={
    head:{appendChild:tag=>scripts.push(tag)},
    createElement:()=>({remove(){this.removed=true;}}),
  };
  const sandbox={exports:{},require:()=>{throw Error('Unexpected runtime import')},console,URL,URLSearchParams,Date,window,document};
  vm.runInNewContext(output.outputText,sandbox,{filename});
  const setHandler=()=>{window.snaptr.handleRequest=(...args)=>received.push(args);};
  const events=()=>received.filter(args=>args[0]==='track').map(args=>args[1]);
  return {mod:sandbox.exports,window,scripts,store,received,setHandler,events};
}
async function main(){
  // 1. SDK 200/metadata alone must not be confused with a delivered Page View.
  {
    const x=harness('?utm_source=chatgpt.com&ScTestModeId='+pixel);
    x.mod.startFormAdPixel('snapchat',pixels,'form','deny');
    assert.equal(x.scripts.length,0,'Privacy opt-out must prevent loading the SDK');
    x.mod.startFormAdPixel('snapchat',pixels,'form','allow');
    x.mod.startFormAdPixel('snapchat',pixels,'form','allow');
    assert.equal(x.scripts.length,1);
    assert.deepEqual(x.events(),[],'No event delivered before SDK readiness');
    assert.equal(x.window.snaptr.queue.length,0,'Do not rely on the SDK placeholder queue');
    assert.ok(x.store.get('_scTestEvent').startsWith(pixel+'|'));
    x.setHandler();
    x.scripts[0].onload();
    await flush();
    assert.deepEqual(x.events(),['PAGE_VIEW']);
    assert.deepEqual(x.received.filter(r=>r[0]==='init').map(r=>r[1]),[pixel]);
    x.mod.startFormAdPixel('snapchat',pixels,'form','allow');
    x.mod.trackStoredFormLead('snapchat',pixels,'allow',{id:'l1',created:true,crmStatus:'linked'});
    x.mod.trackStoredFormLead('snapchat',pixels,'allow',{id:'l1',created:true,crmStatus:'linked'});
    x.mod.trackStoredFormLead('snapchat',pixels,'allow',{id:'l2',created:false,crmStatus:'linked'});
    x.mod.trackStoredFormLead('snapchat',pixels,'allow',{id:'l3',created:true,crmStatus:'existing'});
    await flush();
    assert.deepEqual(x.events(),['PAGE_VIEW','SIGN_UP']);
  }
  // 2. Failed SDK download retries once and does not permanently suppress Page Views.
  {
    const x=harness();
    x.mod.startFormAdPixel('snapchat',pixels,'form','allow');
    x.scripts[0].onerror();
    await flush();
    assert.equal(x.scripts[0].removed,true);
    assert.equal(x.scripts.length,2,'One bounded SDK retry');
    assert.deepEqual(x.events(),[]);
    x.setHandler();
    x.scripts[1].onload();
    await flush();
    assert.deepEqual(x.events(),['PAGE_VIEW']);
  }
  // 3. If an SDK script has no event handler, retry rather than silently succeeding.
  {
    const x=harness();
    x.mod.startFormAdPixel('snapchat',pixels,'form','allow');
    x.scripts[0].onload();
    await flush();
    assert.equal(x.scripts.length,2);
    assert.deepEqual(x.events(),[]);
    x.setHandler();x.scripts[1].onload();
    await flush();
    assert.deepEqual(x.events(),['PAGE_VIEW']);
  }
  // 4. Consent can be withdrawn during asynchronous loading.
  {
    const x=harness();
    x.mod.startFormAdPixel('snapchat',pixels,'form','allow');
    x.mod.savePixelConsent('deny');
    x.setHandler();x.scripts[0].onload();
    await flush();
    assert.deepEqual(x.received,[],'Consent withdrawn: neither init nor track');
    x.mod.savePixelConsent('allow');
    x.mod.startFormAdPixel('snapchat',pixels,'form','allow');
    await flush();
    assert.deepEqual(x.events(),['PAGE_VIEW']);
  }
  // 5. A new test URL should fire anew; never use an obsolete URL after pending load.
  {
    const x=harness('?utm_source=snapchat&ScTestModeId=11111111-1111-4111-8111-111111111111');
    x.mod.startFormAdPixel('snapchat',pixels,'form','allow');
    x.window.location.search='?utm_source=snapchat&ScTestModeId=22222222-2222-4222-8222-222222222222';
    x.mod.startFormAdPixel('snapchat',pixels,'form','allow');
    x.setHandler();x.scripts[0].onload();
    await flush();
    assert.deepEqual(x.events(),['PAGE_VIEW'],'Only the current URL should be tracked');
    assert.ok(x.store.get('_scTestEvent').startsWith('22222222-'));
    x.window.location.search='?utm_source=snapchat';
    x.mod.startFormAdPixel('snapchat',pixels,'form','allow');
    await flush();
    assert.deepEqual(x.events(),['PAGE_VIEW','PAGE_VIEW']);
    assert.equal(x.store.has('_scTestEvent'),false,'Production URL has no stale testing marker');
  }
  // 6. Submit may complete before the SDK has finished loading, but SIGN_UP still fires once.
  {
    const x=harness();
    x.mod.startFormAdPixel('snapchat',pixels,'form','allow');
    x.mod.trackStoredFormLead('snapchat',pixels,'allow',{id:'lead-new',created:true,crmStatus:'linked'});
    assert.deepEqual(x.events(),[]);
    x.setHandler();x.scripts[0].onload();
    await flush();
    assert.deepEqual(x.events(),['PAGE_VIEW','SIGN_UP']);
    assert.equal(x.scripts.length,1);
  }
  console.log('PASS: Snapchat SDK lifecycle (6 cases: ready handler, retry, missing handler, consent withdrawal, route/test change, early successful submit)');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
