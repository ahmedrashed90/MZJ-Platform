import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const utilsSource = fs.readFileSync(new URL('../server/_crm-utils.ts', import.meta.url), 'utf8');
const settingsSource = fs.readFileSync(new URL('../server/crm/settings.ts', import.meta.url), 'utf8');
const routingReadSource = fs.readFileSync(new URL('../server/crm/entry-routing.ts', import.meta.url), 'utf8');
const adminSource = fs.readFileSync(new URL('../src/crm/pages/CrmAdminPage.tsx', import.meta.url), 'utf8');

// Exercise the actual central routing function with a deterministic PostgreSQL
// tag stub. No database, network, or customer records are changed by this test.
const start = utilsSource.indexOf('async function chooseFromConfiguredRule(');
const end = utilsSource.indexOf('// Only for external finance imports:', start);
assert.ok(start >= 0 && end > start, 'central CRM router is present');
const jsSource = ts.transpileModule(utilsSource.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const factory = new Function('getSql', 'clean', 'distributionSourceCode', `${jsSource}\nreturn chooseFromConfiguredRule;`);
const clean = (v) => String(v ?? '').trim();

function makeFixture(mode = 'round_robin') {
  const branches = ['salon', 'multaqa', 'qadisiyah'];
  const departments = ['cash_sales', 'finance_sales'];
  const ruleRows = [];
  const memberRows = [];
  for (const department of departments) {
    for (const [branchIndex, branch] of branches.entries()) {
      const id = `rule-${department}-${branch}`;
      ruleRows.push({ id, name: id, branch_code: branch, source_codes: [], assignment_mode: mode,
        prevent_consecutive: false, sort_order: 10 + branchIndex * 10, created_at: '2026-11-11',
        department_code: department, is_active: true });
      for (let userIndex = 0; userIndex < 2; userIndex++) {
        memberRows.push({ rule_id: id, user_id: `${department}-${branch}-${userIndex}`,
          full_name: `${department} ${branch} ${userIndex}`, priority: userIndex * 10,
          assignment_count: 0, allocation_percentage: userIndex === 0 ? 70 : 30,
          weighted_assignment_count: 0, rule_branch_code: branch,
          rule_sort_order: 10 + branchIndex * 10, rule_assignment_mode: mode, primary_branch_code: branch });
      }
    }
  }
  const state = new Map();
  const logs = [];
  const sql = function (strings, ...args) {
    const query = strings.join('?').replace(/\s+/g, ' ').toLowerCase();
    if (query.includes('from crm.assignment_rules r')) {
      const [requested, , , , departmentCode, , , , , routingSource] = args;
      // Identify the department from the tagged WHERE parameter. Other rules
      // deliberately have differing sort_order to catch branch starvation.
      const department = args.find((value) => value === 'cash_sales' || value === 'finance_sales');
      const requestBranch = args.find((value) => branches.includes(value)) || '';
      const source = args.find((value) => value === 'facebook' || value === 'instagram') || '';
      return Promise.resolve(ruleRows.filter((r) => r.is_active && r.department_code === department
        && (!requestBranch || r.branch_code === requestBranch || !r.branch_code)
        && (!r.source_codes.length || r.source_codes.includes(source)))
        .map((r) => ({ ...r, branch_specificity: 0, source_specificity: r.source_codes.length ? 0 : 1 }))
        .sort((a,b)=>a.source_specificity-b.source_specificity || a.sort_order-b.sort_order || a.id.localeCompare(b.id)));
    }
    if (query.includes('from crm.assignment_rule_members m')) {
      const ids = args.find((arg) => Array.isArray(arg) && arg.every((v) => String(v).startsWith('rule-'))) || [];
      return Promise.resolve(memberRows.filter((row) => ids.includes(row.rule_id)).map((row) => ({ ...row })));
    }
    if (query.includes('select last_branch_code from crm.assignment_state')) {
      const item = state.get(args[0]);
      return Promise.resolve(item ? [{ last_branch_code: item.branchCode }] : []);
    }
    if (query.includes('select last_user_id::text from crm.assignment_state')) {
      const item = state.get(args[0]);
      return Promise.resolve(item ? [{ last_user_id: item.userId }] : []);
    }
    if (query.includes('insert into crm.assignment_state')) {
      if (args.length === 2) state.set(args[0], { branchCode: args[1] });
      else state.set(args[0], { userId: args[1], branchCode: args[2] });
      return Promise.resolve([]);
    }
    if (query.includes('update crm.assignment_rule_members')) {
      const ruleId = args.find((v) => String(v).startsWith('rule-'));
      const userId = args.find((v) => String(v).includes('-salon-') || String(v).includes('-multaqa-') || String(v).includes('-qadisiyah-'));
      const row = memberRows.find((r) => r.rule_id === ruleId && r.user_id === userId);
      if (row) {
        row.assignment_count += 1;
        if (mode === 'percentage') row.weighted_assignment_count += 1;
      }
      return Promise.resolve([]);
    }
    if (query.includes('insert into crm.assignment_logs')) {
      logs.push([...args]);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  sql.begin = async (callback) => callback(sql);
  const choose = factory(() => sql, clean, (s) => clean(s));
  return { choose, branches, departments, ruleRows, memberRows, state, logs };
}

for (const mode of ['round_robin', 'percentage']) {
  const test = makeFixture(mode);
  const totalPerDepartment = mode === 'percentage' ? 90 : 9;
  for (const department of test.departments) {
    const selected = [];
    for (let i = 0; i < totalPerDepartment; i += 1) {
      const result = await test.choose(department, '', 'facebook');
      assert.ok(result?.assignedTo, `lead ${i+1} in ${department} is assigned`);
      assert.ok(result.assignedTo.startsWith(`${department}-${result.branchCode}-`));
      selected.push(result);
    }
    const perBranch = Object.fromEntries(test.branches.map((branch) => [branch, selected.filter((r) => r.branchCode === branch)]));
    for (const branch of test.branches) {
      assert.equal(perBranch[branch].length, totalPerDepartment / 3,
        `${mode}: all three branches receive equal branch rotation for ${department}`);
      const one = perBranch[branch].filter((r) => r.assignedTo.endsWith('-0')).length;
      const two = perBranch[branch].filter((r) => r.assignedTo.endsWith('-1')).length;
      if (mode === 'percentage') assert.deepEqual([one,two], [21,9], `${branch} retains its 70/30 rule`);
      else assert.deepEqual([one,two], [2,1], `${branch} rotates its two agents`);
    }
  }
  const fixed = await test.choose('cash_sales', 'qadisiyah', 'instagram');
  assert.equal(fixed.branchCode, 'qadisiyah', 'explicit branch is respected');
  assert.ok(fixed.assignedTo.startsWith('cash_sales-qadisiyah-'));
  console.log(`PASS: ${mode}, both departments, three branches, local representatives and explicit branch`);
}

// An independent branch cursor for every platform would start each small new
// campaign on the first branch. All sources of the same department must share
// the branch cursor while keeping the actual rule/source scopes separate.
const mixed = makeFixture();
const mixedSources = ['facebook', 'instagram', 'snapchat', 'tiktok', 'whatsapp', 'sheet_lead'];
const mixedBranches = [];
for (let i = 0; i < mixedSources.length; i += 1) {
  const result = await mixed.choose('cash_sales', '', mixedSources[i]);
  mixedBranches.push(result.branchCode);
}
assert.equal(new Set(mixedBranches).size, 3, 'mixed sources still reach all three branches');
assert.deepEqual(mixedBranches.slice(0, 3), mixedBranches.slice(3, 6), 'department-wide cursor continues across sources');
console.log('PASS: a shared branch cursor per department prevents mixed-source bias');

const noCrossBranch = makeFixture();
for (const row of noCrossBranch.memberRows.filter((r) => r.rule_branch_code === 'qadisiyah')) {
  row.primary_branch_code = 'salon';
}
const noCrossBranchAssignments = [];
for (let i = 0; i < 8; i += 1) noCrossBranchAssignments.push(await noCrossBranch.choose('cash_sales', '', 'facebook'));
assert.equal(noCrossBranchAssignments.filter((r) => r?.branchCode === 'qadisiyah').length, 0,
  'a secondary CRM branch does not steal another manager primary-branch leads');
assert.equal(new Set(noCrossBranchAssignments.map((r) => r?.branchCode)).size, 2);
console.log('PASS: only current primary CRM branch agents enter each branch pool');

const activeOnly = (source) => /from crm\.assignment_rules r[\s\S]*?where r\.is_active=true[\s\S]*?group by r\.id/.test(source);
assert.ok(activeOnly(settingsSource), 'settings show only active rules');
assert.ok(activeOnly(routingReadSource), 'entry routing shows only active rules');
assert.ok(settingsSource.includes('where id=${id}::uuid and is_active=true') && settingsSource.includes('assignment_rule_archived'), 'archive exactly one rule with an audit trail');
assert.ok(adminSource.includes('remove("assignment_rule", row.id)}><Trash size={16} />حذف'), 'visible delete control corresponds to archive action');
console.log('PASS: deleted rules leave both active lists; the historical assignment log stays intact');
