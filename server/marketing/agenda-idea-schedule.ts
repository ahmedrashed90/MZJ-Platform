/** Approved strategy agenda: one planned day per idea code across every
 * platform/format. This never changes actual publication history or approval. */
import type { SessionUser } from '../_auth.js';
import type { getSql } from '../_db.js';
import { hasPermission } from '../../shared/system-access.js';
import { isWorkDate } from '../../shared/marketing-workflow.js';
import { W } from '../../shared/marketing-workflow-labels.js';

type Sql = ReturnType<typeof getSql>;
type Row = Record<string, any>;
const day = (value: unknown) => String(value ?? '').slice(0, 10);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ideaCode = (value: unknown) => String(value ?? '').trim();

export type AgendaIdeaLine = {
  line_id: string; product_id: string; idea_code: string | null;
  idea_name: string; scheduled_on: string;
  manual_post_url?: string | null; manual_published_on?: string | null;
  blocked_target_count: number; platform_name?: string | null; post_type_id?: string | null;
};

export type AgendaIdeaSchedule = {
  ideaCode: string; ideaName: string; currentDates: string[];
  postCount: number; blockedPosts: number; platforms: string[];
};

export function summarizeAgendaIdeas(rows: AgendaIdeaLine[]) {
  const ideas = new Map<string, { ideaCode: string; ideaName: string; dates: Set<string>;
    postCount: number; blockedPosts: number; platforms: Set<string> }>();
  let unmappedPosts = 0;
  for (const row of rows) {
    const code = ideaCode(row.idea_code);
    if (!code) { unmappedPosts++; continue; }
    let entry = ideas.get(code);
    if (!entry) {
      entry = { ideaCode: code, ideaName: row.idea_name, dates: new Set(),
        postCount: 0, blockedPosts: 0, platforms: new Set() };
      ideas.set(code, entry);
    }
    entry.postCount++;
    if (row.scheduled_on) entry.dates.add(day(row.scheduled_on));
    if (row.platform_name) entry.platforms.add(row.platform_name);
    if (row.manual_published_on || String(row.manual_post_url || '').trim() || Number(row.blocked_target_count || 0) > 0) entry.blockedPosts++;
  }
  return { totalPosts: rows.length, unmappedPosts, ideas: [...ideas.values()].map(entry => ({
    ideaCode: entry.ideaCode, ideaName: entry.ideaName, currentDates: [...entry.dates].sort(),
    postCount: entry.postCount, blockedPosts: entry.blockedPosts, platforms: [...entry.platforms],
  })) };
}

async function agenda(sql: Sql, planId: string) {
  const [plan] = await sql<Row[]>`select id::text,created_by::text,kind,review_status,is_deleted,plan_no,name
    from marketing.work_plans where id=${planId}::uuid`;
  return plan || null;
}
function editable(plan: Row | null, user: SessionUser, canReview: boolean) {
  return Boolean(plan && !plan.is_deleted && plan.kind === 'agenda' &&
    ['publishing', 'published'].includes(plan.review_status) &&
    hasPermission(user, 'marketing.agenda.edit') && (plan.created_by === user.id || canReview));
}
async function agendaLines(sql: Sql, planId: string): Promise<AgendaIdeaLine[]> {
  return sql<AgendaIdeaLine[]>`select l.id::text as line_id,l.product_id::text,
    e.idea_code,i.idea_name,l.scheduled_on::text,l.manual_post_url,l.manual_published_on::text,
    pt.id::text as post_type_id,platform.name as platform_name,
    (select count(*)::int from marketing.work_publish_targets target
      join marketing.publish_schedule schedule on schedule.id=target.schedule_id
      where target.line_id=l.id and (schedule.status not in ('cancelled','waiting','failed') or
        schedule.published_at is not null or nullif(schedule.publish_result->>'url','') is not null)) as blocked_target_count
    from marketing.work_plan_items l
    join marketing.work_items i on i.id=l.product_id
    left join marketing.strategy_plan_drafts draft on draft.work_plan_id=l.plan_id and draft.kind='agenda'
    left join marketing.strategy_plan_draft_entries e on e.draft_id=draft.id and e.item_id=l.product_id
    left join marketing.platform_post_types pt on pt.id=l.post_type_id
    left join marketing.platforms platform on platform.id=pt.platform_id
    where l.plan_id=${planId}::uuid and l.is_deleted=false order by i.sort_order,l.id`;
}
export async function getAgendaIdeaSchedule(sql: Sql, user: SessionUser, planId: string, canReview: boolean) {
  if (!uuidPattern.test(planId)) throw new Error(W.invalid);
  const plan = await agenda(sql, planId);
  if (!plan) throw new Error(W.notFound);
  if (!editable(plan, user, canReview)) throw new Error(W.denied);
  return { ok: true, planNo: plan.plan_no, ...summarizeAgendaIdeas(await agendaLines(sql, planId)) };
}

type Change = { ideaCode: string; date: string; expectedDates: string[] };
export function validateAgendaIdeaChanges(raw: unknown): Change[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 500) throw new Error(W.invalid);
  const known = new Set<string>();
  return raw.map(value => {
    const code = ideaCode(value?.ideaCode);
    const date = typeof value?.date === 'string' ? value.date.trim() : '';
    const expectedDates = value?.expectedDates;
    if (!code || code.length > 180 || known.has(code) || !isWorkDate(date) ||
      !Array.isArray(expectedDates) || expectedDates.length > 100 ||
      expectedDates.some(old => !isWorkDate(old))) throw new Error(W.invalid);
    known.add(code);
    return { ideaCode: code, date, expectedDates: [...new Set(expectedDates)].sort() };
  });
}

export async function saveAgendaIdeaSchedule(sql: Sql, user: SessionUser, planId: string, canReview: boolean, raw: unknown) {
  if (!uuidPattern.test(planId)) throw new Error(W.invalid);
  const changes = validateAgendaIdeaChanges(raw);
  return sql.begin(async tx => {
    await tx`set local lock_timeout='4s'`;
    await tx`set local statement_timeout='25s'`;
    const [plan] = await tx<Row[]>`select id::text,created_by::text,kind,review_status,is_deleted,plan_no,name
      from marketing.work_plans where id=${planId}::uuid for update`;
    if (!plan) throw new Error(W.notFound);
    if (!editable(plan, user, canReview)) throw new Error(W.denied);
    const existing = await tx<Row[]>`select id::text,product_id::text,post_type_id::text,scheduled_on::text
      from marketing.work_plan_items where plan_id=${planId}::uuid and is_deleted=false for update`;
    const source = await agendaLines(tx as unknown as Sql, planId);
    const summary = summarizeAgendaIdeas(source);
    const byCode = new Map(summary.ideas.map(entry => [entry.ideaCode, entry]));
    const changedLines = new Map<string, string>();
    for (const change of changes) {
      const idea = byCode.get(change.ideaCode);
      if (!idea) throw new Error('Idea code no longer belongs to this agenda. Refresh and retry.');
      if (JSON.stringify(idea.currentDates) !== JSON.stringify(change.expectedDates))
        throw new Error('Publication dates changed since you opened the agenda. Refresh before saving.');
      if (idea.blockedPosts) throw new Error('The selected idea has already published or externally scheduled posts. Their dates cannot be replaced.');
      for (const row of source) if (ideaCode(row.idea_code) === change.ideaCode) changedLines.set(row.line_id, change.date);
    }
    // The plan's unique (product, post type, planned date) constraint must be
    // checked before any mutation, including collisions with unchanged rows.
    const oldIdentity = new Set<string>();
    for (const row of existing) {
      const nextDate = changedLines.get(row.id) || day(row.scheduled_on);
      const identity = `${row.product_id}:${row.post_type_id || ''}:${nextDate}`;
      if (oldIdentity.has(identity)) throw new Error('Changing these dates would create duplicate publication rows for the same product and post type.');
      oldIdentity.add(identity);
    }
    const lineIds = [...changedLines.keys()];
    if (!lineIds.length) throw new Error(W.invalid);
    // Lock existing provider schedules so no publisher can move them to
    // processing/scheduled between the safety check and date update.
    const targets = await tx<Row[]>`select target.line_id::text,schedule.id::text as schedule_id,schedule.status,
        schedule.published_at,schedule.publish_result->>'url' as published_url
      from marketing.work_publish_targets target
      join marketing.publish_schedule schedule on schedule.id=target.schedule_id
      where target.line_id=any(${lineIds}::uuid[]) and schedule.status<>'cancelled'
      order by schedule.id for update of schedule`;
    if (targets.some(row => !['waiting','failed'].includes(row.status) || row.published_at || row.published_url))
      throw new Error('One of these posts is already being published or scheduled externally. Refresh and review it first.');
    // Four set-based updates for the entire batch (up to 316+ posts) instead
    // of one round trip per platform/idea; all remain in the same transaction.
    const plannedDates = lineIds.map(lineId => changedLines.get(lineId)!);
    const codes = changes.map(change => change.ideaCode);
    const ideaDates = changes.map(change => change.date);
    await tx`update marketing.work_plan_items set scheduled_on=updates.planned_on,version=version+1,updated_at=now()
      from unnest(${lineIds}::uuid[],${plannedDates}::date[]) updates(line_id,planned_on)
      where marketing.work_plan_items.id=updates.line_id and marketing.work_plan_items.plan_id=${planId}::uuid
        and marketing.work_plan_items.is_deleted=false`;
    await tx`update marketing.strategy_plan_draft_entries e set scheduled_on=updates.planned_on,target_on=updates.planned_on,
        updated_at=now(),version=e.version+1
      from marketing.strategy_plan_drafts d,unnest(${codes}::text[],${ideaDates}::date[]) updates(code,planned_on)
      where e.draft_id=d.id and d.work_plan_id=${planId}::uuid and d.kind='agenda'
        and btrim(e.idea_code)=updates.code`;
    await tx`update marketing.publish_schedule schedule set publish_date=updates.planned_on,updated_at=now()
      from marketing.work_publish_targets target,unnest(${lineIds}::uuid[],${plannedDates}::date[]) updates(line_id,planned_on)
      where target.schedule_id=schedule.id and target.line_id=updates.line_id
        and schedule.status in ('waiting','failed')`;
    await tx`update marketing.creatives creative set schedule_day=updates.planned_on,updated_at=now()
      from marketing.tasks task,unnest(${lineIds}::text[],${plannedDates}::date[]) updates(line_id,planned_on)
      where creative.id=task.creative_id and task.source_id=${planId}::uuid
        and task.approved_template_data->>'workflowLineId'=updates.line_id`;
    const nextDates = existing.map(row => changedLines.get(row.id) || day(row.scheduled_on)).sort();
    const first = nextDates[0], last = nextDates.at(-1)!;
    await tx`update marketing.agendas set publish_start=${first}::date,publish_end=${last}::date,
      payload=jsonb_set(jsonb_set(coalesce(payload,'{}'::jsonb),'{agendaFrom}',to_jsonb(${first}::text)),'{agendaTo}',to_jsonb(${last}::text)),
      month_key=${first.slice(0, 7)},updated_at=now() where id=${planId}::uuid`;
    await tx`update marketing.strategy_plan_drafts set updated_at=now() where work_plan_id=${planId}::uuid and kind='agenda'`;
    await tx`update marketing.work_plans set updated_at=now() where id=${planId}::uuid`;
    const before = changes.map(change => ({ ideaCode: change.ideaCode, currentDates: byCode.get(change.ideaCode)!.currentDates }));
    const after = changes.map(change => ({ ideaCode: change.ideaCode, date: change.date }));
    await tx`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data)
      values(${user.id}::uuid,'marketing','work_reschedule_agenda_ideas','marketing_work_plan',${planId},
        ${tx.json({ ideas: before })},${tx.json({ ideas: after, updatedPosts: lineIds.length })})`;
    return { ok: true, updatedIdeas: changes.length, updatedPosts: lineIds.length, agendaFrom: first, agendaTo: last };
  });
}
