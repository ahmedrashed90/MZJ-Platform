/** Offline read-only campaign report contract tests; no live provider calls/spend. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
function loadTS(file, mocks = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal(output.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, `${file}: parses`);
  const mod = { exports: {} };
  const sandbox = { module: mod, exports: mod.exports, require: dep => {
    if (Object.hasOwn(mocks, dep)) return mocks[dep];
    throw new Error(`Unexpected imported module: ${dep}`);
  }, TextEncoder, Uint8Array, Uint32Array, DataView, Blob, Date, String, Number, Math, Promise, Map, Set, JSON, Intl, console, window:globalThis.window };
  vm.runInNewContext(output.outputText, sandbox, { filename: file });
  return mod.exports;
}
let passed = 0;
const check = (condition, description) => { assert(condition, description); passed++; console.log('PASS', description); };
const shared = loadTS('shared/campaign-report.ts');
const args = { platform: 'meta', platformName: 'Meta Ads', accountId: '22', accountName: 'MZJ',
  currency: 'SAR', campaignId: '33', campaignName: 'Sonata', status: 'ACTIVE',
  metrics: { spend: '180', leads: '6', interactions: '15' }, interactionField: 'interactions', interactionsDefinition: 'post_engagement' };
const row = shared.normalizeCampaignReportRow(args);
check(row.spend === 180 && row.leads === 6 && row.costPerLead === 30 && row.interactions === 15, 'Lead and CPL from attributable provider metrics');
const usdRow = shared.normalizeCampaignReportRow({...args,currency:'usd',metrics:{spend:20,leads:5,interactions:1}});
check(usdRow.sourceCurrency === 'USD' && usdRow.currency === 'SAR' && usdRow.spend === 75 && usdRow.costPerLead === 15,'USD spend and CPL use exactly 3.75 SAR per USD');
const unknownRow = shared.normalizeCampaignReportRow({...args,currency:'EUR',metrics:{spend:20,leads:5,interactions:1}});
check(unknownRow.spend === null && unknownRow.costPerLead === null && unknownRow.currency === 'SAR' && unknownRow.sourceCurrency === 'EUR','Unsupported currency never mislabeled or converted using USD rate');
const absent = shared.normalizeCampaignReportRow({ ...args, metrics: { spend: 100, leads: null } });
check(absent.leads === null && absent.costPerLead === null && absent.interactions === null, 'Unknown lead and interactions stay unknown, never zero');
const zero = shared.normalizeCampaignReportRow({ ...args, metrics: { spend: 0, leads: 0, interactions: 0 } });
check(zero.leads === 0 && zero.costPerLead === null && zero.interactions === 0, 'Real zero remains zero, CPL undefined for zero leads');
check(shared.validateCampaignReportRange('2026-10-01', '2026-10-21').to === '2026-10-21', 'Inclusive date boundaries');
for (const values of [['2026-10-21', '2026-10-01'],['2026-02-30','2026-03-01'],['2025-01-01','2026-10-21']]) {
  assert.throws(() => shared.validateCampaignReportRange(...values)); passed++;
}
console.log('PASS invalid, impossible and over-year date windows rejected');
let calls = [];
const adapter = (provider, campaigns, extra = {}) => async (sql, preset, id, from, to) => {
  calls.push({ provider, from, to });
  return { status: 'ready', reports: [{ account: { id: provider+'-1', name: provider, currency: provider === 'google' ? 'USD' : 'SAR' }, campaigns, incomplete: false, warnings: [] }], errors: [], note: '', ...extra };
};
const server = loadTS('server/_marketing-campaign-report.ts', {
  './_marketing-meta-ads.js': { metaAdsData: adapter('meta', [{id:'A',name:'Meta A',status:'ACTIVE',metrics:{spend:500,leads:10,interactions:40}}]) },
  './_marketing-google-ads.js': { googleAdsData: adapter('google',[{id:'B',name:'Google B',status:'ENABLED',metrics:{spend:45,leads:2,engagements:80}}]) },
  './_marketing-tiktok-ads.js': { tiktokAdsData: async () => { throw Error('Timeout'); } },
  './_marketing-windsor-snapchat.js': { windsorSnapchatAdsData: async (from,to) => ({status:'ready',note:'',reports:[{account:{id:'snap-1',name:'Snapchat',currency:'SAR'},campaigns:[{id:'S',name:'Snap A',metrics:{spend:200,leads:5,clicks:60,interactions:null}}]}],errors:[]}) },
  '../shared/campaign-report.js': shared,
  './_db.js': { getSql: () => {} },
});
const report = await server.consolidatedCampaignReport({}, '2026-10-01', '2026-10-21');
check(report.rows.length === 3 && report.providers.length === 4, 'All registered providers appear even when one fails');
check(report.providers.find(p => p.platform === 'tiktok').status === 'failed', 'Provider errors isolate rather than erase successful data');
check(report.rows.find(r => r.platform === 'google').interactions === 80, 'Google engagements map to interactions without converting to likes');
check(report.rows.find(r => r.platform === 'meta').leads === 10, 'Meta lead attribution preserved');
check(report.rows.find(r => r.platform === 'snapchat').clicks === 60 && report.rows.find(r => r.platform === 'snapchat').interactions === null, 'Snapchat clicks are distinct from engagements');
check(report.rows.every(r => r.currency === 'SAR') && report.rows.find(r => r.platform === 'google').sourceCurrency === 'USD' && report.rows.find(r => r.platform === 'google').spend === 168.75 && report.rows.find(r => r.platform === 'google').costPerLead === 84.375 && report.rows.find(r => r.platform === 'meta').spend === 500, 'Account spend/CPL normalized to SAR at USD x 3.75, SAR unchanged');
check(calls.length === 2 && calls.every(call => call.from === '2026-10-01' && call.to === '2026-10-21'), 'One identical date filter sent to each reporting source');
let printHtml='';
globalThis.window={open:()=>({document:{open(){},write(value){printHtml=value},close(){}}})};
const exporters = loadTS('src/marketing/reporting/exportCampaignReport.ts');
const binary = await exporters.campaignReportXlsx(report.rows,report.providers,report.from,report.to).arrayBuffer();
check(new Uint8Array(binary)[0] === 0x50 && new Uint8Array(binary)[1] === 0x4b && binary.byteLength > 1000, 'Export generates a native Excel ZIP container');
const xlsxText = Buffer.from(binary).toString('utf8');
check(xlsxText.includes('168.75') && xlsxText.includes('84.375') && xlsxText.includes('SAR'), 'Excel exports actually converted USD spend/CPL and labeled currency SAR');
try { exporters.printCampaignReportPdf(report.rows,report.providers,report.from,report.to); }
finally { delete globalThis.window; }
check(printHtml.includes('168.75') && printHtml.includes('SAR') && printHtml.includes('3.75'), 'PDF print markup actually shows SAR amounts and fixed USD conversion');
for (const file of ['src/marketing/components/CampaignReportPage.tsx','src/marketing/pages/EngagementPage.tsx','src/marketing/components/TikTokAdsPanel.tsx','server/_marketing-tiktok-ads.ts']) {
  const source = fs.readFileSync(file,'utf8');
  const output = ts.transpileModule(source,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
  check(!output.diagnostics.some(d=>d.category === ts.DiagnosticCategory.Error),`${file} transpiles`);
}
const page=fs.readFileSync('src/marketing/pages/EngagementPage.tsx','utf8');
const endpoints=fs.readFileSync('server/marketing/index.ts','utf8');
check(page.includes('view === "report" ? <CampaignReportPage />') && endpoints.includes("if(resource==='campaign_report')"),'Campaign report has standalone tab and permission-protected API');
check(!fs.readFileSync('server/_marketing-campaign-report.ts','utf8').includes('insert into marketing') &&
  !fs.readFileSync('server/_marketing-campaign-report.ts','utf8').includes('update marketing'),'Report endpoints are read-only');
console.log(`\n${passed}/${passed} unified campaign reporting contract checks passed`);
