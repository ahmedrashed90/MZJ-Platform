/**
 * Strategy flow (second flow) for agendas and campaigns.
 *
 * The native Marketing flow is untouched. This module adds a pre-plan
 * "draft" that strategy assignments fill by name, idea by idea, before the
 * ideas are executed. When the creator presses «إرسال للمراجعة» the draft is
 * converted into a NORMAL agenda/campaign through the same createPlan() and
 * changePlanReview() used by Marketing, so permissions, allowed/denied
 * products, statuses, approvals and notifications stay exactly as they are.
 */
import type { SessionUser } from '../_auth.js';
import { hasPermission } from '../../shared/system-access.js';
import { getSystemAccess } from '../_access-control.js';
import { finalCoverage, isWorkDate, supportsWorkMedia, workItemReadiness, type WorkItem, type WorkFormat } from '../../shared/marketing-workflow.js';
import { W } from '../../shared/marketing-workflow-labels.js';
import { classifyWorkPublicationTiming, saudiCalendarDay } from '../../shared/marketing-publication-timing.js';
import { marketingStrategyDraftsReady } from '../_marketing-workflow-schema.js';
import type { getSql } from '../_db.js';

type Sql = ReturnType<typeof getSql>;
type Row = Record<string, any>;

/** Native functions injected by workflow.ts (no circular import, no copy of rules). */
export type StrategyDraftDeps = {
  createPlan: (sql: Sql, body: Row, user: SessionUser, reserved?: { planNumber: string; planNo: string }) => Promise<any>;
  changePlanReview: (sql: Sql, user: SessionUser, body: Row) => Promise<any>;
  loadItems: (db: any, taskId: string) => Promise<WorkItem[]>;
  canReviewPlan: (sql: Sql, user: SessionUser) => Promise<boolean>;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown, limit = 2000) => String(value ?? '').trim().slice(0, limit);
function id(value: unknown): string { const s = text(value, 64); if (!uuidPattern.test(s)) throw new Error(W.invalid); return s; }
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const day = (value: unknown) => value ? String(value instanceof Date ? value.toISOString() : value).slice(0, 10) : null;
export const STRATEGY_DRAFT_MIGRATION_MESSAGE = 'حدّث قاعدة بيانات التسويق من الداش بورد أولًا لتفعيل مسودات الأجندة والحملة الخاصة بالاستراتيجية.';

/** Same name typed twice («أجندة ديسمبر» / «اجندة  ديسمبر») reaches one draft. */
export function strategyDraftNameKey(name: string) {
  return String(name || '').normalize('NFKC').replace(/[ً-ٰٟـ]/g, '')
    .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .trim().replace(/\s+/g, ' ').toLowerCase();
}
function isManager(user: SessionUser) {
  return (hasPermission(user, 'marketing.task.view_all') || hasPermission(user, 'marketing.task.review')) && getSystemAccess(user, 'marketing').dataScope === 'all';
}
function canUseKind(user: SessionUser, kind: string) {
  return hasPermission(user, kind === 'agenda' ? 'marketing.agenda.create' : 'marketing.campaign.create') && hasPermission(user, 'marketing.products.view');
}
function canSeeDrafts(user: SessionUser) {
  return canUseKind(user, 'agenda') || canUseKind(user, 'campaign') || isManager(user);
}
async function requireReady(sql: Sql) {
  if (!(await marketingStrategyDraftsReady(sql))) throw new Error(STRATEGY_DRAFT_MIGRATION_MESSAGE);
}
/** Draft codes come from the SAME sequence as native plans, so a code shown
 * on the draft card is the code the approved agenda/campaign will keep. */
async function reservePlanCode(tx: any, kind: 'agenda' | 'campaign') {
  for (;;) {
    const [seq] = await tx`select nextval('marketing.work_plan_number_seq')::text as value`;
    const planNo = `${kind === 'agenda' ? 'AGD' : 'CMP'}-${String(seq.value).padStart(6, '0')}`;
    const [collision] = await tx`select 1 from marketing.campaigns where campaign_code=${planNo}
      union all select 1 from marketing.work_plans where plan_no=${planNo}
      union all select 1 from marketing.strategy_plan_drafts where plan_no=${planNo} limit 1`;
    if (!collision) return { planNumber: String(seq.value), planNo };
  }
}

/* ------------------------------------------------------------------ */
/* Assignment placements (called from the strategy integration only)   */
/* ------------------------------------------------------------------ */
export type StrategyPlacement = { ideaCode: string; kind: 'agenda' | 'campaign'; draftId?: string; name?: string; date: string; category: string };

/** Fails BEFORE any task is created when a chosen draft is not usable. */
export async function validateStrategyPlacements(sql: Sql, placements: StrategyPlacement[]) {
  if (!placements.length) return;
  if (!(await marketingStrategyDraftsReady(sql))) throw new Error(`Invalid placement: ${STRATEGY_DRAFT_MIGRATION_MESSAGE}`);
  const today = saudiCalendarDay();
  for (const placement of placements) {
    if (placement.date < today) throw new Error(`Invalid placement: ${placement.kind === 'agenda' ? 'تاريخ النشر' : 'تاريخ التمويل'} قبل اليوم للفكرة ${placement.ideaCode}`);
    if (!placement.draftId) continue;
    const [draft] = await sql<any[]>`select kind,status from marketing.strategy_plan_drafts where id=${placement.draftId}::uuid`;
    if (!draft || draft.status !== 'draft') throw new Error('Invalid placement: المسودة المختارة لم تعد مسودة (تم إرسالها للمراجعة أو حذفها). حدّث القائمة واختر اسمًا آخر.');
    if (draft.kind !== placement.kind) throw new Error('Invalid placement: نوع المسودة المختارة لا يطابق الاختيار (أجندة / حملة).');
  }
}

/** Idempotent: a retried assignment reuses the same drafts and entries. */
export async function applyStrategyPlacements(sql: Sql, user: SessionUser, input: {
  taskId: string; requestKey: string; placements: StrategyPlacement[];
  items: Array<{ id: string; client_key: string; delivery_mode?: string }>;
  itemIdeaCodes: Map<string, string>;
}) {
  if (!input.placements.length) return [];
  await requireReady(sql);
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    await tx`select pg_advisory_xact_lock(hashtext('mzj:strategy-plan-drafts'))`;
    const touched = new Map<string, { id: string; kind: string; name: string; planNo: string }>();
    for (const placement of input.placements) {
      const itemIds = input.items.filter(item => (item.delivery_mode || 'files') === 'files' &&
        input.itemIdeaCodes.get(String(item.client_key)) === placement.ideaCode).map(item => String(item.id));
      // Photography-only ideas have no publishable product.
      if (!itemIds.length) continue;
      let draft: any;
      if (placement.draftId) {
        [draft] = await tx<any[]>`select id::text,kind,name,plan_no,status from marketing.strategy_plan_drafts where id=${placement.draftId}::uuid for update`;
        if (!draft || draft.status !== 'draft' || draft.kind !== placement.kind) {
          // A retry after submission keeps entries that were already written.
          const [already] = await tx<any[]>`select 1 from marketing.strategy_plan_draft_entries
            where draft_id=${placement.draftId}::uuid and item_id=any(${itemIds}::uuid[]) limit 1`;
          if (already) continue;
          throw new Error('Invalid placement: المسودة المختارة لم تعد مسودة. حدّث القائمة واختر اسمًا آخر.');
        }
      } else {
        const name = text(placement.name, 250).replace(/\s+/g, ' ');
        const nameKey = strategyDraftNameKey(name);
        if (!nameKey) throw new Error('Invalid placement: اكتب اسم الأجندة أو الحملة');
        [draft] = await tx<any[]>`select id::text,kind,name,plan_no,status from marketing.strategy_plan_drafts
          where kind=${placement.kind} and name_key=${nameKey} and status='draft' for update`;
        if (!draft) {
          const [previous] = await tx<any[]>`select d.id::text from marketing.strategy_plan_draft_entries e
            join marketing.strategy_plan_drafts d on d.id=e.draft_id
            where e.item_id=any(${itemIds}::uuid[]) and d.kind=${placement.kind} and d.name_key=${nameKey} limit 1`;
          if (previous) continue;
          // No AGD/CMP code yet: the code is reserved on «إرسال للمراجعة».
          [draft] = await tx<any[]>`insert into marketing.strategy_plan_drafts(kind,name,name_key,created_by)
            values(${placement.kind},${name},${nameKey},${user.id}::uuid)
            returning id::text,kind,name,plan_no,status`;
        }
      }
      // An idea belongs to one open draft PER KIND: it may sit in one agenda and one
      // campaign at the same time, but never in two agendas or two campaigns.
      const [elsewhere] = await tx<any[]>`select d.name,d.plan_no from marketing.strategy_plan_draft_entries e
        join marketing.strategy_plan_drafts d on d.id=e.draft_id
        left join marketing.work_plans p on p.id=d.work_plan_id
        where e.item_id=any(${itemIds}::uuid[]) and e.draft_id<>${draft.id}::uuid
          and d.kind=${placement.kind}
          and (d.status='draft' or (d.status='submitted' and coalesce(p.is_deleted,false)=false)) limit 1`;
      if (elsewhere) throw new Error(`Invalid placement: الفكرة ${placement.ideaCode} مرتبطة بالفعل بـ ${placement.kind === 'agenda' ? 'أجندة' : 'حملة'} «${elsewhere.name}»${elsewhere.plan_no ? ` (${elsewhere.plan_no})` : ''}.`);
      for (const itemId of itemIds) {
        await tx`insert into marketing.strategy_plan_draft_entries(draft_id,item_id,task_id,idea_code,marketing_category,target_on,scheduled_on,request_key,added_by)
          values(${draft.id}::uuid,${itemId}::uuid,${input.taskId}::uuid,${placement.ideaCode},${text(placement.category, 120)},
            ${placement.date}::date,${placement.kind === 'agenda' ? placement.date : null}::date,${input.requestKey}::uuid,${user.id}::uuid)
          on conflict(draft_id,item_id) do nothing`;
      }
      await tx`update marketing.strategy_plan_drafts set updated_at=now() where id=${draft.id}::uuid`;
      touched.set(draft.id, { id: draft.id, kind: draft.kind, name: draft.name, planNo: draft.plan_no });
    }
    return [...touched.values()];
  });
}

/** Names for the strategy dropdown: open drafts only (status = مسودة). */
export async function listOpenStrategyDrafts(sql: Sql) {
  if (!(await marketingStrategyDraftsReady(sql))) return { ok: true, ready: false, drafts: [] as any[] };
  const drafts = await sql<any[]>`select d.id::text,d.kind,d.name,d.plan_no as "planNo",
      (select count(distinct e.idea_code)::int from marketing.strategy_plan_draft_entries e where e.draft_id=d.id) as "ideaCount"
    from marketing.strategy_plan_drafts d where d.status='draft' order by d.kind,d.created_at desc`;
  return { ok: true, ready: true, drafts };
}

/* ------------------------------------------------------------------ */
/* Reads for Marketing UI                                              */
/* ------------------------------------------------------------------ */
/** All active platforms and publish types (same source as the native composer). */
type CatalogType = { id: string; name: string; width: number | null; height: number | null; platformId: string; platformName: string; platformCode: string };
async function postTypeCatalog(sql: Sql): Promise<CatalogType[]> {
  const rows = await sql<any[]>`select pt.id::text,pt.name,pt.width,pt.height,p.id::text as platform_id,p.name as platform_name,p.code as platform_code
    from marketing.platform_post_types pt join marketing.platforms p on p.id=pt.platform_id
    where pt.is_active=true and p.is_active=true order by p.name,pt.name,pt.id`;
  return rows.map(row => ({ id: row.id, name: row.name, width: row.width ?? null, height: row.height ?? null,
    platformId: row.platform_id, platformName: row.platform_name, platformCode: row.platform_code || '' }));
}
function catalogPlatforms(catalog: CatalogType[]) {
  const map = new Map<string, { platformId: string; platformName: string; platformCode: string; postTypes: any[] }>();
  for (const type of catalog) {
    const row = map.get(type.platformId) || { platformId: type.platformId, platformName: type.platformName, platformCode: type.platformCode, postTypes: [] };
    row.postTypes.push({ id: type.id, name: type.name, width: type.width, height: type.height,
      mediaKinds: (['image', 'video'] as const).filter(kind => supportsWorkMedia(kind, type.name)) });
    map.set(type.platformId, row);
  }
  return [...map.values()];
}
async function draftEntries(sql: Sql, draftIds: string[]) {
  if (!draftIds.length) return [] as Row[];
  return sql<any[]>`select e.id::text,e.draft_id::text,e.item_id::text,e.task_id::text,e.idea_code,e.marketing_category,
      e.target_on::text,e.scheduled_on::text,e.platforms,e.version,e.added_at,
      agenda_link.publish_on as agenda_publish_on,agenda_link.agenda_name,agenda_link.agenda_draft_id,
      i.idea_name,i.media_kind,i.status as item_status,i.due_on::text,i.approved_at,i.formats,i.delivery_mode,
      t.task_no,t.name as task_name,t.created_at as task_created_at,t.is_deleted as task_deleted,
      coalesce(u.full_name,'') as assignee_name,requirement.requirement_number,
      coalesce((select jsonb_agg(jsonb_build_object('id',f.id::text,'name',f.original_name,'mime_type',f.mime_type,
        'category',j.category,'format_id',j.format_id,'status',f.status))
        from marketing.work_item_files j join marketing.files f on f.id=j.file_id
        where j.item_id=i.id and j.category='final' and f.status='ready'),'[]'::jsonb) as files
    from marketing.strategy_plan_draft_entries e
    join marketing.work_items i on i.id=e.item_id join marketing.work_tasks t on t.id=e.task_id
    left join core.users u on u.id=i.assigned_to
    -- A campaign displays the publication date from the SAME work item's
    -- agenda entry; it must never infer it from the funding date. Reading the
    -- linked agenda at query time also reflects later agenda date edits.
    left join lateral (
      select a.scheduled_on::text as publish_on,ag.name as agenda_name,ag.id::text as agenda_draft_id
      from marketing.strategy_plan_draft_entries a
      join marketing.strategy_plan_drafts ag on ag.id=a.draft_id
      where a.item_id=e.item_id and ag.kind='agenda' and ag.status in ('draft','submitted')
        and a.scheduled_on is not null
      order by case when ag.status='draft' then 0 else 1 end,a.updated_at desc,a.id
      limit 1
    ) agenda_link on true
    left join lateral (select numbered.requirement_number from (
      select candidate.id,row_number() over(order by candidate.sort_order,candidate.created_at,candidate.id)::int as requirement_number
      from marketing.work_items candidate where candidate.task_id=i.task_id) numbered where numbered.id=i.id) requirement on true
    where e.draft_id=any(${draftIds}::uuid[])
    order by e.target_on,e.added_at,requirement.requirement_number`;
}
function entryState(kind: string, entry: Row, catalog: Map<string, CatalogType>) {
  const platforms = list(entry.platforms);
  const formats = list(entry.formats) as WorkFormat[];
  const allowed = (platformId: string, postTypeId: string) => {
    const type = catalog.get(postTypeId);
    return Boolean(type && type.platformId === platformId && supportsWorkMedia(entry.media_kind, type.name));
  };
  const configured = Boolean(kind === 'agenda' ? entry.scheduled_on : entry.target_on) && platforms.length > 0 && platforms.every(platform =>
    list(platform.postTypes).length > 0 && list(platform.postTypes).every((type: any) => allowed(String(platform.platformId), String(type.postTypeId)) &&
      (kind !== 'campaign' || (type.budget !== '' && type.budget != null && Number.isFinite(Number(type.budget)) && Number(type.budget) >= 0))));
  const executed = entry.item_status === 'approved' && !entry.task_deleted &&
    finalCoverage({ formats, files: list(entry.files), media_kind: entry.media_kind } as any);
  // Execution is NOT required to send for review; publishing preparation is
  // what waits for approved final files. It stays visible as information.
  const missing: string[] = [];
  const notes: string[] = [];
  if (entry.task_deleted) missing.push('التاسك محذوف');
  else if (!executed) notes.push(entry.item_status === 'approved' ? 'المقاسات النهائية غير مكتملة' : 'لم يتم تنفيذ واعتماد الفكرة بعد');
  if (kind === 'agenda' && !entry.scheduled_on) missing.push('حدد تاريخ النشر');
  if (kind === 'campaign' && !entry.target_on) missing.push('حدد تاريخ التمويل');
  if (!platforms.length) missing.push('اختر المنصة ونوع النشر');
  else if (!configured) missing.push(kind === 'campaign' ? 'أكمل نوع النشر والميزانية لكل منصة' : 'أكمل نوع النشر لكل منصة');
  return { configured, executed, ready: configured && !entry.task_deleted, missing, notes };
}
function presentEntry(kind: string, planNo: string, entry: Row, catalog: Map<string, CatalogType>) {
  const state = entryState(kind, entry, catalog);
  const reqNo = Number(entry.requirement_number || 0);
  return {
    id: entry.id, draftId: entry.draft_id, itemId: entry.item_id, taskId: entry.task_id, version: entry.version,
    ideaCode: entry.idea_code, category: entry.marketing_category, ideaName: entry.idea_name, mediaKind: entry.media_kind,
    itemStatus: entry.item_status, taskNo: entry.task_no, taskName: entry.task_name,
    assignmentNo: entry.task_no && reqNo ? `${entry.task_no}-${String(reqNo).padStart(2, '0')}` : entry.task_no,
    orderNo: planNo, requirementNumber: reqNo, assigneeName: entry.assignee_name,
    createdAt: entry.task_created_at || entry.added_at, dueOn: day(entry.due_on), approvedOn: entry.approved_at ? saudiCalendarDay(new Date(entry.approved_at)) : null,
    executionOn: entry.approved_at ? saudiCalendarDay(new Date(entry.approved_at)) : day(entry.due_on),
    // Publication belongs to the agenda, funding belongs to the campaign.
    // Older campaign rows might have scheduled_on=funding date: never render it
    // as a publication date, even before they are saved again.
    publishOn: kind === 'campaign' ? day(entry.agenda_publish_on) : (day(entry.scheduled_on) || day(entry.target_on)),
    fundingOn: kind === 'campaign' ? day(entry.target_on) : null,
    agendaName: kind === 'campaign' ? String(entry.agenda_name || '') : '',
    agendaDraftId: kind === 'campaign' ? String(entry.agenda_draft_id || '') : '',
    targetOn: day(entry.target_on),
    scheduledOn: kind === 'campaign' ? day(entry.agenda_publish_on) : (day(entry.scheduled_on) || day(entry.target_on)),
    platforms: list(entry.platforms),
    formats: (list(entry.formats) as WorkFormat[]).map(format => ({ id: String(format.id), platformId: String(format.platform_id),
      platformName: String(format.platform_name || ''), platformCode: String(format.platform_code || ''), name: String(format.name || '') })),
    ...state,
  };
}
async function draftRows(sql: Sql, user: SessionUser, where: 'open' | { id: string } | { planId: string }) {
  const rows = where === 'open'
    ? await sql<any[]>`select d.*,d.id::text,d.work_plan_id::text,coalesce(u.full_name,'') as creator_name from marketing.strategy_plan_drafts d
        left join core.users u on u.id=d.created_by where d.status='draft' order by d.created_at desc`
    : 'id' in where
      ? await sql<any[]>`select d.*,d.id::text,d.work_plan_id::text,coalesce(u.full_name,'') as creator_name from marketing.strategy_plan_drafts d
          left join core.users u on u.id=d.created_by where d.id=${where.id}::uuid`
      : await sql<any[]>`select d.*,d.id::text,d.work_plan_id::text,coalesce(u.full_name,'') as creator_name from marketing.strategy_plan_drafts d
          left join core.users u on u.id=d.created_by where d.work_plan_id=${where.planId}::uuid`;
  const [entries, catalog] = await Promise.all([draftEntries(sql, rows.map(row => String(row.id))), postTypeCatalog(sql)]);
  const catalogById = new Map(catalog.map(type => [type.id, type]));
  const platformNames = new Map(catalog.map(type => [type.platformId, type.platformName]));
  return rows.map(row => {
    const ideas = entries.filter(entry => entry.draft_id === row.id).map(entry => presentEntry(row.kind, row.plan_no, entry, catalogById));
    const platformIds = new Map<string, string>();
    for (const idea of ideas) for (const platform of idea.platforms) {
      platformIds.set(String(platform.platformId), platformNames.get(String(platform.platformId)) || '');
    }
    const dates = ideas.map(idea => row.kind === 'campaign' ? idea.fundingOn : idea.publishOn).filter(Boolean).sort() as string[];
    return {
      id: row.id, kind: row.kind, name: row.name, planNo: row.plan_no, status: row.status, workPlanId: row.work_plan_id,
      version: row.version, createdAt: row.created_at, createdBy: row.created_by ? String(row.created_by) : '', creatorName: row.creator_name,
      platformGoals: list(row.platform_goals), ideas,
      ideaCount: new Set(ideas.map(idea => idea.ideaCode || idea.itemId)).size, productCount: ideas.length,
      readyCount: ideas.filter(idea => idea.ready).length, executedCount: ideas.filter(idea => idea.executed).length,
      configuredCount: ideas.filter(idea => idea.configured).length,
      periodFrom: dates[0] || null, periodTo: dates.at(-1) || null,
      platforms: [...platformIds.entries()].map(([platformId, name]) => ({ platformId, name })),
      canEdit: row.status === 'draft' && canUseKind(user, row.kind),
    };
  });
}

export async function strategyDraftsForDashboard(sql: Sql, user: SessionUser) {
  if (!canSeeDrafts(user) || !(await marketingStrategyDraftsReady(sql))) return { ok: true, ready: await marketingStrategyDraftsReady(sql), drafts: [] as any[] };
  const drafts = (await draftRows(sql, user, 'open')).filter(draft => isManager(user) || canUseKind(user, draft.kind));
  return { ok: true, ready: true, drafts };
}
export async function strategyDraftDetail(sql: Sql, user: SessionUser, draftId: string) {
  await requireReady(sql);
  if (!canSeeDrafts(user)) throw new Error(W.denied);
  const [[draft], catalog] = await Promise.all([draftRows(sql, user, { id: draftId }), postTypeCatalog(sql)]);
  if (!draft || (!isManager(user) && !canUseKind(user, draft.kind))) throw new Error(W.notFound);
  return { ok: true, draft, platforms: catalogPlatforms(catalog) };
}
/** Report rows for the «التقرير» button: draft card or a plan made from a draft. */
export async function strategyPlanReport(sql: Sql, user: SessionUser, query: Row,
  loadItems?: (db: any, taskId: string) => Promise<WorkItem[]>) {
  if (!(await marketingStrategyDraftsReady(sql))) return { ok: true, ready: false, draft: null };
  if (!canSeeDrafts(user) && !hasPermission(user, 'marketing.dashboard.view') && !hasPermission(user, 'marketing.database.view')) throw new Error(W.denied);
  const [draft] = query.draftId ? await draftRows(sql, user, { id: id(query.draftId) }) : await draftRows(sql, user, { planId: id(query.planId) });
  if (!draft || !loadItems) return { ok: true, ready: true, draft: draft || null };
  // «الجاهزية» per idea = the requirement readiness of the execution section.
  const readiness = new Map<string, number>();
  for (const taskId of [...new Set(draft.ideas.map(idea => String(idea.taskId)))]) {
    for (const item of await loadItems(sql, taskId)) readiness.set(String(item.id), workItemReadiness(item));
  }
  return { ok: true, ready: true, draft: { ...draft, ideas: draft.ideas.map(idea => ({ ...idea,
    readiness: readiness.get(String(idea.itemId)) ?? (idea.itemStatus === 'approved' ? 100 : 0) })) } };
}

/** Products tab «منتجات الاستراتيجية»: every strategy file requirement,
 * executed or not, with its agenda/campaign draft tracking. */
export async function strategyProducts(sql: Sql, user: SessionUser, scope: { productManager: boolean; manager: boolean; departments: string[] },
  loadItems?: (db: any, taskId: string) => Promise<WorkItem[]>) {
  if (!hasPermission(user, 'marketing.products.view')) throw new Error(W.denied);
  const ready = await marketingStrategyDraftsReady(sql);
  const rows = await sql<any[]>`select i.id::text as item_id,i.task_id::text,i.idea_name,i.media_kind,i.status as item_status,
      i.due_on::text,i.approved_at,t.task_no,t.name as task_name,t.created_at as task_created_at,
      coalesce(u.full_name,'') as assignee_name,requirement.requirement_number,
      (select h.data from marketing.work_history h where h.task_id=t.id and h.action='strategy_assigned' order by h.id desc limit 1) as marker,
      i.client_key::text as client_key
    from marketing.work_items i join marketing.work_tasks t on t.id=i.task_id
    left join core.users u on u.id=i.assigned_to left join core.departments cd on cd.id=i.department_id
    left join lateral (select numbered.requirement_number from (
      select candidate.id,row_number() over(order by candidate.sort_order,candidate.created_at,candidate.id)::int as requirement_number
      from marketing.work_items candidate where candidate.task_id=i.task_id) numbered where numbered.id=i.id) requirement on true
    where t.is_deleted=false and i.delivery_mode='files' and i.status<>'rejected'
      and exists(select 1 from marketing.work_history h where h.task_id=t.id and h.action='strategy_assigned')
      and (${scope.productManager} or ${scope.manager} or i.assigned_to=${user.id}::uuid or t.created_by=${user.id}::uuid or cd.code=any(${scope.departments}::text[]))
    order by t.created_at desc,requirement.requirement_number`;
  const itemIds = rows.map(row => row.item_id);
  const placements = ready && itemIds.length ? await sql<any[]>`select e.item_id::text,e.marketing_category,e.target_on::text,e.scheduled_on::text,
      d.kind,d.name as draft_name,d.plan_no,d.status as draft_status,d.work_plan_id::text,coalesce(p.review_status,'') as plan_status,
      coalesce(p.is_deleted,false) as plan_deleted
    from marketing.strategy_plan_draft_entries e join marketing.strategy_plan_drafts d on d.id=e.draft_id
    left join marketing.work_plans p on p.id=d.work_plan_id
    where e.item_id=any(${itemIds}::uuid[]) order by e.added_at` : [];
  const byItem = new Map<string, any>();
  for (const row of placements) if (!row.plan_deleted || !byItem.has(row.item_id)) byItem.set(row.item_id, row);
  // «الجاهزية» per idea of the assignment, same formula as the task readiness.
  const readiness = new Map<string, number>();
  if (loadItems) for (const taskId of [...new Set(rows.map(row => String(row.task_id)))]) {
    for (const item of await loadItems(sql, taskId)) readiness.set(String(item.id), workItemReadiness(item));
  }
  return { ok: true, ready, rows: rows.map((row, index) => {
    const placement = byItem.get(row.item_id);
    const marker = row.marker || {};
    const keys = list(marker.clientKeys), codes = list(marker.itemIdeaCodes);
    const position = keys.indexOf(row.client_key);
    const ideaCode = position >= 0 ? String(codes[position] || '') : '';
    const reqNo = Number(row.requirement_number || 0);
    const kind = placement?.kind || '';
    return {
      serial: index + 1, itemId: row.item_id, taskId: row.task_id, ideaCode,
      createdAt: row.task_created_at, category: placement?.marketing_category || '',
      taskName: row.task_name, mediaKind: row.media_kind, itemStatus: row.item_status,
      assignmentNo: row.task_no && reqNo ? `${row.task_no}-${String(reqNo).padStart(2, '0')}` : row.task_no,
      taskNo: row.task_no, orderNo: placement?.plan_no || '', orderName: placement?.draft_name || '', orderKind: kind,
      orderStatus: placement ? (placement.draft_status === 'draft' || placement.draft_status === 'archived' ? placement.draft_status : placement.plan_status || 'submitted') : '',
      assigneeName: row.assignee_name, ideaName: row.idea_name, readiness: readiness.get(String(row.item_id)) ?? (row.item_status === 'approved' ? 100 : 0),
      dueOn: day(row.due_on), approvedOn: row.approved_at ? saudiCalendarDay(new Date(row.approved_at)) : null,
      publishOn: placement ? (day(placement.scheduled_on) || (kind === 'agenda' ? day(placement.target_on) : null)) : null,
      fundingOn: kind === 'campaign' ? day(placement?.target_on) : null,
    };
  }) };
}

/* ------------------------------------------------------------------ */
/* Draft mutations                                                    */
/* ------------------------------------------------------------------ */
async function lockedDraft(tx: any, user: SessionUser, draftId: string) {
  const [draft] = await tx`select id::text,kind,name,status,plan_number::text,plan_no,version,platform_goals,work_plan_id::text,created_by::text
    from marketing.strategy_plan_drafts where id=${draftId}::uuid for update`;
  if (!draft) throw new Error(W.notFound);
  if (!canUseKind(user, draft.kind)) throw new Error(W.denied);
  return draft;
}
export async function saveStrategyDraftEntry(sql: Sql, user: SessionUser, body: Row) {
  await requireReady(sql);
  const draftId = id(body.draftId), entryId = id(body.entryId);
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    const draft = await lockedDraft(tx, user, draftId);
    if (draft.status !== 'draft') throw new Error('تم إرسال المسودة للمراجعة؛ التعديل يتم من تفاصيل الأجندة أو الحملة.');
    const [entry] = await tx<any[]>`select e.*,e.id::text,i.formats,i.media_kind from marketing.strategy_plan_draft_entries e
      join marketing.work_items i on i.id=e.item_id where e.id=${entryId}::uuid and e.draft_id=${draftId}::uuid for update`;
    if (!entry) throw new Error(W.notFound);
    if (body.version !== undefined && Number(body.version) !== Number(entry.version)) throw new Error(W.conflict);
    const scheduledOn = draft.kind === 'agenda' ? text(body.scheduledOn, 10) : null;
    if (draft.kind === 'agenda' && !isWorkDate(scheduledOn || '')) throw new Error('حدد تاريخ النشر');
    const targetOn = draft.kind === 'campaign' ? text(body.fundingOn ?? day(entry.target_on), 10) : scheduledOn!;
    if (draft.kind === 'campaign' && !isWorkDate(targetOn)) throw new Error('حدد تاريخ التمويل');
    // Any active platform / publish type that supports the idea's media, exactly
    // like the native agenda/campaign composer (not limited to produced sizes).
    const byId = new Map((await postTypeCatalog(tx as unknown as Sql)).map(type => [type.id, type]));
    const requested = list(body.platforms);
    if (requested.length > 15) throw new Error(W.invalid);
    const seenPlatforms = new Set<string>();
    const platforms = requested.map((platform: any) => {
      const platformId = id(platform.platformId);
      if (seenPlatforms.has(platformId)) throw new Error('لا يمكن تكرار نفس المنصة للفكرة الواحدة.');
      seenPlatforms.add(platformId);
      const types = list(platform.postTypes);
      if (!types.length || types.length > 30) throw new Error('اختر نوع نشر واحدًا على الأقل لكل منصة');
      const seenTypes = new Set<string>();
      return { platformId, postTypes: types.map((type: any) => {
        const postTypeId = id(type.postTypeId);
        if (seenTypes.has(postTypeId)) throw new Error('نوع النشر مكرر');
        seenTypes.add(postTypeId);
        const known = byId.get(postTypeId);
        if (!known || known.platformId !== platformId) throw new Error('نوع النشر غير متاح لهذه المنصة. حدّث الصفحة.');
        if (!supportsWorkMedia(entry.media_kind, known.name)) throw new Error(`نوع النشر «${known.name}» لا يناسب ${entry.media_kind === 'video' ? 'الفيديو' : 'الصورة'}`);
        if (draft.kind !== 'campaign') return { postTypeId, budget: 0 };
        if (type.budget === '' || type.budget == null) throw new Error('أدخل ميزانية مستقلة لكل نوع نشر داخل المنصة.');
        const budget = Number(type.budget);
        if (!Number.isFinite(budget) || budget < 0 || budget > 100000000 || Math.abs(budget * 100 - Math.round(budget * 100)) > 0.000001) throw new Error(W.invalid);
        return { postTypeId, budget };
      }) };
    });
    const [saved] = await tx<any[]>`update marketing.strategy_plan_draft_entries set scheduled_on=${scheduledOn}::date,target_on=${targetOn}::date,
      platforms=${tx.json(platforms)},version=version+1,updated_at=now() where id=${entryId}::uuid returning version`;
    await tx`update marketing.strategy_plan_drafts set updated_at=now(),version=version+1 where id=${draftId}::uuid`;
    return { ok: true, id: entryId, version: saved.version, message: W.saved };
  });
}
/** Persist each idea's publishing/funding dates independently of the platform and
 * budget editor. A partial campaign remains a draft until its publication types,
 * budgets and goals pass the existing submission validator. */
export async function saveStrategyDraftEntryDates(sql: Sql, user: SessionUser, body: Row) {
  await requireReady(sql);
  const draftId = id(body.draftId), entryId = id(body.entryId);
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    const draft = await lockedDraft(tx, user, draftId);
    if (draft.status !== 'draft') throw new Error('تم إرسال المسودة للمراجعة؛ لا يمكن تعديل التاريخ هنا.');
    const [entry] = await tx<any[]>`select id::text,version,target_on from marketing.strategy_plan_draft_entries
      where id=${entryId}::uuid and draft_id=${draftId}::uuid for update`;
    if (!entry) throw new Error(W.notFound);
    if (body.version !== undefined && Number(body.version) !== Number(entry.version)) throw new Error(W.conflict);
    // Agenda is the only source of publication dates. Campaign's target_on is
    // exclusively its funding date, never a second copy of publication.
    const date = text(draft.kind === 'agenda' ? body.scheduledOn : body.fundingOn, 10);
    if (!isWorkDate(date)) throw new Error(draft.kind === 'agenda' ? 'حدد تاريخ نشر صحيحًا للفكرة' : 'حدد تاريخ تمويل صحيحًا للفكرة');
    const [saved] = await tx<any[]>`update marketing.strategy_plan_draft_entries
      set scheduled_on=${draft.kind === 'agenda' ? date : null}::date,
        target_on=${date}::date,version=version+1,updated_at=now()
      where id=${entryId}::uuid returning version`;
    await tx`update marketing.strategy_plan_drafts set updated_at=now(),version=version+1 where id=${draftId}::uuid`;
    return {ok:true,id:entryId,version:saved.version,message:draft.kind === 'agenda' ? 'تم حفظ تاريخ النشر في الأجندة' : 'تم حفظ تاريخ التمويل مستقلًا عن الأجندة'};
  });
}

export async function saveStrategyDraftSettings(sql: Sql, user: SessionUser, body: Row) {
  await requireReady(sql);
  const draftId = id(body.draftId);
  return sql.begin(async tx => {
    const draft = await lockedDraft(tx, user, draftId);
    if (draft.status !== 'draft') throw new Error(W.immutable);
    const name = text(body.name ?? draft.name, 250).replace(/\s+/g, ' ');
    if (!name) throw new Error(W.requiredFields);
    const nameKey = strategyDraftNameKey(name);
    const [duplicate] = await tx<any[]>`select 1 from marketing.strategy_plan_drafts where kind=${draft.kind} and name_key=${nameKey}
      and status='draft' and id<>${draftId}::uuid limit 1`;
    if (duplicate) throw new Error('يوجد مسودة أخرى بنفس الاسم');
    let goals = list(draft.platform_goals);
    if (draft.kind === 'campaign' && body.platformGoals !== undefined) {
      goals = list(body.platformGoals).map((row: any) => ({ platformId: id(row.platformId),
        goalIds: [...new Set(list(row.goalIds).map(id))].slice(0, 30) }));
    }
    await tx`update marketing.strategy_plan_drafts set name=${name},name_key=${nameKey},platform_goals=${tx.json(goals)},
      version=version+1,updated_at=now() where id=${draftId}::uuid`;
    return { ok: true, id: draftId, message: W.saved };
  });
}
export async function deleteStrategyDraft(sql: Sql, user: SessionUser, body: Row) {
  await requireReady(sql);
  const draftId = id(body.draftId);
  return sql.begin(async tx => {
    const draft = await lockedDraft(tx, user, draftId);
    if (draft.status !== 'draft') throw new Error(W.immutable);
    if (!isManager(user) && draft.created_by !== user.id && !hasPermission(user, 'platform.superadmin') &&
        !hasPermission(user, draft.kind === 'agenda' ? 'marketing.agenda.delete' : 'marketing.campaign.delete')) throw new Error(W.denied);
    // A deleted draft is archived, NOT physically deleted; any previously linked
    // items, audit history and planning dates remain available for tracing.
    await tx`update marketing.strategy_plan_drafts
      set status='archived',version=version+1,updated_at=now()
      where id=${draftId}::uuid and status='draft'`;
    return { ok: true, id: draftId, message: 'تم أرشفة المسودة؛ التكليفات والروابط السابقة محفوظة' };
  });
}

/** «إرسال للمراجعة»: only complete drafts; the native createPlan() validates
 * products/formats/budgets/goals exactly like the Marketing composer. */
export async function submitStrategyDraft(sql: Sql, user: SessionUser, body: Row, deps: StrategyDraftDeps) {
  await requireReady(sql);
  const draftId = id(body.draftId);
  const [current] = await draftRows(sql, user, { id: draftId });
  if (!current) throw new Error(W.notFound);
  if (!canUseKind(user, current.kind)) throw new Error(W.denied);
  if (current.status === 'submitted' && current.workPlanId) {
    const [plan] = await sql<any[]>`select id::text,plan_no,review_status from marketing.work_plans where id=${current.workPlanId}::uuid`;
    return { ok: true, id: plan?.id || current.workPlanId, planNo: plan?.plan_no || current.planNo, existed: true, message: W.saved };
  }
  if (!current.ideas.length) throw new Error('المسودة لا تحتوي أفكارًا بعد');
  const incomplete = current.ideas.filter(idea => !idea.ready);
  if (incomplete.length) throw new Error(`لا يمكن الإرسال للمراجعة قبل اكتمال كل الأفكار: ${incomplete.slice(0, 5).map(idea => `${idea.ideaName} (${idea.missing.join('، ')})`).join(' • ')}`);
  const platformIds = [...new Set(current.ideas.flatMap(idea => idea.platforms.map((platform: any) => String(platform.platformId))))];
  const goals = list(current.platformGoals).filter((row: any) => platformIds.includes(String(row.platformId)));
  if (current.kind === 'campaign' && (goals.length !== platformIds.length || goals.some((row: any) => !list(row.goalIds).length)))
    throw new Error('اختر الهدف من الحملة لكل منصة قبل الإرسال للمراجعة');
  const publishDates = current.kind === 'agenda' ? current.ideas.map(idea => idea.scheduledOn!).sort() : [];
  const funding = current.kind === 'campaign' ? current.ideas.map(idea => idea.fundingOn!).filter(Boolean).sort() : [];
  const payload: Row = { requestKey: draftId, kind: current.kind, name: current.name,
    // The native campaign plan uses funding as its internal date. Its
    // read-only "publication date" in the draft UI comes from the agenda.
    entries: current.ideas.map(idea => ({ productId: idea.itemId,
      date: current.kind === 'campaign' ? idea.fundingOn : idea.scheduledOn, platforms: idea.platforms })) };
  if (current.kind === 'agenda') Object.assign(payload, { agendaFrom: publishDates[0], agendaTo: publishDates.at(-1) });
  else Object.assign(payload, { fundingFrom: funding[0], fundingTo: funding.at(-1), platformGoals: goals });
  // The AGD/CMP code is reserved only now (idempotent on retry).
  const code = await sql.begin(async tx => {
    const [row] = await tx<any[]>`select plan_number::text,plan_no from marketing.strategy_plan_drafts where id=${draftId}::uuid for update`;
    if (row?.plan_no) return { planNumber: String(row.plan_number), planNo: String(row.plan_no) };
    const reserved = await reservePlanCode(tx, current.kind);
    await tx`update marketing.strategy_plan_drafts set plan_number=${reserved.planNumber},plan_no=${reserved.planNo},updated_at=now() where id=${draftId}::uuid`;
    return reserved;
  });
  const created = await deps.createPlan(sql, payload, user, code);
  const planId = String(created.id);
  await sql.begin(async tx => {
    await tx`select id from marketing.strategy_plan_drafts where id=${draftId}::uuid for update`;
    if (current.kind === 'campaign') {
      const lines = await tx<any[]>`select id::text,product_id::text from marketing.work_plan_items where plan_id=${planId}::uuid and is_deleted=false`;
      for (const line of lines) {
        const idea = current.ideas.find(row => row.itemId === line.product_id);
        if (!idea) continue;
        await tx`insert into marketing.strategy_plan_line_meta(line_id,draft_id,entry_id,funding_on)
          values(${line.id}::uuid,${draftId}::uuid,${idea.id}::uuid,${idea.fundingOn}::date) on conflict(line_id) do nothing`;
      }
    }
    await tx`update marketing.strategy_plan_drafts set status='submitted',work_plan_id=${planId}::uuid,submitted_by=${user.id}::uuid,
      submitted_at=coalesce(submitted_at,now()),updated_at=now() where id=${draftId}::uuid`;
  });
  const [plan] = await sql<any[]>`select review_status from marketing.work_plans where id=${planId}::uuid`;
  if (plan && ['in_progress', 'revision'].includes(plan.review_status))
    await deps.changePlanReview(sql, user, { planId, decision: 'submitted', note: '' });
  return { ok: true, id: planId, planNo: code.planNo, existed: false, message: 'تم إرسال المسودة للمراجعة' };
}

/* ------------------------------------------------------------------ */
/* Campaign publication: link to «تقارير الحملات» (funding date timing) */
/* ------------------------------------------------------------------ */
export async function linkStrategyCampaign(sql: Sql, user: SessionUser, body: Row, deps: StrategyDraftDeps) {
  await requireReady(sql);
  const planId = id(body.planId);
  const lineIds = [...new Set(list(body.lineIds).map(id))];
  const platform = text(body.platform, 40).toLowerCase(), accountId = text(body.accountId, 180), campaignId = text(body.campaignId, 180);
  const campaignName = text(body.campaignName, 300);
  if (!lineIds.length || lineIds.length > 500 || !/^[a-z0-9_-]{2,40}$/.test(platform) || !accountId || !campaignId ||
      /[\u0000-\u001f]/.test(accountId + campaignId)) throw new Error(W.invalid);
  if (!hasPermission(user, 'marketing.publish_prep.manage') && !(await deps.canReviewPlan(sql, user))) throw new Error(W.denied);
  const today = saudiCalendarDay();
  return sql.begin(async tx => {
    const [plan] = await tx<any[]>`select p.id::text,p.kind,p.review_status,p.is_deleted from marketing.work_plans p
      join marketing.strategy_plan_drafts d on d.work_plan_id=p.id where p.id=${planId}::uuid for update of p`;
    if (!plan || plan.is_deleted || plan.kind !== 'campaign') throw new Error(W.notFound);
    if (!['publishing', 'published'].includes(plan.review_status)) throw new Error('لا يمكن ربط الحملة بتقارير الحملات قبل اعتمادها');
    const valid = await tx<any[]>`select id::text from marketing.work_plan_items where plan_id=${planId}::uuid and is_deleted=false and id=any(${lineIds}::uuid[])`;
    if (valid.length !== lineIds.length) throw new Error(W.invalid);
    const pendingIds = await strategyItemsPendingFiles(tx as unknown as Sql, (await tx<any[]>`select distinct product_id::text from marketing.work_plan_items where id=any(${lineIds}::uuid[])`).map(row => row.product_id));
    if (pendingIds.size) throw new Error('بعض المنشورات المختارة لم يُسلَّم منتجها النهائي بعد — لا يمكن ربطها بتقارير الحملات قبل التنفيذ والاعتماد');
    // The FIRST link fixes the publication day; re-linking only corrects the campaign identity.
    for (const lineId of lineIds) await tx`insert into marketing.strategy_campaign_links(line_id,platform,account_id,campaign_id,campaign_name,linked_on,linked_by)
      values(${lineId}::uuid,${platform},${accountId},${campaignId},${campaignName},${today}::date,${user.id}::uuid)
      on conflict(line_id) do update set platform=excluded.platform,account_id=excluded.account_id,campaign_id=excluded.campaign_id,
        campaign_name=excluded.campaign_name,updated_at=now()`;
    await tx`update marketing.work_plan_items set updated_at=now() where id=any(${lineIds}::uuid[])`;
    return { ok: true, id: planId, linkedOn: today, message: 'تم ربط الحملة بتقارير الحملات' };
  });
}

/** Post-processing for planLines(): strategy campaign lines are measured
 * against their funding date and published by the campaign-report link.
 * Native agenda/campaign lines are returned unchanged. */
export async function decorateStrategyPlanLines<T extends Row>(sql: Sql, rows: T[]): Promise<T[]> {
  if (!rows.length || !(await marketingStrategyDraftsReady(sql))) return rows;
  const lineIds = rows.map(row => String(row.id));
  const planIds = [...new Set(rows.map(row => String(row.plan_id)))];
  const [meta, links, drafts] = await Promise.all([
    sql<any[]>`select line_id::text,funding_on::text from marketing.strategy_plan_line_meta where line_id=any(${lineIds}::uuid[])`,
    sql<any[]>`select line_id::text,platform,account_id,campaign_id,campaign_name,linked_on::text from marketing.strategy_campaign_links where line_id=any(${lineIds}::uuid[])`,
    sql<any[]>`select id::text,work_plan_id::text from marketing.strategy_plan_drafts where work_plan_id=any(${planIds}::uuid[])`,
  ]);
  if (!drafts.length) return rows;
  const strategyPlanIds = new Set(drafts.map(row => row.work_plan_id));
  const pendingItems = await strategyItemsPendingFiles(sql, [...new Set(rows.filter(row => strategyPlanIds.has(String(row.plan_id))).map(row => String(row.product_id)))]);
  const fundingByLine = new Map(meta.map(row => [row.line_id, day(row.funding_on)]));
  const linkByLine = new Map(links.map(row => [row.line_id, row]));
  const draftByPlan = new Map(drafts.map(row => [row.work_plan_id, row.id]));
  const today = saudiCalendarDay();
  return rows.map(row => {
    const draftId = draftByPlan.get(String(row.plan_id));
    if (!draftId) return row;
    const strategy_product_pending = pendingItems.has(String(row.product_id));
    if (row.kind !== 'campaign') return { ...row, strategy_draft_id: draftId, strategy_product_pending };
    const fundingOn = fundingByLine.get(String(row.id)) || null;
    const link = linkByLine.get(String(row.id)) || null;
    const linkedOn = link ? day(link.linked_on) : null;
    const publishedReady = Boolean(row.published_ready) || Boolean(link);
    return { ...row, strategy_draft_id: draftId, strategy_product_pending, strategy_funding_on: fundingOn,
      strategy_campaign_link: link ? { platform: link.platform, accountId: link.account_id, campaignId: link.campaign_id,
        campaignName: link.campaign_name, linkedOn } : null,
      published_ready: publishedReady,
      published_on: link ? linkedOn : row.published_on,
      publication_timing: classifyWorkPublicationTiming(fundingOn || row.scheduled_on, Boolean(link), linkedOn, today),
      status: row.review_status === 'publishing' && publishedReady ? 'published' : row.status };
  });
}

/** Product rows for pickers: the strategy category and the draft/plan code
 * (رقم الطلب). Native fields are untouched; rows without a draft get nothing. */
export async function decorateStrategyProducts<T extends Row>(sql: Sql, rows: T[]): Promise<T[]> {
  if (!rows.length || !(await marketingStrategyDraftsReady(sql))) return rows;
  const ids = rows.map(row => String(row.id));
  const placements = await sql<any[]>`select e.item_id::text,e.marketing_category,d.plan_no,coalesce(p.is_deleted,false) as plan_deleted
    from marketing.strategy_plan_draft_entries e join marketing.strategy_plan_drafts d on d.id=e.draft_id
    left join marketing.work_plans p on p.id=d.work_plan_id where e.item_id=any(${ids}::uuid[]) order by e.added_at`;
  const byItem = new Map<string, any>();
  for (const row of placements) if (!row.plan_deleted || !byItem.has(row.item_id)) byItem.set(row.item_id, row);
  return rows.map(row => {
    const placement = byItem.get(String(row.id));
    return placement ? { ...row, strategy_category: placement.marketing_category || '', strategy_order_no: placement.plan_no } : row;
  });
}

/** Items (of strategy plans) whose final files are not yet approved: their
 * publications cannot be prepared or published until execution completes. */
async function strategyItemsPendingFiles(sql: Sql, itemIds: string[]) {
  if (!itemIds.length) return new Set<string>();
  const rows = await sql<any[]>`select i.id::text,i.status,i.formats,i.media_kind,
      coalesce((select jsonb_agg(jsonb_build_object('id',f.id::text,'name',f.original_name,'mime_type',f.mime_type,
        'category',j.category,'format_id',j.format_id,'status',f.status))
        from marketing.work_item_files j join marketing.files f on f.id=j.file_id
        where j.item_id=i.id and j.category='final' and f.status='ready'),'[]'::jsonb) as files
    from marketing.work_items i where i.id=any(${itemIds}::uuid[])`;
  return new Set(rows.filter(row => row.status !== 'approved' ||
    !finalCoverage({ formats: list(row.formats), files: list(row.files), media_kind: row.media_kind } as any)).map(row => String(row.id)));
}

/** Strategy flow: a strategy requirement (files) may be scheduled before it is
 * executed. Visibility follows the same scope as the products list. */
export async function strategyPendingProduct(db: any, user: SessionUser, itemId: string,
  scope: { productManager: boolean; manager: boolean; departments: string[] }) {
  if (!(await marketingStrategyDraftsReady(db))) return null;
  const [row] = await db`select i.*,i.id::text,i.task_id::text,i.due_on::text,t.task_no,t.name as task_name
    from marketing.work_items i join marketing.work_tasks t on t.id=i.task_id left join core.departments cd on cd.id=i.department_id
    where i.id=${itemId}::uuid and t.is_deleted=false and i.delivery_mode='files' and i.status<>'rejected'
      and exists(select 1 from marketing.work_history h where h.task_id=t.id and h.action='strategy_assigned')
      and (${scope.productManager} or ${scope.manager} or i.assigned_to=${user.id}::uuid or t.created_by=${user.id}::uuid or cd.code=any(${scope.departments}::text[]))`;
  return row ? { ...row, strategy_pending: true } : null;
}

/** «إنشاء حملة / إنشاء أجندة»: strategy requirements shown before execution,
 * in the same shape as products() so the native composer can list them. */
export async function strategyPlanProducts(sql: Sql, user: SessionUser, scope: { productManager: boolean; manager: boolean; departments: string[] }) {
  if (!hasPermission(user, 'marketing.products.view')) throw new Error(W.denied);
  if (!(await marketingStrategyDraftsReady(sql))) return { ok: true, rows: [] as any[] };
  const rows = await sql<any[]>`select i.*,i.id::text,i.task_id::text,i.due_on::text,t.task_no,t.name as task_name,
      coalesce(u.full_name,'') as assignee_name,requirement.requirement_number,
      (select h.data from marketing.work_history h where h.task_id=t.id and h.action='strategy_assigned' order by h.id desc limit 1) as marker
    from marketing.work_items i join marketing.work_tasks t on t.id=i.task_id
    left join core.users u on u.id=i.assigned_to left join core.departments cd on cd.id=i.department_id
    left join lateral (select numbered.requirement_number from (
      select candidate.id,row_number() over(order by candidate.sort_order,candidate.created_at,candidate.id)::int as requirement_number
      from marketing.work_items candidate where candidate.task_id=i.task_id) numbered where numbered.id=i.id) requirement on true
    where t.is_deleted=false and i.delivery_mode='files' and i.status<>'rejected'
      and exists(select 1 from marketing.work_history h where h.task_id=t.id and h.action='strategy_assigned')
      and (${scope.productManager} or ${scope.manager} or i.assigned_to=${user.id}::uuid or t.created_by=${user.id}::uuid or cd.code=any(${scope.departments}::text[]))
    order by t.created_at desc,requirement.requirement_number`;
  const decorated = await decorateStrategyProducts(sql, rows.map(row => {
    const keys = list(row.marker?.clientKeys), codes = list(row.marker?.itemIdeaCodes);
    const position = keys.indexOf(String(row.client_key));
    const { marker: _marker, ...rest } = row;
    return { ...rest, idea_code: position >= 0 ? String(codes[position] || '') : '', files: [], strategy_pending: row.status !== 'approved',
      statement: `${row.task_name} - ${row.media_kind === 'video' ? W.video : W.image}` };
  }));
  return { ok: true, rows: decorated };
}

/** «حذف الاسم» from the strategy assignment page: open drafts only; tasks and
 * products are never removed. Called by the integration (owner session). */
export async function deleteStrategyDraftFromIntegration(sql: Sql, draftId: string) {
  if (!(await marketingStrategyDraftsReady(sql))) throw new Error(`Invalid placement: ${STRATEGY_DRAFT_MIGRATION_MESSAGE}`);
  const [removed] = await sql<any[]>`update marketing.strategy_plan_drafts
    set status='archived',version=version+1,updated_at=now()
    where id=${draftId}::uuid and status='draft' returning id::text,name`;
  if (!removed) throw new Error('Invalid placement: المسودة غير موجودة أو تم إرسالها للمراجعة.');
  return { ok: true, id: removed.id, name: removed.name, archived: true };
}

/** Strategy plans: caption + hashtags of a publication can be written before
 * the product is delivered. Publishing/link still waits for final files. */
export async function saveStrategyLineCopy(sql: Sql, user: SessionUser, body: Row, planLines: (db: Sql, user: SessionUser, planId?: string) => Promise<any[]>) {
  if (!hasPermission(user, 'marketing.publish_prep.manage')) throw new Error(W.denied);
  const lineId = id(body.lineId);
  const caption = text(body.caption, 10000), hashtags = text(body.hashtags, 3000);
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    const [line] = await tx<any[]>`select l.id::text,l.plan_id::text,l.version from marketing.work_plan_items l join marketing.work_plans p on p.id=l.plan_id
      where l.id=${lineId}::uuid and l.is_deleted=false and p.is_deleted=false for update of l`;
    if (!line) throw new Error(W.notFound);
    if (body.version !== undefined && Number(body.version) !== Number(line.version)) throw new Error(W.conflict);
    const visible = (await planLines(tx as unknown as Sql, user, line.plan_id)).find(row => row.id === lineId);
    if (!visible || !visible.strategy_draft_id) throw new Error(W.denied);
    if (Number(visible.prepared_count || 0) > 0) throw new Error('المنشور مُجهز بالفعل؛ عدّل الكابشن من زر «فتح» في تجهيز النشر.');
    await tx`update marketing.work_plan_items set caption=${caption},hashtags=${hashtags},version=version+1,updated_at=now() where id=${lineId}::uuid`;
    return { ok: true, id: lineId, message: W.saved };
  });
}
