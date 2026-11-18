const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader, scriptedSql } = require('./marketing-workflow-test-support.cjs');
const root = path.resolve(__dirname, '..');
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const load = createLoader(root, {
  '../_db.js': { getSql() { throw Error('Test must not reach a database'); }, withDatabaseAdvisoryLock: async (_, fn) => fn() },
  '../_auth.js': { loadUserProfile: async () => null },
  '../_access-control.js': { getSystemAccess: user => user.systemAccess.marketing },
  '../_marketing-workflow-schema.js': { ensureMarketingWorkflowSchema: async () => {}, marketingStrategyDraftsReady: async () => false },
  '../_notifications.js': { createNotification: async () => {} },
  '../_media-storage.js': { mediaStorageConfigured: () => false },
  '../_google-drive-storage.js': { createGoogleDriveResumableUpload: async () => ({}) },
  './evaluations.js': { canGradeWorkItem: async () => false },
}, { 'server/marketing/workflow.ts': '\nexport { validateProductionFormats };' });
const { productionWorkFormats } = load('src/marketing/workflow/productionDimensions.ts');
const { matchingWorkflowPublishFiles } = load('shared/marketing-workflow.ts');
const { validateProductionFormats } = load('server/marketing/workflow.ts');
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
const dimensions = [
  { id: uid(1), width: 1080, height: 1920 },
  { id: uid(2), width: 1080, height: 1080 },
  { id: uid(3), width: 1080, height: 1920 },
  { id: uid(4), width: 1920, height: 1080 },
];
test('Production dimension selector deduplicates identical pixel sizes without grouping by platform', () => {
  const result = productionWorkFormats(dimensions);
  assert.equal(result.length, 3);
  assert.deepEqual(new Set(result.map(x => x.name)), new Set(['1080 × 1920', '1080 × 1080', '1920 × 1080']));
  assert(result.every(x => !x.platform_name && !x.platform_code && !x.platform_id));
});
test('Invalid or missing dimensions are excluded from the available output sizes', () => {
  const result = productionWorkFormats([...dimensions, { id: uid(5), width: 0, height: 1080 }, { id: uid(6), width: 100.4, height: 1080 }]);
  assert.equal(result.length, 3);
});
test('Legacy Instagram/Snapchat post type IDs map to one canonical production dimension', async () => {
  const legacy1 = uid(21), legacy2 = uid(22);
  const db = scriptedSql([
    { match: 'from marketing.production_dimensions', rows: [] },
    { match: 'from marketing.platform_post_types pt', rows: [
      { id: legacy1, dimension_id: uid(1), width: 1080, height: 1920 },
      { id: legacy2, dimension_id: uid(1), width: 1080, height: 1920 },
    ] },
  ]);
  const resolved = await validateProductionFormats(db, 'video', [legacy1, legacy2]);
  assert.equal(resolved.length, 1);
  assert.deepEqual(resolved[0], { id: uid(1), name: '1080 × 1920', width: 1080, height: 1920, platform_id: '', platform_name: '', platform_code: '' });
  db.assertDone();
});
test('Already canonical dimensions persist as independent sizes in a task', async () => {
  const db = scriptedSql([
    { match: 'from marketing.production_dimensions', rows: [{ id: uid(1), width: 1080, height: 1920 }] },
    { match: 'from marketing.platform_post_types pt', rows: [] },
  ]);
  const result = await validateProductionFormats(db, 'image', [uid(1)]);
  assert.deepEqual(result.map(x => x.id), [uid(1)]);
  db.assertDone();
});
test('Unknown output IDs cannot silently create a task requirement', async () => {
  const db = scriptedSql([
    { match: 'from marketing.production_dimensions', rows: [] },
    { match: 'from marketing.platform_post_types pt', rows: [] },
  ]);
  await assert.rejects(() => validateProductionFormats(db, 'image', [uid(88)]), /المقاسات|مقاس|اختار/);
  db.assertDone();
});
test('Approved creative is reused across channels only if its pixels and media kind match', () => {
  const format = { ...productionWorkFormats(dimensions)[0], id: uid(1), width: 1080, height: 1080 };
  const approvedFiles = [{ id: uid(88), format_id: uid(1), category: 'final', status: 'ready', name: 'mzj.png', mime_type: 'image/png' }];
  const instagram = { id: uid(21), platform_id: uid(41), name: 'Story', width: 1080, height: 1080 };
  const snapchat = { ...instagram, id: uid(22), platform_id: uid(42) };
  const otherSize = { ...instagram, id: uid(23), width: 1080, height: 1920 };
  assert.equal(matchingWorkflowPublishFiles(approvedFiles, [format], instagram, 'image').length, 1);
  assert.equal(matchingWorkflowPublishFiles(approvedFiles, [format], snapchat, 'image').length, 1);
  assert.equal(matchingWorkflowPublishFiles(approvedFiles, [format], otherSize, 'image').length, 0);
  assert.equal(matchingWorkflowPublishFiles(approvedFiles, [format], instagram, 'video').length, 0);
});
test('Settings keep a unique dimension catalog independent from platform post types', () => {
  const schema = fs.readFileSync(path.join(root, 'server/_marketing-schema.ts'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'src/marketing/pages/DepartmentsPage.tsx'), 'utf8');
  const task = fs.readFileSync(path.join(root, 'src/marketing/workflow/CreatePage.tsx'), 'utf8');
  assert(schema.includes('unique(width,height)') && schema.includes('select distinct pt.width,pt.height'));
  assert(settings.includes('save_production_dimension') && settings.includes('marketing-publish-platform-settings'));
  assert(task.includes('productionWorkFormats(meta.productionDimensions || [])'));
});
test('Old platform publishing settings and plan budget selections remain unchanged', () => {
  const backend = fs.readFileSync(path.join(root, 'server/marketing/workflow.ts'), 'utf8');
  assert(backend.includes('const plannedFormats = visible.post_type_id ? await validateFormats'));
  assert(backend.includes('matchingWorkflowPublishFiles(product.files, taskFormats, format, product.media_kind)'));
});
(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('PASS:', name); passed++; }
    catch (error) { console.error('FAIL:', name); console.error(error); process.exitCode = 1; }
  }
  console.log(`${passed}/${tests.length} independent marketing production dimensions checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
