'use strict';
/** Offline provider isolation regression. No secrets, production APIs or DB connections. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const root = path.resolve(__dirname, '..');
const variables = ['BULKPUBLISH_API_KEY', 'BULKPUBLISH_TIKTOK_CHANNEL_ID',
  'BULKPUBLISH_SNAPCHAT_API_KEY', 'BULKPUBLISH_SNAPCHAT_CHANNEL_ID'];
const originalEnvironment = Object.fromEntries(variables.map(name => [name, process.env[name]]));
const previousFetch = global.fetch;
const calls = [];
const dbCache = new Map(), followerHistory = new Map();
let blockSnapchat = false;
const sql = async (strings, ...values) => {
  const query = strings.join('?').replace(/\s+/g, ' ').trim();
  if (query.startsWith('select payload, extract(epoch')) {
    const record = dbCache.get(values[0]);
    return record ? [{ payload:record.payload, fetched_ms:record.fetchedMs,
      blocked_ms:record.blockedMs, last_status:record.lastStatus }] : [];
  }
  if (query.startsWith('insert into marketing.social_bulkpublish_read_cache (cache_key,blocked_until)') && query.includes('returning cache_key')) {
    const [key, until] = values, previous = dbCache.get(key);
    if (previous?.blockedMs > Date.now()) return [];
    dbCache.set(key, { payload:previous?.payload || null, fetchedMs:previous?.fetchedMs || 0,
      blockedMs:Date.parse(until), lastStatus:previous?.lastStatus });
    return [{cache_key:key}];
  }
  if (query.startsWith('insert into marketing.social_bulkpublish_read_cache (cache_key,payload')) {
    const [key, payload, fetched, until] = values;
    dbCache.set(key,{payload,fetchedMs:Date.parse(fetched),blockedMs:Date.parse(until),lastStatus:200});
    return [];
  }
  if (query.startsWith('insert into marketing.social_bulkpublish_read_cache (cache_key,blocked_until,last_status)')) {
    const [key, until, status] = values, old = dbCache.get(key);
    dbCache.set(key,{payload:old?.payload || null,fetchedMs:old?.fetchedMs || 0,
      blockedMs:Math.max(old?.blockedMs || 0,Date.parse(until)),lastStatus:status});
    return [];
  }
  if (query.includes('insert into marketing.social_follower_snapshots')) {
    const [platform,id,name,rows] = values;
    for (const row of rows) followerHistory.set(`${platform}:${id}:${row.date}`,
      {date:row.date,platform,channel_id:id,account_name:name,followers:row.followers});
    return [];
  }
  if (query.includes('select distinct on (platform,channel_id)')) {
    const wanted = values[0];
    const latest = new Map();
    for (const record of followerHistory.values()) if (record.platform === wanted)
      latest.set(`${record.platform}:${record.channel_id}`,record);
    return [...latest.values()];
  }
  if (query.includes('from marketing.social_follower_snapshots')) {
    const [platform,id,from,to] = values;
    return [...followerHistory.values()].filter(r=>r.platform===platform && r.channel_id===id && r.date>=from && r.date<=to)
      .sort((a,b)=>a.date.localeCompare(b.date));
  }
  throw Error('Unexpected SQL: '+query);
};
sql.json = x => x;
const ok = data => ({ok:true,status:200,headers:new Headers(),json:async()=>data});
const service = async (url, options) => {
  const parsed = new URL(url);
  assert.equal(parsed.origin,'https://app.bulkpublish.com');
  const auth = options.headers.Authorization;
  calls.push({auth,pathname:parsed.pathname,platform:parsed.searchParams.get('platforms')});
  assert(['Bearer tik-only-secret', 'Bearer snap-only-secret', 'Bearer snap-blocked-secret'].includes(auth));
  if (blockSnapchat && auth === 'Bearer snap-blocked-secret') {
    return {ok:false,status:429,headers:new Headers({'retry-after':'3600'}),json:async()=>({error:'rate limit'})};
  }
  const isSnap = auth !== 'Bearer tik-only-secret';
  if (parsed.pathname==='/api/channels') return ok({channels: isSnap ? [
    {id:3210,platform:'snapchat',isActive:true,needsReconnect:false,accountName:'Snapchat MZJ'},
    {id:9999,platform:'tiktok',isActive:true,accountName:'unrelated TikTok'}
  ] : [{id:2042,platform:'tiktok',isActive:true,needsReconnect:false,accountName:'@mzjcars'}]});
  if (parsed.pathname==='/api/analytics/account') {
    assert.equal(parsed.searchParams.get('platforms'),isSnap?'snapchat':'tiktok');
    assert.equal(parsed.searchParams.get('channelIds'),isSnap?'3210':'2042');
    return ok({metrics:[{date:'2026-10-21',channelId:isSnap?3210:2042,
      platform:isSnap?'snapchat':'tiktok',followers:isSnap?1200:13642,
      impressions:isSnap?760:500}]});
  }
  if (parsed.pathname==='/api/analytics/engagement') {
    assert.equal(parsed.searchParams.get('platforms'),isSnap?'snapchat':'tiktok');
    return ok({posts:[]});
  }
  throw Error('Unexpected BulkPublish path '+parsed.pathname);
};
const moduleUnderTest = createLoader(root, {'./_db.js':{getSql:()=>sql}})('server/_marketing-social-accounts.ts');
const range = {dateFrom:'2026-10-20',dateTo:'2026-10-21'};
(async () => {
  try {
    global.fetch=service;
    process.env.BULKPUBLISH_API_KEY='tik-only-secret';
    process.env.BULKPUBLISH_TIKTOK_CHANNEL_ID='2042';
    delete process.env.BULKPUBLISH_SNAPCHAT_API_KEY;
    delete process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID;
    let result=await moduleUnderTest.marketingSocialAccountsOverview(sql,range);
    assert.equal(result.tiktok.connected,true);
    assert.equal(result.tiktok.accounts[0].followers,13642);
    assert.equal(result.snapchat.connected,false);
    assert.match(result.snapchat.note,/BULKPUBLISH_SNAPCHAT_API_KEY/);
    assert.equal(calls.length,3,'Missing Snapchat key must not attempt Snapchat requests using TikTok key');
    assert(calls.every(call=>call.auth==='Bearer tik-only-secret'));

    process.env.BULKPUBLISH_SNAPCHAT_API_KEY='tik-only-secret';
    result=await moduleUnderTest.marketingSocialAccountsOverview(sql,range);
    assert.match(result.snapchat.note,/يطابق مفتاح TikTok/,'Reusing the TikTok key for Snapchat must be rejected');
    assert.equal(result.tiktok.connected,true);
    assert.equal(calls.length,3,'A copied TikTok key must not trigger Snapchat reads');

    process.env.BULKPUBLISH_SNAPCHAT_API_KEY='snap-only-secret';
    process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID='3210';
    result=await moduleUnderTest.marketingSocialAccountsOverview(sql,range);
    assert.equal(result.tiktok.connected,true);
    assert.equal(result.snapchat.connected,true);
    assert.equal(result.snapchat.accounts.length,1);
    assert.equal(result.snapchat.accounts[0].id,3210);
    assert.equal(result.snapchat.accounts[0].followers,1200);
    assert.equal(calls.length,6,'Adding Snapchat key adds three independent calls and reuses TikTok cache');
    assert.equal(calls.filter(call=>call.auth==='Bearer tik-only-secret').length,3);
    assert.equal(calls.filter(call=>call.auth==='Bearer snap-only-secret').length,3);
    assert.equal(followerHistory.size,2,'Followers saved under the correct platform/account');

    process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID='invalid-id';
    result=await moduleUnderTest.marketingSocialAccountsOverview(sql,range);
    assert(result.snapchat.note.includes('BULKPUBLISH_SNAPCHAT_CHANNEL_ID'));
    assert.equal(result.tiktok.connected,true,'Wrong Snapchat ID cannot disconnect TikTok');
    assert.equal(calls.length,6,'Invalid selector must not contact the provider');

    process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID='55555';
    result=await moduleUnderTest.marketingSocialAccountsOverview(sql,range);
    assert.equal(result.snapchat.accounts.length,0);
    assert.match(result.snapchat.note,/55555/);
    assert.equal(result.tiktok.accounts[0].followers,13642);

    process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID='3210';
    process.env.BULKPUBLISH_SNAPCHAT_API_KEY='snap-blocked-secret';
    blockSnapchat=true;
    result=await moduleUnderTest.marketingSocialAccountsOverview(sql,range);
    assert.equal(result.tiktok.connected,true);
    assert.equal(result.tiktok.accounts[0].followers,13642);
    assert.match(result.snapchat.note,/429/,'Snapchat token may hit 429 independently');
    assert.equal(calls.filter(call=>call.auth==='Bearer snap-blocked-secret').length,1,'429 sets the Snapchat credential cooldown');
    assert.equal(result.tiktok.accounts[0].connectionVerified,true);
    assert(!result.tiktok.accounts[0].note.includes('429'),'Snapchat warning must not be applied to TikTok');

    delete process.env.BULKPUBLISH_API_KEY;
    process.env.BULKPUBLISH_SNAPCHAT_API_KEY='snap-only-secret';
    blockSnapchat=false;
    result=await moduleUnderTest.marketingSocialAccountsOverview(sql,range);
    assert.match(result.tiktok.note,/BULKPUBLISH_API_KEY/);
    assert.equal(result.snapchat.accounts[0].connected,true,'Snapchat must not depend on TikTok credential');
    assert.equal(result.snapchat.accounts[0].followers,1200);
    console.log('PASS: TikTok and Snapchat authenticate using different BulkPublish API keys');
    console.log('PASS: Missing/invalid Snapchat settings never change TikTok analytics');
    console.log('PASS: Both platforms use independent channel discovery and account analytics');
    console.log('PASS: Snapchat 429 does not change TikTok connection state or show TikTok errors');
    console.log('PASS: Independent keys are server-side only; follower histories stay per platform');
  } finally {
    global.fetch=previousFetch;
    for (const name of variables) {
      if (originalEnvironment[name]===undefined)delete process.env[name];
      else process.env[name]=originalEnvironment[name];
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1});
