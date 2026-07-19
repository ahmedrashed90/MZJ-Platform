import type { VercelRequest,VercelResponse } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { hasPermission,isSystemAdmin } from "../_auth.js";
import { clean,permittedLocationIds } from "../_operations-auth.js";
import { getSql } from "../_db.js";
import { pageParams } from "./common.js";

export async function allVehiclesReport(request:VercelRequest,response:VercelResponse,user:SessionUser) {
  const sql=getSql(); const allowed=await permittedLocationIds(user); const all=isSystemAdmin(user);
  const search=clean(request.query.search),locationId=clean(request.query.locationId),statusCode=clean(request.query.statusCode),modelYear=clean(request.query.modelYear);
  const minCount=Math.max(1,Number(request.query.minCount || 1)); const pattern=`%${search}%`; const {page,pageSize,offset}=pageParams(request.query as Record<string,unknown>,40,200);
  const [countRow]=await sql<{total:number}[]>`
    select count(*)::int as total from (
      select 1 from operations.vehicles v left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses st on st.code=v.status_code
      where coalesce(v.is_deleted,false)=false and v.archived_at is null and coalesce(st.counts_in_inventory,true)=true
        and (${all} or v.location_id=any(${allowed}::uuid[])) and (${locationId}='' or v.location_id=${locationId || null}::uuid)
        and (${statusCode}='' or v.status_code=${statusCode}) and (${modelYear}='' or coalesce(v.model_year,'')=${modelYear})
        and (${search}='' or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern})
      group by v.car_name,v.statement,v.model_year,l.name,st.name,v.status_code having count(*)>=${minCount}
    ) g
  `;
  const rows=await sql<any[]>`
    select coalesce(v.car_name,'—') as car_name,coalesce(v.statement,'—') as statement,coalesce(v.model_year,'—') as model_year,
      coalesce(l.name,'—') as location_name,coalesce(st.name,v.status_code,'—') as status_name,count(*)::int as total
    from operations.vehicles v left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses st on st.code=v.status_code
    where coalesce(v.is_deleted,false)=false and v.archived_at is null and coalesce(st.counts_in_inventory,true)=true
      and (${all} or v.location_id=any(${allowed}::uuid[])) and (${locationId}='' or v.location_id=${locationId || null}::uuid)
      and (${statusCode}='' or v.status_code=${statusCode}) and (${modelYear}='' or coalesce(v.model_year,'')=${modelYear})
      and (${search}='' or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern})
    group by v.car_name,v.statement,v.model_year,l.name,st.name,v.status_code having count(*)>=${minCount}
    order by v.car_name,v.statement,v.model_year,l.name,st.name limit ${pageSize} offset ${offset}
  `;
  const total=Number(countRow?.total || 0); return response.status(200).json({ok:true,rows,pagination:{page,pageSize,total,pages:Math.max(1,Math.ceil(total/pageSize))}});
}

export async function auditReport(request:VercelRequest,response:VercelResponse,user:SessionUser) {
  if (!hasPermission(user,"operations.audit.view")) return response.status(403).json({ok:false,error:"ليس لديك صلاحية عرض سجل التدقيق"});
  const sql=getSql(); const {page,pageSize,offset}=pageParams(request.query as Record<string,unknown>,50,200); const search=clean(request.query.search),action=clean(request.query.action),entityType=clean(request.query.entityType); const pattern=`%${search}%`;
  const [countRow]=await sql<{total:number}[]>`select count(*)::int as total from operations.audit_events where (${action}='' or action=${action}) and (${entityType}='' or entity_type=${entityType}) and (${search}='' or coalesce(actor_name,'') ilike ${pattern} or coalesce(entity_id,'') ilike ${pattern} or coalesce(reason,'') ilike ${pattern})`;
  const rows=await sql<any[]>`select id::text,actor_name,actor_role,actor_branch,page_code,action,entity_type,entity_id,reason,is_override,created_at from operations.audit_events where (${action}='' or action=${action}) and (${entityType}='' or entity_type=${entityType}) and (${search}='' or coalesce(actor_name,'') ilike ${pattern} or coalesce(entity_id,'') ilike ${pattern} or coalesce(reason,'') ilike ${pattern}) order by created_at desc limit ${pageSize} offset ${offset}`;
  const total=Number(countRow?.total || 0); return response.status(200).json({ok:true,rows,pagination:{page,pageSize,total,pages:Math.max(1,Math.ceil(total/pageSize))}});
}

export async function trackingDetails(request:VercelRequest,response:VercelResponse,user:SessionUser) {
  if (!hasPermission(user,"operations.tracking.view")) return response.status(403).json({ok:false,error:"ليس لديك صلاحية عرض حالة التراكينج"});
  const vehicleId=clean(request.query.vehicleId); if (!vehicleId) return response.status(400).json({ok:false,error:"معرف السيارة مطلوب"});
  const sql=getSql(); const allowed=await permittedLocationIds(user); const all=isSystemAdmin(user);
  const [vehicle]=await sql<any[]>`select id::text,vin,location_id::text from operations.vehicles where id=${vehicleId}::uuid and coalesce(is_deleted,false)=false and (${all} or location_id=any(${allowed}::uuid[]))`;
  if (!vehicle) return response.status(404).json({ok:false,error:"السيارة غير موجودة أو خارج نطاق صلاحيتك"});
  const rows=await sql<any[]>`select tracking_order_id::text,tracking_vehicle_id::text,request_no,status,progress,current_stage,created_at,updated_at,completed_at,is_deleted,is_cancelled,is_rejected,is_archived from operations.tracking_vehicle_read_model where vehicle_id=${vehicleId}::uuid order by updated_at desc`;
  return response.status(200).json({ok:true,vehicle,requests:rows,canOpen:hasPermission(user,"operations.tracking.open"),openPath:hasPermission(user,"operations.tracking.open")?"/tracking":null});
}
