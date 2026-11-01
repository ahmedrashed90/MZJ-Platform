'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = file => fs.readFileSync(file,'utf8');
const status = read('src/marketing/workflow/PlanStatus.tsx');
const dash = read('src/marketing/pages/MarketingDashboardPage.tsx');
const detail = read('src/marketing/workflow/PlanDetail.tsx');
const report = read('src/marketing/workflow/PlanReport.tsx');
const server = read('server/marketing/workflow.ts');
const css = read('src/marketing/workflow/workflow.css');
let n=0;const check=(value,description)=>{assert.ok(value,description);n++;console.log('PASS '+description)};
const func = status.slice(status.indexOf('export function planDisplayState('),status.indexOf('export const planStateLabels'));
const compiled=ts.transpileModule(`${func}\nexports.fn=planDisplayState;`,{fileName:'status.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const moduleExports={};vm.runInNewContext(compiled,{exports:moduleExports});const fn=moduleExports.fn;
for(const [state,published,total,expected] of [
  ['in_progress',0,4,'in_progress'],['submitted',0,4,'submitted'],['revision',0,4,'revision'],
  ['publishing',0,4,'publishing'],['publishing',2,4,'publishing'],['publishing',4,4,'published'],
  ['published',3,4,'publishing'],['published',4,4,'published'],['publishing',0,0,'publishing']]) {
  check(fn(state,published,total)===expected,`Published count ${published}/${total} for ${state} -> ${expected}`);
}
check(status.includes('معلومات')===false && status.includes('حملة معتمدة') && status.includes('أجندة معتمدة'), 'Approval label still distinguishes agendas and campaigns');
check(dash.includes('<PlanStatusBadges') && detail.includes('<PlanStatusBadges') && report.includes('<PlanStatusBadges'), 'All three marketing contexts share one lifecycle visual');
check(report.includes('plan.creator_name?.trim()') && report.includes('منشئ {isCampaign'), 'Actual plan creator appears in the report even after approval');
check(server.includes("coalesce(creator.full_name,'') as creator_name"), 'Creator is returned from the plan server query');
check(detail.includes('<input type="text" list="mkw-plan-note-types"') && detail.includes('categoryName:') && detail.includes('setNoteType'), 'Custom review categories are optional writable text with suggestions');
check(server.includes('const revisionNote =') && server.includes('categoryName && !categoryId') && server.includes('category_name: entry.category_name || customType[1]'), 'Free-form note categories persist and appear as history category names without migration');
check(css.includes('.mkw-plan-progress-tag.is-publishing') && css.includes('.mkw-plan-progress-tag.is-published') && !css.includes('.mkw-approved-plan-badge'), 'No oversized bright approval badges remain');
check(!dash.includes('mkw-dashboard-publish-card.mkw-plan-publishing { border-color:#93c5fd'), 'Blue-framed publishing cards have restrained brand-neutral borders');
for(const path of ['src/marketing/workflow/PlanStatus.tsx','src/marketing/workflow/PlanDetail.tsx','src/marketing/workflow/PlanReport.tsx','src/marketing/pages/MarketingDashboardPage.tsx','server/marketing/workflow.ts']){
 const source=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 check(source.parseDiagnostics.length===0,`${path} parses as TS/TSX`);
}
console.log(`Marketing status, creator and notes: ${n}/${n} tests passed`);
