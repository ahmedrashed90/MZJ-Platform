import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(path, 'utf8');
const source = read('server/_marketing-meta-ads.ts');
const tsCommonJs = code => {
  const { outputText, diagnostics } = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'fixture.ts', reportDiagnostics: true,
  });
  assert.ok(!diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length, 'TS transpilation failed');
  return outputText;
};
function loadAds(env, graphFetch) {
  const exports = {};
  vm.runInNewContext(tsCommonJs(source), {
    exports, URL, AbortSignal, Date, Intl, Number, console,
    process: { env }, fetch: graphFetch,
    require: id => {
      if (id === 'node:crypto') return crypto;
      if (id === './_db.js') return { getSql: () => null };
      if (id === './_platform-connections.js') return { decryptPlatformToken: () => 'stored-user-token' };
      throw new Error(`Unexpected source dependency: ${id}`);
    },
  }, { timeout: 2000 });
  return exports;
}

let checks = 0;
function success(name) { checks++; console.log(`PASS: ${name}`); }
const accountId = 'act_123456789012345';
let apiCalls = [];
const mockedFetch = async (uri, options) => {
  const url = new URL(uri);
  apiCalls.push(`${url.pathname}?${url.searchParams.get('level') || ''}`);
  assert.equal(options.headers.Authorization, 'Bearer fake-ads-token');
  const path = url.pathname;
  const level = url.searchParams.get('level');
  const id = path.endsWith('/me/adaccounts') ? 'accounts'
    : path.endsWith(`/${accountId}/campaigns`) ? 'campaigns'
    : path.endsWith(`/${accountId}/ads`) ? 'ads'
    : path.endsWith(`/${accountId}/insights`) ? `insights_${level}` : 'unknown';
  const response = {
    accounts: { data: [{ id: accountId, name: 'MZJ Ads', currency: 'SAR', account_status: 1 }] },
    campaigns: { data: [
      { id: '1011', name: 'Cash lead campaign', status: 'ACTIVE', objective: 'OUTCOME_LEADS', daily_budget: '20000' },
      { id: '1012', name: 'Installment leads', status: 'PAUSED', objective: 'OUTCOME_LEADS', daily_budget: '10000' },
    ] },
    ads: { data: [
      { id: '2011', name: 'Accent lead creative', campaign_id: '1011', status: 'ACTIVE', adset: { name: 'Riyadh' } },
      { id: '2012', name: 'Tucson finance', campaign_id: '1012', status: 'PAUSED', adset: { name: 'Jeddah' } },
    ] },
    insights_campaign: { data: [
      { campaign_id: '1011', spend: '120', clicks: '21', reach: '900', actions: [{ action_type: 'lead', value: '5' }, { action_type: 'onsite_conversion.lead_grouped', value: '5' }, { action_type: 'post_engagement', value: '30' }] },
      { campaign_id: '1012', spend: '30', clicks: '7', reach: '280', actions: [{ action_type: 'lead', value: '2' }] },
    ] },
    insights_ad: { data: [
      { ad_id: '2011', campaign_id: '1011', spend: '120', actions: [{ action_type: 'lead', value: '5' }] },
      { ad_id: '2012', campaign_id: '1012', spend: '30', actions: [{ action_type: 'lead', value: '2' }] },
    ] },
  }[id];
  assert.ok(response, `Unexpected Graph endpoint: ${uri}`);
  return { ok: true, json: async () => response };
};

const ads = loadAds({ META_ADS_ACCESS_TOKEN: 'fake-ads-token' }, mockedFetch);
assert.equal(ads.metaAdsPreset('invalid'), 'last_30d');
assert.equal(ads.metaLeadCount([{ action_type: 'lead', value: '5' }, { action_type: 'onsite_conversion.lead_grouped', value: '5' }]), 5);
success('Meta rejects unknown period and deduplicates two Meta lead action aliases');
const report = await ads.metaAdsData(async () => [], 'last_7d');
assert.equal(report.status, 'ready');
assert.equal(report.reports[0].campaigns.length, 2);
assert.equal(report.reports[0].campaigns[0].ads.length, 1);
assert.equal(report.reports[0].campaigns[0].dailyBudget, 200);
assert.equal(report.reports[0].campaigns[0].metrics.costPerLead, 24);
assert.equal(report.reports[0].campaigns[1].metrics.leads, 2);
assert.equal(apiCalls.length, 5);
success('Meta reads two paid campaigns, each ad, actual leads, CPL and SAR budget');

const denied = loadAds({}, async () => { throw new Error('Must not call Graph without ads_read'); });
const missing = await denied.metaAdsData(async () => [{ scopes: ['pages_read_engagement'], user_access_token_encrypted: 'encrypted-token' }], 'today');
assert.equal(missing.status, 'needs_permission');
assert.ok(missing.note.includes('ads_read'));
success('Organic Facebook credentials without ads_read do not pretend to expose paid ads');

const attendance = read('src/attendance/AttendancePage.tsx');
const fns = ['formatDurationMinutes','clockMinutes','scheduledMinutes','attendanceHourTotals','wholeHoursText','hoursDifferenceText'];
const chunks = fns.map(name => {
  const match = attendance.match(new RegExp(`function ${name}\\([^]*?\\n}\\n`));
  assert.ok(match, `Missing attendance helper: ${name}`);
  return match[0];
});
const attendanceExports = {};
vm.runInNewContext(tsCommonJs(`${chunks.join('\n')}\nexports.attendance = { attendanceHourTotals, wholeHoursText, hoursDifferenceText };`), { exports: attendanceExports, Number, Math }, { timeout: 2000 });
const hour = attendanceExports.attendance;
const morning = { id: 'm', startTime: '09:00', endTime: '12:00', checkIn: true, workMinutes: 181 };
const evening = { id: 'e', startTime: '16:00', endTime: '21:00', checkIn: true, workMinutes: 239 };
let actual = hour.attendanceHourTotals([{ isDayOff: false, periods: [morning, evening], earlyDeparturePermission: null }]);
assert.equal(actual.expected, 480);
assert.equal(actual.actual, 420);
assert.equal(hour.wholeHoursText(actual.actual), '7 ساعة');
assert.equal(hour.hoursDifferenceText(actual.expected, actual.actual), '+1 ساعة');
success('Two shifts calculate 480 expected minutes minus 420 logged minutes');
actual = hour.attendanceHourTotals([{ isDayOff: false, periods: [{ ...morning, endTime: '16:00', workMinutes: 418 }], earlyDeparturePermission: null }]);
assert.equal(actual.expected, 420);
assert.equal(actual.actual, 418);
assert.equal(hour.wholeHoursText(actual.actual), '6 ساعة و 58 دقيقة');
assert.equal(hour.hoursDifferenceText(actual.expected, actual.actual), '+2 دقيقة');
success('One shift preserves 6h58m rather than rounding to 7h');
actual = hour.attendanceHourTotals([{ isDayOff: true, periods: [morning, evening], earlyDeparturePermission: null }]);
assert.equal(actual.expected, 0);
assert.equal(actual.actual, 0);
success('Weekly rest day is excluded from employee hours total');
actual = hour.attendanceHourTotals([{ isDayOff: false, periods: [{ ...morning, checkIn: null, workMinutes: 0 }, evening], earlyDeparturePermission: { permissionType: 'vacation', periodId: 'm' } }]);
assert.equal(actual.expected, 300);
assert.equal(actual.actual, 239);
success('Single-shift leave removes only that shift, not another assigned shift');

const create = read('src/marketing/workflow/CreatePage.tsx');
const workflow = read('server/marketing/workflow.ts');
assert.match(create, /for \(const executor of executors\) for \(const item of executor\.items\)/);
assert.match(create, /assigneeId: executor\.assigneeId/);
assert.match(workflow, /i\.assigned_to=\$\{user\.id\}::uuid/);
assert.match(workflow, /const items = canSeeAll \? all : all\.filter\(i => i\.assigned_to === user\.id/);
assert.match(workflow, /i\.due_on between \$\{from\}::date and \$\{to\}::date/);
success('Distinct per-executor required items are filtered by authenticated user on dashboard, detail and calendar');

console.log(`Meta, attendance and executor regression: ${checks}/8 passed.`);
