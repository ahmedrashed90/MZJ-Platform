import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const read = file => readFileSync(file, 'utf8');
const backend = read('server/_marketing-meta-ads.ts');
const front = read('src/marketing/components/MetaAdsPanel.tsx');
const styles = read('src/marketing/marketing.css');
const route = read('server/marketing/index.ts');
const schema = read('server/_marketing-schema.ts');
const frontendCompiled = ts.transpileModule(front, { fileName: 'MetaAdsPanel.tsx', reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
assert.equal(frontendCompiled.diagnostics?.filter(issue => issue.category === ts.DiagnosticCategory.Error).length || 0, 0, 'TSX must parse');
const backendCompiled = ts.transpileModule(backend, { fileName: '_marketing-meta-ads.ts', reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
assert.equal(backendCompiled.diagnostics?.filter(issue => issue.category === ts.DiagnosticCategory.Error).length || 0, 0, 'Backend TypeScript must parse');
let assertions = 0;
function check(condition, label) { assert.ok(condition, label); assertions += 1; console.log('PASS:', label); }
function loadBackend(fakeFetch, env = { META_ADS_ACCESS_TOKEN: 'my-private-test-token' }) {
  const exports = {};
  vm.runInNewContext(backendCompiled.outputText, {
    exports, Date, Number, String, Map, Set, Object, Array, RegExp, Error, console, URL, AbortSignal, Intl,
    process: { env }, fetch: fakeFetch,
    require: name => {
      if (name === 'node:crypto') return crypto;
      if (name === './_db.js') return { getSql: () => null };
      if (name === './_platform-connections.js') return { decryptPlatformToken: x => x };
      throw new Error(`Unexpected backend dependency: ${name}`);
    },
  }, { timeout: 3000 });
  return exports;
}
const accountId = 'act_2464725157220404';
const campaignId = '120987654321';
let getCalls = [];
function metaFetch(url, options) {
  const uri = new URL(url);
  getCalls.push(uri);
  assert.equal(options.headers.Authorization, 'Bearer my-private-test-token');
  const target = uri.pathname.split('/').at(-1);
  let payload;
  if (target === 'adaccounts') payload = { data: [{ id: accountId, name: 'MZJ', currency: 'SAR' }] };
  else if (target === accountId) payload = { id: accountId, name: 'MZJ', currency: 'SAR' };
  else if (target === 'campaigns') payload = { data: [{ id: campaignId, name: 'Campaign', status: 'ACTIVE', objective: 'OUTCOME_LEADS' }] };
  else if (target === 'ads') payload = { data: [] };
  else if (target === 'insights' && uri.searchParams.get('level') === 'campaign') payload = { data: [{ campaign_id: campaignId, spend: '100', actions: [{ action_type: 'lead', value: '4' }, { action_type: 'post_engagement', value: '12' }] }] };
  else if (target === 'insights') payload = { data: [] };
  else if (target === campaignId) payload = { id: campaignId, account_id: accountId.replace('act_', '') };
  else throw new Error(`Unmocked Meta route: ${uri.pathname}`);
  return Promise.resolve({ ok: true, json: async () => payload });
}
const ads = loadBackend(metaFetch);
const range = ads.metaAdsTimeRange('2026-09-01', '2026-10-17');
check(range.since === '2026-09-01' && range.until === '2026-10-17', 'Date range accepts inclusive From and To');
check(ads.metaAdsTimeRange('', '') === null, 'Existing date presets remain available');
for (const [from, to] of [['2026-02-30', '2026-03-01'], ['2026-10-18', '2026-10-17'], ['2026-10-17', ''], ['2099-19-01', '2099-19-02']]) {
  assert.throws(() => ads.metaAdsTimeRange(from, to));
}
check(true, 'Invalid and reversed date ranges are rejected');
let sqlCallCount = 0;
const localRecords = new Map([[`${accountId}:${campaignId}`, 'محمود']]);
const sql = (...parts) => {
  if (Array.isArray(parts[0]) && 'raw' in parts[0]) {
    const strings = parts[0].join('');
    if (strings.includes('select account_id')) {
      sqlCallCount += 1;
      return Promise.resolve([...localRecords].map(([key, manager_name]) => ({ account_id: accountId, campaign_id: campaignId, manager_name })));
    }
    if (strings.includes('insert into marketing.meta_ads_campaign_managers')) {
      const values = parts.slice(1);
      localRecords.set(`${values[0]}:${values[1]}`, values[2]);
      sqlCallCount += 1;
      return Promise.resolve([]);
    }
    throw new Error(`Unexpected SQL statement: ${strings}`);
  }
  return { __mockSqlList: parts };
};
const report = await ads.metaAdsData(sql, 'last_30d', accountId, '2026-09-01', '2026-10-17');
check(report.status === 'ready' && report.dateRange.since === '2026-09-01', 'Custom period returns a ready Meta campaign report');
check(report.reports[0].campaigns[0].managerName === 'محمود', 'Manager name is read from persistent database');
check(report.reports[0].campaigns[0].metrics.costPerLead === 25 && report.reports[0].campaigns[0].metrics.interactions === 12, 'Charts use actual Meta CPL and engagements');
const insights = getCalls.filter(item => item.pathname.endsWith('/insights'));
check(insights.length === 2 && insights.every(item => JSON.parse(item.searchParams.get('time_range')).since === '2026-09-01' && !item.searchParams.has('date_preset')), 'Insights use time_range rather than date_preset for custom dates');
getCalls = [];
await ads.metaAdsData(sql, 'last_7d', accountId);
check(getCalls.filter(item => item.pathname.endsWith('/insights')).every(item => item.searchParams.get('date_preset') === 'last_7d' && !item.searchParams.has('time_range')), 'Existing preset queries remain unchanged');
const updated = await ads.saveMetaAdsCampaignManager(sql, { accountId, campaignId, managerName: '  أحمد رشاد  ', updatedBy: '73fb3517-aac7-463e-94d7-bd91eb701b14' });
check(updated.managerName === 'أحمد رشاد' && localRecords.get(`${accountId}:${campaignId}`) === 'أحمد رشاد', 'Manager saves per account/campaign and trims whitespace');
const restored = await ads.metaAdsData(sql, 'today', accountId);
check(restored.reports[0].campaigns[0].managerName === 'أحمد رشاد', 'Manager survives Meta reload and date changes');
const beforeInvalid = sqlCallCount;
await assert.rejects(ads.saveMetaAdsCampaignManager(sql, { accountId, campaignId: 'bad-id', managerName: 'x', updatedBy: '73fb3517-aac7-463e-94d7-bd91eb701b14' }));
await assert.rejects(ads.saveMetaAdsCampaignManager(sql, { accountId, campaignId, managerName: 'x'.repeat(121), updatedBy: '73fb3517-aac7-463e-94d7-bd91eb701b14' }));
check(sqlCallCount === beforeInvalid, 'Invalid campaign IDs and oversized names never reach database writes');
const wrongCampaign = loadBackend(async url => {
  const target = new URL(url).pathname.split('/').at(-1);
  return { ok: true, json: async () => target === accountId ? { name: 'MZJ', currency: 'SAR' } : { id: campaignId, account_id: '1234567890' } };
}, { META_ADS_ACCESS_TOKEN: 'my-private-test-token', META_AD_ACCOUNT_IDS: accountId });
await assert.rejects(wrongCampaign.saveMetaAdsCampaignManager(sql, { accountId, campaignId, managerName: 'غير مسموح', updatedBy: '73fb3517-aac7-463e-94d7-bd91eb701b14' }));
check(sqlCallCount === beforeInvalid, 'Backend refuses manager writes for campaign in a different ad account');
check(front.includes('<CampaignOverviewChart points={chartPoints} />') && front.includes("metric: 'costPerLead'") && front.includes("metric: 'leads'") && front.includes("metric: 'interactions'"), 'All three campaign metrics appear in one readable comparison chart');
check(!front.includes('BarChart') && !styles.includes('.marketing-meta-ads-chart-scroll'), 'Charts no longer squeeze axes into three narrow scrollable cards');
check(front.includes('CAMPAIGN_CHART_PAGE_SIZE = 8') && front.includes('setShowAll(value => !value)') && front.includes('visible.map(point =>'), 'First eight campaigns are readable and remaining campaigns can be expanded');
check(front.includes('openCampaign(point.key)') && front.includes('id={campaignDomId('), 'Selecting a chart campaign opens its saved details without changing campaign IDs');
check(styles.includes('@media(max-width:760px)') && styles.includes('.marketing-meta-ads-chart-mobile-label') && styles.includes('grid-template-columns:minmax(0,1fr);'), 'Comparison chart adapts to small screens and labels each of the three metrics');
check(front.includes('مدير الحملة:') && front.includes('CampaignManagerEditor') && front.includes('save_meta_ads_campaign_manager'), 'Campaign manager is editable and displayed beside each chart campaign');
check(front.includes('type="date"') && front.includes('dateFrom:') && front.includes('dateTo:'), 'Date From/To filters are wired to campaign report query');
check(schema.includes('create table if not exists marketing.meta_ads_campaign_managers') && schema.includes('MARKETING_SCHEMA_VERSION = 2'), 'Dedicated additive schema migration persists manager names');
check(route.includes("action==='save_meta_ads_campaign_manager'") && route.includes("hasPermission(user,'marketing.engagement.view')") && route.includes("hasPermission(user,'marketing.campaign.edit')"), 'Server requires authenticated marketing permissions before save');

const schemaCompiled = ts.transpileModule(schema, { fileName: '_marketing-schema.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function simulatedSchemaSetup(initialVersion) {
  let version = initialVersion;
  const migrations = [];
  const sql = async (strings) => {
    const statement = Array.isArray(strings) ? strings.join('') : String(strings);
    if (statement.includes('to_regclass')) return [{ relation: version === 0 ? null : 'marketing.schema_state' }];
    if (statement.includes('select version')) return [{ version }];
    throw new Error('Unexpected marketing schema query: ' + statement);
  };
  const exports = {};
  vm.runInNewContext(schemaCompiled, { exports, console,
    require: name => name === './_db.js' ? {
      getSql: () => sql,
      runSqlScript: async content => { migrations.push(content); version = 2; },
      withDatabaseAdvisoryLock: async (_name, fn) => fn(),
    } : (() => { throw new Error(name); })(),
  }, { timeout: 4000 });
  await exports.ensureMarketingSchema();
  return migrations;
}
const upgradeV1 = await simulatedSchemaSetup(1);
check(upgradeV1.length === 1 && upgradeV1[0].includes('create table if not exists marketing.meta_ads_campaign_managers') && !upgradeV1[0].includes('marketing.work_tasks'), 'Existing v1 databases run only the lightweight manager-table migration');
const upgradeV0 = await simulatedSchemaSetup(0);
check(upgradeV0.length === 1 && upgradeV0[0].includes('marketing.departments') && upgradeV0[0].includes('meta_ads_campaign_managers'), 'Fresh databases include the manager table in full schema bootstrap');
check((await simulatedSchemaSetup(2)).length === 0, 'Current databases never rerun Marketing DDL on regular requests');
console.log(`${assertions}/${assertions} Meta campaign charts, managers and date range checks passed (mock provider/database).`);

