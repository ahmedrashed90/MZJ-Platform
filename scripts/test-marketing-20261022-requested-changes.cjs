'use strict';
/** Offline regression checks for the eight scoped MZJ requests. No live API/db calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS', name); }
const workflow = read('server/marketing/workflow.ts');
const schema = read('server/_marketing-workflow-schema.ts');
const detail = read('src/marketing/workflow/TaskDetail.tsx');
const calendar = read('src/marketing/pages/ReceiptCalendarPage.tsx');
const report = read('src/marketing/components/CampaignReportPage.tsx');
const reportService = read('server/_marketing-campaign-report.ts');
const accounts = read('src/marketing/components/ConnectedAccountsOverview.tsx');

test('Representative card has bounded height with an internal scroll, including mobile', () => {
  const css = read('src/styles.css');
  assert(css.includes('.dashboard-representatives-list'));
  assert(css.includes('height:388px; min-height:388px; max-height:388px'));
  assert(css.includes('overflow-y:auto; overscroll-behavior:contain'));
  assert(css.includes('height:360px;min-height:360px;max-height:360px'));
});
test('Rating action is gated on full approval, except archived rejections', () => {
  assert(detail.includes("if (item.status === 'approved') return workItemReadiness(item) === 100"));
  assert(detail.includes("item.status === 'revision'"));
  assert(detail.includes("selectedRatingItem.status === 'rejected'"));
  assert(detail.includes("'save_rejected_rating' : 'save_rating'"));
  assert(workflow.includes('work_save_rejected_rating'));
  assert(workflow.includes('rejectedItems,\n    events'));
  assert(detail.includes('query.data?.rejectedItems?.find'));
  assert(detail.includes('!onlyItems && !deliveryFilter'));
  assert(read('database/migrations/20261022_marketing_rejected_item_ratings.sql').includes('work_rejected_items'));
});
test('Only binary acceptance/rejection uses grade 0 or 3', () => {
  const src = read('shared/marketing-workflow.ts');
  assert(src.includes('isBinaryProductDecisionCriterion'));
  const output = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)((dep) => {
    if (dep.endsWith('/marketing-publishing.js')) return { normalizeMarketingPublishFormat: () => '', publishFormatRequiresImages: () => false, publishFormatRequiresVideo: () => false };
    throw new Error(dep);
  }, module, module.exports);
  assert.equal(module.exports.isBinaryProductDecisionCriterion('قبول أو رفض المنتج'), true);
  assert.equal(module.exports.isBinaryProductDecisionCriterion('قبول او رفض المنتج'), true);
  assert.equal(module.exports.isBinaryProductDecisionCriterion('الجودة'), false);
  const grading = read('server/marketing/evaluations.ts');
  assert(grading.includes('isBinaryProductDecisionCriterion(row.name) && score !== 0 && score !== 3'));
  assert(detail.includes('<option value="0">0 — رفض</option><option value="3">3 — قبول</option>'));
});
test('Notes action appears only after review revision was selected', () => {
  assert(detail.includes("function beginRevision(formatId?: string)"));
  assert(detail.includes("canRate && revisionFormat !== null && reviewableFormats.length > 0"));
  assert(detail.includes('>إضافة ملاحظة</button>'));
  assert(detail.includes("decision === 'revise' ? note : ''"));
});
test('Task identity and requirement blocks are styled independently in brand palette', () => {
  const css = read('src/marketing/workflow/workflow.css');
  assert(css.includes('.mkw-detail-overview { background:linear-gradient'));
  assert(css.includes('.mkw-requirement-review-entry:nth-child(4n+1)'));
  assert(css.includes('.mkw-requirement-review-entry:nth-child(4n+4)'));
});
test('Campaign chart columns and labels open matching detail, with a saved manager', () => {
  assert(report.includes('onSelect={selectCampaign}'));
  assert(report.includes('onClick={() => { if (current) onSelect(current.key); }}'));
  assert(report.includes('highlightedRow.current?.scrollIntoView'));
  assert(report.includes("action:'save_campaign_report_manager'"));
  assert(report.includes('managerName:result.managerName'));
  assert(report.includes('مدير: ${manager.length'));
  assert(reportService.includes('marketing.campaign_report_managers'));
  assert(read('database/migrations/20261022_marketing_campaign_report_managers.sql').includes('primary key(platform,account_id,campaign_id)'));
});
test('Admin and manager can view full calendar, regular user only own due items', () => {
  assert(workflow.includes('const seeAll = isManager(user) || canGradeWorkItem(user);'));
  assert(workflow.includes('(${seeAll} or i.assigned_to=${user.id}::uuid)'));
  assert(workflow.includes('and i.due_on between ${from}::date and ${to}::date'));
  assert(calendar.includes('selected = rows.filter(row => row.due_on === selectedDay)'));
  assert(calendar.includes('selected.filter(row => row.task_id === item.task_id).map(row => row.id)'));
  assert(calendar.includes('المنفذ: {item.assignee_name}'));
});
test('TikTok keeps saved metrics while connection verification waits on API 429', () => {
  assert(accounts.includes("'آخر بيانات محفوظة' : 'بانتظار التحديث'"));
  assert(!accounts.includes('>تعذر التحقق</span>'));
  const server = read('server/_marketing-social-accounts.ts');
  assert(server.includes('تُعرض آخر بيانات محفوظة إن وُجدت'));
  assert(server.includes("const tiktok = await forPlatform('tiktok')"));
  assert(server.includes("const snapchat = await forPlatform('snapchat')"));
  assert(!accounts.includes("account.connected ? 'متصل' : 'غير متصل'"));
});
test('Unrequested Windsor technical notice is no longer shown for connected Snapchat', () => {
  assert(!read('server/_marketing-windsor-snapchat.ts').includes('Snapchat Ads عبر Windsor.ai؛ كل حملة صف واحد'));
  assert(report.includes("provider.platform !== 'snapchat'"));
  assert(report.includes("provider.status !== 'ready'"));
});
test('All modified TS and TSX source files parse with TypeScript 5.x', () => {
  const files = [
    'server/marketing/workflow.ts', 'server/marketing/evaluations.ts', 'server/marketing/index.ts',
    'server/_marketing-workflow-schema.ts', 'server/_marketing-campaign-report.ts', 'server/_marketing-windsor-snapchat.ts',
    'server/_marketing-social-accounts.ts', 'shared/campaign-report.ts', 'shared/marketing-workflow.ts',
    'src/marketing/workflow/TaskDetail.tsx', 'src/marketing/pages/MarketingRatingsPage.tsx',
    'src/marketing/pages/ReceiptCalendarPage.tsx', 'src/marketing/components/CampaignReportPage.tsx',
    'src/marketing/components/ConnectedAccountsOverview.tsx',
  ];
  for (const file of files) {
    const result = ts.transpileModule(read(file), { fileName: file, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
    assert(!result.diagnostics.some(x => x.category === ts.DiagnosticCategory.Error), `Parsing failed: ${file}`);
  }
});
console.log(`\n${count}/${count} checks passed for 2026-10-22 requested changes.`);
