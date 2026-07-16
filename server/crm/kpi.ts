import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, isCrmManager, parseBody, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";

function score(value: unknown) {
  const number = Number(value || 0);
  return Math.max(0, Math.min(100, Number.isFinite(number) ? number : 0));
}

function rating(total: number) {
  if (total >= 90) return "ممتاز";
  if (total >= 80) return "جيد جدًا";
  if (total >= 70) return "جيد";
  if (total >= 60) return "مقبول";
  return "يحتاج تحسين";
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();
  if (request.method === "GET") {
    const from = clean(request.query.from);
    const to = clean(request.query.to);
    const rows = await sql<any[]>`
      select e.*,e.id::text,e.user_id::text,u.full_name,
        coalesce((select count(*)::int from crm.leads l where l.assigned_to=u.id and l.status_label in ('تم البيع','تم الإنتهاء - إنشاء طلب البيع','تم الانتهاء - إنشاء طلب البيع') and l.is_deleted=false and l.updated_at::date between e.period_start and e.period_end),0) as calculated_sales
      from crm.kpi_evaluations e join core.users u on u.id=e.user_id
      where (${from || null}::date is null or e.period_end >= ${from || null}::date)
        and (${to || null}::date is null or e.period_start <= ${to || null}::date)
      order by e.period_start desc,u.full_name
    `;
    const agents = await sql<any[]>`
      select distinct u.id::text,u.full_name,u.employee_no,
        coalesce(array_agg(distinct d.name) filter (where d.name is not null),'{}') as departments,
        coalesce(array_agg(distinct b.name) filter (where b.name is not null),'{}') as branches
      from core.users u
      join core.user_departments ud on ud.user_id=u.id
      join core.departments d on d.id=ud.department_id and d.code in ('cash_sales','finance_sales','customer_service','call_center')
      left join core.user_branches ub on ub.user_id=u.id
      left join core.branches b on b.id=ub.branch_id
      where u.is_active=true
      group by u.id order by u.full_name
    `;
    return response.status(200).json({ ok: true, rows, agents });
  }

  if (request.method === "POST" || request.method === "PUT") {
    if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "إضافة التقييم متاحة للإدارة فقط" });
    const body = parseBody(request);
    const userId = clean(body.userId);
    const periodStart = clean(body.periodStart);
    const periodEnd = clean(body.periodEnd);
    if (!userId || !periodStart || !periodEnd) return response.status(400).json({ ok: false, error: "اختر المندوب والفترة" });
    const speed = score(body.speedScore);
    const efficiency = score(body.efficiencyScore);
    const discipline = score(body.disciplineScore);
    const value = score(body.valueScore);
    const total = Math.round(((speed + efficiency + discipline + value) / 4) * 100) / 100;
    const [row] = await sql<any[]>`
      insert into crm.kpi_evaluations(user_id,period_start,period_end,total_sales,speed_score,efficiency_score,discipline_score,value_score,total_score,rating,details,notes,evaluated_by)
      values (${userId}::uuid,${periodStart}::date,${periodEnd}::date,${Number(body.totalSales || 0)},${speed},${efficiency},${discipline},${value},${total},${rating(total)},${sql.json(body.details || {})},${clean(body.notes)||null},${user.id}::uuid)
      on conflict (user_id,period_start,period_end) do update set
        total_sales=excluded.total_sales,speed_score=excluded.speed_score,efficiency_score=excluded.efficiency_score,
        discipline_score=excluded.discipline_score,value_score=excluded.value_score,total_score=excluded.total_score,rating=excluded.rating,
        details=excluded.details,notes=excluded.notes,evaluated_by=excluded.evaluated_by,updated_at=now()
      returning *,id::text,user_id::text
    `;
    await audit(user, "kpi_evaluation_saved", "kpi_evaluation", row.id, row);
    return response.status(200).json({ ok: true, row });
  }
  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
