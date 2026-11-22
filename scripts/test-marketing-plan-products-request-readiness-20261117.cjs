'use strict';
// «بيانات المنتجات» for EVERY agenda/campaign (strategy or marketing) and the
// compact PDF schedule columns: رقم الطلب after التاريخ, الجاهزية after المنفذ.
// No production DB: the real server handler runs against controlled queries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const read = name => fs.readFileSync(name, 'utf8');
let passed = 0;
async function check(message, fn) { await fn(); passed++; console.log('PASS:', message); }

const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = { id: uid(1), fullName: 'Admin', permissions: ['platform.superadmin'], deniedPermissions: [],
  systemAccess: { marketing: { dataScope: 'all', roleCode: 'admin', branchCodes: [], departmentCodes: [] } } };
const serverStubs = {
  '../_db.js': { getSql: () => { throw Error('No production database in this test'); }, withDatabaseAdvisoryLock: async (_, fn) => fn() },
  '../_auth.js': { loadUserProfile: async () => admin },
  '../_access-control.js': { getSystemAccess: u => u.systemAccess.marketing },
  '../_marketing-workflow-schema.js': { marketingStrategyDraftsReady: async () => false, assertMarketingWorkflowReady: async () => {},
    marketingPlanScheduleSchemaStatus: async () => ({}), marketingWorkflowStructureStatus: async () => ({}), ensureMarketingWorkflowSchema: async () => {} },
  '../_notifications.js': { createNotification: async () => {} },
  '../_media-storage.js': { createUploadUrl: () => {}, headMediaObject: async () => ({}), mediaStorageConfigured: () => false, buildMarketingStorageKey: () => '' },
  '../_google-drive-storage.js': { createGoogleDriveResumableUpload: async () => ({}), verifyGoogleDriveUploadedFile: async () => ({}) },
};

(async () => {
  // ---------------------------------------------------------------- server
  const server = createLoader(process.cwd(), serverStubs, { 'server/marketing/workflow.ts': '\nexport { planProductRows };' });
  const { planProductRows } = server('server/marketing/workflow.ts');
  const format = { id: uid(11), platform_id: uid(21), platform_name: 'Instagram', platform_code: 'instagram', name: 'Photo', width: 1080, height: 1080 };
  const planId = uid(62);
  // A NATIVE campaign (no strategy draft): two products from one task, the 2nd
  // product is scheduled earlier, plus the internal search-keywords product.
  const lines = [
    { id: uid(71), plan_id: planId, product_id: uid(51), kind: 'campaign', plan_no: 'CMP-000040', name: 'حملة', task_no: 'TSK-000300', requirement_number: 1,
      idea_name: 'صورة السيارة', media_kind: 'image', assignee_name: 'محمود', scheduled_on: '2026-12-05', review_status: 'publishing' },
    { id: uid(72), plan_id: planId, product_id: uid(52), kind: 'campaign', plan_no: 'CMP-000040', name: 'حملة', task_no: 'TSK-000300', requirement_number: 2,
      idea_name: 'فيديو السيارة', media_kind: 'video', assignee_name: 'بلال', scheduled_on: '2026-12-01', review_status: 'publishing' },
    { id: uid(73), plan_id: planId, product_id: uid(51), kind: 'campaign', plan_no: 'CMP-000040', name: 'حملة', task_no: 'TSK-000300', requirement_number: 1,
      idea_name: 'صورة السيارة', media_kind: 'image', assignee_name: 'محمود', scheduled_on: '2026-12-09', review_status: 'publishing' },
    { id: uid(74), plan_id: planId, product_id: uid(53), kind: 'campaign', plan_no: 'CMP-000040', name: 'حملة', task_no: 'MANUAL-KEYWORDS', requirement_number: 1,
      idea_name: 'كلمات بحث', media_kind: 'image', assignee_name: 'Admin', scheduled_on: '2026-12-02', review_status: 'publishing' },
  ];
  const finalFile = { id: uid(41), name: 'final.jpg', mime_type: 'image/jpeg', category: 'final', format_id: format.id, status: 'ready' };
  const items = {
    [uid(300)]: [
      // Approved with uploaded final → 100%.
      { id: uid(51), task_id: uid(300), media_kind: 'image', status: 'approved', formats: [format], files: [finalFile],
        format_reviews: [{ format_id: format.id, status: 'approved' }],
        idea_name: 'صورة السيارة', assignee_name: 'محمود', due_on: '2026-11-20', approved_at: '2026-11-18T10:00:00.000Z' },
      // Not executed yet, nothing uploaded → 0%, execution date = due date.
      { id: uid(52), task_id: uid(300), media_kind: 'video', status: 'in_progress', formats: [format], files: [], format_reviews: [],
        idea_name: 'فيديو السيارة', assignee_name: 'بلال', due_on: '2026-11-25', approved_at: null },
    ],
    [uid(301)]: [
      { id: uid(53), task_id: uid(301), media_kind: 'image', status: 'approved', formats: [format], files: [], format_reviews: [],
        idea_name: 'كلمات بحث', assignee_name: 'Admin', due_on: '2026-11-15', approved_at: '2026-11-15T08:00:00.000Z' },
    ],
  };
  const sql = async (strings, ...values) => {
    const q = strings.join('?').replace(/\s+/g, ' ').trim();
    if (q.includes("to_regclass('marketing.work_plan_reviewers')")) return [{ present: false }];
    if (q.startsWith('select l.*,l.scheduled_on::text')) return lines;
    if (q.startsWith('select i.id::text,i.task_id::text,coalesce(ct.name')) return [
      { id: uid(51), task_id: uid(300), type_name: 'تعريفي' }, { id: uid(52), task_id: uid(300), type_name: 'تعريفي' },
      { id: uid(53), task_id: uid(301), type_name: 'بيعي' }];
    if (q.startsWith('select i.*,i.due_on::text,coalesce(d.name')) return items[values[0]] || [];
    throw new Error(`Unexpected workflow SQL: ${q}`);
  };
  const result = await planProductRows(sql, admin, planId);

  await check('Native marketing campaigns get product rows (not only strategy plans)', () => {
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'campaign');
    assert.equal(result.planNo, 'CMP-000040');
    assert.equal(result.rows.length, 3, 'one row per product, repeated platforms collapse');
  });
  await check('Rows follow the first planned date of each product', () => {
    assert.deepEqual(result.rows.map(row => row.ideaName), ['فيديو السيارة', 'كلمات بحث', 'صورة السيارة']);
  });
  await check('رقم التاسك, رقم الطلب (task-requirement) and رقم الحملة are separate values', () => {
    const image = result.rows.find(row => row.ideaName === 'صورة السيارة');
    assert.equal(image.taskNo, 'TSK-000300');
    assert.equal(image.requestNo, 'TSK-000300-01');
    assert.equal(image.planNo, 'CMP-000040');
    assert.equal(result.rows.find(row => row.ideaName === 'فيديو السيارة').requestNo, 'TSK-000300-02');
  });
  await check('Readiness is the execution-section requirement readiness', () => {
    assert.equal(result.rows.find(row => row.ideaName === 'صورة السيارة').readiness, 100);
    assert.equal(result.rows.find(row => row.ideaName === 'فيديو السيارة').readiness, 0);
  });
  await check('Execution date: approval day when executed, otherwise the due date', () => {
    const image = result.rows.find(row => row.ideaName === 'صورة السيارة');
    assert.equal(image.approvedOn, '2026-11-18'); assert.equal(image.executionOn, '2026-11-18');
    const video = result.rows.find(row => row.ideaName === 'فيديو السيارة');
    assert.equal(video.approvedOn, null); assert.equal(video.executionOn, '2026-11-25');
  });
  await check('Native rows fall back to the task type as category; keywords keep the bare task no and are ready', () => {
    assert.equal(result.rows.find(row => row.ideaName === 'صورة السيارة').category, 'تعريفي');
    const keywords = result.rows.find(row => row.ideaName === 'كلمات بحث');
    assert.equal(keywords.requestNo, 'MANUAL-KEYWORDS');
    assert.equal(keywords.readiness, 100);
  });
  await check('An unknown/invisible plan is refused', async () => {
    const none = async (strings) => {
      const q = strings.join('?').replace(/\s+/g, ' ').trim();
      if (q.includes("to_regclass('marketing.work_plan_reviewers')")) return [{ present: false }];
      if (q.startsWith('select l.*,l.scheduled_on::text')) return [];
      throw new Error(`Unexpected workflow SQL: ${q}`);
    };
    await assert.rejects(() => planProductRows(none, admin, uid(99)));
  });

  // ---------------------------------------------------------------- PDF
  const client = createLoader(process.cwd(), {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    './api': { showDate: date => String(date || '—').slice(0, 10) },
  });
  const { planPdfSummaryHtml, planLineRequestNo } = client('src/marketing/workflow/campaignPdfExport.ts');
  const pdfLines = [
    { id: 'a', product_id: 'p1', task_no: 'TSK-000212', requirement_number: 1, idea_name: 'بنزين 91 ولا 95', product_idea: 'فكرة',
      platform_code: 'snapchat', platform_name: 'سناب شات', assignee_name: 'محمود فؤاد', scheduled_on: '2026-11-18', budget_amount: 100 },
    { id: 'b', product_id: 'p2', task_no: 'TSK-000213', requirement_number: 3, idea_name: 'صور السيارة', product_idea: 'فكرة ثانية',
      platform_code: 'instagram', platform_name: 'انستجرام', assignee_name: 'بلال', scheduled_on: '2026-11-19', budget_amount: 50 },
  ];
  const html = planPdfSummaryHtml({ kind: 'campaign', planName: 'حملة ديسمبر', planNo: 'CMP-000034', lines: pdfLines,
    readinessByProduct: { p1: 75 } });
  const section = html.split('<section class="schedule-section">')[1].split('</section>')[0];

  await check('PDF compact schedule: رقم الطلب after التاريخ, الجاهزية after المنفذ', () => {
    assert.match(html, /<th>التاريخ<\/th><th>رقم الطلب<\/th><th>نوع المنتج<\/th><th>التصنيف<\/th><th>الفكرة<\/th><th>المنفذ<\/th><th>الجاهزية<\/th><th>المنصة<\/th>/);
  });
  await check('PDF rows carry the request number and readiness in column order', () => {
    assert.match(section, /<td class="schedule-dates" rowspan="1">2026-11-18<\/td><td class="schedule-requests"><div class="schedule-meta-value" dir="ltr">TSK-000212-01<\/div><\/td><td class="schedule-product"/);
    assert.match(section, /محمود فؤاد<\/div><\/td><td class="schedule-readiness"><div class="schedule-meta-value">75%<\/div><\/td><td class="schedule-platforms">/);
    assert.match(section, /TSK-000213-03/);
  });
  await check('Missing readiness shows «—», never an invented value', () => {
    assert.match(section, /بلال<\/div><\/td><td class="schedule-readiness"><div class="schedule-meta-value">—<\/div><\/td>/);
  });
  await check('Request number rule is shared with the server', () => {
    assert.equal(planLineRequestNo({ task_no: 'TSK-000001', requirement_number: 4 }), 'TSK-000001-04');
    assert.equal(planLineRequestNo({ task_no: 'MANUAL-KEYWORDS', requirement_number: 1 }), 'MANUAL-KEYWORDS');
    assert.equal(planLineRequestNo({ task_no: 'TSK-000001' }), 'TSK-000001');
  });
  await check('Empty schedule spans all seven columns', () => {
    assert.match(planPdfSummaryHtml({ kind: 'agenda', planName: 'أ', planNo: 'AGD-1', lines: [] }), /<td colspan="8">لا توجد منشورات<\/td>/);
  });

  // ---------------------------------------------------------------- wiring
  await check('Products table order: م، رقم التاسك، رقم الطلب، رقم الحملة/الأجندة … تاريخ التنفيذ، الجاهزية', () => {
    const table = read('src/marketing/workflow/StrategyProductsTable.tsx');
    assert.match(table, /<th>م<\/th><th>رقم التاسك<\/th><th>رقم الطلب<\/th><th>\{planNumberLabel\(kind\)\}<\/th><th>التصنيف<\/th><th>المطلوب<\/th><th>اسم المنفذ<\/th><th>اسم الفكرة<\/th><th>تاريخ التنفيذ<\/th><th>الجاهزية<\/th>/);
    assert.match(table, /kind === 'campaign' \? 'رقم الحملة' : 'رقم الأجندة'/);
    assert.doesNotMatch(table, /رقم التكليف/);
  });
  await check('The plan report shows products for EVERY plan and feeds readiness to the PDF', () => {
    const report = read('src/marketing/workflow/PlanReport.tsx');
    assert.match(report, /useWorkQuery<PlanProductsData>\('plan_products', \{ planId: id \}\)/);
    assert.match(report, /<PlanProductsSection data=\{products\.data\}/);
    assert.doesNotMatch(report, /StrategyPlanProductsSection/);
    assert.match(report, /readinessByProduct: planProductReadiness\(products\.data\?\.rows\)/);
  });
  await check('The dashboard preparation PDF also carries readiness', () => {
    const dashboard = read('src/marketing/pages/MarketingDashboardPage.tsx');
    assert.match(dashboard, /useWorkQuery<PlanProductsData>\('plan_products', \{ planId: selectPlan \}, Boolean\(selectPlan\)\)/);
    assert.match(dashboard, /readinessByProduct: planProductReadiness\(chooserProducts\.data\?\.rows\)/);
  });
  await check('Server exposes the resource and the strategy draft report gets readiness', () => {
    const workflow = read('server/marketing/workflow.ts');
    assert.match(workflow, /resource === 'work_plan_products'\) \{\s*result = await planProductRows\(sql, user, id\(request\.query\.planId\)\)/);
    assert.match(workflow, /strategyPlanReport\(sql, user, request\.query as Row, loadItems\)/);
  });

  console.log(`Plan products, request number and readiness: ${passed}/${passed} passed`);
})().catch(error => { console.error(error); process.exit(1); });
