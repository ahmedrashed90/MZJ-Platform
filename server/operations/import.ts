import type { VercelRequest,VercelResponse } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { hasPermission,isSystemAdmin } from "../_auth.js";
import { bodyOf,clean,normalizeVin,permittedLocationIds } from "../_operations-auth.js";
import { getSql } from "../_db.js";
import { audit,OperationsError,stringOrNull } from "./common.js";
import { applyApprovalStatusTransition,assertApprovalStatusTransition,DELIVERED_STATUS,UNDER_DELIVERY_STATUS } from "./approval-flow.js";

type ImportResult={
  rowNumber:number;
  vin:string;
  valid:boolean;
  errors:string[];
  action?:"insert"|"update";
  normalized?:Record<string,any>;
};

function getField(row:any,...keys:string[]) {
  for (const key of keys) if (row[key]!==undefined && row[key]!==null) return row[key];
  return "";
}

function supplied(value:unknown) {
  return clean(value)!=="";
}

async function validateRows(rows:any[],user:SessionUser):Promise<ImportResult[]> {
  const sql=getSql();
  const allowed=await permittedLocationIds(user);
  const [locations,statuses,existing]=await Promise.all([
    sql<any[]>`select id::text,code,name,branch_id::text from operations.locations where is_active=true`,
    sql<any[]>`select code,name,is_final,requires_approvals from operations.vehicle_statuses where is_active=true`,
    sql<any[]>`
      select v.id::text,upper(regexp_replace(trim(v.vin),'\\s+','','g')) as vin,v.archived_at,v.location_id::text,
        v.status_code,v.status_note,coalesce(a.financial_approved,false) as financial_approved,
        coalesce(a.administrative_approved,false) as administrative_approved,
        exists(select 1 from operations.vehicle_request_locks l where l.vehicle_id=v.id) as has_active_request
      from operations.vehicles v
      left join operations.vehicle_approvals a on a.vehicle_id=v.id
      where coalesce(v.is_deleted,false)=false
    `,
  ]);
  const locMap=new Map<string,any>();
  locations.forEach((item:any)=>{
    locMap.set(item.id,item);
    locMap.set(clean(item.code).toLowerCase(),item);
    locMap.set(clean(item.name).toLowerCase(),item);
  });
  const statusMap=new Map<string,any>();
  statuses.forEach((item:any)=>{
    statusMap.set(clean(item.code).toLowerCase(),item);
    statusMap.set(clean(item.name).toLowerCase(),item);
  });
  const existingMap=new Map(existing.map((item:any)=>[item.vin,item]));
  const vins=rows.map((row)=>normalizeVin(getField(row,"vin","VIN","الهيكل","رقم الهيكل")));
  const duplicate=new Set(vins.filter((vin,index)=>vin && vins.indexOf(vin)!==index));

  return rows.map((row,index)=>{
    const rowNumber=Number(row.rowNumber || index+2);
    const errors:string[]=[];
    const vin=normalizeVin(getField(row,"vin","VIN","الهيكل","رقم الهيكل"));
    const existingVehicle=existingMap.get(vin);
    const locationValue=getField(row,"locationId","location","المكان");
    const statusValue=getField(row,"statusCode","status","الحالة");
    const locationRaw=clean(locationValue);
    const statusRaw=clean(statusValue);
    const locationProvided=supplied(locationValue);
    const statusProvided=supplied(statusValue);
    const location=locationProvided ? (locMap.get(locationRaw) || locMap.get(locationRaw.toLowerCase())) : null;
    const status=statusProvided
      ? statusMap.get(statusRaw.toLowerCase())
      : existingVehicle
        ? null
        : statusMap.get("available_for_sale");
    const statusNote=stringOrNull(getField(row,"statusNote","ملاحظات الحالة"));

    if (!vin) errors.push("VIN مطلوب");
    if (/e\+?\d+/i.test(vin)) errors.push("VIN ظهر بصيغة رقمية علمية؛ اجعل العمود Text للحفاظ على الأصفار");
    if (duplicate.has(vin)) errors.push("VIN مكرر داخل الملف");
    if (!existingVehicle && !locationProvided) errors.push("المكان مطلوب للسيارة الجديدة");
    if (locationProvided && !location) errors.push("المكان غير معروف");
    if (statusProvided && !status) errors.push("الحالة غير معروفة");
    if (location && !isSystemAdmin(user) && !allowed.includes(location.id)) errors.push("المكان خارج نطاق صلاحيتك");
    if (existingVehicle && !isSystemAdmin(user) && !allowed.includes(existingVehicle.location_id)) errors.push("السيارة الموجودة خارج نطاق صلاحيتك");
    if (existingVehicle?.archived_at) errors.push("السيارة مؤرشفة ولا يمكن تحديثها من الاستيراد");

    const effectiveStatus=status || (existingVehicle ? statusMap.get(clean(existingVehicle.status_code).toLowerCase()) : null);
    const effectiveStatusCode=status?.code || existingVehicle?.status_code || null;
    const effectiveLocationId=location?.id || existingVehicle?.location_id || null;
    const changingState=Boolean(existingVehicle && (
      (locationProvided && effectiveLocationId!==existingVehicle.location_id) ||
      (statusProvided && effectiveStatusCode!==existingVehicle.status_code)
    ));
    if (existingVehicle?.has_active_request && changingState) errors.push("لا يمكن تغيير مكان أو حالة سيارة مرتبطة بطلب نقل أو تصوير نشط");
    if (!existingVehicle && effectiveStatusCode===DELIVERED_STATUS) errors.push("لا يمكن إضافة سيارة مباشرة بحالة «مباع تم التسليم»؛ يجب المرور بحالة «مباع تحت التسليم»");
    if (existingVehicle && statusProvided && effectiveStatusCode===DELIVERED_STATUS) {
      if (existingVehicle.status_code!==UNDER_DELIVERY_STATUS) errors.push("لا يمكن اختيار «مباع تم التسليم» بدون المرور بحالة «مباع تحت التسليم»");
      else if (!existingVehicle.financial_approved && !existingVehicle.administrative_approved) errors.push("الموافقة المالية والموافقة الإدارية غير مكتملتين");
      else if (!existingVehicle.financial_approved) errors.push("الموافقة المالية غير مكتملة");
      else if (!existingVehicle.administrative_approved) errors.push("الموافقة الإدارية غير مكتملة");
    }
    if (effectiveStatusCode==="has_notes" && !(statusNote || existingVehicle?.status_note)) errors.push("ملاحظات الحالة مطلوبة عند اختيار بها ملاحظات");

    const normalized={
      vin,
      carName:stringOrNull(getField(row,"carName","car_name","السيارة")),
      statement:stringOrNull(getField(row,"statement","البيان")),
      agentName:stringOrNull(getField(row,"agentName","agent_name","الوكيل")),
      interiorColor:stringOrNull(getField(row,"interiorColor","interior_color","اللون الداخلي")),
      exteriorColor:stringOrNull(getField(row,"exteriorColor","exterior_color","اللون الخارجي")),
      modelYear:stringOrNull(getField(row,"modelYear","model_year","الموديل")),
      plateNo:stringOrNull(getField(row,"plateNo","plate_no","اللوحة")),
      batchNo:stringOrNull(getField(row,"batchNo","batch_name","اسم الدفعة بالتاريخ","الدفعة")),
      locationId:location?.id || null,
      statusCode:status?.code || null,
      statusNote,
      notes:stringOrNull(getField(row,"notes","ملاحظات في السيارة","ملاحظات السيارة")),
      placeNotes:stringOrNull(getField(row,"placeNotes","ملاحظات المكان")),
      bookingShortageLocationNotes:stringOrNull(getField(row,"bookingShortageLocationNotes","حجز - نواقص - تحديد مكان")),
      sourceType:stringOrNull(getField(row,"sourceType","المصدر")),
      existingId:existingVehicle?.id || null,
      defaultStatusCode:existingVehicle ? null : effectiveStatusCode,
    };
    return {rowNumber,vin,valid:errors.length===0,errors,action:existingVehicle?"update":"insert",normalized};
  });
}

async function appendImportedNote(tx:any,user:SessionUser,vehicleId:string,noteType:string,note:string|null,movementId:string|null) {
  if (!note) return;
  await tx`
    insert into operations.vehicle_notes(vehicle_id,note_type,note,movement_id,created_by,creator_name)
    values (${vehicleId}::uuid,${noteType},${note},${movementId}::uuid,${user.id}::uuid,${user.fullName})
  `;
}

export async function importVehicles(request:VercelRequest,response:VercelResponse,user:SessionUser) {
  const body=bodyOf(request);
  const action=clean(body.action) || "preview";
  const rows=Array.isArray(body.rows)?body.rows:[];
  if (!hasPermission(user,"operations.vehicles.import")) return response.status(403).json({ok:false,error:"ليس لديك صلاحية استيراد السيارات"});
  if (!rows.length) return response.status(400).json({ok:false,error:"ملف الاستيراد لا يحتوي على صفوف"});
  if (rows.length>5000) return response.status(400).json({ok:false,error:"الحد الأقصى للملف الواحد 5000 صف. قسّم الملف إلى دفعات"});

  const preview=await validateRows(rows,user);
  if (action==="preview") return response.status(200).json({
    ok:true,
    preview,
    summary:{read:rows.length,valid:preview.filter((item)=>item.valid).length,invalid:preview.filter((item)=>!item.valid).length},
  });
  if (action!=="commit") return response.status(400).json({ok:false,error:"إجراء الاستيراد غير صحيح"});

  const validRows=preview.filter((item)=>item.valid && item.normalized);
  const invalidRows=preview.filter((item)=>!item.valid);
  if (!validRows.length) return response.status(400).json({ok:false,error:"لا توجد صفوف صحيحة للحفظ",preview});
  const sql=getSql();
  try {
    const result=await sql.begin(async(tx)=>{
      const allowed=await permittedLocationIds(user);
      let inserted=0,updated=0;
      const saved:Array<{rowNumber:number;vin:string;action:string}>=[];
      for (const row of validRows) {
        const n=row.normalized!;
        if (n.existingId) {
          const [before]=await tx<any[]>`
            select v.*,v.id::text,coalesce(a.financial_approved,false) as financial_approved,
              coalesce(a.administrative_approved,false) as administrative_approved
            from operations.vehicles v
            left join operations.vehicle_approvals a on a.vehicle_id=v.id
            where v.id=${n.existingId}::uuid and coalesce(v.is_deleted,false)=false
            for update of v
          `;
          if (!before) throw new OperationsError(404,"VEHICLE_CHANGED",`السيارة ${row.vin} لم تعد موجودة`);
          if (before.archived_at) throw new OperationsError(409,"ARCHIVED",`السيارة ${row.vin} أصبحت مؤرشفة`);
          if (!isSystemAdmin(user) && !allowed.includes(String(before.location_id))) throw new OperationsError(403,"SOURCE_SCOPE",`السيارة ${row.vin} خرجت من نطاق صلاحيتك`);
          if (n.locationId && !isSystemAdmin(user) && !allowed.includes(String(n.locationId))) throw new OperationsError(403,"DESTINATION_SCOPE",`المكان الجديد للسيارة ${row.vin} خارج نطاق صلاحيتك`);
          const nextLocationId=n.locationId || String(before.location_id || "");
          const nextStatusCode=n.statusCode || before.status_code;
          const changingState=String(before.location_id || "")!==String(nextLocationId || "") || before.status_code!==nextStatusCode;
          if (changingState) {
            const [lock]=await tx<any[]>`select r.request_no from operations.vehicle_request_locks l join operations.transfer_requests r on r.id=l.request_id where l.vehicle_id=${n.existingId}::uuid limit 1`;
            if (lock) throw new OperationsError(409,"ACTIVE_REQUEST",`السيارة ${row.vin} مرتبطة بطلب نشط ${lock.request_no}`);
          }
          const [targetStatus]=await tx<any[]>`select code,is_final,requires_approvals from operations.vehicle_statuses where code=${nextStatusCode} and is_active=true`;
          if (!targetStatus) throw new OperationsError(400,"STATUS_CHANGED",`حالة السيارة ${row.vin} لم تعد متاحة`);
          assertApprovalStatusTransition(before,nextStatusCode);
          const nextStatusNote=n.statusNote || before.status_note;
          if (nextStatusCode==="has_notes" && !nextStatusNote) throw new OperationsError(400,"STATUS_NOTE",`ملاحظات الحالة مطلوبة للسيارة ${row.vin}`);

          const [after]=await tx<any[]>`
            update operations.vehicles set
              car_name=coalesce(${n.carName},car_name),statement=coalesce(${n.statement},statement),agent_name=coalesce(${n.agentName},agent_name),
              interior_color=coalesce(${n.interiorColor},interior_color),exterior_color=coalesce(${n.exteriorColor},exterior_color),
              model_year=coalesce(${n.modelYear},model_year),plate_no=coalesce(${n.plateNo},plate_no),batch_no=coalesce(${n.batchNo},batch_no),
              location_id=coalesce(${n.locationId}::uuid,location_id),status_code=coalesce(${n.statusCode},status_code),status_note=coalesce(${n.statusNote},status_note),
              notes=coalesce(${n.notes},notes),place_notes=coalesce(${n.placeNotes},place_notes),
              booking_shortage_location_notes=coalesce(${n.bookingShortageLocationNotes},booking_shortage_location_notes),source_type=coalesce(${n.sourceType},source_type),
              has_notes=(coalesce(${n.statusNote},status_note,'')<>'' or coalesce(${n.notes},notes,'')<>'' or coalesce(${n.bookingShortageLocationNotes},booking_shortage_location_notes,'')<>''),
              updated_by=${user.id}::uuid,updated_at=now(),version=version+1
            where id=${n.existingId}::uuid
            returning *,id::text
          `;
          let movementId:string|null=null;
          if (changingState) {
            const [movement]=await tx<any[]>`
              insert into operations.movements(
                vehicle_id,from_location_id,to_location_id,old_status,new_status,note,status_note,place_note,shortage_note,
                performed_by,performer_name,performer_role,performer_branch,movement_type,before_data,after_data
              ) values (
                ${n.existingId}::uuid,${before.location_id}::uuid,${after.location_id}::uuid,${before.status_code},${after.status_code},
                'تحديث عبر استيراد Excel',${after.status_note},${after.place_notes},${after.booking_shortage_location_notes},
                ${user.id}::uuid,${user.fullName},${user.roles[0] || user.roleCodes[0] || null},${user.branches[0] || user.branchCodes[0] || null},
                'excel_import',${tx.json(before)},${tx.json(after)}
              ) returning id::text
            `;
            movementId=movement.id;
          }
          await applyApprovalStatusTransition(tx,request,user,before,nextStatusCode);
          if (n.notes && n.notes!==before.notes) await appendImportedNote(tx,user,n.existingId,"vehicle",n.notes,movementId);
          if (n.statusNote && n.statusNote!==before.status_note) await appendImportedNote(tx,user,n.existingId,"status",n.statusNote,movementId);
          if (n.placeNotes && n.placeNotes!==before.place_notes) await appendImportedNote(tx,user,n.existingId,"place",n.placeNotes,movementId);
          if (n.bookingShortageLocationNotes && n.bookingShortageLocationNotes!==before.booking_shortage_location_notes) {
            await appendImportedNote(tx,user,n.existingId,"booking_shortage_location",n.bookingShortageLocationNotes,movementId);
          }
          await audit(tx,request,user,{pageCode:"operations.import",action:"vehicle.updated_by_import",entityType:"vehicle",entityId:n.existingId,beforeData:before,afterData:after});
          updated++;
          saved.push({rowNumber:row.rowNumber,vin:row.vin,action:"update"});
        } else {
          const statusCode=n.defaultStatusCode || "available_for_sale";
          const [status]=await tx<any[]>`select code,is_final,requires_approvals from operations.vehicle_statuses where code=${statusCode} and is_active=true`;
          if (!status) throw new OperationsError(400,"NEW_STATUS",`الحالة غير مسموحة للسيارة الجديدة ${row.vin}`);
          assertApprovalStatusTransition({id:"",vin:row.vin,status_code:null,financial_approved:false,administrative_approved:false},statusCode);
          if (!n.locationId) throw new OperationsError(400,"NEW_LOCATION",`المكان مطلوب للسيارة الجديدة ${row.vin}`);
          if (!isSystemAdmin(user) && !allowed.includes(String(n.locationId))) throw new OperationsError(403,"DESTINATION_SCOPE",`مكان السيارة ${row.vin} خارج نطاق صلاحيتك`);
          const [after]=await tx<any[]>`
            insert into operations.vehicles(
              vin,car_name,statement,agent_name,interior_color,exterior_color,model_year,plate_no,batch_no,location_id,status_code,
              status_note,notes,place_notes,booking_shortage_location_notes,source_type,has_notes,created_by,updated_by
            ) values (
              ${n.vin},${n.carName},${n.statement},${n.agentName},${n.interiorColor},${n.exteriorColor},${n.modelYear},${n.plateNo},${n.batchNo},
              ${n.locationId}::uuid,${statusCode},${n.statusNote},${n.notes},${n.placeNotes},${n.bookingShortageLocationNotes},${n.sourceType},
              ${Boolean(n.statusNote || n.notes || n.bookingShortageLocationNotes)},${user.id}::uuid,${user.id}::uuid
            ) returning *,id::text
          `;
          await applyApprovalStatusTransition(tx,request,user,{id:after.id,vin:row.vin,status_code:null},statusCode);
          await appendImportedNote(tx,user,after.id,"vehicle",n.notes,null);
          await appendImportedNote(tx,user,after.id,"status",n.statusNote,null);
          await appendImportedNote(tx,user,after.id,"place",n.placeNotes,null);
          await appendImportedNote(tx,user,after.id,"booking_shortage_location",n.bookingShortageLocationNotes,null);
          await audit(tx,request,user,{pageCode:"operations.import",action:"vehicle.created_by_import",entityType:"vehicle",entityId:after.id,afterData:after});
          inserted++;
          saved.push({rowNumber:row.rowNumber,vin:row.vin,action:"insert"});
        }
      }
      await audit(tx,request,user,{pageCode:"operations.import",action:"vehicles.import_completed",entityType:"import_batch",entityId:null,afterData:{rowsRead:rows.length,inserted,updated,failed:invalidRows.length}});
      return {read:rows.length,inserted,updated,failed:invalidRows.length,skipped:invalidRows.length,saved,failedRows:invalidRows};
    });
    return response.status(200).json({ok:true,result,message:`تمت إضافة ${result.inserted} وتحديث ${result.updated} سيارة. فشل ${result.failed} صف مع إظهار السبب`});
  } catch(error:any) {
    if (error instanceof OperationsError) return response.status(error.status).json({ok:false,error:error.message,code:error.code});
    if (error?.code==="23505") return response.status(409).json({ok:false,error:"ظهر VIN مكرر أثناء الحفظ المتزامن. تم التراجع عن الدفعة كلها"});
    console.error("Import failed",error);
    return response.status(500).json({ok:false,error:"فشل الاستيراد وتم التراجع عن الدفعة دون بيانات جزئية"});
  }
}
