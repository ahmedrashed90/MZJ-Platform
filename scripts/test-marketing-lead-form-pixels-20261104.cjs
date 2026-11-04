const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
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
  const window={location:{search:'',reload(){},},localStorage:{getItem:k=>values[k]||null,setItem:(k,v)=>values[k]=v}};
  const document={head:{appendChild:tag=>scripts.push(tag)},createElement:()=>({})};
  return {window,document,scripts};
}
function testPlatform(platform, expectedEvent, expectedScript){
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
  assert.equal(mod.detectFormAdPlatform('','https://l.instagram.com/path'), 'meta');
  mod.startFormAdPixel(platform,settings,'mymzj-form',null);
  mod.startFormAdPixel(platform,settings,'mymzj-form','deny');
  assert.equal(scripts.length,0,'No script before opt-in');
  mod.startFormAdPixel(platform,settings,'mymzj-form','allow');
  assert.equal(scripts.length,1,'Exactly one script for a platform');
  assert.ok(scripts[0].src.includes(expectedScript));
  mod.startFormAdPixel(platform,settings,'mymzj-form','allow');
  assert.equal(scripts.length,1,'Repeated mount must not re-load script');
  let queue=platform==='meta'?window.fbq.queue:platform==='snapchat'?window.snaptr.queue:window.ttq;
  const current=queue.length;
  assert.ok(current>=(platform==='tiktok'?1:2),'Pixel initialization + page view');
  mod.trackStoredFormLead(platform,settings,'deny',{id:'new-1',created:true,crmStatus:'linked'});
  mod.trackStoredFormLead(platform,settings,'allow',{id:'new-1',created:false,crmStatus:'linked'});
  mod.trackStoredFormLead(platform,settings,'allow',{id:'existing-1',created:true,crmStatus:'existing'});
  assert.equal(queue.length,current,'No Lead if denied or duplicate');
  mod.trackStoredFormLead(platform,settings,'allow',{id:'new-1',created:true,crmStatus:'linked'});
  assert.equal(queue.length,current+1,'New CRM lead sends one conversion');
  assert.ok(JSON.stringify(queue[current]).includes(expectedEvent));
  mod.trackStoredFormLead(platform,settings,'allow',{id:'new-1',created:true,crmStatus:'linked'});
  assert.equal(queue.length,current+1,'No double conversion for same lead');
}
testPlatform('meta','Lead','facebook.net');
testPlatform('snapchat','SIGN_UP','sc-static.net');
testPlatform('tiktok','Lead','analytics.tiktok.com');
// Only browser pixel scripts and public lead-forms, no external conversion APIs.
const pixelJs=fs.readFileSync(path.join(root,'src/marketing/lead-forms/pixel-tracking.ts'),'utf8');
assert.doesNotMatch(pixelJs,/\bfetch\s*\(|access_token|business-api|Conversions API.*http/i);
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
console.log('PASS lead-form browser Pixels: consent gating, source routing, 3 providers, conversion dedupe, typescript syntax, form-only settings');
