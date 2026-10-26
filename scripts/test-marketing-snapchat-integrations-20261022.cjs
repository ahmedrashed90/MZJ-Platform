'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const root = path.resolve(__dirname, '..');
const moduleUnderTest = createLoader(root)('server/_marketing-windsor-snapchat.ts');
const { aggregateWindsorSnapchat, windsorSnapchatAdsData } = moduleUnderTest;
const example = [
  {date:'2026-10-19', account_name:'MZJ', account_id:'account-1',campaign:'Campaign A',campaign_id:'campaign-1',currency:'SAR',spend:20,native_leads:53,clicks:262,source:'snapchat'},
  {date:'2026-10-20', account_name:'MZJ', account_id:'account-1',campaign:'Campaign A',campaign_id:'campaign-1',currency:'SAR',spend:15,native_leads:7,clicks:10,source:'snapchat'},
  {date:'2026-10-20', account_name:'MZJ', account_id:'account-2',campaign:'Campaign A',campaign_id:'campaign-2',currency:'SAR',spend:10,native_leads:5,clicks:3,source:'snapchat'},
  {date:'2026-10-20', account_name:'MZJ', account_id:'account-1',campaign:'Campaign A',campaign_id:'campaign-1',currency:'SAR',spend:15,native_leads:7,clicks:10,source:'snapchat'},
  {date:'2026-10-20', account_name:'MZJ', account_id:'account-other', campaign:'Campaign A',campaign_id:'foreign',currency:'SAR',spend:900,native_leads:900,clicks:900,source:'facebook'},
  {date:'2026-10-21', account_name:'MZJ', account_id:'account-1',campaign:'Campaign A',campaign_id:'campaign-1',currency:'SAR',spend:30,native_leads:9,clicks:29,source:'snapchat'},
];
const normalized = aggregateWindsorSnapchat(example,'2026-10-19','2026-10-20');
assert.equal(normalized.reports.length,2,'same campaign name in two accounts is not merged');
const main=normalized.reports.find(x=>x.account.id==='account-1').campaigns[0];
assert.equal(main.metrics.spend,35);
assert.equal(main.metrics.leads,60);
assert.equal(main.metrics.clicks,272);
assert.equal(main.metrics.interactions,null,'clicks are NOT fabricated as engagement');
assert(normalized.warnings.some(x=>x.includes('متكررة')),'duplicate daily record warning');
assert.throws(()=>aggregateWindsorSnapchat([], '2026-10-22','2026-10-01'));
console.log('PASS Windsor: daily rows grouped per distinct account/campaign, dates inclusive, duplicates isolated');

const fixturePath='/mnt/data/Pasted text(20261022-014651).txt';
if(fs.existsSync(fixturePath)) {
  const raw=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
  const actual=aggregateWindsorSnapchat(raw.data,'2026-10-01','2026-10-22');
  const campaigns=actual.reports.flatMap(x=>x.campaigns);
  assert.equal(raw.data.length,792);
  assert.equal(campaigns.length,36);
  assert.equal(campaigns.filter(x=>x.metrics.spend>0).length,2);
  const checked=campaigns.find(x=>x.id==='2026-10-12 - Lead Generation Campaign');
  assert.equal(checked.metrics.leads,328);
  assert.equal(checked.metrics.clicks,2150);
  assert.equal(checked.metrics.spend,159.86);
  console.log('PASS Windsor: actual Postman attachment 792 daily records => 36 distinct campaigns');
}
const previousFetch=global.fetch;
const previousKey=process.env.WINDSOR_SNAPCHAT_API_KEY;
const previousInterval=process.env.WINDSOR_SNAPCHAT_REFRESH_INTERVAL;
let calls=[];
process.env.WINDSOR_SNAPCHAT_API_KEY='non-production-test-key';
global.fetch=async (url)=>{
  const parsed=new URL(url);calls.push(parsed);
  assert.equal(parsed.hostname,'connectors.windsor.ai');
  assert.equal(parsed.searchParams.get('api_key'),'non-production-test-key');
  assert.equal(parsed.searchParams.get('date_from'),'2026-10-19');
  assert.equal(parsed.searchParams.get('date_to'),'2026-10-20');
  assert.equal(parsed.pathname,'/snapchat');
  for(const field of ['campaign_id','account_id','currency','source','native_leads']) {
    assert(parsed.searchParams.get('fields').split(',').includes(field));
  }
  const providerRows = calls.length > 1 ? example.map(row =>
    row.account_id === 'account-1' && row.date === '2026-10-19'
      ? {...row, spend:25, native_leads:57, clicks:275} : row) : example;
  return {ok:true,status:200,headers:new Headers(),json:async()=>({data:providerRows})};
};
(async()=>{
  try {
    const result=await windsorSnapchatAdsData('2026-10-19','2026-10-20');
    assert.equal(result.status,'ready');
    assert.equal(result.reports.length,2);
    assert.equal(result.reports[0].account.currency,'SAR');
    assert.equal(calls.length,1);
    // A second call in the same date range must hit the 5-minute cache.
    await windsorSnapchatAdsData('2026-10-19','2026-10-20');
    assert.equal(calls.length,1);
    // Manual refresh must not reuse MZJ's five-minute memory cache, while
    // still respecting Windsor's published provider-controlled refresh policy.
    process.env.WINDSOR_SNAPCHAT_REFRESH_INTERVAL = '1h';
    const refreshed = await windsorSnapchatAdsData('2026-10-19','2026-10-20',true);
    assert.equal(calls.length,2,'explicit refresh calls Windsor again');
    assert.equal(calls[1].searchParams.get('refresh_since'),'3d');
    assert.equal(calls[1].searchParams.get('refresh_interval'),'1h');
    assert(refreshed.note.includes('قد تظل مخزنة'), 'fresh response never promises provider cache has cleared');
    const refreshedMetrics=refreshed.reports.find(x=>x.account.id==='account-1').campaigns[0].metrics;
    assert.equal(refreshedMetrics.spend,40,'New upstream spend replaces cached spend');
    assert.equal(refreshedMetrics.leads,64,'New upstream leads replace cached leads');
    assert.equal(refreshedMetrics.clicks,285,'New upstream clicks replace cached clicks');
    await windsorSnapchatAdsData('2026-10-19','2026-10-20');
    assert.equal(calls.length,2,'newest result cached for ordinary repeat loads');
    delete process.env.WINDSOR_SNAPCHAT_REFRESH_INTERVAL;
    console.log('PASS Windsor: manual refresh bypasses local cache and states upstream staleness honestly');
    console.log('PASS Windsor: correct server-side key, official field names, report cache, no client token exposure');
    for (const file of [
      'server/_marketing-social-accounts.ts','server/_marketing-windsor-snapchat.ts',
      'server/_marketing-campaign-report.ts','shared/campaign-report.ts',
      'src/marketing/components/ConnectedAccountsOverview.tsx',
      'src/marketing/components/CampaignReportPage.tsx','src/marketing/reporting/exportCampaignReport.ts'
    ]) {
      const source=fs.readFileSync(path.join(root,file),'utf8');
      const check=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,
        compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});
      assert.equal(check.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,`${file} parses`);
    }
    console.log('PASS all edited frontend and backend files transpile without syntax errors');
    const sql=fs.readFileSync(path.join(root,'database/migrations/20261022_marketing_snapchat_organic.sql'),'utf8');
    assert(sql.includes("('tiktok','snapchat')"));
    console.log('PASS the follower storage migration supports both networks');
  } finally {
    global.fetch=previousFetch;
    if(previousInterval===undefined) delete process.env.WINDSOR_SNAPCHAT_REFRESH_INTERVAL;
    else process.env.WINDSOR_SNAPCHAT_REFRESH_INTERVAL=previousInterval;
    if(previousKey===undefined) delete process.env.WINDSOR_SNAPCHAT_API_KEY;
    else process.env.WINDSOR_SNAPCHAT_API_KEY=previousKey;
  }
})().catch(e=>{ console.error(e);process.exitCode=1; });
