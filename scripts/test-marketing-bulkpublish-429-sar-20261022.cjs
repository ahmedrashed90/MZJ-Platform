'use strict';
/* Offline end-to-end regression for the deployed 429 + USD/SAR issues. */
const assert=require('node:assert/strict');
const {createLoader}=require('./marketing-workflow-test-support.cjs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const oldFetch=global.fetch,oldKey=process.env.BULKPUBLISH_API_KEY,oldSnapKey=process.env.BULKPUBLISH_SNAPCHAT_API_KEY,oldSnapId=process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID;
const clock=Date.now;
const cachedRows=new Map(), snapshots=new Map();
const metricsTiktok=[
  {date:'2026-10-20',channelId:2042,platform:'tiktok',followers:13620},
  {date:'2026-10-21',channelId:2042,platform:'tiktok',followers:13642,platformSpecific:{likesCount:300,videoCount:200},impressions:1200},
];
const activeChannels={channels:[
  {id:2042,platform:'tiktok',isActive:true,needsReconnect:false,accountName:'@mzjcars'},
  {id:3101,platform:'snapchat',isActive:true,needsReconnect:false,accountName:'mzj_snap'},
]};
let blockTikTok=false,providerCalls=[];
const sql=async (strings,...values)=>{
  const query=strings.join('?').replace(/\s+/g,' ').trim();
  if(query.startsWith('select payload, extract(epoch')) {
    const r=cachedRows.get(values[0]);
    return r?[{payload:r.payload,fetched_ms:r.fetchedMs,blocked_ms:r.blockedMs}]:[];
  }
  if(query.startsWith('insert into marketing.social_bulkpublish_read_cache (cache_key,blocked_until)') && query.includes('returning cache_key')) {
    const [key,until]=values,existing=cachedRows.get(key);
    if(existing?.blockedMs>Date.now())return [];
    cachedRows.set(key,{payload:existing?.payload||null,fetchedMs:existing?.fetchedMs||0,blockedMs:Date.parse(until)});
    return [{cache_key:key}];
  }
  if(query.startsWith('insert into marketing.social_bulkpublish_read_cache (cache_key,payload')) {
    const [key,payload,fetched,until]=values;
    cachedRows.set(key,{payload,fetchedMs:Date.parse(fetched),blockedMs:Date.parse(until)});
    return [];
  }
  if(query.startsWith('insert into marketing.social_bulkpublish_read_cache (cache_key,blocked_until,last_status)')) {
    const [key,until]=values,r=cachedRows.get(key);
    cachedRows.set(key,{payload:r?.payload||null,fetchedMs:r?.fetchedMs||0,blockedMs:Math.max(r?.blockedMs||0,Date.parse(until))});
    return [];
  }
  if(query.includes('insert into marketing.social_follower_snapshots')) {
    const [platform,id,name,rows]=values;
    for(const r of rows)snapshots.set(`${platform}:${id}:${r.date}`,{date:r.date,platform,id,name,followers:r.followers});
    return [];
  }
  if(query.includes('select distinct on (platform,channel_id)')) {
    const seen=new Map();for(const snap of snapshots.values())seen.set(`${snap.platform}:${snap.id}`,snap);
    return [...seen.values()].map(x=>({platform:x.platform,channel_id:x.id,account_name:x.name}));
  }
  if(query.includes('from marketing.social_follower_snapshots')) {
    const [platform,id,from,to]=values;
    return [...snapshots.values()].filter(r=>r.platform===platform && r.id===id && r.date>=from && r.date<=to).sort((a,b)=>a.date.localeCompare(b.date));
  }
  throw Error('unexpected SQL: '+query);
};
sql.json=x=>x;
const fakeProvider=async (url,options)=>{
  const parsed=new URL(url);providerCalls.push(parsed.pathname);
  const token=options.headers.Authorization;
  assert(['Bearer valid-test-key','Bearer valid-snapchat-test-key'].includes(token));
  if(parsed.searchParams.get('platforms')==='tiktok')assert.equal(token,'Bearer valid-test-key');
  if(parsed.searchParams.get('platforms')==='snapchat')assert.equal(token,'Bearer valid-snapchat-test-key');
  const ok=body=>({ok:true,status:200,headers:new Headers(),json:async()=>body});
  if(blockTikTok && token==='Bearer valid-test-key')return {ok:false,status:429,headers:new Headers({'retry-after':'3600'}),json:async()=>({error:'rate limited'})};
  if(parsed.pathname==='/api/channels')return ok({channels:activeChannels.channels.filter(c=>c.platform===(token==='Bearer valid-test-key'?'tiktok':'snapchat'))});
  if(parsed.pathname==='/api/analytics/account'){
    if(parsed.searchParams.get('platforms')==='tiktok')return ok({metrics:metricsTiktok});
    if(parsed.searchParams.get('platforms')==='snapchat')return ok({metrics:[{date:'2026-10-21',channelId:3101,platform:'snapchat',impressions:300,views:220}]});
  }
  if(parsed.pathname==='/api/analytics/engagement')return ok({posts:[]});
  throw Error('unrecognized provider path');
};
function load(){return createLoader(root,{'./_db.js':{getSql:()=>sql}})('server/_marketing-social-accounts.ts');}
const range={dateFrom:'2026-10-20',dateTo:'2026-10-21',refresh:'1'};
(async()=>{
  try{
    process.env.BULKPUBLISH_API_KEY='valid-test-key';process.env.BULKPUBLISH_SNAPCHAT_API_KEY='valid-snapchat-test-key';delete process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID;global.fetch=fakeProvider;
    const v1=load();
    const good=await v1.marketingSocialAccountsOverview(sql,range);
    assert.equal(good.tiktok.accounts[0].followers,13642);
    assert.equal(good.tiktok.accounts[0].connected,true);
    assert.equal(good.snapchat.accounts[0].connected,true);
    assert.equal(good.snapchat.accounts[0].views,220);
    assert.equal(providerCalls.length,6,'Two independent channel lists + account and engagement per platform');
    // Same page refresh/new date filter may not generate new billable requests.
    await v1.marketingSocialAccountsOverview(sql,{...range,dateFrom:'2026-10-01'});
    assert.equal(providerCalls.length,6,'Changing date filters reuses stable upstream query/cache');
    // Simulate a different Vercel serverless instance: it MUST use persistent DB cache.
    const cold=load();
    const coldValue=await cold.marketingSocialAccountsOverview(sql,range);
    assert.equal(providerCalls.length,6,'Cold Vercel instance uses the shared DB cache');
    assert.equal(coldValue.tiktok.accounts[0].connected,true);
    // Simulate cache expiry then actual upstream 429. Must NOT turn 200-state
    // TikTok/Snapchat into disconnected accounts or erase TikTok followers.
    Date.now=()=>clock()+13*60*60_000;
    blockTikTok=true;
    const quota=await cold.marketingSocialAccountsOverview(sql,range);
    assert.equal(quota.tiktok.accounts[0].connected,true);
    assert.equal(quota.tiktok.accounts[0].connectionVerified,true);
    assert.equal(quota.snapchat.accounts[0].connected,true);
    assert.equal(quota.tiktok.accounts[0].followers,13642);
    assert.equal(quota.tiktok.accounts[0].stale,true);
    assert(quota.tiktok.accounts[0].note.includes('429'));
    assert.equal(providerCalls.length,10,'TikTok 429 blocks only TikTok; Snapchat independently refreshes its channel/analytics');
    const coldQuota=load();
    const again=await coldQuota.marketingSocialAccountsOverview(sql,range);
    assert.equal(providerCalls.length,10,'New cold instance obeys TikTok-only 429 cooldown and caches Snapchat results');
    assert.equal(again.tiktok.accounts[0].connected,true);
    assert.equal(again.tiktok.accounts[0].followers,13642);
    assert.equal(again.snapchat.accounts[0].connected,true);
    console.log('PASS organic: cache survives cold Vercel instances and blocks repeated BulkPublish 429 calls');
    console.log('PASS organic: 429 never fabricates inactive TikTok status or deletes last follower counts');
    console.log('PASS organic: Snapchat analytics and campaign paths remain independent');
    console.log('PASS organic: historical date changes do not multiply connector requests');
  }finally{
    global.fetch=oldFetch; Date.now=clock;
    if(oldKey===undefined)delete process.env.BULKPUBLISH_API_KEY;else process.env.BULKPUBLISH_API_KEY=oldKey;
    if(oldSnapKey===undefined)delete process.env.BULKPUBLISH_SNAPCHAT_API_KEY;else process.env.BULKPUBLISH_SNAPCHAT_API_KEY=oldSnapKey;
    if(oldSnapId===undefined)delete process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID;else process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID=oldSnapId;
  }
})().catch(e=>{console.error(e);process.exitCode=1});
