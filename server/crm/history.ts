import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, requireCrmPermission, requireCrmUser, sourceLabel, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";

function scopeCondition(scope: ReturnType<typeof userScope>) {
  return scope;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!(await requireCrmPermission(user, response, "crm.finance_history.view"))) return;
  const sql = getSql();
  const scope = scopeCondition(userScope(user));
  const leadId = clean(request.query.leadId);
  const mode = clean(request.query.mode);
  const q = clean(request.query.q);
  const status = clean(request.query.status);
  const from = clean(request.query.from);
  const to = clean(request.query.to);

  if (leadId) {
    const [lead] = await sql<any[]>`
      select l.*, l.id::text, sales.full_name as assigned_name, cc.full_name as call_center_name, b.name as branch_name, src.name as catalog_source_name
      from crm.leads l
      left join core.users sales on sales.id=l.assigned_to
      left join core.users cc on cc.id=l.call_center_assigned_to
      left join core.branches b on b.code=l.branch_code
      left join core.sources src on src.code=l.source_code
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
    lead.source_name = sourceLabel(lead.source_code, lead.catalog_source_name || lead.source_name);
    delete lead.catalog_source_name;
    return response.status(200).json({ ok: true, lead, events });
  }

  if (mode === "differences") {
    if (!from || !to) return response.status(400).json({ ok: false, error: "حدد تاريخ البداية وتاريخ النهاية" });
    if (from > to) return response.status(400).json({ ok: false, error: "تاريخ البداية يجب أن يكون قبل تاريخ النهاية أو مساويًا له" });

    const counts = await sql<{ cutoff_key: string; status: string; count: number }[]>`
      with visible_leads as (
        select l.id, l.status_label, coalesce(l.registered_at,l.created_at) as entry_at
        from crm.leads l
        where l.is_deleted=false
          and (
            l.department_code in ('finance_sales','call_center')
            or exists (
              select 1 from crm.lead_events de
              where de.lead_id=l.id
                and (de.old_department in ('finance_sales','call_center') or de.new_department in ('finance_sales','call_center'))
            )
          )
          and (
            ${scope.all}::boolean or l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid
            or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
          )
      ), cutoffs(cutoff_key, cutoff_at) as (
        values
          ('from'::text, ((${from}::date + interval '1 day')::timestamp at time zone 'Asia/Riyadh') - interval '1 microsecond'),
          ('to'::text, ((${to}::date + interval '1 day')::timestamp at time zone 'Asia/Riyadh') - interval '1 microsecond')
      ), states as (
        select
          c.cutoff_key,
          v.id,
          coalesce(
            (
              select nullif(trim(e.new_status),'')
              from crm.lead_events e
              where e.lead_id=v.id and e.created_at<=c.cutoff_at and nullif(trim(e.new_status),'') is not null
              order by e.created_at desc,e.id desc
              limit 1
            ),
            case
              when v.entry_at<=c.cutoff_at and c.cutoff_at >= (((now() at time zone 'Asia/Riyadh')::date + interval '1 day')::timestamp at time zone 'Asia/Riyadh' - interval '1 microsecond') then coalesce(nullif(trim(v.status_label),''),'عميل جديد')
              when v.entry_at<=c.cutoff_at then 'عميل جديد'
              else null
            end
          ) as status
        from visible_leads v cross join cutoffs c
      )
      select cutoff_key,status,count(*)::int as count
      from states
      where status is not null and status<>'' and status<>'-'
      group by cutoff_key,status
    `;

    const definitions = await sql<{ value: string; label: string; sort_order: number }[]>`
      select value,label,sort_order
      from crm.dashboard_statuses
      where department_code='finance' and is_active=true
      order by sort_order,label
    `;
    const fromCounts = new Map(counts.filter((row) => row.cutoff_key === "from").map((row) => [row.status, Number(row.count || 0)]));
    const toCounts = new Map(counts.filter((row) => row.cutoff_key === "to").map((row) => [row.status, Number(row.count || 0)]));
    const ordered = new Map<string, { value: string; label: string; sort_order: number }>();
    definitions.forEach((item) => ordered.set(item.value, item));
    [...fromCounts.keys(), ...toCounts.keys()].forEach((value) => {
      if (!ordered.has(value)) ordered.set(value, { value, label: value, sort_order: 10000 + ordered.size });
    });
    const rows = [...ordered.values()]
      .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0) || left.label.localeCompare(right.label, "ar"))
      .map((item) => {
        const fromCount = fromCounts.get(item.value) || 0;
        const toCount = toCounts.get(item.value) || 0;
        return { ...item, from: fromCount, to: toCount, difference: toCount - fromCount };
      });
    return response.status(200).json({
      ok: true,
      from,
      to,
      rows,
      totalFrom: [...fromCounts.values()].reduce((sum, count) => sum + count, 0),
      totalTo: [...toCounts.values()].reduce((sum, count) => sum + count, 0),
      changedStatuses: rows.filter((row) => row.difference !== 0).length,
    });
  }

  const rows = await sql<any[]>`
    select l.id::text, l.customer_name, l.phone, l.phone_normalized, l.status_label, l.department_code, l.branch_code,
      l.service_key, l.payment_type, l.source_code, l.source_name, l.car_name, l.car_type, l.car_category, l.car_model, l.color, l.finance_type,
      l.age, l.salary, l.obligation, l.salary_bank, l.location, l.follow_up_at, l.campaign_name, l.notes, l.extra_data,
      l.registered_at, l.created_at, l.updated_at,
      sales.full_name as assigned_name, cc.full_name as call_center_name, src.name as catalog_source_name,
      max(e.created_at) as last_event_at, count(e.id)::int as events_count
    from crm.leads l
    left join core.users sales on sales.id=l.assigned_to
    left join core.users cc on cc.id=l.call_center_assigned_to
    left join core.sources src on src.code=l.source_code
    left join crm.lead_events e on e.lead_id=l.id
    where l.is_deleted=false
      and (
        l.department_code in ('finance_sales','call_center')
        or exists (
          select 1 from crm.lead_events de
          where de.lead_id=l.id
            and (de.old_department in ('finance_sales','call_center') or de.new_department in ('finance_sales','call_center'))
        )
      )
      and (
        ${scope.all}::boolean or l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid
        or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
      )
      and (${q || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.status_label,sales.full_name,cc.full_name) ilike ${q ? `%${q}%` : null})
      and (${status || null}::text is null or l.status_label=${status || null})
      and (${from || null}::date is null or coalesce(l.registered_at,l.created_at)::date >= ${from || null}::date)
      and (${to || null}::date is null or coalesce(l.registered_at,l.created_at)::date <= ${to || null}::date)
    group by l.id,sales.full_name,cc.full_name,src.name
    order by max(e.created_at) desc nulls last,l.updated_at desc
    limit 500
  `;
  for (const row of rows) {
    row.source_name = sourceLabel(row.source_code, row.catalog_source_name || row.source_name);
    delete row.catalog_source_name;
  }
  return response.status(200).json({ ok: true, rows });
}
