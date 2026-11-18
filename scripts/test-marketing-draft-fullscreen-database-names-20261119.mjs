import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { taskCategoryLabel } from '../src/marketing/workflow/taskPresentation.ts';

const css = readFileSync(new URL('../src/marketing/workflow/strategyDrafts.css', import.meta.url), 'utf8');
const drafts = readFileSync(new URL('../src/marketing/workflow/StrategyDrafts.tsx', import.meta.url), 'utf8');
const database = readFileSync(new URL('../src/marketing/pages/MarketingDatabasePage.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/marketing/pages/MarketingDashboardPage.tsx', import.meta.url), 'utf8');
const checks = [
  ['One shared editor handles both campaign and agenda drafts', () => {
    assert.match(drafts, /export function StrategyDraftEditor/);
    assert.match(drafts, /draft\?\.kind === 'campaign'/);
    assert.match(drafts, /className="mkw-strategy-draft-modal"/);
  }],
  ['Both draft kinds open edge-to-edge, with no capped desktop dimensions', () => {
    assert.match(css, /\.mzj-modal-card\.mkw-strategy-draft-modal\s*\{[^}]*position:fixed;\s*inset:0;[^}]*width:100vw!important;\s*height:100dvh;[^}]*max-width:none!important;\s*max-height:none!important;/);
    assert.doesNotMatch(css, /width:min\(1480px/);
    assert.doesNotMatch(css, /height:min\(910px/);
  }],
  ['Full-screen draft content remains scrollable and the close header visible', () => {
    assert.match(css, /\.mkw-strategy-draft-modal > \.mzj-modal-body\s*\{[^}]*min-height:0;[^}]*overflow:auto;/);
    assert.match(css, /grid-template-rows:auto minmax\(0,1fr\)/);
  }],
  ['Database and dashboard share the exact same task naming helper', () => {
    assert.match(database, /import \{ taskCategoryLabel \} from '\.\.\/workflow\/taskPresentation'/);
    assert.match(database, /row\.kind === 'task' \? taskCategoryLabel\(row\.name\) : row\.name/);
    assert.match(dashboard, /return taskCategoryLabel\(name\)/);
  }],
  ['Search, delete and opening details use unchanged stored task name and ID', () => {
    assert.match(database, /`\$\{row\.name\} \$\{row\.code\}`/);
    assert.match(database, /name=\{row\.name\}/);
    assert.match(database, /<TaskDetail id=\{selected\.id\}/);
    assert.match(database, /title=\{row\.kind === 'task' \? row\.name : undefined\}/);
  }],
  ['Task title matches dashboard across strategy categories', () => {
    assert.equal(taskCategoryLabel('تعريفي - مواصفات السيارات وش يعني محرك 1500cc؟'), 'تعريفي - مواصفات السيارات');
    assert.equal(taskCategoryLabel('تعريفي - بالويب سايت صفحة السيارة'), 'تعريفي - بالويب سايت');
    assert.equal(taskCategoryLabel('تعريفي - بالبراند رحلة البراند'), 'تعريفي - بالبراند');
    assert.equal(taskCategoryLabel('بيعي - قسط تجارب العملاء'), 'بيعي');
    assert.equal(taskCategoryLabel('بيعي - كاش عرض جديد'), 'بيعي');
    assert.equal(taskCategoryLabel('عنوان مختلف لتاسك يدوي'), 'عنوان مختلف لتاسك يدوي');
  }],
];
for (const [name, fn] of checks) { fn(); console.log(`PASS: ${name}`); }
console.log(`${checks.length}/${checks.length} draft and database presentation checks passed`);
