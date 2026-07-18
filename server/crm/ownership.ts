import type { VercelRequest,VercelResponse } from "@vercel/node";
import { clean,requireCrmPermission, requireCrmUser,userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";
export default async function handler(request:VercelRequest,response:VercelResponse){
  const user=await requireCrmUser(request,response);if(!user)return;if(!(await requireCrmPermission(user,response,"crm.ownership.view")))return;if(request.method!=="GET")return response.status(405).json({ok:false,error:"Method not allowed"});
  const sql=getSql(),scope=userScope(user),leadId=clean(request.query.leadId),mode=clean(request.query.mode);
  const rows=await sql<any[]>`
    select e.*,e.id::text,e.contact_id::text,e.service_request_id::text,e.lead_id::text,e.previous_assigned_to::text,e.new_assigned_to::text,e.actor_id::text,
      l.customer_name,l.phone,l.status_label,l.department_code,l.branch_code,current_user.full_name as current_assigned_name
    from crm.ownership_events e left join crm.leads l on l.id=e.lead_id left join core.users current_user on current_user.id=l.assigned_to
    where (${leadId||null}::uuid is null or e.lead_id=${leadId||null}::uuid)
      and (${scope.all} or e.previous_assigned_to=${user.id}::uuid or e.new_assigned_to=${user.id}::uuid or l.assigned_to=${user.id}::uuid)
      and (${mode !== 'moved_from_me'}::boolean or e.previous_assigned_to=${user.id}::uuid)
    order by e.created_at desc limit 300
  `;
  return response.status(200).json({ok:true,rows});
}
