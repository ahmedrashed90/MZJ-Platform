// Strategy flow (agenda/campaign drafts from «إنشاء التكليفات») against a REAL
// Postgres with the full Marketing schema. Run only on a disposable database:
//   MZJ_TEST_DATABASE_URL=postgres://... node scripts/test-strategy-drafts-flow-20261115.cjs
// Without that variable it prints SKIP (never touches any configured database).
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const root = path.resolve(__dirname, '..');
const url = process.env.MZJ_TEST_DATABASE_URL;
if (!url) { console.log('SKIP: set MZJ_TEST_DATABASE_URL to a disposable database to run the strategy draft flow test'); process.exit(0); }
process.env.DATABASE_URL = url;
const pg = createRequire(path.join(root, 'package.json'))('postgres');
const load = createLoader(root, { postgres: { default: pg, __esModule: true }, '../_notifications.js': { createNotification: async () => {} } },
  { 'server/marketing/workflow.ts': '\nexport { createPlan, changePlanReview, loadItems, canReviewPlan, planLines, products, marketingIdeaTracking };' });
const workflow = load('server/marketing/workflow.ts');
const drafts = load('server/marketing/strategy-drafts.ts');
const { saudiCalendarDay } = load('shared/marketing-publication-timing.ts');
const sql = load('server/_db.ts').getSql();
const deps = { createPlan: workflow.createPlan, changePlanReview: workflow.changePlanReview, loadItems: workflow.loadItems, canReviewPlan: workflow.canReviewPlan };
const access = (scope = 'all') => ({ marketing: { enabled: true, dataScope: scope, roleId: null, roleCode: 'marketing_admin', branchCodes: [], departmentCodes: [], vehicleStatusCodes: [] } });
const perms = ['system.marketing.access','marketing.task.create','marketing.idea_tracking.view','marketing.task.view_all','marketing.task.review','marketing.products.view','marketing.agenda.create',
  'marketing.campaign.create','marketing.dashboard.view','marketing.publish_prep.view','marketing.publish_prep.manage','marketing.database.view'];
const addDays = (n) => { const d = new Date(`${saudiCalendarDay()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ok = (m) => console.log('PASS:', m);

(async () => {
  const today = saudiCalendarDay();
  const [integration, ahmed, reviewer, executor] = await Promise.all([1,2,3,4].map(async n => {
    const [row] = await sql`insert into core.users(full_name,is_active,can_receive_tasks) values(${'User ' + n + ' ' + randomUUID().slice(0,6)},true,true) returning id::text`; return row.id; }));
  for (const userId of [integration, ahmed, reviewer, executor]) await sql`insert into core.user_systems(user_id,system_code,is_enabled,data_scope) values(${userId}::uuid,'marketing',true,'all') on conflict do nothing`;
  const deptId = randomUUID();
  await sql`insert into core.departments(id,code,name,system_code,is_active) values(${deptId}::uuid,${'design-' + deptId.slice(0,6)},'تصميم','marketing',true)`;
  const [dept] = await sql`insert into marketing.departments(id,name,is_active) values(${deptId}::uuid,${'تصميم ' + deptId.slice(0,6)},true) returning id::text`;
  await sql`insert into core.user_system_departments(user_id,system_code,department_id,is_primary) values(${executor}::uuid,'marketing',${dept.id}::uuid,true)`;
  const [type] = await sql`insert into marketing.campaign_types(name,short_code,code_prefix,is_active) values(${'تعريف ' + randomUUID().slice(0,6)},${'T' + randomUUID().slice(0,4)},'TS',true) returning id::text`;
  const [ig] = await sql`insert into marketing.platforms(code,name,is_active) values(${'instagram'},'Instagram',true) on conflict do nothing returning id::text`;
  const igId = ig?.id || (await sql`select id::text from marketing.platforms where code='instagram'`)[0].id;
  const [post] = await sql`insert into marketing.platform_post_types(platform_id,name,width,height,is_active) values(${igId}::uuid,'Image Post',1080,1080,true) returning id::text`;
  // A second platform NOT among the idea's produced sizes, plus a video-only type.
  const ttCode = 'tiktok-' + randomUUID().slice(0, 6);
  const [tt] = await sql`insert into marketing.platforms(code,name,is_active) values(${ttCode},'TikTok',true) returning id::text`;
  const [ttStory] = await sql`insert into marketing.platform_post_types(platform_id,name,width,height,is_active) values(${tt.id}::uuid,'Image Story',1080,1920,true) returning id::text`;
  const [ttVideo] = await sql`insert into marketing.platform_post_types(platform_id,name,width,height,is_active) values(${tt.id}::uuid,'Video Reel',1080,1920,true) returning id::text`;
  await sql`insert into marketing.work_plan_reviewers(slot,user_id) values(1,${reviewer}::uuid) on conflict(slot) do update set user_id=excluded.user_id`;
  const [goal] = await sql`insert into marketing.work_campaign_goals(name) values(${'زيادة الليدات ' + randomUUID().slice(0,4)}) returning id::text`;
  const user = (id, scope) => ({ id, fullName: 'Tester', permissions: perms, deniedPermissions: [], roleCodes: ['marketing_admin'], systemAccess: access(scope) });
  const INT = user(integration), AH = user(ahmed), RV = user(reviewer);

  async function assign(count, prefix, placementFor) {
    const requestKey = randomUUID();
    const codes = Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
    const items = codes.map(code => ({ clientKey: randomUUID(), ideaCode: code, departmentId: dept.id, assigneeId: executor, deliveryMode: 'files',
      mediaKind: 'image', ideaName: `فكرة ${code}`, idea: `بريف ${code}`, explanation: '', creativeTreatment: '', dueOn: addDays(3), formatIds: [post.id] }));
    const input = { requestKey, typeId: type.id, name: `تعريفي - بالبراند ${prefix}`, source: { planId: 'plan-test', ideaCodes: codes }, items };
    const placements = codes.map((code, i) => ({ ideaCode: code, category: 'تعريفي - بالبراند', ...placementFor(i) }));
    await drafts.validateStrategyPlacements(sql, placements);
    const task = await workflow.createStrategyWorkflowTask(sql, input, INT);
    const apply = () => drafts.applyStrategyPlacements(sql, INT, { taskId: task.id, requestKey, placements, items: task.items,
      itemIdeaCodes: new Map(items.map(item => [item.clientKey, item.ideaCode])) });
    const touched = await apply();
    return { task, touched, apply, input };
  }

  // 1) 4 ideas → new «أجندة ديسمبر»; 2) 8 more via dropdown (id) and a typed variant of the same name → one draft with 12.
  const first = await assign(4, 'A', () => ({ kind: 'agenda', name: 'أجندة ديسمبر', date: addDays(10) }));
  const agendaDraft = first.touched[0];
  assert.equal(first.touched.length, 1); assert.equal(agendaDraft.planNo, null, 'no AGD code while it is a draft');
  const second = await assign(8, 'B', i => i < 6 ? { kind: 'agenda', draftId: agendaDraft.id, date: addDays(11) } : { kind: 'agenda', name: 'اجندة  ديسمبر', date: addDays(12) });
  assert.deepEqual([...new Set(second.touched.map(row => row.id))], [agendaDraft.id]);
  let open = await drafts.listOpenStrategyDrafts(sql);
  assert.equal(open.drafts.find(row => row.id === agendaDraft.id).ideaCount, 12);
  ok('4 + 8 ideas accumulate in ONE draft «أجندة ديسمبر» (dropdown id and typed name both reach it) = 12');
  await first.apply();
  assert.equal((await sql`select count(*)::int as n from marketing.strategy_plan_draft_entries where draft_id=${agendaDraft.id}::uuid`)[0].n, 12);
  ok('retried assignment is idempotent (no duplicate ideas or drafts)');
  await assert.rejects(() => drafts.applyStrategyPlacements(sql, INT, { taskId: first.task.id, requestKey: randomUUID(),
    placements: [{ ideaCode: 'A01', kind: 'agenda', name: 'أجندة أخرى', date: addDays(10), category: '' }], items: first.task.items,
    itemIdeaCodes: new Map(first.input.items.map(item => [item.clientKey, item.ideaCode])) }), /مرتبطة بالفعل/);
  ok('an idea cannot sit in two open drafts');

  const campaign = await assign(2, 'C', () => ({ kind: 'campaign', name: 'حملة رمضان', date: addDays(20) }));
  const campaignDraft = campaign.touched[0]; assert.equal(campaignDraft.planNo, null);
  await assert.rejects(() => drafts.validateStrategyPlacements(sql, [{ ideaCode: 'X', kind: 'agenda', draftId: campaignDraft.id, date: addDays(5), category: '' }]), /نوع المسودة/);
  ok('campaign draft created by name without a code; kind mismatch rejected before any task');

  // Dashboard: drafts visible even though nothing is executed.
  let board = await drafts.strategyDraftsForDashboard(sql, AH);
  const agendaCard = board.drafts.find(row => row.id === agendaDraft.id);
  assert.equal(agendaCard.ideaCount, 12); assert.equal(agendaCard.readyCount, 0); assert.equal(agendaCard.status, 'draft');
  await assert.rejects(() => drafts.submitStrategyDraft(sql, AH, { draftId: agendaDraft.id }, deps), /قبل اكتمال/);
  ok('draft cards exist before execution; «إرسال للمراجعة» refused while ideas are not configured');

  const detailResult = await drafts.strategyDraftDetail(sql, AH, agendaDraft.id);
  const detail = detailResult.draft;
  assert(detailResult.platforms.some(row => row.platformId === tt.id && row.postTypes.some(type => type.id === ttVideo.id && type.mediaKinds.join() === 'video')));
  await assert.rejects(() => drafts.saveStrategyDraftEntry(sql, AH, { draftId: agendaDraft.id, entryId: detail.ideas[0].id,
    scheduledOn: detail.ideas[0].publishOn, platforms: [{ platformId: tt.id, postTypes: [{ postTypeId: ttVideo.id }] }] }), /لا يناسب/);
  ok('editor offers ALL active platforms/publish types; a video-only type is refused for an image idea');
  for (const idea of detail.ideas) await drafts.saveStrategyDraftEntry(sql, AH, { draftId: agendaDraft.id, entryId: idea.id, version: idea.version,
    scheduledOn: idea.publishOn, platforms: [{ platformId: igId, postTypes: [{ postTypeId: post.id }] }, { platformId: tt.id, postTypes: [{ postTypeId: ttStory.id }] }] });
  const agendaResult = await drafts.submitStrategyDraft(sql, AH, { draftId: agendaDraft.id }, deps);
  const [agendaPlan] = await sql`select plan_no,review_status,kind from marketing.work_plans where id=${agendaResult.id}::uuid`;
  assert.match(agendaPlan.plan_no, /^AGD-\d{6}$/); assert.equal(agendaPlan.plan_no, agendaResult.planNo);
  assert.equal(agendaPlan.review_status, 'submitted'); assert.equal(agendaPlan.kind, 'agenda');
  const agendaLinesPending = await workflow.planLines(sql, AH, agendaResult.id);
  assert(agendaLinesPending.every(line => line.strategy_product_pending === true), 'preparation waits for final files');
  const pickerPending = await drafts.strategyPlanProducts(sql, AH, { productManager: true, manager: true, departments: [] });
  assert(pickerPending.rows.some(row => row.id === first.task.items[0].id && row.strategy_pending && row.strategy_order_no === agendaResult.planNo));
  const copyLine = agendaLinesPending[0];
  await drafts.saveStrategyLineCopy(sql, AH, { lineId: copyLine.id, caption: 'كابشن تجريبي', hashtags: '#MZJ' }, workflow.planLines);
  assert.equal((await workflow.planLines(sql, AH, agendaResult.id)).find(line => line.id === copyLine.id).caption, 'كابشن تجريبي');
  ok("caption + hashtags can be written before the product is delivered");
  ok('«إرسال للمراجعة» works BEFORE execution; the AGD code is given now; plan lines flagged «بانتظار تسليم الملفات النهائية»; strategy products listed for إنشاء أجندة/حملة');
  assert.equal((await sql`select count(*)::int as n from marketing.work_plan_items where plan_id=${agendaResult.id}::uuid`)[0].n, 24);
  board = await drafts.strategyDraftsForDashboard(sql, AH);
  assert(!board.drafts.some(row => row.id === agendaDraft.id));
  ok('complete agenda draft → native agenda with the SAME code AGD, status «submitted» (same review flow), 12 ideas × 2 platforms = 24 posts');
  const repeat = await drafts.submitStrategyDraft(sql, AH, { draftId: agendaDraft.id }, deps);
  assert.equal(repeat.id, agendaResult.id); ok('re-submit returns the same agenda (idempotent)');

  // Campaign: budgets + goal, funding date per idea.
  const cDetail = (await drafts.strategyDraftDetail(sql, AH, campaignDraft.id)).draft;
  for (const idea of cDetail.ideas) {
    await assert.rejects(() => drafts.saveStrategyDraftEntry(sql, AH, { draftId: campaignDraft.id, entryId: idea.id, scheduledOn: addDays(15),
      platforms: [{ platformId: igId, postTypes: [{ postTypeId: post.id, budget: '' }] }] }), /ميزانية/);
    await drafts.saveStrategyDraftEntry(sql, AH, { draftId: campaignDraft.id, entryId: idea.id, scheduledOn: addDays(15), fundingOn: idea.fundingOn,
      platforms: [{ platformId: igId, postTypes: [{ postTypeId: post.id, budget: 250.5 }] }] });
  }
  await assert.rejects(() => drafts.submitStrategyDraft(sql, AH, { draftId: campaignDraft.id }, deps), /الهدف من الحملة/);
  await drafts.saveStrategyDraftSettings(sql, AH, { draftId: campaignDraft.id, platformGoals: [{ platformId: igId, goalIds: [goal.id] }] });
  const campaignResult = await drafts.submitStrategyDraft(sql, AH, { draftId: campaignDraft.id }, deps);
  const [cPlan] = await sql`select p.plan_no,p.review_status,c.payload from marketing.work_plans p join marketing.campaigns c on c.id=p.id where p.id=${campaignResult.id}::uuid`;
  assert.match(cPlan.plan_no, /^CMP-\d{6}$/); assert.equal(cPlan.payload.fundingFrom, addDays(20)); assert.equal(cPlan.payload.fundingTo, addDays(20));
  ok('campaign draft requires budget per post type and a goal per platform → native campaign CMP, funding period from idea funding dates');

  await workflow.changePlanReview(sql, RV, { planId: campaignResult.id, decision: 'approved', note: '' });
  let lines = await workflow.planLines(sql, AH, campaignResult.id);
  assert.equal(lines.length, 2); assert(lines.every(line => line.strategy_funding_on === addDays(20) && line.publication_timing === null && !line.published_ready));
  await assert.rejects(() => drafts.linkStrategyCampaign(sql, AH, { planId: agendaResult.id, lineIds: [lines[0].id], platform: 'meta', accountId: 'a', campaignId: 'c' }, deps));
  await assert.rejects(() => drafts.linkStrategyCampaign(sql, AH, { planId: campaignResult.id, lineIds: [lines[0].id], platform: 'meta', accountId: 'act_1', campaignId: '99', campaignName: 'Ramadan' }, deps), /لم يُسلَّم/);
  ok('campaign cannot be linked as published before its products are delivered');
  // Executors deliver and reviewers approve (native rule: approved + final coverage).
  const allItems = [...first.task.items, ...second.task.items, ...campaign.task.items];
  for (const item of allItems) {
    const [file] = await sql`insert into marketing.files(storage_key,original_name,mime_type,file_size,category,status)
      values(${'k/' + item.id},'final.jpg','image/jpeg',10,'work-final','ready') returning id::text`;
    await sql`insert into marketing.work_item_files(item_id,file_id,category,format_id) values(${item.id}::uuid,${file.id}::uuid,'final',${post.id})`;
    await sql`update marketing.work_items set status='approved',approved_at=now() where id=${item.id}::uuid`;
  }
  assert((await workflow.planLines(sql, AH, agendaResult.id)).every(line => !line.strategy_product_pending));
  ok('after execution + approval the publications become preparable');
  await drafts.linkStrategyCampaign(sql, AH, { planId: campaignResult.id, lineIds: [lines[0].id], platform: 'meta', accountId: 'act_1', campaignId: '99', campaignName: 'Ramadan' }, deps);
  await sql`update marketing.strategy_plan_line_meta set funding_on=${addDays(-1)}::date where line_id=${lines[1].id}::uuid`;
  await drafts.linkStrategyCampaign(sql, AH, { planId: campaignResult.id, lineIds: [lines[1].id], platform: 'meta', accountId: 'act_1', campaignId: '99', campaignName: 'Ramadan' }, deps);
  lines = await workflow.planLines(sql, AH, campaignResult.id);
  const byId = new Map(lines.map(line => [line.id, line]));
  assert.equal(byId.get(lines[0].id).strategy_campaign_link.linkedOn, today);
  assert.deepEqual(lines.map(line => line.publication_timing).sort(), ['late', 'on_time']);
  assert(lines.every(line => line.published_ready && line.status === 'published'));
  ok('«تقارير الحملات» link on/before funding date = نشر في الموعد; after it = تأخر في النشر');
  const tracking = (await workflow.marketingIdeaTracking(sql, AH, {})).rows;
  const cTrack = tracking.find(row => row.taskId === campaign.task.id), aTrack = tracking.find(row => row.taskId === first.task.id);
  assert.equal(cTrack.fundingPercent, 100, 'in campaign 50% + linked to campaign reports 50%');
  assert.equal(cTrack.executionPercent, 100);
  assert.equal(aTrack.publishingPercent, 50, 'in agenda 50%, no post link yet');
  ok('التراكينج: execution 50/50 (submit/approve), publishing 50/50 (agenda/link), funding 50/50 (campaign/report link)');

  const products = await drafts.strategyProducts(sql, AH, { productManager: true, manager: true, departments: [] }, workflow.loadItems);
  assert(products.rows.every(row => row.readiness >= 50 || row.ideaCode.startsWith('T')), 'readiness per idea (files delivered; seeded without per-format review)');
  const productA01 = products.rows.find(row => row.ideaCode === 'A01');
  assert.equal(productA01.orderNo, agendaResult.planNo); assert.equal(productA01.category, 'تعريفي - بالبراند');
  assert.match(productA01.assignmentNo, /^TSK-\d{6}-\d{2}$/); assert.equal(productA01.publishOn, addDays(10));
  const productC = products.rows.find(row => row.ideaCode === 'C01');
  assert.equal(productC.fundingOn, addDays(20)); assert.equal(productC.publishOn, addDays(15));
  const picker = await workflow.products(sql, AH);
  const pickA01 = picker.find(row => row.id === first.task.items[0].id);
  assert.equal(pickA01.strategy_order_no, agendaResult.planNo); assert.equal(pickA01.strategy_category, 'تعريفي - بالبراند');
  const report = await drafts.strategyPlanReport(sql, AH, { planId: campaignResult.id });
  assert.equal(report.draft.ideas.length, 2);
  ok('products tab tracking (رقم التكليف/التاسك/الطلب, تاريخ التنفيذ/النشر/التمويل) and plan report data');

  // «حذف الاسم» from the strategy page: only names not sent for review.
  const trial = await assign(1, 'T', () => ({ kind: 'agenda', name: 'أجندة تجربة', date: addDays(9) }));
  await drafts.deleteStrategyDraftFromIntegration(sql, trial.touched[0].id);
  assert(!(await drafts.listOpenStrategyDrafts(sql)).drafts.some(row => row.id === trial.touched[0].id));
  await assert.rejects(() => drafts.deleteStrategyDraftFromIntegration(sql, agendaDraft.id), /أُرسل|إرساله/);
  ok('trial names can be deleted from the strategy page; tasks stay; submitted ones are refused');
  const composed = await workflow.createPlan(sql, { requestKey: randomUUID(), kind: 'campaign', name: 'حملة من إنشاء حملة', fundingFrom: addDays(5), fundingTo: addDays(6),
    platformGoals: [{ platformId: igId, goalIds: [goal.id] }],
    entries: [{ productId: trial.task.items[0].id, date: addDays(5), platforms: [{ platformId: igId, postTypes: [{ postTypeId: post.id, budget: 100 }] }] }] }, AH);
  assert((await workflow.planLines(sql, AH, composed.id))[0].product_id === trial.task.items[0].id);
  ok('«إنشاء حملة» accepts a strategy product before execution (native products still need approval)');
  // Native plans are untouched by the strategy decoration.
  const nativeItem = second.task.items[0];
  const native = await workflow.createPlan(sql, { requestKey: randomUUID(), kind: 'agenda', name: 'أجندة عادية',
    entries: [{ productId: nativeItem.id, date: addDays(30), platforms: [{ platformId: igId, postTypes: [{ postTypeId: post.id, budget: 0 }] }] }] }, AH);
  const nativeLines = await workflow.planLines(sql, AH, native.id);
  assert.equal(nativeLines.length, 1); assert(!('strategy_draft_id' in nativeLines[0])); assert(!('strategy_funding_on' in nativeLines[0]));
  ok('native agenda flow unchanged (no strategy fields, normal numbering)');
  await sql.end();
  console.log('ALL strategy draft flow checks passed');
})().catch(async error => { console.error(error); try { await sql.end(); } catch {} process.exit(1); });
