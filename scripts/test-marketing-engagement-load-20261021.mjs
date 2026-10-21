import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const db = read('server/_db.ts');
const schema = read('server/_marketing-schema.ts');
const engagement = read('server/_marketing-engagement.ts');
const page = read('src/marketing/pages/EngagementPage.tsx');
const platforms = read('src/marketing/pages/PlatformConnectionsPage.tsx');
const ads = read('src/marketing/components/GoogleAdsPanel.tsx');
const hub = read('src/marketing/components/PaidAdsPanel.tsx');
const css = read('src/marketing/marketing.css');
let checks = 0;
function check(condition, message) { assert.ok(condition,message); checks++; console.log('PASS:',message); }

// Compile and run the actual transaction helper with a fake connection pool.
const isolatedRunner = db.slice(db.indexOf('function splitSqlStatements('));
const js = ts.transpileModule(isolatedRunner, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const calls = [];
const sql = {
  unsafe: async q => {calls.push(`pool:${String(q).trim()}`);},
  begin: async callback => {
    calls.push('begin:reserved');
    const tx = {unsafe:async q=>{calls.push(`tx:${String(q).trim()}`);}};
    await callback(tx);
    calls.push('commit:reserved');
  },
};
const result = {};
new Function('getSql','exports',js)(()=>sql,result);
await result.runSqlScript('-- Google Ads upgrade\n/* transaction starts */\nBEGIN;\n-- table comment\nALTER TABLE demo ADD COLUMN enabled boolean;\nCOMMIT;\n-- notes below');
check(calls[0]==='begin:reserved' && calls.at(-1)==='commit:reserved','Commented migrations use reserved Postgres transaction');
check(!calls.some(call=>call.startsWith('pool:') && /\bbegin\b/i.test(call)), 'No bare BEGIN is sent to an unsafe connection pool');
check(calls.some(call=>call.includes('ALTER TABLE demo')),'Every migration statement stays inside transaction');
check(schema.includes('const MARKETING_SCHEMA_V3_SQL = String.raw`begin;'),'Google Ads schema V3 begins with BEGIN (not a leading comment)');

const getSection = engagement.split('export async function engagementData(')[1].split('type SubscriptionTarget')[0];
for(const job of ['backfillPublishedPosts','cleanupLegacyTestEngagementRows','repairStoredEngagementSources','repairLegacySocialMessagingIdentity','repairUnassignedSocialEngagementAssignments']) {
  check(!getSection.includes(`await ${job}(sql)`),`Read-only engagement endpoint avoids expensive ${job} write task`);
}
check(engagement.includes('export async function refreshEngagementMetrics') && engagement.split('export async function refreshEngagementMetrics')[1].includes('await backfillPublishedPosts(sql)'), 'Manual refresh retains legacy backfill path');
check(page.includes('if (view === "meta_ads") { setLoading(false); return; }') && page.includes('<PaidAdsPanel />'), 'Paid reports skip organic engagement fetch');
check(page.includes('visiblePosts.map') && page.includes('visibleEvents.map') && page.includes('visibleResults.map'), 'All long engagement lists render bounded pages');
check(platforms.includes("['meta', 'tiktok', 'youtube', 'google_ads']"),'Previous OAuth platforms remain visible during network failures');
check(platforms.includes('setLoading("");\n      if (result.canManage)'), 'Connections render immediately, independently of Zoho status request');
check(ads.includes('marketing-google-ads-hero') && ads.includes('marketing-google-ads-setup-banner'), 'Google Ads has professional header and connected-state empty screen');
check(hub.includes('<MetaAdsPanel />') && hub.includes('<GoogleAdsPanel />'), 'Meta panel and Google panel remain separate in same hub');
check(css.includes('.marketing-google-ads .marketing-google-ads-filters') && css.includes('.marketing-engagement-pagination'), 'Native RTL responsive CSS and pagination styling exist');

for(const [name,code,kind] of [
  ['SQL client',db,ts.ScriptKind.TS], ['marketing schema',schema,ts.ScriptKind.TS], ['engagement server',engagement,ts.ScriptKind.TS],
  ['engagement UI',page,ts.ScriptKind.TSX], ['platform connections UI',platforms,ts.ScriptKind.TSX],
  ['Google Ads UI',ads,ts.ScriptKind.TSX], ['paid-media hub',hub,ts.ScriptKind.TSX]]) {
  const parsed=ts.createSourceFile(name,code,ts.ScriptTarget.Latest,true,kind);
  check(parsed.parseDiagnostics.length===0,`${name} parses without TypeScript/JSX syntax errors`);
}
console.log(`${checks}/${checks} safe migration, performance, platforms and design regression checks passed.`);
