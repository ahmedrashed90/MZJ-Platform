/** Offline TikTok MCP contract tests. No real tokens or paid API requests. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
const read = file => fs.readFileSync(file, 'utf8');
const backend = read('server/_marketing-tiktok-ads.ts');
const marketing = read('server/marketing/index.ts');
const permission = read('server/_api-permissions.ts');
const paid = read('src/marketing/components/PaidAdsPanel.tsx');
const component = read('src/marketing/components/TikTokAdsPanel.tsx');
let passed = 0;
function check(value, message) { assert.ok(value, message); console.log('PASS', message); passed++; }
function compile(source, file) {
  const output = ts.transpileModule(source, { fileName: file, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal(output.diagnostics.filter(x => x.category === ts.DiagnosticCategory.Error).length, 0, `${file} parses`);
  return output.outputText;
}
for (const [source, name] of [[backend,'server/_marketing-tiktok-ads.ts'],[marketing,'server/marketing/index.ts'],[permission,'server/_api-permissions.ts'],[paid,'src/marketing/components/PaidAdsPanel.tsx'],[component,'src/marketing/components/TikTokAdsPanel.tsx']]) compile(source,name);
check(true, 'All new and edited TypeScript/TSX parses');
check(marketing.includes("if(resource==='tiktok_ads')") && marketing.includes("if(action==='tiktok_ads_link')") && marketing.includes("if(action==='tiktok_ads_campaign_status')"),'TikTok endpoints are wired into existing marketing API');
check(permission.includes('tiktok_ads: "marketing.engagement.view"') && permission.includes('tiktok_ads_campaign_status: "marketing.campaign.edit"'),'TikTok read/write permissions are enforced before routing');
check(paid.includes('<MetaAdsPanel />') && paid.includes('<GoogleAdsPanel />') && paid.includes('<TikTokAdsPanel />'),'TikTok joins paid campaigns without removing Meta or Google');
check(component.includes("type=\"file\"") && component.includes('selectedFile.text()') && !component.includes('localStorage') && !component.includes('sessionStorage'),'OAuth token imported from local file, never saved to browser storage');
check(!backend.includes('INSERT INTO marketing.platform_connections') && !backend.includes('update marketing.platform_connections') && !backend.includes('marketing.posts') && !backend.includes('core.customers'),'TikTok Ads credentials and reports cannot mutate existing integrations or CRM');

let tableExists = false;
let credential = null;
const network = [];
let forcedAccessFailure = false;
function fakeSql(strings, ...args) {
  const statement = strings.join(' ? ').replace(/\s+/g,' ').trim().toLowerCase();
  if (statement.includes('to_regclass')) return Promise.resolve([{ exists: tableExists }]);
  if (statement.startsWith('create table if not exists marketing.tiktok_ads_mcp_credentials')) { tableExists=true; return Promise.resolve([]); }
  if (statement.includes('from marketing.tiktok_ads_mcp_credentials') && statement.includes('select client_id')) return Promise.resolve(credential ? [credential] : []);
  if (statement.includes('insert into marketing.tiktok_ads_mcp_credentials')) {
    credential={client_id:args[0],access_token_encrypted:args[1],refresh_token_encrypted:args[2],token_expires_at:args[3],updated_at:new Date()};return Promise.resolve([]);
  }
  if (statement.includes('update marketing.tiktok_ads_mcp_credentials')) {
    if (credential?.refresh_token_encrypted !== args[3]) return Promise.resolve([]);
    credential={...credential,access_token_encrypted:args[0],refresh_token_encrypted:args[1],token_expires_at:args[2],updated_at:new Date()};return Promise.resolve([{client_id:credential.client_id}]);
  }
  if (statement.includes('delete from marketing.tiktok_ads_mcp_credentials')) {credential=null;return Promise.resolve([]);}
  throw Error(`Unexpected SQL: ${statement.slice(0,140)}`);
}
const decrypt = input => String(input).startsWith('encrypted:') ? String(input).slice(10) : '';
const encrypted = input => input ? `encrypted:${input}` : null;
function response(payload, status=200) {
  return {status,ok:status>=200&&status<300,headers:{get(){return 'application/json';}},async text(){return JSON.stringify(payload)},async json(){return payload}};
}
const fakeCampaigns = Array.from({length:61},(_,idx)=>({
  campaign_id:String(1879000000000000+idx),campaign_name:`MZJ Campaign ${idx+1}`,advertiser_id:'7373575366947962897',
  operation_status:idx===1?'DISABLE':'ENABLE',secondary_status:idx===0?'CAMPAIGN_STATUS_BUDGET_EXCEED':'CAMPAIGN_STATUS_ENABLE',
  objective_type:'LEAD_GENERATION',budget_mode:idx===0?'BUDGET_MODE_TOTAL':'BUDGET_MODE_DAY',budget:idx+50,
  campaign_automation_type:idx<2?'UPGRADED_SMART_PLUS':'MANUAL',create_time:'2026-10-21 10:00:00'
}));
async function fakeFetch(url, init={}) {
  const u = new URL(url);
  if (u.pathname.endsWith('/oauth/token')) {
    const parameters = new URLSearchParams(init.body);
    network.push({ name:'refresh_token',grant_type:parameters.get('grant_type') });
    return response({access_token:'refreshed-access-token-1234567890',refresh_token:'refreshed-refresh-token-1234567890',expires_in:3600});
  }
  assert.equal(u.origin, 'https://business-api.tiktok.com');
  assert.ok(init.headers.Authorization?.startsWith('Bearer '),'Authorization header exists');
  if (forcedAccessFailure && init.headers.Authorization === 'Bearer original-access-token-1234567890') return response({},401);
  const request = JSON.parse(init.body);
  assert.equal(request.method,'tools/call');
  const {name,arguments:args}=request.params;
  network.push({name,args});
  let result;
  if(name==='auth_advertiser_get')result={code:0,data:{list:[
    {advertiser_id:'7373597771888295952',advertiser_name:'MZJ Account 1'},
    {advertiser_id:'7373575366947962897',advertiser_name:'MZJ Account 2'}
  ]}};
  else if(name==='tool_get')result=[{name:'report_integrated_get',inputSchema:{properties:{metrics:{items:{enum:['spend','impressions','clicks','ctr','conversion','onsite_form']}}}}}];
  else if(name==='tool_execute'){
    const {tool_name,params}=args;
    network[network.length-1].name=tool_name;
    if(tool_name==='advertiser_info_get')result={code:0,data:{list:[{advertiser_id:'7373597771888295952',currency:'SAR',timezone:'Asia/Riyadh'},{advertiser_id:'7373575366947962897',currency:'SAR',timezone:'Asia/Riyadh'}]}};
    else if(tool_name==='campaign_get') {
      const id=params.advertiser_id;
      let campaigns=id==='7373575366947962897'?fakeCampaigns:[];
      if(params.filtering?.campaign_ids) campaigns=campaigns.filter(x=>params.filtering.campaign_ids.includes(x.campaign_id));
      result={code:0,data:{list:campaigns,page_info:{page:params.page,page_size:params.page_size,total_page:campaigns.length?1:0,total_number:campaigns.length}}};
    }
    else if(tool_name==='report_integrated_get')result={code:0,data:{list:params.advertiser_id==='7373575366947962897' ? fakeCampaigns.map(item=>({dimensions:{campaign_id:item.campaign_id},metrics:{spend:'20.0',impressions:'1000',clicks:'100',ctr:'10',conversion:'7','onsite_form':'5'}})):[],page_info:{page:1,total_page:1}}};
    else if(tool_name==='campaign_status_update'||tool_name==='smart_plus_campaign_status_update')result={code:0,message:'OK',data:{}};
    else if(tool_name==='campaign_create')result={code:0,message:'OK',data:{campaign_id:'1879385075698588'}};
    else throw Error('Unexpected tool_execute call '+tool_name);
  }
  else throw Error('Unexpected native MCP tool '+name);
  return response({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify(result)}]}});
}
const exports = {};
vm.runInNewContext(compile(backend,'server/_marketing-tiktok-ads.ts'),{
  exports,
  require(name){
    if(name==='./_db.js')return {getSql:()=>fakeSql};
    if(name==='./_platform-connections.js')return {encryptPlatformToken:encrypted,decryptPlatformToken:decrypt};
    throw Error(`Unexpected dependency ${name}`);
  },
  console,process:{env:{}},Buffer,URL,URLSearchParams,Date,Intl,Map,Set,Promise,Math,Object,Array,Number,String,Error,RegExp,AbortSignal,setTimeout,fetch:fakeFetch,
},{timeout:3000});
const api=exports;
const account2='7373575366947962897';
const sampleDate=api.tiktokAdsTestHelpers.period('last_30d');
check(/^\d{4}-\d{2}-\d{2}$/.test(sampleDate.since)&&sampleDate.until>=sampleDate.since,'Saudi date presets resolved into real daily report ranges');
await (async()=>{
  const empty=await api.tiktokAdsData(fakeSql,'last_30d','','','',false);
  check(empty.status==='needs_connection'&&!tableExists&&!network.length,'Unlinked GET does not migrate DB or request TikTok');
  await assert.rejects(api.linkTikTokAdsToken(fakeSql,'00000000-0000-0000-0000-000000000000',{clientId:'public-client-id-123456',token:{access_token:'bad',refresh_token:'bad'}}));
  check(!tableExists,'Invalid token is rejected before any database writes');
  forcedAccessFailure=true;
  const linked=await api.linkTikTokAdsToken(fakeSql,'00000000-0000-0000-0000-000000000000',{clientId:'public-client-id-123456',token:{access_token:'original-access-token-1234567890',refresh_token:'original-refresh-token-1234567890',expires_in:3600}});
  forcedAccessFailure=false;
  check(linked.accounts.length===2&&tableExists&&credential.access_token_encrypted.startsWith('encrypted:'),'OAuth refresh + both authorized TikTok accounts stored encrypted');
  check(network.some(x=>x.name==='refresh_token'),'Expired access tokens are refreshed using the public registered MCP client');
  const loaded=await api.tiktokAdsData(fakeSql,'last_30d','','','',false);
  check(loaded.status==='ready'&&loaded.reports.length===2,'Authorized TikTok accounts reported without touching organic publishing');
  const report2=loaded.reports.find(x=>x.account.id===account2);
  check(report2.campaigns.length===61,'All 61 actual-style campaigns fetched in a single 200-size page');
  check(report2.campaigns[0].metrics.spend===20&&report2.campaigns[0].metrics.impressions===1000&&report2.campaigns[0].metrics.clicks===100,'Integrated spend/impression/click metrics matched to campaign IDs');
  check(report2.campaigns[0].metrics.leads===5&&report2.campaigns[0].metrics.costPerLead===4,'Distinct TikTok lead metric used, CPL is spend / leads');
  check(report2.campaigns[0].budget===50&&report2.campaigns[0].budgetMode==='BUDGET_MODE_TOTAL','Budget mode is preserved instead of labeling total as daily');
  check(loaded.reports.every(x=>x.account.currency==='SAR'),'Account currency is queried instead of hardcoding SAR');
  const reportCalls=network.filter(x=>x.name==='report_integrated_get').length;
  await api.tiktokAdsData(fakeSql,'last_30d','','','',false);
  check(network.filter(x=>x.name==='report_integrated_get').length===reportCalls,'Short-lived cache avoids redundant paid-API report calls');
  await api.tiktokAdsData(fakeSql,'last_30d','','','', 'true');
  check(network.filter(x=>x.name==='report_integrated_get').length>reportCalls,'Explicit refresh bypasses TikTok paid report cache and calls provider again');
  const statusWrites=network.filter(x=>x.name.endsWith('campaign_status_update')).length;
  await assert.rejects(api.changeTikTokAdsCampaignStatus(fakeSql,{accountId:account2,campaignId:fakeCampaigns[0].campaign_id,status:'ENABLE'}));
  check(network.filter(x=>x.name.endsWith('campaign_status_update')).length===statusWrites,'No campaign activation without explicit confirmSpend');
  await assert.rejects(api.changeTikTokAdsCampaignStatus(fakeSql,{accountId:'9999999999999999',campaignId:fakeCampaigns[0].campaign_id,status:'DISABLE'}));
  check(network.filter(x=>x.name.endsWith('campaign_status_update')).length===statusWrites,'Never mutate campaigns in unauthorized accounts');
  await api.changeTikTokAdsCampaignStatus(fakeSql,{accountId:account2,campaignId:fakeCampaigns[0].campaign_id,status:'DISABLE'});
  check(network.filter(x=>x.name==='smart_plus_campaign_status_update').length===1,'Smart+ uses its dedicated status endpoint after ownership readback');
  await api.changeTikTokAdsCampaignStatus(fakeSql,{accountId:account2,campaignId:fakeCampaigns[2].campaign_id,status:'DISABLE'});
  check(network.filter(x=>x.name==='campaign_status_update').length===1,'Manual campaigns use standard status endpoint');
  await assert.rejects(api.createPausedTikTokAdsCampaign(fakeSql,{accountId:account2,name:'Invalid',objective:'LEAD_GENERATION',budgetMode:'BUDGET_MODE_DAY',budget:5}));
  check(network.filter(x=>x.name==='campaign_create').length===0,'Invalid campaign budget rejected before remote write');
  const created=await api.createPausedTikTokAdsCampaign(fakeSql,{accountId:account2,name:'Sonata MZJ Oct 2026',objective:'LEAD_GENERATION',budgetMode:'BUDGET_MODE_DAY',budget:100});
  check(created.campaignId==='1879385075698588'&&network.find(x=>x.name==='campaign_create').args.params.operation_status==='DISABLE','New TikTok campaign is created in disabled state, without ad groups or ads');
  await api.disconnectTikTokAds(fakeSql);
  check((await api.tiktokAdsData(fakeSql,'today','','','',false)).status==='needs_connection'&&credential===null,'Disconnect removes ONLY separate TikTok Ads credentials');
})();
console.log(`\n${passed}/${passed} MZJ TikTok MCP isolated integration checks passed. No live API calls.`);
