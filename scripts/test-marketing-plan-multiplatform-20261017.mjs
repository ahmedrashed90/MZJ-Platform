import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const root = process.cwd();
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const admin = { id: uid(1), fullName: 'Admin', permissions: ['platform.superadmin'], deniedPermissions: [],
  systemAccess: { marketing: { enabled: true, roleCode: 'admin', dataScope: 'all', branchCodes: [], departmentCodes: [] } } };
const stubs = {
  '../_db.js': { getSql: () => { throw Error('No production DB in test'); }, withDatabaseAdvisoryLock: async (_, fn) => fn() },
  '../_auth.js': { loadUserProfile: async () => admin },
  '../_access-control.js': { getSystemAccess: u => u.systemAccess.marketing },
  '../_marketing-workflow-schema.js': { assertMarketingWorkflowReady: async () => {}, marketingPlanScheduleSchemaStatus: async () => ({}), upgradeMarketingPlanScheduleSchema: async () => ({}) },
  '../_notifications.js': { createNotification: async () => {} },
  '../_media-storage.js': { createUploadUrl: () => {}, headMediaObject: async () => ({}), mediaStorageConfigured: () => false, buildMarketingStorageKey: () => '' },
  '../_google-drive-storage.js': { createGoogleDriveResumableUpload: async () => ({}), verifyGoogleDriveUploadedFile: async () => ({}) },
};
const load = createLoader(root, stubs, { 'server/marketing/workflow.ts': '\nexport { createPlan };' });
const composer = load('src/marketing/workflow/planComposer.ts');
const backend = load('server/marketing/workflow.ts');
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; console.log(`PASS: ${message}`); }
const ig = uid(10), fb = uid(11), yt = uid(12);
const types = [
  { id: uid(21), platform_id: ig, name: 'Photo' },
  { id: uid(22), platform_id: ig, name: 'Story' },
  { id: uid(23), platform_id: ig, name: 'Reel' },
  { id: uid(24), platform_id: fb, name: 'Photo' },
  { id: uid(25), platform_id: fb, name: 'Video' },
  { id: uid(26), platform_id: yt, name: 'Short' },
];
const products = [{ id: uid(31), media_kind: 'image' }, { id: uid(32), media_kind: 'video' }];
const imageEntry = (date = '2026-10-17') => ({ key: 'row-1', date, productId: products[0].id, platforms: [] });
const second = { key: 'row-2', date: '2026-10-18', productId: products[1].id, platforms: [] };
const firstOptions = composer.availablePlanProducts(products, [imageEntry(), second], 'row-1');
check(firstOptions.length === 1 && firstOptions[0].id === products[0].id, 'Product selected elsewhere is removed from the next row only');
check(composer.availablePlanProducts(products, [imageEntry(), { ...second, productId: '' }], 'row-2').every(p => p.id !== products[0].id), 'Previously selected image is not visible in another row');
check(composer.availablePlanProducts(products, [second], 'row-2').length === 2, 'Removing the first selection makes its product available again');
check(composer.availablePlanPostTypes(types, 'image', ig).map(t => t.id).join(',') === [uid(21), uid(22)].join(','), 'Instagram photo offers photo/story but not Reel');
check(composer.availablePlanPostTypes(types, 'video', ig).map(t => t.id).join(',') === [uid(22), uid(23)].join(','), 'Instagram video offers story/Reel but not photo');
check(composer.availablePlanPostTypes(types, 'image', yt).length === 0, 'YouTube Shorts is excluded for image products');
check(composer.addPlanPlatform(fb, types, 'image').postTypeId === uid(24), 'A platform with one compatible post type selects it automatically');
check(composer.addPlanPlatform(ig, types, 'image').postTypeId === '', 'A platform with multiple compatible post types requires a choice');
const complete = { ...imageEntry(), platforms: [
  { platformId: ig, postTypeId: uid(21), budget: '100.50' },
  { platformId: fb, postTypeId: uid(24), budget: '250' },
] };
check(composer.validatePlanComposer([complete], products, types, 'campaign') === '', 'Campaign accepts two independent platforms for one product');
check(composer.validatePlanComposer([{ ...complete, platforms: [{ ...complete.platforms[0], budget: '' }] }], products, types, 'campaign').length > 0, 'Campaign requires each platform budget');
check(composer.validatePlanComposer([{ ...complete, platforms: [{ ...complete.platforms[0], postTypeId: uid(23) }] }], products, types, 'campaign').length > 0, 'Incompatible image/video format is rejected');
check(composer.validatePlanComposer([complete, { ...complete, key: 'row-2', date: '2026-10-18' }], products, types, 'campaign').includes('مكرر'), 'Duplicate product fails entire plan even across dates');
check(composer.validatePlanComposer([{ ...complete, platforms: [complete.platforms[0], complete.platforms[0]] }], products, types, 'campaign').length > 0, 'Duplicate platform on one day is rejected');
const payload = composer.planEntriesPayload([complete], 'campaign');
check(payload[0].platforms.length === 2 && payload[0].platforms[0].budget === 100.5 && payload[0].platforms[1].budget === 250, 'Budget is explicit per platform, never silently duplicated');
check(composer.planEntriesPayload([complete], 'agenda')[0].platforms.every(p => p.budget === 0), 'Agenda uses the same multi-platform selections without paid budgets');
check(composer.validatePlanComposer([{ ...complete, platforms: complete.platforms.map(p => ({ ...p, budget: '' })) }], products, types, 'agenda') === '', 'Agenda never demands campaign-specific budgets');

// Server is exercised with a transaction-local fake driver, not a real DB.
// It preserves the real visibility checks and media/post-type validation.
function makeSql() {
  const inserts = [], events = [];
  const sql = async (strings, ...values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim();
    events.push(query);
    if (/^set local /i.test(query) || query.includes('pg_advisory_xact_lock')) return [];
    if (query.includes('select id from marketing.work_plans where created_by=')) return [];
    if (query.includes('select i.*,i.due_on::text,t.name as task_name')) {
      return [{ id: values[0], task_id: uid(40), status: 'approved', media_kind: values[0] === products[0].id ? 'image' : 'video' }];
    }
    if (query.includes('select i.*,i.due_on::text,coalesce(d.name')) {
          return products.map(p => ({
        id: p.id, task_id: uid(40), media_kind: p.media_kind, status: 'approved',
        formats: [{ id: p.media_kind === 'image' ? uid(21) : uid(23), name: p.media_kind === 'image' ? 'Photo' : 'Reel', platform_id: ig }],
        files: [{ id: uid(80), format_id: p.media_kind === 'image' ? uid(21) : uid(23), category: 'final', status: 'ready', name: p.media_kind === 'image' ? 'photo.jpg' : 'movie.mp4', mime_type: p.media_kind === 'image' ? 'image/jpeg' : 'video/mp4' }],
      }));
    }
    if (query.includes('select pt.id::text,pt.platform_id::text,pt.name')) {
      const ids = values[0];
      return types.filter(t => ids.includes(t.id));
    }
    if (query.includes('select nextval')) return [{ value: '123' }];
    if (query.includes('select 1 from marketing.campaigns where campaign_code=')) return [];
    if (query.includes('insert into marketing.work_plan_items')) { inserts.push({ date: values[2], productId: values[1], postTypeId: values[3], budget: values[4] }); return []; }
    if (query.includes('insert into marketing.work_plans') || query.includes('insert into marketing.campaigns') || query.includes('insert into marketing.agendas')) return [];
    throw new Error('Unexpected SQL: ' + query);
  };
  sql.begin = async fn => fn(sql);
  sql.json = value => value;
  return { sql, inserts, events };
}
const makeRequest = entries => ({ requestKey: uid(100), kind: 'campaign', name: 'New campaign', entries });
let db = makeSql();
let result = await backend.createPlan(db.sql, makeRequest(payload), admin);
check(result.ok && db.inserts.length === 2 && db.inserts[0].budget === 100.5 && db.inserts[1].budget === 250, 'Backend persists two real plan lines with independent platform budgets');
check(db.inserts[0].postTypeId === uid(21) && db.inserts[1].postTypeId === uid(24), 'Backend keeps the original post type and platform mapping');
check(db.inserts.every(item => item.date === '2026-10-17' && item.productId === products[0].id), 'Selected product/date remain identical for every selected platform');
db = makeSql();
await backend.createPlan(db.sql, { ...makeRequest(composer.planEntriesPayload([complete], 'agenda')), kind: 'agenda' }, admin);
check(db.inserts.length === 2 && db.inserts.every(line => line.budget === 0), 'Agenda persists a separate no-budget publish line for each selected platform');
for (const [name, entries] of [
  ['Duplicate product', [payload[0], { ...payload[0], date: '2026-10-18' }]],
  ['Wrong platform mapping', [{ ...payload[0], platforms: [{ platformId: fb, postTypeId: uid(21), budget: 20 }] }]],
  ['Duplicate platform mapping', [{ ...payload[0], platforms: [payload[0].platforms[0], payload[0].platforms[0]] }]],
  ['Incompatible image format', [{ ...payload[0], platforms: [{ platformId: ig, postTypeId: uid(23), budget: 20 }] }]],
  ['Missing budget', [{ ...payload[0], platforms: [{ platformId: ig, postTypeId: uid(21), budget: '' }] }]],
]) {
  db = makeSql();
  await assert.rejects(() => backend.createPlan(db.sql, makeRequest(entries), admin), undefined, name);
  check(db.inserts.length === 0, `Server rejects ${name.toLowerCase()} without any campaign writes`);
}
db = makeSql();
await backend.createPlan(db.sql, makeRequest([{ date: '2026-10-17', productId: products[0].id, postTypeId: uid(21), budget: 45 }]), admin);
check(db.inserts.length === 1 && db.inserts[0].budget === 45, 'Legacy single-platform clients retain their existing API contract');
const front = readFileSync('src/marketing/workflow/CreatePage.tsx', 'utf8');
const css = readFileSync('src/marketing/workflow/workflow.css', 'utf8');
check(front.includes('availablePlanProducts(products, entries, entry.key)') && front.includes('selectableGroups'), 'Product dropdown is filtered in both campaign and agenda composers');
check(front.includes('type="checkbox" checked={selected.has(platform.id)}') && front.includes('togglePlatform(entry.key, platform.id)'), 'Platform selection has multi-select controls per product');
check(front.includes('availablePlanPostTypes(meta.postTypes, product?.media_kind, platform.platformId)'), 'Post types are filtered by chosen platform AND image/video media');
check(front.includes('planEntriesPayload(entries, kind)') && front.includes('previewRows.map('), 'Save and preview use exactly the same grouped platform selection');
check(css.includes('.mkw-plan-platform-options') && css.includes('.mkw-plan-per-platform') && !css.includes('.mkw-plan-table { min-width:1220px; }'), 'Source styles are consolidated without adding a duplicate override');
console.log(`${checks}/${checks} multi-platform marketing plan checks passed`);
