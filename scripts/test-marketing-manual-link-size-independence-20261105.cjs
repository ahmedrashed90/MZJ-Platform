'use strict';
// No production DB or provider calls. Exercise the real workflow handlers
// against controlled query responses for agenda and campaign publication.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = { id: uid(1), fullName: 'Admin', permissions: ['platform.superadmin'], deniedPermissions: [],
  systemAccess: { marketing: { dataScope: 'all', roleCode: 'admin', branchCodes: [], departmentCodes: [] } } };
const stubs = {
  '../_db.js': { getSql: () => { throw Error('No production database in this test'); }, withDatabaseAdvisoryLock: async (_, fn) => fn() },
  '../_auth.js': { loadUserProfile: async () => admin },
  '../_access-control.js': { getSystemAccess: u => u.systemAccess.marketing },
  '../_marketing-workflow-schema.js': { assertMarketingWorkflowReady: async () => {}, marketingPlanScheduleSchemaStatus: async () => ({}), marketingWorkflowStructureStatus: async () => ({}), ensureMarketingWorkflowSchema: async () => {} },
  '../_notifications.js': { createNotification: async () => {} },
  '../_media-storage.js': { createUploadUrl: () => {}, headMediaObject: async () => ({}), mediaStorageConfigured: () => false, buildMarketingStorageKey: () => '' },
  '../_google-drive-storage.js': { createGoogleDriveResumableUpload: async () => ({}), verifyGoogleDriveUploadedFile: async () => ({}) },
};
const load = createLoader(process.cwd(), stubs, { 'server/marketing/workflow.ts': '\nexport { savePreparation, savePlanPostUrl };' });
const { savePreparation, savePlanPostUrl } = load('server/marketing/workflow.ts');
const { matchingWorkflowPublishFiles } = load('shared/marketing-workflow.ts');
const sourceFormat = { id: uid(11), platform_id: uid(21), platform_name: 'Instagram', platform_code: 'instagram', name: 'Photo', width: 1080, height: 1080 };
const sourceFile = { id: uid(41), name: 'approved.jpg', mime_type: 'image/jpeg', file_size: 421, category: 'final', format_id: sourceFormat.id, status: 'ready' };
const item = { id: uid(51), task_id: uid(52), department_id: uid(53), media_kind: 'image', formats: [sourceFormat], files: [sourceFile], status: 'approved', idea_name: 'Car', task_no: 'TSK-1' };
async function scenario(kind, matchSize) {
  const targetFormat = { ...sourceFormat, id: uid(12), platform_id: uid(22), platform_code: 'facebook', platform_name: 'Facebook', width: matchSize ? 1080 : 1080, height: matchSize ? 1080 : 1920 };
  const line = { id: uid(61), plan_id: uid(62), product_id: item.id, post_type_id: targetFormat.id,
    review_status: 'publishing', scheduled_on: '2026-11-05', version: 3, kind, name: 'Campaign', caption: '', hashtags: '',
    manual_post_url: '', manual_published_on: null, created_by: admin.id, platform_code: targetFormat.platform_code };
  const queries = [];
  const sql = async (strings, ...values) => {
    const q = strings.join('?').replace(/\s+/g, ' ').trim();
    queries.push({ q, values });
    if (q.startsWith('set local ')) return [];
    if (q.includes("to_regclass('marketing.work_plan_reviewers')")) return [{ present: false }];
    if (q.startsWith('select l.*,l.scheduled_on::text')) return [line];
    if (q.startsWith('select i.*,i.due_on::text,t.name as task_name')) return [item];
    if (q.startsWith('select i.*,i.due_on::text,coalesce(d.name')) return [item];
    if (q.startsWith('select pt.id::text,pt.platform_id::text')) return [targetFormat];
    if (q.startsWith('select l.*,p.kind,p.created_by')) return [line];
    if (q.startsWith('select i.id from marketing.work_items i join marketing.work_tasks t')) return [{id: item.id}];
    if (q.startsWith('select target.*')) return [];
    if (q.startsWith('select id,creative_id from marketing.tasks')) return [{ id:uid(81), creative_id:uid(82) }];
    if (q.startsWith('select pt.id from marketing.platform_post_types pt join marketing.platforms')) return [{id:targetFormat.id}];
    if (q.startsWith('select l.id,l.plan_id,l.manual_post_url')) return [line];
    if (q.startsWith('update marketing.work_plan_items set manual_post_url')) return [{ published_on: '2026-11-05' }];
    if (/^(insert into marketing\.publish_schedule|insert into marketing\.work_publish_targets|delete from marketing\.work_publish_files|insert into marketing\.work_publish_files|update marketing\.work_plan_items set caption)/.test(q)) return [];
    throw new Error(`Unexpected workflow SQL: ${q}`);
  };
  sql.begin = async fn => fn(sql); sql.json = value => value;
  const prepped = await savePreparation(sql, admin, {
    lineId: line.id, version: line.version, formatIds: [targetFormat.id], caption: 'Car for sale', hashtags: '#MZJ', publishTime:'20:00',
  }, {youtubeDefaults:async()=>({})});
  assert.equal(prepped.ok,true,`${kind} preparation should save regardless of configured output dimensions`);
  const saveSchedule = queries.find(c => c.q.startsWith('insert into marketing.publish_schedule'));
  assert.ok(saveSchedule, 'Schedule record is created by actual workflow');
  const publishOptions = saveSchedule.values.at(-1);
  assert.equal(publishOptions.manualOnly, !matchSize,'Manual-only metadata is derived from approved file compatibility');
  const attached = queries.filter(c => c.q.startsWith('insert into marketing.work_publish_files'));
  assert.equal(attached.length,matchSize ? 1 : 0,'Only compatible approved media can reach an automatic publisher');
  assert.deepEqual(matchingWorkflowPublishFiles(item.files,item.formats,targetFormat,'image').length,matchSize ? 1 : 0);
  if (!matchSize) {
    const link = await savePlanPostUrl(sql, admin, {lineId:line.id,url:'https://example.org/published/manual-test'});
    assert.equal(link.ok,true,`${kind}: manually published URL saved independently of dimensions`);
    assert.equal(link.publishedOn,'2026-11-05','Saudi publication date stays generated by server');
    assert.equal(queries.filter(c => c.q.startsWith('update marketing.work_plan_items set manual_post_url')).length,1);
  }
  console.log(`PASS: ${kind} ${matchSize ? 'matching auto media' : 'mismatched manual file and immutable URL'}`);
}
(async()=>{
  await scenario('campaign',false);
  await scenario('agenda',false);
  await scenario('campaign',true);
  await scenario('agenda',true);
  const server=fs.readFileSync('server/marketing/workflow.ts','utf8');
  const ui=fs.readFileSync('src/marketing/workflow/PublishPage.tsx','utf8');
  assert.ok(server.includes("if (schedule.publish_options?.manualOnly === true)"));
  assert.ok(server.includes("and coalesce(line.manual_post_url,'')='' and s.publish_options->>'manualOnly' is distinct from 'true'"));
  assert.ok(server.includes('const [manualOnlyPending] = await tx<any[]>'));
  assert.ok(ui.includes('يمكن حفظ التجهيز ورابط المنشور اليدوي حتى لو مقاس الملف المعتمد مختلف'));
  assert.ok(server.includes("if (String(line.manual_post_url || '').trim() || line.manual_published_on)"), 'First manual URL immutable');
  console.log('PASS: automatic publication remains size-safe; first saved manual URL remains immutable');
})().catch(error=>{console.error(error);process.exitCode=1;});
