import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const crmUi = readFileSync('src/crm/pages/CrmContactsPage.tsx', 'utf8');
const crmServer = readFileSync('server/crm/contacts.ts', 'utf8');
const campaignUi = readFileSync('src/marketing/components/CampaignReportPage.tsx', 'utf8');
const css = readFileSync('src/styles.css', 'utf8');

for (const [filename, source] of [
  ['src/crm/pages/CrmContactsPage.tsx', crmUi],
  ['server/crm/contacts.ts', crmServer],
  ['src/marketing/components/CampaignReportPage.tsx', campaignUi],
]) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length, 0, `${filename} should parse without errors`);
}

// Validate the report's actual initializer, rather than approximating its date math.
const reportAst = ts.createSourceFile('CampaignReportPage.tsx', campaignUi, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let initializer;
function walk(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(reportAst) === '[initialRange]') {
    const call = node.initializer;
    assert.ok(call && ts.isCallExpression(call));
    initializer = call.arguments[0].getText(reportAst);
  }
  ts.forEachChild(node, walk);
}
walk(reportAst);
assert.ok(initializer, 'The report must calculate one shared initial range');
for (const date of ['2026-11-18', '2026-12-01', '2027-01-31']) {
  const init = vm.runInNewContext(`(${initializer})`, { marketingLocalDateKey: () => date });
  assert.deepEqual({ ...init() }, { from: `${date.slice(0, 7)}-01`, to: date });
}
assert.match(campaignUi, /useState\(initialRange\.from\)/);
assert.match(campaignUi, /useState\(initialRange\.to\)/);
assert.match(campaignUi, /useState\(initialRange\)/);
assert.doesNotMatch(campaignUi, /const RECENT|Date\.now\(\) - RECENT/);

const calls = [];
function mockSql(strings, ...values) {
  const statement = strings.join(' ');
  calls.push({ statement, values });
  if (/select\s+c\.id::text,c\.display_name/.test(statement)) {
    return Promise.resolve([{ id: 'contact-1', display_name: 'عميل تجريبي', status_label: 'غير مؤهل', source_code: 'meta', source_name: 'Meta' }]);
  }
  if (/select count\(\*\)::int as total from crm\.contacts/.test(statement)) return Promise.resolve([{ total: 27 }]);
  if (/select count\(\*\)::int as v from crm\.contacts/.test(statement)) return Promise.resolve([{ v: 4347 }]);
  if (/from crm\.service_requests/.test(statement) && /request_state='open'/.test(statement)) return Promise.resolve([{ v: 4074 }]);
  if (/from crm\.service_requests/.test(statement) && /request_state='closed'/.test(statement)) return Promise.resolve([{ v: 357 }]);
  if (/from crm\.conversations/.test(statement) && /count\(distinct/.test(statement)) return Promise.resolve([{ v: 4227 }]);
  if (/count\(\*\)::int as v from integrations\.erpnext_sales_orders/.test(statement)) return Promise.resolve([{ v: 293 }]);
  if (/coalesce\(sum\(greatest/.test(statement)) return Promise.resolve([{ v: 450 }]);
  throw new Error(`Unexpected SQL in test: ${statement.slice(0, 140)}`);
}
function mockResponse() {
  return {
    statusCode: 200,
    setHeader() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { return payload; },
  };
}
const mocks = {
  '@vercel/node': {},
  '../_crm-utils.js': {
    clean: value => typeof value === 'string' ? value.trim() : '',
    positiveInt: (value, fallback) => value ? Number(value) : fallback,
    requireCrmUser: async () => ({ id: '11111111-1111-4111-8111-111111111111' }),
    userScope: () => ({ all: true, includeAssigned: true, callCenterOnly: false, departmentCodes: [], branchCodes: [], branchRestricted: false }),
    currentCrmLeadBranchSql: () => 'branch_code',
    sourceLabel: (_, value) => value,
  },
  '../../shared/access-control.js': { hasPermission: () => true },
  '../_db.js': { getSql: () => mockSql },
  '../_erpnext-integration-schema.js': { ensureErpNextSalesOrderSchema: async () => {} },
  '../_erpnext-sales-order-sync.js': {},
  '../_crm-sale-timestamp.js': {},
};
const compiled = ts.transpileModule(crmServer, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext('(function(require, module, exports){' + compiled + '\n})', {})(
  name => { if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`); return mocks[name]; },
  module, module.exports,
);
const handler = module.exports.default;
assert.equal(typeof handler, 'function');

calls.length = 0;
const first = await handler({ method: 'GET', query: { mode: 'rows', limit: '50', offset: '0' } }, mockResponse());
assert.equal(first.rows.length, 1);
assert.equal(first.rows[0].status_label, 'غير مؤهل');
assert.equal(calls.length, 1, 'The initial visible page should never wait for counts');
assert.equal(first.total, undefined, 'The rows mode has no count requirement');
assert.ok(/limit\s/.test(calls[0].statement));
assert.ok(/exists\s*\(/.test(calls[0].statement), 'Scope filtering must be preserved');

calls.length = 0;
const totals = await handler({ method: 'GET', query: { mode: 'stats', q: 'A' } }, mockResponse());
assert.equal(totals.total, 27);
assert.equal(totals.summary.total_contacts, 4347);
assert.equal(totals.summary.open_contacts, 4074);
assert.equal(totals.summary.total_sold_vehicles, 450);
assert.equal(calls.length, 7, 'Stats mode should run filtered count and the same six global aggregates');
assert.ok(calls.every(({ statement }) => !/select\s+c\.id::text,c\.display_name/.test(statement)), 'Stats must not fetch customer rows');

calls.length = 0;
const combined = await handler({ method: 'GET', query: { q: 'A' } }, mockResponse());
assert.equal(combined.rows.length, 1);
assert.equal(combined.total, 27);
assert.equal(combined.summary.total_sales_orders, 293);
assert.equal(combined.canPurge, true);
assert.equal(calls.length, 8, 'Legacy combined clients must retain their existing response');

assert.match(crmUi, /mode: "rows"/);
assert.match(crmUi, /mode: "stats"/);
assert.match(crmUi, /pageSize = 50/);
assert.match(crmUi, /loadProfile\(contactId\)/);
assert.match(crmUi, /listRequestSequence/);
assert.match(crmUi, /statsRequestSequence/);
assert.match(crmUi, /statsAbort\.current\?\.abort\(\)/);
assert.match(css, /\.crm-contacts-table \.crm-contact-status-sold/);
assert.match(css, /\.crm-contact-skeleton-row/);
console.log('PASS: Progressive contacts, legacy API, search scope, monthly campaign dates, and scoped table styles');
