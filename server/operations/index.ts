import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { assertPermission, hasPermission, isSystemAdmin, requireOperationsUser } from "../_operations-auth.js";
import { OperationsError, operationsRequestId, sendOperationsError } from "../_operations-errors.js";
import type { SessionUser } from "../_auth.js";

const CHECK_ITEMS = [
  ["mats", "فرشات"], ["extinguisher", "طفاية"], ["bag", "شنطة"], ["spare", "اسبير"], ["remote", "ريموت"],
  ["screen", "شاشة"], ["recorder", "مسجل"], ["ac", "مكيف"], ["camera", "كاميرا"], ["sensor", "حساس"],
] as const;

function clean(value: unknown) { return String(value ?? "").trim(); }
function integer(value: unknown, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.trunc(n) : fallback; }
function bodyOf(request: VercelRequest) {
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return request.body || {};
}
function ids(value: unknown) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map(clean).filter(Boolean)));
}
function branchScope(sql: any, user: SessionUser, alias = "b") {
  if (isSystemAdmin(user)) return sql``;
  if (!user.branchCodes.length) return sql`and false`;
  return sql`and ${sql(alias)}.code in ${sql(user.branchCodes)}`;
}
function statusLabel(code: string) {
  return ({ available_for_sale: "متاح للبيع", reserved: "حجز", has_notes: "بها ملاحظات", under_delivery: "مباع تحت التسليم", delivered: "مباع تم التسليم" } as Record<string,string>)[code] || code;
}
function stageLabel(code: string) {
  return ({ request_received: "تم استلام الطلب", vehicle_sent: "تم إرسال السيارة", vehicle_received: "تم استلام السيارة", completed: "تم الانتهاء", cancelled: "ملغي" } as Record<string,string>)[code] || code;
}
function nextRequestNo(prefix = "TR") { return `${prefix}-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`; }
function nextBatchNo() { return `MOV-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`; }

async function readVehicle(sql: any, id: string, lock = false) {
  const rows = await sql<any[]>`
    select v.*,v.id::text,l.code as location_code,l.name as location_name,b.code as branch_code,b.name as branch_name,
      s.name as status_name,s.requires_note,s.counts_in_actual_inventory
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join core.branches b on b.id=v.branch_id
    left join operations.vehicle_statuses s on s.code=v.status_code
    where v.id=${id}::uuid and v.is_deleted=false
    ${lock ? sql`for update` : sql``}
  `;
  return rows[0];
}

function assertVehicleScope(user: SessionUser, vehicle: any) {
  if (isSystemAdmin(user)) return;
  if (!vehicle?.branch_code || !user.branchCodes.includes(vehicle.branch_code)) {
    throw new OperationsError(403, "FORBIDDEN", "السيارة خارج نطاق الفروع المسموح بها");
  }
}

async function currentApproval(sql: any, vehicleId: string, lock = false) {
  const rows = await sql<any[]>`
    select *,id::text from operations.vehicle_approvals
    where vehicle_id=${vehicleId}::uuid and is_current=true
    order by cycle_no desc limit 1
    ${lock ? sql`for update` : sql``}
  `;
  return rows[0];
}

async function ensureApprovalCycle(tx: any, vehicleId: string) {
  const existing = await currentApproval(tx, vehicleId, true);
  if (existing) return existing;
  const [last] = await tx<any[]>`select coalesce(max(cycle_no),0)::int as cycle_no from operations.vehicle_approvals where vehicle_id=${vehicleId}::uuid`;
  const [created] = await tx<any[]>`
    insert into operations.vehicle_approvals(vehicle_id,cycle_no,is_current,financial_approved,administrative_approved)
    values (${vehicleId}::uuid,${Number(last?.cycle_no || 0)+1},true,false,false)
    returning *,id::text
  `;
  return created;
}

async function createNewApprovalCycle(tx: any, vehicleId: string) {
  await tx`update operations.vehicle_approvals set is_current=false,updated_at=now() where vehicle_id=${vehicleId}::uuid and is_current=true`;
  return ensureApprovalCycle(tx, vehicleId);
}

async function assertStatus(tx: any, statusCode: string, note?: string) {
  const [status] = await tx<any[]>`select * from operations.vehicle_statuses where code=${statusCode} and is_active=true`;
  if (!status) throw new OperationsError(400, "VALIDATION_ERROR", "حالة السيارة غير صحيحة", { fieldErrors: { statusCode: "اختر حالة صحيحة" } });
  if (status.requires_note && !clean(note)) throw new OperationsError(400, "VALIDATION_ERROR", "ملاحظات الحالة مطلوبة", { fieldErrors: { statusNote: "ملاحظات الحالة مطلوبة" } });
  return status;
}

async function assertDeliveredAllowed(tx: any, vehicleId: string) {
  const approval = await currentApproval(tx, vehicleId, true);
  if (!approval?.financial_approved || !approval?.administrative_approved) {
    const missing = [!approval?.financial_approved ? "الموافقة المالية" : "", !approval?.administrative_approved ? "الموافقة الإدارية" : ""].filter(Boolean).join(" و");
    throw new OperationsError(409, "APPROVALS_REQUIRED", `لا يمكن تغيير الحالة إلى «مباع تم التسليم» قبل اكتمال ${missing || "الموافقتين"}`);
  }
}

async function audit(tx: any, user: SessionUser, action: string, entityType: string, entityId: string, beforeData: unknown, afterData: unknown) {
  await tx`
    insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data)
    values (${user.id}::uuid,'operations',${action},${entityType},${entityId},${tx.json(beforeData || {})},${tx.json(afterData || {})})
  `;
}

async function outbox(tx: any, eventType: string, entityType: string, entityId: string, payload: unknown) {
  await tx`insert into operations.event_outbox(event_type,entity_type,entity_id,aggregate_type,aggregate_id,payload) values (${eventType},${entityType},${entityId},${entityType},${entityId},${tx.json(payload || {})})`;
}

async function listMeta(sql: any, user: SessionUser) {
  const [locations, statuses, branches] = await Promise.all([
    sql<any[]>`select id::text,code,name,sort_order from operations.locations where is_active=true order by sort_order,name`,
    sql<any[]>`select code,name,requires_note,counts_in_actual_inventory,is_terminal,sort_order from operations.vehicle_statuses where is_active=true order by sort_order`,
    isSystemAdmin(user)
      ? sql<any[]>`select id::text,code,name from core.branches where is_active=true order by sort_order,name`
      : sql<any[]>`select id::text,code,name from core.branches where is_active=true and code in ${sql(user.branchCodes)} order by sort_order,name`,
  ]);
  return { locations, statuses, branches, checkItems: CHECK_ITEMS.map(([code,name]) => ({ code,name })), permissions: user.permissionCodes, systemAdmin: isSystemAdmin(user) };
}

async function listVehicles(sql: any, user: SessionUser, query: Record<string, unknown>) {
  const search = clean(query.search);
  const status = clean(query.status);
  const location = clean(query.location);
  const branch = clean(query.branch);
  const archived = clean(query.archived);
  const page = Math.max(1, integer(query.page, 1));
  const pageSize = Math.min(5000, Math.max(1, integer(query.pageSize, 25)));
  const offset = (page - 1) * pageSize;
  const scope = branchScope(sql,user,"b");
  const searchTerm = `%${search}%`;
  const archivedFilter = archived === "true" ? sql`and v.archived_at is not null` : archived === "all" ? sql`` : sql`and v.archived_at is null`;

  const baseFilter = sql`
    v.is_deleted=false
    ${archivedFilter}
    ${search ? sql`and (v.vin ilike ${searchTerm} or coalesce(v.car_name,'') ilike ${searchTerm} or coalesce(v.statement,'') ilike ${searchTerm} or coalesce(v.plate_no,'') ilike ${searchTerm})` : sql``}
    ${status ? sql`and v.status_code=${status}` : sql``}
    ${location ? sql`and l.code=${location}` : sql``}
    ${branch ? sql`and b.code=${branch}` : sql``}
    ${scope}
  `;

  const [countRow] = await sql<any[]>`
    select count(*)::int as total
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join core.branches b on b.id=v.branch_id
    where ${baseFilter}
  `;

  const rows = await sql<any[]>`
    select v.id::text,v.vin,v.car_name,v.statement,v.agent_name,v.interior_color,v.exterior_color,v.model_year,v.plate_no,v.batch_no,
      v.status_code,s.name as status_name,v.status_note,v.shortage_location_note,v.notes,v.has_notes,v.archived_at,v.archive_reason,
      l.id::text as location_id,l.code as location_code,l.name as location_name,
      b.id::text as branch_id,b.code as branch_code,b.name as branch_name,
      a.financial_approved,a.administrative_approved,a.financial_note,a.administrative_note,
      tr.id as tracking_order_id,tr.sales_order_no as tracking_order_no,tr.status as tracking_status,tr.progress as tracking_progress,tr.is_archived as tracking_archived
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join core.branches b on b.id=v.branch_id
    left join operations.vehicle_statuses s on s.code=v.status_code
    left join operations.vehicle_approvals a on a.vehicle_id=v.id and a.is_current=true
    left join lateral (
      select o.id::text,o.sales_order_no,o.status,o.is_archived,
        case when count(vs.id)=0 then 0 else round((count(vs.id) filter(where vs.status='completed')::numeric/count(vs.id)::numeric)*100)::int end as progress
      from tracking.order_vehicles tov
      join tracking.orders o on o.id=tov.order_id and coalesce(o.is_deleted,false)=false
      left join tracking.vehicle_stages vs on vs.vehicle_id=tov.id
      where tov.operations_vehicle_id=v.id or (tov.operations_vehicle_id is null and tov.vin=v.vin)
      group by o.id,o.sales_order_no,o.status,o.is_archived,o.updated_at
      order by (case when o.is_archived=false and o.status<>'completed' then 0 else 1 end),o.updated_at desc
      limit 1
    ) tr on true
    where ${baseFilter}
    order by v.updated_at desc,v.created_at desc
    limit ${pageSize} offset ${offset}
  `;
  return { rows, total: Number(countRow?.total || 0), page, pageSize };
}

async function vehicleDetail(sql: any, user: SessionUser, id: string) {
  const vehicle = await readVehicle(sql,id);
  if (!vehicle) throw new OperationsError(404,"VEHICLE_NOT_FOUND","السيارة غير موجودة");
  assertVehicleScope(user,vehicle);
  const [checks,checkHistory,statusNotes,approvals,approvalEvents,movements,requests,tracking] = await Promise.all([
    sql<any[]>`select * from operations.vehicle_check_items where vehicle_id=${id}::uuid order by item_name`,
    sql<any[]>`select * from operations.vehicle_check_history where vehicle_id=${id}::uuid order by created_at desc limit 100`,
    sql<any[]>`select * from operations.vehicle_status_notes where vehicle_id=${id}::uuid order by created_at desc limit 100`,
    sql<any[]>`select *,id::text from operations.vehicle_approvals where vehicle_id=${id}::uuid order by cycle_no desc`,
    sql<any[]>`select e.* from operations.approval_events e where e.vehicle_id=${id}::uuid order by e.created_at desc limit 100`,
    sql<any[]>`select m.*,m.id::text,fl.name as from_location_name,tl.name as to_location_name from operations.movements m left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id where m.vehicle_id=${id}::uuid order by m.created_at desc limit 100`,
    sql<any[]>`select r.*,r.id::text from operations.transfer_requests r join operations.transfer_request_vehicles rv on rv.transfer_request_id=r.id where rv.vehicle_id=${id}::uuid and r.deleted_at is null order by r.requested_at desc`,
    sql<any[]>`select o.id::text,o.sales_order_no,o.status,o.is_archived,o.created_at,o.updated_at from tracking.order_vehicles tv join tracking.orders o on o.id=tv.order_id where (tv.operations_vehicle_id=${id}::uuid or tv.vin=${vehicle.vin}) and coalesce(o.is_deleted,false)=false order by o.updated_at desc`,
  ]);
  return { vehicle, checks, checkHistory, statusNotes, approvals, approvalEvents, movements, requests, tracking };
}

async function saveVehicle(sql: any, user: SessionUser, data: any, requestId: string) {
  assertPermission(user,"operations.vehicle.manage");
  const id = clean(data.id);
  const vin = clean(data.vin);
  if (!vin) throw new OperationsError(400,"VALIDATION_ERROR","رقم الهيكل مطلوب",{fieldErrors:{vin:"رقم الهيكل مطلوب"}});
  const statusCode = clean(data.statusCode) || "available_for_sale";
  const statusNote = clean(data.statusNote);
  const locationId = clean(data.locationId) || null;
  const branchId = clean(data.branchId) || null;
  await assertStatus(sql,statusCode,statusNote);
  if (!isSystemAdmin(user) && branchId) {
    const [branch] = await sql<any[]>`select code from core.branches where id=${branchId}::uuid`;
    if (!branch || !user.branchCodes.includes(branch.code)) throw new OperationsError(403,"FORBIDDEN","لا يمكنك ربط السيارة بهذا الفرع");
  }
  try {
    return await sql.begin(async (tx: any) => {
      if (id) {
        const before = await readVehicle(tx,id,true);
        if (!before) throw new OperationsError(404,"VEHICLE_NOT_FOUND","السيارة غير موجودة");
        assertVehicleScope(user,before);
        const [duplicate] = await tx<any[]>`select id::text from operations.vehicles where vin=${vin} and id<>${id}::uuid and is_deleted=false`;
        if (duplicate) throw new OperationsError(409,"DUPLICATE_VIN","رقم الهيكل موجود بالفعل");
        const [updated] = await tx<any[]>`
          update operations.vehicles set
            vin=${vin},car_name=${clean(data.carName)||null},statement=${clean(data.statement)||null},agent_name=${clean(data.agentName)||null},
            interior_color=${clean(data.interiorColor)||null},exterior_color=${clean(data.exteriorColor)||null},model_year=${clean(data.modelYear)||null},
            plate_no=${clean(data.plateNo)||null},batch_no=${clean(data.batchNo)||null},notes=${clean(data.notes)||null},
            shortage_location_note=${clean(data.shortageLocationNote)||null},branch_id=${branchId}::uuid,updated_by=${user.id}::uuid,updated_at=now()
          where id=${id}::uuid returning *,id::text
        `;
        await audit(tx,user,"vehicle_updated","vehicle",id,before,updated);
        return updated;
      }
      const [duplicate] = await tx<any[]>`select id::text from operations.vehicles where vin=${vin} and is_deleted=false`;
      if (duplicate) throw new OperationsError(409,"DUPLICATE_VIN","رقم الهيكل موجود بالفعل");
      const [created] = await tx<any[]>`
        insert into operations.vehicles(
          vin,car_name,statement,agent_name,interior_color,exterior_color,model_year,plate_no,batch_no,location_id,branch_id,status_code,status_note,
          shortage_location_note,source_type,has_notes,notes,created_by,updated_by
        ) values (
          ${vin},${clean(data.carName)||null},${clean(data.statement)||null},${clean(data.agentName)||null},${clean(data.interiorColor)||null},${clean(data.exteriorColor)||null},
          ${clean(data.modelYear)||null},${clean(data.plateNo)||null},${clean(data.batchNo)||null},${locationId}::uuid,${branchId}::uuid,${statusCode},${statusNote||null},
          ${clean(data.shortageLocationNote)||null},${clean(data.sourceType)||null},${statusCode==='has_notes'},${clean(data.notes)||null},${user.id}::uuid,${user.id}::uuid
        ) returning *,id::text
      `;
      if (statusCode === "under_delivery") await createNewApprovalCycle(tx,created.id);
      if (statusNote) await tx`insert into operations.vehicle_status_notes(vehicle_id,status_code,note,created_by,created_by_name) values (${created.id}::uuid,${statusCode},${statusNote},${user.id}::uuid,${user.fullName})`;
      await audit(tx,user,"vehicle_created","vehicle",created.id,{},created);
      await outbox(tx,"operations.vehicle.created","vehicle",created.id,{vin,requestId});
      return created;
    });
  } catch (error) { throw error; }
}

async function performMovement(sql: any, user: SessionUser, data: any, requestId: string) {
  assertPermission(user,"operations.movement.create");
  const vehicleInputs = Array.isArray(data.vehicles) ? data.vehicles : [];
  const vehicleIds = ids(vehicleInputs.map((item:any)=>item.id));
  if (!vehicleIds.length) throw new OperationsError(400,"VALIDATION_ERROR","اختر سيارة واحدة على الأقل");
  const toLocationId = clean(data.toLocationId);
  const toStatusCode = clean(data.toStatusCode);
  if (!toLocationId || !toStatusCode) throw new OperationsError(400,"VALIDATION_ERROR","اختر المكان والحالة الجديدة");
  const status = await assertStatus(sql,toStatusCode,vehicleInputs.length===1 ? clean(vehicleInputs[0]?.statusNote) : "placeholder");
  if (status.requires_note && vehicleInputs.some((item:any)=>!clean(item.statusNote))) throw new OperationsError(400,"VALIDATION_ERROR","ملاحظات الحالة مطلوبة لكل سيارة");
  const idempotencyKey = clean(data.idempotencyKey) || requestId;
  return sql.begin(async (tx:any) => {
    const [duplicate] = await tx<any[]>`select b.id::text,b.batch_no from operations.movement_batches b join operations.movements m on m.batch_id=b.id where m.idempotency_key like ${`${idempotencyKey}:%`} limit 1`;
    if (duplicate) return { duplicate:true,batchId:duplicate.id,batchNo:duplicate.batch_no };
    const [destination] = await tx<any[]>`select id::text,code,name from operations.locations where id=${toLocationId}::uuid and is_active=true`;
    if (!destination) throw new OperationsError(400,"INVALID_DESTINATION_LOCATION","المكان الجديد غير صحيح");
    const rows = await tx<any[]>`
      select v.*,v.id::text,l.code as location_code,l.name as location_name,b.code as branch_code,b.name as branch_name
      from operations.vehicles v left join operations.locations l on l.id=v.location_id left join core.branches b on b.id=v.branch_id
      where v.id in ${tx(vehicleIds)} and v.is_deleted=false for update
    `;
    if (rows.length !== vehicleIds.length) throw new OperationsError(404,"VEHICLE_NOT_FOUND","تعذر العثور على إحدى السيارات المختارة");
    rows.forEach((vehicle:any)=>assertVehicleScope(user,vehicle));
    const batchNo = nextBatchNo();
    const [batch] = await tx<any[]>`insert into operations.movement_batches(batch_no,vehicle_count,destination_location_id,new_status,to_location_id,to_status_code,general_note,performed_by,performed_by_name) values (${batchNo},${rows.length},${toLocationId}::uuid,${toStatusCode},${toLocationId}::uuid,${toStatusCode},${clean(data.generalNote)||null},${user.id}::uuid,${user.fullName}) returning id::text,batch_no`;
    const movements:any[]=[];
    for (const vehicle of rows) {
      if (vehicle.status_code === "delivered" && toStatusCode !== "delivered") throw new OperationsError(409,"INVALID_STATUS_TRANSITION",`السيارة ${vehicle.vin} تم تسليمها ولا يمكن تحريكها بهذا الفلو`);
      if (toStatusCode === "delivered") await assertDeliveredAllowed(tx,vehicle.id);
      const input = vehicleInputs.find((item:any)=>clean(item.id)===vehicle.id) || {};
      const before = {...vehicle};
      const after = {...vehicle,location_id:toLocationId,status_code:toStatusCode,status_note:clean(input.statusNote)||null,shortage_location_note:clean(input.shortageLocationNote)||null};
      const [movement] = await tx<any[]>`
        insert into operations.movements(batch_id,vehicle_id,from_location_id,to_location_id,old_status,new_status,note,status_note,shortage_location_note,performed_by,performed_by_name,before_data,after_data,idempotency_key)
        values (${batch.id}::uuid,${vehicle.id}::uuid,${vehicle.location_id}::uuid,${toLocationId}::uuid,${vehicle.status_code},${toStatusCode},${clean(input.note)||clean(data.generalNote)||null},${clean(input.statusNote)||null},${clean(input.shortageLocationNote)||null},${user.id}::uuid,${user.fullName},${tx.json(before)},${tx.json(after)},${`${idempotencyKey}:${vehicle.id}`})
        returning *,id::text
      `;
      await tx`update operations.vehicles set location_id=${toLocationId}::uuid,status_code=${toStatusCode},status_note=${clean(input.statusNote)||null},shortage_location_note=${clean(input.shortageLocationNote)||null},has_notes=${toStatusCode==='has_notes'},updated_by=${user.id}::uuid,updated_at=now() where id=${vehicle.id}::uuid`;
      if (toStatusCode === "under_delivery" && vehicle.status_code !== "under_delivery") await createNewApprovalCycle(tx,vehicle.id);
      if (clean(input.statusNote)) await tx`insert into operations.vehicle_status_notes(vehicle_id,status_code,note,movement_id,created_by,created_by_name) values (${vehicle.id}::uuid,${toStatusCode},${clean(input.statusNote)},${movement.id}::uuid,${user.id}::uuid,${user.fullName})`;
      if (Array.isArray(input.checks) && vehicle.location_code === "agency") {
        for (const check of input.checks) {
          const code=clean(check.code); const definition=CHECK_ITEMS.find(([itemCode])=>itemCode===code); if(!definition) continue;
          const [previous] = await tx<any[]>`select * from operations.vehicle_check_items where vehicle_id=${vehicle.id}::uuid and item_code=${code}`;
          await tx`insert into operations.vehicle_check_items(vehicle_id,item_code,item_name,status,note,updated_by,updated_by_name,updated_at) values (${vehicle.id}::uuid,${code},${definition[1]},${clean(check.status)||'not_checked'},${clean(check.note)||null},${user.id}::uuid,${user.fullName},now()) on conflict(vehicle_id,item_code) do update set status=excluded.status,note=excluded.note,updated_by=excluded.updated_by,updated_by_name=excluded.updated_by_name,updated_at=now()`;
          await tx`insert into operations.vehicle_check_history(vehicle_id,item_code,item_name,old_status,new_status,note,movement_id,actor_id,actor_name) values (${vehicle.id}::uuid,${code},${definition[1]},${previous?.status||null},${clean(check.status)||'not_checked'},${clean(check.note)||null},${movement.id}::uuid,${user.id}::uuid,${user.fullName})`;
        }
      }
      await audit(tx,user,"vehicle_moved","vehicle",vehicle.id,before,after);
      await outbox(tx,"operations.vehicle.moved","vehicle",vehicle.id,{vin:vehicle.vin,batchId:batch.id,batchNo,requestId});
      movements.push(movement);
    }
    return { batchId:batch.id,batchNo,movements };
  });
}

async function createTransfer(sql:any,user:SessionUser,data:any,requestId:string) {
  assertPermission(user,"operations.transfer.create");
  const vehicleIds=ids(data.vehicleIds); const destinationLocationId=clean(data.destinationLocationId); const requestType=clean(data.requestType)==='photo'?'photo':'transfer';
  if(!vehicleIds.length) throw new OperationsError(400,"VALIDATION_ERROR","اختر سيارة واحدة على الأقل");
  if(requestType==='transfer'&&!destinationLocationId) throw new OperationsError(400,"VALIDATION_ERROR","اختر المكان المستهدف");
  const idempotencyKey=clean(data.idempotencyKey)||requestId;
  return sql.begin(async(tx:any)=>{
    const [existing]=await tx<any[]>`select id::text,request_no from operations.transfer_requests where idempotency_key=${idempotencyKey} and deleted_at is null`;
    if(existing) return {duplicate:true,id:existing.id,requestNo:existing.request_no};
    const vehicles=await tx<any[]>`select v.*,v.id::text,l.code as location_code,l.name as location_name,b.code as branch_code,b.name as branch_name from operations.vehicles v left join operations.locations l on l.id=v.location_id left join core.branches b on b.id=v.branch_id where v.id in ${tx(vehicleIds)} and v.is_deleted=false for update`;
    if(vehicles.length!==vehicleIds.length) throw new OperationsError(404,"VEHICLE_NOT_FOUND","تعذر العثور على إحدى السيارات المختارة");
    vehicles.forEach((vehicle:any)=>assertVehicleScope(user,vehicle));
    const conflicts=await tx<any[]>`select rv.vehicle_id::text,r.request_no from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id where rv.vehicle_id in ${tx(vehicleIds)} and r.deleted_at is null and r.cancelled_at is null and r.current_stage not in ('completed','cancelled')`;
    if(conflicts.length) throw new OperationsError(409,"DUPLICATE_ACTIVE_REQUEST",`توجد سيارة مرتبطة بطلب جارٍ: ${conflicts[0].request_no}`);
    let destination:any=null;
    if(destinationLocationId){[destination]=await tx<any[]>`select id::text,code,name from operations.locations where id=${destinationLocationId}::uuid and is_active=true`; if(!destination) throw new OperationsError(400,"INVALID_DESTINATION_LOCATION","المكان المستهدف غير صحيح");}
    if(requestType==='transfer'&&vehicles.every((vehicle:any)=>vehicle.location_id===destinationLocationId)) throw new OperationsError(409,"INVALID_DESTINATION_LOCATION","المكان المستهدف مطابق للمكان الحالي لكل السيارات");
    const requestNo=nextRequestNo(requestType==='photo'?'PH':'TR');
    const [requestRow]=await tx<any[]>`insert into operations.transfer_requests(request_no,department_code,transfer_type,request_type,source_location_id,destination_location_id,status,current_stage,requested_by,requested_by_name,requested_at,notes,idempotency_key) values (${requestNo},'operations',${requestType},${requestType},${vehicles[0]?.location_id}::uuid,${destinationLocationId}::uuid,'request_received','request_received',${user.id}::uuid,${user.fullName},now(),${clean(data.notes)||null},${idempotencyKey}) returning *,id::text`;
    for(const vehicle of vehicles){await tx`insert into operations.transfer_request_vehicles(transfer_request_id,vehicle_id,source_location_id,source_status_code,vehicle_snapshot) values (${requestRow.id}::uuid,${vehicle.id}::uuid,${vehicle.location_id}::uuid,${vehicle.status_code},${tx.json(vehicle)})`;}
    await tx`insert into operations.transfer_request_events(transfer_request_id,stage,stage_code,action,note,actor_id,actor_name,actor_branch_codes,after_data) values (${requestRow.id}::uuid,'request_received','request_received','created',${clean(data.notes)||null},${user.id}::uuid,${user.fullName},${user.branchCodes}::text[],${tx.json({vehicleIds,destinationLocationId,requestType})})`;
    await audit(tx,user,"transfer_request_created","transfer_request",requestRow.id,{},requestRow);
    await outbox(tx,requestType==='photo'?'operations.photo_request.created':'operations.transfer_request.created','transfer_request',requestRow.id,{requestNo,vehicleIds,requestId});
    return {id:requestRow.id,requestNo};
  });
}

async function transferAction(sql:any,user:SessionUser,data:any,requestId:string) {
  const action=clean(data.action); const requestIdValue=clean(data.requestId);
  if(!requestIdValue) throw new OperationsError(400,"VALIDATION_ERROR","رقم الطلب الداخلي مطلوب");
  if(action==='delete_transfer') assertPermission(user,"operations.transfer.delete");
  else if(action==='cancel_transfer') assertPermission(user,"operations.transfer.cancel");
  else assertPermission(user,"operations.transfer.progress");
  return sql.begin(async(tx:any)=>{
    const [requestRow]=await tx<any[]>`select r.*,r.id::text,sl.name as source_location_name,dl.name as destination_location_name from operations.transfer_requests r left join operations.locations sl on sl.id=r.source_location_id left join operations.locations dl on dl.id=r.destination_location_id where r.id=${requestIdValue}::uuid and r.deleted_at is null for update`;
    if(!requestRow) throw new OperationsError(404,"CONFLICT","طلب النقل غير موجود");
    const vehicles=await tx<any[]>`select v.*,v.id::text,b.code as branch_code,l.name as location_name from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id left join core.branches b on b.id=v.branch_id left join operations.locations l on l.id=v.location_id where rv.transfer_request_id=${requestIdValue}::uuid order by v.vin for update`;
    if(!isSystemAdmin(user)&&!vehicles.some((vehicle:any)=>vehicle.branch_code&&user.branchCodes.includes(vehicle.branch_code))) throw new OperationsError(403,"FORBIDDEN","طلب النقل خارج نطاق فروعك");
    if(action==='delete_transfer'){
      const [progressEvent]=await tx<any[]>`select id from operations.transfer_request_events where transfer_request_id=${requestIdValue}::uuid and action<>'created' limit 1`;
      if(progressEvent) throw new OperationsError(409,"CONFLICT","لا يمكن مسح الطلب بعد بدء تنفيذه؛ استخدم إلغاء الطلب");
      await tx`update operations.transfer_requests set deleted_at=now(),deleted_by=${user.id}::uuid,delete_reason=${clean(data.reason)||'حذف قبل بدء التنفيذ'} where id=${requestIdValue}::uuid`;
      await tx`insert into operations.transfer_request_events(transfer_request_id,stage,stage_code,action,note,actor_id,actor_name,actor_branch_codes,before_data) values (${requestIdValue}::uuid,${requestRow.current_stage},${requestRow.current_stage},'deleted',${clean(data.reason)||null},${user.id}::uuid,${user.fullName},${user.branchCodes}::text[],${tx.json(requestRow)})`;
      await audit(tx,user,"transfer_request_deleted","transfer_request",requestIdValue,requestRow,{deleted:true,reason:clean(data.reason)});
      return {message:"تم مسح طلب النقل قبل بدء التنفيذ"};
    }
    if(action==='cancel_transfer'){
      if(!clean(data.reason)) throw new OperationsError(400,"VALIDATION_ERROR","سبب الإلغاء مطلوب");
      if(['completed','cancelled'].includes(requestRow.current_stage)) throw new OperationsError(409,"CONFLICT","لا يمكن إلغاء هذا الطلب");
      await tx`update operations.transfer_requests set current_stage='cancelled',status='cancelled',cancelled_at=now(),cancelled_by=${user.id}::uuid,cancel_reason=${clean(data.reason)} where id=${requestIdValue}::uuid`;
      await tx`insert into operations.transfer_request_events(transfer_request_id,stage,stage_code,action,note,actor_id,actor_name,actor_branch_codes,before_data,after_data) values (${requestIdValue}::uuid,'cancelled','cancelled','cancelled',${clean(data.reason)},${user.id}::uuid,${user.fullName},${user.branchCodes}::text[],${tx.json(requestRow)},${tx.json({current_stage:'cancelled'})})`;
      await outbox(tx,"operations.transfer_request.cancelled","transfer_request",requestIdValue,{requestNo:requestRow.request_no,requestId});
      return {message:"تم إلغاء الطلب"};
    }
    const transitions:Record<string,{from:string,to:string}>={send_vehicle:{from:'request_received',to:'vehicle_sent'},receive_vehicle:{from:'vehicle_sent',to:'vehicle_received'},complete_transfer:{from:'vehicle_received',to:'completed'}};
    const transition=transitions[action]; if(!transition) throw new OperationsError(400,"VALIDATION_ERROR","الإجراء غير مدعوم");
    if(requestRow.current_stage!==transition.from) throw new OperationsError(409,"CONFLICT",`المرحلة الحالية هي «${stageLabel(requestRow.current_stage)}» ولا تسمح بهذا الإجراء`);
    if(action==='receive_vehicle'){
      if(!requestRow.destination_location_id) throw new OperationsError(409,"INVALID_DESTINATION_LOCATION","الطلب لا يحتوي على مكان مستهدف");
      const batchNo=nextBatchNo();
      const [batch]=await tx<any[]>`insert into operations.movement_batches(batch_no,vehicle_count,destination_location_id,to_location_id,general_note,performed_by,performed_by_name) values (${batchNo},${vehicles.length},${requestRow.destination_location_id}::uuid,${requestRow.destination_location_id}::uuid,${`استلام من طلب ${requestRow.request_no}`},${user.id}::uuid,${user.fullName}) returning id::text`;
      for(const vehicle of vehicles){
        const before={...vehicle}; const after={...vehicle,location_id:requestRow.destination_location_id};
        await tx`insert into operations.movements(batch_id,request_id,transfer_request_id,vehicle_id,from_location_id,to_location_id,old_status,new_status,note,performed_by,performed_by_name,before_data,after_data,idempotency_key) values (${batch.id}::uuid,${requestIdValue},${requestIdValue}::uuid,${vehicle.id}::uuid,${vehicle.location_id}::uuid,${requestRow.destination_location_id}::uuid,${vehicle.status_code},${vehicle.status_code},${`استلام السيارة من طلب ${requestRow.request_no}`},${user.id}::uuid,${user.fullName},${tx.json(before)},${tx.json(after)},${`transfer:${requestIdValue}:receive:${vehicle.id}`})`;
        await tx`update operations.vehicles set location_id=${requestRow.destination_location_id}::uuid,updated_by=${user.id}::uuid,updated_at=now() where id=${vehicle.id}::uuid`;
      }
    }
    await tx`update operations.transfer_requests set current_stage=${transition.to},status=${transition.to},completed_at=${transition.to==='completed'?tx`now()`:null} where id=${requestIdValue}::uuid`;
    await tx`insert into operations.transfer_request_events(transfer_request_id,stage,stage_code,action,note,actor_id,actor_name,actor_branch_codes,before_data,after_data) values (${requestIdValue}::uuid,${transition.to},${transition.to},${action},${clean(data.note)||null},${user.id}::uuid,${user.fullName},${user.branchCodes}::text[],${tx.json(requestRow)},${tx.json({current_stage:transition.to})})`;
    await audit(tx,user,`transfer_request_${transition.to}`,"transfer_request",requestIdValue,requestRow,{current_stage:transition.to});
    await outbox(tx,`operations.transfer_request.${transition.to}`,"transfer_request",requestIdValue,{requestNo:requestRow.request_no,requestId});
    return {message:`تم تحديث الطلب إلى «${stageLabel(transition.to)}»`};
  });
}

async function listTransfers(sql:any,user:SessionUser,query:Record<string,unknown>) {
  assertPermission(user,"operations.transfer.view");
  const requestType=clean(query.requestType); const stage=clean(query.stage); const search=clean(query.search); const searchTerm=`%${search}%`; const page=Math.max(1,integer(query.page,1)); const pageSize=Math.min(1000,Math.max(1,integer(query.pageSize,25))); const offset=(page-1)*pageSize;
  const scope=isSystemAdmin(user)?sql``:user.branchCodes.length?sql`and exists(select 1 from operations.transfer_request_vehicles srv join operations.vehicles sv on sv.id=srv.vehicle_id left join core.branches sb on sb.id=sv.branch_id where srv.transfer_request_id=r.id and sb.code in ${sql(user.branchCodes)})`:sql`and false`;
  const filter=sql`r.deleted_at is null ${requestType?sql`and r.request_type=${requestType}`:sql``} ${stage?sql`and r.current_stage=${stage}`:sql``} ${search?sql`and (r.request_no ilike ${searchTerm} or coalesce(r.requested_by_name,'') ilike ${searchTerm} or exists(select 1 from operations.transfer_request_vehicles x join operations.vehicles xv on xv.id=x.vehicle_id where x.transfer_request_id=r.id and xv.vin ilike ${searchTerm}))`:sql``} ${scope}`;
  const [countRow]=await sql<any[]>`select count(*)::int as total from operations.transfer_requests r where ${filter}`;
  const rows=await sql<any[]>`
    select r.*,r.id::text,sl.name as source_location_name,dl.name as destination_location_name,
      count(rv.vehicle_id)::int as vehicles_count,string_agg(v.vin,', ' order by v.vin) as vins
    from operations.transfer_requests r
    left join operations.locations sl on sl.id=r.source_location_id left join operations.locations dl on dl.id=r.destination_location_id
    left join operations.transfer_request_vehicles rv on rv.transfer_request_id=r.id left join operations.vehicles v on v.id=rv.vehicle_id
    where ${filter}
    group by r.id,sl.name,dl.name order by r.requested_at desc limit ${pageSize} offset ${offset}
  `;
  return {rows,total:Number(countRow?.total||0),page,pageSize};
}

async function transferDetail(sql:any,user:SessionUser,id:string) {
  const [requestRow]=await sql<any[]>`select r.*,r.id::text,sl.name as source_location_name,dl.name as destination_location_name from operations.transfer_requests r left join operations.locations sl on sl.id=r.source_location_id left join operations.locations dl on dl.id=r.destination_location_id where r.id=${id}::uuid and r.deleted_at is null`;
  if(!requestRow) throw new OperationsError(404,"CONFLICT","الطلب غير موجود");
  const vehicles=await sql<any[]>`select v.id::text,v.vin,v.car_name,v.statement,v.model_year,v.interior_color,v.exterior_color,l.name as location_name,b.code as branch_code from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id left join operations.locations l on l.id=v.location_id left join core.branches b on b.id=v.branch_id where rv.transfer_request_id=${id}::uuid order by v.vin`;
  if(!isSystemAdmin(user)&&!vehicles.some((v:any)=>v.branch_code&&user.branchCodes.includes(v.branch_code))) throw new OperationsError(403,"FORBIDDEN","الطلب خارج نطاق فروعك");
  const events=await sql<any[]>`select * from operations.transfer_request_events where transfer_request_id=${id}::uuid order by created_at`;
  return {request:requestRow,vehicles,events};
}

async function listMovements(sql:any,user:SessionUser,query:Record<string,unknown>) {
  const search=clean(query.search); const fromDate=clean(query.fromDate); const toDate=clean(query.toDate); const fromLocation=clean(query.fromLocation); const toLocation=clean(query.toLocation); const status=clean(query.status); const page=Math.max(1,integer(query.page,1)); const pageSize=Math.min(5000,Math.max(1,integer(query.pageSize,25))); const offset=(page-1)*pageSize; const searchTerm=`%${search}%`; const scope=branchScope(sql,user,"b");
  const filter=sql`v.is_deleted=false ${search?sql`and (v.vin ilike ${searchTerm} or coalesce(v.car_name,'') ilike ${searchTerm} or coalesce(m.performed_by_name,'') ilike ${searchTerm})`:sql``} ${fromDate?sql`and m.created_at>=${fromDate}::date`:sql``} ${toDate?sql`and m.created_at<(${toDate}::date+interval '1 day')`:sql``} ${fromLocation?sql`and fl.code=${fromLocation}`:sql``} ${toLocation?sql`and tl.code=${toLocation}`:sql``} ${status?sql`and m.new_status=${status}`:sql``} ${scope}`;
  const [countRow]=await sql<any[]>`select count(*)::int as total from operations.movements m join operations.vehicles v on v.id=m.vehicle_id left join core.branches b on b.id=v.branch_id left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id where ${filter}`;
  const rows=await sql<any[]>`select m.*,m.id::text,v.vin,v.car_name,v.statement,v.model_year,fl.name as from_location_name,tl.name as to_location_name,b.name as branch_name from operations.movements m join operations.vehicles v on v.id=m.vehicle_id left join core.branches b on b.id=v.branch_id left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id where ${filter} order by m.created_at desc limit ${pageSize} offset ${offset}`;
  return {rows,total:Number(countRow?.total||0),page,pageSize};
}

async function listApprovals(sql:any,user:SessionUser,query:Record<string,unknown>) {
  assertPermission(user,"operations.approvals.view");
  const filter=clean(query.filter); const search=clean(query.search); const searchTerm=`%${search}%`; const scope=branchScope(sql,user,"b");
  const rows=await sql<any[]>`
    select v.id::text as vehicle_id,v.vin,v.car_name,v.statement,v.model_year,v.status_code,l.name as location_name,b.name as branch_name,
      a.id::text as approval_id,a.cycle_no,a.financial_approved,a.administrative_approved,a.financial_note,a.administrative_note,
      a.financial_approved_at,a.administrative_approved_at,fu.full_name as financial_approved_by_name,au.full_name as administrative_approved_by_name
    from operations.vehicles v
    join operations.vehicle_approvals a on a.vehicle_id=v.id and a.is_current=true
    left join operations.locations l on l.id=v.location_id left join core.branches b on b.id=v.branch_id
    left join core.users fu on fu.id=a.financial_approved_by left join core.users au on au.id=a.administrative_approved_by
    where v.is_deleted=false and v.archived_at is null and v.status_code='under_delivery'
      ${search?sql`and (v.vin ilike ${searchTerm} or coalesce(v.car_name,'') ilike ${searchTerm})`:sql``}
      ${filter==='missing_financial'?sql`and a.financial_approved=false`:filter==='missing_administrative'?sql`and a.administrative_approved=false`:filter==='completed'?sql`and a.financial_approved=true and a.administrative_approved=true`:sql``}
      ${scope}
    order by v.updated_at desc
  `;
  return {rows};
}

async function approvalAction(sql:any,user:SessionUser,data:any) {
  const type=clean(data.type); const action=clean(data.approvalAction); const vehicleId=clean(data.vehicleId); const note=clean(data.note);
  if(!vehicleId) throw new OperationsError(400,"VALIDATION_ERROR","السيارة مطلوبة");
  if(type==='financial') assertPermission(user,"operations.approvals.financial");
  else if(type==='administrative') assertPermission(user,"operations.approvals.administrative");
  else if(action==='reset') assertPermission(user,"operations.approvals.reset");
  else throw new OperationsError(400,"VALIDATION_ERROR","نوع الموافقة غير صحيح");
  return sql.begin(async(tx:any)=>{
    const vehicle=await readVehicle(tx,vehicleId,true); if(!vehicle) throw new OperationsError(404,"VEHICLE_NOT_FOUND","السيارة غير موجودة"); assertVehicleScope(user,vehicle);
    if(vehicle.status_code!=='under_delivery') throw new OperationsError(409,"VEHICLE_NOT_ELIGIBLE","الموافقات متاحة فقط لحالة مباع تحت التسليم");
    const approval=await ensureApprovalCycle(tx,vehicleId); const before={...approval};
    if(action==='reset'){
      await tx`update operations.vehicle_approvals set financial_approved=false,administrative_approved=false,financial_approved_by=null,administrative_approved_by=null,financial_approved_at=null,administrative_approved_at=null,updated_at=now() where id=${approval.id}::uuid`;
      await tx`insert into operations.approval_events(approval_id,vehicle_id,approval_type,action,note,actor_id,actor_name,before_data,after_data) values (${approval.id}::uuid,${vehicleId}::uuid,'all','reset',${note||null},${user.id}::uuid,${user.fullName},${tx.json(before)},${tx.json({financial_approved:false,administrative_approved:false})})`;
      return {message:"تم مسح الموافقتين مع الاحتفاظ بالسجل"};
    }
    if(!['approve','revert','note'].includes(action)) throw new OperationsError(400,"VALIDATION_ERROR","إجراء الموافقة غير صحيح");
    const approved=action==='approve'; const column=type==='financial'?'financial':'administrative';
    if(action==='note'){
      if(type==='financial') await tx`update operations.vehicle_approvals set financial_note=${note||null},updated_at=now() where id=${approval.id}::uuid`;
      else await tx`update operations.vehicle_approvals set administrative_note=${note||null},updated_at=now() where id=${approval.id}::uuid`;
    } else if(type==='financial') {
      await tx`update operations.vehicle_approvals set financial_approved=${approved},financial_approved_by=${approved?user.id:null}::uuid,financial_approved_at=${approved?tx`now()`:null},financial_reverted_by=${approved?null:user.id}::uuid,financial_reverted_at=${approved?null:tx`now()`},financial_note=coalesce(${note||null},financial_note),updated_at=now() where id=${approval.id}::uuid`;
    } else {
      await tx`update operations.vehicle_approvals set administrative_approved=${approved},administrative_approved_by=${approved?user.id:null}::uuid,administrative_approved_at=${approved?tx`now()`:null},administrative_reverted_by=${approved?null:user.id}::uuid,administrative_reverted_at=${approved?null:tx`now()`},administrative_note=coalesce(${note||null},administrative_note),updated_at=now() where id=${approval.id}::uuid`;
    }
    const after=await currentApproval(tx,vehicleId,false);
    await tx`insert into operations.approval_events(approval_id,vehicle_id,approval_type,action,note,actor_id,actor_name,before_data,after_data) values (${approval.id}::uuid,${vehicleId}::uuid,${type},${action==='approve'?'approved':action==='revert'?'reverted':'note_updated'},${note||null},${user.id}::uuid,${user.fullName},${tx.json(before)},${tx.json(after)})`;
    await audit(tx,user,`approval_${column}_${action}`,"vehicle",vehicleId,before,after);
    await outbox(tx,`operations.vehicle.approval_${action==='approve'?'granted':action==='revert'?'reversed':'updated'}`,"vehicle",vehicleId,{type,vin:vehicle.vin});
    return {message:action==='approve'?`تمت ${type==='financial'?'الموافقة المالية':'الموافقة الإدارية'}`:action==='revert'?`تم التراجع عن ${type==='financial'?'الموافقة المالية':'الموافقة الإدارية'}`:"تم حفظ الملاحظة"};
  });
}

async function archiveAction(sql:any,user:SessionUser,data:any) {
  assertPermission(user,"operations.archive.manage"); const vehicleId=clean(data.vehicleId); const action=clean(data.action); const reason=clean(data.reason);
  if(!vehicleId||!reason) throw new OperationsError(400,"VALIDATION_ERROR","السيارة وسبب الإجراء مطلوبان");
  return sql.begin(async(tx:any)=>{
    const vehicle=await readVehicle(tx,vehicleId,true); if(!vehicle) throw new OperationsError(404,"VEHICLE_NOT_FOUND","السيارة غير موجودة"); assertVehicleScope(user,vehicle);
    if(action==='restore'){
      await tx`update operations.vehicles set archived_at=null,archived_by=null,archive_reason=null,updated_by=${user.id}::uuid,updated_at=now() where id=${vehicleId}::uuid`;
      await tx`update operations.vehicle_archives set restored_by=${user.id}::uuid,restored_by_name=${user.fullName},restored_at=now(),restore_reason=${reason} where id=(select id from operations.vehicle_archives where vehicle_id=${vehicleId}::uuid and restored_at is null order by archived_at desc limit 1)`;
      await audit(tx,user,"vehicle_restored","vehicle",vehicleId,vehicle,{...vehicle,archived_at:null}); return {message:"تمت استعادة السيارة من الأرشيف"};
    }
    if(vehicle.status_code!=='delivered') throw new OperationsError(409,"VEHICLE_NOT_ELIGIBLE","لا يمكن أرشفة السيارة قبل حالة مباع تم التسليم");
    const approval=await currentApproval(tx,vehicleId,true); if(!approval?.financial_approved||!approval?.administrative_approved) throw new OperationsError(409,"APPROVALS_REQUIRED","لا يمكن الأرشفة قبل اكتمال الموافقتين");
    const [activeTransfer]=await tx<any[]>`select r.request_no from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id where rv.vehicle_id=${vehicleId}::uuid and r.deleted_at is null and r.cancelled_at is null and r.current_stage not in ('completed','cancelled') limit 1`;
    if(activeTransfer) throw new OperationsError(409,"CONFLICT",`السيارة مرتبطة بطلب جارٍ ${activeTransfer.request_no}`);
    const [incompleteTracking]=await tx<any[]>`select o.sales_order_no from tracking.order_vehicles tv join tracking.orders o on o.id=tv.order_id where (tv.operations_vehicle_id=${vehicleId}::uuid or tv.vin=${vehicle.vin}) and coalesce(o.is_deleted,false)=false and o.is_archived=false and o.status<>'completed' limit 1`;
    if(incompleteTracking) throw new OperationsError(409,"CONFLICT",`طلب التراكينج ${incompleteTracking.sales_order_no} غير مكتمل`);
    await tx`insert into operations.vehicle_archives(vehicle_id,reason,snapshot,archived_by,archived_by_name) values (${vehicleId}::uuid,${reason},${tx.json(vehicle)},${user.id}::uuid,${user.fullName})`;
    await tx`update operations.vehicles set archived_at=now(),archived_by=${user.id}::uuid,archive_reason=${reason},updated_by=${user.id}::uuid,updated_at=now() where id=${vehicleId}::uuid`;
    await audit(tx,user,"vehicle_archived","vehicle",vehicleId,vehicle,{...vehicle,archived_at:new Date().toISOString(),archive_reason:reason}); await outbox(tx,"operations.vehicle.archived","vehicle",vehicleId,{vin:vehicle.vin}); return {message:"تمت أرشفة السيارة"};
  });
}

async function deleteVehicle(sql:any,user:SessionUser,data:any,requestId:string) {
  assertPermission(user,"operations.vehicle.delete"); const vehicleId=clean(data.vehicleId); const reason=clean(data.reason); if(!vehicleId||!reason) throw new OperationsError(400,"VALIDATION_ERROR","سبب المسح مطلوب");
  return sql.begin(async(tx:any)=>{
    const vehicle=await readVehicle(tx,vehicleId,true); if(!vehicle) throw new OperationsError(404,"VEHICLE_NOT_FOUND","السيارة غير موجودة"); assertVehicleScope(user,vehicle);
    const [relations]=await tx<any[]>`
      select
        (select count(*) from operations.movements where vehicle_id=${vehicleId}::uuid)::int as movements,
        (select count(*) from operations.vehicle_approvals where vehicle_id=${vehicleId}::uuid)::int as approvals,
        (select count(*) from operations.vehicle_shortages where vehicle_id=${vehicleId}::uuid)::int as shortages,
        (select count(*) from operations.transfer_request_vehicles where vehicle_id=${vehicleId}::uuid)::int as requests,
        (select count(*) from operations.vehicle_check_items where vehicle_id=${vehicleId}::uuid)::int as checks,
        (select count(*) from operations.vehicle_status_notes where vehicle_id=${vehicleId}::uuid)::int as notes,
        (select count(*) from operations.vehicle_archives where vehicle_id=${vehicleId}::uuid)::int as archives,
        (select count(*) from tracking.order_vehicles where operations_vehicle_id=${vehicleId}::uuid or vin=${vehicle.vin})::int as tracking
    `;
    const counts=Object.entries(relations||{}).filter(([,value])=>Number(value)>0);
    if(counts.length) throw new OperationsError(409,"VEHICLE_HAS_HISTORY","السيارة لها تاريخ تشغيلي ولا يمكن مسحها؛ استخدم الأرشفة",{details:Object.fromEntries(counts)});
    await tx`insert into operations.vehicle_deletion_audit(vehicle_internal_id,vin,vehicle_snapshot,reason,deleted_by,deleted_by_name,deleted_by_email,deleted_by_roles,request_id) values (${vehicleId}::uuid,${vehicle.vin},${tx.json(vehicle)},${reason},${user.id}::uuid,${user.fullName},${user.email},${user.roleCodes}::text[],${requestId})`;
    await tx`delete from operations.vehicles where id=${vehicleId}::uuid`;
    await audit(tx,user,"vehicle_physically_deleted","vehicle",vehicleId,vehicle,{reason,requestId});
    return {message:"تم مسح السيارة نهائيًا"};
  });
}

async function importVehicles(sql:any,user:SessionUser,data:any) {
  assertPermission(user,"operations.import"); const mode=clean(data.mode); const rows=Array.isArray(data.rows)?data.rows:[]; if(!['replace','append','update'].includes(mode)) throw new OperationsError(400,"VALIDATION_ERROR","وضع الاستيراد غير صحيح"); if(!rows.length) throw new OperationsError(400,"IMPORT_VALIDATION_FAILED","لا توجد صفوف للاستيراد");
  return sql.begin(async(tx:any)=>{
    const [batch]=await tx<any[]>`insert into operations.import_batches(mode,file_name,total_rows,status,created_by,created_by_name) values (${mode},${clean(data.fileName)||null},${rows.length},'processing',${user.id}::uuid,${user.fullName}) returning id::text`;
    const seen=new Set<string>(); const report:any[]=[]; const fileVins:string[]=[]; let inserted=0,updated=0,skipped=0,failed=0;
    for(let index=0;index<rows.length;index++){
      const row=rows[index]||{}; const vin=clean(row.vin||row['رقم الهيكل']||row['الهيكل']); const rowNo=index+2; let result='failed',errorMessage='';
      try{
        if(!vin) throw new Error('رقم الهيكل مطلوب'); if(seen.has(vin)) throw new Error('رقم الهيكل مكرر داخل الملف'); seen.add(vin); fileVins.push(vin);
        const [existing]=await tx<any[]>`select *,id::text from operations.vehicles where vin=${vin} and is_deleted=false for update`;
        if(mode==='append'&&existing){result='skipped';skipped++;}
        else if(mode==='update'&&!existing){result='skipped';skipped++;}
        else if(existing){
          await tx`update operations.vehicles set car_name=coalesce(${clean(row.carName||row['السيارة'])||null},car_name),statement=coalesce(${clean(row.statement||row['البيان'])||null},statement),agent_name=coalesce(${clean(row.agentName||row['الوكيل'])||null},agent_name),interior_color=coalesce(${clean(row.interiorColor||row['اللون الداخلي'])||null},interior_color),exterior_color=coalesce(${clean(row.exteriorColor||row['اللون الخارجي'])||null},exterior_color),model_year=coalesce(${clean(row.modelYear||row['الموديل'])||null},model_year),plate_no=coalesce(${clean(row.plateNo||row['اللوحة'])||null},plate_no),batch_no=coalesce(${clean(row.batchNo||row['اسم الدفعة'])||null},batch_no),notes=coalesce(${clean(row.notes||row['ملاحظات'])||null},notes),updated_by=${user.id}::uuid,updated_at=now() where id=${existing.id}::uuid`; result='updated';updated++;
        } else {
          const statusCode=clean(row.statusCode)||'available_for_sale'; if(['under_delivery','delivered'].includes(statusCode)) throw new Error('حالات البيع لا تُستورد من الشيت وتُنفذ من الحركة والموافقات'); await assertStatus(tx,statusCode,clean(row.statusNote));
          await tx`insert into operations.vehicles(vin,car_name,statement,agent_name,interior_color,exterior_color,model_year,plate_no,batch_no,status_code,status_note,has_notes,notes,created_by,updated_by) values (${vin},${clean(row.carName||row['السيارة'])||null},${clean(row.statement||row['البيان'])||null},${clean(row.agentName||row['الوكيل'])||null},${clean(row.interiorColor||row['اللون الداخلي'])||null},${clean(row.exteriorColor||row['اللون الخارجي'])||null},${clean(row.modelYear||row['الموديل'])||null},${clean(row.plateNo||row['اللوحة'])||null},${clean(row.batchNo||row['اسم الدفعة'])||null},${statusCode},${clean(row.statusNote)||null},${statusCode==='has_notes'},${clean(row.notes||row['ملاحظات'])||null},${user.id}::uuid,${user.id}::uuid)`; result='inserted';inserted++;
        }
      }catch(error){errorMessage=error instanceof Error?error.message:'خطأ غير معروف';failed++;}
      report.push({rowNo,vin,result,error:errorMessage}); await tx`insert into operations.import_rows(batch_id,row_no,vin,payload,result,error_message) values (${batch.id}::uuid,${rowNo},${vin||null},${tx.json(row)},${result},${errorMessage||null})`;
    }
    if(mode==='replace'&&fileVins.length){
      await tx`update operations.vehicles set archived_at=coalesce(archived_at,now()),archive_reason=coalesce(archive_reason,'غير موجود في آخر استبدال كامل للمخزون'),archived_by=${user.id}::uuid,updated_at=now() where is_deleted=false and archived_at is null and vin not in ${tx(fileVins)}`;
    }
    await tx`update operations.import_batches set inserted_rows=${inserted},updated_rows=${updated},skipped_rows=${skipped},failed_rows=${failed},status='completed',completed_at=now() where id=${batch.id}::uuid`;
    await audit(tx,user,"vehicles_imported","import_batch",batch.id,{}, {mode,inserted,updated,skipped,failed}); return {batchId:batch.id,inserted,updated,skipped,failed,report};
  });
}

async function dashboardVehicles(sql:any,user:SessionUser,query:Record<string,unknown>) {
  const metric=clean(query.metric); const location=clean(query.location); const search=clean(query.search); const searchTerm=`%${search}%`; const scope=branchScope(sql,user,"b");
  const metricFilter=metric==='actual'?sql`and s.counts_in_actual_inventory=true`:metric==='under_delivery'?sql`and v.status_code='under_delivery'`:metric==='available_for_sale'?sql`and v.status_code='available_for_sale'`:metric==='reserved'?sql`and v.status_code='reserved'`:metric==='delivered'?sql`and v.status_code='delivered'`:metric==='has_notes'?sql`and v.status_code='has_notes'`:sql``;
  const rows=await sql<any[]>`select v.id::text,v.vin,v.car_name,v.statement,v.model_year,v.interior_color,v.exterior_color,l.name as location_name,s.name as status_name from operations.vehicles v left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code left join core.branches b on b.id=v.branch_id where v.is_deleted=false and v.archived_at is null ${location?sql`and l.code=${location}`:sql``} ${metricFilter} ${search?sql`and (v.vin ilike ${searchTerm} or coalesce(v.car_name,'') ilike ${searchTerm} or coalesce(v.statement,'') ilike ${searchTerm})`:sql``} ${scope} order by v.vin limit 5000`;
  return {rows};
}

async function dashboardRequests(sql:any,user:SessionUser,query:Record<string,unknown>) {
  const requestType=clean(query.requestType)||'transfer'; const result=await listTransfers(sql,user,{requestType,pageSize:500,page:1,search:query.search}); return result;
}

export default async function handler(request:VercelRequest,response:VercelResponse){
  const requestId=operationsRequestId(); response.setHeader("Cache-Control","no-store"); response.setHeader("X-Request-Id",requestId);
  try{
    await ensureOperationsSchema(); await ensureTrackingSchema();
    const user=await requireOperationsUser(request,response); if(!user) return;
    const resource=clean(request.query.resource)||'meta'; const sql=getSql();
    if(request.method==='GET'){
      if(resource==='meta') return response.status(200).json({ok:true,...await listMeta(sql,user)});
      if(resource==='vehicles') return response.status(200).json({ok:true,...await listVehicles(sql,user,request.query)});
      if(resource==='vehicle') return response.status(200).json({ok:true,...await vehicleDetail(sql,user,clean(request.query.id))});
      if(resource==='transfers') return response.status(200).json({ok:true,...await listTransfers(sql,user,request.query)});
      if(resource==='transfer') return response.status(200).json({ok:true,...await transferDetail(sql,user,clean(request.query.id))});
      if(resource==='movements') return response.status(200).json({ok:true,...await listMovements(sql,user,request.query)});
      if(resource==='approvals') return response.status(200).json({ok:true,...await listApprovals(sql,user,request.query)});
      if(resource==='dashboard-vehicles') return response.status(200).json({ok:true,...await dashboardVehicles(sql,user,request.query)});
      if(resource==='dashboard-requests') return response.status(200).json({ok:true,...await dashboardRequests(sql,user,request.query)});
      throw new OperationsError(404,"VALIDATION_ERROR","المورد المطلوب غير موجود");
    }
    if(request.method==='POST'){
      const data=bodyOf(request); const action=clean(data.action);
      if(action==='save_vehicle') return response.status(200).json({ok:true,vehicle:await saveVehicle(sql,user,data,requestId),message:"تم حفظ السيارة"});
      if(action==='move_vehicles') return response.status(200).json({ok:true,...await performMovement(sql,user,data,requestId),message:"تم تنفيذ الحركة بنجاح"});
      if(action==='create_transfer') return response.status(200).json({ok:true,...await createTransfer(sql,user,data,requestId),message:"تم إنشاء الطلب"});
      if(['send_vehicle','receive_vehicle','complete_transfer','cancel_transfer','delete_transfer'].includes(action)) return response.status(200).json({ok:true,...await transferAction(sql,user,data,requestId)});
      if(action==='approval') return response.status(200).json({ok:true,...await approvalAction(sql,user,data)});
      if(action==='archive'||action==='restore') return response.status(200).json({ok:true,...await archiveAction(sql,user,{...data,action})});
      if(action==='delete_vehicle') return response.status(200).json({ok:true,...await deleteVehicle(sql,user,data,requestId)});
      if(action==='import_vehicles') return response.status(200).json({ok:true,...await importVehicles(sql,user,data)});
      throw new OperationsError(400,"VALIDATION_ERROR","الإجراء المطلوب غير مدعوم");
    }
    return response.status(405).json({ok:false,error:"Method not allowed",requestId});
  }catch(error){return sendOperationsError(response,error,requestId);}
}
