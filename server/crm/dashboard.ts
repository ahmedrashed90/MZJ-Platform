import type { VercelRequest, VercelResponse } from "@vercel/node";
import { calculateLeadCompletion, clean, departmentKey, requireCrmUser, sourceLabel, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { getCustomerFieldDefinitions } from "../_crm-customer-fields.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();
  const scope = userScope(user);
  const department = departmentKey(request.query.department || "cash");
  const q = clean(request.query.q);
  const branch = clean(request.query.branch);
  const status = clean(request.query.status);

  const customerFields = await getCustomerFieldDefinitions();

  const rows = await sql<any[]>`
    select
      l.id::text, l.legacy_id, l.customer_name, l.phone, l.phone_normalized, l.source_code, l.source_name,
      l.platform_code, l.service_key, l.department_code, l.branch_code, l.status_code, l.status_label,
      l.payment_type, l.car_name, l.car_category, l.location, l.age, l.salary, l.obligation, l.salary_bank,
      l.car_model, l.car_type, l.color, l.finance_type, l.follow_up_at, l.campaign_name, l.campaign_date,
      l.notes, l.status_note, l.extra_data, l.completion_percent, l.credit_limit, l.credit_qualified,
      l.dashboard_unread, l.has_unread_message, l.has_unread_messages, l.message_unread, l.is_unread,
      l.last_message_direction, l.last_incoming_message_at, l.dashboard_message_read_at,
      l.created_at, l.updated_at, l.registered_at,
      src.name as catalog_source_name,
      l.assigned_to::text, sales.full_name as assigned_name,
      l.call_center_assigned_to::text, cc.full_name as call_center_name,
      c.id::text as conversation_id, c.legacy_id as conversation_legacy_id, c.channel_code, c.preview_text,
      greatest(coalesce(l.unread_count,0),coalesce(c.unread_count,0))::int as unread_count,
      greatest(l.last_message_at,c.last_message_at) as last_message_at
    from crm.leads l
    left join core.sources src on src.code = l.source_code
    left join core.users sales on sales.id = l.assigned_to
    left join core.users cc on cc.id = l.call_center_assigned_to
    left join lateral (
      select c.* from crm.conversations c
      where c.lead_id = l.id
      order by c.last_message_at desc nulls last, c.updated_at desc
      limit 1
    ) c on true
    where l.is_deleted = false
      and (
        ${scope.all}::boolean
        or (${scope.callCenterOnly}::boolean and l.call_center_assigned_to = ${scope.userId}::uuid)
        or (not ${scope.callCenterOnly}::boolean and (l.assigned_to = ${scope.userId}::uuid or l.call_center_assigned_to = ${scope.userId}::uuid))
        or (l.department_code = any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code = any(${scope.branchCodes}::text[])))
      )
      and (
        (${department} = 'cash' and l.department_code = 'cash_sales') or
        (${department} = 'finance' and l.department_code in ('finance_sales','call_center')) or
        (${department} = 'service' and l.department_code = 'customer_service')
      )
      and (${branch || null}::text is null or l.branch_code = ${branch || null})
      and (${status || null}::text is null or l.status_label = ${status || null})
      and (${q || null}::text is null or concat_ws(' ', l.customer_name, l.phone, l.phone_normalized, l.car_name, l.car_category, l.source_name, l.campaign_name) ilike ${q ? `%${q}%` : null})
    order by coalesce(greatest(l.last_message_at,c.last_message_at), l.updated_at, l.created_at) desc
    limit 1000
  `;

  for (const row of rows) {
    row.source_name = row.catalog_source_name || sourceLabel(row.source_code || row.source_name);
    row.completion_percent = calculateLeadCompletion(row, customerFields);
    delete row.catalog_source_name;
  }

  const statuses = await sql<any[]>`
    select id, department_code, label, value, sort_order
    from crm.dashboard_statuses
    where department_code = ${department} and is_active = true
    order by sort_order
  `;

  const totals = statuses.map((item) => ({
    ...item,
    count: rows.filter((lead) => String(lead.status_label || "عميل جديد") === String(item.value)).length,
  }));

  return response.status(200).json({ ok: true, department, statuses: totals, leads: rows });
}
