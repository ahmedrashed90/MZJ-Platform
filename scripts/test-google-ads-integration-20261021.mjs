import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read = path => fs.readFileSync(path, 'utf8');
const googleApi = read('server/_google-ads-api.ts');
const reporting = read('server/_marketing-google-ads.ts');
const connections = read('server/_platform-connections.ts');
const schema = read('server/_marketing-schema.ts');
const app = read('src/marketing/pages/EngagementPage.tsx');
const paid = read('src/marketing/components/PaidAdsPanel.tsx');
const adsPanel = read('src/marketing/components/GoogleAdsPanel.tsx');
const connectionUi = read('src/marketing/pages/PlatformConnectionsPage.tsx');
let passed = 0;
function check(condition, label) { assert.ok(condition,label);passed+=1;console.log('PASS:',label); }
function compile(source, name) {
  const result = ts.transpileModule(source, { fileName: name, reportDiagnostics:true, compilerOptions: {target: ts.ScriptTarget.ES2022,module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX} });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length,0,`${name}: TypeScript must parse`);
  return result.outputText;
}
function loadModule(code, requireModule, fetcher) {
  const exports = {};
  vm.runInNewContext(code, {exports, require: requireModule, URL, URLSearchParams, AbortSignal, console, Date, Set, Map, String, Number, Promise, Error, Math, Object, Array, RegExp, process:{env:{}},fetch:fetcher}, {timeout:3000});
  return exports;
}
const customerId = '1234567890'; const campaignId = '9876543210';
const inactiveId = '9999999999';
const adAccount = {id:customerId, name:'MZJ Account A',currency:'SAR',timeZone:'Asia/Riyadh',manager:false,loginCustomerId:''};
const calls=[];
async function fakeFetch(url,init={}) {
  const u=new URL(url),body=init.body ? JSON.parse(init.body) : {};
  calls.push({method:init.method,endpoint:u.pathname,body,headers:init.headers});
  assert.equal(init.headers.Authorization,'Bearer fake-local-token');
  assert.ok(!body.pageSize,'No forbidden pageSize in v26');
  if(u.pathname.includes(`/customers/${inactiveId}/`)) return {ok:false,status:403,json:async()=>({error:{message:'The customer account cannot be accessed because it is not yet enabled or has been deactivated.'}})};
  if(u.pathname.endsWith('customers:listAccessibleCustomers'))return {ok:true,json:async()=>({resourceNames:[`customers/${customerId}`]})};
  if(u.pathname.endsWith('googleAds:search')) {
    const query=String(body.query);
    let results=[];
    if(query.includes('FROM customer '))results=[{customer:{id:customerId,descriptiveName:'MZJ Account A',currencyCode:'SAR',timeZone:'Asia/Riyadh',manager:false}}];
    else if(query.includes('campaign_budget.amount_micros')) {
      assert.ok(query.includes('campaign.start_date_time') && query.includes('campaign.end_date_time'), 'v26 query must request supported campaign date-time fields');
      assert.ok(!/campaign\.(?:start_date|end_date)(?!_time)/.test(query), 'v26 query must not use removed date-only fields');
      results=[{campaign:{id:campaignId,name:'Sonata Search 2026',status:'PAUSED',advertisingChannelType:'SEARCH',startDateTime:'2026-10-01 00:00:00',endDateTime:'2026-12-31 23:59:59'},campaignBudget:{amountMicros:'30000000'}}];
    }
    else if(query.includes('metrics.cost_micros'))results=[{campaign:{id:campaignId},metrics:{costMicros:'50000000',impressions:'2000',clicks:'80',ctr:'4',engagements:'30',conversions:'7'}}];
    else if(query.includes('segments.conversion_action_category'))results=[{campaign:{id:campaignId},segments:{conversionActionCategory:'SUBMIT_LEAD_FORM'},metrics:{conversions:'5'}}];
    else if(query.includes('FROM ad_group_ad'))results=[{campaign:{id:campaignId},adGroup:{name:'Sonata'},adGroupAd:{status:'ENABLED',ad:{id:'222333444',type:'RESPONSIVE_SEARCH_AD'}}}];
    else if(query.includes('FROM campaign'))results=[{campaign:{id:campaignId,status:'PAUSED'}}];
    return {ok:true,json:async()=>({results})};
  }
  if(u.pathname.endsWith('campaigns:mutate'))return {ok:true,json:async()=>({results:[{resourceName:`customers/${customerId}/campaigns/${campaignId}`}]})};
  if(u.pathname.endsWith('googleAds:mutate'))return {ok:true,json:async()=>({mutateOperationResponses:[{}, {campaignResult:{resourceName:`customers/${customerId}/campaigns/${campaignId}`}}]})};
  throw new Error(`Unexpected remote URL ${u.pathname}`);
}
const api = loadModule(compile(googleApi, '_google-ads-api.ts'), () => {throw Error('No dependencies');}, fakeFetch);
const disabledAccount = {...adAccount,id:inactiveId,name:'Inactive account'};
let selectedAccounts = [adAccount];
const connectMock = {getGoogleAdsAccessToken:async()=>({accessToken:'fake-local-token',accounts:selectedAccounts,selectedAccountIds:selectedAccounts.map(account=>account.id)})};
const fakePreset = {metaAdsPreset:(v)=>['today','yesterday','last_7d','last_30d','this_month'].includes(v) ? v : 'last_30d', metaAdsTimeRange:(a,b)=>a&&b?{since:a,until:b}:null};
const report = loadModule(compile(reporting,'_marketing-google-ads.ts'),name=>{
  if(name==='./_db.js')return {getSql:()=>null};
  if(name==='./_platform-connections.js')return connectMock;
  if(name==='./_google-ads-api.js')return api;
  if(name==='./_marketing-meta-ads.js')return fakePreset;
  throw Error(`Unexpected require: ${name}`);
},fakeFetch);
check(!!(await api.googleAdsDiscover('fake-local-token')).accounts.find(x=>x.id===customerId), 'Google accounts are discovered by the signed-in email');
const loaded=await report.googleAdsData(null,'last_30d','','','');
check(loaded.status==='ready'&&loaded.reports.length===1,'Live account report is returned');
check(loaded.reports[0].campaigns[0].metrics.spend===50,'Micros converted to account currency');
check(loaded.reports[0].campaigns[0].metrics.leads===5,'Lead conversions are distinguished from all conversions');
check(loaded.reports[0].campaigns[0].metrics.costPerLead===10,'Google cost per lead correctly calculated');
check(loaded.reports[0].campaigns[0].dailyBudget===30,'Daily budget correctly read from attributed campaign_budget');
check(loaded.reports[0].campaigns[0].startTime==='2026-10-01 00:00:00' && loaded.reports[0].campaigns[0].stopTime==='2026-12-31 23:59:59', 'Google Ads v26 start/end date-times are mapped to campaign reports');
check(loaded.reports[0].campaigns[0].ads.length===1,'Google ads and campaign details are connected');
check(calls.filter(c=>c.endpoint.endsWith('googleAds:search')).every(c=>!c.body.pageSize),'v26 fixed page size is respected');
selectedAccounts = [adAccount,disabledAccount];
const partiallyLoaded = await report.googleAdsData(null,'last_30d','','','');
check(partiallyLoaded.status==='ready' && partiallyLoaded.reports.length===1 && partiallyLoaded.errors.length===1 && partiallyLoaded.errors[0].accountId===inactiveId, 'Disabled customer error is isolated; selected active account campaigns still load');
selectedAccounts = [adAccount];
const beforeWrites=calls.filter(c=>c.endpoint.endsWith('campaigns:mutate')).length;
await assert.rejects(report.changeGoogleAdsCampaignStatus(null,{accountId:customerId,campaignId,status:'ENABLED'}));
check(beforeWrites===calls.filter(c=>c.endpoint.endsWith('campaigns:mutate')).length,'Enabling spending without explicit confirmation never mutates');
await report.changeGoogleAdsCampaignStatus(null,{accountId:customerId,campaignId,status:'ENABLED',confirmSpend:true});
check(calls.some(c=>c.endpoint.endsWith('campaigns:mutate')&&c.body.operations?.[0]?.update?.status==='ENABLED'),'Explicit authorized campaign activation can be submitted');
const beforeCreate=calls.filter(c=>c.endpoint.endsWith('googleAds:mutate')).length;
await assert.rejects(report.createPausedGoogleAdsSearchCampaign(null,{accountId:customerId,name:'Invalid',dailyBudget:50,finalUrl:'http://example.com',headlines:['a','b','c'],descriptions:['a','b'],keywords:['car']}));
check(beforeCreate===calls.filter(c=>c.endpoint.endsWith('googleAds:mutate')).length,'Invalid landing URL is rejected before campaign creation');
await report.createPausedGoogleAdsSearchCampaign(null,{accountId:customerId,name:'Sonata 2026',dailyBudget:50,finalUrl:'https://mzjcars.com/',headlines:['Sonata MZJ','Ready to drive','Shop Sonata 2026'],descriptions:['Discover MZJ vehicles today','Select an available car online'],keywords:['sonata 2026','new cars riyadh']});
const mutates=calls.filter(c=>c.endpoint.endsWith('googleAds:mutate'));
check(mutates.length===2&&mutates[0].body.validateOnly===true&&mutates[1].body.validateOnly!==true,'Campaign validation precedes a single atomic actual mutate');
const operations=mutates[1].body.mutateOperations;
check(operations[1].campaignOperation.create.status==='PAUSED','New Search campaigns are paused by default');
check(operations[1].campaignOperation.create.advertisingChannelType==='SEARCH'&&operations.at(-1).adGroupAdOperation,'Search campaign includes responsive ad and linked budget/keywords');
check(operations[2].campaignCriterionOperation.create.location.geoTargetConstant==='geoTargetConstants/2682','New Search campaign targets Saudi Arabia');
check(!!report.googleAdsTestHelpers.period(null,'2026-10-01','2026-10-21'),'Campaign reports accept date ranges');
for(const source of [connections,adsPanel,connectionUi,app,paid])compile(source,'component.tsx');
check(connections.includes('GOOGLE_ADS_CLIENT_ID')&&connections.includes('googleAdsDiscover'),'Google OAuth uses Explorer-eligible Ads app credentials');
check(connections.includes("platform='youtube'")&&connections.includes("platform='google_ads'"),'Google Ads and YouTube have separate encrypted connection storage');
check(connectionUi.includes('save_google_ads_accounts')&&connectionUi.includes('selectedGoogleAdsAccounts'),'Google Ads account multi-selection is usable in connection UI');
check(app.includes('view === "report" ? <CampaignReportPage refreshToken={campaignRefreshToken} onLoadingChange={setCampaignReportLoading} />') && !app.includes('<PaidAdsPanel />') && paid.includes('<MetaAdsPanel />') && paid.includes('<GoogleAdsPanel />') && connectionUi.includes('provider.provider === "google_ads"'), 'Unified campaign report replaces duplicate paid tabs while Meta and Google connections stay available');
check(app.includes('const visiblePosts = useMemo(') && app.includes('const visibleEvents = useMemo('), 'Organic post and engagement lists retain their own pagination after moving paid campaign reports');
check(schema.includes('MARKETING_SCHEMA_VERSION = 3')&&schema.includes('MARKETING_SCHEMA_V3_SQL'),'Live database safely upgrades OAuth provider constraints');
check(!adsPanel.includes('META_ADS_ACCESS_TOKEN')&&paid.includes('setSelected'),'New Google UI is isolated with a unified provider filter');
console.log(`${passed}/${passed} Google Ads mocked API, campaign publishing, YouTube isolation and unified UI checks passed. No live provider calls.`);
