/** API/DB contract simulation, no live Meta tokens or production database required. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const js = ts.transpileModule(fs.readFileSync('server/_marketing-meta-sync.ts','utf8'),{
  fileName: 'server/_marketing-meta-sync.ts',
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const mod={exports:{}};
new Function('require','module','exports',js)((id)=>{
  if(id==='./_db.js')return {getSql:()=>null,withDatabaseAdvisoryLock:async (_,callback)=>callback()};
  if(id==='./_marketing-schema.js')return {ensureMarketingSchema:async()=>{}};
  if(id==='./_platform-connections.js')return {decryptPlatformToken:token=>token};
  throw Error(id);
},mod,mod.exports);
const {syncMetaEngagement,metaAccountData}=mod.exports;
const states=new Map(),posts=new Map(),snapshots=new Map(),requests=[];
const accountRows=[
  {platform:'facebook',account_id:'616836628446846',page_id:'616836628446846',account_name:'MZJ Cars',page_name:'MZJ Cars',connected:true,page_access_token_encrypted:'mock-page-token',scopes:['read_insights']},
  {platform:'instagram',account_id:'17841401429976412',ig_user_id:'17841401429976412',account_name:'mzjcars',username:'mzjcars',connected:true,page_access_token_encrypted:'mock-page-token',scopes:['instagram_basic']},
];
const key=(p,a)=>`${p}:${a}`;
async function sql(strings,...values){
  const query=strings.join(' ? ').replace(/\s+/g,' ').trim().toLowerCase();
  if(query.startsWith('select platform,account_id,account_name,page_id')&&query.includes('marketing.platform_connections'))return accountRows;
  if(query.startsWith('insert into marketing.meta_sync_state')){
    const id=key(values[0],values[1]);
    if(!states.has(id))states.set(id,{platform:values[0],account_id:values[1],next_after:null,backfill_complete:false,last_error:null,last_success_at:null});
    return [ {...states.get(id)} ];
  }
  if(query.startsWith('insert into marketing.meta_follower_snapshots')){
    snapshots.set(key(values[0],values[1]),{platform:values[0],account_id:values[1],account_name:values[2],snapshot_date:'2026-10-11',followers_count:values[3],fan_count:values[4],media_count:values[5]});
    return [];
  }
  if(query.startsWith('insert into marketing.meta_external_posts')){
    const id=key(values[0],`${values[1]}:${values[2]}`);
    const existing=posts.get(id)||{};
    posts.set(id,{...existing,id,platform:values[0],account_id:values[1],provider_post_id:values[2],provider_media_id:values[3],caption:values[4],permalink:values[5],post_type_name:values[6],published_at:values[7],likes_count:values[8],comments_count:values[9],shares_count:values[10],last_synced_at:new Date().toISOString(),is_deleted:false});
    return [];
  }
  if(query.startsWith('update marketing.meta_sync_state')){
    if(query.includes('next_after=')){
      const id=key(values[3],values[4]);
      const row=states.get(id);
      Object.assign(row,{next_after:values[0],backfill_complete:values[1],last_error:values[2],last_success_at:'2026-10-11T09:00:00Z'});
      return [];
    }
    if(query.includes('last_recent_at')){
      const id=key(values[1],values[2]);const row=states.get(id);Object.assign(row,{last_error:values[0],last_success_at:'2026-10-11T09:00:00Z'});return [];
    }
    return [];
  }
  if(query.startsWith('select id::text,provider_post_id from marketing.meta_external_posts')){
    return [...posts.values()].filter(item=>item.platform===values[0]&&item.account_id===values[1]).slice(0,values[2]).map(x=>({id:x.id,provider_post_id:x.provider_post_id}));
  }
  if(query.startsWith('update marketing.meta_external_posts'))return [];
  if(query.startsWith('select platform,coalesce')&&query.includes('marketing.platform_connections'))return accountRows;
  if(query.startsWith('select platform,account_id,account_name,snapshot_date::text'))return [...snapshots.values()];
  if(query.startsWith('select platform,account_id,backfill_complete'))return [...states.values()];
  if(query.startsWith('select platform,account_id,count(*)::integer'))return accountRows.map(x=>({platform:x.platform,account_id:x.account_id,discovered_count:[...posts.values()].filter(p=>p.platform===x.platform&&p.account_id===x.account_id).length}));
  throw Error(`Unrecognized SQL contract: ${query.slice(0,180)}`);
}
const fb=(id,likes,shares)=>({id,created_time:'2026-08-26T20:30:03+0000',message:`Car ${id}`,permalink_url:`https://facebook.com/${id}`,attachments:{data:[{media_type:'photo',target:{id:id.split('_').pop()}}]},reactions:{summary:{total_count:likes}},comments:{summary:{total_count:0}},...(shares===null?{}:{shares:{count:shares}})});
const ig=(id,likes)=>({id,timestamp:'2026-09-22T20:19:00+0000',caption:'Suzuki',media_type:'VIDEO',permalink:`https://instagram.com/reel/${id}/`,like_count:likes,comments_count:0});
const fakeFetch=async (url,options)=>{
  const request=new URL(url);
  assert.equal(options.headers.Authorization,'Bearer mock-page-token');
  assert.equal(request.searchParams.has('access_token'),false,'Token must never appear in URL');
  requests.push(`${request.pathname}?${request.searchParams.toString()}`);
  const id=request.pathname.split('/').slice(2).join('/');
  let payload;
  if(id==='616836628446846'&&request.searchParams.get('fields')?.includes('followers_count'))payload={id:'616836628446846',name:'MZJ Cars',followers_count:2566,fan_count:2566};
  else if(id==='17841401429976412'&&request.searchParams.get('fields')?.includes('followers_count'))payload={id:'17841401429976412',username:'mzjcars',followers_count:22906,media_count:2101};
  else if(id==='616836628446846/posts'){
    payload=request.searchParams.has('after')?{data:[fb('616836628446846_3',5,1)]}:{data:[fb('616836628446846_1',13,1),fb('616836628446846_2',0,null)],paging:{cursors:{after:'FB_NEXT'},next:'https://example.test/next'}};
  }
  else if(id==='17841401429976412/media'){
    payload=request.searchParams.has('after')?{data:[ig('ig_3',2)]}:{data:[ig('ig_1',1),ig('ig_2',0)],paging:{cursors:{after:'IG_NEXT'},next:'https://example.test/next'}};
  }
  else if(id.endsWith('/insights'))payload={data:[{name:'reach',values:[{value:100}]}]};
  else if(id==='616836628446846_1'||id==='616836628446846_2'||id==='616836628446846_3')payload=fb(id,13,1);
  else if(id.startsWith('ig_'))payload=ig(id,1);
  else throw Error(`Unexpected fake Graph request: ${id}`);
  return {ok:true,status:200,json:async()=>payload};
};
globalThis.fetch=fakeFetch;
const first=await syncMetaEngagement(sql);
assert.equal(first.ok,true);
assert.equal(first.accounts.length,2);
assert.equal(first.accounts.every(x=>!x.backfillComplete),true);
assert.equal(posts.size,4,'Recent and historical first pages must not create duplicates');
assert.equal(posts.get(key('facebook','616836628446846:616836628446846_2')).shares_count,null,'Absent shares must remain unknown');
assert.equal(states.get(key('facebook','616836628446846')).next_after,'FB_NEXT');
const second=await syncMetaEngagement(sql);
assert.equal(posts.size,6,'Second historical cursor adds only new posts');
assert.equal(second.accounts.every(x=>x.backfillComplete),true);
const third=await syncMetaEngagement(sql);
assert.equal(third.accounts.every(x=>x.backfillComplete),true);
assert.equal(posts.size,6,'Repeated recent sync does not duplicate records');
assert.ok(requests.some(x=>x.includes('616836628446846_1?fields=')),'Older post metric rotation must fetch individual content');
const accounts=await metaAccountData(sql);
assert.equal(accounts.length,2);
assert.equal(accounts.find(x=>x.platform==='facebook').followers,2566);
assert.equal(accounts.find(x=>x.platform==='instagram').followers,22906);
assert.equal(accounts.find(x=>x.platform==='instagram').discoveredCount,3);
assert.equal(accounts[0].monthlyChange,null,'Do not invent follower growth without history');
console.log('PASS Meta followers, normalized stats, first backfill, cursor progression, dedupe, old post refresh, scope isolation, sanitized token transport');
console.log('PASS Mocked integration: 2 accounts, 3 runs, 6 unique posts');
