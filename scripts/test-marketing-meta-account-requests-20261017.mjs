import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = file => readFileSync(file, 'utf8');
const transpile = (source, fileName = 'source.ts') => {
  const output = ts.transpileModule(source, { fileName, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, `${fileName} parses`);
  return output.outputText;
};
const source = read('server/_marketing-meta-sync.ts');
const shared = read('shared/marketing-workflow.ts');
const media = read('src/marketing/workflow/requiredMedia.ts');
const page = read('src/marketing/pages/EngagementPage.tsx');
const composer = read('src/marketing/workflow/CreatePage.tsx');
const exportsShared = {};
vm.runInNewContext(transpile(shared), { exports: exportsShared, require: () => ({ normalizeMarketingPublishFormat: n => n, publishFormatRequiresImages: n => n.toLowerCase() === 'carousel', publishFormatRequiresVideo: n => n.toLowerCase() === 'reels' }), Date });
const exportsMedia = {};
vm.runInNewContext(transpile(media), { exports: exportsMedia, require: () => exportsShared, Set });
const formats = [
  { id: 'photo', name: 'Photo' }, { id: 'reels', name: 'Reels' }, { id: 'story', name: 'Story' },
];
const split = exportsMedia.splitRequiredMediaSelection;
const take = (kinds, ids) => JSON.parse(JSON.stringify(split(kinds, ids, formats)));
assert.deepEqual(take(['image'], ['photo']), [{ mediaKind: 'image', formatIds: ['photo'] }]);
assert.deepEqual(take(['video'], ['reels']), [{ mediaKind: 'video', formatIds: ['reels'] }]);
assert.deepEqual(take(['image', 'video'], ['photo', 'reels']), [{ mediaKind: 'image', formatIds: ['photo'] }, { mediaKind: 'video', formatIds: ['reels'] }]);
assert.deepEqual(take(['image', 'video'], ['story']), [{ mediaKind: 'image', formatIds: ['story'] }, { mediaKind: 'video', formatIds: ['story'] }]);
assert.deepEqual(take(['image', 'video'], ['photo']), [], 'Cannot save only half a combined request');
assert.match(composer, /className="mkw-assignment-actions"/);
assert.match(composer, /aria-pressed=\{item\.mediaKinds\.includes\(kind\)\}/);
assert.match(composer, /setTargetExecutorKey\(executor\.key\)/);
assert.match(composer, /splitRequiredMediaSelection\(item\.mediaKinds/);
assert.doesNotMatch(composer, /mkw-requirement-footer.*W\.addItem/);
console.log('PASS: Dual image/video selection, format partition, right-aligned executor and adjacent add buttons');

const exportsMeta = {};
vm.runInNewContext(transpile(source), {
  exports: exportsMeta, URL, AbortSignal, Date, Number, Intl, Set, Map, console, process: { env: {} },
  require: key => ({ './_db.js': { getSql: () => null, tryWithDatabaseAdvisoryLock: () => null }, './_marketing-schema.js': { ensureMarketingSchema: () => null }, './_platform-connections.js': { decryptPlatformToken: () => null } })[key] || (() => { throw new Error(key); })(),
});
const today = '2026-10-17';
const queried = [];
const sql = async (pieces, ...params) => {
  const text = pieces.join('?');
  queried.push(text);
  if (text.includes('from marketing.platform_connections where')) return [
    { platform: 'facebook', account_id: '123', account_name: 'MZJ Page', connected: true },
    { platform: 'instagram', account_id: '456', account_name: 'mzjcars', connected: true },
  ];
  if (text.includes('from marketing.meta_follower_snapshots')) return [
    { platform: 'facebook', account_id: '123', account_name: 'MZJ Page', snapshot_date: today, followers_count: 2570, fan_count: 2491 },
    { platform: 'instagram', account_id: '456', account_name: 'mzjcars', snapshot_date: today, followers_count: 22895, media_count: 2101 },
  ];
  if (text.includes('from marketing.meta_sync_state')) return [];
  if (text.includes('count(likes_count)::integer')) return [
    { platform: 'facebook', account_id: '123', discovered_count: 70, likes_measured_count: 60, likes_total: '257' },
    { platform: 'instagram', account_id: '456', discovered_count: 69, likes_measured_count: 0, likes_total: null },
  ];
  if (text.includes('distinct on (platform,account_id)')) return [
    { platform: 'facebook', account_id: '123', provider_post_id: 'fb1', caption: 'الأكثر تفاعلًا', permalink: 'https://facebook.com/p/fb1', published_at: today, likes_count: 40, comments_count: 10, shares_count: 8, engagement_total: 58 },
  ];
  throw Error(`Unexpected query: ${text.slice(0, 80)}`);
};
const accounts = await exportsMeta.metaAccountData(sql);
assert.equal(queried.length, 5);
assert.equal(accounts[0].mediaCount, 70);
assert.equal(accounts[0].likesTotal, 257);
assert.equal(accounts[0].likesMeasuredCount, 60);
assert.equal(accounts[0].topPost.engagementTotal, 58);
assert.equal(accounts[1].mediaCount, 2101);
assert.equal(accounts[1].likesTotal, null, 'Unknown must not be represented as zero');
assert.equal(accounts[1].topPost, null);
assert.match(page, /<TopEngagedSocialPost post=\{account\.topPost\}/);
assert.match(read('src/marketing/components/CompactFollowerChart.tsx'), /أعلى بوست تفاعلًا/);
assert.match(page, /عدد المحتوى المزامن/);
assert.doesNotMatch(page, /<span>من آخر قراءة محفوظة<\/span>/);
console.log('PASS: Real post-based Facebook media count, per-account likes and most engaging post');

const start = source.indexOf('async function savePostBatch('), end = source.indexOf('async function importPage(', start);
assert.ok(start > -1 && end > start);
const batch = {};
vm.runInNewContext(transpile(source.slice(start, end) + '\nexports.save = savePostBatch;'), { exports: batch, Map, Set, JSON });
let serialized;
const sqlBatch = async (parts, ...values) => {
  assert.ok(parts.join('?').includes('jsonb_to_recordset'));
  assert.equal(values.length, 1);
  assert.ok(Array.isArray(values[0].jsonValue), 'JSON root must be an array');
};
sqlBatch.json = value => { serialized = value; return { jsonValue: value }; };
await batch.save(sqlBatch, [
  { platform: 'facebook', accountId: '123', providerId: 'fb1', providerMediaId: 'fb1', caption: '', permalink: '', postType: 'POST', publishedAt: today, likes: 0, comments: 1, shares: null, saves: null, views: null, reach: null },
]);
assert.equal(serialized.length, 1);
assert.equal(serialized[0].provider_post_id, 'fb1');
console.log('PASS: Meta batch upsert always serializes a JSON array, eliminating the non-array recordset input');
console.log('Marketing Meta accounts and combined requests: 3/3 suites passed.');
