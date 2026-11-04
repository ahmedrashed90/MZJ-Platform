const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let ts;
try { ts = require('typescript'); } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
const root = path.resolve(__dirname, '..');
function load(relative, overrides={}) {
  const filename = path.join(root, relative);
  const source = fs.readFileSync(filename, 'utf8') + (overrides.extraCode || '');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename, reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${relative}: ${errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, ' ')).join('; ')}`);
  const sandbox = { exports: {}, require: () => ({}), URL, URLSearchParams, Date, Math, console, ...overrides.context };
  vm.runInNewContext(compiled.outputText, sandbox, { filename: relative });
  return sandbox.exports;
}
const pixel = load('src/marketing/lead-forms/pixel-tracking.ts');
assert.equal(pixel.formLeadAttribution('?utm_source=tiktok', '').source, 'tiktok');
assert.equal(pixel.formLeadAttribution('?utm_source=snapchat', '').source, 'snapchat');
assert.equal(pixel.formLeadAttribution('?utm_source=facebook', '').source, 'facebook');
assert.equal(pixel.formLeadAttribution('?utm_source=instagram', '').source, 'instagram');
assert.equal(pixel.formLeadAttribution('?utm_source=chatgpt.com&mzj_pixel_source=tiktok', '').source, 'tiktok');
assert.equal(pixel.formLeadAttribution('?utm_source=chatgpt.com&ttclid=tt123', '').source, 'tiktok');
assert.equal(pixel.formLeadAttribution('?utm_source=chatgpt.com&ScCid=uuid', '').source, 'snapchat');
assert.equal(pixel.formLeadAttribution('?utm_source=google&mzj_pixel_source=tiktok', '').source, 'google');
assert.equal(pixel.formLeadAttribution('?utm_source=unrelated', '').source, 'unrelated');
assert.equal(pixel.formLeadAttribution('', '').source, 'direct');
console.log('PASS: CRM source attribution matches TikTok/Snapchat ad link + Pixel detection without spoofing unrelated UTM');

// A visitor's first view is immutable in the existing form DB. Campaign-specific
// visit keys ensure a previous direct test cannot force a TikTok lead into Website.
let counter = 0;
const memory = new Map();
const visitorExports = load('src/marketing/lead-forms/LeadFormRenderer.tsx', {
  extraCode: '\nexport { getVisitor as __testGetVisitor };',
  context: {
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}` },
    sessionStorage: {getItem: key => memory.get(key) || null,setItem: (key,val) => memory.set(key,val)},
  },
});
const visitor = visitorExports.__testGetVisitor;
const attrs = (source, campaign = '') => ({source,campaign,medium:'paid_social',adId:''});
const directVisit = visitor('form', attrs('direct'));
assert.equal(visitor('form', attrs('direct')), directVisit);
const tiktokVisit = visitor('form', attrs('tiktok'));
assert.notEqual(tiktokVisit, directVisit);
assert.equal(tiktokVisit, visitor('form', attrs('tiktok')));
assert.notEqual(visitor('form', attrs('snapchat')), tiktokVisit);
assert.notEqual(visitor('form', attrs('tiktok','campaign-2')), tiktokVisit);
console.log('PASS: visitor attribution is scoped by campaign and source, avoiding prior direct Website visits');

const pixelId = '0013dd43-0c92-4403-bb53-1793e1f5d077';
// The identifier in the browser test URL is supplied by Snap; do not assume
// it must differ from the advertising Pixel ID shown in Events Manager.
const testId = pixelId;
const scripts=[];
const local=new Map();
const browser = {
  location: {pathname:'/forms/test-form',search:`?utm_source=snapchat&ScTestModeId=${testId}`},
  localStorage: { getItem: k=>local.get(k)||null, setItem: (k,v)=>local.set(k,v), removeItem:k=>local.delete(k)},
};
const document = {head:{appendChild: tag=>scripts.push(tag)},createElement:()=>({remove(){}})};
const snap = load('src/marketing/lead-forms/pixel-tracking.ts',{context:{window:browser,document}});
const pixels={snapchat:{id:pixelId,enabled:true},tiktok:{id:'',enabled:false},meta:{id:'',enabled:false}};
async function testSnapSdkAfterLoad(){
snap.startFormAdPixel('snapchat',pixels,'test-form','deny');
assert.equal(local.has('_scTestEvent'),false);
snap.startFormAdPixel('snapchat',pixels,'test-form','allow');
assert.ok(local.get('_scTestEvent').startsWith(`${testId}|`));
assert.equal(scripts.length,1);
assert.equal(browser.snaptr.queue.length,0,'No premature queued PAGE_VIEW');
snap.trackStoredFormLead('snapchat',pixels,'allow',{id:'new-id',created:true,crmStatus:'linked'});
const calls=[];
browser.snaptr.handleRequest=(...args)=>calls.push(args);
scripts[0].onload();
for(let i=0;i<10;i++) await Promise.resolve();
assert.deepEqual(calls.filter(args=>args[0]==='track').map(args=>args[1]),['PAGE_VIEW','SIGN_UP']);
browser.location.search='?utm_source=snapchat';
snap.startFormAdPixel('snapchat',pixels,'campaign-form','allow');
assert.equal(local.has('_scTestEvent'),false,'No test marker on real campaigns');
console.log('PASS: Snap Test Events preserves URL test UUID, sends events after SDK load, clears on real URL');
}
testSnapSdkAfterLoad().catch(error=>{console.error(error);process.exitCode=1;});

const crm=load('server/marketing/lead-forms-crm.ts');
assert.equal(crm.crmSourceForForm('tiktok'),'tiktok_lead');
assert.equal(crm.crmSourceForForm('snapchat'),'snapchat_lead');
assert.equal(crm.crmSourceForForm('direct'),'website');
const assignment=fs.readFileSync(path.join(root,'server/_crm-utils.ts'),'utf8');
assert.match(assignment,/const requirePhysicalBranch = sourceCode !== 'sheet_lead'/);
assert.match(assignment,/chooseFromConfiguredRule\(departmentCode, "", sourceCode, requirePhysicalBranch\)/);
assert.match(assignment,/chooseFinanceImportAssignment\(sourceCode, requirePhysicalBranch\)/);
assert.match(assignment,/r\.branch_code not in \('online','website'\)/);
const lifecycle=fs.readFileSync(path.join(root,'server/_crm-lifecycle.ts'),'utf8');
assert.match(lifecycle,/if \(input\.marketingFormImportRouting && !assignment\.assignedTo\)/);
console.log('PASS: form-only distribution refuses to silently create new unassigned CRM leads');
console.log('PASS: both CRM sales departments use configured rule with actual representative branch; older sheet-only flow preserved');

const sorted = load('src/marketing/workflow/campaignOverview.tsx').preparationLinesByDate;
const original = [
  {id:'a',platform_name:'سناب شات',scheduled_on:'2026-11-07'},
  {id:'b',platform_name:'تيك توك',scheduled_on:'2026-11-04'},
  {id:'c',platform_name:'ميتا',scheduled_on:'2026-11-05'},
  {id:'d',platform_name:'سناب شات',scheduled_on:'2026-11-04'},
  {id:'e',platform_name:'ميتا',scheduled_on:null},
];
const result=sorted(original);
assert.deepEqual(Array.from(result.map(r=>r.scheduled_on)), ['2026-11-04','2026-11-04','2026-11-05','2026-11-07',null]);
assert.equal(original.map(r=>r.id).join(','),'a,b,c,d,e','date sort must not mutate input');
const dashboard=fs.readFileSync(path.join(root,'src/marketing/pages/MarketingDashboardPage.tsx'),'utf8');
assert.match(dashboard,/chooserLines = preparationLinesByDate\(chooserSourceLines\)/);
assert.match(dashboard,/platform-\$\{line\.platform_code \|\| line\.platform_name\}-\$\{index\}/);
console.log('PASS: campaign and agenda preparation display publish dates ascending across platforms, report unchanged');
