import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { hasPermission, isSystemAdmin } from "../_auth.js";
import { bodyOf, clean, normalizeVin, permittedLocationIds } from "../_operations-auth.js";
import { getSql } from "../_db.js";
import { audit, bool, objectValue, OperationsError, outbox, pageParams, stringOrNull } from "./common.js";
import { applyApprovalStatusTransition,assertApprovalStatusTransition } from "./approval-flow.js";

export async function listMovements(request: VercelRequest, response: VercelResponse, user: SessionUser) {
  const sql = getSql();
  const allowed = await permittedLocationIds(user);
  const all = isSystemAdmin(user);
  const { page,pageSize,offset } = pageParams(request.query as Record<string, unknown>,40,200);
  const fromDate=clean(request.query.fromDate);
  const toDate=clean(request.query.toDate);
  const fromTime=clean(request.query.fromTime);
  const toTime=clean(request.query.toTime);
  const filterType=clean(request.query.filterType);
  const filterValue=clean(request.query.filterValue);
  const vin=filterType==="vin" ? normalizeVin(filterValue) : clean(request.query.vin);
  const carName=filterType==="car" ? filterValue : clean(request.query.carName);
  const fromLocationId=filterType==="from" ? filterValue : clean(request.query.fromLocationId);
  const toLocationId=filterType==="to" ? filterValue : clean(request.query.toLocationId);
  const performer=clean(request.query.performer);
  const requestNo=clean(request.query.requestNo);
  const branch=clean(request.query.branch);
  const pattern=`%${carName}%`;
  const performerPattern=`%${performer}%`;
  const requestPattern=`%${requestNo}%`;
  const branchPattern=`%${branch}%`;
  const vinPattern=`%${normalizeVin(vin)}%`;
  const [countRow]=await sql<{total:number}[]>`
    select count(*)::int as total
    from operations.movements m
    join operations.vehicles v on v.id=m.vehicle_id
    left join operations.locations fl on fl.id=m.from_location_id
    left join operations.locations tl on tl.id=m.to_location_id
    left join operations.transfer_requests r on r.id=m.request_id
    where (${all} or m.from_location_id=any(${allowed}::uuid[]) or m.to_location_id=any(${allowed}::uuid[]) or v.location_id=any(${allowed}::uuid[]))
      and (${fromDate}='' or m.created_at::date>=${fromDate || null}::date)
      and (${toDate}='' or m.created_at::date<=${toDate || null}::date)
      and (${fromTime}='' or m.created_at::time>=${fromTime || null}::time)
      and (${toTime}='' or m.created_at::time<=${toTime || null}::time)
      and (${vin}='' or upper(regexp_replace(v.vin,'\\s+','','g')) like ${vinPattern})
      and (${carName}='' or coalesce(v.car_name,'') ilike ${pattern})
      and (${fromLocationId}='' or m.from_location_id=${fromLocationId || null}::uuid)
      and (${toLocationId}='' or m.to_location_id=${toLocationId || null}::uuid)
      and (${performer}='' or coalesce(m.performer_name,'') ilike ${performerPattern})
      and (${requestNo}='' or coalesce(r.request_no,'') ilike ${requestPattern})
      and (${branch}='' or coalesce(m.performer_branch,'') ilike ${branchPattern})
  `;
  const rows=await sql<any[]>`
    select m.id::text,m.created_at,m.movement_type,m.batch_id::text,m.vehicle_id::text,v.vin,v.car_name,v.statement,
      m.from_location_id::text,fl.name as from_location_name,m.to_location_id::text,tl.name as to_location_name,
      m.old_status,os.name as old_status_name,m.new_status,ns.name as new_status_name,
      m.performer_name,m.performer_role,m.performer_branch,m.note,m.status_note,m.place_note,m.shortage_note,
      m.request_id::text,r.request_no
    from operations.movements m
    join operations.vehicles v on v.id=m.vehicle_id
    left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id
    left join operations.vehicle_statuses os on os.code=m.old_status left join operations.vehicle_statuses ns on ns.code=m.new_status
    left join operations.transfer_requests r on r.id=m.request_id
    where (${all} or m.from_location_id=any(${allowed}::uuid[]) or m.to_location_id=any(${allowed}::uuid[]) or v.location_id=any(${allowed}::uuid[]))
      and (${fromDate}='' or m.created_at::date>=${fromDate || null}::date)
      and (${toDate}='' or m.created_at::date<=${toDate || null}::date)
      and (${fromTime}='' or m.created_at::time>=${fromTime || null}::time)
      and (${toTime}='' or m.created_at::time<=${toTime || null}::time)
      and (${vin}='' or upper(regexp_replace(v.vin,'\\s+','','g')) like ${vinPattern})
      and (${carName}='' or coalesce(v.car_name,'') ilike ${pattern})
      and (${fromLocationId}='' or m.from_location_id=${fromLocationId || null}::uuid)
      and (${toLocationId}='' or m.to_location_id=${toLocationId || null}::uuid)
      and (${performer}='' or coalesce(m.performer_name,'') ilike ${performerPattern})
      and (${requestNo}='' or coalesce(r.request_no,'') ilike ${requestPattern})
      and (${branch}='' or coalesce(m.performer_branch,'') ilike ${branchPattern})
    order by m.created_at desc,m.id desc limit ${pageSize} offset ${offset}
  `;
  const total=Number(countRow?.total || 0);
  return response.status(200).json({ok:true,movements:rows,pagination:{page,pageSize,total,pages:Math.max(1,Math.ceil(total/pageSize))}});
}

async function appendNote(tx:any,user:SessionUser,vehicleId:string,type:string,note:string|null,movementId:string) {
  if (!note) return;
  await tx`insert into operations.vehicle_notes(vehicle_id,note_type,note,movement_id,created_by,creator_name)
    values (${vehicleId}::uuid,${type},${note},${movementId}::uuid,${user.id}::uuid,${user.fullName})`;
}

export async function executeMovement(request: VercelRequest,response: VercelResponse,user: SessionUser) {
  const body=bodyOf(request);
  const rawItems=Array.isArray(body.items) ? body.items : [];
  const legacyIds=Array.isArray(body.vehicleIds) ? body.vehicleIds : [];
  const items=(rawItems.length ? rawItems : legacyIds.map((vehicleId:unknown)=>({vehicleId,checks:body.checks,statusNote:body.statusNote,shortageNote:body.shortageNotes,placeNote:body.placeNotes,note:body.note})))
    .map((item:any)=>({
      vehicleId:clean(item.vehicleId),version:Number(item.version || 0),note:stringOrNull(item.note),statusNote:stringOrNull(item.statusNote),
      shortageNote:stringOrNull(item.shortageNote),placeNote:stringOrNull(item.placeNote),checks:objectValue(item.checks),
    })).filter((item:any)=>item.vehicleId);
  const uniqueIds=[...new Set(items.map((item:any)=>item.vehicleId))];
  if (!items.length) return response.status(400).json({ok:false,error:"اختر سيارة واحدة على الأقل"});
  if (uniqueIds.length!==items.length) return response.status(400).json({ok:false,error:"لا يمكن اختيار السيارة نفسها مرتين داخل الحركة"});
  const isBulk=items.length>1;
  if (!hasPermission(user,isBulk ? "operations.movements.bulk" : "operations.movements.execute")) return response.status(403).json({ok:false,error:isBulk?"ليس لديك صلاحية تنفيذ الحركة الجماعية":"ليس لديك صلاحية تنفيذ الحركة"});
  const destinationLocationId=clean(body.destinationLocationId || body.locationId);
  const statusCode=clean(body.statusCode);
  const generalNote=stringOrNull(body.generalNote || body.note);
  const idempotencyKey=stringOrNull(body.idempotencyKey);
  if (!destinationLocationId || !statusCode) return response.status(400).json({ok:false,error:"المكان الجديد والحالة الجديدة مطلوبان"});
  const sql=getSql();
  try {
    const result=await sql.begin(async(tx)=>{
      if (idempotencyKey) {
        const [existing]=await tx<any[]>`select id::text,vehicle_count,created_at from operations.movement_batches where idempotency_key=${idempotencyKey} limit 1`;
        if (existing) return {batch:existing,duplicate:true,vehicles:[]};
      }
      const allowed=await permittedLocationIds(user);
      if (!isSystemAdmin(user) && !allowed.includes(destinationLocationId)) throw new OperationsError(403,"DESTINATION_SCOPE","المكان الجديد خارج نطاق فروعك");
      const [destination]=await tx<any[]>`select l.id::text,l.code,l.name,l.branch_id::text from operations.locations l where l.id=${destinationLocationId}::uuid and l.is_active=true`;
      const [status]=await tx<any[]>`select code,name,is_final,requires_approvals from operations.vehicle_statuses where code=${statusCode} and is_active=true`;
      if (!destination) throw new OperationsError(400,"DESTINATION","المكان الجديد غير صحيح");
      if (!status) throw new OperationsError(400,"STATUS","الحالة الجديدة غير صحيحة");
      const vehicles=await tx<any[]>`
        select v.*,v.id::text,l.code as location_code,l.name as location_name,
          coalesce(a.financial_approved,false) as financial_approved,coalesce(a.administrative_approved,false) as administrative_approved,
          coalesce((select jsonb_object_agg(ci.item_code,ci.is_present) from operations.vehicle_check_items ci where ci.vehicle_id=v.id),'{}'::jsonb) as check_items
        from operations.vehicles v left join operations.locations l on l.id=v.location_id
        left join operations.vehicle_approvals a on a.vehicle_id=v.id
        where v.id=any(${uniqueIds}::uuid[]) and coalesce(v.is_deleted,false)=false
        order by v.id for update of v
      `;
      if (vehicles.length!==items.length) throw new OperationsError(404,"VEHICLES","بعض السيارات غير موجودة");
      const byId=new Map(vehicles.map((vehicle:any)=>[vehicle.id,vehicle]));
      const itemById=new Map(items.map((item:any)=>[item.vehicleId,item]));
      const validCheckItems=await tx<{code:string}[]>`select code from operations.check_item_definitions where is_active=true`;
      const validChecks=new Set(validCheckItems.map((item)=>item.code));
      for (const vehicle of vehicles) {
        const item=itemById.get(vehicle.id)!;
        if (!isSystemAdmin(user) && !allowed.includes(String(vehicle.location_id))) throw new OperationsError(403,"SOURCE_SCOPE",`السيارة ${vehicle.vin} خارج نطاق فروعك`);
        if (vehicle.archived_at) throw new OperationsError(400,"ARCHIVED",`السيارة ${vehicle.vin} مؤرشفة ولا يمكن تحريكها`);
        if (item.version && Number(vehicle.version)!==item.version) throw new OperationsError(409,"VERSION",`تم تعديل السيارة ${vehicle.vin} بواسطة مستخدم آخر`);
        const [lock]=await tx<any[]>`select r.request_no from operations.vehicle_request_locks l join operations.transfer_requests r on r.id=l.request_id where l.vehicle_id=${vehicle.id}::uuid limit 1`;
        if (lock) throw new OperationsError(409,"ACTIVE_REQUEST",`السيارة ${vehicle.vin} مرتبطة بطلب جارٍ ${lock.request_no}`);
        if (String(vehicle.location_id)===destinationLocationId && vehicle.status_code===statusCode) throw new OperationsError(400,"NO_CHANGE",`لا يوجد تغيير فعلي للسيارة ${vehicle.vin}`);
        assertApprovalStatusTransition(vehicle,statusCode);
        if (statusCode==="has_notes" && !item.statusNote) throw new OperationsError(400,"STATUS_NOTE",`ملاحظات الحالة مطلوبة للسيارة ${vehicle.vin}`);
        if (Object.keys(item.checks).length && vehicle.location_code!=="agency") throw new OperationsError(400,"CHECK_LOCATION",`التشيك متاح فقط للسيارة الموجودة حاليًا في الوكالة: ${vehicle.vin}`);
        if (Object.keys(item.checks).length && !hasPermission(user,"operations.checks.update")) throw new OperationsError(403,"CHECK_PERMISSION","ليس لديك صلاحية تعديل التشيك");
        for (const code of Object.keys(item.checks)) if (!validChecks.has(code)) throw new OperationsError(400,"CHECK_ITEM",`عنصر تشيك غير صحيح للسيارة ${vehicle.vin}`);
      }
      const [batch]=await tx<any[]>`
        insert into operations.movement_batches(movement_type,vehicle_count,note,idempotency_key,performed_by,performer_name,performer_role,performer_branch)
        values (${isBulk?'bulk_manual':'manual'},${vehicles.length},${generalNote},${idempotencyKey},${user.id}::uuid,${user.fullName},
          ${user.roles[0] || user.roleCodes[0] || null},${user.branches[0] || user.branchCodes[0] || null})
        returning id::text,vehicle_count,created_at
      `;
      const changed=[];
      for (const vehicle of vehicles) {
        const item=itemById.get(vehicle.id)!;
        const oldChecks=vehicle.check_items || {};
        const nextChecks={...oldChecks};
        for (const [code,value] of Object.entries(item.checks)) nextChecks[code]=bool(value);
        const before={locationId:vehicle.location_id,statusCode:vehicle.status_code,statusNote:vehicle.status_note,placeNote:vehicle.place_notes,shortageNote:vehicle.booking_shortage_location_notes,checks:oldChecks,version:vehicle.version};
        const after={locationId:destinationLocationId,statusCode,statusNote:item.statusNote,placeNote:item.placeNote,shortageNote:item.shortageNote,checks:nextChecks,version:Number(vehicle.version)+1};
        const [movement]=await tx<any[]>`
          insert into operations.movements(
            vehicle_id,from_location_id,to_location_id,old_status,new_status,note,status_note,place_note,shortage_note,
            performed_by,performer_name,performer_role,performer_branch,batch_id,movement_type,old_check_state,new_check_state,before_data,after_data
          ) values (
            ${vehicle.id}::uuid,${vehicle.location_id}::uuid,${destinationLocationId}::uuid,${vehicle.status_code},${statusCode},
            ${item.note || generalNote},${item.statusNote},${item.placeNote},${item.shortageNote},${user.id}::uuid,${user.fullName},
            ${user.roles[0] || user.roleCodes[0] || null},${user.branches[0] || user.branchCodes[0] || null},${batch.id}::uuid,
            ${isBulk?'bulk_manual':'manual'},${tx.json(oldChecks)},${tx.json(nextChecks)},${tx.json(before)},${tx.json(after)})
          returning id::text,created_at
        `;
        await tx`
          update operations.vehicles set location_id=${destinationLocationId}::uuid,status_code=${statusCode},status_note=${item.statusNote},
            place_notes=coalesce(${item.placeNote},place_notes),booking_shortage_location_notes=coalesce(${item.shortageNote},booking_shortage_location_notes),
            has_notes=(coalesce(${item.statusNote},'')<>'' or coalesce(${item.shortageNote},booking_shortage_location_notes,'')<>'' or coalesce(notes,'')<>''),
            updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${vehicle.id}::uuid
        `;
        await applyApprovalStatusTransition(tx,request,user,vehicle,statusCode);
        if (item.shortageNote && hasPermission(user,"operations.shortages.update")) {
          const [open]=await tx<any[]>`select id::text from operations.vehicle_shortages where vehicle_id=${vehicle.id}::uuid and is_resolved=false order by created_at desc limit 1 for update`;
          if (open) await tx`update operations.vehicle_shortages set note=${item.shortageNote},updated_at=now() where id=${open.id}::uuid`;
          else await tx`insert into operations.vehicle_shortages(vehicle_id,shortage_type,note,created_by) values (${vehicle.id}::uuid,'general',${item.shortageNote},${user.id}::uuid)`;
        } else if (item.shortageNote && !hasPermission(user,"operations.shortages.update")) throw new OperationsError(403,"SHORTAGE_PERMISSION","ليس لديك صلاحية تعديل الحجز والنواقص وتحديد المكان");
        for (const [code,value] of Object.entries(item.checks)) {
          const oldValue=Object.prototype.hasOwnProperty.call(oldChecks,code) ? Boolean(oldChecks[code]) : null;
          const newValue=bool(value);
          if (oldValue===newValue) continue;
          await tx`insert into operations.vehicle_check_items(vehicle_id,item_code,is_present,updated_by,updated_at)
            values (${vehicle.id}::uuid,${code},${newValue},${user.id}::uuid,now())
            on conflict(vehicle_id,item_code) do update set is_present=excluded.is_present,updated_by=excluded.updated_by,updated_at=now()`;
          await tx`insert into operations.vehicle_check_history(vehicle_id,item_code,old_value,new_value,movement_id,changed_by,changer_name)
            values (${vehicle.id}::uuid,${code},${oldValue},${newValue},${movement.id}::uuid,${user.id}::uuid,${user.fullName})`;
        }
        await appendNote(tx,user,vehicle.id,"status",item.statusNote,movement.id);
        await appendNote(tx,user,vehicle.id,"booking_shortage_location",item.shortageNote,movement.id);
        await appendNote(tx,user,vehicle.id,"place",item.placeNote,movement.id);
        await audit(tx,request,user,{pageCode:"operations.movements",action:"vehicle.moved",entityType:"vehicle",entityId:vehicle.id,beforeData:before,afterData:after});
        await outbox(tx,user,{eventType:"operations.vehicle.moved",entityType:"vehicle",entityId:vehicle.id,vehicleId:vehicle.id,vin:vehicle.vin,title:"تم تنفيذ حركة سيارة",description:`${vehicle.vin}: ${vehicle.location_name || '—'} ← ${destination.name}`,internalPath:`/operations?vehicle=${vehicle.id}`,metadata:{movementId:movement.id,batchId:batch.id}});
        changed.push({vehicleId:vehicle.id,vin:vehicle.vin,movementId:movement.id});
      }
      await audit(tx,request,user,{pageCode:"operations.movements",action:isBulk?"movement.batch_created":"movement.created",entityType:"movement_batch",entityId:batch.id,afterData:{batch,vehicles:changed}});
      return {batch,duplicate:false,vehicles:changed};
    });
    return response.status(200).json({ok:true,...result,message:result.duplicate?"تم تجاهل الضغط المتكرر لأن الحركة مسجلة بالفعل":`تم تنفيذ الحركة لعدد ${items.length} سيارة داخل Transaction واحدة`});
  } catch(error:any) {
    if (error instanceof OperationsError) return response.status(error.status).json({ok:false,error:error.message,code:error.code});
    if (error?.code==="23505") return response.status(409).json({ok:false,error:"تم تنفيذ هذه الحركة بالفعل أو يوجد تعارض متزامن"});
    console.error("Execute movement failed",error);
    return response.status(500).json({ok:false,error:"فشلت الحركة وتم التراجع عن جميع التغييرات"});
  }
}
