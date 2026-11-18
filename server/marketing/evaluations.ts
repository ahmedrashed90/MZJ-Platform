import type { SessionUser } from '../_auth.js';
import { hasPermission } from '../../shared/system-access.js';
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
const canManage = (user: SessionUser) => hasPermission(user, 'settings.marketing.manage') || hasPermission(user, 'platform.superadmin');
const canSee = (user: SessionUser) => canManage(user) ||
  ['marketing.task.view_assigned', 'marketing.dashboard.view', 'marketing.task.review', 'settings.marketing.view']
    .some(permission => hasPermission(user, permission));
const requireAccess = (allowed: boolean) => { if (!allowed) throw new Error('ليس لديك صلاحية لتنفيذ الإجراء'); };
/** A grader is one of the TWO active, explicitly configured Marketing users. */
export async function canGradeWorkItem(sql: Sql, user: SessionUser): Promise<boolean> {
  const [entry] = await sql<any[]>`select 1 from marketing.work_rating_reviewers rr
    join core.users u on u.id=rr.user_id and u.is_active=true and coalesce(u.is_archived,false)=false
    join core.user_systems us on us.user_id=u.id and us.system_code='marketing' and us.is_enabled=true
    where rr.user_id=${user.id}::uuid limit 1`;
  return Boolean(entry);
}

/** Shared database-backed catalogs for the review dropdown and KPI criteria. */
export async function evaluationSettings(sql: Sql, user: SessionUser) {
  requireAccess(canSee(user));
  const allowed = canManage(user);
  const [categories, criteria, reviewers, reviewerOptions] = await Promise.all([
    sql<any[]>`select id::text,name,sort_order,is_active from marketing.work_review_categories
      where is_active=true order by sort_order,name`,
    sql<any[]>`select id::text,name,sort_order,is_active from marketing.work_kpi_criteria
      where is_active=true order by sort_order,name`,
    sql<any[]>`select rr.slot,rr.user_id::text,coalesce(u.full_name,'') as name
      from marketing.work_rating_reviewers rr join core.users u on u.id=rr.user_id
      order by rr.slot`,
    allowed ? sql<any[]>`select u.id::text,coalesce(u.full_name,'') as name
      from core.users u join core.user_systems us on us.user_id=u.id
      where us.system_code='marketing' and us.is_enabled=true
        and u.is_active=true and coalesce(u.is_archived,false)=false
      order by u.full_name,u.id` : Promise.resolve([]),
  ]);
  return { ok: true, categories, criteria, reviewers, reviewerOptions, canManage: allowed };
}

export async function manageEvaluationSetting(sql: Sql, user: SessionUser, body: Row) {
  requireAccess(canManage(user));
  if (body.kind === 'raters') {
    const selected = Array.isArray(body.userIds) ? body.userIds.map(validId) : [];
    if (selected.length !== 2 || new Set(selected).size !== 2)
      throw new Error('لازم تختار مستخدمين مختلفين فقط لتقييم المنفذين');
    return sql.begin(async tx => {
      await tx`set local lock_timeout='3s'`;
      await tx`lock table marketing.work_rating_reviewers in exclusive mode`;
      const valid = await tx<any[]>`select u.id::text from core.users u
        join core.user_systems us on us.user_id=u.id
        where u.id=any(${selected}::uuid[]) and u.is_active=true
          and coalesce(u.is_archived,false)=false and us.system_code='marketing' and us.is_enabled=true`;
      if (valid.length !== 2) throw new Error('اختار مستخدمين نشطين من مستخدمي نظام التسويق');
      await tx`delete from marketing.work_rating_reviewers`;
      for (let i=0;i<2;i++) await tx`insert into marketing.work_rating_reviewers(slot,user_id,updated_by)
        values(${i+1},${selected[i]}::uuid,${user.id}::uuid)`;
      return { ok: true };
    });
  }
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
  requireAccess(await canGradeWorkItem(sql,user));
  const scores = Array.isArray(body.scores) ? body.scores : [];
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    const [locked] = await tx<any[]>`select id,assigned_to,status,formats from marketing.work_items where id=${item.id}::uuid for update`;
    if (!locked) throw new Error('المطلوب غير موجود');
    if (locked.status !== 'approved' && locked.status !== 'rejected') throw new Error('تقييم المنفذ متاح بعد اعتماد المنتج 100% أو رفضه.');
    if (locked.status === 'approved') {
      const configuredFormatIds = Array.isArray(locked.formats)
        ? locked.formats.map((format: { id?: unknown }) => String(format?.id || '')) : [];
      const [approval] = await tx<any[]>`select 1 from marketing.work_format_reviews
        where item_id=${item.id}::uuid and status='approved'
          and format_id=any(${configuredFormatIds}::text[]) limit 1`;
      if (!approval) throw new Error('تقييم المنفذ متاح بعد اعتماد الملفات المرفوعة أو رفض المطلوب.');
    }
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

/** Preserve grading for historical rejections archived by earlier versions.
 * Newly rejected requirements stay in work_items and use saveItemRating. */
export async function saveRejectedItemRating(sql: Sql, user: SessionUser, body: Row, item: Row) {
  requireAccess(await canGradeWorkItem(sql,user));
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

/** Notes become immutable at creation; only the atomic revision request can add a note. */
export async function manageItemReviewNote(_sql: Sql, _user: SessionUser, _body: Row, _item: Row) {
  throw new Error('ملاحظات التعديل المحفوظة نهائية ولا يمكن تعديلها أو حذفها. استخدم + إضافة تعديل (بحد أقصى 3).');
}

export async function ratingsReport(sql: Sql, user: SessionUser, query: Row) {
  requireAccess(canSee(user));
  const from = String(query.dateFrom ?? '').trim(), to = String(query.dateTo ?? '').trim();
  const valid = (s: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d = new Date(`${s}T12:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s; };
  if (!valid(from) || !valid(to) || from > to || Date.parse(to) - Date.parse(from) > 366 * 5 * 86400000) throw new Error('فترة التقييم غير صالحة');
  const person = query.assigneeId && query.assigneeId !== 'all' ? validId(query.assigneeId) : null;
  const showAll = canManage(user) || await canGradeWorkItem(sql,user);
  const rows = await sql<any[]>`
    with all_ratings as (
      select r.item_id,r.assignee_id,r.percentage,r.scores,r.created_at,r.updated_at,
        i.idea_name,t.name as task_name,t.task_no,r.rated_by,
        case when i.status='rejected' then 'rejected' else 'approved' end as outcome
      from marketing.work_item_ratings r
      join marketing.work_items i on i.id=r.item_id
      join marketing.work_tasks t on t.id=i.task_id and t.is_deleted=false
      union all
      select r.item_id,r.assigned_to as assignee_id,r.percentage,coalesce(r.scores,'[]'::jsonb) as scores,
        coalesce(r.rated_at,r.rejected_at) as created_at,
        coalesce(r.rated_at,r.rejected_at) as updated_at,r.idea_name,
        t.name as task_name,t.task_no,r.rated_by,'rejected'::text as outcome
      from marketing.work_rejected_items r
      join marketing.work_tasks t on t.id=r.task_id and t.is_deleted=false
      where r.percentage is not null
    )
    select r.item_id::text,r.assignee_id::text,coalesce(u.full_name,'منفذ سابق') as assignee_name,
      r.percentage::float8,r.scores,r.created_at,r.updated_at,
      r.idea_name,r.task_name,r.task_no,r.outcome,rv.full_name as reviewer_name
    from all_ratings r
    left join core.users u on u.id=r.assignee_id
    left join core.users rv on rv.id=r.rated_by
    where (r.created_at at time zone 'Asia/Riyadh')::date >= ${from}::date
      and (r.created_at at time zone 'Asia/Riyadh')::date <= ${to}::date
      and (${showAll} or r.assignee_id=${user.id}::uuid)
      and (${person}::uuid is null or r.assignee_id=${person}::uuid)
    order by r.created_at desc,r.item_id`;
  return { ok: true, rows, canViewAll: showAll };
}
