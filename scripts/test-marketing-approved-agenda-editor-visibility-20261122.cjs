'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const read = file => fs.readFileSync(file,'utf8');
for (const file of ['src/marketing/workflow/PlanReport.tsx', 'src/marketing/pages/MarketingDashboardPage.tsx',
                    'src/marketing/workflow/AgendaIdeaDateEditor.tsx', 'src/marketing/workflow/PlanDetail.tsx']) {
  const result = ts.transpileModule(read(file), {fileName:file,reportDiagnostics:true,
    compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  assert.equal(result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
}
const report=read('src/marketing/workflow/PlanReport.tsx');
const dashboard=read('src/marketing/pages/MarketingDashboardPage.tsx');
const detail=read('src/marketing/workflow/PlanDetail.tsx');
const editor=read('src/marketing/workflow/AgendaIdeaDateEditor.tsx');
assert.match(report,/plan\.canRescheduleIdeas[\s\S]*?<AgendaIdeaDateEditor planId=\{id\}/,
  'Approved agenda report must render the editor with server-provided edit permission');
assert.match(dashboard,/chooserAgendaPlan\.data\?\.plan\?\.canRescheduleIdeas[\s\S]*?<AgendaIdeaDateEditor planId=\{selectPlan\}/,
  'Approved agenda publish preparation must show editor');
assert.match(report,/\['publishing', 'published'\]\.includes\(plan\.review_status\)/,
  'Draft/revision agenda must not show approved-agenda editor');
assert.match(dashboard,/\['publishing','published'\]\.includes\(chooserSourceLines\[0\]\?\.review_status \|\| ''\)/,
  'Preparation must check actual approved agenda status');
assert.doesNotMatch(detail,/<AgendaIdeaDateEditor/,'Do not hide editor in review detail');
assert.match(dashboard,/<PlanReport id=\{tableId\}[^\n]*onChanged=/,
  'Report date changes must refresh dashboard');
assert.match(editor,/reschedule_agenda_ideas/,'The existing batch transaction remains the only write path');
assert.match(editor,/selected\.map\(idea => \(\{ ideaCode: idea\.ideaCode/,
  'Dates remain linked by original idea code, not title or platform');
console.log('8/8 approved agenda report and publishing-preparation editor checks passed');
