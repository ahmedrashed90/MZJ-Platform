'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const root = path.resolve(__dirname, '..');
const snapshotStore = new Map();
const queries = [];
const sql = async (strings, ...values) => {
  const query = strings.join('?').replace(/\s+/g, ' ').trim();
  queries.push({query, values});
  if (query.includes('insert into marketing.social_follower_snapshots')) {
    const [platform, channelId, name, batch] = values;
    for (const row of batch) snapshotStore.set(`${platform}:${channelId}:${row.date}`, {...row, channelId, platform, name});
    return [];
  }
  if (query.includes('from marketing.social_follower_snapshots')) {
    const [platform, channelId, from, to] = values;
    return [...snapshotStore.values()].filter(row => row.platform === platform && row.channelId === channelId && row.date >= from && row.date <= to)
      .sort((a,b) => a.date.localeCompare(b.date));
  }
  throw new Error('Unexpected SQL: ' + query);
};
sql.json = data => data;
const load = createLoader(root, {'./_db.js': {getSql: () => sql}});
const moduleUnderTest = load('server/_marketing-social-accounts.ts');
const oldFetch = global.fetch, oldKey = process.env.BULKPUBLISH_API_KEY, oldSnapKey = process.env.BULKPUBLISH_SNAPCHAT_API_KEY, oldSnapId = process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID;
process.env.BULKPUBLISH_API_KEY = 'fake-test-only-token';
process.env.BULKPUBLISH_SNAPCHAT_API_KEY = 'fake-snapchat-test-only-token';
delete process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID;
let providerCalls = [];
let failTikTok = false;
global.fetch = async (url, options) => {
  const parsed = new URL(url);
  providerCalls.push({path:parsed.pathname, params:Object.fromEntries(parsed.searchParams)});
  assert.equal(parsed.origin, 'https://app.bulkpublish.com');
  const token = options.headers.Authorization;
  assert(['Bearer fake-test-only-token', 'Bearer fake-snapchat-test-only-token'].includes(token));
  if (parsed.searchParams.get('platforms') === 'snapchat') assert.equal(token, 'Bearer fake-snapchat-test-only-token');
  if (parsed.searchParams.get('platforms') === 'tiktok') assert.equal(token, 'Bearer fake-test-only-token');
  const ok = json => ({ok:true, status:200, json:async()=>json});
  if (parsed.pathname === '/api/channels') return ok({channels:token === 'Bearer fake-test-only-token' ? [
    {id:2042, platform:'tiktok', isActive:true, needsReconnect:false, accountName:'@mzjcars'},
    {id:3010, platform:'instagram', isActive:true, accountName:'another'}
  ] : [{id:3011, platform:'snapchat', isActive:true, needsReconnect:false, accountName:'mzj_snap'}]});
  if (parsed.pathname === '/api/analytics/account' && parsed.searchParams.get('platforms') === 'snapchat') return ok({metrics:[
    {date:'2026-10-20',channelId:3011,platform:'snapchat',impressions:200,views:190},
    {date:'2026-10-21',channelId:3011,platform:'snapchat',impressions:210,views:197,reach:171}
  ],channels:[{id:3011,platform:'snapchat',accountName:'mzj_snap'}]});
  if (parsed.pathname === '/api/analytics/account') {
    if (failTikTok) return {ok:false,status:503,json:async()=>({error:'temporary outage'})};
    return ok({metrics:[
    {date:'2026-10-20',channelId:2042,platform:'tiktok',followers:13620},
    {date:'2026-10-21',channelId:2042,platform:'tiktok',followers:13642,following:0,
      impressions:10012,reach:0,profileViews:23,engagementRate:null,
      platformSpecific:{likesCount:32268,videoCount:480}}
  ],channels:[{id:2042,platform:'tiktok',accountName:'@mzjcars'}]});
  }
  if (parsed.pathname === '/api/analytics/engagement') return ok({posts:[
    {id:'post1',content:'first',likes:51,comments:7,shares:2,publishedAt:'2026-10-20',url:'https://example.com/1'},
    {id:'post2',content:'second',likes:71,comments:11,shares:6,publishedAt:'2026-10-21',url:'https://example.com/2'}
  ]});
  throw new Error('Unexpected remote API URL: '+parsed.pathname);
};
(async()=>{
  try {
    const range=moduleUnderTest.socialAnalyticsRange({dateFrom:'2026-10-19',dateTo:'2026-10-21'});
    assert.equal(range.dateFrom, '2026-10-19');
    await assert.rejects(async()=>moduleUnderTest.socialAnalyticsRange({dateFrom:'2026-10-23',dateTo:'2026-10-21'}));
    const result=await moduleUnderTest.marketingSocialAccountsOverview(sql,{...range,refresh:'1'});
    assert.equal(result.ok,true);
    assert.equal(result.tiktok.connected,true);
    assert.equal(result.tiktok.accounts.length,1,'Only active organic TikTok channels appear');
    assert.equal(result.snapchat.accounts.length,1, 'Snapchat channel appears separately');
    assert.equal(result.snapchat.accounts[0].connected,true);
    assert.equal(result.snapchat.accounts[0].followers,null,'Unprovided Snapchat followers stay unknown');
    assert.equal(result.snapchat.accounts[0].views,197);
    const account=result.tiktok.accounts[0];
    assert.equal(account.id,2042);
    assert.equal(account.name,'@mzjcars');
    assert.equal(account.followers,13642);
    assert.equal(account.dailyChange,22);
    assert.equal(account.monthlyChange,22);
    assert.equal(account.videoCount,480);
    assert.equal(account.likesCount,32268);
    assert.equal(account.impressions,10012);
    assert.equal(account.profileViews,23);
    assert.equal(account.snapshots.length,2);
    assert.equal(account.topPost.engagementTotal,88);
    assert.equal(account.topPost.permalink,'https://example.com/2');
    assert.equal(snapshotStore.size,2,'Daily follower values persist idempotently');
    failTikTok = true;
    // BulkPublish Free permits 30 calls/day, so the first refresh inside TTL
    // must reuse its cached value instead of hammering the API.
    const cached = await moduleUnderTest.marketingSocialAccountsOverview(sql,{...range,refresh:'1'});
    assert.equal(cached.tiktok.accounts[0].followers,13642);
    assert.equal(cached.tiktok.accounts[0].stale,false);
    const clock = Date.now;
    try {
      Date.now = () => clock() + 13 * 60 * 60_000;
      const outage = await moduleUnderTest.marketingSocialAccountsOverview(sql,{...range,refresh:'1'});
      assert.equal(outage.tiktok.accounts[0].followers,13642,'A temporary provider outage does not erase the last real follower count');
      assert.equal(outage.tiktok.accounts[0].stale,true,'Stale readings are explicitly identified');
    } finally { Date.now = clock; }
    failTikTok = false;
    assert(providerCalls.some(c=>c.path==='/api/analytics/account' && c.params.channelIds==='2042'));
    assert(providerCalls.some(c=>c.path==='/api/analytics/engagement' && c.params.platforms==='tiktok'));
    assert(!providerCalls.some(c=>c.path.includes('ads')),'Never use paid ads to represent organic followers');
    // A user-selected old range must not display a newer day as a historical reading.
    const oldPeriod=await moduleUnderTest.marketingSocialAccountsOverview(sql,{dateFrom:'2026-10-01',dateTo:'2026-10-05',refresh:'1'});
    const old=oldPeriod.tiktok.accounts[0];
    assert.equal(old.followers,null);
    assert.equal(old.dailyChange,null);
    assert.equal(old.snapshots.length,0);
    assert.equal(old.impressions,null);
    console.log('PASS: TikTok provider API read and known 2026-10-21 metric fields');
    console.log('PASS: Daily follower changes, provider post ranking, historical query windows');
    console.log('PASS: Organic channel isolation, server-side-only credentials and persistent snapshots');
    const noteSchema=fs.readFileSync(path.join(root,'server/_marketing-workflow-schema.ts'),'utf8');
    const migration=fs.readFileSync(path.join(root,'database/migrations/20261022_marketing_review_notes.sql'),'utf8');
    assert(noteSchema.includes('MARKETING_WORKFLOW_NOTES_SQL'));
    assert(noteSchema.includes('social_follower_snapshots'));
    assert(migration.includes('work_item_review_notes'));
    const ui=fs.readFileSync(path.join(root,'src/marketing/components/CompactFollowerChart.tsx'),'utf8');
    assert(ui.includes('height={108}') && ui.includes('followerDifference') && ui.includes('TopEngagedSocialPost'));
    const cards=fs.readFileSync(path.join(root,'src/marketing/pages/EngagementPage.tsx'),'utf8');
    assert(cards.includes('<ConnectedAccountsOverview') && cards.includes('<CompactFollowerChart'));
    assert(cards.includes('نمو الشهر المسجل') && cards.includes('عدد المحتوى المزامن') && cards.includes('إعجابات المنشورات'));
    console.log('PASS: Three account cards retain existing Meta labels and compact follower charts');
  } finally {
    global.fetch=oldFetch;
    if(oldKey===undefined)delete process.env.BULKPUBLISH_API_KEY;
    else process.env.BULKPUBLISH_API_KEY=oldKey;
    if(oldSnapKey===undefined)delete process.env.BULKPUBLISH_SNAPCHAT_API_KEY;
    else process.env.BULKPUBLISH_SNAPCHAT_API_KEY=oldSnapKey;
    if(oldSnapId===undefined)delete process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID;
    else process.env.BULKPUBLISH_SNAPCHAT_CHANNEL_ID=oldSnapId;
  }
})().catch(e=>{console.error(e);process.exitCode=1});
