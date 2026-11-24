'use strict';
/** Regression: "تم التجهيز" is the content checklist, not schedule records. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const script = fs.readFileSync('shared/marketing-publish-preparation.ts', 'utf8');
const output = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleObj = { exports: {} };
new Function('module', 'exports', output)(moduleObj, moduleObj.exports);
const { isPublishContentPrepared, publishContentMissing, publishContentMissingLabel } = moduleObj.exports;
const good = { final_file_ready: true, caption: 'عنوان الإعلان', hashtags: '#سيارات' };
let checks = 0;
function test(label, run) { run(); checks++; console.log(`PASS ${label}`); }
test('Exactly the three saved fields mark one post prepared', () => {
  assert.equal(isPublishContentPrepared(good), true);
  assert.deepEqual(publishContentMissing(good), []);
});
test('No final file -> not prepared even when a provider schedule exists', () => {
  assert.equal(isPublishContentPrepared({ ...good, final_file_ready: false, prepared_count: 2, failed_count: 0 }), false);
});
test('Saved caption and hashtags each required, trimmed of whitespace', () => {
  assert.deepEqual(publishContentMissing({ ...good, caption: ' \n ' }), ['caption']);
  assert.deepEqual(publishContentMissing({ ...good, hashtags: '\t' }), ['hashtags']);
  assert.deepEqual(publishContentMissing({ ...good, caption: '', hashtags: '' }), ['caption', 'hashtags']);
  assert.equal(publishContentMissingLabel({ ...good, caption: '', hashtags: '' }), 'ناقص: الكابشن، الهاشتاج');
});
test('Unloaded final-media flag cannot be mistaken for a ready file', () => {
  assert.deepEqual(publishContentMissing({ caption: 'x', hashtags: '#x' }), ['file']);
});
test('Provider failure, duplicate schedules, published URLs are NOT content checklist inputs', () => {
  for (const scheduled of [0, 1, 2, 3]) {
    assert.equal(isPublishContentPrepared({ ...good, prepared_count: scheduled, failed_count: 1, published_ready: false }), true);
  }
});
test('176 posts count once per line: 95 complete, 81 incomplete', () => {
  const rows = Array.from({ length: 176 }, (_, i) => ({ ...good, final_file_ready: i < 95 }));
  assert.equal(rows.filter(isPublishContentPrepared).length, 95);
  assert.equal(rows.filter(isPublishContentPrepared).length + rows.filter(row => !isPublishContentPrepared(row)).length, 176);
});
test('Deleting any one saved requirement reduces the prepared count on the next fetch', () => {
  const rows = [good, good, good];
  assert.equal(rows.filter(isPublishContentPrepared).length, 3);
  rows[1] = { ...good, hashtags: '' };
  assert.equal(rows.filter(isPublishContentPrepared).length, 2);
  rows[1] = { ...good, final_file_ready: false };
  assert.equal(rows.filter(isPublishContentPrepared).length, 2);
});
const server = fs.readFileSync('server/marketing/workflow.ts', 'utf8');
const dashboard = fs.readFileSync('src/marketing/pages/MarketingDashboardPage.tsx', 'utf8');
test('Server checks real ready FINAL files tied to the source product without false post-type mismatches', () => {
  const query = server.slice(server.indexOf('async function planLines('), server.indexOf('/** Attach the campaign-report link'));
  const start = query.indexOf('exists(select 1 from marketing.work_item_files final_attachment');
  const end = query.indexOf(') as final_file_ready', start);
  assert.ok(start >= 0 && end > start, 'missing SQL FINAL file readiness check');
  const check = query.slice(start, end);
  assert.match(check, /final_attachment\.item_id=l\.product_id/);
  assert.match(check, /final_attachment\.category='final' and media\.status='ready'/);
  assert.doesNotMatch(check, /final_attachment\.format_id|source_format|pt\.width|pt\.height|l\.post_type_id/);
  assert.match(query, /\) as final_file_ready/);
});
test('One product with four approved final sizes is not falsely missing across seven agenda posts', () => {
  const sevenPosts = Array.from({ length: 7 }, (_, i) => ({
    ...good,
    product_id: 'TSK-000224-03',
    post_type_id: `platform-output-${i}`,
    source_final_sizes: 4,
  }));
  assert.equal(sevenPosts.filter(isPublishContentPrepared).length, 7);
  sevenPosts[4] = { ...sevenPosts[4], hashtags: ' ' };
  assert.equal(sevenPosts.filter(isPublishContentPrepared).length, 6);
  sevenPosts[4] = { ...sevenPosts[4], hashtags: '#عرض', final_file_ready: false };
  assert.equal(sevenPosts.filter(isPublishContentPrepared).length, 6);
});
test('Actual publishing still enforces output format compatibility', () => {
  const media = fs.readFileSync('shared/marketing-workflow.ts', 'utf8');
  assert.match(media, /function matchingWorkflowPublishFiles\(/);
  assert.match(media, /const exact = matchingFiles\(target\.id\)/);
  assert.match(media, /Number\(source\.width\) === Number\(target\.width\)/);
});
test('Dashboard counts by the shared checklist and leaves real published readiness intact', () => {
  assert.match(dashboard, /const preparedLines = group\.filter\(isPublishContentPrepared\)\.length/);
  assert.match(dashboard, /const contentPrepared = group\.every\(isPublishContentPrepared\)/);
  assert.match(dashboard, /const readyLines = group\.filter\(line => line\.published_ready\)\.length/);
  assert.match(dashboard, /تم التجهيز: <strong>\{preparedLines\}<\/strong> \/ \{group\.length\}/);
  assert.match(dashboard, /تم النشر: <strong>\{readyLines\}<\/strong> \/ \{group\.length\}/);
});
test('Automatic publishing retains the original schedule gate, not the content badge', () => {
  assert.match(dashboard, /const activationPrepared = group\.every\(line => line\.prepared_count === 1 && !line\.failed_count\)/);
  assert.match(dashboard, /disabled=\{!query\.data\?\.capabilities\.publish \|\| !activationPrepared/);
  assert.match(server, /const unfinished = visible\.find\(line => !line\.prepared_count \|\| line\.failed_count \|\| line\.prepared_count !== 1\)/);
});
test('Preparation chooser uses the identical content definition', () => {
  assert.match(dashboard, /isPublishContentPrepared\(line\) \? <><CheckCircle/);
  assert.match(dashboard, /publishContentMissingLabel\(line\)/);
});
console.log(`${checks}/${checks} checks passed: publish content preparation is independent of scheduling and publishing.`);
