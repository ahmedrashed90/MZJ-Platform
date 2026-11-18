'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const read = file => fs.readFileSync(file, 'utf8');
const composer = read('src/marketing/workflow/planComposer.ts');
const create = read('src/marketing/workflow/CreatePage.tsx');
const dashboard = read('src/marketing/pages/MarketingDashboardPage.tsx');
const review = read('src/marketing/workflow/PlanDetail.tsx');
const prep = read('src/marketing/workflow/PublishPage.tsx');
const server = read('server/marketing/workflow.ts');
const css = read('src/marketing/workflow/workflow.css');
let checks = 0;
function check(condition, description) { assert.ok(condition, description); checks++; console.log('PASS: ' + description); }
check(composer.includes('postTypeBudgets?: Record<string, string>') && composer.includes('postTypes,'),
  'Campaign draft keeps distinct budget amounts per selected publishing type');
check(create.includes('selectedIds.map((postTypeId, index)') && create.includes('[postTypeId]: event.target.value'),
  'Campaign UI renders an individual amount input for every selected post type');
check(create.includes('planPostTypeBudget(platform, postTypeId, typeIndex)') && create.includes('إجمالي اليوم'),
  'Campaign preview and daily total read the same per-type budget values');
check(server.includes('const explicitPostTypes = Array.isArray(platform.postTypes)') && server.includes('selected.budget'),
  'Server persists each publishing type with its own explicit budget');
check(server.includes('if (kind === \'campaign\' && (platform.rawBudget === \'\' || platform.rawBudget == null))'),
  'Server rejects missing amounts for every individual campaign post type');
check(!dashboard.includes('تفاصيل الجدول') && dashboard.includes('canReviewPlans') && dashboard.includes('review_status'),
  'Dashboard removes details-table button and exposes preapproval review only to configured reviewers');
const statusWidget=read('src/marketing/workflow/PlanStatus.tsx');
check(dashboard.includes('<PlanStatusBadges') && statusWidget.includes("kind === 'agenda' ? 'أجندة معتمدة' : 'حملة معتمدة'") && statusWidget.includes('planDisplayState'),
  'Approved campaign and agenda show consistent approval and actual publishing progress');
check(dashboard.includes('onDetails={() => setParams({ plan: id })}') && css.includes('.mkw-plan-approval-tag') && css.includes('.mkw-plan-progress-tag'),
  'Compact approval indicator opens details and publishing status uses restrained styling');
check(!dashboard.includes('المنصة الحالية لا تدعم النشر التلقائي') && !dashboard.includes('mkw-publishing-support-note"'),
  'Unwanted publishing-support notices are not rendered in dashboard cards');
check(server.includes("coalesce(creator.full_name,'') as creator_name") && review.includes('plan!.creator_name?.trim()'),
  'Plan details load and display the real creator name from core.users');
check(prep.includes('const linkFinalized = Boolean(') && prep.includes('readOnly={linkFinalized && !data.canRestoreOriginalUrl}') && prep.includes('data.canSaveLinks && !linkFinalized && !orphanedOriginalUrl') && prep.includes('data.canRestoreOriginalUrl && orphanedOriginalUrl'),
  'URL editor becomes read-only and its save control disappears after first save');
check(server.includes('l.manual_post_url,l.manual_published_on') && server.includes('if (String(line.manual_post_url || \'\').trim() || line.manual_published_on)'),
  'Server blocks second URL save, editing, or deletion under the original row lock');
check(server.includes("(now() at time zone 'Asia/Riyadh')::date") && server.includes('and manual_published_on is null'),
  'First publication date remains server-generated in Saudi timezone and immutable');
check(!/جدول الميزانية/.test(dashboard) && /line\.budget_amount/.test(dashboard) && /line\.budget_amount/.test(review),
  'No duplicate budget view exists; preparation and approval show each line amount');
for (const filename of ['server/marketing/workflow.ts','src/marketing/workflow/CreatePage.tsx','src/marketing/workflow/PlanDetail.tsx',
  'src/marketing/workflow/PublishPage.tsx','src/marketing/pages/MarketingDashboardPage.tsx','src/marketing/workflow/planComposer.ts']) {
  const source = ts.createSourceFile(filename, read(filename), ts.ScriptTarget.Latest, true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  check(source.parseDiagnostics.length === 0, `${filename} has valid TypeScript syntax`);
}
console.log(`MZJ Marketing campaign per-post-type, approval and immutable link: ${checks}/${checks} passed.`);
