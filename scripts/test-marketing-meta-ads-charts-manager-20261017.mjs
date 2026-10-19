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
check(front.includes('CHART_METRICS.map(item => <CampaignMetricCard') && front.includes("metric: 'costPerLead'") && front.includes("metric: 'leads'") && front.includes("metric: 'interactions'"), 'Three separate campaign chart cards render independent lead cost, lead count, and engagements');
check(!front.includes('CampaignOverviewChart') && !front.includes('BarChart') && !styles.includes('.marketing-meta-ads-chart-scroll'), 'Original cramped and combined chart layouts are removed');
check(front.includes('CAMPAIGN_CHART_PAGE_SIZE = 5') && front.includes('tableCampaigns.map(') && front.includes('setShowAll(value => !value)'), 'Five top campaigns stay visible per metric with expandable full campaign table');
check(front.includes('openCampaignDetails(point.key)') && front.includes('id={campaignDomId('), 'Clicking chart labels or rows opens saved campaign details');
check(styles.includes('grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))') && styles.includes('@media(max-width:920px)'), 'Three dedicated cards wrap from three to two to one according to available content width');
check(styles.includes('marketing-meta-ads-chart-plot') && styles.includes('marketing-meta-ads-chart-xlabels') && styles.includes('marketing-meta-ads-chart-table') && !styles.includes('.marketing-meta-ads-chart-row'), 'Each metric has its own vertical bars, uncluttered axis labels and campaign manager table');
check(front.includes('noMetricData') && front.includes('hasMultipleCurrencies') && front.includes("metric === 'costPerLead'"), 'Chart preserves missing-data and mixed-currency safeguards');
check(!front.includes('shortCampaignName') && front.includes('marketing-meta-ads-chart-key-full-name') && front.includes('CampaignNameText') && front.includes('campaignDisplayName('), 'Campaigns are displayed with meaningful names and only independent date segments are removed');
check(styles.includes('marketing-meta-ads-chart-key-full-name') && styles.includes('overflow-wrap:anywhere') && styles.includes('marketing-meta-ads-chart-campaign-name { display:block; text-align:right') && styles.includes('table-layout:auto'), 'Chart legend and campaign column align right and wrap without overlaps');
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
// Render the actual TSX card functions with a small JSX runtime mock to catch
// layout/data regressions beyond string-based source checks.
const debugFrontend = ts.transpileModule(front.replace('export function MetaAdsPanel()', 'export const __campaignMetricCardForTest = CampaignMetricCard;\nexport const __campaignNameForTest = campaignDisplayName;\nexport const __campaignNameTextForTest = CampaignNameText;\nexport function MetaAdsPanel()'), {
  fileName: 'MetaAdsPanel.tsx',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsxNode = (type, props, key) => ({ type, props: props || {}, key });
const fakeIcon = () => null;
const mockFront = {};
vm.runInNewContext(debugFrontend, {
  exports: mockFront, console, Date, String, Number, Math, Map, Set, Object, Array, RegExp, Intl,
  require(name) {
    if (name === 'react/jsx-runtime') return { jsx: jsxNode, jsxs: jsxNode, Fragment: 'fragment' };
    if (name === 'react') return { useMemo: run => run(), useState: initial => [initial, () => {}], useEffect: () => {} };
    if (name === '@phosphor-icons/react') return { FacebookLogo: fakeIcon, UsersThree: fakeIcon, ChartLineUp: fakeIcon,
      ArrowClockwise: fakeIcon, FloppyDisk: fakeIcon, LinkSimple: fakeIcon, MagnifyingGlass: fakeIcon, Megaphone: fakeIcon, Wallet: fakeIcon };
    if (name === '../../auth/AuthContext') return { useAuth: () => ({ user: null }) };
    if (name === '../../systemAccess') return { hasPermission: () => false };
    if (name === '../api') return { marketingDate: () => '', marketingFetch: () => Promise.resolve({}), marketingLocalDateKey: () => '', marketingQuery: () => '' };
    if (name === './MarketingPage') return { MarketingAlert: fakeIcon };
    throw new Error(`Unexpected frontend import: ${name}`);
  },
}, { timeout: 3000 });
const testPoints = [
  { key: 'act_1:1', name: 'A', managerName: 'مدير 1', currency: 'SAR', costPerLead: 6, leads: 6, interactions: 16 },
  { key: 'act_1:2', name: 'B', managerName: 'مدير 2', currency: 'SAR', costPerLead: 30, leads: 30, interactions: 9 },
  { key: 'act_1:3', name: 'C', managerName: '', currency: 'SAR', costPerLead: null, leads: null, interactions: null },
  { key: 'act_1:4', name: 'D', managerName: 'مدير 4', currency: 'SAR', costPerLead: 17, leads: 17, interactions: 34 },
  { key: 'act_1:5', name: 'E', managerName: 'مدير 5', currency: 'SAR', costPerLead: 4, leads: 4, interactions: 88 },
  { key: 'act_1:6', name: 'F', managerName: 'مدير 6', currency: 'SAR', costPerLead: 3, leads: 3, interactions: 2 },
];
function childNodes(node) {
  const out = [];
  const visit = item => {
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (item && typeof item === 'object' && 'props' in item) {
      out.push(item);
      visit(item.props.children);
    }
  };
  visit(node);
  return out;
}
for (const metric of ['interactions', 'leads', 'costPerLead']) {
  const render = mockFront.__campaignMetricCardForTest({ points: testPoints, metric });
  const nodes = childNodes(render);
  const plotBars = nodes.find(node => node.props.className === 'marketing-meta-ads-chart-bars');
  const tableBody = nodes.find(node => node.type === 'tbody');
  check(render.type === 'section' && render.props.className.includes(`is-${metric}`) && plotBars?.props.children.length === 5 && tableBody?.props.children.length === 5,
    `${metric} renders an independent card with exactly five preview bars and matching table entries`);
  const firstCampaignName = tableBody.props.children[0].props.children[1].props.children.props.children.props.name;
  check(firstCampaignName === (metric === 'interactions' ? 'E' : 'B'), `${metric} sorts campaigns by its own result rather than sharing a global order`);
}
const completeNames = [
  'MZJ | Standard 2026 | Installments | Oct 2026',
  'MZJ | Sonata Installments | Oct 2026',
  'المنشور: كيف تبدأ تمويل سيارتك؟ 🚙 — حملة التعريف',
];
const fullNameExample = completeNames.map((name, index) => ({
  key: `act_1:long-${index}`, name, managerName: 'سمر', currency: 'SAR',
  costPerLead: 3 + index, leads: 30 - index, interactions: 100 - index,
}));
for (const metric of ['interactions', 'leads', 'costPerLead']) {
  const rendered = mockFront.__campaignMetricCardForTest({ points: fullNameExample, metric });
  const nodes = childNodes(rendered);
  const fullChartNames = nodes.filter(node => node.type === mockFront.__campaignNameTextForTest && node.props.className === 'marketing-meta-ads-chart-key-full-name').map(node => node.props.name);
  const fullTableNames = nodes.filter(node => node.props.className === 'marketing-meta-ads-chart-campaign-name').map(node => node.props.children.props.name);
  const numericChartLabels = nodes.filter(node => node.props.className === 'marketing-meta-ads-chart-xlabels')[0]?.props.children;
  check(fullChartNames.length === completeNames.length && fullChartNames.every(name => completeNames.includes(name)) && new Set(fullChartNames).size === completeNames.length,
    `${metric} chart binds each distinct campaign's real name, without first-token truncation`);
  check(fullTableNames.length === completeNames.length && fullTableNames.every(name => completeNames.includes(name)),
    `${metric} table binds each distinct campaign's real name, with matching formatting`);
  check(numericChartLabels?.length === completeNames.length && numericChartLabels.every((node, index) => node.props.children === String(index + 1)),
    `${metric} chart uses numbered bar keys to avoid long labels colliding`);
}

const displayName = mockFront.__campaignNameForTest;
const nameCases = [
  ['MZJ | MG5 Standard 2026 | Installments | Oct 2026', 'MZJ | MG5 Standard 2026 | Installments'],
  ['MZJ | Sonata Installments | Oct | 2026', 'MZJ | Sonata Installments'],
  ['MZJ | Elantra Cash | October', 'MZJ | Elantra Cash'],
  ['MZJ | Tucson Comfort 2026 | Cash | Leads | Oct2026', 'MZJ | Tucson Comfort 2026 | Cash | Leads | Oct2026'],
  ['حملة عروض | أكتوبر 2026', 'حملة عروض'],
  ['إعلان سيارات 2026 بدون فواصل', 'إعلان سيارات 2026 بدون فواصل'],
  ['المنشور: كيف تبدأ تمويل سيارتك؟ 🚙', 'المنشور: كيف تبدأ تمويل سيارتك؟ 🚙'],
];
for (const [input, expected] of nameCases) {
  check(displayName(input) === expected, `Campaign display name handles date segments without removing model years: ${input}`);
}
const mockCampaignName = mockFront.__campaignNameTextForTest({ name: 'MZJ | MG5 Standard 2026 | Installments | Oct 2026' });
check(mockCampaignName.type === 'span' && mockCampaignName.props.dir === 'rtl'
  && mockCampaignName.props.children.length === 3,
  'Campaign name segments render inside a right-to-left container');

console.log(`${assertions}/${assertions} Meta campaign charts, managers and date range checks passed (mock provider/database).`);

