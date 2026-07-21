import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, requireCrmUser, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });

  const sql = getSql();
  const scope = userScope(user);
  const leadId = clean(request.query.leadId);
  const mode = clean(request.query.mode);

  const rows = await sql<any[]>`
    select
      e.*,
      e.id::text,
      e.contact_id::text,
      e.service_request_id::text,
      e.lead_id::text,
      e.previous_assigned_to::text,
      e.new_assigned_to::text,
      e.actor_id::text,
      l.customer_name,
      l.phone,
      l.phone_normalized,
      l.status_label,
      l.department_code,
      l.branch_code,
      coalesce(nullif(e.previous_assigned_name,''), previous_user.full_name) as previous_assigned_name,
      coalesce(nullif(e.new_assigned_name,''), new_user.full_name) as new_assigned_name,
      coalesce(nullif(e.actor_name,''), actor_user.full_name, 'النظام') as actor_name,
      current_assignee.full_name as current_assigned_name,
      previous_branch.name as previous_branch_name,
      new_branch.name as new_branch_name,
      previous_department.name as previous_department_name,
      new_department.name as new_department_name
    from crm.ownership_events e
    left join crm.leads l on l.id=e.lead_id
    left join core.users previous_user on previous_user.id=e.previous_assigned_to
    left join core.users new_user on new_user.id=e.new_assigned_to
    left join core.users actor_user on actor_user.id=e.actor_id
    left join core.users current_assignee on current_assignee.id=l.assigned_to
    left join core.branches previous_branch on previous_branch.code=e.previous_branch_code
    left join core.branches new_branch on new_branch.code=e.new_branch_code
    left join core.departments previous_department on previous_department.code=e.previous_department_code
    left join core.departments new_department on new_department.code=e.new_department_code
    where (${leadId || null}::uuid is null or e.lead_id=${leadId || null}::uuid)
      and (
        ${scope.all}::boolean
        or e.previous_assigned_to=${user.id}::uuid
        or e.new_assigned_to=${user.id}::uuid
        or l.assigned_to=${user.id}::uuid
        or (
          l.department_code=any(${scope.departmentCodes}::text[])
          and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[]))
        )
      )
      and (${mode !== "transferred"}::boolean or e.previous_assigned_to is not null and e.previous_assigned_to is distinct from e.new_assigned_to)
    order by e.created_at desc, e.id desc
    limit 500
  `;

  return response.status(200).json({ ok: true, rows });
}
