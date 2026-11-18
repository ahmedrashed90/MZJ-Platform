const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function transpiled(rel,context={}) {
  const src=fs.readFileSync(path.join(root,rel),'utf8');
  const transformed=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},fileName:rel,reportDiagnostics:true});
  const errors=(transformed.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0,rel+': '+errors.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join(', '));
  const exports={};const sandbox={exports,require:()=>{throw Error('Unexpected runtime import in '+rel)},console,URLSearchParams,URL,Date,...context};
  vm.runInNewContext(transformed.outputText,sandbox,{filename:rel});
  return sandbox.exports;
}
const shared=transpiled('shared/lead-form-pixels.ts');
let settings=shared.validateLeadFormPixels(shared.DEFAULT_LEAD_FORM_PIXELS);
assert.equal(settings.meta.enabled,false);
assert.equal(settings.snapchat.enabled,false);
assert.equal(settings.tiktok.enabled,false);
assert.equal(shared.getPublicLeadFormPixels(settings).meta.id,'');
settings={...settings,meta:{...settings.meta,enabled:true},snapchat:{...settings.snapchat,enabled:true},tiktok:{...settings.tiktok,enabled:true}};
assert.equal(shared.getPublicLeadFormPixels(settings).meta.id,'1635122171397100');
assert.throws(()=>shared.validateLeadFormPixels({...settings,meta:{enabled:true,id:'BAD'}}));
assert.throws(()=>shared.validateLeadFormPixels({...settings,meta:{enabled:true,id:''}}));
function mockedBrowser(){
  const scripts=[];const values={};
  const window={location:{pathname:'/forms/mymzj-form',search:'',reload(){},},localStorage:{getItem:k=>values[k]||null,setItem:(k,v)=>values[k]=v,removeItem:k=>delete values[k]}};
  const document={head:{appendChild:tag=>scripts.push(tag)},createElement:()=>({remove(){}})};
  return {window,document,scripts};
}
async function testPlatform(platform, expectedEvent, expectedScript){
  const {window,document,scripts}=mockedBrowser();
  const mod=transpiled('src/marketing/lead-forms/pixel-tracking.ts',{window,document});
  assert.equal(mod.detectFormAdPlatform('?utm_source=facebook',''), 'meta');
  assert.equal(mod.detectFormAdPlatform('?utm_source=instagram',''), 'meta');
  assert.equal(mod.detectFormAdPlatform('?utm_source=snapchat',''), 'snapchat');
  assert.equal(mod.detectFormAdPlatform('?utm_source=tiktok',''), 'tiktok');
  assert.equal(mod.detectFormAdPlatform('?utm_source=not_a_platform','https://l.facebook.com'), null);
  assert.equal(mod.detectFormAdPlatform('',''), null);
  assert.equal(mod.detectFormAdPlatform('?ttclid=x',''), 'tiktok');
  assert.equal(mod.detectFormAdPlatform('?ScCid=x',''), 'snapchat');
  // Link previewers can replace utm_source. A known MZJ campaign/test marker
  // must still select the correct Pixel, but an unknown visit must stay off.
  assert.equal(mod.detectFormAdPlatform('?utm_source=chatgpt.com&utm_campaign=MZJ_TIKTOK_PIXEL_TEST_20261104',''), 'tiktok');
  assert.equal(mod.detectFormAdPlatform('?utm_source=chatgpt.com&tt_test_id=DBLL5EBC77UASCMH46OG_123',''), 'tiktok');
  assert.equal(mod.detectFormAdPlatform('?utm_source=chatgpt.com&ScTestModeId=0013dd43-0c92-4403-bb53-1793e1f5d077',''), 'snapchat');
  assert.equal(mod.detectFormAdPlatform('?utm_source=chatgpt.com&utm_campaign=MZJ_SNAP_PIXEL_TEST_20261104',''), 'snapchat');
  assert.equal(mod.detectFormAdPlatform('?utm_source=chatgpt.com&mzj_pixel_source=tiktok',''), 'tiktok');
  assert.equal(mod.detectFormAdPlatform('?utm_source=snapchat&mzj_pixel_source=tiktok',''), 'snapchat');
  assert.equal(mod.detectFormAdPlatform('?utm_source=google&utm_campaign=car','https://tiktok.com/'), null);
  assert.equal(mod.detectFormAdPlatform('?utm_source=chatgpt.com&utm_campaign=generic',''), null);
  assert.equal(mod.detectFormAdPlatform('?utm_source=direct',''), null);
  assert.equal(mod.detectFormAdPlatform('?fbclid=some-id',''), 'meta');
  assert.equal(mod.detectFormAdPlatform('?utm_source=google&mzj_pixel_source=tiktok',''), null);

  assert.equal(mod.detectFormAdPlatform('','https://l.instagram.com/path'), 'meta');
  mod.startFormAdPixel(platform,settings,'mymzj-form',null);
  mod.startFormAdPixel(platform,settings,'mymzj-form','deny');
  assert.equal(scripts.length,0,'No script before opt-in');
  mod.startFormAdPixel(platform,settings,'mymzj-form','allow');
  assert.equal(scripts.length,1,'Exactly one script for a platform');
  assert.ok(scripts[0].src.includes(expectedScript));
  mod.startFormAdPixel(platform,settings,'mymzj-form','allow');
  assert.equal(scripts.length,1,'Repeated mount must not re-load script');
  const snapshot={id:'new-1',created:true,crmStatus:'linked'};
  mod.trackStoredFormLead(platform,settings,'deny',snapshot);
  mod.trackStoredFormLead(platform,settings,'allow',{...snapshot,created:false});
  mod.trackStoredFormLead(platform,settings,'allow',{id:'existing-1',created:true,crmStatus:'existing'});
  if (platform === 'snapchat') {
    // The old test only checked a temporary JS queue. Now the event must be
    // handed to the loaded SDK, and neither PAGE_VIEW nor SIGN_UP can fire early.
    const realCalls=[];
    assert.equal(window.snaptr.queue.length,0,'No event sent to a placeholder before SDK is ready');
    mod.trackStoredFormLead(platform,settings,'allow',snapshot);
    mod.trackStoredFormLead(platform,settings,'allow',snapshot);
    assert.equal(realCalls.length,0);
    window.snaptr.handleRequest=(...args)=>realCalls.push(args);
    scripts[0].onload();
    await settle();
    assert.equal(realCalls.filter(args=>args[0]==='init').length,1,'Snap SDK initializes once');
    assert.equal(realCalls.filter(args=>args[0]==='track'&&args[1]==='PAGE_VIEW').length,1,'Real SDK received one PAGE_VIEW');
    assert.equal(realCalls.filter(args=>args[0]==='track'&&args[1]===expectedEvent).length,1,'Real SDK received one SIGN_UP');
    mod.startFormAdPixel(platform,settings,'mymzj-form','allow');
    mod.trackStoredFormLead(platform,settings,'allow',snapshot);
    await settle();
    assert.equal(realCalls.length,3,'Repeated mount + conversion cannot duplicate events');
  } else {
    const queue=platform==='meta'?window.fbq.queue:window.ttq;
    const current=queue.length;
    assert.ok(current>=(platform==='tiktok'?1:2),'Pixel initialization + page view');
    mod.trackStoredFormLead(platform,settings,'allow',snapshot);
    assert.equal(queue.length,current+1,'New CRM lead sends one conversion');
    assert.ok(JSON.stringify(queue[current]).includes(expectedEvent));
    mod.trackStoredFormLead(platform,settings,'allow',snapshot);
    assert.equal(queue.length,current+1,'No double conversion for same lead');
  }
}
async function settle(){for(let i=0;i<10;i++) await Promise.resolve();}
async function runAsyncPixelTests(){
await testPlatform('meta','Lead','facebook.net');
await testPlatform('snapchat','SIGN_UP','sc-static.net');
await testPlatform('tiktok','Lead','analytics.tiktok.com');
// Snapchat's browser test URL must be prepared before SDK initialization and
// the test marker must be removed when returning to a real campaign URL.
{
  const {window,document,scripts}=mockedBrowser();
  const mod=transpiled('src/marketing/lead-forms/pixel-tracking.ts',{window,document});
  const pixel=settings.snapchat.id;
  window.location.search=`?utm_source=snapchat&ScTestModeId=${pixel}`;
  mod.startFormAdPixel('snapchat',settings,'test-form','deny');
  assert.equal(window.localStorage.getItem('_scTestEvent'),null);
  mod.startFormAdPixel('snapchat',settings,'test-form','allow');
  const testFlag=window.localStorage.getItem('_scTestEvent');
  assert.ok(testFlag.startsWith(`${pixel}|`));
  assert.equal(scripts.length,1);
  const calls=[];
  window.snaptr.handleRequest=(...args)=>calls.push(args);
  scripts[0].onload();
  await settle();
  window.location.search='?utm_source=snapchat';
  mod.startFormAdPixel('snapchat',settings,'different-form','allow');
  await settle();
  assert.equal(window.localStorage.getItem('_scTestEvent'),null);
  assert.equal(calls.filter(args=>args[0]==='track' && args[1]==='PAGE_VIEW').length,2,'Ad link gets its own PageView');
}
} // runAsyncPixelTests

// Only browser pixel scripts and public lead-forms, no external conversion APIs.
const pixelJs=fs.readFileSync(path.join(root,'src/marketing/lead-forms/pixel-tracking.ts'),'utf8');
assert.doesNotMatch(pixelJs,/\bfetch\s*\(|access_token|business-api|Conversions API.*http/i);
const linkBuilder=fs.readFileSync(path.join(root,'src/marketing/lead-forms/LeadFormsPage.tsx'),'utf8');
assert.match(linkBuilder,/mzj_pixel_source=\{linkPlatform\}/);
assert.match(linkBuilder,/url\.searchParams\.set\('mzj_pixel_source',linkPlatform\)/);
const publicPage=fs.readFileSync(path.join(root,'src/marketing/lead-forms/PublicLeadFormPage.tsx'),'utf8');
assert.match(publicPage,/useLocation\(\)/);
assert.match(publicPage,/detectFormAdPlatform\(location\.search/);
const renderer=fs.readFileSync(path.join(root,'src/marketing/lead-forms/LeadFormRenderer.tsx'),'utf8');
assert.match(renderer,/onLeadStored\?\.\(/);
assert.match(renderer,/json\.created===true/);
const server=fs.readFileSync(path.join(root,'server/marketing/lead-forms.ts'),'utf8');
assert.match(server,/xmax=0\) as created/);
assert.match(server,/pixel_settings_save/);
assert.match(server,/crmStatus/);
for(const rel of ['src/marketing/lead-forms/LeadFormsPage.tsx','src/marketing/lead-forms/PublicLeadFormPage.tsx','src/marketing/lead-forms/LeadFormRenderer.tsx','server/marketing/lead-forms.ts','server/_marketing-lead-forms-schema.ts']) {
  const r=ts.transpileModule(fs.readFileSync(path.join(root,rel),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX},fileName:rel,reportDiagnostics:true});
  const errs=(r.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error);
  assert.equal(errs.length,0,rel+': '+errs.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')).join(','));
}
runAsyncPixelTests().then(()=>console.log('PASS lead-form browser Pixels: consent gating, SDK-ready delivery, source routing, 3 providers, conversion dedupe, typescript syntax, form-only settings')).catch(error=>{console.error(error);process.exitCode=1;});
