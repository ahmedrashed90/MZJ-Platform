/** Atomic approval sync for plan-scoped executor delivery dates.
 * Do not apply changes when the reviewer requests a revision, while a plan is
 * merely submitted, or when the creator saves draft date edits.
 * All writes, version updates and audit records happen within the caller's
 * transaction, so a failed item rolls back the plan approval as well.
 */
import type { SessionUser } from '../_auth.js';
import type { getSql } from '../_db.js';

type Sql = ReturnType<typeof getSql>;
const date = (value: unknown) => value == null ? null : String(value).slice(0, 10);

export async function applyApprovedPlanExecutorDates(tx: Sql, user: SessionUser, planId: string): Promise<number> {
  const [state] = await tx<{ has_table: boolean; has_applied: boolean; nullable_date: boolean }[]>`select
    to_regclass('marketing.work_plan_executor_dates') is not null as has_table,
    exists (select 1 from information_schema.columns where table_schema='marketing'
      and table_name='work_plan_executor_dates' and column_name='applied_at') as has_applied,
    exists (select 1 from information_schema.columns where table_schema='marketing'
      and table_name='work_items' and column_name='due_on' and is_nullable='YES') as nullable_date`;
  if (!state?.has_table) return 0;
  if (!state.has_applied || !state.nullable_date) {
    const [count] = await tx<{ total: number }[]>`select count(*)::int as total from marketing.work_plan_executor_dates
      where plan_id=${planId}::uuid`;
    if (Number(count?.total || 0) > 0) throw new Error('يلزم تحديث قاعدة بيانات التسويق إلى schema-22 قبل اعتماد تواريخ المنفذين.');
    return 0;
  }
  const pending = await tx<{ id: string; item_id: string; due_on: string | null }[]>`select id::text,item_id::text,due_on::text
    from marketing.work_plan_executor_dates where plan_id=${planId}::uuid and applied_at is null
    order by item_id,id for update`;
  for (const edit of pending) {
    const [item] = await tx<{ task_id: string; due_on: string | null }[]>`select i.task_id::text,i.due_on::text
      from marketing.work_items i join marketing.work_tasks t on t.id=i.task_id
      where i.id=${edit.item_id}::uuid and t.is_deleted=false for update of i`;
    if (!item) throw new Error('تعذر مزامنة تاريخ أحد المنفذين؛ المطلوب الأصلي لم يعد موجودًا.');
    const previous = date(item.due_on), next = date(edit.due_on);
    if (previous !== next) {
      await tx`update marketing.work_items set due_on=${next}::date,
        version=version+1,updated_at=now() where id=${edit.item_id}::uuid`;
      await tx`insert into marketing.work_history(task_id,item_id,action,note,actor_id,actor_name,data)
        values(${item.task_id}::uuid,${edit.item_id}::uuid,'plan_delivery_date_approved','',
          ${user.id}::uuid,${user.fullName},${tx.json({ planId, previousDueOn: previous, dueOn: next })})`;
    }
    await tx`update marketing.work_plan_executor_dates set applied_at=now()
      where id=${edit.id}::uuid and applied_at is null`;
  }
  return pending.length;
}
