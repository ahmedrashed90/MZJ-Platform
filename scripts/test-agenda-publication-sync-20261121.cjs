'use strict';
/** Marketing agenda sync phase 1: pure-data contract + Google Drive binary bridge.
 * All SQL/HTTP calls are mocked. This test must never touch live systems. */
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const planId = id(1), taskA = id(2), taskB = id(3);
const productA = id(4), productB = id(5), productC = id(6);
const lineA = id(7), lineB = id(8), lineC = id(9);
const postReel = id(10), postTikTok = id(11), postPhoto = id(12), formatReel = id(13), fileId = id(14);
const calls = [];
let bytesFetched = 0;
const stubs = {
  '../_google-drive-storage.js': {
    openGoogleDriveFile: async () => { bytesFetched++; return new Response('REAL-BINARY-MEDIA', {headers:{'Content-Type':'video/mp4','Content-Length':'17'}}); },
  },
};
const lib = createLoader(process.cwd(), stubs)('server/marketing/agenda-publication-sync.ts');
const sql = async (parts, ...args) => {
  const q = parts.join('?').replace(/\s+/g,' ').toLowerCase();
  calls.push({q,args});
  if (q.includes('from marketing.work_plans p join marketing.agendas ag')) return [{
    id:planId,plan_no:'AGD-000031',name:'أجندة ديسمبر',review_status:'publishing',
    agenda_from:'2026-12-01',agenda_to:'2026-12-31',updated_at:'2026-11-21T00:00:00Z',
  }];
  if (q.includes('from marketing.work_plan_items l join marketing.work_items i')) return [
    {line_id:lineA,product_id:productA,post_type_id:postReel,task_id:taskA,client_key:id(200),
      task_no:'TSK-000224',task_name:'فيديو',requirement_number:1,idea_name:'فيديو سيارة',media_kind:'video',
      post_type_name:'Reels',post_width:1080,post_height:1920,platform_id:id(101),platform_name:'Instagram',platform_code:'instagram',
      scheduled_on:'2026-12-01',caption:'كابشن الأجندة',hashtags:'#MZJ'},
    {line_id:lineB,product_id:productB,post_type_id:postPhoto,task_id:taskB,client_key:id(201),
      task_no:'TSK-000225',task_name:'صورة',requirement_number:2,idea_name:'صورة سيارة',media_kind:'image',
      post_type_name:'Post',post_width:1080,post_height:1350,platform_id:id(102),platform_name:'Instagram',platform_code:'instagram',
      scheduled_on:'2026-12-02',caption:'صورة جديدة',hashtags:'#عرض'},
    {line_id:lineC,product_id:productC,post_type_id:null,task_id:taskB,client_key:id(202),
      task_no:'TSK-000225',task_name:'صورة 2',requirement_number:3,idea_name:'صورة ناقصة',media_kind:'image',
      scheduled_on:'2026-12-04',caption:'',hashtags:''},
  ];
  if (q.includes('from marketing.work_publish_targets target')) return [
    {line_id:lineA,post_type_id:postReel,schedule_id:id(80),publish_status:'waiting',
      post_type_name:'Reel',post_width:1080,post_height:1920,platform_id:id(101),platform_name:'Instagram',platform_code:'instagram',
      caption:'الكابشن من تجهيز النشر',hashtags:'#ريلز'},
    {line_id:lineA,post_type_id:postTikTok,schedule_id:id(81),publish_status:'waiting',
      post_type_name:'Video',post_width:1080,post_height:1920,platform_id:id(103),platform_name:'TikTok',platform_code:'tiktok',
      caption:'نص تيك توك',hashtags:'#تيك_توك'},
  ];
  if (q.includes('from marketing.work_item_files j')) return [{
    product_id:productA,file_id:fileId,format_id:formatReel,order_index:0,
    original_name:'video-1080x1920.mp4',mime_type:'video/mp4',file_size:12345,
    storage_provider:'google-drive',file_status:'ready',width:1080,height:1920,format_name:'Video vertical',
  }];
  if (q.includes('from marketing.work_tasks t') && q.includes('strategy_assigned')) return [
    {task_id:taskA,marker:{source:'mzj-content-strategy',planId:'cycle',ideaCodes:['V01'],clientKeys:[id(200)],itemIdeaCodes:['V01']}},
  ];
  if (q.includes('from marketing.work_items where task_id=any')) return [
    {id:productA,task_id:taskA,client_key:id(200),idea_name:'فيديو سيارة',sort_order:0},
    {id:productB,task_id:taskB,client_key:id(201),idea_name:'صورة سيارة',sort_order:1},
    {id:productC,task_id:taskB,client_key:id(202),idea_name:'صورة ناقصة',sort_order:2},
  ];
  if (q.includes('from marketing.files f')) return [{original_name:'video-1080x1920.mp4',mime_type:'video/mp4',file_size:17,external_id:'drive-private-id',storage_provider:'google-drive'}];
  throw new Error(`Unexpected SQL: ${q}`);
};
(async()=>{
  const first = await lib.buildAgendaPublicationSnapshot(sql,planId);
  const again = await lib.buildAgendaPublicationSnapshot(sql,planId);
  assert.deepEqual(again,first,'repeated snapshots are stable and idempotent');
  assert.equal(first.schema,'mzj-agenda-publishing/v1');
  assert.equal(first.agenda.publishFrom,'2026-12-01');
  assert.equal(first.agenda.publishTo,'2026-12-31');
  assert.equal(first.entries.length,4,'2 types for the first line + 2 other lines');
  assert.equal(first.totals.posts,4);
  assert.equal(first.totals.ready,2,'only individually approved, size-matched Google Drive media are ready');
  assert.equal(first.totals.waiting,1,'missing file does not block agenda sync');
  assert.equal(first.totals.incomplete,1,'missing post type is not guessed');
  assert.equal(first.entries[0].ideaCode,'V01','strategy idea code comes from immutable assignment marker');
  assert.equal(first.entries[0].requestNo,'TSK-000224-01');
  assert.equal(first.entries[0].caption,'الكابشن من تجهيز النشر','prepared post copy overrides draft');
  assert.equal(first.entries[1].platform.code,'tiktok');
  assert.equal(first.entries[1].files[0].id,fileId,'one approved size may serve two platforms');
  assert.equal(first.entries[0].files[0].downloadPath,`/api/strategy-integration/publication-file?planId=${planId}&fileId=${fileId}`);
  assert(!JSON.stringify(first).includes('drive-private-id'),'Google external file IDs stay server-side');
  assert(calls.every(call=>call.q.trim().startsWith('select')),'snapshot never writes to Marketing DB');

  const oldFetch = global.fetch;
  const oldUrl = process.env.MZJ_STRATEGY_PUBLISH_SYNC_URL;
  const oldKey = process.env.MZJ_STRATEGY_PUBLISH_SYNC_KEY;
  let callsCount = 0;
  try {
    process.env.MZJ_STRATEGY_PUBLISH_SYNC_URL='https://strategy.example.com/api/marketing-agenda-sync';
    process.env.MZJ_STRATEGY_PUBLISH_SYNC_KEY='P'.repeat(48);
    global.fetch = async (url,options) => {
      callsCount++;
      assert.equal(url,process.env.MZJ_STRATEGY_PUBLISH_SYNC_URL);
      assert.equal(options.method,'POST');
      assert.equal(options.headers.Authorization,`Bearer ${process.env.MZJ_STRATEGY_PUBLISH_SYNC_KEY}`);
      const payload = JSON.parse(options.body);
      assert.equal(payload.entries.length,4);
      return Response.json({ok:true,agendaId:planId,received:4});
    };
    const result = await lib.sendAgendaPublicationSnapshot(sql,planId);
    assert.equal(result.ok,true);assert.equal(result.ready,2);assert.equal(callsCount,1);
    global.fetch=async()=>Response.json({ok:true,agendaId:planId,received:3});
    await assert.rejects(()=>lib.sendAgendaPublicationSnapshot(sql,planId),/لم تؤكد الاستراتيجية/);
    process.env.MZJ_STRATEGY_PUBLISH_SYNC_URL='http://127.0.0.1/api/test';
    assert.throws(()=>lib.agendaSyncSettings(),/HTTPS/);
    delete process.env.MZJ_STRATEGY_PUBLISH_SYNC_URL;
    await assert.rejects(()=>lib.sendAgendaPublicationSnapshot(sql,planId),/غير مكتمل/);
  } finally {
    global.fetch=oldFetch;
    if(oldUrl === undefined) delete process.env.MZJ_STRATEGY_PUBLISH_SYNC_URL; else process.env.MZJ_STRATEGY_PUBLISH_SYNC_URL=oldUrl;
    if(oldKey === undefined) delete process.env.MZJ_STRATEGY_PUBLISH_SYNC_KEY; else process.env.MZJ_STRATEGY_PUBLISH_SYNC_KEY=oldKey;
  }
  assert.equal(bytesFetched,0,'building/sending an agenda does not eagerly download large media');
  const response = new PassThrough();
  const headers = {};
  response.setHeader = (name,value) => {headers[name.toLowerCase()]=value;return response};
  response.status = code => {response.statusCode=code;return response};
  response.json = value => {response.result=value;response.end();return response};
  const chunks=[];response.on('data',data=>chunks.push(data));
  await lib.streamApprovedAgendaMedia(sql,planId,fileId,response);
  assert.equal(Buffer.concat(chunks).toString(),'REAL-BINARY-MEDIA');
  assert.equal(response.statusCode,200);
  assert.equal(headers['content-type'],'video/mp4');
  assert.equal(bytesFetched,1,'media endpoint streams actual Google Drive bytes');
  await assert.rejects(()=>lib.streamApprovedAgendaMedia(sql,planId,'bad',response),/Invalid publication file identifier/);
  console.log('PASS: stable agenda entries, per-size files, incomplete rows, secure binary retrieval, explicit acknowledgement and no Marketing DB mutations');
})().catch(error=>{console.error(error);process.exitCode=1});
