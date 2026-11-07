'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const { windsorSnapchatAdsData } = createLoader(path.resolve(__dirname, '..'))('server/_marketing-windsor-snapchat.ts');
const originalFetch = global.fetch;
const oldKey = process.env.WINDSOR_SNAPCHAT_API_KEY;
const oldInterval = process.env.WINDSOR_SNAPCHAT_REFRESH_INTERVAL;
const rows = [{date:'2026-10-24',account_name:'Self Service',account_id:'snap-account-1',campaign:'2026-10-25 - Lead Generation Campaign',campaign_id:'snap-campaign-1',currency:'USD',spend:33.40,native_leads:74,clicks:245,source:'snapchat'}];
let requests = [];
const ok = () => ({ok:true,status:200,headers:new Headers(),json:async()=>({data:rows})});
const forbidden = () => ({ok:false,status:403,headers:new Headers(),json:async()=>({error:'not available'})});
(async()=>{
  try {
    process.env.WINDSOR_SNAPCHAT_API_KEY='fake-test-key-not-secret';
    process.env.WINDSOR_SNAPCHAT_REFRESH_INTERVAL='1h';
    global.fetch = async (url) => {
      const request = new URL(url); requests.push(request);
      assert.equal(request.searchParams.get('api_key'),'fake-test-key-not-secret');
      // A plan that rejects refresh_interval should not block ordinary loads.
      return request.searchParams.has('refresh_interval') ? forbidden() : ok();
    };
    let result = await windsorSnapchatAdsData('2026-10-24','2026-10-25',false);
    assert.equal(result.status,'ready');
    assert.equal(result.reports[0].campaigns[0].metrics.leads,74);
    assert.equal(requests.length,1);
    assert.equal(requests[0].searchParams.get('refresh_interval'),null,'ordinary report does not require optional provider refresh');
    assert.equal(requests[0].searchParams.get('refresh_since'),null);
    console.log('PASS configured hourly refresh cannot disconnect ordinary Snapchat report loads');

    result = await windsorSnapchatAdsData('2026-10-24','2026-10-25',true);
    assert.equal(requests.length,3,'forced refresh makes 1 failed provider attempt and 1 legacy retry');
    assert.equal(requests[1].searchParams.get('refresh_interval'),'1h');
    assert.equal(requests[1].searchParams.get('refresh_since'),'3d');
    assert.equal(requests[2].searchParams.get('refresh_interval'),null);
    assert.equal(requests[2].searchParams.get('refresh_since'),null);
    assert.equal(result.status,'ready');
    assert.equal(result.reports[0].campaigns[0].metrics.spend,33.40);
    assert(result.note.includes('HTTP 403'));
    assert(result.note.includes('قد تكون'));
    assert(!result.note.includes('fake-test-key-not-secret'));
    console.log('PASS refused provider refresh falls back to working Snapchat query and warns about possible staleness');

    result = await windsorSnapchatAdsData('2026-10-24','2026-10-25');
    assert.equal(requests.length,3,'cached fallback result must not spam provider repeatedly');
    assert(result.note.includes('قد تكون'));
    console.log('PASS cache preserves a clear stale-data warning after failed manual refresh');

    requests = [];
    global.fetch = async (url) => { requests.push(new URL(url)); return forbidden(); };
    await assert.rejects(() => windsorSnapchatAdsData('2026-10-23','2026-10-24',true), /Windsor.ai HTTP 403/);
    assert.equal(requests.length,4,'all configured and legacy fallback modes were exhausted');
    assert(requests.slice(1).every(req => req.searchParams.get('refresh_interval') === null));
    console.log('PASS genuine provider failure remains an error after safe fallback attempts');

    requests = [];
    global.fetch = async (url) => {
      const request=new URL(url); requests.push(request);
      if (request.searchParams.has('refresh_since')) throw new Error('Timeout');
      return ok();
    };
    result=await windsorSnapchatAdsData('2026-10-22','2026-10-24',true);
    assert.equal(result.status,'ready');
    assert.equal(requests.length,2);
    assert(result.note.includes('تعذر تطبيق'));
    console.log('PASS network/timeout on optional refresh also falls back to proven query');
  } finally {
    global.fetch=originalFetch;
    if(oldKey === undefined) delete process.env.WINDSOR_SNAPCHAT_API_KEY;
    else process.env.WINDSOR_SNAPCHAT_API_KEY=oldKey;
    if(oldInterval === undefined) delete process.env.WINDSOR_SNAPCHAT_REFRESH_INTERVAL;
    else process.env.WINDSOR_SNAPCHAT_REFRESH_INTERVAL=oldInterval;
  }
})().catch(error => { console.error(error); process.exitCode=1; });
