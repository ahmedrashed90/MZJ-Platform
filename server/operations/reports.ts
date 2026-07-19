import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { canAccessAllOperationsBranches, requireOperationsUser } from "../_operations-auth.js";
import { clean, handleOperationsError, integer } from "../_operations-utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    await ensureOperationsSchema();
    const user = await requireOperationsUser(request, response, "operations.vehicles.view");
    if (!user) return;
    if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
    const sql = getSql();
    const carName = clean(request.query.carName);
    const statement = clean(request.query.statement);
    const modelYear = clean(request.query.modelYear);
    const locationId = clean(request.query.locationId);
    const statusCode = clean(request.query.statusCode);
    const minCount = integer(request.query.minCount, 0, 0, 100000);
    const branches = user.branchCodes;
  const allBranches = canAccessAllOperationsBranches(user);
    const rows = await sql<any[]>`
      select coalesce(v.car_name,'—') as car_name,coalesce(v.statement,'—') as statement,coalesce(v.model_year,'—') as model_year,
        l.id::text as location_id,coalesce(l.name,'—') as location_name,v.status_code,coalesce(s.name,v.status_code) as status_name,count(*)::int as total
      from operations.vehicles v left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code
      where v.is_deleted=false and v.is_archived=false and coalesce(s.is_inventory,true)=true
        and (${allBranches} or coalesce(v.branch_code,'')=any(${branches}::text[]))
        and (${carName}='' or v.car_name=${carName}) and (${statement}='' or v.statement=${statement})
        and (${modelYear}='' or v.model_year=${modelYear}) and (${locationId}='' or v.location_id=${locationId || null}::uuid)
        and (${statusCode}='' or v.status_code=${statusCode})
      group by v.car_name,v.statement,v.model_year,l.id,l.name,v.status_code,s.name
      having count(*) >= ${minCount}
      order by count(*) desc,v.car_name,v.statement,v.model_year,l.name,s.name
    `;
    const totals = await sql<any[]>`
      select coalesce(s.name,v.status_code) as label,count(*)::int as total
      from operations.vehicles v left join operations.vehicle_statuses s on s.code=v.status_code
      where v.is_deleted=false and v.is_archived=false and coalesce(s.is_inventory,true)=true and (${allBranches} or coalesce(v.branch_code,'')=any(${branches}::text[]))
      group by s.name,v.status_code order by count(*) desc
    `;
    return response.status(200).json({ ok: true, rows, totals });
  } catch (error) { return handleOperationsError(response, error); }
}
