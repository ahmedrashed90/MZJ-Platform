import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { hasPermission, isSystemAdmin, requestIp } from "../_auth.js";
import { bodyOf, clean, permittedBranchIds, permittedLocationIds } from "../_operations-auth.js";
import { getSql } from "../_db.js";
import { audit, nextStage, OperationsError, outbox, pageParams, REQUEST_STAGES, STAGE_PERMISSIONS, stringArray, stringOrNull } from "./common.js";
import { applyApprovalStatusTransition,assertApprovalStatusTransition } from "./approval-flow.js";

function canViewTab(user: SessionUser, tab: string) {
  if (isSystemAdmin(user)) return true;
  if (tab === "outgoing") return hasPermission(user,"operations.requests.view_outgoing");
  if (tab === "incoming") return hasPermission(user,"operations.requests.view_incoming");
  if (["completed","cancelled"].includes(tab)) return hasPermission(user,"operations.requests.view_outgoing") || hasPermission(user,"operations.requests.view_incoming");
  return hasPermission(user,"operations.requests.view_all");
}

export async function listRequests(request: VercelRequest,response: VercelResponse,user: SessionUser) {
  const tab=clean(request.query.tab || request.query.state) || "outgoing";
  if (!canViewTab(user,tab)) return response.status(403).json({ok:false,error:"ليس لديك صلاحية عرض هذا التبويب"});
  const sql=getSql();
  const branches=await permittedBranchIds(user);
  const all=isSystemAdmin(user) || (tab==="all" && hasPermission(user,"operations.requests.view_all"));
  const search=clean(request.query.search);
  const requestType=clean(request.query.requestType);
  const pattern=`%${search}%`;
  const {page,pageSize,offset}=pageParams(request.query as Record<string,unknown>,30,100);
  const tabCondition=(tab==="outgoing"?"outgoing":tab==="incoming"?"incoming":tab==="completed"?"completed":tab==="cancelled"?"cancelled":"all");
  const [countRow]=await sql<{total:number}[]>`
    select count(*)::int as total
    from operations.transfer_requests r
    where r.deleted_at is null
      and (${all} or (${tabCondition}='outgoing' and r.source_branch_id=any(${branches}::uuid[]))
        or (${tabCondition}='incoming' and r.destination_branch_id=any(${branches}::uuid[]))
        or (${tabCondition} in ('completed','cancelled') and (r.source_branch_id=any(${branches}::uuid[]) or r.destination_branch_id=any(${branches}::uuid[]))))
      and ((${tabCondition}='completed' and r.status='completed') or (${tabCondition}='cancelled' and r.status='cancelled')
        or (${tabCondition} in ('outgoing','incoming') and r.status not in ('completed','cancelled')) or ${tabCondition}='all')
      and (${requestType}='' or r.transfer_type=${requestType})
      and (${search}='' or r.request_no ilike ${pattern} or coalesce(r.notes,'') ilike ${pattern} or exists(
        select 1 from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id
        where rv.transfer_request_id=r.id and (v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern})
      ))
  `;
  const rows=await sql<any[]>`
    select r.id::text,r.request_no,r.transfer_type,r.status,r.photography_date,r.target_status_code,ts.name as target_status_name,r.notes,
      r.source_location_id::text,sl.name as source_location_name,r.destination_location_id::text,dl.name as destination_location_name,
      r.source_branch_id::text,sb.name as source_branch_name,r.destination_branch_id::text,db.name as destination_branch_name,
      r.requested_by::text,u.full_name as requested_by_name,r.requested_at,r.updated_at,r.completed_at,r.cancelled_at,r.cancellation_reason,
      r.version,r.started_at,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',v.id::text,'vin',v.vin,'carName',v.car_name,'statement',v.statement,'modelYear',v.model_year,
        'currentLocationName',cl.name,'currentLocationId',rv.current_location_id::text,'currentStatusCode',rv.current_status_code,
        'receivedLocationName',rl.name,'receivedStatusCode',rv.received_status_code,'notes',rv.notes
      ) order by v.vin)
        from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id
        left join operations.locations cl on cl.id=rv.current_location_id left join operations.locations rl on rl.id=rv.received_location_id
        where rv.transfer_request_id=r.id),'[]'::jsonb) as vehicles,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',e.id::text,'stageCode',e.stage_code,'action',e.action,'performerName',e.performer_name,
        'performerRole',e.performer_role,'performerBranch',e.performer_branch,'note',e.note,'createdAt',e.created_at,
        'isOverride',e.is_override,'overrideReason',e.override_reason
      ) order by e.created_at,e.id)
        from operations.request_stage_events e where e.request_id=r.id),'[]'::jsonb) as events
    from operations.transfer_requests r
    left join operations.locations sl on sl.id=r.source_location_id left join operations.locations dl on dl.id=r.destination_location_id
    left join core.branches sb on sb.id=r.source_branch_id left join core.branches db on db.id=r.destination_branch_id
    left join operations.vehicle_statuses ts on ts.code=r.target_status_code left join core.users u on u.id=r.requested_by
    where r.deleted_at is null
      and (${all} or (${tabCondition}='outgoing' and r.source_branch_id=any(${branches}::uuid[]))
        or (${tabCondition}='incoming' and r.destination_branch_id=any(${branches}::uuid[]))
        or (${tabCondition} in ('completed','cancelled') and (r.source_branch_id=any(${branches}::uuid[]) or r.destination_branch_id=any(${branches}::uuid[]))))
      and ((${tabCondition}='completed' and r.status='completed') or (${tabCondition}='cancelled' and r.status='cancelled')
        or (${tabCondition} in ('outgoing','incoming') and r.status not in ('completed','cancelled')) or ${tabCondition}='all')
      and (${requestType}='' or r.transfer_type=${requestType})
      and (${search}='' or r.request_no ilike ${pattern} or coalesce(r.notes,'') ilike ${pattern} or exists(
        select 1 from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id
        where rv.transfer_request_id=r.id and (v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern})
      ))
    order by r.updated_at desc,r.requested_at desc limit ${pageSize} offset ${offset}
  `;
  const total=Number(countRow?.total || 0);
  return response.status(200).json({ok:true,requests:rows,pagination:{page,pageSize,total,pages:Math.max(1,Math.ceil(total/pageSize))}});
}

export async function createRequest(request: VercelRequest,response: VercelResponse,user: SessionUser) {
  if (!hasPermission(user,"operations.requests.create")) return response.status(403).json({ok:false,error:"ليس لديك صلاحية إنشاء الطلبات"});
  const body=bodyOf(request);
  const vehicleIds=stringArray(body.vehicleIds);
  const requestType=clean(body.requestType);
  const destinationLocationId=clean(body.destinationLocationId) || null;
  const targetStatusCode=clean(body.targetStatusCode) || null;
  const photographyDate=clean(body.photographyDate) || null;
  if (!vehicleIds.length) return response.status(400).json({ok:false,error:"اختر سيارة واحدة على الأقل"});
  if (!["transfer","photography"].includes(requestType)) return response.status(400).json({ok:false,error:"نوع الطلب غير صحيح"});
  if (requestType==="transfer" && !destinationLocationId) return response.status(400).json({ok:false,error:"المكان المستهدف مطلوب في طلب النقل"});
  if (requestType==="photography" && !photographyDate) return response.status(400).json({ok:false,error:"تاريخ التصوير مطلوب"});
  const sql=getSql();
  try {
    const created=await sql.begin(async(tx)=>{
      const allowedLocations=await permittedLocationIds(user);
      const vehicles=await tx<any[]>`
        select v.*,v.id::text,l.name as location_name,l.branch_id::text as branch_id,b.name as branch_name
        from operations.vehicles v left join operations.locations l on l.id=v.location_id left join core.branches b on b.id=l.branch_id
        where v.id=any(${vehicleIds}::uuid[]) and coalesce(v.is_deleted,false)=false order by v.id for update of v
      `;
      if (vehicles.length!==vehicleIds.length) throw new OperationsError(404,"VEHICLES","بعض السيارات غير موجودة");
      const sourceLocations=[...new Set(vehicles.map((v:any)=>String(v.location_id || "")).filter(Boolean))];
      const sourceBranches=[...new Set(vehicles.map((v:any)=>String(v.branch_id || "")).filter(Boolean))];
      if (sourceBranches.length!==1) throw new OperationsError(400,"SOURCE_BRANCH","يجب أن تكون سيارات الطلب الواحد من فرع مصدر واحد. أنشئ طلبًا مستقلًا لكل فرع");
      if (!isSystemAdmin(user) && vehicles.some((v:any)=>!allowedLocations.includes(String(v.location_id)))) throw new OperationsError(403,"SCOPE","يمكنك اختيار سيارات الفروع والمواقع المرتبطة بك فقط");
      if (vehicles.some((v:any)=>v.archived_at)) throw new OperationsError(400,"ARCHIVED","لا يمكن إنشاء طلب لسيارة مؤرشفة");
      const existingLocks=await tx<any[]>`
        select v.vin,r.request_no from operations.vehicle_request_locks l join operations.vehicles v on v.id=l.vehicle_id
        join operations.transfer_requests r on r.id=l.request_id where l.vehicle_id=any(${vehicleIds}::uuid[])
      `;
      if (existingLocks.length) throw new OperationsError(409,"CONFLICT",`السيارة ${existingLocks[0].vin} مرتبطة بالفعل بالطلب ${existingLocks[0].request_no}`);
      let destination:any=null;
      if (destinationLocationId) {
        [destination]=await tx<any[]>`select l.id::text,l.name,l.branch_id::text,b.name as branch_name from operations.locations l left join core.branches b on b.id=l.branch_id where l.id=${destinationLocationId}::uuid and l.is_active=true`;
        if (!destination) throw new OperationsError(400,"DESTINATION","المكان المستهدف غير صحيح");
        if (requestType==="transfer" && sourceLocations.length===1 && sourceLocations[0]===destinationLocationId) throw new OperationsError(400,"SAME_LOCATION","لا يمكن اختيار المكان الحالي نفسه كوجهة");
      }
      if (targetStatusCode) {
        const [status]=await tx<any[]>`select code from operations.vehicle_statuses where code=${targetStatusCode} and is_active=true`;
        if (!status) throw new OperationsError(400,"STATUS","الحالة المستهدفة غير صحيحة");
      }
      const sourceBranchId=sourceBranches[0];
      const requestNo=`OPS-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${randomUUID().replace(/-/g,"").slice(0,8).toUpperCase()}`;
      const [row]=await tx<any[]>`
        insert into operations.transfer_requests(
          request_no,department_code,transfer_type,source_location_id,destination_location_id,source_branch_id,destination_branch_id,
          status,requested_by,photography_date,target_status_code,notes,updated_by
        ) values (
          ${requestNo},'operations',${requestType},${sourceLocations.length===1?sourceLocations[0]:null}::uuid,${destinationLocationId}::uuid,
          ${sourceBranchId}::uuid,${destination?.branch_id || sourceBranchId}::uuid,'draft',${user.id}::uuid,${photographyDate}::date,
          ${targetStatusCode},${stringOrNull(body.notes)},${user.id}::uuid
        ) returning *,id::text
      `;
      for (const vehicle of vehicles) {
        const snapshot={vin:vehicle.vin,carName:vehicle.car_name,statement:vehicle.statement,modelYear:vehicle.model_year,locationId:vehicle.location_id,locationName:vehicle.location_name,statusCode:vehicle.status_code,version:vehicle.version};
        await tx`
          insert into operations.transfer_request_vehicles(transfer_request_id,vehicle_id,current_location_id,current_branch_id,current_status_code,notes,snapshot)
          values (${row.id}::uuid,${vehicle.id}::uuid,${vehicle.location_id}::uuid,${vehicle.branch_id}::uuid,${vehicle.status_code},${stringOrNull(body.vehicleNotes?.[vehicle.id])},${tx.json(snapshot)})
        `;
        await tx`insert into operations.vehicle_request_locks(vehicle_id,request_id,request_type) values (${vehicle.id}::uuid,${row.id}::uuid,${requestType})`;
      }
      await tx`
        insert into operations.request_stage_events(
          request_id,stage_code,action,performed_by,performer_name,performer_role,performer_branch,note,before_data,after_data,session_data,ip_address
        ) values (
          ${row.id}::uuid,'draft','created',${user.id}::uuid,${user.fullName},${user.roles[0] || user.roleCodes[0] || null},
          ${user.branches[0] || user.branchCodes[0] || null},${stringOrNull(body.notes)},${tx.json({})},${tx.json({status:'draft',vehicleIds})},
          ${tx.json({roleCodes:user.roleCodes,branchCodes:user.branchCodes})},${requestIp(request)}
        )
      `;
      await audit(tx,request,user,{pageCode:"operations.requests",action:"transfer_request.created",entityType:"transfer_request",entityId:row.id,afterData:{...row,vehicleIds}});
      await outbox(tx,user,{eventType:`operations.${requestType}_request.created`,entityType:"transfer_request",entityId:row.id,requestNo,sourceBranchId,destinationBranchId:destination?.branch_id || sourceBranchId,
        targetRoles:["branch_manager"],title:requestType==="transfer"?"طلب نقل جديد":"طلب تصوير جديد",description:`تم إنشاء الطلب ${requestNo}`,internalPath:`/operations/requests?request=${row.id}`,metadata:{vehicleIds,photographyDate}});
      return {...row,vehicles:vehicles.map((v:any)=>({id:v.id,vin:v.vin,carName:v.car_name,currentLocationName:v.location_name,currentStatusCode:v.status_code})),events:[]};
    });
    return response.status(201).json({ok:true,request:created,message:"تم إنشاء الطلب بصورة مستقلة وحجز السيارات من الطلبات المتعارضة"});
  } catch(error:any) {
    if (error instanceof OperationsError) return response.status(error.status).json({ok:false,error:error.message,code:error.code});
    if (error?.code==="23505") return response.status(409).json({ok:false,error:"يوجد طلب نشط متعارض لإحدى السيارات أو تكرر رقم الطلب"});
    console.error("Create request failed",error);
    return response.status(500).json({ok:false,error:"تعذر إنشاء الطلب ولم يتم حفظ طلب ناقص"});
  }
}

function responsibleBranchId(row:any,stage:string) {
  return stage==="vehicle_sent" ? String(row.source_branch_id || "") : String(row.destination_branch_id || "");
}

async function executeVehicleReceipt(tx:any,request:VercelRequest,user:SessionUser,row:any,note:string|null,isOverride:boolean,overrideReason:string|null) {
  if (row.transfer_type!=="transfer") return;
  if (!row.destination_location_id) throw new OperationsError(400,"DESTINATION","الطلب لا يحتوي على مكان مستهدف");
  const vehicles=await tx<any[]>`
    select v.*,v.id::text,l.name as location_name,rv.current_location_id::text as request_location_id,
      rv.current_status_code as request_status_code,rv.snapshot as request_snapshot,
      coalesce(a.financial_approved,false) as financial_approved,coalesce(a.administrative_approved,false) as administrative_approved
    from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id
    left join operations.locations l on l.id=v.location_id left join operations.vehicle_approvals a on a.vehicle_id=v.id
    where rv.transfer_request_id=${row.id}::uuid order by v.id for update of v
  `;
  const [targetStatus]=row.target_status_code ? await tx<any[]>`select code,name,is_final,requires_approvals from operations.vehicle_statuses where code=${row.target_status_code}` : [null];
  const [destination]=await tx<any[]>`select id::text,name from operations.locations where id=${row.destination_location_id}::uuid`;
  for (const vehicle of vehicles) {
    if (!isOverride && String(vehicle.location_id)!==String(vehicle.request_location_id || "")) throw new OperationsError(409,"VEHICLE_CHANGED",`مكان السيارة ${vehicle.vin} تغير منذ إنشاء الطلب`);
    if (!isOverride && vehicle.request_status_code && vehicle.status_code!==vehicle.request_status_code) throw new OperationsError(409,"VEHICLE_STATUS_CHANGED",`حالة السيارة ${vehicle.vin} تغيرت منذ إنشاء الطلب`);
    const nextStatus=row.target_status_code || vehicle.status_code;
    if (targetStatus) assertApprovalStatusTransition(vehicle,nextStatus);
    const before={locationId:vehicle.location_id,statusCode:vehicle.status_code,version:vehicle.version};
    const after={locationId:row.destination_location_id,statusCode:nextStatus,version:Number(vehicle.version)+1};
    const [movement]=await tx<any[]>`
      insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,note,performed_by,performer_name,
        performer_role,performer_branch,request_id,movement_type,before_data,after_data)
      values (${vehicle.id}::uuid,${vehicle.location_id}::uuid,${row.destination_location_id}::uuid,${vehicle.status_code},${nextStatus},${note},
        ${user.id}::uuid,${user.fullName},${user.roles[0] || user.roleCodes[0] || null},${user.branches[0] || user.branchCodes[0] || null},
        ${row.id}::uuid,'transfer_request',${tx.json(before)},${tx.json(after)}) returning id::text
    `;
    await tx`update operations.vehicles set location_id=${row.destination_location_id}::uuid,status_code=${nextStatus},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${vehicle.id}::uuid`;
    await applyApprovalStatusTransition(tx,request,user,vehicle,nextStatus);
    await tx`update operations.transfer_request_vehicles set received_location_id=${row.destination_location_id}::uuid,received_status_code=${nextStatus} where transfer_request_id=${row.id}::uuid and vehicle_id=${vehicle.id}::uuid`;
    await audit(tx,request,user,{pageCode:"operations.requests",action:"vehicle.received_from_transfer",entityType:"vehicle",entityId:vehicle.id,beforeData:before,afterData:{...after,movementId:movement.id},reason:overrideReason,isOverride});
    await outbox(tx,user,{eventType:"operations.vehicle.moved",entityType:"vehicle",entityId:vehicle.id,requestNo:row.request_no,vehicleId:vehicle.id,vin:vehicle.vin,sourceBranchId:row.source_branch_id,destinationBranchId:row.destination_branch_id,title:"تم استلام سيارة من طلب نقل",description:`${vehicle.vin} وصلت إلى ${destination?.name || 'المكان المستهدف'}`,internalPath:`/operations/requests?request=${row.id}`,metadata:{movementId:movement.id}});
  }
}

async function advanceInternal(request:VercelRequest,response:VercelResponse,user:SessionUser,isOverride:boolean) {
  const body=bodyOf(request);
  const requestId=clean(body.requestId || body.id);
  const note=stringOrNull(body.note);
  const overrideReason=stringOrNull(body.overrideReason || body.reason);
  if (!requestId) return response.status(400).json({ok:false,error:"معرف الطلب مطلوب"});
  if (isOverride && (!isSystemAdmin(user) || !overrideReason)) return response.status(isSystemAdmin(user)?400:403).json({ok:false,error:isSystemAdmin(user)?"سبب التجاوز الإداري مطلوب":"التجاوز الإداري متاح لمدير النظام فقط"});
  const sql=getSql();
  try {
    const result=await sql.begin(async(tx)=>{
      const [row]=await tx<any[]>`select r.*,r.id::text from operations.transfer_requests r where r.id=${requestId}::uuid and r.deleted_at is null for update`;
      if (!row) throw new OperationsError(404,"NOT_FOUND","الطلب غير موجود");
      if (["cancelled","completed"].includes(row.status)) throw new OperationsError(400,"CLOSED","لا يمكن تنفيذ مرحلة جديدة على طلب مكتمل أو ملغي");
      const expectedVersion=Number(body.version || row.version);
      if (expectedVersion!==Number(row.version)) throw new OperationsError(409,"VERSION","تم تعديل الطلب بواسطة مستخدم آخر. أعد فتحه ثم حاول مرة أخرى");
      const normalNext=nextStage(row.status);
      const targetStage=clean(body.stageCode) || normalNext;
      if (!targetStage || !REQUEST_STAGES.includes(targetStage as any)) throw new OperationsError(400,"STAGE","لا توجد مرحلة تالية صالحة");
      if (!isOverride && targetStage!==normalNext) throw new OperationsError(400,"STAGE_ORDER","لا يمكن تخطي مراحل الطلب");
      const permission=STAGE_PERMISSIONS[targetStage as keyof typeof STAGE_PERMISSIONS];
      if (!hasPermission(user,permission)) throw new OperationsError(403,"STAGE_PERMISSION","ليس لديك صلاحية تنفيذ هذه المرحلة");
      const [existing]=await tx<any[]>`select id::text from operations.request_stage_events where request_id=${requestId}::uuid and stage_code=${targetStage} and action='stage_completed' limit 1`;
      if (existing) throw new OperationsError(409,"DUPLICATE_STAGE","تم تنفيذ هذه المرحلة من قبل");
      const branchIds=await permittedBranchIds(user);
      const responsible=responsibleBranchId(row,targetStage);
      if (!isSystemAdmin(user) && !branchIds.includes(responsible)) throw new OperationsError(403,"BRANCH_STAGE","هذه المرحلة تخص الفرع المسؤول عنها وليست فرع المستخدم");
      const before={status:row.status,version:row.version};
      if (targetStage==="vehicle_received") await executeVehicleReceipt(tx,request,user,row,note,isOverride,overrideReason);
      const after={status:targetStage,version:Number(row.version)+1};
      await tx`
        insert into operations.request_stage_events(
          request_id,stage_code,action,performed_by,performer_name,performer_role,performer_branch,note,before_data,after_data,
          is_override,override_reason,session_data,ip_address
        ) values (
          ${requestId}::uuid,${targetStage},'stage_completed',${user.id}::uuid,${user.fullName},${user.roles[0] || user.roleCodes[0] || null},
          ${user.branches[0] || user.branchCodes[0] || null},${note},${tx.json(before)},${tx.json(after)},${isOverride},${overrideReason},
          ${tx.json({roleCodes:user.roleCodes,branchCodes:user.branchCodes})},${requestIp(request)}
        )
      `;
      await tx`update operations.transfer_requests set status=${targetStage},started_at=coalesce(started_at,now()),completed_at=case when ${targetStage}='completed' then now() else completed_at end,updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${requestId}::uuid`;
      if (targetStage==="completed") await tx`delete from operations.vehicle_request_locks where request_id=${requestId}::uuid`;
      await audit(tx,request,user,{pageCode:"operations.requests",action:isOverride?"transfer_request.admin_override":"transfer_request.stage_completed",entityType:"transfer_request",entityId:requestId,beforeData:before,afterData:after,reason:overrideReason,isOverride});
      await outbox(tx,user,{eventType:`operations.transfer_request.${targetStage}`,entityType:"transfer_request",entityId:requestId,requestNo:row.request_no,sourceBranchId:row.source_branch_id,destinationBranchId:row.destination_branch_id,
        targetRoles:["branch_manager"],title:`تحديث طلب ${row.request_no}`,description:`تم تنفيذ المرحلة ${targetStage}`,internalPath:`/operations/requests?request=${requestId}`,metadata:{stage:targetStage,isOverride}});
      return {id:requestId,requestNo:row.request_no,status:targetStage,version:after.version};
    });
    return response.status(200).json({ok:true,request:result,message:isOverride?"تم تنفيذ التجاوز الإداري مع تسجيل السبب":"تم تنفيذ المرحلة وتسجيلها"});
  } catch(error:any) {
    if (error instanceof OperationsError) return response.status(error.status).json({ok:false,error:error.message,code:error.code});
    if (error?.code==="23505") return response.status(409).json({ok:false,error:"تم تنفيذ المرحلة بالفعل بواسطة مستخدم آخر"});
    console.error("Advance request failed",error);
    return response.status(500).json({ok:false,error:"فشل تنفيذ المرحلة وتم التراجع عن جميع التغييرات"});
  }
}

export function advanceRequest(request:VercelRequest,response:VercelResponse,user:SessionUser) { return advanceInternal(request,response,user,false); }
export function overrideRequest(request:VercelRequest,response:VercelResponse,user:SessionUser) { return advanceInternal(request,response,user,true); }

export async function cancelRequest(request:VercelRequest,response:VercelResponse,user:SessionUser) {
  if (!hasPermission(user,"operations.requests.cancel")) return response.status(403).json({ok:false,error:"ليس لديك صلاحية إلغاء الطلب"});
  const body=bodyOf(request); const requestId=clean(body.requestId || body.id); const reason=stringOrNull(body.reason);
  if (!requestId || !reason) return response.status(400).json({ok:false,error:"معرف الطلب وسبب الإلغاء مطلوبان"});
  const sql=getSql();
  try {
    const result=await sql.begin(async(tx)=>{
      const [row]=await tx<any[]>`select *,id::text from operations.transfer_requests where id=${requestId}::uuid and deleted_at is null for update`;
      if (!row) throw new OperationsError(404,"NOT_FOUND","الطلب غير موجود");
      if (["cancelled","completed"].includes(row.status)) throw new OperationsError(400,"CLOSED","الطلب مكتمل أو ملغي بالفعل");
      const branches=await permittedBranchIds(user);
      if (!isSystemAdmin(user) && !branches.includes(String(row.source_branch_id)) && !branches.includes(String(row.destination_branch_id))) throw new OperationsError(403,"SCOPE","الطلب غير مرتبط بفرع المستخدم");
      await tx`update operations.transfer_requests set status='cancelled',cancelled_at=now(),cancelled_by=${user.id}::uuid,cancellation_reason=${reason},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${requestId}::uuid`;
      await tx`insert into operations.request_cancellations(request_id,stage_code,reason,cancelled_by,cancelled_by_name) values (${requestId}::uuid,${row.status},${reason},${user.id}::uuid,${user.fullName})`;
      await tx`insert into operations.request_stage_events(request_id,stage_code,action,performed_by,performer_name,performer_role,performer_branch,note,before_data,after_data,session_data,ip_address)
        values (${requestId}::uuid,${row.status},'cancelled',${user.id}::uuid,${user.fullName},${user.roles[0] || user.roleCodes[0] || null},${user.branches[0] || user.branchCodes[0] || null},${reason},${tx.json({status:row.status})},${tx.json({status:'cancelled'})},${tx.json({roleCodes:user.roleCodes,branchCodes:user.branchCodes})},${requestIp(request)})`;
      await tx`delete from operations.vehicle_request_locks where request_id=${requestId}::uuid`;
      await audit(tx,request,user,{pageCode:"operations.requests",action:"transfer_request.cancelled",entityType:"transfer_request",entityId:requestId,beforeData:{status:row.status},afterData:{status:"cancelled"},reason});
      await outbox(tx,user,{eventType:"operations.transfer_request.cancelled",entityType:"transfer_request",entityId:requestId,requestNo:row.request_no,sourceBranchId:row.source_branch_id,destinationBranchId:row.destination_branch_id,targetRoles:["branch_manager"],title:"تم إلغاء طلب",description:`تم إلغاء ${row.request_no}: ${reason}`,internalPath:`/operations/requests?request=${requestId}`});
      return {id:requestId,status:"cancelled"};
    });
    return response.status(200).json({ok:true,request:result,message:"تم إلغاء الطلب مع الاحتفاظ بجميع مراحله وحركاته"});
  } catch(error:any) {
    if (error instanceof OperationsError) return response.status(error.status).json({ok:false,error:error.message,code:error.code});
    console.error("Cancel request failed",error); return response.status(500).json({ok:false,error:"تعذر إلغاء الطلب"});
  }
}

export async function deleteRequest(request:VercelRequest,response:VercelResponse,user:SessionUser) {
  const requestId=clean(request.query.id || bodyOf(request).id); const reason=stringOrNull(request.query.reason || bodyOf(request).reason) || "حذف قبل بدء التنفيذ";
  if (!requestId) return response.status(400).json({ok:false,error:"معرف الطلب مطلوب"});
  const sql=getSql();
  try {
    const result=await sql.begin(async(tx)=>{
      const [row]=await tx<any[]>`select *,id::text from operations.transfer_requests where id=${requestId}::uuid and deleted_at is null for update`;
      if (!row) throw new OperationsError(404,"NOT_FOUND","الطلب غير موجود");
      const canDelete=isSystemAdmin(user) || (row.requested_by===user.id && hasPermission(user,"operations.requests.delete"));
      if (!canDelete) throw new OperationsError(403,"DELETE_PERMISSION","الحذف متاح لمنشئ الطلب قبل بدء التنفيذ أو لمدير النظام");
      const [actions]=await tx<{count:number}[]>`select count(*)::int as count from operations.request_stage_events where request_id=${requestId}::uuid and action<>'created'`;
      const [movements]=await tx<{count:number}[]>`select count(*)::int as count from operations.movements where request_id=${requestId}::uuid`;
      if (row.status!=="draft" || Number(actions?.count || 0)>0 || Number(movements?.count || 0)>0 || row.started_at) throw new OperationsError(400,"STARTED","لا يمكن حذف طلب بدأ تنفيذه؛ استخدم إلغاء الطلب");
      await tx`update operations.transfer_requests set status='deleted',deleted_at=now(),deleted_by=${user.id}::uuid,delete_reason=${reason},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${requestId}::uuid`;
      await tx`delete from operations.vehicle_request_locks where request_id=${requestId}::uuid`;
      await audit(tx,request,user,{pageCode:"operations.requests",action:"transfer_request.deleted",entityType:"transfer_request",entityId:requestId,beforeData:row,afterData:{status:"deleted"},reason});
      await outbox(tx,user,{eventType:"operations.transfer_request.deleted",entityType:"transfer_request",entityId:requestId,requestNo:row.request_no,sourceBranchId:row.source_branch_id,destinationBranchId:row.destination_branch_id,title:"تم حذف طلب قبل التنفيذ",description:`تم حذف ${row.request_no}`,metadata:{reason}});
      return {id:requestId,status:"deleted"};
    });
    return response.status(200).json({ok:true,request:result,message:"تم حذف الطلب قبل بدء التنفيذ مع بقاء سجل التدقيق"});
  } catch(error:any) {
    if (error instanceof OperationsError) return response.status(error.status).json({ok:false,error:error.message,code:error.code});
    console.error("Delete request failed",error); return response.status(500).json({ok:false,error:"تعذر حذف الطلب"});
  }
}
