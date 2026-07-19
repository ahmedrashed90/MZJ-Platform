import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { getSql } from "./_db.js";
import { ensureOperationsSchema } from "./_operations-schema.js";
import { ensureTrackingSchema } from "./_tracking-schema.js";
import { hasPermission, isSystemAdmin, requirePermission, requireUser, type SessionUser } from "./_auth.js";

function text(value: unknown) { return String(value ?? "").trim(); }
function integer(value: unknown, fallback: number, max = 10000) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.trunc(n))) : fallback; }
function bodyOf(request: VercelRequest) { if (typeof request.body === "string") { try { return JSON.parse(request.body || "{}"); } catch { return {}; } } return request.body || {}; }
function queryValue(request: VercelRequest, name: string) { const value = request.query[name]; return Array.isArray(value) ? value[0] : value; }
function roleName(user: SessionUser) { return user.roles[0] || user.roleCodes[0] || ""; }
function branchName(user: SessionUser) { return user.branches[0] || user.branchCodes[0] || ""; }
function makeRequestId() { return `ops-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`; }

class ApiError extends Error {
  status: number; code: string; fieldErrors?: Record<string,string>;
  constructor(status: number, code: string, message: string, fieldErrors?: Record<string,string>) { super(message); this.status=status; this.code=code; this.fieldErrors=fieldErrors; }
}

function statusLabel(code: string) {
  return ({ available_for_sale:"متاح للبيع", reserved:"حجز", has_notes:"بها ملاحظات", under_delivery:"مباع تحت التسليم", delivered:"مباع تم التسليم" } as Record<string,string>)[code] || code;
}

const vehicleCheckItems = [
  ["mats","فرشات"],["extinguisher","طفاية"],["bag","شنطة"],["spare_tire","اسبير"],["remote","ريموت"],
  ["screen","شاشة"],["recorder","مسجل"],["ac","مكيف"],["camera","كاميرا"],["sensor","حساس"],
] as const;
const vehicleCheckNames = new Map<string,string>(vehicleCheckItems);

function userScopeClause(user: SessionUser, alias = "l", startIndex = 1) {
  if (isSystemAdmin(user)) return { sql: "true", params: [] as any[] };
  if (!user.branchCodes.length) return { sql: "false", params: [] as any[] };
  return {
    sql: `exists (select 1 from operations.location_branches lb join core.branches b on b.id=lb.branch_id where lb.location_id=${alias}.id and b.code = any($${startIndex}::text[]))`,
    params: [user.branchCodes],
  };
}


async function assertLocationAccess(client:any,user:SessionUser,locationId:string|null|undefined,message="المكان خارج نطاق صلاحيتك") {
  if(isSystemAdmin(user)) return;
  if(!locationId || !user.branchCodes.length) throw new ApiError(403,"FORBIDDEN",message);
  const rows=await client.unsafe(`select 1 from operations.location_branches lb join core.branches b on b.id=lb.branch_id where lb.location_id=$1::uuid and b.code=any($2::text[]) limit 1`,[locationId,user.branchCodes]);
  if(!rows.length) throw new ApiError(403,"FORBIDDEN",message);
}

async function assertVehiclesAccess(client:any,user:SessionUser,vehicleIds:string[]) {
  if(isSystemAdmin(user)) return;
  if(!vehicleIds.length || !user.branchCodes.length) throw new ApiError(403,"FORBIDDEN","إحدى السيارات خارج نطاق صلاحيتك");
  const [row]=await client.unsafe(`select count(distinct v.id)::int count from operations.vehicles v join operations.location_branches lb on lb.location_id=v.location_id join core.branches b on b.id=lb.branch_id where v.id=any($1::uuid[]) and b.code=any($2::text[])`,[vehicleIds,user.branchCodes]);
  if(Number(row?.count||0)!==vehicleIds.length) throw new ApiError(403,"FORBIDDEN","إحدى السيارات خارج نطاق صلاحيتك");
}

async function requireOpsView(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request,response); if(!user) return null;
  if (!hasPermission(user,"operations.view") && !user.roleCodes.includes("operations_user")) {
    response.status(403).json({ok:false,code:"FORBIDDEN",error:"ليست لديك صلاحية عرض نظام العمليات"}); return null;
  }
  return user;
}

async function listMeta(user: SessionUser) {
  const sql = getSql();
  const scope = userScopeClause(user,"l",1);
  const locations = await sql.unsafe<{id:string;code:string;name:string}[]>(`
    select l.id::text,l.code,l.name from operations.locations l
    where l.is_active=true and ${scope.sql} order by l.sort_order,l.name`, scope.params);
  const statuses = await sql<{code:string;name:string;requires_note:boolean;requires_approvals:boolean;is_final:boolean}[]>`
    select code,name,requires_note,requires_approvals,is_final from operations.vehicle_statuses where is_active=true order by sort_order`;
  return { locations, statuses };
}

function buildVehicleQuery(user: SessionUser, query: Record<string,unknown>, archivedOnly = false) {
  const params: any[] = [];
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const conditions = ["v.is_deleted=false", archivedOnly ? "v.archived_at is not null" : "v.archived_at is null"];
  if (!isSystemAdmin(user)) {
    if (!user.branchCodes.length) conditions.push("false");
    else conditions.push(`exists (select 1 from operations.location_branches lb join core.branches b on b.id=lb.branch_id where lb.location_id=v.location_id and b.code=any(${add(user.branchCodes)}::text[]))`);
  }
  const q=text(query.q); if(q) conditions.push(`(v.vin ilike ${add(`%${q}%`)} or coalesce(v.car_name,'') ilike ${add(`%${q}%`)} or coalesce(v.statement,'') ilike ${add(`%${q}%`)})`);
  const location=text(query.location); if(location) conditions.push(`v.location_id=${add(location)}::uuid`);
  const status=text(query.status); if(status) conditions.push(`v.status_code=${add(status)}`);
  const model=text(query.model); if(model) conditions.push(`coalesce(v.model_year,'') ilike ${add(`%${model}%`)}`);
  const agent=text(query.agent); if(agent) conditions.push(`coalesce(v.agent_name,'') ilike ${add(`%${agent}%`)}`);
  return { where: conditions.join(" and "), params };
}

async function listVehicles(user: SessionUser, query: Record<string,unknown>, archivedOnly = false) {
  const sql=getSql(); const page=Math.max(1,integer(query.page,1,100000)); const limit=Math.max(1,integer(query.limit,25,5000));
  const built=buildVehicleQuery(user,query,archivedOnly); const countParams=[...built.params];
  const [totalRow]=await sql.unsafe<{total:number}[]>(`select count(*)::int total from operations.vehicles v where ${built.where}`,countParams);
  const params=[...built.params,limit,(page-1)*limit]; const limitRef=`$${params.length-1}`; const offsetRef=`$${params.length}`;
  const rows=Array.from(await sql.unsafe<any[]>(`
    select v.id::text,v.vin,v.car_name,v.statement,v.agent_name,v.interior_color,v.exterior_color,v.model_year,v.plate_no,v.batch_no,
      v.location_id::text,l.code location_code,l.name location_name,v.status_code,coalesce(s.name,v.status_code) status_name,v.notes,v.status_note,v.shortage_location_note,
      v.archived_at,v.archive_reason,v.created_at,v.updated_at,
      coalesce(ac.financial_approved,false) financial_approved,coalesce(ac.administrative_approved,false) administrative_approved,
      coalesce((select count(*) from operations.vehicle_shortages sh where sh.vehicle_id=v.id and sh.is_resolved=false),0)::int shortages_count,
      coalesce((select count(*) from operations.vehicle_check_items ci where ci.vehicle_id=v.id),0)::int checks_count,
      coalesce((select count(*) from operations.transfer_request_vehicles trv join operations.transfer_requests tr on tr.id=trv.transfer_request_id where trv.vehicle_id=v.id and tr.deleted_at is null and tr.cancelled_at is null and tr.status not in ('completed','cancelled')),0)::int active_transfers,
      trk.order_id tracking_order_id,trk.sales_order_no tracking_order_no,trk.status tracking_status,trk.progress tracking_progress
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.vehicle_statuses s on s.code=v.status_code
    left join lateral (select * from operations.vehicle_approval_cycles x where x.vehicle_id=v.id and x.is_active=true order by x.started_at desc limit 1) ac on true
    left join lateral (
      select o.id::text order_id,o.sales_order_no,o.status,
        case when count(vs.stage_id)=0 then 0 else round(100.0*count(vs.stage_id) filter(where vs.status='completed')/count(vs.stage_id))::int end progress
      from tracking.order_vehicles ov join tracking.orders o on o.id=ov.order_id
      left join tracking.vehicle_stages vs on vs.vehicle_id=ov.id
      where (ov.operations_vehicle_id=v.id or (ov.operations_vehicle_id is null and ov.vin=v.vin)) and coalesce(o.is_archived,false)=false
      group by o.id order by o.updated_at desc limit 1
    ) trk on to_regclass('tracking.order_vehicles') is not null
    where ${built.where}
    order by v.updated_at desc,v.created_at desc limit ${limitRef} offset ${offsetRef}`,params)) as any[];
  return { rows,total:Number(totalRow?.total||0),page,limit,pages:Math.max(1,Math.ceil(Number(totalRow?.total||0)/limit)) };
}

async function vehicleDetails(user:SessionUser,id:string){
  const sql=getSql();
  const scope=userScopeClause(user,"l",2);
  const rows=await sql.unsafe<any[]>(`select v.*,v.id::text,l.name location_name,coalesce(s.name,v.status_code) status_name
    from operations.vehicles v left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code
    where v.id=$1::uuid and v.is_deleted=false and ${scope.sql} limit 1`,[id,...scope.params]);
  const vehicle=rows[0]; if(!vehicle) throw new ApiError(404,"VEHICLE_NOT_FOUND","السيارة غير موجودة أو ليست ضمن صلاحيتك");
  const [checks,movements,approvals,transfers,tracking]=await Promise.all([
    sql<any[]>`select item_code,item_name,status,note,updated_by_name,updated_at from operations.vehicle_check_items where vehicle_id=${id}::uuid order by item_name`,
    sql<any[]>`select m.id::text,m.created_at,fl.name from_location,tl.name to_location,m.old_status,m.new_status,m.note,m.status_note,m.shortage_location_note,m.performed_by_name,m.performed_branch
      from operations.movements m left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id where m.vehicle_id=${id}::uuid order by m.created_at desc limit 100`,
    sql<any[]>`select * from operations.vehicle_approval_cycles where vehicle_id=${id}::uuid order by cycle_no desc`,
    sql<any[]>`select tr.id::text,tr.request_no,tr.transfer_type,tr.status,tr.requested_at,tr.requested_by_name,dl.name destination_location
      from operations.transfer_request_vehicles rv join operations.transfer_requests tr on tr.id=rv.transfer_request_id left join operations.locations dl on dl.id=tr.destination_location_id where rv.vehicle_id=${id}::uuid order by tr.requested_at desc`,
    sql<any[]>`select o.id::text,o.sales_order_no,o.status,o.created_at,o.updated_at from tracking.order_vehicles ov join tracking.orders o on o.id=ov.order_id where ov.operations_vehicle_id=${id}::uuid or (ov.operations_vehicle_id is null and ov.vin=${vehicle.vin}) order by o.updated_at desc`,
  ]);
  return {vehicle,checks,movements,approvals,transfers,tracking};
}

async function saveVehicle(user:SessionUser,payload:any){
  const sql=getSql();
  const id=text(payload.id);
  const vin=text(payload.vin);
  if(!vin) throw new ApiError(400,"VALIDATION_ERROR","رقم الهيكل مطلوب",{vin:"مطلوب"});
  try{
    if(id){
      return sql.begin(async tx=>{
        const [existing]=await tx<any[]>`select * from operations.vehicles where id=${id}::uuid and is_deleted=false for update`;
        if(!existing) throw new ApiError(404,"VEHICLE_NOT_FOUND","السيارة غير موجودة");
        await assertLocationAccess(tx,user,existing.location_id);
        if(vin!==existing.vin&&!isSystemAdmin(user)) throw new ApiError(403,"FORBIDDEN","تغيير رقم الهيكل متاح لمدير النظام فقط");
        const before={...existing};
        const [updated]=await tx<any[]>`update operations.vehicles set vin=${vin},car_name=${text(payload.carName)||null},statement=${text(payload.statement)||null},agent_name=${text(payload.agentName)||null},interior_color=${text(payload.interiorColor)||null},exterior_color=${text(payload.exteriorColor)||null},model_year=${text(payload.modelYear)||null},plate_no=${text(payload.plateNo)||null},batch_no=${text(payload.batchNo)||null},notes=${text(payload.notes)||null},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${id}::uuid returning *`;
        await tx`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data) values(${user.id}::uuid,'operations','vehicle_updated','vehicle',${id},${tx.json(before)},${tx.json(updated)})`;
        return updated;
      });
    }
    const locationId=text(payload.locationId);
    const status=text(payload.statusCode)||"available_for_sale";
    const scope=userScopeClause(user,"l",2);
    const [location]=await sql.unsafe<any[]>(`select l.id::text from operations.locations l where l.id=$1::uuid and ${scope.sql}`,[locationId,...scope.params]);
    if(!location) throw new ApiError(400,"INVALID_DESTINATION_LOCATION","المكان غير متاح لهذا المستخدم");
    const [statusRow]=await sql<any[]>`select code,requires_note from operations.vehicle_statuses where code=${status} and is_active=true`;
    if(!statusRow) throw new ApiError(400,"INVALID_STATUS_TRANSITION","الحالة غير صحيحة");
    if(['under_delivery','delivered'].includes(status)) throw new ApiError(409,"INVALID_STATUS_TRANSITION","حالات البيع تُنفذ من خلال فلو الحركة والموافقات فقط");
    if(statusRow.requires_note&&!text(payload.statusNote)) throw new ApiError(400,"VALIDATION_ERROR","ملاحظات الحالة مطلوبة",{statusNote:"مطلوب"});
    const [created]=await sql<any[]>`insert into operations.vehicles(vin,car_name,statement,agent_name,interior_color,exterior_color,model_year,plate_no,batch_no,location_id,status_code,notes,status_note,created_by,updated_by)
      values(${vin},${text(payload.carName)||null},${text(payload.statement)||null},${text(payload.agentName)||null},${text(payload.interiorColor)||null},${text(payload.exteriorColor)||null},${text(payload.modelYear)||null},${text(payload.plateNo)||null},${text(payload.batchNo)||null},${locationId}::uuid,${status},${text(payload.notes)||null},${text(payload.statusNote)||null},${user.id}::uuid,${user.id}::uuid) returning id::text`;
    return created;
  }catch(error:any){ if(error?.code==='23505') throw new ApiError(409,"DUPLICATE_VIN","رقم الهيكل موجود بالفعل"); throw error; }
}

async function executeMovement(user:SessionUser,payload:any,requestId:string){
  const sql=getSql(); const vehicleIds:string[]=Array.from(new Set<string>((Array.isArray(payload.vehicleIds)?payload.vehicleIds:[]).map((value:unknown)=>text(value)).filter(Boolean)));
  const destination=text(payload.destinationLocationId),newStatus=text(payload.newStatus),note=text(payload.note),statusNote=text(payload.statusNote),shortageNote=text(payload.shortageLocationNote);
  const vehicleData:Record<string,any>=payload.vehicleData&&typeof payload.vehicleData==='object'?payload.vehicleData:{};
  if(!vehicleIds.length) throw new ApiError(400,"VALIDATION_ERROR","اختر سيارة واحدة على الأقل");
  if(!destination||!newStatus) throw new ApiError(400,"VALIDATION_ERROR","المكان والحالة الجديدة مطلوبان");
  const meta=await listMeta(user); if(!meta.locations.some(x=>x.id===destination)) throw new ApiError(400,"INVALID_DESTINATION_LOCATION","المكان الجديد غير متاح");
  const status=meta.statuses.find(x=>x.code===newStatus); if(!status) throw new ApiError(400,"INVALID_STATUS_TRANSITION","الحالة الجديدة غير صحيحة");
  return sql.begin(async tx=>{
    const vehicles=await tx<any[]>`select v.*,l.code location_code,l.name location_name from operations.vehicles v left join operations.locations l on l.id=v.location_id where v.id=any(${vehicleIds}::uuid[]) and v.is_deleted=false and v.archived_at is null for update`;
    if(vehicles.length!==vehicleIds.length) throw new ApiError(404,"VEHICLE_NOT_FOUND","إحدى السيارات غير موجودة أو مؤرشفة");
    await assertVehiclesAccess(tx,user,vehicleIds);
    for(const vehicle of vehicles){if(String(vehicle.location_id)===destination) throw new ApiError(409,"INVALID_DESTINATION_LOCATION",`المكان الجديد مطابق للمكان الحالي للسيارة ${vehicle.vin}`);}
    if(newStatus==='delivered'){
      for(const vehicle of vehicles){
        if(vehicle.status_code!=='under_delivery') throw new ApiError(409,"INVALID_STATUS_TRANSITION",`يجب أن تمر السيارة ${vehicle.vin} بحالة مباع تحت التسليم أولًا`);
        const [cycle]=await tx<any[]>`select * from operations.vehicle_approval_cycles where vehicle_id=${vehicle.id} and is_active=true for update`;
        if(!cycle?.financial_approved||!cycle?.administrative_approved) throw new ApiError(409,"APPROVALS_REQUIRED",`لا يمكن تسليم السيارة ${vehicle.vin} قبل اكتمال الموافقتين`);
      }
    }
    const batchNo=`MOV-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    const [batch]=await tx<any[]>`insert into operations.movement_batches(batch_no,vehicle_count,destination_location_id,new_status,general_note,performed_by,performed_by_name,performed_role,performed_branch,request_id)
      values(${batchNo},${vehicles.length},${destination}::uuid,${newStatus},${note||null},${user.id}::uuid,${user.fullName},${roleName(user)},${branchName(user)},${requestId}) returning id::text`;
    for(const vehicle of vehicles){
      const details=vehicleData[String(vehicle.id)]||{};
      const vehicleNote=text(details.note)||note;
      const vehicleStatusNote=text(details.statusNote)||statusNote;
      const vehicleShortageNote=text(details.shortageLocationNote)||shortageNote;
      if(status.requires_note&&!vehicleStatusNote) throw new ApiError(400,"VALIDATION_ERROR",`ملاحظات الحالة مطلوبة للسيارة ${vehicle.vin}`);
      const before={locationId:vehicle.location_id,status:vehicle.status_code,notes:vehicle.notes,statusNote:vehicle.status_note,shortageLocationNote:vehicle.shortage_location_note};
      const after={locationId:destination,status:newStatus,notes:vehicleNote,statusNote:vehicleStatusNote,shortageLocationNote:vehicleShortageNote};
      const [movement]=await tx<any[]>`insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,note,performed_by,batch_id,status_note,shortage_location_note,performed_by_name,performed_role,performed_branch,before_data,after_data,request_id)
        values(${vehicle.id},${vehicle.location_id},${destination}::uuid,${vehicle.status_code},${newStatus},${vehicleNote||null},${user.id}::uuid,${batch.id}::uuid,${vehicleStatusNote||null},${vehicleShortageNote||null},${user.fullName},${roleName(user)},${branchName(user)},${tx.json(before)},${tx.json(after)},${requestId}) returning id::text`;
      await tx`update operations.vehicles set location_id=${destination}::uuid,status_code=${newStatus},status_note=${vehicleStatusNote||null},shortage_location_note=${vehicleShortageNote||null},has_notes=${newStatus==='has_notes'},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${vehicle.id}`;
      if(newStatus==='has_notes') await tx`insert into operations.vehicle_status_notes(vehicle_id,status_code,note,movement_id,created_by,created_by_name) values(${vehicle.id},${newStatus},${vehicleStatusNote},${movement.id}::uuid,${user.id}::uuid,${user.fullName})`;
      const checks=Array.isArray(details.checks)?details.checks:[];
      if(vehicle.location_code==='agency'){
        for(const check of checks){
          const itemCode=text(check?.itemCode); const itemName=vehicleCheckNames.get(itemCode); const checkStatus=text(check?.status)||'unknown'; const checkNote=text(check?.note)||null;
          if(!itemName||!['unknown','present','missing'].includes(checkStatus)) continue;
          const [currentCheck]=await tx<any[]>`select status,note from operations.vehicle_check_items where vehicle_id=${vehicle.id} and item_code=${itemCode} for update`;
          await tx`insert into operations.vehicle_check_items(vehicle_id,item_code,item_name,status,note,updated_by,updated_by_name,updated_at) values(${vehicle.id},${itemCode},${itemName},${checkStatus},${checkNote},${user.id}::uuid,${user.fullName},now()) on conflict(vehicle_id,item_code) do update set item_name=excluded.item_name,status=excluded.status,note=excluded.note,updated_by=excluded.updated_by,updated_by_name=excluded.updated_by_name,updated_at=now()`;
          if(!currentCheck||currentCheck.status!==checkStatus||text(currentCheck.note)!==text(checkNote)) await tx`insert into operations.vehicle_check_history(vehicle_id,item_code,item_name,old_status,new_status,old_note,new_note,movement_id,changed_by,changed_by_name) values(${vehicle.id},${itemCode},${itemName},${currentCheck?.status||null},${checkStatus},${currentCheck?.note||null},${checkNote},${movement.id}::uuid,${user.id}::uuid,${user.fullName})`;
        }
      }
      if(newStatus==='under_delivery'&&vehicle.status_code!=='under_delivery'){
        await tx`update operations.vehicle_approval_cycles set is_active=false,closed_at=now(),updated_at=now() where vehicle_id=${vehicle.id} and is_active=true`;
        const [n]=await tx<{n:number}[]>`select coalesce(max(cycle_no),0)::int+1 n from operations.vehicle_approval_cycles where vehicle_id=${vehicle.id}`;
        await tx`insert into operations.vehicle_approval_cycles(vehicle_id,cycle_no,started_by,started_by_name) values(${vehicle.id},${n.n},${user.id}::uuid,${user.fullName})`;
      }
      if(newStatus==='delivered') await tx`update operations.vehicle_approval_cycles set is_active=false,closed_at=now(),updated_at=now() where vehicle_id=${vehicle.id} and is_active=true`;
    }
    await tx`insert into operations.event_outbox(event_type,aggregate_type,aggregate_id,payload) values('operations.vehicle.moved','movement_batch',${batch.id},${tx.json({batchNo,vehicleIds,destination,newStatus})})`;
    return {batchId:batch.id,batchNo,count:vehicles.length};
  });
}

async function listTransfers(user:SessionUser,query:any){
  const sql=getSql(); const tab=text(query.tab)||"active"; const params:any[]=[]; const add=(v:unknown)=>{params.push(v);return `$${params.length}`}; const cond=["tr.deleted_at is null"];
  if(tab==='completed') cond.push("tr.status='completed'"); else if(tab!=='all') cond.push("tr.status not in ('completed','cancelled') and tr.cancelled_at is null");
  const type=text(query.type);
  if(type==='photography') cond.push(`coalesce(tr.transfer_type,'transfer') in ('photography','photo','تصوير')`);
  else if(type==='transfer') cond.push(`coalesce(tr.transfer_type,'transfer') not in ('photography','photo','تصوير')`);
  else if(type) cond.push(`tr.transfer_type=${add(type)}`);
  if(!isSystemAdmin(user)){ if(!user.branchCodes.length)cond.push('false'); else cond.push(`(tr.requested_by_branch=any(${add(user.branchCodes)}::text[]) or exists(select 1 from operations.location_branches lb join core.branches b on b.id=lb.branch_id where lb.location_id in (tr.source_location_id,tr.destination_location_id) and b.code=any(${add(user.branchCodes)}::text[])))`); }
  return sql.unsafe<any[]>(`select tr.id::text,tr.request_no,tr.transfer_type,tr.status,tr.requested_by::text,tr.requested_by_name,tr.requested_by_branch,tr.requested_at,tr.note,sl.name source_location,dl.name destination_location,
    count(rv.vehicle_id)::int vehicle_count,json_agg(json_build_object('id',v.id::text,'vin',v.vin,'carName',v.car_name,'statement',v.statement) order by v.vin) vehicles
    from operations.transfer_requests tr left join operations.locations sl on sl.id=tr.source_location_id left join operations.locations dl on dl.id=tr.destination_location_id
    join operations.transfer_request_vehicles rv on rv.transfer_request_id=tr.id join operations.vehicles v on v.id=rv.vehicle_id
    where ${cond.join(' and ')} group by tr.id,sl.name,dl.name order by tr.requested_at desc`,params);
}

async function createTransfer(user:SessionUser,payload:any){
  const sql=getSql(); const vehicleIds:string[]=Array.from(new Set<string>((Array.isArray(payload.vehicleIds)?payload.vehicleIds:[]).map((value:unknown)=>text(value)).filter(Boolean))); const destination=text(payload.destinationLocationId); const transferType=text(payload.transferType)||'transfer';
  if(!vehicleIds.length||!destination) throw new ApiError(400,"VALIDATION_ERROR","اختر السيارات والمكان المستهدف");
  const meta=await listMeta(user); if(!meta.locations.some(x=>x.id===destination)) throw new ApiError(400,"INVALID_DESTINATION_LOCATION","المكان المستهدف غير متاح");
  return sql.begin(async tx=>{
    const vehicles=await tx<any[]>`select * from operations.vehicles where id=any(${vehicleIds}::uuid[]) and is_deleted=false and archived_at is null for update`;
    if(vehicles.length!==vehicleIds.length) throw new ApiError(404,"VEHICLE_NOT_FOUND","إحدى السيارات غير موجودة");
    await assertVehiclesAccess(tx,user,vehicleIds);
    const sourceLocations=Array.from(new Set(vehicles.map((vehicle:any)=>String(vehicle.location_id||''))));
    if(sourceLocations.length!==1) throw new ApiError(409,"INVALID_SOURCE_LOCATION","يجب أن تكون جميع سيارات الطلب في المكان نفسه");
    if(sourceLocations[0]===destination) throw new ApiError(409,"INVALID_DESTINATION_LOCATION","المكان المستهدف مطابق للمكان الحالي");
    const conflicts=await tx<any[]>`select rv.vehicle_id from operations.transfer_request_vehicles rv join operations.transfer_requests tr on tr.id=rv.transfer_request_id where rv.vehicle_id=any(${vehicleIds}::uuid[]) and tr.deleted_at is null and tr.cancelled_at is null and tr.status not in ('completed','cancelled') limit 1`;
    if(conflicts.length) throw new ApiError(409,"DUPLICATE_ACTIVE_REQUEST","إحدى السيارات لها طلب جارٍ بالفعل");
    const requestNo=`TR-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`; const source=vehicles[0]?.location_id;
    const [tr]=await tx<any[]>`insert into operations.transfer_requests(request_no,transfer_type,source_location_id,destination_location_id,status,requested_by,requested_by_name,requested_by_role,requested_by_branch,note)
      values(${requestNo},${transferType},${source},${destination}::uuid,'request_received',${user.id}::uuid,${user.fullName},${roleName(user)},${branchName(user)},${text(payload.note)||null}) returning id::text`;
    for(const vehicle of vehicles) await tx`insert into operations.transfer_request_vehicles(transfer_request_id,vehicle_id,source_location_id,source_status,vehicle_snapshot) values(${tr.id}::uuid,${vehicle.id},${vehicle.location_id},${vehicle.status_code},${tx.json({vin:vehicle.vin,carName:vehicle.car_name,statement:vehicle.statement,modelYear:vehicle.model_year})})`;
    await tx`insert into operations.transfer_request_events(transfer_request_id,stage_code,action,note,actor_id,actor_name,actor_role,actor_branch) values(${tr.id}::uuid,'request_received','created',${text(payload.note)||null},${user.id}::uuid,${user.fullName},${roleName(user)},${branchName(user)})`;
    return {id:tr.id,requestNo};
  });
}

const nextStage:Record<string,string>={request_received:'vehicle_sent',vehicle_sent:'vehicle_received',vehicle_received:'completed'};
async function advanceTransfer(user:SessionUser,payload:any){
  const sql=getSql(); const id=text(payload.id); if(!id)throw new ApiError(400,"VALIDATION_ERROR","معرف الطلب مطلوب");
  return sql.begin(async tx=>{
    const [tr]=await tx<any[]>`select * from operations.transfer_requests where id=${id}::uuid and deleted_at is null for update`;
    if(!tr)throw new ApiError(404,"TRANSFER_NOT_FOUND","طلب النقل غير موجود"); const stage=nextStage[tr.status]; if(!stage)throw new ApiError(409,"INVALID_STATUS_TRANSITION","لا توجد مرحلة تالية لهذا الطلب");
    await assertLocationAccess(tx,user,stage==='vehicle_sent'?tr.source_location_id:tr.destination_location_id,"هذه المرحلة تخص فرعًا آخر");
    if(stage==='vehicle_received'){
      const vehicles=await tx<any[]>`select v.* from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id where rv.transfer_request_id=${id}::uuid for update`;
      for(const vehicle of vehicles){ const before={locationId:vehicle.location_id,status:vehicle.status_code}; const after={locationId:tr.destination_location_id,status:vehicle.status_code};
        await tx`insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,note,performed_by,performed_by_name,performed_role,performed_branch,transfer_request_id,before_data,after_data)
          values(${vehicle.id},${vehicle.location_id},${tr.destination_location_id},${vehicle.status_code},${vehicle.status_code},'استلام سيارة من طلب نقل',${user.id}::uuid,${user.fullName},${roleName(user)},${branchName(user)},${id}::uuid,${tx.json(before)},${tx.json(after)})`;
        await tx`update operations.vehicles set location_id=${tr.destination_location_id},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${vehicle.id}`; }
    }
    await tx`update operations.transfer_requests set status=${stage},completed_at=case when ${stage}='completed' then now() else completed_at end where id=${id}::uuid`;
    await tx`insert into operations.transfer_request_events(transfer_request_id,stage_code,action,note,actor_id,actor_name,actor_role,actor_branch) values(${id}::uuid,${stage},'advanced',${text(payload.note)||null},${user.id}::uuid,${user.fullName},${roleName(user)},${branchName(user)})`;
    return {id,stage};
  });
}

async function deleteTransfer(user:SessionUser,payload:any){
  const sql=getSql();
  const id=text(payload.id),reason=text(payload.reason);
  if(!id||!reason)throw new ApiError(400,'VALIDATION_ERROR','سبب مسح الطلب مطلوب');
  return sql.begin(async tx=>{
    const [request]=await tx<any[]>`select * from operations.transfer_requests where id=${id}::uuid and deleted_at is null for update`;
    if(!request)throw new ApiError(404,'TRANSFER_NOT_FOUND','طلب النقل غير موجود');
    const owner=String(request.requested_by||'')===user.id;
    if(!owner&&!hasPermission(user,'operations.transfer.cancel'))throw new ApiError(403,'FORBIDDEN','مسح الطلب متاح لمنشئه أو لصاحب الصلاحية فقط');
    if(request.status!=='request_received'||request.cancelled_at)throw new ApiError(409,'CONFLICT','لا يمكن مسح الطلب بعد بدء التنفيذ؛ استخدم إلغاء الطلب');
    const [activity]=await tx<{events:number;movements:number}[]>`select
      (select count(*)::int from operations.transfer_request_events where transfer_request_id=${id}::uuid and action<>'created') events,
      (select count(*)::int from operations.movements where transfer_request_id=${id}::uuid) movements`;
    if(Number(activity?.events||0)>0||Number(activity?.movements||0)>0)throw new ApiError(409,'CONFLICT','لا يمكن مسح الطلب بعد تنفيذ إجراء فعلي عليه');
    await tx`update operations.transfer_requests set deleted_at=now(),deleted_by=${user.id}::uuid,deletion_reason=${reason} where id=${id}::uuid`;
    await tx`insert into operations.transfer_request_events(transfer_request_id,stage_code,action,note,actor_id,actor_name,actor_role,actor_branch,before_data,after_data) values(${id}::uuid,${request.status},'deleted',${reason},${user.id}::uuid,${user.fullName},${roleName(user)},${branchName(user)},${tx.json(request)},${tx.json({deleted:true,reason})})`;
    await tx`insert into operations.event_outbox(event_type,aggregate_type,aggregate_id,payload) values('operations.transfer_request.deleted','transfer_request',${id},${tx.json({requestNo:request.request_no,reason,actorId:user.id})})`;
    return{id};
  });
}

async function cancelTransfer(user:SessionUser,payload:any){
  const sql=getSql();
  const id=text(payload.id),reason=text(payload.reason);
  if(!id||!reason)throw new ApiError(400,'VALIDATION_ERROR','سبب إلغاء الطلب مطلوب');
  return sql.begin(async tx=>{
    const [request]=await tx<any[]>`select * from operations.transfer_requests where id=${id}::uuid and deleted_at is null for update`;
    if(!request)throw new ApiError(404,'TRANSFER_NOT_FOUND','طلب النقل غير موجود');
    if(request.status==='completed')throw new ApiError(409,'INVALID_STATUS_TRANSITION','لا يمكن إلغاء طلب مكتمل');
    if(request.cancelled_at||request.status==='cancelled')throw new ApiError(409,'CONFLICT','الطلب ملغي بالفعل');
    await assertLocationAccess(tx,user,request.source_location_id,'إلغاء الطلب متاح للفرع المرتبط أو لصاحب الصلاحية فقط');
    await tx`update operations.transfer_requests set status='cancelled',cancelled_at=now(),cancelled_by=${user.id}::uuid,cancellation_reason=${reason} where id=${id}::uuid`;
    await tx`insert into operations.transfer_request_events(transfer_request_id,stage_code,action,note,actor_id,actor_name,actor_role,actor_branch,before_data,after_data) values(${id}::uuid,${request.status},'cancelled',${reason},${user.id}::uuid,${user.fullName},${roleName(user)},${branchName(user)},${tx.json(request)},${tx.json({status:'cancelled',reason})})`;
    await tx`insert into operations.event_outbox(event_type,aggregate_type,aggregate_id,payload) values('operations.transfer_request.cancelled','transfer_request',${id},${tx.json({requestNo:request.request_no,reason,actorId:user.id})})`;
    return{id};
  });
}

async function listApprovals(user:SessionUser,filter:string){
  const sql=getSql(); const scope=userScopeClause(user,'l',1); const cond=["v.is_deleted=false","v.archived_at is null","v.status_code='under_delivery'",scope.sql];
  if(filter==='missing_financial')cond.push('coalesce(c.financial_approved,false)=false'); if(filter==='missing_administrative')cond.push('coalesce(c.administrative_approved,false)=false'); if(filter==='completed')cond.push('c.financial_approved=true and c.administrative_approved=true');
  return sql.unsafe<any[]>(`select v.id::text,v.vin,v.car_name,v.statement,v.model_year,l.name location_name,c.id::text cycle_id,c.cycle_no,c.financial_approved,c.administrative_approved,c.financial_note,c.administrative_note,c.financial_approved_by_name,c.administrative_approved_by_name,c.financial_approved_at,c.administrative_approved_at
    from operations.vehicles v join operations.locations l on l.id=v.location_id left join operations.vehicle_approval_cycles c on c.vehicle_id=v.id and c.is_active=true where ${cond.join(' and ')} order by v.updated_at desc`,scope.params);
}

async function approvalAction(user:SessionUser,payload:any,requestId:string){
  const sql=getSql(); const vehicleId=text(payload.vehicleId),type=text(payload.type),action=text(payload.action),note=text(payload.note); if(!vehicleId||!['financial','administrative'].includes(type)||!['approve','revoke','note','reset'].includes(action))throw new ApiError(400,'VALIDATION_ERROR','بيانات الموافقة غير صحيحة');
  return sql.begin(async tx=>{
    const [vehicle]=await tx<any[]>`select v.id::text,v.location_id::text from operations.vehicles v where v.id=${vehicleId}::uuid and v.is_deleted=false for update`;
    if(!vehicle) throw new ApiError(404,'VEHICLE_NOT_FOUND','السيارة غير موجودة');
    await assertLocationAccess(tx,user,vehicle.location_id);
    const [cycle]=await tx<any[]>`select * from operations.vehicle_approval_cycles where vehicle_id=${vehicleId}::uuid and is_active=true for update`; if(!cycle)throw new ApiError(404,'APPROVAL_CYCLE_NOT_FOUND','لا توجد دورة موافقات نشطة'); const before={...cycle};
    if(action==='reset') await tx`update operations.vehicle_approval_cycles set financial_approved=false,administrative_approved=false,financial_approved_by=null,administrative_approved_by=null,financial_approved_by_name=null,administrative_approved_by_name=null,financial_approved_at=null,administrative_approved_at=null,updated_at=now() where id=${cycle.id}`;
    else if(type==='financial') await tx`update operations.vehicle_approval_cycles set financial_approved=case when ${action}='approve' then true when ${action}='revoke' then false else financial_approved end,financial_note=case when ${note}<>'' then ${note} else financial_note end,financial_approved_by=case when ${action}='approve' then ${user.id}::uuid when ${action}='revoke' then null else financial_approved_by end,financial_approved_by_name=case when ${action}='approve' then ${user.fullName} when ${action}='revoke' then null else financial_approved_by_name end,financial_approved_at=case when ${action}='approve' then now() when ${action}='revoke' then null else financial_approved_at end,updated_at=now() where id=${cycle.id}`;
    else await tx`update operations.vehicle_approval_cycles set administrative_approved=case when ${action}='approve' then true when ${action}='revoke' then false else administrative_approved end,administrative_note=case when ${note}<>'' then ${note} else administrative_note end,administrative_approved_by=case when ${action}='approve' then ${user.id}::uuid when ${action}='revoke' then null else administrative_approved_by end,administrative_approved_by_name=case when ${action}='approve' then ${user.fullName} when ${action}='revoke' then null else administrative_approved_by_name end,administrative_approved_at=case when ${action}='approve' then now() when ${action}='revoke' then null else administrative_approved_at end,updated_at=now() where id=${cycle.id}`;
    const [after]=await tx<any[]>`select * from operations.vehicle_approval_cycles where id=${cycle.id}`;
    await tx`insert into operations.vehicle_approval_events(cycle_id,vehicle_id,approval_type,action,note,before_data,after_data,actor_id,actor_name,actor_role,request_id) values(${cycle.id},${vehicleId}::uuid,${type},${action},${note||null},${tx.json(before)},${tx.json(after)},${user.id}::uuid,${user.fullName},${roleName(user)},${requestId})`;
    return after;
  });
}


type ImportVehicleRow = {
  vin?: unknown; carName?: unknown; statement?: unknown; agentName?: unknown; interiorColor?: unknown; exteriorColor?: unknown;
  modelYear?: unknown; plateNo?: unknown; batchNo?: unknown; location?: unknown; status?: unknown; notes?: unknown;
};

async function importVehicles(user:SessionUser,payload:any){
  const sql=getSql();
  const mode=text(payload.mode);
  const fileName=text(payload.fileName)||null;
  const rows:Array<ImportVehicleRow>=Array.isArray(payload.rows)?payload.rows.slice(0,20000):[];
  if(!['replace','append','update'].includes(mode)) throw new ApiError(400,'VALIDATION_ERROR','وضع الاستيراد غير صحيح');
  if(!rows.length) throw new ApiError(400,'IMPORT_VALIDATION_FAILED','ملف الاستيراد لا يحتوي على صفوف');
  if(mode==='replace'&&!isSystemAdmin(user)&&!hasPermission(user,'operations.import.replace')) throw new ApiError(403,'FORBIDDEN','ليست لديك صلاحية الاستبدال الكامل للمخزون');
  const locations=await sql<any[]>`select id::text,code,name from operations.locations where is_active=true`;
  const statuses=await sql<any[]>`select code,name from operations.vehicle_statuses where is_active=true`;
  const locationMap=new Map<string,string>();
  for(const row of locations){locationMap.set(text(row.id).toLowerCase(),row.id);locationMap.set(text(row.code).toLowerCase(),row.id);locationMap.set(text(row.name).toLowerCase(),row.id);}
  const statusMap=new Map<string,string>();
  for(const row of statuses){statusMap.set(text(row.code).toLowerCase(),row.code);statusMap.set(text(row.name).toLowerCase(),row.code);}
  const seen=new Set<string>();
  return sql.begin(async tx=>{
    const [batch]=await tx<any[]>`insert into operations.import_batches(mode,file_name,total_rows,status,created_by,created_by_name) values(${mode},${fileName},${rows.length},'processing',${user.id}::uuid,${user.fullName}) returning id::text`;
    let inserted=0,updated=0,skipped=0,failed=0;
    const validVins:string[]=[];
    const report:Array<{rowNumber:number;vin:string;status:string;action:string;error?:string}>=[];
    for(let index=0;index<rows.length;index++){
      const source=rows[index]||{};
      const rowNumber=index+2;
      const rowData={
        vin:text(source.vin),carName:text(source.carName),statement:text(source.statement),agentName:text(source.agentName),
        interiorColor:text(source.interiorColor),exteriorColor:text(source.exteriorColor),modelYear:text(source.modelYear),
        plateNo:text(source.plateNo),batchNo:text(source.batchNo),location:text(source.location),status:text(source.status),notes:text(source.notes),
      };
      const vin=rowData.vin;
      let action='none',rowStatus='success',errorMessage='';
      try{
        if(!vin) throw new ApiError(400,'IMPORT_VALIDATION_FAILED','رقم الهيكل مطلوب');
        if(seen.has(vin)) throw new ApiError(409,'DUPLICATE_VIN','رقم الهيكل مكرر داخل الملف');
        seen.add(vin);
        const [existing]=await tx<any[]>`select * from operations.vehicles where vin=${vin} for update`;
        if(mode==='append'&&existing){
          await assertLocationAccess(tx,user,existing.location_id);
          action='skipped';rowStatus='skipped';skipped++;validVins.push(vin);
        }
        else if(mode==='update'&&!existing){action='skipped';rowStatus='skipped';errorMessage='السيارة غير موجودة لتحديثها';skipped++;}
        else if(existing){
          await assertLocationAccess(tx,user,existing.location_id);
          await tx`update operations.vehicles set
            car_name=coalesce(nullif(${rowData.carName},''),car_name),
            statement=coalesce(nullif(${rowData.statement},''),statement),
            agent_name=coalesce(nullif(${rowData.agentName},''),agent_name),
            interior_color=coalesce(nullif(${rowData.interiorColor},''),interior_color),
            exterior_color=coalesce(nullif(${rowData.exteriorColor},''),exterior_color),
            model_year=coalesce(nullif(${rowData.modelYear},''),model_year),
            plate_no=coalesce(nullif(${rowData.plateNo},''),plate_no),
            batch_no=coalesce(nullif(${rowData.batchNo},''),batch_no),
            notes=coalesce(nullif(${rowData.notes},''),notes),
            is_deleted=false,updated_by=${user.id}::uuid,updated_at=now(),version=version+1
            where id=${existing.id}`;
          action='updated';updated++;validVins.push(vin);
        }else{
          const locationId=locationMap.get(rowData.location.toLowerCase());
          const statusCode=statusMap.get(rowData.status.toLowerCase())||'available_for_sale';
          if(!locationId) throw new ApiError(400,'INVALID_DESTINATION_LOCATION','المكان غير موجود أو غير صحيح');
          await assertLocationAccess(tx,user,locationId);
          if(['under_delivery','delivered'].includes(statusCode)) throw new ApiError(409,'INVALID_STATUS_TRANSITION','لا يمكن إدخال حالة بيع من الشيت؛ استخدم فلو الحركة والموافقات');
          await tx`insert into operations.vehicles(vin,car_name,statement,agent_name,interior_color,exterior_color,model_year,plate_no,batch_no,location_id,status_code,notes,created_by,updated_by)
            values(${vin},${rowData.carName||null},${rowData.statement||null},${rowData.agentName||null},${rowData.interiorColor||null},${rowData.exteriorColor||null},${rowData.modelYear||null},${rowData.plateNo||null},${rowData.batchNo||null},${locationId}::uuid,${statusCode},${rowData.notes||null},${user.id}::uuid,${user.id}::uuid)`;
          action='inserted';inserted++;validVins.push(vin);
        }
      }catch(error:any){rowStatus='failed';action='failed';errorMessage=error?.message||'تعذر معالجة الصف';failed++;}
      report.push({rowNumber,vin,status:rowStatus,action,error:errorMessage||undefined});
      await tx`insert into operations.import_batch_rows(batch_id,row_number,vin,action,status,error_message,row_data) values(${batch.id}::uuid,${rowNumber},${vin||null},${action},${rowStatus},${errorMessage||null},${tx.json(rowData)})`;
    }
    if(mode==='replace'&&failed>0){
      throw new ApiError(400,'IMPORT_VALIDATION_FAILED',`تم إيقاف الاستبدال الكامل لوجود ${failed} صف غير صالح`,Object.fromEntries(report.filter(row=>row.status==='failed').slice(0,50).map(row=>[`row_${row.rowNumber}`,row.error||'صف غير صالح'])));
    }
    if(mode==='replace'){
      if(!validVins.length) throw new ApiError(400,'IMPORT_VALIDATION_FAILED','لا توجد أرقام هياكل صالحة للاستبدال الكامل');
      const scopedLocations=isSystemAdmin(user)?null:await tx.unsafe<any[]>(`select distinct lb.location_id::text id from operations.location_branches lb join core.branches b on b.id=lb.branch_id where b.code=any($1::text[])`,[user.branchCodes]);
      if(isSystemAdmin(user)) await tx`update operations.vehicles set is_deleted=true,updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where vin<>all(${validVins}::text[]) and is_deleted=false and archived_at is null`;
      else {const ids=(scopedLocations||[]).map((row:any)=>row.id);if(ids.length)await tx`update operations.vehicles set is_deleted=true,updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where location_id=any(${ids}::uuid[]) and vin<>all(${validVins}::text[]) and is_deleted=false and archived_at is null`;}
    }
    await tx`update operations.import_batches set inserted_rows=${inserted},updated_rows=${updated},skipped_rows=${skipped},failed_rows=${failed},status='completed' where id=${batch.id}::uuid`;
    await tx`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data) values(${user.id}::uuid,'operations','vehicles_imported','import_batch',${batch.id},${tx.json({mode,fileName,total:rows.length,inserted,updated,skipped,failed})})`;
    return{batchId:batch.id,total:rows.length,inserted,updated,skipped,failed,rows:report};
  });
}

async function listMovements(user:SessionUser,query:any){
  const sql=getSql(); const params:any[]=[]; const add=(v:unknown)=>{params.push(v);return `$${params.length}`}; const cond=['v.is_deleted=false'];
  if(!isSystemAdmin(user)){if(!user.branchCodes.length)cond.push('false');else cond.push(`exists(select 1 from operations.location_branches lb join core.branches b on b.id=lb.branch_id where lb.location_id in(m.from_location_id,m.to_location_id) and b.code=any(${add(user.branchCodes)}::text[]))`);}
  const q=text(query.q);if(q)cond.push(`(v.vin ilike ${add(`%${q}%`)} or coalesce(v.car_name,'') ilike ${add(`%${q}%`)})`); const from=text(query.from);if(from)cond.push(`m.created_at>=${add(from)}::timestamptz`);const to=text(query.to);if(to)cond.push(`m.created_at<=${add(to)}::timestamptz`);const fromLoc=text(query.fromLocation);if(fromLoc)cond.push(`m.from_location_id=${add(fromLoc)}::uuid`);const toLoc=text(query.toLocation);if(toLoc)cond.push(`m.to_location_id=${add(toLoc)}::uuid`);const status=text(query.status);if(status)cond.push(`m.new_status=${add(status)}`);const userName=text(query.user);if(userName)cond.push(`coalesce(m.performed_by_name,'') ilike ${add(`%${userName}%`)}`);const req=text(query.requestNo);if(req)cond.push(`coalesce(tr.request_no,'') ilike ${add(`%${req}%`)}`);
  params.push(integer(query.limit,500,5000)); const limitRef=`$${params.length}`;
  return sql.unsafe<any[]>(`select m.id::text,m.created_at,v.vin,v.car_name,fl.name from_location,tl.name to_location,m.old_status,m.new_status,m.note,m.status_note,m.shortage_location_note,m.performed_by_name,m.performed_branch,tr.request_no,mb.batch_no
    from operations.movements m join operations.vehicles v on v.id=m.vehicle_id left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id left join operations.transfer_requests tr on tr.id=m.transfer_request_id left join operations.movement_batches mb on mb.id=m.batch_id where ${cond.join(' and ')} order by m.created_at desc limit ${limitRef}`,params);
}

async function archiveVehicle(user:SessionUser,payload:any){
  const sql=getSql(); const id=text(payload.vehicleId),reason=text(payload.reason);
  if(!id||!reason)throw new ApiError(400,'VALIDATION_ERROR','سبب الأرشفة مطلوب');
  return sql.begin(async tx=>{
    const [vehicle]=await tx<any[]>`select * from operations.vehicles where id=${id}::uuid and is_deleted=false for update`;
    if(!vehicle)throw new ApiError(404,'VEHICLE_NOT_FOUND','السيارة غير موجودة');
    await assertLocationAccess(tx,user,vehicle.location_id);
    if(vehicle.archived_at)throw new ApiError(409,'CONFLICT','السيارة مؤرشفة بالفعل');
    if(vehicle.status_code!=='delivered')throw new ApiError(409,'VEHICLE_NOT_ELIGIBLE','لا يمكن أرشفة السيارة قبل حالة مباع تم التسليم');
    const [approval]=await tx<any[]>`select financial_approved,administrative_approved from operations.vehicle_approval_cycles where vehicle_id=${id}::uuid order by cycle_no desc limit 1`;
    if(!approval?.financial_approved||!approval?.administrative_approved)throw new ApiError(409,'APPROVALS_REQUIRED','لا يمكن الأرشفة قبل اكتمال الموافقة المالية والإدارية');
    const active=await tx<any[]>`select 1 from operations.transfer_request_vehicles rv join operations.transfer_requests tr on tr.id=rv.transfer_request_id where rv.vehicle_id=${id}::uuid and tr.deleted_at is null and tr.cancelled_at is null and tr.status not in('completed','cancelled') limit 1`;
    if(active.length)throw new ApiError(409,'CONFLICT','يوجد طلب نقل جارٍ للسيارة');
    const [tracking]=await tx<any[]>`select o.status,o.is_archived from tracking.order_vehicles ov join tracking.orders o on o.id=ov.order_id where (ov.operations_vehicle_id=${id}::uuid or (ov.operations_vehicle_id is null and ov.vin=${vehicle.vin})) and coalesce(o.is_deleted,false)=false order by o.updated_at desc limit 1`;
    if(tracking&&tracking.status!=='completed'&&!tracking.is_archived)throw new ApiError(409,'VEHICLE_NOT_ELIGIBLE','لا يمكن الأرشفة قبل اكتمال طلب التراكينج المرتبط');
    await tx`insert into operations.vehicle_archives(vehicle_id,reason,snapshot,archived_by,archived_by_name) values(${id}::uuid,${reason},${tx.json(vehicle)},${user.id}::uuid,${user.fullName})`;
    await tx`update operations.vehicles set archived_at=now(),archived_by=${user.id}::uuid,archive_reason=${reason},updated_at=now(),version=version+1 where id=${id}::uuid`;
    await tx`insert into operations.event_outbox(event_type,aggregate_type,aggregate_id,payload) values('operations.vehicle.archived','vehicle',${id},${tx.json({vin:vehicle.vin,reason,actorId:user.id})})`;
    return{id};
  });
}

async function deleteVehicle(user:SessionUser,payload:any,requestId:string){
  const sql=getSql();const id=text(payload.vehicleId),reason=text(payload.reason);
  if(!id||!reason)throw new ApiError(400,'VALIDATION_ERROR','سبب المسح مطلوب');
  return sql.begin(async tx=>{
    const [vehicle]=await tx<any[]>`select * from operations.vehicles where id=${id}::uuid and is_deleted=false for update`;
    if(!vehicle)throw new ApiError(404,'VEHICLE_NOT_FOUND','السيارة غير موجودة');
    await assertLocationAccess(tx,user,vehicle.location_id);
    const [history]=await tx<{count:number}[]>`select (
      (select count(*) from operations.movements where vehicle_id=${id}::uuid)+
      (select count(*) from operations.vehicle_status_notes where vehicle_id=${id}::uuid)+
      (select count(*) from operations.vehicle_approvals where vehicle_id=${id}::uuid)+
      (select count(*) from operations.vehicle_approval_cycles where vehicle_id=${id}::uuid)+
      (select count(*) from operations.vehicle_approval_events where vehicle_id=${id}::uuid)+
      (select count(*) from operations.vehicle_shortages where vehicle_id=${id}::uuid)+
      (select count(*) from operations.transfer_request_vehicles where vehicle_id=${id}::uuid)+
      (select count(*) from operations.vehicle_check_items where vehicle_id=${id}::uuid)+
      (select count(*) from operations.vehicle_check_history where vehicle_id=${id}::uuid)+
      (select count(*) from operations.vehicle_archives where vehicle_id=${id}::uuid)+
      (select count(*) from tracking.order_vehicles where operations_vehicle_id=${id}::uuid or vin=${vehicle.vin})+
      (select count(*) from audit.activity_log where system_code='operations' and entity_type='vehicle' and entity_id=${id})
    )::int count`;
    if(Number(history.count)>0)throw new ApiError(409,'VEHICLE_HAS_HISTORY','السيارة لها تاريخ تشغيلي ولا يمكن مسحها، استخدم الأرشفة');
    await tx`insert into audit.vehicle_deletions(vehicle_id,vin,reason,snapshot,deleted_by,deleted_by_name,deleted_by_email,deleted_by_role,request_id) values(${id}::uuid,${vehicle.vin},${reason},${tx.json(vehicle)},${user.id}::uuid,${user.fullName},${user.email},${roleName(user)},${requestId})`;
    await tx`delete from operations.vehicles where id=${id}::uuid`;
    return{id,vin:vehicle.vin};
  });
}

async function dashboardVehicles(user:SessionUser,query:any){
  const locationCode=text(query.locationCode),metric=text(query.metric); const statusMap:Record<string,string>={available:'available_for_sale',reserved:'reserved',under_delivery:'under_delivery',delivered:'delivered',has_notes:'has_notes'};
  const params:Record<string,any>={...query,limit:5000,page:1}; if(locationCode){const sql=getSql();const [l]=await sql<any[]>`select id::text from operations.locations where code=${locationCode}`;if(l)params.location=l.id;}
  if(statusMap[metric])params.status=statusMap[metric];
  if(metric==='actual') params.inventoryOnly='1';
  const result:any=await listVehicles(user,params,false); if(metric==='actual')result.rows=Array.from(result.rows).filter((r:any)=>!['under_delivery','delivered'].includes(r.status_code)); return {...result,total:result.rows.length};
}

export default async function handler(request:VercelRequest,response:VercelResponse){
  const requestId=makeRequestId(); response.setHeader('Cache-Control','no-store');
  try{
    await ensureTrackingSchema();
    await ensureOperationsSchema();
    const action=text(queryValue(request,'action'))||'meta';
    let user:SessionUser|null=null;
    if(action==='meta'||action==='vehicles'||action==='vehicle'||action==='transfers'||action==='approvals'||action==='movements'||action==='dashboard-vehicles'||action==='dashboard-requests') user=await requireOpsView(request,response);
    else { const permission:Record<string,string>={saveVehicle:text(bodyOf(request).id)?'operations.vehicle.edit':'operations.vehicle.create',movement:'operations.movement.execute',createTransfer:'operations.transfer.create',advanceTransfer:'operations.transfer.advance',deleteTransfer:'operations.transfer.cancel',cancelTransfer:'operations.transfer.cancel',approval:text(bodyOf(request).action)==='reset'?'operations.approval.reset':text(bodyOf(request).type)==='financial'?'operations.approval.financial':'operations.approval.administrative',archive:'operations.vehicle.archive',deleteVehicle:'operations.vehicle.delete',importVehicles:'operations.import'}; user=await requirePermission(request,response,permission[action]||'operations.view'); }
    if(!user)return;
    if(request.method==='GET'){
      if(action==='meta')return response.json({ok:true,...await listMeta(user)});
      if(action==='vehicles')return response.json({ok:true,...await listVehicles(user,request.query,text(queryValue(request,'archived'))==='1')});
      if(action==='vehicle')return response.json({ok:true,...await vehicleDetails(user,text(queryValue(request,'id')))});
      if(action==='transfers')return response.json({ok:true,requests:await listTransfers(user,request.query)});
      if(action==='approvals')return response.json({ok:true,vehicles:await listApprovals(user,text(queryValue(request,'filter')))});
      if(action==='movements')return response.json({ok:true,movements:await listMovements(user,request.query)});
      if(action==='dashboard-vehicles')return response.json({ok:true,...await dashboardVehicles(user,request.query)});
      if(action==='dashboard-requests')return response.json({ok:true,requests:await listTransfers(user,{tab:text(queryValue(request,'tab'))||'active',type:text(queryValue(request,'type'))})});
      return response.status(404).json({ok:false,code:'NOT_FOUND',error:'الإجراء غير موجود',requestId});
    }
    if(request.method!=='POST')return response.status(405).json({ok:false,error:'Method not allowed'}); const payload=bodyOf(request);
    if(action==='saveVehicle')return response.status(text(payload.id)?200:201).json({ok:true,vehicle:await saveVehicle(user,payload)});
    if(action==='movement')return response.status(201).json({ok:true,result:await executeMovement(user,payload,requestId)});
    if(action==='createTransfer')return response.status(201).json({ok:true,request:await createTransfer(user,payload)});
    if(action==='advanceTransfer')return response.json({ok:true,request:await advanceTransfer(user,payload)});
    if(action==='deleteTransfer')return response.json({ok:true,result:await deleteTransfer(user,payload)});
    if(action==='cancelTransfer')return response.json({ok:true,result:await cancelTransfer(user,payload)});
    if(action==='approval')return response.json({ok:true,cycle:await approvalAction(user,payload,requestId)});
    if(action==='archive')return response.json({ok:true,result:await archiveVehicle(user,payload)});
    if(action==='deleteVehicle')return response.json({ok:true,result:await deleteVehicle(user,payload,requestId)});
    if(action==='importVehicles')return response.json({ok:true,...await importVehicles(user,payload)});
    return response.status(404).json({ok:false,code:'NOT_FOUND',error:'الإجراء غير موجود',requestId});
  }catch(error:any){
    if(error instanceof ApiError)return response.status(error.status).json({ok:false,code:error.code,error:error.message,fieldErrors:error.fieldErrors,requestId});
    console.error('Operations API failure',{requestId,error}); return response.status(500).json({ok:false,code:'DATABASE_ERROR',error:'تعذر تنفيذ العملية بسبب خطأ في قاعدة البيانات',requestId});
  }
}
