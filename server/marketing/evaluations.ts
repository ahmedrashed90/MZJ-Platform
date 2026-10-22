import type { SessionUser } from '../_auth.js';
import { hasPermission } from '../../shared/system-access.js';
import { getSystemAccess } from '../_access-control.js';
import { getSql } from '../_db.js';
import { isBinaryProductDecisionCriterion } from '../../shared/marketing-workflow.js';

type Sql = ReturnType<typeof getSql>;
type Row = Record<string, any>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = (value: unknown) => {
  const id = String(value ?? '').trim();
  if (!uuidPattern.test(id)) throw new Error('معرّف غير صالح');
  return id;
};
const canGrade = (user: SessionUser) => hasPermission(user, 'platform.superadmin') ||
  hasPermission(user, 'settings.marketing.manage') ||
  (hasPermission(user, 'marketing.task.review') &&
    getSystemAccess(user, 'marketing').dataScope === 'all');
const canSee = (user: SessionUser) => canGrade(user) ||
  ['marketing.task.view_assigned', 'marketing.dashboard.view', 'marketing.task.review', 'settings.marketing.view']
    .some(permission => hasPermission(user, permission));
const requireAccess = (allowed: boolean) => { if (!allowed) throw new Error('ليس لديك صلاحية لتنفيذ الإجراء'); };
export function canGradeWorkItem(user: SessionUser) { return canGrade(user); }

/** Shared database-backed catalogs for the review dropdown and KPI criteria. */
export async function evaluationSettings(sql: Sql, user: SessionUser) {
  requireAccess(canSee(user));
  const [categories, criteria] = await Promise.all([
    sql<any[]>`select id::text,name,sort_order,is_active from marketing.work_review_categories
      where is_active=true order by sort_order,name`,
    sql<any[]>`select id::text,name,sort_order,is_active from marketing.work_kpi_criteria
      where is_active=true order by sort_order,name`,
  ]);
  return { ok: true, categories, criteria, canManage: hasPermission(user, 'settings.marketing.manage') || hasPermission(user, 'platform.superadmin') };
}

export async function manageEvaluationSetting(sql: Sql, user: SessionUser, body: Row) {
  requireAccess(hasPermission(user, 'settings.marketing.manage') || hasPermission(user, 'platform.superadmin'));
  const table = body.kind === 'category' ? 'marketing.work_review_categories' :
    body.kind === 'criterion' ? 'marketing.work_kpi_criteria' : null;
  if (!table) throw new Error('نوع الإعداد غير صالح');
  const entryId = body.id ? validId(body.id) : null;
  if (body.remove === true) {
    if (!entryId) throw new Error('حدد البند المطلوب');
    if (table === 'marketing.work_review_categories') await sql`update marketing.work_review_categories set is_active=false,updated_at=now() where id=${entryId}::uuid`;
    else await sql`update marketing.work_kpi_criteria set is_active=false,updated_at=now() where id=${entryId}::uuid`;
    return { ok: true };
  }
  const name = String(body.name ?? '').trim().slice(0, 160);
  const sortOrder = Number(body.sortOrder);
  if (!name || !Number.isSafeInteger(sortOrder) || Math.abs(sortOrder) > 100000) throw new Error('اسم أو ترتيب غير صالح');
  if (table === 'marketing.work_review_categories') {
    if (entryId) await sql`update marketing.work_review_categories set name=${name},sort_order=${sortOrder},updated_at=now() where id=${entryId}::uuid and is_active=true`;
    else await sql`insert into marketing.work_review_categories(name,sort_order) values(${name},${sortOrder})`;
  } else {
    if (entryId) await sql`update marketing.work_kpi_criteria set name=${name},sort_order=${sortOrder},updated_at=now() where id=${entryId}::uuid and is_active=true`;
    else await sql`insert into marketing.work_kpi_criteria(name,sort_order) values(${name},${sortOrder})`;
  }
  return { ok: true };
}

function normalizeItemScores(criteria: {id:string; name:string}[], scores: unknown) {
  if (!criteria.length) throw new Error('أضف بنود التقييم من إعدادات التسويق أولًا');
  if (!Array.isArray(scores)) throw new Error('بنود التقييم غير صالحة');
  const supplied = new Map<string,unknown>();
  for (const entry of scores) {
    if (!entry || typeof entry !== 'object' || supplied.has(String(entry.criterionId))) throw new Error('بنود التقييم غير صالحة');
    supplied.set(String(entry.criterionId),entry.score);
  }
  if (supplied.size !== criteria.length) throw new Error('يجب تقييم جميع البنود');
  return criteria.map(row => {
    const score = supplied.get(row.id);
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 3)
      throw new Error('درجة كل بند يجب أن تكون من 0 إلى 3');
    if (isBinaryProductDecisionCriterion(row.name) && score !== 0 && score !== 3)
      throw new Error('قبول أو رفض المنتج يقبل درجة 0 أو 3 فقط');
    return {criterionId:row.id,criterionName:row.name,score};
  });
}

/** The task/item visibility predicate is also enforced by the workflow caller. */
export async function saveItemRating(sql: Sql, user: SessionUser, body: Row, item: Row) {
  requireAccess(canGrade(user));
  const scores = Array.isArray(body.scores) ? body.scores : [];
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    const [locked] = await tx<any[]>`select id,assigned_to,status,formats from marketing.work_items where id=${item.id}::uuid for update`;
    if (!locked) throw new Error('المطلوب غير موجود');
    if (locked.status !== 'approved') throw new Error('تقييم المنفذ متاح بعد اعتماد جميع ملفات المنتج بنسبة 100% أو بعد رفض المطلوب.');
    const [complete] = await tx<any[]>`select count(*)::int as approved_count from marketing.work_format_reviews
      where item_id=${item.id}::uuid and status='approved'`;
    if (!Array.isArray(locked.formats) || locked.formats.length === 0 || Number(complete?.approved_count) !== locked.formats.length)
      throw new Error('لا يمكن تقييم المطلوب قبل اعتماد جميع المقاسات بنسبة 100%.');
    const criteria = await tx<{id:string;name:string}[]>`select id::text,name from marketing.work_kpi_criteria where is_active=true order by sort_order,name`;
    const normalized = normalizeItemScores(criteria,scores);
    const percentage = Math.round(normalized.reduce((sum, row) => sum + row.score, 0) / (normalized.length * 3) * 10000) / 100;
    await tx`insert into marketing.work_item_ratings(item_id,assignee_id,rated_by,scores,percentage)
      values(${item.id}::uuid,${locked.assigned_to}::uuid,${user.id}::uuid,${tx.json(normalized)},${percentage})
      on conflict(item_id) do update set assignee_id=excluded.assignee_id,rated_by=excluded.rated_by,
      scores=excluded.scores,percentage=excluded.percentage,updated_at=now()`;
    return { ok: true, percentage };
  });
}

/** Rejected requirements are absent from active execution. Grade their archival
 * record only; never reintroduce rejected files/products to work_items. */
export async function saveRejectedItemRating(sql: Sql, user: SessionUser, body: Row, item: Row) {
  requireAccess(canGrade(user));
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    const [locked] = await tx<any[]>`select item_id,assigned_to from marketing.work_rejected_items
      where item_id=${item.item_id}::uuid for update`;
    if (!locked) throw new Error('المطلوب المرفوض غير موجود');
    const criteria = await tx<{id:string;name:string}[]>`select id::text,name from marketing.work_kpi_criteria
      where is_active=true order by sort_order,name`;
    const normalized = normalizeItemScores(criteria,body.scores);
    const percentage = Math.round(normalized.reduce((sum,row)=>sum+row.score,0)/(normalized.length*3)*10000)/100;
    await tx`update marketing.work_rejected_items
      set scores=${tx.json(normalized)}::jsonb, percentage=${percentage}, rated_by=${user.id}::uuid, rated_at=now()
      where item_id=${item.item_id}::uuid`;
    return {ok:true,percentage};
  });
}

export async function manageItemReviewNote(sql: Sql, user: SessionUser, body: Row, item: Row) {
  requireAccess(canGrade(user));
  const noteId = body.noteId ? validId(body.noteId) : null;
  const remove = body.remove === true;
  const note = String(body.note ?? '').trim().slice(0, 10000);
  const categoryId = !remove && body.categoryId ? validId(body.categoryId) : null;
  if (remove && !noteId) throw new Error('حدد الملاحظة المطلوب حذفها');
  if (!remove && (!categoryId || !note)) throw new Error('اختر نوع الملاحظة واكتب التفاصيل');
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    const [current] = await tx<any[]>`select id from marketing.work_items where id=${item.id}::uuid for update`;
    if (!current) throw new Error('المطلوب غير موجود');
    if (categoryId) {
      const [category] = await tx<any[]>`select id from marketing.work_review_categories where id=${categoryId}::uuid and is_active=true`;
      if (!category) throw new Error('نوع الملاحظة غير متاح');
    }
    if (noteId) {
      const [existing] = await tx<any[]>`select id from marketing.work_item_review_notes
        where id=${noteId}::uuid and item_id=${item.id}::uuid and deleted_at is null for update`;
      if (!existing) throw new Error('الملاحظة غير موجودة');
      if (remove) {
        await tx`update marketing.work_item_review_notes set deleted_at=now(),updated_at=now()
          where id=${noteId}::uuid and item_id=${item.id}::uuid`;
      } else {
        await tx`update marketing.work_item_review_notes
          set category_id=${categoryId}::uuid,note=${note},updated_at=now()
          where id=${noteId}::uuid and item_id=${item.id}::uuid`;
      }
    } else {
      await tx`insert into marketing.work_item_review_notes(item_id,category_id,note,created_by)
        values(${item.id}::uuid,${categoryId}::uuid,${note},${user.id}::uuid)`;
    }
    await tx`update marketing.work_items set updated_at=now(),version=version+1 where id=${item.id}::uuid`;
    return { ok: true };
  });
}

export async function ratingsReport(sql: Sql, user: SessionUser, query: Row) {
  requireAccess(canSee(user));
  const from = String(query.dateFrom ?? '').trim(), to = String(query.dateTo ?? '').trim();
  const valid = (s: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d = new Date(`${s}T12:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s; };
  if (!valid(from) || !valid(to) || from > to || Date.parse(to) - Date.parse(from) > 366 * 5 * 86400000) throw new Error('فترة التقييم غير صالحة');
  const person = query.assigneeId && query.assigneeId !== 'all' ? validId(query.assigneeId) : null;
  const showAll = canGrade(user);
  const rows = await sql<any[]>`
    with all_ratings as (
      select r.item_id,r.assignee_id,r.percentage,r.scores,r.created_at,r.updated_at,
        i.idea_name,t.name as task_name,t.task_no,r.rated_by,'approved'::text as outcome
      from marketing.work_item_ratings r
      join marketing.work_items i on i.id=r.item_id
      join marketing.work_tasks t on t.id=i.task_id and t.is_deleted=false
      union all
      select r.item_id,r.assigned_to as assignee_id,r.percentage,r.scores,r.rated_at as created_at,
        r.rated_at as updated_at,r.idea_name,t.name as task_name,t.task_no,r.rated_by,'rejected'::text as outcome
      from marketing.work_rejected_items r
      join marketing.work_tasks t on t.id=r.task_id and t.is_deleted=false
      where r.rated_at is not null
    )
    select r.item_id::text,r.assignee_id::text,u.full_name as assignee_name,
      r.percentage::float8,r.scores,r.created_at,r.updated_at,
      r.idea_name,r.task_name,r.task_no,r.outcome,rv.full_name as reviewer_name
    from all_ratings r
    join core.users u on u.id=r.assignee_id
    left join core.users rv on rv.id=r.rated_by
    where (r.created_at at time zone 'Asia/Riyadh')::date >= ${from}::date
      and (r.created_at at time zone 'Asia/Riyadh')::date <= ${to}::date
      and (${showAll} or r.assignee_id=${user.id}::uuid)
      and (${person}::uuid is null or r.assignee_id=${person}::uuid)
    order by r.created_at desc,r.item_id`;
  return { ok: true, rows, canViewAll: showAll };
}
