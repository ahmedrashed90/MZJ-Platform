import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, requireCrmUser, sourceLabel, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();
  const scope = userScope(user);
  const leadId = clean(request.query.leadId);
  const q = clean(request.query.q);
  const status = clean(request.query.status);
  const from = clean(request.query.from);
  const to = clean(request.query.to);

  if (leadId) {
    const [lead] = await sql<any[]>`
      select l.*, l.id::text, sales.full_name as assigned_name, cc.full_name as call_center_name, b.name as branch_name
      from crm.leads l
      left join core.users sales on sales.id=l.assigned_to
      left join core.users cc on cc.id=l.call_center_assigned_to
      left join core.branches b on b.code=l.branch_code
      where l.id=${leadId}::uuid and l.is_deleted=false
        and (
          ${scope.all}::boolean or l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid
          or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
        )
    `;
    if (!lead) return response.status(404).json({ ok: false, error: "العميل غير موجود" });
    const events = await sql<any[]>`
      select e.*, e.id::text from crm.lead_events e where e.lead_id=${leadId}::uuid order by e.created_at asc, e.id asc
    `;
    lead.source_name = sourceLabel(lead.source_code || lead.source_name);
    return response.status(200).json({ ok: true, lead, events });
  }

  const rows = await sql<any[]>`
    select l.id::text, l.customer_name, l.phone, l.phone_normalized, l.status_label, l.department_code, l.branch_code,
      l.source_code, l.source_name, l.car_name, l.car_model, l.color, l.finance_type, l.age, l.salary, l.obligation, l.salary_bank,
      l.location, l.campaign_name, l.notes, l.created_at, l.updated_at,
      sales.full_name as assigned_name, cc.full_name as call_center_name,
      max(e.created_at) as last_event_at, count(e.id)::int as events_count
    from crm.leads l
    left join core.users sales on sales.id=l.assigned_to
    left join core.users cc on cc.id=l.call_center_assigned_to
    left join crm.lead_events e on e.lead_id=l.id
    where l.is_deleted=false and l.department_code in ('finance_sales','call_center')
      and (
        ${scope.all}::boolean or l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid
        or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
      )
      and (${q || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.status_label,sales.full_name,cc.full_name) ilike ${q ? `%${q}%` : null})
      and (${status || null}::text is null or l.status_label=${status || null})
      and (${from || null}::date is null or coalesce(e.created_at,l.created_at)::date >= ${from || null}::date)
      and (${to || null}::date is null or coalesce(e.created_at,l.created_at)::date <= ${to || null}::date)
    group by l.id,sales.full_name,cc.full_name
    order by max(e.created_at) desc nulls last,l.updated_at desc
    limit 500
  `;
  for (const row of rows) row.source_name = sourceLabel(row.source_code || row.source_name);
  return response.status(200).json({ ok: true, rows });
}
