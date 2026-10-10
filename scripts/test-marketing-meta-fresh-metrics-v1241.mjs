/** Tests the Instagram like 0->1 refresh through the real module with mocked Graph/SQL. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = fs.readFileSync('server/_marketing-meta-sync.ts', 'utf8');
const script = ts.transpileModule(source, {fileName:'server/_marketing-meta-sync.ts', compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}, reportDiagnostics:true});
assert.equal(script.diagnostics?.length || 0,0,'Meta module should transpile without diagnostics');
const mod={exports:{}};
let busyVisibleLock = false;
let busyCronLock = false;
let recentLockCalls = 0;
new Function('require','module','exports',script.outputText)((id)=>{
  if (id==='./_db.js') return {getSql:()=>null,tryWithDatabaseAdvisoryLock:async(key,fn)=>{
    if (key === 'marketing:meta-visible-metrics') recentLockCalls++;
    return ((key === 'marketing:meta-visible-metrics' && busyVisibleLock) ||
      (key === 'marketing:meta-engagement-sync' && busyCronLock))
      ? {acquired:false} : {acquired:true,result:await fn()};
  }};
  if (id==='./_marketing-schema.js')return {ensureMarketingSchema:async()=>{}};
  if (id==='./_platform-connections.js')return {decryptPlatformToken:(token)=>token};
  throw Error(`Unexpected import ${id}`);
},mod,mod.exports);
const {refreshExternalMetaMetrics,autoRefreshExternalMetaMetrics}=mod.exports;
const igUUID='00000000-0000-4000-8000-000000000001';
const igId='17910769611525659';
const igAccount='17841401429976412';
const fbAccount='616836628446846';
let igLike=1;
let graphError=false;
let syncStateTouched=false;
const posts = new Map([[igUUID,{id:igUUID,platform:'instagram',account_id:igAccount,provider_post_id:igId,likes_count:0,comments_count:0,shares_count:null,is_deleted:false,last_synced_at:'2026-10-10T20:00:00Z',sync_status:'synced'}]]);
const accountRows=[
  {platform:'instagram',account_id:igAccount,ig_user_id:igAccount,account_name:'mzjcars',username:'mzjcars',connected:true,page_access_token_encrypted:'mock-token',scopes:['instagram_basic']},
  {platform:'facebook',account_id:fbAccount,page_id:fbAccount,account_name:'MZJ Cars',page_name:'MZJ Cars',connected:true,page_access_token_encrypted:'mock-token',scopes:['pages_read_engagement']},
];
let requestCount=0;
globalThis.fetch=async (url,options)=>{
  const request=new URL(url);
  assert.equal(options.headers.Authorization,'Bearer mock-token');
  assert.equal(request.searchParams.has('access_token'),false,'Never put Page tokens in URL');
  requestCount++;
  if(graphError) return {ok:false,status:401,json:async()=>({error:{message:'Invalid auth',code:190}})};
  const id=request.pathname.split('/').slice(2).join('/');
  if (id === igId) return {ok:true,status:200,json:async()=>({id:igId,like_count:igLike,comments_count:0})};
  if (id === `${igAccount}/media`) return {ok:true,status:200,json:async()=>({data:[{id:igId,timestamp:'2026-09-22T18:53:14+0000',caption:'توسان كومفورت 2026',media_type:'VIDEO',media_product_type:'REELS',permalink:'https://www.instagram.com/reel/DdmbDhVIR-W/',like_count:igLike,comments_count:0}]})};
  if (id === `${fbAccount}/posts`) return {ok:true,status:200,json:async()=>({data:[{id:`${fbAccount}_100`,created_time:'2026-09-22T18:53:14+0000',message:'Facebook',permalink_url:'https://facebook.com/post/100',reactions:{summary:{total_count:13}},comments:{summary:{total_count:0}},shares:{count:1}}]})};
  throw Error(`Unexpected Graph URL ${id}`);
};
async function sql(strings,...values){
  const query=strings.join(' ? ').replace(/\s+/g,' ').trim().toLowerCase();
  if(query.includes('marketing.meta_sync_state'))syncStateTouched=true;
  if(query.includes('from marketing.platform_connections'))return accountRows;
  if(query.startsWith('select id::text,platform,account_id,provider_post_id from marketing.meta_external_posts')){
    return [...posts.values()].filter(p=>values[0].includes(p.id)&&!p.is_deleted);
  }
  if(query.startsWith('update marketing.meta_external_posts set likes_count=coalesce')){
    const row=posts.get(values[3]); assert.ok(row,'Targeted update must use the saved post UUID');
    if(values[0]!==null)row.likes_count=values[0];
    if(values[1]!==null)row.comments_count=values[1];
    if(values[2]!==null)row.shares_count=values[2];
    row.last_synced_at='2026-10-11T00:00:00Z';row.sync_status='synced';row.sync_error=null;
    return [];
  }
  if(query.startsWith('update marketing.meta_external_posts set sync_status=')){
    const row=posts.get(values[1]);if(row){row.sync_status='failed';row.sync_error=values[0];}return [];
  }
  if(query.startsWith('insert into marketing.meta_external_posts(')){
    for(const item of JSON.parse(values[0])){
      const match=[...posts.values()].find(p=>p.platform===item.platform&&p.account_id===item.account_id&&p.provider_post_id===item.provider_post_id);
      if(match){match.likes_count=item.likes_count ?? match.likes_count;match.comments_count=item.comments_count ?? match.comments_count;match.shares_count=item.shares_count ?? match.shares_count;match.last_synced_at='2026-10-11T00:10:00Z';match.sync_status='synced';}
      else posts.set(`new:${item.provider_post_id}`,{...item,id:`new:${item.provider_post_id}`,is_deleted:false});
    }
    return [];
  }
  throw Error(`Unexpected SQL ${query.slice(0,180)}`);
}

const direct=await refreshExternalMetaMetrics(sql,[igUUID]);
assert.equal(direct.updated,1);
assert.equal(direct.failed,0);
assert.equal(direct.results[0].likes,1);
assert.equal(direct.results[0].comments,0);
assert.equal(posts.get(igUUID).likes_count,1,'Instagram like count should be updated from 0 to 1');
assert.equal(posts.get(igUUID).sync_status,'synced');
assert.equal(syncStateTouched,false,'Single-post refresh cannot reset or advance archive cursor');
console.log('PASS Tuscon Instagram reel like_count 0 -> 1 through saved provider media ID');

graphError=true;
const before=posts.get(igUUID).last_synced_at;
const errorCase=await refreshExternalMetaMetrics(sql,[igUUID]);
assert.equal(errorCase.updated,0);
assert.equal(errorCase.failed,1);
assert.equal(posts.get(igUUID).likes_count,1,'Graph failure must preserve last good count');
assert.equal(posts.get(igUUID).last_synced_at,before,'Graph failure must not claim a new successful reading');
assert.equal(posts.get(igUUID).sync_status,'failed');
console.log('PASS Graph failures preserve last valid counts and last successful read time');

graphError=false;igLike=2;
const recent=await refreshExternalMetaMetrics(sql);
assert.equal(recent.failed,0);
assert.equal(recent.updated,2);
assert.equal(posts.get(igUUID).likes_count,2);
assert.equal(syncStateTouched,false,'Recent refresh must not alter archive progress');
assert.ok(requestCount>=4);
console.log('PASS Overview refresh updates Instagram and Facebook recent posts independently of archive');

igLike=3;
const beforeAutoCalls=requestCount;
const auto=await autoRefreshExternalMetaMetrics(sql,[igUUID]);
assert.equal(auto.skipped,false,'Opening page must initiate recent Meta refresh automatically');
assert.equal(auto.updated,1);
assert.equal(posts.get(igUUID).likes_count,3);
assert.equal(recentLockCalls,1);
assert.ok(requestCount>beforeAutoCalls);
console.log('PASS Opening engagement page updates the Tuscon reel automatically with bounded Graph pages');

busyVisibleLock=true;
const beforeBusy=requestCount;
const overlapping=await autoRefreshExternalMetaMetrics(sql,[igUUID]);
assert.equal(overlapping.skipped,true,'Simultaneous scheduled/automatic refresh must not duplicate Graph requests');
assert.equal(overlapping.updated,0);
assert.equal(requestCount,beforeBusy);
console.log('PASS A second page refresh yields while another visible refresh is in progress');
busyVisibleLock=false;
busyCronLock=true; igLike=4;
const duringCron=await autoRefreshExternalMetaMetrics(sql,[igUUID]);
assert.equal(duringCron.skipped,false,'Visible metrics must not wait for historical Cron import');
assert.equal(posts.get(igUUID).likes_count,4);
console.log('PASS Instagram like refresh runs even while archival Cron has its own lock');
busyCronLock=false;
busyVisibleLock=false;

const ui=fs.readFileSync('src/marketing/pages/EngagementPage.tsx','utf8');
const api=fs.readFileSync('server/marketing/index.ts','utf8');
const acl=fs.readFileSync('server/_api-permissions.ts','utf8');
assert.ok(ui.includes('refresh_meta_engagement_metrics')&&ui.includes('refreshMetaPost(row)'));
assert.ok(ui.includes('row.last_synced_at'));
assert.ok(ui.includes('openedAutoRefresh.current') && ui.includes('automatic: true, ids'));
assert.ok(ui.includes('visibleMetaPostIds(data?.rows || [])'));
assert.ok(ui.includes('applyDirectMetaResults(refreshed)'));
assert.ok(ui.includes('setAutoRefreshDetail(detail') && ui.includes('AUTO_META_RETRY_DELAY_MS')); 
assert.ok(ui.includes('mountedPage.current') && ui.includes('await load(true)'));
assert.ok(api.includes('initialBody.automatic === true') && api.includes('autoRefreshExternalMetaMetrics(sql, arrayValue<string>(initialBody.ids)')); 
assert.ok(api.includes("action==='refresh_meta_engagement_metrics'"));
assert.ok(acl.includes('refresh_meta_engagement_metrics: "marketing.engagement.refresh"'));
assert.ok(!source.includes('update marketing.published_posts') && !source.includes('insert into marketing.published_posts'),'External refresh must not write publishing records');
console.log('PASS UI, API action, permission and publishing/CRM isolation contracts');
