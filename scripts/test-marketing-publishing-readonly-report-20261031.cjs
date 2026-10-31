'use strict';
/** Dashboard publishing rendering/report regression; no DB writes or live calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = file => fs.readFileSync(file, 'utf8');
const dashboard = source('src/marketing/pages/MarketingDashboardPage.tsx');
const css = source('src/marketing/workflow/workflow.css');
const report = source('src/marketing/workflow/PlanReport.tsx');
const management = source('src/marketing/workflow/PlanDetail.tsx');
const database = source('src/marketing/pages/MarketingDatabasePage.tsx');
const shared = source('shared/marketing-workflow.ts');
const server = source('server/marketing/workflow.ts');

const checks = [
  ['publishing is closed by default, body renders only when opened', () => {
    assert.match(dashboard, /\[publishingOpen, setPublishingOpen\] = useState\(false\)/);
    assert.match(dashboard, /aria-expanded=\{publishingOpen\}/);
    assert.match(dashboard, /\{publishingOpen && <div className="mkw-column-body">/);
  }],
  ['closed publishing column does not inherit the 370px minimum height', () => {
    assert.match(css, /\.mkw-dashboard \.mkw-column:not\(\.mkw-publishing-column\) \{ min-height:370px; \}/);
    const globalColumn = css.match(/\.mkw-dashboard \.mkw-column \{([^}]+)\}/)?.[1] || '';
    assert.ok(globalColumn && !globalColumn.includes('min-height'), 'publishing must not inherit any minimum height');
  }],
  ['dashboard cards remain collapsed, day entries still aggregate each date', () => {
    assert.match(dashboard, /const days = new Map<string, WorkPlanLine\[\]>\(\)/);
    assert.match(dashboard, /\[\.\.\.days.entries\(\)\]/);
    assert.match(dashboard, /<details className=\{`mkw-plan-group mkw-dashboard-plan/);
    assert.doesNotMatch(dashboard, /<details[^>]*\sopen\b/);
  }],
  ['dashboard report opens a separate full-viewport presentation', () => {
    assert.match(dashboard, /import \{ PlanReport \} from '\.\.\/workflow\/PlanReport'/);
    assert.match(dashboard, /\{tableId && <PlanReport id=\{tableId\}/);
    assert.match(report, /className="mkw-fullscreen mkw-plan-report-modal"/);
    assert.match(css, /\.mzj-modal-card\.mkw-fullscreen \{/);
    assert.match(css, /max-height:none!important/);
    assert.match(css, /\.mkw-plan-report-table table \{ width:100%; min-width:1320px/);
  }],
  ['report contains no editing controls, writes, or actual publish date field', () => {
    assert.doesNotMatch(report, /<input\b|<textarea\b|<select\b|<button\b|\bworkPost\s*\(|\bLinkEditor\b/);
    assert.doesNotMatch(report, /تاريخ النشر الفعلي|manual_published_on|published_on/);
    assert.match(report, /للعرض فقط/);
    assert.match(report, /useWorkQuery<ReportData>\('plan', \{ id \}\)/);
  }],
  ['report retains detail per product/platform/post type, caption, hashtags and URL', () => {
    for (const property of ['line.idea_name', 'line.platform_name', 'line.post_type_name', 'line.caption', 'line.hashtags', 'line.effective_post_url', 'line.scheduled_on', 'plan.created_at']) {
      assert.ok(report.includes(property), `${property} absent from report`);
    }
    assert.match(report, /<PublicationTiming line=\{line\}\/>/);
    assert.match(report, /rel="noopener noreferrer"/);
    assert.match(shared, /caption\?: string; hashtags\?: string/);
    assert.match(server, /select l\.\*,l\.scheduled_on::text/);
  }],
  ['review and editing workflows remain accessible from database, not reporting', () => {
    assert.match(database, /<PlanDetail id=\{selected.id\}/);
    assert.match(management, /title=\{`تفاصيل ومراجعة/);
    assert.match(management, /workPost\(action, payload\)/);
    assert.match(management, /حفظ التعديلات وإرسالها للمراجعة/);
    assert.match(dashboard, /<PreparationModal id=\{prepareId\}/);
  }],
];
let failed=0;
for(const [title,fn] of checks){
  try{ fn();console.log('PASS '+title); }
  catch(e){failed++;console.error('FAIL '+title+'\n'+e.message);}
}
console.log(`${checks.length-failed}/${checks.length} report/display regressions passed`);
if(failed) process.exitCode=1;
