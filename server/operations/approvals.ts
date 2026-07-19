import type { VercelRequest,VercelResponse } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { hasPermission,isSystemAdmin } from "../_auth.js";
import { bodyOf,clean,permittedLocationIds } from "../_operations-auth.js";
import { getSql } from "../_db.js";
import { audit,OperationsError,outbox,pageParams,stringOrNull } from "./common.js";
import { UNDER_DELIVERY_STATUS } from "./approval-flow.js";

function approvalFilter(value: unknown) {
  const filter=clean(value);
  return ["all","missing_financial","missing_administrative","completed"].includes(filter) ? filter : "all";
}

export async function listApprovals(request:VercelRequest,response:VercelResponse,user:SessionUser) {
  const sql=getSql();
  const allowed=await permittedLocationIds(user);
  const all=isSystemAdmin(user);
  const search=clean(request.query.search);
  const filter=approvalFilter(request.query.filter);
  const pattern=`%${search}%`;
  const vinPattern=`%${search.replace(/\s+/g,"").toUpperCase()}%`;
  const {page,pageSize,offset}=pageParams(request.query as Record<string,unknown>,30,100);
  const [summary]=await sql<{total:number;missing_financial:number;missing_administrative:number;completed:number}[]>`
    select count(v.id)::int as total,
      count(v.id) filter (where coalesce(a.financial_approved,false)=false)::int as missing_financial,
      count(v.id) filter (where coalesce(a.administrative_approved,false)=false)::int as missing_administrative,
      count(v.id) filter (where coalesce(a.financial_approved,false)=true and coalesce(a.administrative_approved,false)=true)::int as completed
    from operations.vehicles v left join operations.vehicle_approvals a on a.vehicle_id=v.id
    where coalesce(v.is_deleted,false)=false and v.archived_at is null and v.status_code=${UNDER_DELIVERY_STATUS}
      and (${all} or v.location_id=any(${allowed}::uuid[]))
  `;
  const [countRow]=await sql<{total:number}[]>`
    select count(*)::int as total
    from operations.vehicles v
    left join operations.vehicle_approvals a on a.vehicle_id=v.id
    where coalesce(v.is_deleted,false)=false and v.archived_at is null and v.status_code=${UNDER_DELIVERY_STATUS}
      and (${all} or v.location_id=any(${allowed}::uuid[]))
      and (${search}='' or upper(regexp_replace(v.vin,'\\s+','','g')) like ${vinPattern}
        or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern})
      and (
        ${filter}='all'
        or (${filter}='missing_financial' and coalesce(a.financial_approved,false)=false)
        or (${filter}='missing_administrative' and coalesce(a.administrative_approved,false)=false)
        or (${filter}='completed' and coalesce(a.financial_approved,false)=true and coalesce(a.administrative_approved,false)=true)
      )
  `;
  const rows=await sql<any[]>`
    select v.id::text,v.vin,v.car_name,v.statement,v.location_id::text,l.name as location_name,v.status_code,st.name as status_name,
      coalesce(a.financial_approved,false) as financial_approved,coalesce(a.administrative_approved,false) as administrative_approved,
      a.financial_note,a.administrative_note,a.financial_approved_at,a.administrative_approved_at,a.financial_revoked_at,a.administrative_revoked_at,
      a.cycle_no,fu.full_name as financial_approved_by_name,au.full_name as administrative_approved_by_name,
      fru.full_name as financial_revoked_by_name,aru.full_name as administrative_revoked_by_name,v.updated_at,v.version
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.vehicle_statuses st on st.code=v.status_code
    left join operations.vehicle_approvals a on a.vehicle_id=v.id
    left join core.users fu on fu.id=a.financial_approved_by left join core.users au on au.id=a.administrative_approved_by
    left join core.users fru on fru.id=a.financial_revoked_by left join core.users aru on aru.id=a.administrative_revoked_by
    where coalesce(v.is_deleted,false)=false and v.archived_at is null and v.status_code=${UNDER_DELIVERY_STATUS}
      and (${all} or v.location_id=any(${allowed}::uuid[]))
      and (${search}='' or upper(regexp_replace(v.vin,'\\s+','','g')) like ${vinPattern}
        or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern})
      and (
        ${filter}='all'
        or (${filter}='missing_financial' and coalesce(a.financial_approved,false)=false)
        or (${filter}='missing_administrative' and coalesce(a.administrative_approved,false)=false)
        or (${filter}='completed' and coalesce(a.financial_approved,false)=true and coalesce(a.administrative_approved,false)=true)
      )
    order by
      case when coalesce(a.financial_approved,false)=false or coalesce(a.administrative_approved,false)=false then 0 else 1 end,
      v.updated_at desc,v.vin
    limit ${pageSize} offset ${offset}
  `;
  const total=Number(countRow?.total || 0);
  return response.status(200).json({ok:true,vehicles:rows,pagination:{page,pageSize,total,pages:Math.max(1,Math.ceil(total/pageSize))},filter,summary:{total:Number(summary?.total||0),missingFinancial:Number(summary?.missing_financial||0),missingAdministrative:Number(summary?.missing_administrative||0),completed:Number(summary?.completed||0)}});
}

export async function getApproval(request:VercelRequest,response:VercelResponse,user:SessionUser) {
  const vehicleId=clean(request.query.id);
  if (!vehicleId) return response.status(400).json({ok:false,error:"معرف السيارة مطلوب"});
  const sql=getSql();
  const allowed=await permittedLocationIds(user);
  const all=isSystemAdmin(user);
  const [vehicle]=await sql<any[]>`
    select v.id::text,v.vin,v.car_name,v.statement,v.location_id::text,l.name as location_name,v.status_code,st.name as status_name,
      coalesce(a.financial_approved,false) as financial_approved,coalesce(a.administrative_approved,false) as administrative_approved,
      a.financial_note,a.administrative_note,a.financial_approved_at,a.administrative_approved_at,a.financial_revoked_at,a.administrative_revoked_at,
      a.cycle_no,fu.full_name as financial_approved_by_name,au.full_name as administrative_approved_by_name,
      fru.full_name as financial_revoked_by_name,aru.full_name as administrative_revoked_by_name,v.updated_at,v.version
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses st on st.code=v.status_code
    left join operations.vehicle_approvals a on a.vehicle_id=v.id
    left join core.users fu on fu.id=a.financial_approved_by left join core.users au on au.id=a.administrative_approved_by
    left join core.users fru on fru.id=a.financial_revoked_by left join core.users aru on aru.id=a.administrative_revoked_by
    where v.id=${vehicleId}::uuid and coalesce(v.is_deleted,false)=false and v.archived_at is null
      and v.status_code=${UNDER_DELIVERY_STATUS} and (${all} or v.location_id=any(${allowed}::uuid[]))
  `;
  if (!vehicle) return response.status(404).json({ok:false,error:"السيارة غير موجودة في حالة «مباع تحت التسليم» أو خارج نطاق صلاحيتك"});
  const history=await sql<any[]>`
    select h.id::text,h.approval_type,h.action,h.performer_name,h.performer_role,h.performer_branch,h.note,h.before_data,h.after_data,h.cycle_no,h.created_at
    from operations.vehicle_approval_history h where h.vehicle_id=${vehicleId}::uuid order by h.created_at desc,h.id desc limit 300
  `;
  return response.status(200).json({ok:true,vehicle:{...vehicle,history}});
}

export async function updateApproval(request:VercelRequest,response:VercelResponse,user:SessionUser) {
  const body=bodyOf(request);
  const vehicleId=clean(body.vehicleId);
  const type=clean(body.approvalType);
  const action=clean(body.action);
  const note=stringOrNull(body.note);
  if (!vehicleId || !["financial","administrative"].includes(type) || !["approve","revoke","note"].includes(action)) {
    return response.status(400).json({ok:false,error:"بيانات الموافقة غير مكتملة"});
  }
  const typePermission=type==="financial"?"operations.approvals.financial":"operations.approvals.administrative";
  if (action==="approve" && !hasPermission(user,typePermission)) return response.status(403).json({ok:false,error:"ليس لديك صلاحية تنفيذ هذه الموافقة"});
  if (action==="revoke" && (!hasPermission(user,typePermission) || !hasPermission(user,"operations.approvals.revert"))) return response.status(403).json({ok:false,error:"ليس لديك صلاحية التراجع عن هذه الموافقة"});
  if (action==="note" && !hasPermission(user,"operations.approvals.notes")) return response.status(403).json({ok:false,error:"ليس لديك صلاحية تعديل ملاحظات الموافقات"});
  if (action==="revoke" && !note) return response.status(400).json({ok:false,error:"سبب التراجع عن الموافقة مطلوب"});
  const sql=getSql();
  try {
    const result=await sql.begin(async(tx)=>{
      const allowed=await permittedLocationIds(user);
      const [vehicle]=await tx<any[]>`
        select v.*,v.id::text,l.name as location_name
        from operations.vehicles v left join operations.locations l on l.id=v.location_id
        where v.id=${vehicleId}::uuid and coalesce(v.is_deleted,false)=false for update of v
      `;
      if (!vehicle) throw new OperationsError(404,"NOT_FOUND","السيارة غير موجودة");
      if (!isSystemAdmin(user) && !allowed.includes(String(vehicle.location_id))) throw new OperationsError(403,"SCOPE","السيارة خارج نطاق صلاحيتك");
      if (vehicle.status_code!==UNDER_DELIVERY_STATUS) throw new OperationsError(400,"STATUS","الموافقات متاحة فقط للسيارات الموجودة في حالة «مباع تحت التسليم»");
      await tx`insert into operations.vehicle_approvals(vehicle_id,cycle_no) values (${vehicleId}::uuid,1) on conflict(vehicle_id) do nothing`;
      const [before]=await tx<any[]>`select * from operations.vehicle_approvals where vehicle_id=${vehicleId}::uuid for update`;
      const flag=type==="financial"?Boolean(before.financial_approved):Boolean(before.administrative_approved);
      const currentNote=type==="financial"?stringOrNull(before.financial_note):stringOrNull(before.administrative_note);
      if (action==="approve" && note!==currentNote && !hasPermission(user,"operations.approvals.notes")) throw new OperationsError(403,"NOTE_PERMISSION","ليس لديك صلاحية تعديل ملاحظة الموافقة");
      if (action==="approve" && flag) throw new OperationsError(409,"ALREADY_APPROVED","تم تنفيذ هذه الموافقة من قبل");
      if (action==="revoke" && !flag) throw new OperationsError(409,"NOT_APPROVED","لا توجد موافقة مكتملة للتراجع عنها");

      if (type==="financial" && action==="approve") {
        await tx`update operations.vehicle_approvals set financial_approved=true,financial_approved_by=${user.id}::uuid,financial_approved_at=now(),
          financial_note=coalesce(${note},financial_note),financial_revoked_by=null,financial_revoked_at=null,updated_at=now() where vehicle_id=${vehicleId}::uuid`;
      } else if (type==="administrative" && action==="approve") {
        await tx`update operations.vehicle_approvals set administrative_approved=true,administrative_approved_by=${user.id}::uuid,administrative_approved_at=now(),
          administrative_note=coalesce(${note},administrative_note),administrative_revoked_by=null,administrative_revoked_at=null,updated_at=now() where vehicle_id=${vehicleId}::uuid`;
      } else if (type==="financial" && action==="revoke") {
        await tx`update operations.vehicle_approvals set financial_approved=false,financial_approved_by=null,financial_approved_at=null,
          financial_note=${note},financial_revoked_by=${user.id}::uuid,financial_revoked_at=now(),updated_at=now() where vehicle_id=${vehicleId}::uuid`;
      } else if (type==="administrative" && action==="revoke") {
        await tx`update operations.vehicle_approvals set administrative_approved=false,administrative_approved_by=null,administrative_approved_at=null,
          administrative_note=${note},administrative_revoked_by=${user.id}::uuid,administrative_revoked_at=now(),updated_at=now() where vehicle_id=${vehicleId}::uuid`;
      } else if (type==="financial") {
        await tx`update operations.vehicle_approvals set financial_note=${note},updated_at=now() where vehicle_id=${vehicleId}::uuid`;
      } else {
        await tx`update operations.vehicle_approvals set administrative_note=${note},updated_at=now() where vehicle_id=${vehicleId}::uuid`;
      }

      const [after]=await tx<any[]>`select * from operations.vehicle_approvals where vehicle_id=${vehicleId}::uuid`;
      const historyAction=action==="approve"?"approved":action==="revoke"?"revoked":"note_updated";
      await tx`
        insert into operations.vehicle_approval_history(vehicle_id,approval_type,action,performed_by,performer_name,performer_role,performer_branch,note,before_data,after_data,cycle_no)
        values (${vehicleId}::uuid,${type},${historyAction},${user.id}::uuid,${user.fullName},${user.roles[0] || user.roleCodes[0] || null},
          ${user.branches[0] || user.branchCodes[0] || null},${note},${tx.json(before || {})},${tx.json(after || {})},${Number(after.cycle_no || 0)})
      `;
      const auditAction=action==="approve"?"vehicle.approval_granted":action==="revoke"?"vehicle.approval_reversed":"vehicle.approval_note_updated";
      await audit(tx,request,user,{pageCode:"operations.approvals",action:auditAction,entityType:"vehicle",entityId:vehicleId,beforeData:before,afterData:after,reason:note});
      await outbox(tx,user,{eventType:`operations.${auditAction}`,entityType:"vehicle",entityId:vehicleId,vehicleId,vin:vehicle.vin,
        title:action==="approve"?"تم اعتماد سيارة":action==="revoke"?"تم التراجع عن اعتماد سيارة":"تم تحديث ملاحظة موافقة",
        description:`${type==='financial'?'الموافقة المالية':'الموافقة الإدارية'} — ${vehicle.vin}`,internalPath:`/operations/approvals?vehicle=${vehicleId}`,
        metadata:{approvalType:type,action,cycleNo:after.cycle_no}});
      return after;
    });
    const message=action==="approve"?"تم تسجيل الموافقة":action==="revoke"?"تم تسجيل التراجع مع الاحتفاظ بالسجل السابق":"تم حفظ ملاحظة الموافقة دون تغيير حالة الاعتماد";
    return response.status(200).json({ok:true,approval:result,message});
  } catch(error:any) {
    if (error instanceof OperationsError) return response.status(error.status).json({ok:false,error:error.message,code:error.code});
    console.error("Approval failed",error);
    return response.status(500).json({ok:false,error:"تعذر حفظ الموافقة"});
  }
}
export async function archiveVehicle(request:VercelRequest,response:VercelResponse,user:SessionUser) {
  if (!hasPermission(user,"operations.archive")) return response.status(403).json({ok:false,error:"ليس لديك صلاحية الأرشفة"});
  const body=bodyOf(request); const vehicleId=clean(body.vehicleId); const reason=stringOrNull(body.reason);
  if (!vehicleId || !reason) return response.status(400).json({ok:false,error:"السيارة وسبب الأرشفة مطلوبان"});
  const sql=getSql();
  try {
    const archived=await sql.begin(async(tx)=>{
      const allowed=await permittedLocationIds(user);
      const [vehicle]=await tx<any[]>`
        select v.*,v.id::text,l.name as location_name,st.name as status_name,st.is_final,
          coalesce(a.financial_approved,false) as financial_approved,coalesce(a.administrative_approved,false) as administrative_approved,
          tr.tracking_order_id::text,tr.request_no as tracking_order_no,tr.status as tracking_status,tr.progress as tracking_progress,
          tr.is_deleted as tracking_deleted,tr.is_cancelled as tracking_cancelled,tr.is_rejected as tracking_rejected,tr.is_archived as tracking_archived
        from operations.vehicles v left join operations.locations l on l.id=v.location_id
        left join operations.vehicle_statuses st on st.code=v.status_code left join operations.vehicle_approvals a on a.vehicle_id=v.id
        left join operations.tracking_vehicle_read_model tr on tr.vehicle_id=v.id and tr.display_rank=1
        where v.id=${vehicleId}::uuid and coalesce(v.is_deleted,false)=false for update of v
      `;
      if (!vehicle) throw new OperationsError(404,"NOT_FOUND","السيارة غير موجودة");
      if (!isSystemAdmin(user) && !allowed.includes(String(vehicle.location_id))) throw new OperationsError(403,"SCOPE","السيارة خارج نطاق صلاحيتك");
      if (vehicle.archived_at) throw new OperationsError(400,"ALREADY","السيارة مؤرشفة بالفعل");
      if (!vehicle.is_final || vehicle.status_code!=="delivered") throw new OperationsError(400,"FINAL","لا يمكن الأرشفة قبل وصول السيارة إلى «مباع تم التسليم»");
      if (!vehicle.financial_approved || !vehicle.administrative_approved) throw new OperationsError(400,"APPROVALS","لا يمكن الأرشفة قبل اكتمال الموافقة المالية والإدارية");
      const [movement]=await tx<{count:number}[]>`select count(*)::int as count from operations.movements where vehicle_id=${vehicleId}::uuid`;
      if (Number(movement?.count || 0)<1) throw new OperationsError(400,"MOVEMENT","لا يمكن الأرشفة بدون حركة واحدة على الأقل");
      const [activeRequest]=await tx<any[]>`select r.request_no from operations.vehicle_request_locks l join operations.transfer_requests r on r.id=l.request_id where l.vehicle_id=${vehicleId}::uuid limit 1`;
      if (activeRequest) throw new OperationsError(409,"ACTIVE_REQUEST",`لا يمكن الأرشفة لوجود طلب نشط ${activeRequest.request_no}`);
      if (!vehicle.tracking_order_id) throw new OperationsError(400,"TRACKING_NONE","لا يمكن الأرشفة لأن السيارة لا تحتوي على طلب تراكينج مرتبط");
      if (vehicle.tracking_deleted) throw new OperationsError(400,"TRACKING_DELETED","لا يمكن الأرشفة لأن طلب التراكينج محذوف");
      if (vehicle.tracking_cancelled) throw new OperationsError(400,"TRACKING_CANCELLED","لا يمكن الأرشفة لأن طلب التراكينج ملغي");
      if (vehicle.tracking_rejected) throw new OperationsError(400,"TRACKING_REJECTED","لا يمكن الأرشفة لأن طلب التراكينج مرفوض");
      if (Number(vehicle.tracking_progress)!==100 && vehicle.tracking_status!=="completed" && !vehicle.tracking_archived) throw new OperationsError(400,"TRACKING_PROGRESS","لا يمكن الأرشفة لأن طلب التراكينج لم يصل إلى 100%");
      const snapshot={...vehicle,archivedBy:user.fullName,archiveReason:reason};
      const [row]=await tx<any[]>`
        insert into operations.vehicle_archives(vehicle_id,archived_by,archived_by_name,reason,tracking_order_id,snapshot)
        values (${vehicleId}::uuid,${user.id}::uuid,${user.fullName},${reason},${vehicle.tracking_order_id}::uuid,${tx.json(snapshot)})
        returning id::text,archived_at
      `;
      await tx`update operations.vehicles set archived_at=now(),archived_by=${user.id}::uuid,archive_reason=${reason},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${vehicleId}::uuid`;
      await audit(tx,request,user,{pageCode:"operations.archive",action:"vehicle.archived",entityType:"vehicle",entityId:vehicleId,beforeData:vehicle,afterData:{...snapshot,archiveId:row.id},reason});
      await outbox(tx,user,{eventType:"operations.vehicle.archived",entityType:"vehicle",entityId:vehicleId,vehicleId,vin:vehicle.vin,title:"تمت أرشفة سيارة",description:`${vehicle.vin} — ${reason}`,internalPath:`/operations/archive?vehicle=${vehicleId}`,metadata:{trackingOrderId:vehicle.tracking_order_id,trackingProgress:vehicle.tracking_progress}});
      return row;
    });
    return response.status(200).json({ok:true,archive:archived,message:"تمت أرشفة السيارة منطقيًا مع الاحتفاظ بكل بياناتها"});
  } catch(error:any) {
    if (error instanceof OperationsError) return response.status(error.status).json({ok:false,error:error.message,code:error.code});
    console.error("Archive failed",error); return response.status(500).json({ok:false,error:"تعذر أرشفة السيارة. لم يتم تغيير حالتها"});
  }
}
