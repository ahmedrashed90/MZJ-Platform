/** The delivery dates displayed within an agenda/campaign belong to that plan.
 * work_items.due_on remains untouched: it is a required execution deadline.
 * A stored NULL override explicitly means "no delivery date in this plan".
 */
import type { SessionUser } from '../_auth.js';
import type { getSql } from '../_db.js';
import { hasPermission } from '../../shared/system-access.js';
import { getSystemAccess } from '../_access-control.js';
import { isWorkDate } from '../../shared/marketing-workflow.js';
import { W } from '../../shared/marketing-workflow-labels.js';

type Sql = ReturnType<typeof getSql>;
type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = (value: unknown) => { const valueText = String(value || '').trim(); if (!UUID.test(valueText)) throw new Error(W.invalid); return valueText; };
const string = (value: unknown) => String(value ?? '').trim();
type Target = { kind: 'campaign' | 'agenda'; id: string; created_by: string; status: string; isDraft: boolean };
type Services = { canReviewPlan: () => Promise<boolean>; canViewPlan: (planId: string) => Promise<boolean> };

async function schemaReady(sql: Sql): Promise<boolean> {
  const [state] = await sql<{ ready: boolean }[]>`select
    to_regclass('marketing.work_plan_executor_dates') is not null
    and exists (select 1 from information_schema.columns where table_schema='marketing'
      and table_name='strategy_plan_drafts' and column_name='campaign_end_on') as ready`;
  return Boolean(state?.ready);
}
async function targetOf(sql: Sql, user: SessionUser, input: Row, services: Services): Promise<{ target: Target; canEdit: boolean }> {
  if (input.planId && input.draftId) throw new Error(W.invalid);
  let target: Target;
  if (input.planId) {
    const planId = validId(input.planId);
    if (!(await services.canViewPlan(planId))) throw new Error(W.denied);
    const [row] = await sql<any[]>`select id::text,kind,created_by::text,review_status as status,is_deleted
      from marketing.work_plans where id=${planId}::uuid`;
    if (!row || row.is_deleted) throw new Error(W.notFound);
    target = { kind: row.kind, id: row.id, created_by: row.created_by, status: row.status, isDraft: false };
  } else if (input.draftId) {
    const draftId = validId(input.draftId);
    const [row] = await sql<any[]>`select id::text,kind,created_by::text,status from marketing.strategy_plan_drafts
      where id=${draftId}::uuid and status='draft'`;
    if (!row) throw new Error(W.notFound);
    const manager = (hasPermission(user, 'marketing.task.view_all') || hasPermission(user, 'marketing.task.review'))
      && getSystemAccess(user, 'marketing').dataScope === 'all';
    const kindPermission = row.kind === 'campaign' ? 'marketing.campaign.create' : 'marketing.agenda.create';
    if (!hasPermission(user, kindPermission) && !manager && !hasPermission(user, 'platform.superadmin')) throw new Error(W.denied);
    target = { kind: row.kind, id: row.id, created_by: row.created_by, status: row.status, isDraft: true };
  } else throw new Error(W.invalid);
  const creator = target.created_by === user.id;
  const permission = target.kind === 'campaign' ? 'marketing.campaign.create' : 'marketing.agenda.create';
  const editPermission = target.kind === 'campaign' ? 'marketing.campaign.edit' : 'marketing.agenda.edit';
  const reviewer = await services.canReviewPlan();
  const canEdit = (target.isDraft ? target.status === 'draft' : true)
    && ((creator && (hasPermission(user, permission) || hasPermission(user, editPermission))) || reviewer || hasPermission(user, 'platform.superadmin'));
  return { target, canEdit };
}

export type ExecutorDateItem = { itemId: string; assigneeName: string; mediaKind: string;
  originalDueOn: string; dueOn: string | null; overridden: boolean };
export type ExecutorDateIdea = { key: string; ideaName: string; ideaCode: string;
  taskNo: string; category: string; executors: ExecutorDateItem[] };

/** Only use an exact strategy idea code to join photographer/editor siblings;
 * legacy non-strategy tasks safely fall back to the same task + idea title. */
export function executorIdeaMatches(base: Row, sibling: Row, code: string): boolean {
  if (String(base.item_id) === String(sibling.id)) return true;
  if (String(base.task_id) !== String(sibling.task_id)) return false;
  if (base.idea_code && code) return String(base.idea_code) === code;
  if (code && !base.idea_code) return false;
  return string(base.idea_name) !== '' && string(base.idea_name) === string(sibling.idea_name);
}

async function readExecutorIdeas(sql: Sql, target: Target, ready: boolean): Promise<ExecutorDateIdea[]> {
  const bases = target.isDraft
    ? await sql<any[]>`select distinct e.item_id::text,e.task_id::text,e.idea_code,e.marketing_category,
        i.idea_name,t.task_no,t.name as task_name
      from marketing.strategy_plan_draft_entries e
      join marketing.work_items i on i.id=e.item_id
      join marketing.work_tasks t on t.id=i.task_id
      where e.draft_id=${target.id}::uuid and t.is_deleted=false order by t.task_no,i.idea_name,item_id`
    : await sql<any[]>`select distinct i.id::text as item_id,i.task_id::text,
        coalesce(e.idea_code,'') as idea_code,coalesce(e.marketing_category,'') as marketing_category,
        i.idea_name,t.task_no,t.name as task_name
      from marketing.work_plan_items l join marketing.work_items i on i.id=l.product_id
      join marketing.work_tasks t on t.id=i.task_id
      left join marketing.strategy_plan_drafts d on d.work_plan_id=l.plan_id
      left join marketing.strategy_plan_draft_entries e on e.draft_id=d.id and e.item_id=i.id
      where l.plan_id=${target.id}::uuid and l.is_deleted=false and t.is_deleted=false
      order by t.task_no,i.idea_name,item_id`;
  if (!bases.length) return [];
  const taskIds = [...new Set(bases.map((base: Row) => String(base.task_id)))];
  const siblings = await sql<any[]>`select i.id::text,i.task_id::text,i.client_key::text,i.idea_name,
      i.media_kind,i.due_on::text,coalesce(u.full_name,'') as assignee_name
    from marketing.work_items i left join core.users u on u.id=i.assigned_to
    where i.task_id=any(${taskIds}::uuid[]) and i.status<>'rejected'
    order by i.task_id,i.sort_order,i.created_at,i.id`;
  const markers = await sql<any[]>`select distinct on (h.task_id) h.task_id::text,h.data
    from marketing.work_history h where h.task_id=any(${taskIds}::uuid[]) and h.action='strategy_assigned'
    order by h.task_id,h.id desc`;
  const itemCodes = new Map<string, string>();
  for (const marker of markers) {
    const keys = Array.isArray(marker.data?.clientKeys) ? marker.data.clientKeys : [];
    const codes = Array.isArray(marker.data?.itemIdeaCodes) ? marker.data.itemIdeaCodes : [];
    for (let index = 0; index < keys.length; index++) itemCodes.set(`${marker.task_id}:${keys[index]}`, string(codes[index]));
  }
  const dueOverrides = new Map<string, string | null>();
  if (ready) {
    const saved = target.isDraft
      ? await sql<any[]>`select item_id::text,due_on::text from marketing.work_plan_executor_dates where draft_id=${target.id}::uuid`
      : await sql<any[]>`select item_id::text,due_on::text from marketing.work_plan_executor_dates where plan_id=${target.id}::uuid`;
    for (const row of saved) dueOverrides.set(String(row.item_id), row.due_on == null ? null : String(row.due_on).slice(0, 10));
  }
  const groups = new Map<string, ExecutorDateIdea>();
  for (const base of bases) {
    const ideaName = string(base.idea_name) || 'فكرة بدون عنوان';
    const ideaCode = string(base.idea_code);
    const key = `${base.task_id}::${ideaCode || ideaName}`;
    if (groups.has(key)) continue;
    const executors = siblings.filter(sibling => executorIdeaMatches(base, sibling,
      itemCodes.get(`${sibling.task_id}:${sibling.client_key}`) || '')).map(sibling => ({
        itemId: String(sibling.id), assigneeName: string(sibling.assignee_name) || 'منفذ غير محدد',
        mediaKind: String(sibling.media_kind || ''), originalDueOn: String(sibling.due_on || '').slice(0,10),
        dueOn: dueOverrides.has(String(sibling.id)) ? dueOverrides.get(String(sibling.id))! : String(sibling.due_on || '').slice(0,10),
        overridden: dueOverrides.has(String(sibling.id)),
      }));
    groups.set(key, { key, ideaName, ideaCode, taskNo: string(base.task_no),
      category: string(base.marketing_category) || string(base.task_name), executors });
  }
  return [...groups.values()];
}

export async function getPlanExecutorDates(sql: Sql, user: SessionUser, input: Row, services: Services) {
  const { target, canEdit } = await targetOf(sql, user, input, services);
  const ready = await schemaReady(sql);
  const ideas = await readExecutorIdeas(sql, target, ready);
  return { ok: true, ready, canEdit, kind: target.kind, ideas, planId: target.isDraft ? null : target.id,
    draftId: target.isDraft ? target.id : null };
}

export async function savePlanExecutorDates(sql: Sql, user: SessionUser, body: Row, services: Services) {
  const { target, canEdit } = await targetOf(sql, user, body, services);
  if (!canEdit) throw new Error(W.denied);
  if (!(await schemaReady(sql))) throw new Error('يلزم تحديث قاعدة بيانات التسويق من الداش بورد قبل تعديل مواعيد المنفذين.');
  const entries: Row[] = Array.isArray(body.entries) ? body.entries : [];
  if (!entries.length || entries.length > 500) throw new Error(W.invalid);
  const ids = new Set<string>();
  const changes = entries.map(entry => {
    const itemId = validId(entry.itemId);
    if (ids.has(itemId)) throw new Error('لا تكرر المنفذ نفسه في طلب الحفظ.');
    ids.add(itemId);
    const reset = entry.reset === true;
    const dueOn = entry.dueOn == null || entry.dueOn === '' ? null : String(entry.dueOn).slice(0, 10);
    if (!reset && dueOn !== null && !isWorkDate(dueOn)) throw new Error('تاريخ التسليم غير صحيح.');
    return { itemId, dueOn, reset };
  });
  const allowed = new Set((await readExecutorIdeas(sql, target, true)).flatMap(idea => idea.executors.map(person => person.itemId)));
  if (changes.some(change => !allowed.has(change.itemId))) throw new Error(W.denied);
  await sql.begin(async tx => {
    await tx`set local lock_timeout='3s'`;
    if (target.isDraft) await tx`select id from marketing.strategy_plan_drafts where id=${target.id}::uuid and status='draft' for update`;
    else await tx`select id from marketing.work_plans where id=${target.id}::uuid and is_deleted=false for update`;
    for (const change of changes) {
      if (change.reset) {
        if (target.isDraft) await tx`delete from marketing.work_plan_executor_dates where draft_id=${target.id}::uuid and item_id=${change.itemId}::uuid`;
        else await tx`delete from marketing.work_plan_executor_dates where plan_id=${target.id}::uuid and item_id=${change.itemId}::uuid`;
      } else if (target.isDraft) {
        await tx`insert into marketing.work_plan_executor_dates(draft_id,item_id,due_on,updated_by)
          values(${target.id}::uuid,${change.itemId}::uuid,${change.dueOn}::date,${user.id}::uuid)
          on conflict(draft_id,item_id) where draft_id is not null do update
          set due_on=excluded.due_on,updated_by=excluded.updated_by,updated_at=now()`;
      } else {
        await tx`insert into marketing.work_plan_executor_dates(plan_id,item_id,due_on,updated_by)
          values(${target.id}::uuid,${change.itemId}::uuid,${change.dueOn}::date,${user.id}::uuid)
          on conflict(plan_id,item_id) where plan_id is not null do update
          set due_on=excluded.due_on,updated_by=excluded.updated_by,updated_at=now()`;
      }
    }
    if (target.isDraft) await tx`update marketing.strategy_plan_drafts set updated_at=now(),version=version+1 where id=${target.id}::uuid`;
    else await tx`update marketing.work_plans set updated_at=now() where id=${target.id}::uuid`;
  });
  return { ok: true, changed: changes.length, message: 'تم حفظ تواريخ المنفذين داخل الأجندة أو الحملة، دون تغيير مواعيد التكليفات الأصلية.' };
}
