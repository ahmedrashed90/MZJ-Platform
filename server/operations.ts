import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { ApiError, requestId, sendApiError } from "./_api-errors.js";
import { getSql } from "./_db.js";
import { ensureOperationsSchema } from "./_operations-schema.js";
import { hasPermission, isSystemAdmin, requireUser, type SessionUser } from "./_auth.js";

const CHECK_ITEMS = [
  ["mats", "فرشات"],
  ["extinguisher", "طفاية"],
  ["bag", "شنطة"],
  ["spare", "اسبير"],
  ["remote", "ريموت"],
  ["screen", "شاشة"],
  ["radio", "مسجل"],
  ["ac", "مكيف"],
  ["camera", "كاميرا"],
  ["sensor", "حساس"],
] as const;

const ACTIVE_TRANSFER_STATUSES = ["request_received", "vehicle_sent", "vehicle_received"];
const TRANSFER_NEXT: Record<string, string> = {
  request_received: "vehicle_sent",
  vehicle_sent: "vehicle_received",
  vehicle_received: "completed",
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function numberParam(value: unknown, fallback: number, min = 1, max = 500) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

function bodyOf(request: VercelRequest): Record<string, any> {
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { throw new ApiError(400, "VALIDATION_ERROR", "صيغة JSON غير صحيحة"); }
  }
  return request.body && typeof request.body === "object" ? request.body as Record<string, any> : {};
}

function primaryRole(user: SessionUser) {
  return user.roles[0] || user.roleCodes[0] || "مستخدم";
}

function primaryBranch(user: SessionUser) {
  return user.branches[0] || user.branchCodes[0] || "";
}

function assertPermission(user: SessionUser, permission: string) {
  if (!hasPermission(user, permission)) throw new ApiError(403, "FORBIDDEN", "ليس لديك صلاحية تنفيذ هذا الإجراء");
}

async function allowedLocationIds(sql: ReturnType<typeof getSql>, user: SessionUser) {
  if (isSystemAdmin(user)) return null;
  if (!user.branchCodes.length) return [] as string[];
  const rows = await sql<{ id: string }[]>`
    select distinct l.id::text
    from operations.locations l
    left join operations.location_branches lb on lb.location_id=l.id
    left join core.branches b on b.id=coalesce(lb.branch_id,l.branch_id)
    where l.is_active=true and (b.code=any(${user.branchCodes}::text[]) or l.code=any(${user.branchCodes}::text[]))
  `;
  return rows.map((row) => row.id);
}

async function requireVehicleScope(sql: ReturnType<typeof getSql>, user: SessionUser, vehicleId: string, lock = false) {
  if (!vehicleId) throw new ApiError(404, "VEHICLE_NOT_FOUND", "السيارة غير موجودة");
  const allowed = await allowedLocationIds(sql, user);
  const rows = lock
    ? await sql<any[]>`select v.*,l.code as location_code,l.name as location_name,l.branch_id::text as location_branch_id from operations.vehicles v left join operations.locations l on l.id=v.location_id where v.id=${vehicleId}::uuid and v.is_deleted=false for update of v`
    : await sql<any[]>`select v.*,l.code as location_code,l.name as location_name,l.branch_id::text as location_branch_id from operations.vehicles v left join operations.locations l on l.id=v.location_id where v.id=${vehicleId}::uuid and v.is_deleted=false`;
  const vehicle = rows[0];
  if (!vehicle) throw new ApiError(404, "VEHICLE_NOT_FOUND", "السيارة غير موجودة");
  if (allowed && !allowed.includes(String(vehicle.location_id || ""))) throw new ApiError(403, "FORBIDDEN", "السيارة خارج نطاق الفروع والمواقع المسموح بها");
  return vehicle;
}

async function validateLocation(sql: ReturnType<typeof getSql>, id: string) {
  if (!id) throw new ApiError(400, "INVALID_DESTINATION_LOCATION", "المكان المحدد غير صالح");
  const [row] = await sql<any[]>`select id::text,code,name,branch_id::text from operations.locations where id=${id}::uuid and is_active=true`;
  if (!row) throw new ApiError(400, "INVALID_DESTINATION_LOCATION", "المكان المحدد غير صالح");
  return row;
}

async function validateScopedLocation(sql: ReturnType<typeof getSql>, user: SessionUser, id: string) {
  const row = await validateLocation(sql, id);
  const allowed = await allowedLocationIds(sql, user);
  if (allowed && !allowed.includes(String(row.id))) {
    throw new ApiError(403, "FORBIDDEN", "المكان المحدد خارج نطاق الفروع والمواقع المسموح بها");
  }
  return row;
}

async function validateStatus(sql: ReturnType<typeof getSql>, code: string) {
  const [row] = await sql<any[]>`select * from operations.vehicle_statuses where code=${code} and is_active=true`;
  if (!row) throw new ApiError(400, "INVALID_STATUS_TRANSITION", "حالة السيارة المحددة غير صالحة");
  return row;
}

async function syncVehicleApprovalSummary(tx: any, vehicleId: string, cycle: any) {
  const [existing] = await tx<any[]>`
    select id::text from operations.vehicle_approvals
    where vehicle_id=${vehicleId}::uuid
    order by updated_at desc,id desc limit 1 for update
  `;
  if (existing) {
    await tx`
      update operations.vehicle_approvals set
        cycle_id=${cycle.id}::uuid,financial_approved=${cycle.financial_approved},administrative_approved=${cycle.administrative_approved},
        financial_note=${cycle.financial_note||null},administrative_note=${cycle.administrative_note||null},
        financial_approved_by=${cycle.financial_approved_by||null}::uuid,administrative_approved_by=${cycle.administrative_approved_by||null}::uuid,
        financial_approved_at=${cycle.financial_approved_at||null},administrative_approved_at=${cycle.administrative_approved_at||null},updated_at=now()
      where id=${existing.id}::uuid
    `;
  } else {
    await tx`
      insert into operations.vehicle_approvals(
        vehicle_id,cycle_id,financial_approved,administrative_approved,financial_note,administrative_note,
        financial_approved_by,administrative_approved_by,financial_approved_at,administrative_approved_at,updated_at
      ) values (
        ${vehicleId}::uuid,${cycle.id}::uuid,${cycle.financial_approved},${cycle.administrative_approved},
        ${cycle.financial_note||null},${cycle.administrative_note||null},${cycle.financial_approved_by||null}::uuid,
        ${cycle.administrative_approved_by||null}::uuid,${cycle.financial_approved_at||null},${cycle.administrative_approved_at||null},now()
      )
    `;
  }
}

async function ensureDeliveryCycle(tx: any, vehicle: any, user: SessionUser, traceId: string) {
  const [existing] = await tx<any[]>`select * from operations.vehicle_approval_cycles where vehicle_id=${vehicle.id}::uuid and is_active=true for update`;
  if (existing) return existing;
  const [numberRow] = await tx<any[]>`select coalesce(max(cycle_no),0)+1 as next_no from operations.vehicle_approval_cycles where vehicle_id=${vehicle.id}::uuid`;
  const [cycle] = await tx<any[]>`
    insert into operations.vehicle_approval_cycles(vehicle_id,cycle_no,started_by,started_by_name)
    values (${vehicle.id}::uuid,${Number(numberRow?.next_no||1)},${user.id}::uuid,${user.fullName}) returning *
  `;
  await syncVehicleApprovalSummary(tx, vehicle.id, cycle);
  await tx`
    insert into operations.vehicle_approval_events(cycle_id,vehicle_id,approval_type,action,before_data,after_data,actor_id,actor_name,actor_role,request_id)
    values (${cycle.id}::uuid,${vehicle.id}::uuid,'cycle','started','{}'::jsonb,${tx.json(cycle)},${user.id}::uuid,${user.fullName},${primaryRole(user)},${traceId})
  `;
  return cycle;
}

async function validateDeliveryTransition(tx: any, vehicle: any, nextStatus: string) {
  if (nextStatus !== "delivered") return;
  if (vehicle.status_code !== "under_delivery") {
    throw new ApiError(409, "INVALID_STATUS_TRANSITION", "يجب أن تمر السيارة أولًا بحالة مباع تحت التسليم");
  }
  const [cycle] = await tx<any[]>`
    select * from operations.vehicle_approval_cycles
    where vehicle_id=${vehicle.id}::uuid and is_active=true
    order by cycle_no desc limit 1 for update
  `;
  if (!cycle?.financial_approved || !cycle?.administrative_approved) {
    const missing = [!cycle?.financial_approved ? "الموافقة المالية" : "", !cycle?.administrative_approved ? "الموافقة الإدارية" : ""].filter(Boolean);
    throw new ApiError(409, "APPROVALS_REQUIRED", `لا يمكن إتمام التسليم قبل اكتمال ${missing.join(" و")}`, undefined, { missing });
  }
}

async function applyCheckItems(tx: any, vehicle: any, checks: any[], user: SessionUser, movementId: string | null, transferRequestId: string | null) {
  if (!Array.isArray(checks) || checks.length === 0) return;
  if (vehicle.location_code !== "agency") throw new ApiError(409, "VEHICLE_NOT_ELIGIBLE", "يمكن تعديل التشيك أثناء الحركة فقط عندما يكون المكان الحالي هو الوكالة");
  const catalog = new Map(CHECK_ITEMS);
  for (const item of checks) {
    const code = clean(item.code);
    if (!catalog.has(code as any)) continue;
    const name = catalog.get(code as any)!;
    const status = clean(item.status) || "unknown";
    const note = clean(item.note) || null;
    const [before] = await tx<any[]>`select * from operations.vehicle_check_items where vehicle_id=${vehicle.id}::uuid and item_code=${code} for update`;
    await tx`
      insert into operations.vehicle_check_items(vehicle_id,item_code,item_name,status,note,updated_by,updated_by_name,updated_at)
      values (${vehicle.id}::uuid,${code},${name},${status},${note},${user.id}::uuid,${user.fullName},now())
      on conflict (vehicle_id,item_code) do update set status=excluded.status,note=excluded.note,updated_by=excluded.updated_by,updated_by_name=excluded.updated_by_name,updated_at=now()
    `;
    await tx`
      insert into operations.vehicle_check_history(vehicle_id,item_code,item_name,old_status,new_status,old_note,new_note,movement_id,request_id,changed_by,changed_by_name)
      values (${vehicle.id}::uuid,${code},${name},${before?.status||null},${status},${before?.note||null},${note},${movementId}::uuid,${transferRequestId}::uuid,${user.id}::uuid,${user.fullName})
    `;
  }
}

async function writeOutbox(tx: any, eventType: string, aggregateType: string, aggregateId: string, title: string, description: string, payload: any) {
  await tx`
    insert into operations.event_outbox(event_type,aggregate_type,aggregate_id,title,description,payload)
    values (${eventType},${aggregateType},${aggregateId},${title},${description},${tx.json(payload)})
  `;
}

async function listMeta(sql: ReturnType<typeof getSql>, user: SessionUser) {
  const allowed = await allowedLocationIds(sql, user);
  const locations = await sql<any[]>`
    select l.id::text,l.code,l.name,l.sort_order,l.branch_id::text,b.name as branch_name,b.code as branch_code,
      coalesce((select array_agg(lb.branch_id::text order by cb.sort_order,cb.name) from operations.location_branches lb join core.branches cb on cb.id=lb.branch_id where lb.location_id=l.id),array[]::text[]) as branch_ids
    from operations.locations l left join core.branches b on b.id=l.branch_id
    where l.is_active=true and (${allowed===null} or l.id=any(${allowed||[]}::uuid[]))
    order by l.sort_order,l.name
  `;
  const destinationLocations = await sql<any[]>`select id::text,code,name,sort_order,branch_id::text from operations.locations where is_active=true order by sort_order,name`;
  const branches = await sql<any[]>`select id::text,code,name,sort_order from core.branches where is_active=true order by sort_order,name`;
  const statuses = await sql<any[]>`select code,name,sort_order,is_inventory,requires_status_note,requires_delivery_approvals,is_final from operations.vehicle_statuses where is_active=true order by sort_order`;
  const permissions = await sql<any[]>`select code,name,system_code from core.permissions where system_code in ('operations','tracking') order by system_code,code`;
  return { locations, destinationLocations, branches, statuses, permissions, checkItems: CHECK_ITEMS.map(([code,name]) => ({ code,name })) };
}

async function listVehicles(sql: ReturnType<typeof getSql>, user: SessionUser, request: VercelRequest) {
  const allowed = await allowedLocationIds(sql, user);
  const page = numberParam(request.query.page, 1, 1, 100000);
  const limit = numberParam(request.query.limit, 50, 1, 500);
  const offset = (page - 1) * limit;
  const search = clean(queryValue(request.query.search));
  const locationId = clean(queryValue(request.query.locationId));
  const status = clean(queryValue(request.query.status));
  const model = clean(queryValue(request.query.model));
  const agent = clean(queryValue(request.query.agent));
  const archived = queryValue(request.query.archived) === "true";
  const exportAll = queryValue(request.query.export) === "true";
  const actualLimit = exportAll ? 250000 : limit;
  const actualOffset = exportAll ? 0 : offset;
  const scopeIds = allowed || [];

  const [countRow] = await sql<any[]>`
    select count(*)::int as total
    from operations.vehicles v
    where v.is_deleted=false
      and ((${archived}=true and v.archived_at is not null) or (${archived}=false and v.archived_at is null))
      and (${allowed===null} or v.location_id=any(${scopeIds}::uuid[]))
      and (${!search} or v.vin ilike ${`%${search}%`} or coalesce(v.car_name,'') ilike ${`%${search}%`})
      and (${!locationId} or v.location_id=${locationId||null}::uuid)
      and (${!status} or v.status_code=${status})
      and (${!model} or coalesce(v.model_year,'') ilike ${`%${model}%`})
      and (${!agent} or coalesce(v.agent_name,'') ilike ${`%${agent}%`})
  `;

  const vehicles = await sql<any[]>`
    select
      v.id::text,v.vin,v.car_name,v.statement,v.agent_name,v.interior_color,v.exterior_color,v.model_year,v.plate_no,v.batch_no,
      v.location_id::text,l.code as location_code,l.name as location_name,v.status_code,coalesce(s.name,v.status_code) as status_name,
      v.source_type,v.has_notes,v.notes,v.status_note,v.shortage_location_note,v.archived_at,v.archive_reason,v.created_at,v.updated_at,v.version,
      coalesce(a.financial_approved,false) as financial_approved,coalesce(a.administrative_approved,false) as administrative_approved,
      tr.id::text as tracking_order_id,tr.sales_order_no as tracking_order_no,tr.status as tracking_status,tr.is_archived as tracking_archived,
      tr.completed_stages,tr.total_stages,
      exists(select 1 from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id where rv.vehicle_id=v.id and r.status=any(${ACTIVE_TRANSFER_STATUSES}::text[])) as has_active_transfer
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.vehicle_statuses s on s.code=v.status_code
    left join lateral (
      select c.financial_approved,c.administrative_approved
      from operations.vehicle_approval_cycles c
      where c.vehicle_id=v.id
      order by c.is_active desc,c.cycle_no desc,c.created_at desc
      limit 1
    ) a on true
    left join lateral (
      select o.id,o.sales_order_no,o.status,o.is_archived,
        (select count(*) from tracking.vehicle_stages vs where vs.vehicle_id=ov.id and vs.status='completed')::int as completed_stages,
        (select count(*) from tracking.vehicle_stages vs where vs.vehicle_id=ov.id)::int as total_stages
      from tracking.order_vehicles ov join tracking.orders o on o.id=ov.order_id
      where (ov.operations_vehicle_id=v.id or (ov.operations_vehicle_id is null and ov.vin=v.vin)) and coalesce(o.is_deleted,false)=false
      order by case when coalesce(o.is_archived,false)=false and o.status in ('not_started','in_progress') then 0 else 1 end,o.updated_at desc
      limit 1
    ) tr on true
    where v.is_deleted=false
      and ((${archived}=true and v.archived_at is not null) or (${archived}=false and v.archived_at is null))
      and (${allowed===null} or v.location_id=any(${scopeIds}::uuid[]))
      and (${!search} or v.vin ilike ${`%${search}%`} or coalesce(v.car_name,'') ilike ${`%${search}%`})
      and (${!locationId} or v.location_id=${locationId||null}::uuid)
      and (${!status} or v.status_code=${status})
      and (${!model} or coalesce(v.model_year,'') ilike ${`%${model}%`})
      and (${!agent} or coalesce(v.agent_name,'') ilike ${`%${agent}%`})
    order by v.updated_at desc,v.vin
    limit ${actualLimit} offset ${actualOffset}
  `;
  return { vehicles, total: Number(countRow?.total||0), page, limit: actualLimit };
}

async function vehicleDetail(sql: ReturnType<typeof getSql>, user: SessionUser, id: string) {
  const vehicle = await requireVehicleScope(sql,user,id);
  const [movements, checks, statusNotes, approvals, transfers, tracking] = await Promise.all([
    sql<any[]>`
      select m.id::text,m.created_at,m.old_status,m.new_status,m.note,m.status_note,m.shortage_location_note,m.performed_by_name,m.performed_role,m.performed_branch,
      fl.name as from_location_name,tl.name as to_location_name,m.batch_id::text,m.transfer_request_id::text
      from operations.movements m left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id
      where m.vehicle_id=${id}::uuid order by m.created_at desc limit 200
    `,
    sql<any[]>`select item_code,item_name,status,note,updated_by_name,updated_at from operations.vehicle_check_items where vehicle_id=${id}::uuid order by item_name`,
    sql<any[]>`select id::text,status_code,note,created_by_name,created_at from operations.vehicle_status_notes where vehicle_id=${id}::uuid order by created_at desc`,
    sql<any[]>`select * from operations.vehicle_approval_cycles where vehicle_id=${id}::uuid order by cycle_no desc`,
    sql<any[]>`
      select r.id::text,r.request_no,r.status,r.requested_at,r.completed_at,sl.name as source_location,dl.name as destination_location
      from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id
      left join operations.locations sl on sl.id=r.source_location_id left join operations.locations dl on dl.id=r.destination_location_id
      where rv.vehicle_id=${id}::uuid order by r.requested_at desc
    `,
    sql<any[]>`
      select o.id::text,o.sales_order_no,o.status,o.is_archived,o.created_at,o.updated_at,ov.id::text as tracking_vehicle_id
      from tracking.order_vehicles ov join tracking.orders o on o.id=ov.order_id
      where ov.operations_vehicle_id=${id}::uuid or (ov.operations_vehicle_id is null and ov.vin=${vehicle.vin})
      order by o.updated_at desc
    `,
  ]);
  return { vehicle, movements, checks, statusNotes, approvals, transfers, tracking };
}

async function listMovements(sql: ReturnType<typeof getSql>, user: SessionUser, request: VercelRequest) {
  const allowed = await allowedLocationIds(sql,user);
  const scopeIds=allowed||[];
  const page=numberParam(request.query.page,1,1,100000);
  const exportAll=queryValue(request.query.export)==="true";
  const limit=exportAll?250000:numberParam(request.query.limit,50,1,500);
  const from=clean(queryValue(request.query.from));
  const to=clean(queryValue(request.query.to));
  const search=clean(queryValue(request.query.search));
  const fromLocation=clean(queryValue(request.query.fromLocation));
  const toLocation=clean(queryValue(request.query.toLocation));
  const status=clean(queryValue(request.query.status));
  const userSearch=clean(queryValue(request.query.user));
  const requestNo=clean(queryValue(request.query.requestNo));
  const rows=await sql<any[]>`
    select m.id::text,m.created_at,v.vin,v.car_name,fl.name as from_location_name,tl.name as to_location_name,
      m.old_status,m.new_status,m.performed_by_name,m.performed_role,m.performed_branch,m.note,m.status_note,m.shortage_location_note,
      r.request_no,m.batch_id::text
    from operations.movements m join operations.vehicles v on v.id=m.vehicle_id
    left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id
    left join operations.transfer_requests r on r.id=m.transfer_request_id
    where (${allowed===null} or v.location_id=any(${scopeIds}::uuid[]) or m.from_location_id=any(${scopeIds}::uuid[]) or m.to_location_id=any(${scopeIds}::uuid[]))
      and (${!from} or m.created_at >= ${from||null}::timestamptz)
      and (${!to} or m.created_at <= ${to||null}::timestamptz)
      and (${!search} or v.vin ilike ${`%${search}%`} or coalesce(v.car_name,'') ilike ${`%${search}%`})
      and (${!fromLocation} or m.from_location_id=${fromLocation||null}::uuid)
      and (${!toLocation} or m.to_location_id=${toLocation||null}::uuid)
      and (${!status} or m.new_status=${status})
      and (${!userSearch} or coalesce(m.performed_by_name,'') ilike ${`%${userSearch}%`})
      and (${!requestNo} or coalesce(r.request_no,'') ilike ${`%${requestNo}%`})
    order by m.created_at desc limit ${limit} offset ${(page-1)*limit}
  `;
  return { movements: rows, page, limit };
}

async function listTransfers(sql: ReturnType<typeof getSql>, user: SessionUser, request: VercelRequest) {
  const allowed=await allowedLocationIds(sql,user); const scopeIds=allowed||[];
  const completed=queryValue(request.query.completed)==="true"; const search=clean(queryValue(request.query.search));
  const rows=await sql<any[]>`
    select r.id::text,r.request_no,r.status,r.note,r.requested_by::text,r.requested_by_name,r.requested_by_role,r.requested_by_branch,r.requested_at,r.completed_at,
      r.source_location_id::text,sl.name as source_location_name,r.destination_location_id::text,dl.name as destination_location_name,
      count(rv.vehicle_id)::int as vehicles_count,string_agg(v.vin,', ' order by v.vin) as vins,
      coalesce(json_agg(json_build_object('id',v.id::text,'vin',v.vin,'car_name',v.car_name,'source_status',rv.source_status)) filter(where v.id is not null),'[]') as vehicles
    from operations.transfer_requests r
    left join operations.locations sl on sl.id=r.source_location_id left join operations.locations dl on dl.id=r.destination_location_id
    left join operations.transfer_request_vehicles rv on rv.transfer_request_id=r.id left join operations.vehicles v on v.id=rv.vehicle_id
    where r.transfer_type='transfer' and ((${completed}=true and r.status in ('completed','cancelled')) or (${completed}=false and r.status=any(${ACTIVE_TRANSFER_STATUSES}::text[])))
      and (${allowed===null} or r.source_location_id=any(${scopeIds}::uuid[]) or r.destination_location_id=any(${scopeIds}::uuid[]))
      and (${!search} or r.request_no ilike ${`%${search}%`} or coalesce(sl.name,'') ilike ${`%${search}%`} or coalesce(dl.name,'') ilike ${`%${search}%`} or exists(
        select 1 from operations.transfer_request_vehicles srv join operations.vehicles sv on sv.id=srv.vehicle_id
        where srv.transfer_request_id=r.id and (sv.vin ilike ${`%${search}%`} or coalesce(sv.car_name,'') ilike ${`%${search}%`})
      ))
    group by r.id,sl.name,dl.name order by r.requested_at desc
  `;
  return { transfers: rows };
}

async function transferDetail(sql: ReturnType<typeof getSql>, user: SessionUser, id: string) {
  const allowed=await allowedLocationIds(sql,user); const scopeIds=allowed||[];
  const [requestRow]=await sql<any[]>`
    select r.*,r.id::text,r.requested_by::text,r.deleted_by::text,r.cancelled_by::text,
      sl.name as source_location_name,sl.code as source_location_code,dl.name as destination_location_name,dl.code as destination_location_code
    from operations.transfer_requests r
    left join operations.locations sl on sl.id=r.source_location_id left join operations.locations dl on dl.id=r.destination_location_id
    where r.id=${id}::uuid and r.transfer_type='transfer'
      and (${allowed===null} or r.source_location_id=any(${scopeIds}::uuid[]) or r.destination_location_id=any(${scopeIds}::uuid[]))
  `;
  if(!requestRow) throw new ApiError(404,"CONFLICT","طلب النقل غير موجود أو خارج نطاق صلاحيتك");
  const [vehicles,events,movements]=await Promise.all([
    sql<any[]>`
      select v.id::text,v.vin,v.car_name,v.statement,v.model_year,v.status_code,l.name as current_location_name,
        rv.source_status,rv.source_location_id::text,sl.name as source_location_name,rv.received_movement_id::text
      from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id
      left join operations.locations l on l.id=v.location_id left join operations.locations sl on sl.id=rv.source_location_id
      where rv.transfer_request_id=${id}::uuid order by v.vin
    `,
    sql<any[]>`
      select id::text,stage_code,action,note,actor_id::text,actor_name,actor_role,actor_branch,is_override,override_reason,request_id,created_at,before_data,after_data
      from operations.transfer_request_events where transfer_request_id=${id}::uuid order by created_at
    `,
    sql<any[]>`
      select m.id::text,m.vehicle_id::text,v.vin,m.created_at,fl.name as from_location_name,tl.name as to_location_name,m.old_status,m.new_status,m.performed_by_name,m.note
      from operations.movements m join operations.vehicles v on v.id=m.vehicle_id
      left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id
      where m.transfer_request_id=${id}::uuid order by m.created_at
    `,
  ]);
  return { transfer:requestRow,vehicles,events,movements };
}

async function listApprovals(sql: ReturnType<typeof getSql>, user: SessionUser, request: VercelRequest) {
  const allowed=await allowedLocationIds(sql,user); const scopeIds=allowed||[]; const filter=clean(queryValue(request.query.filter));
  const rows=await sql<any[]>`
    select c.id::text as cycle_id,c.cycle_no,c.financial_approved,c.administrative_approved,c.financial_note,c.administrative_note,
      c.financial_approved_by_name,c.administrative_approved_by_name,c.financial_approved_at,c.administrative_approved_at,c.started_at,
      v.id::text as vehicle_id,v.vin,v.car_name,v.statement,v.status_code,l.name as location_name
    from operations.vehicle_approval_cycles c join operations.vehicles v on v.id=c.vehicle_id left join operations.locations l on l.id=v.location_id
    where c.is_active=true and v.status_code='under_delivery' and v.is_deleted=false and v.archived_at is null
      and (${allowed===null} or v.location_id=any(${scopeIds}::uuid[]))
      and (${!filter} or (${filter}='financial' and c.financial_approved=false) or (${filter}='administrative' and c.administrative_approved=false) or (${filter}='completed' and c.financial_approved=true and c.administrative_approved=true))
    order by c.started_at desc
  `;
  return { approvals: rows };
}

async function createVehicle(sql: ReturnType<typeof getSql>, user: SessionUser, body: any, traceId: string) {
  assertPermission(user,"operations.vehicle.create");
  const vin=clean(body.vin); if(!vin) throw new ApiError(400,"VALIDATION_ERROR","رقم الهيكل مطلوب",{vin:"رقم الهيكل مطلوب"});
  const locationId=clean(body.locationId); const statusCode=clean(body.statusCode)||"available_for_sale";
  await validateScopedLocation(sql,user,locationId); const status=await validateStatus(sql,statusCode);
  if(statusCode==="delivered") throw new ApiError(409,"INVALID_STATUS_TRANSITION","لا يمكن إضافة سيارة مباشرة بحالة مباع تم التسليم");
  if(status.requires_status_note&&!clean(body.statusNote)) throw new ApiError(400,"VALIDATION_ERROR","ملاحظات الحالة مطلوبة",{statusNote:"مطلوب"});
  try {
    return await sql.begin(async(tx)=>{
      const [vehicle]=await tx<any[]>`
        insert into operations.vehicles(vin,car_name,statement,agent_name,interior_color,exterior_color,model_year,plate_no,batch_no,location_id,status_code,source_type,has_notes,notes,status_note,shortage_location_note,created_by,updated_by)
        values (${vin},${clean(body.carName)||null},${clean(body.statement)||null},${clean(body.agentName)||null},${clean(body.interiorColor)||null},${clean(body.exteriorColor)||null},${clean(body.modelYear)||null},${clean(body.plateNo)||null},${clean(body.batchNo)||null},${locationId}::uuid,${statusCode},'manual',${Boolean(clean(body.notes)||clean(body.statusNote))},${clean(body.notes)||null},${clean(body.statusNote)||null},${clean(body.shortageLocationNote)||null},${user.id}::uuid,${user.id}::uuid)
        returning *,id::text
      `;
      if(clean(body.statusNote)) await tx`insert into operations.vehicle_status_notes(vehicle_id,status_code,note,created_by,created_by_name) values (${vehicle.id}::uuid,${statusCode},${clean(body.statusNote)},${user.id}::uuid,${user.fullName})`;
      if(statusCode==="under_delivery") await ensureDeliveryCycle(tx,vehicle,user,traceId);
      await tx`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data) values (${user.id}::uuid,'operations','vehicle_created','vehicle',${vehicle.id},${tx.json({ ...vehicle, requestId: traceId })})`;
      return vehicle;
    });
  } catch(error:any) {
    if(String(error?.code)==="23505") throw new ApiError(409,"DUPLICATE_VIN","رقم الهيكل موجود بالفعل",{vin:"مكرر"});
    throw error;
  }
}

async function updateVehicle(sql: ReturnType<typeof getSql>, user: SessionUser, body: any, traceId: string) {
  assertPermission(user,"operations.vehicle.edit"); const id=clean(body.id);
  return sql.begin(async(tx)=>{
    const before=await requireVehicleScope(tx as any,user,id,true);
    const [vehicle]=await tx<any[]>`
      update operations.vehicles set
        car_name=${clean(body.carName)||null},statement=${clean(body.statement)||null},agent_name=${clean(body.agentName)||null},
        interior_color=${clean(body.interiorColor)||null},exterior_color=${clean(body.exteriorColor)||null},model_year=${clean(body.modelYear)||null},
        plate_no=${clean(body.plateNo)||null},batch_no=${clean(body.batchNo)||null},notes=${clean(body.notes)||null},
        has_notes=${Boolean(clean(body.notes)||before.status_note)},updated_by=${user.id}::uuid,updated_at=now(),version=version+1
      where id=${id}::uuid returning *,id::text
    `;
    await tx`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data) values (${user.id}::uuid,'operations','vehicle_updated','vehicle',${id},${tx.json(before)},${tx.json({ ...vehicle, requestId: traceId })})`;
    return vehicle;
  });
}

async function moveVehicles(sql: ReturnType<typeof getSql>, user: SessionUser, body: any, traceId: string) {
  assertPermission(user,"operations.movement.execute");
  const vehicleItems=Array.isArray(body.vehicles)?body.vehicles:[]; if(!vehicleItems.length) throw new ApiError(400,"VALIDATION_ERROR","اختر سيارة واحدة على الأقل");
  const destinationId=clean(body.destinationLocationId); const nextStatus=clean(body.statusCode); const destination=await validateScopedLocation(sql,user,destinationId); const status=await validateStatus(sql,nextStatus);
  if(status.requires_status_note&&!vehicleItems.every((item:any)=>clean(item.statusNote))) throw new ApiError(400,"VALIDATION_ERROR","ملاحظات الحالة مطلوبة لكل سيارة عند اختيار بها ملاحظات");
  return sql.begin(async(tx)=>{
    const batchNo=`MOV-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,8).toUpperCase()}`;
    const [batch]=await tx<any[]>`insert into operations.movement_batches(batch_no,vehicle_count,destination_location_id,new_status,general_note,performed_by,performed_by_name,performed_role,performed_branch,request_id) values (${batchNo},${vehicleItems.length},${destinationId}::uuid,${nextStatus},${clean(body.generalNote)||null},${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${traceId}) returning *,id::text`;
    const moved=[];
    for(const item of vehicleItems){
      const vehicle=await requireVehicleScope(tx as any,user,clean(item.id),true);
      if(vehicle.archived_at) throw new ApiError(409,"VEHICLE_NOT_ELIGIBLE",`السيارة ${vehicle.vin} مؤرشفة`);
      if(vehicle.location_id===destinationId && vehicle.status_code===nextStatus) throw new ApiError(409,"CONFLICT",`السيارة ${vehicle.vin} موجودة بالفعل في نفس المكان والحالة`);
      await validateDeliveryTransition(tx,vehicle,nextStatus);
      const beforeData={...vehicle};
      const [movement]=await tx<any[]>`
        insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,note,status_note,shortage_location_note,performed_by,performed_by_name,performed_role,performed_branch,batch_id,before_data,after_data,request_id)
        values (${vehicle.id}::uuid,${vehicle.location_id}::uuid,${destinationId}::uuid,${vehicle.status_code},${nextStatus},${clean(item.note)||clean(body.generalNote)||null},${clean(item.statusNote)||null},${clean(item.shortageLocationNote)||null},${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${batch.id}::uuid,${tx.json(beforeData)},${tx.json({locationId:destinationId,statusCode:nextStatus})},${traceId}) returning id::text,created_at
      `;
      await applyCheckItems(tx,vehicle,item.checks||[],user,movement.id,null);
      if(clean(item.statusNote)) await tx`insert into operations.vehicle_status_notes(vehicle_id,status_code,note,movement_id,created_by,created_by_name) values (${vehicle.id}::uuid,${nextStatus},${clean(item.statusNote)},${movement.id}::uuid,${user.id}::uuid,${user.fullName})`;
      if(nextStatus==="under_delivery" && vehicle.status_code!=="under_delivery") await ensureDeliveryCycle(tx,vehicle,user,traceId);
      if(nextStatus!=="under_delivery" && vehicle.status_code==="under_delivery") await tx`update operations.vehicle_approval_cycles set is_active=false,closed_at=now(),updated_at=now() where vehicle_id=${vehicle.id}::uuid and is_active=true`;
      await tx`update operations.vehicles set location_id=${destination.id}::uuid,status_code=${nextStatus},status_note=${clean(item.statusNote)||null},shortage_location_note=${clean(item.shortageLocationNote)||null},has_notes=${Boolean(vehicle.has_notes||clean(item.note)||clean(item.statusNote)||nextStatus==="has_notes")},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${vehicle.id}::uuid`;
      moved.push({id:vehicle.id,vin:vehicle.vin,movementId:movement.id});
    }
    await writeOutbox(tx,"operations.vehicle.moved","movement_batch",batch.id,"تم تنفيذ حركة سيارات",`تم نقل ${moved.length} سيارة`,{batchNo,moved,destination,nextStatus});
    return {batch,moved};
  });
}

async function createTransfer(sql: ReturnType<typeof getSql>, user: SessionUser, body: any, traceId: string) {
  assertPermission(user,"operations.transfer.create"); const vehicleIds: string[]=[...new Set<string>((Array.isArray(body.vehicleIds)?body.vehicleIds:[]).map((value: unknown)=>clean(value)).filter(Boolean))];
  if(!vehicleIds.length) throw new ApiError(400,"VALIDATION_ERROR","اختر سيارة واحدة على الأقل");
  const destinationId=clean(body.destinationLocationId); const destination=await validateLocation(sql,destinationId);
  return sql.begin(async(tx)=>{
    const vehicles=[];
    for(const id of vehicleIds){
      const vehicle=await requireVehicleScope(tx as any,user,id,true);
      if(vehicle.archived_at) throw new ApiError(409,"VEHICLE_NOT_ELIGIBLE",`السيارة ${vehicle.vin} مؤرشفة`);
      if(vehicle.location_id===destinationId) throw new ApiError(409,"INVALID_DESTINATION_LOCATION",`وجهة السيارة ${vehicle.vin} هي نفس مكانها الحالي`);
      const [active]=await tx<any[]>`select r.request_no from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id where rv.vehicle_id=${vehicle.id}::uuid and r.status=any(${ACTIVE_TRANSFER_STATUSES}::text[]) limit 1`;
      if(active) throw new ApiError(409,"DUPLICATE_ACTIVE_REQUEST",`السيارة ${vehicle.vin} مرتبطة بطلب نقل جارٍ ${active.request_no}`);
      vehicles.push(vehicle);
    }
    const sourceIds=[...new Set(vehicles.map(v=>String(v.location_id)))]; if(sourceIds.length!==1) throw new ApiError(409,"INVALID_SOURCE_LOCATION","يجب أن تكون جميع السيارات المختارة في مكان مصدر واحد");
    const source=await validateLocation(tx as any,sourceIds[0]);
    const requestNo=`TR-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,7).toUpperCase()}`;
    const [requestRow]=await tx<any[]>`
      insert into operations.transfer_requests(request_no,department_code,transfer_type,source_location_id,destination_location_id,source_branch_id,destination_branch_id,status,requested_by,requested_by_name,requested_by_role,requested_by_branch,note,request_id)
      values (${requestNo},'operations','transfer',${source.id}::uuid,${destination.id}::uuid,${source.branch_id||null}::uuid,${destination.branch_id||null}::uuid,'request_received',${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${clean(body.note)||null},${traceId}) returning *,id::text
    `;
    for(const vehicle of vehicles) await tx`insert into operations.transfer_request_vehicles(transfer_request_id,vehicle_id,source_location_id,source_status) values (${requestRow.id}::uuid,${vehicle.id}::uuid,${vehicle.location_id}::uuid,${vehicle.status_code})`;
    await tx`insert into operations.transfer_request_events(transfer_request_id,stage_code,action,note,after_data,actor_id,actor_name,actor_role,actor_branch,request_id) values (${requestRow.id}::uuid,'request_received','created',${clean(body.note)||null},${tx.json({requestNo,vehicleIds})},${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${traceId})`;
    await writeOutbox(tx,"operations.transfer_request.created","transfer_request",requestRow.id,"تم إنشاء طلب نقل",`طلب ${requestNo} من ${source.name} إلى ${destination.name}`,{requestNo,vehicleIds,source,destination});
    return requestRow;
  });
}

function branchAllowedForStage(user: SessionUser, requestRow: any, next: string) {
  if(isSystemAdmin(user)) return true;
  const codes=user.branchCodes;
  if(next==="vehicle_sent") return Boolean(requestRow.source_branch_code && codes.includes(requestRow.source_branch_code));
  return Boolean(requestRow.destination_branch_code && codes.includes(requestRow.destination_branch_code));
}

async function advanceTransfer(sql: ReturnType<typeof getSql>, user: SessionUser, body: any, traceId: string) {
  assertPermission(user,"operations.transfer.advance"); const id=clean(body.id);
  return sql.begin(async(tx)=>{
    const [requestRow]=await tx<any[]>`
      select r.*,r.id::text,sl.code as source_location_code,sl.name as source_location_name,sb.code as source_branch_code,
        dl.code as destination_location_code,dl.name as destination_location_name,db.code as destination_branch_code
      from operations.transfer_requests r left join operations.locations sl on sl.id=r.source_location_id left join core.branches sb on sb.id=r.source_branch_id
      left join operations.locations dl on dl.id=r.destination_location_id left join core.branches db on db.id=r.destination_branch_id
      where r.id=${id}::uuid for update of r
    `;
    if(!requestRow) throw new ApiError(404,"CONFLICT","طلب النقل غير موجود");
    const next=TRANSFER_NEXT[requestRow.status]; if(!next) throw new ApiError(409,"CONFLICT","لا توجد مرحلة تالية متاحة لهذا الطلب");
    const scopedLocations=await allowedLocationIds(tx as any,user);
    const stageLocationId=next==="vehicle_sent"?String(requestRow.source_location_id||""):String(requestRow.destination_location_id||"");
    const branchMatch=branchAllowedForStage(user,requestRow,next);
    const locationMatch=scopedLocations===null||scopedLocations.includes(stageLocationId);
    if(!branchMatch&&!locationMatch) throw new ApiError(403,"FORBIDDEN","هذه المرحلة تخص فرعًا أو موقعًا آخر");
    const before={status:requestRow.status};
    if(next==="vehicle_received"){
      const items=await tx<any[]>`select rv.*,v.*,v.id::text from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id where rv.transfer_request_id=${id}::uuid order by v.vin for update of v`;
      for(const vehicle of items){
        if(String(vehicle.location_id)!==String(requestRow.source_location_id)) throw new ApiError(409,"INVALID_SOURCE_LOCATION",`مكان السيارة ${vehicle.vin} تغير عن مكان الطلب`);
        const [movement]=await tx<any[]>`
          insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,note,performed_by,performed_by_name,performed_role,performed_branch,transfer_request_id,before_data,after_data,request_id)
          values (${vehicle.id}::uuid,${vehicle.location_id}::uuid,${requestRow.destination_location_id}::uuid,${vehicle.status_code},${vehicle.status_code},${clean(body.note)||`استلام السيارة ضمن طلب ${requestRow.request_no}`},${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${id}::uuid,${tx.json(vehicle)},${tx.json({locationId:requestRow.destination_location_id,statusCode:vehicle.status_code})},${traceId}) returning id::text
        `;
        await tx`update operations.vehicles set location_id=${requestRow.destination_location_id}::uuid,updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${vehicle.id}::uuid`;
        await tx`update operations.transfer_request_vehicles set received_movement_id=${movement.id}::uuid where transfer_request_id=${id}::uuid and vehicle_id=${vehicle.id}::uuid`;
      }
    }
    await tx`update operations.transfer_requests set status=${next},completed_at=${next==="completed"?new Date():null},version=version+1 where id=${id}::uuid`;
    await tx`insert into operations.transfer_request_events(transfer_request_id,stage_code,action,note,before_data,after_data,actor_id,actor_name,actor_role,actor_branch,request_id) values (${id}::uuid,${next},'advanced',${clean(body.note)||null},${tx.json(before)},${tx.json({status:next})},${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${traceId})`;
    await writeOutbox(tx,`operations.transfer_request.${next}`,"transfer_request",id,"تحديث طلب نقل",`انتقل الطلب ${requestRow.request_no} إلى ${next}`,{requestNo:requestRow.request_no,status:next});
    return {id,status:next,requestNo:requestRow.request_no};
  });
}

async function cancelTransfer(sql: ReturnType<typeof getSql>, user: SessionUser, body: any, traceId: string) {
  assertPermission(user,"operations.transfer.cancel"); const id=clean(body.id); const reason=clean(body.reason); if(!reason) throw new ApiError(400,"VALIDATION_ERROR","سبب الإلغاء مطلوب",{reason:"مطلوب"});
  return sql.begin(async(tx)=>{
    const [row]=await tx<any[]>`select * from operations.transfer_requests where id=${id}::uuid for update`;
    if(!row) throw new ApiError(404,"CONFLICT","طلب النقل غير موجود"); if(!ACTIVE_TRANSFER_STATUSES.includes(row.status)) throw new ApiError(409,"CONFLICT","لا يمكن إلغاء هذا الطلب في حالته الحالية");
    const scopedLocations=await allowedLocationIds(tx as any,user);
    const ownsRequest=String(row.requested_by||"")===user.id;
    const inScope=scopedLocations===null||scopedLocations.includes(String(row.source_location_id||""))||scopedLocations.includes(String(row.destination_location_id||""));
    if(!ownsRequest&&!inScope) throw new ApiError(403,"FORBIDDEN","لا يمكنك إلغاء طلب خارج نطاق فرعك أو موقعك");
    await tx`update operations.transfer_requests set status='cancelled',cancelled_at=now(),cancelled_by=${user.id}::uuid,cancellation_reason=${reason},version=version+1 where id=${id}::uuid`;
    await tx`insert into operations.transfer_request_events(transfer_request_id,stage_code,action,note,before_data,after_data,actor_id,actor_name,actor_role,actor_branch,request_id) values (${id}::uuid,'cancelled','cancelled',${reason},${tx.json(row)},${tx.json({status:'cancelled',reason})},${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${traceId})`;
    await writeOutbox(tx,"operations.transfer_request.cancelled","transfer_request",id,"تم إلغاء طلب نقل",reason,{requestNo:row.request_no});
    return {id,status:"cancelled"};
  });
}

async function deleteTransfer(sql: ReturnType<typeof getSql>, user: SessionUser, body: any, traceId: string) {
  const id=clean(body.id); const reason=clean(body.reason); if(!reason) throw new ApiError(400,"VALIDATION_ERROR","سبب حذف الطلب مطلوب",{reason:"مطلوب"});
  return sql.begin(async(tx)=>{
    const [row]=await tx<any[]>`select * from operations.transfer_requests where id=${id}::uuid for update`;
    if(!row) throw new ApiError(404,"CONFLICT","طلب النقل غير موجود");
    const canDelete=isSystemAdmin(user)||hasPermission(user,"operations.transfer.delete")||String(row.requested_by||"")===user.id;
    if(!canDelete) throw new ApiError(403,"FORBIDDEN","حذف الطلب متاح للمنشئ أو لصاحب الصلاحية فقط");
    if(row.status!=="request_received") throw new ApiError(409,"CONFLICT","لا يمكن حذف الطلب بعد بدء التنفيذ؛ استخدم إلغاء الطلب");
    const [activity]=await tx<any[]>`select
      (select count(*) from operations.transfer_request_events where transfer_request_id=${id}::uuid and action<>'created')::int as events,
      (select count(*) from operations.movements where transfer_request_id=${id}::uuid)::int as movements`;
    if(Number(activity?.events||0)>0||Number(activity?.movements||0)>0) throw new ApiError(409,"CONFLICT","لا يمكن حذف الطلب بعد تنفيذ إجراء فعلي عليه");
    await tx`update operations.transfer_requests set status='deleted',deleted_at=now(),deleted_by=${user.id}::uuid,deletion_reason=${reason},version=version+1 where id=${id}::uuid`;
    await tx`insert into operations.transfer_request_events(transfer_request_id,stage_code,action,note,before_data,after_data,actor_id,actor_name,actor_role,actor_branch,request_id) values (${id}::uuid,'deleted','deleted',${reason},${tx.json(row)},${tx.json({status:'deleted',reason})},${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${traceId})`;
    await writeOutbox(tx,"operations.transfer_request.deleted","transfer_request",id,"تم حذف طلب نقل قبل التنفيذ",reason,{requestNo:row.request_no});
    return {id,status:"deleted",requestNo:row.request_no};
  });
}

async function approvalAction(sql: ReturnType<typeof getSql>, user: SessionUser, body: any, traceId: string) {
  const type=clean(body.type); const action=clean(body.approvalAction); const vehicleId=clean(body.vehicleId); const note=clean(body.note)||null;
  if(type==="financial") assertPermission(user,"operations.approval.financial"); else if(type==="administrative") assertPermission(user,"operations.approval.administrative"); else if(type==="reset") assertPermission(user,"operations.approval.reset"); else throw new ApiError(400,"VALIDATION_ERROR","نوع الموافقة غير صالح");
  if((type==="reset" || action==="revert") && !note) throw new ApiError(400,"VALIDATION_ERROR","سبب التراجع أو مسح الموافقات مطلوب",{note:"مطلوب"});
  return sql.begin(async(tx)=>{
    const vehicle=await requireVehicleScope(tx as any,user,vehicleId,true); if(vehicle.status_code!=="under_delivery") throw new ApiError(409,"VEHICLE_NOT_ELIGIBLE","السيارة ليست بحالة مباع تحت التسليم");
    const cycle=await ensureDeliveryCycle(tx,vehicle,user,traceId); const before={...cycle};
    if(type==="reset"){
      const [updated]=await tx<any[]>`update operations.vehicle_approval_cycles set financial_approved=false,administrative_approved=false,financial_approved_by=null,administrative_approved_by=null,financial_approved_by_name=null,administrative_approved_by_name=null,financial_approved_at=null,administrative_approved_at=null,updated_at=now() where id=${cycle.id}::uuid returning *`;
      await syncVehicleApprovalSummary(tx,vehicleId,updated);
      await tx`insert into operations.vehicle_approval_events(cycle_id,vehicle_id,approval_type,action,note,before_data,after_data,actor_id,actor_name,actor_role,request_id) values (${cycle.id}::uuid,${vehicleId}::uuid,'both','reset',${note},${tx.json(before)},${tx.json(updated)},${user.id}::uuid,${user.fullName},${primaryRole(user)},${traceId})`;
      return updated;
    }
    const approving=action==="approve"; if(!["approve","revert","note"].includes(action)) throw new ApiError(400,"VALIDATION_ERROR","إجراء الموافقة غير صالح");
    let updated:any;
    if(type==="financial") [updated]=await tx<any[]>`
      update operations.vehicle_approval_cycles set financial_approved=${action==="note"?cycle.financial_approved:approving},financial_note=${note},
        financial_approved_by=${action==="note"?cycle.financial_approved_by:(approving?user.id:null)}::uuid,
        financial_approved_by_name=${action==="note"?cycle.financial_approved_by_name:(approving?user.fullName:null)},
        financial_approved_at=${action==="note"?cycle.financial_approved_at:(approving?new Date():null)},updated_at=now()
      where id=${cycle.id}::uuid returning *
    `; else [updated]=await tx<any[]>`
      update operations.vehicle_approval_cycles set administrative_approved=${action==="note"?cycle.administrative_approved:approving},administrative_note=${note},
        administrative_approved_by=${action==="note"?cycle.administrative_approved_by:(approving?user.id:null)}::uuid,
        administrative_approved_by_name=${action==="note"?cycle.administrative_approved_by_name:(approving?user.fullName:null)},
        administrative_approved_at=${action==="note"?cycle.administrative_approved_at:(approving?new Date():null)},updated_at=now()
      where id=${cycle.id}::uuid returning *
    `;
    await syncVehicleApprovalSummary(tx,vehicleId,updated);
    await tx`insert into operations.vehicle_approval_events(cycle_id,vehicle_id,approval_type,action,note,before_data,after_data,actor_id,actor_name,actor_role,request_id) values (${cycle.id}::uuid,${vehicleId}::uuid,${type},${action},${note},${tx.json(before)},${tx.json(updated)},${user.id}::uuid,${user.fullName},${primaryRole(user)},${traceId})`;
    await writeOutbox(tx,`operations.vehicle.approval_${action}`,"vehicle",vehicleId,"تحديث موافقات سيارة",`${type}:${action}`,{vin:vehicle.vin,type,action});
    return updated;
  });
}

async function archiveVehicle(sql: ReturnType<typeof getSql>, user: SessionUser, body: any, traceId: string) {
  assertPermission(user,"operations.vehicle.archive"); const id=clean(body.id); const reason=clean(body.reason); if(!reason) throw new ApiError(400,"VALIDATION_ERROR","سبب الأرشفة مطلوب");
  return sql.begin(async(tx)=>{
    const vehicle=await requireVehicleScope(tx as any,user,id,true); if(vehicle.archived_at) throw new ApiError(409,"CONFLICT","السيارة مؤرشفة بالفعل"); if(vehicle.status_code!=="delivered") throw new ApiError(409,"VEHICLE_NOT_ELIGIBLE","لا يمكن أرشفة السيارة قبل حالة مباع تم التسليم");
    const [approval]=await tx<any[]>`
      select financial_approved,administrative_approved from operations.vehicle_approval_cycles
      where vehicle_id=${id}::uuid order by cycle_no desc,created_at desc limit 1
    `;
    if(!approval?.financial_approved || !approval?.administrative_approved) throw new ApiError(409,"APPROVALS_REQUIRED","لا يمكن أرشفة السيارة قبل اكتمال الموافقة المالية والإدارية");
    const [activeTransfer]=await tx<any[]>`select 1 from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id where rv.vehicle_id=${id}::uuid and r.status=any(${ACTIVE_TRANSFER_STATUSES}::text[]) limit 1`;
    if(activeTransfer) throw new ApiError(409,"VEHICLE_NOT_ELIGIBLE","يوجد طلب نقل جارٍ على السيارة");
    const [tracking]=await tx<any[]>`select o.status,o.is_archived from tracking.order_vehicles ov join tracking.orders o on o.id=ov.order_id where (ov.operations_vehicle_id=${id}::uuid or (ov.operations_vehicle_id is null and ov.vin=${vehicle.vin})) and coalesce(o.is_deleted,false)=false order by o.updated_at desc limit 1`;
    if(tracking && !tracking.is_archived && tracking.status!=="completed") throw new ApiError(409,"VEHICLE_NOT_ELIGIBLE","طلب التراكينج المرتبط بالسيارة غير مكتمل");
    const snapshot={...vehicle,tracking};
    await tx`insert into operations.vehicle_archives(vehicle_id,reason,snapshot,archived_by,archived_by_name,request_id) values (${id}::uuid,${reason},${tx.json(snapshot)},${user.id}::uuid,${user.fullName},${traceId})`;
    await tx`update operations.vehicles set archived_at=now(),archived_by=${user.id}::uuid,archive_reason=${reason},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${id}::uuid`;
    await writeOutbox(tx,"operations.vehicle.archived","vehicle",id,"تمت أرشفة سيارة",reason,{vin:vehicle.vin}); return {id,vin:vehicle.vin};
  });
}

async function deleteVehicle(sql: ReturnType<typeof getSql>, user: SessionUser, body: any, traceId: string) {
  assertPermission(user,"operations.vehicle.delete"); const id=clean(body.id); const reason=clean(body.reason); if(!reason) throw new ApiError(400,"VALIDATION_ERROR","سبب المسح مطلوب",{reason:"مطلوب"});
  return sql.begin(async(tx)=>{
    const vehicle=await requireVehicleScope(tx as any,user,id,true);
    const [relations]=await tx<any[]>`
      select
        (select count(*) from operations.movements where vehicle_id=${id}::uuid)::int as movements,
        (select count(*) from operations.vehicle_approval_cycles where vehicle_id=${id}::uuid)::int as approval_cycles,
        (select count(*) from operations.vehicle_approvals where vehicle_id=${id}::uuid)::int as approvals,
        (select count(*) from operations.vehicle_shortages where vehicle_id=${id}::uuid)::int as shortages,
        (select count(*) from operations.vehicle_status_notes where vehicle_id=${id}::uuid)::int as status_notes,
        (select count(*) from operations.vehicle_check_items where vehicle_id=${id}::uuid)::int as check_items,
        (select count(*) from operations.vehicle_check_history where vehicle_id=${id}::uuid)::int as check_history,
        (select count(*) from operations.transfer_request_vehicles where vehicle_id=${id}::uuid)::int as transfers,
        (select count(*) from operations.vehicle_archives where vehicle_id=${id}::uuid)::int as archives,
        (select count(*) from tracking.order_vehicles where operations_vehicle_id=${id}::uuid or (operations_vehicle_id is null and vin=${vehicle.vin}))::int as tracking,
        (select count(*) from operations.event_outbox where aggregate_type='vehicle' and aggregate_id=${id})::int as outbox_events,
        (select count(*) from audit.activity_log where system_code='operations' and entity_type='vehicle' and entity_id=${id} and action<>'vehicle_created')::int as audit_events
    `;
    const history=Object.entries(relations||{}).filter(([,value])=>Number(value)>0).map(([key,value])=>({key,count:Number(value)}));
    if(history.length) throw new ApiError(409,"VEHICLE_HAS_HISTORY","السيارة لها تاريخ تشغيلي ويجب استخدام الأرشفة بدل المسح",undefined,{relations:history});
    const snapshot={...vehicle,relations};
    await tx`insert into audit.vehicle_deletions(vehicle_id,vin,reason,snapshot,deleted_by,deleted_by_name,deleted_by_email,deleted_by_role,request_id) values (${id}::uuid,${vehicle.vin},${reason},${tx.json(snapshot)},${user.id}::uuid,${user.fullName},${user.email},${primaryRole(user)},${traceId})`;
    await tx`delete from operations.vehicles where id=${id}::uuid`;
    return {id,vin:vehicle.vin};
  });
}

function normalizeImportRow(row:any){ return { vin:clean(row.vin||row.VIN||row["الهيكل"]||row["رقم الهيكل"]),carName:clean(row.carName||row["السيارة"]),statement:clean(row.statement||row["البيان"]),agentName:clean(row.agentName||row["الوكيل"]),interiorColor:clean(row.interiorColor||row["اللون الداخلي"]),exteriorColor:clean(row.exteriorColor||row["اللون الخارجي"]),modelYear:clean(row.modelYear||row["الموديل"]),plateNo:clean(row.plateNo||row["اللوحة"]),batchNo:clean(row.batchNo||row["اسم الدفعة بالتاريخ"]),locationCode:clean(row.locationCode||row["المكان"]),statusCode:clean(row.statusCode||row["الحالة"]),notes:clean(row.notes||row["ملاحظات في السيارة"])}; }

async function importVehicles(sql: ReturnType<typeof getSql>, user: SessionUser, body:any, traceId:string){
  assertPermission(user,"operations.import");
  const mode=clean(body.mode); if(!["replace","append","update"].includes(mode)) throw new ApiError(400,"VALIDATION_ERROR","وضع الاستيراد غير صالح");
  if(mode==="replace"){
    assertPermission(user,"operations.import.replace");
    if(body.preview!==true && body.confirmReplace!==true) throw new ApiError(400,"VALIDATION_ERROR","يجب تأكيد الاستبدال الكامل قبل التنفيذ",{confirmReplace:"مطلوب"});
  }
  const rows=(Array.isArray(body.rows)?body.rows:[]).map(normalizeImportRow); if(!rows.length) throw new ApiError(400,"IMPORT_VALIDATION_FAILED","ملف الاستيراد لا يحتوي على صفوف");
  const duplicateVins=new Set<string>(); const seen=new Set<string>(); for(const row of rows){ if(row.vin&&seen.has(row.vin)) duplicateVins.add(row.vin); seen.add(row.vin); }
  const allowed=await allowedLocationIds(sql,user); const scopeIds=allowed||[];
  const locationRows=await sql<any[]>`select id::text,code,name from operations.locations where is_active=true and (${allowed===null} or id=any(${scopeIds}::uuid[]))`;
  const statusRows=await sql<any[]>`select code,name,requires_delivery_approvals,is_final from operations.vehicle_statuses where is_active=true`;
  const locationMap=new Map(locationRows.flatMap((r:any)=>[[r.code,r],[r.name,r]])); const statusMap=new Map(statusRows.flatMap((r:any)=>[[r.code,r],[r.name,r]]));
  const vins=rows.map((row:any)=>row.vin).filter(Boolean); const existingRows=vins.length?await sql<any[]>`select id::text,vin from operations.vehicles where vin=any(${vins}::text[])`:[]; const existingMap=new Map(existingRows.map((row:any)=>[row.vin,row]));
  const validated=rows.map((row:any,index:number)=>{
    const errors=[] as string[];
    if(!row.vin) errors.push("رقم الهيكل مطلوب");
    if(duplicateVins.has(row.vin)) errors.push("رقم الهيكل مكرر داخل الملف");
    const loc=locationMap.get(row.locationCode); const st=statusMap.get(row.statusCode||"available_for_sale"); const existing=existingMap.get(row.vin);
    if(!loc&&mode!=="update") errors.push("المكان غير معروف أو خارج نطاق الصلاحية");
    if(!st&&mode!=="update") errors.push("الحالة غير معروفة");
    if(mode!=="update" && st && (st.requires_delivery_approvals || st.code==="delivered")) errors.push("لا يمكن إدخال مباع تحت التسليم أو مباع تم التسليم من الشيت؛ استخدم فلو الحركة والموافقات");
    const outcome=errors.length?"failed":mode==="append"?(existing?"skipped":"inserted"):mode==="update"?(existing?"updated":"skipped"):(existing?"updated":"inserted");
    return {rowNo:index+2,row,location:loc,status:st,existingId:existing?.id||null,outcome,errors};
  });
  const summary={
    totalRows:rows.length,
    validRows:validated.filter((v:any)=>!v.errors.length).length,
    failedRows:validated.filter((v:any)=>v.errors.length).length,
    willInsert:validated.filter((v:any)=>v.outcome==="inserted").length,
    willUpdate:validated.filter((v:any)=>v.outcome==="updated").length,
    willSkip:validated.filter((v:any)=>v.outcome==="skipped").length,
  };
  if(body.preview===true) return {preview:true,...summary,rows:validated};
  if(summary.failedRows>0) throw new ApiError(400,"IMPORT_VALIDATION_FAILED","لا يمكن تنفيذ الاستيراد قبل معالجة جميع الصفوف الخاطئة",undefined,summary);
  return sql.begin(async(tx)=>{
    const [batch]=await tx<any[]>`insert into operations.import_batches(mode,file_name,total_rows,valid_rows,failed_rows,status,created_by,created_by_name) values (${mode},${clean(body.fileName)||null},${rows.length},${summary.validRows},0,'processing',${user.id}::uuid,${user.fullName}) returning *,id::text`;
    let inserted=0,updated=0,skipped=0; const importedVins=[] as string[];
    for(const item of validated){
      const [existing]=await tx<any[]>`select * from operations.vehicles where vin=${item.row.vin} for update`;
      if(mode==="append"&&existing){ skipped++; await tx`insert into operations.import_rows(batch_id,row_no,vin,payload,status,error_code,error_message,vehicle_id) values (${batch.id}::uuid,${item.rowNo},${item.row.vin},${tx.json(item.row)},'skipped','DUPLICATE_VIN','موجود بالفعل',${existing.id}::uuid)`; continue; }
      if(mode==="update"&&!existing){ skipped++; await tx`insert into operations.import_rows(batch_id,row_no,vin,payload,status,error_code,error_message) values (${batch.id}::uuid,${item.rowNo},${item.row.vin},${tx.json(item.row)},'skipped','VEHICLE_NOT_FOUND','غير موجود للتحديث')`; continue; }
      if(existing){
        const [vehicle]=await tx<any[]>`update operations.vehicles set car_name=coalesce(nullif(${item.row.carName},''),car_name),statement=coalesce(nullif(${item.row.statement},''),statement),agent_name=coalesce(nullif(${item.row.agentName},''),agent_name),interior_color=coalesce(nullif(${item.row.interiorColor},''),interior_color),exterior_color=coalesce(nullif(${item.row.exteriorColor},''),exterior_color),model_year=coalesce(nullif(${item.row.modelYear},''),model_year),plate_no=coalesce(nullif(${item.row.plateNo},''),plate_no),batch_no=coalesce(nullif(${item.row.batchNo},''),batch_no),notes=coalesce(nullif(${item.row.notes},''),notes),has_notes=case when nullif(${item.row.notes},'') is not null then true else has_notes end,archived_at=case when ${mode}='replace' then null else archived_at end,archived_by=case when ${mode}='replace' then null else archived_by end,archive_reason=case when ${mode}='replace' then null else archive_reason end,updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${existing.id}::uuid returning id::text`; updated++; importedVins.push(item.row.vin); await tx`insert into operations.import_rows(batch_id,row_no,vin,payload,status,vehicle_id) values (${batch.id}::uuid,${item.rowNo},${item.row.vin},${tx.json(item.row)},'updated',${vehicle.id}::uuid)`;
      } else {
        const [vehicle]=await tx<any[]>`insert into operations.vehicles(vin,car_name,statement,agent_name,interior_color,exterior_color,model_year,plate_no,batch_no,location_id,status_code,source_type,notes,has_notes,created_by,updated_by) values (${item.row.vin},${item.row.carName||null},${item.row.statement||null},${item.row.agentName||null},${item.row.interiorColor||null},${item.row.exteriorColor||null},${item.row.modelYear||null},${item.row.plateNo||null},${item.row.batchNo||null},${item.location.id}::uuid,${item.status.code},'excel_import',${item.row.notes||null},${Boolean(item.row.notes)},${user.id}::uuid,${user.id}::uuid) returning id::text`; inserted++; importedVins.push(item.row.vin); await tx`insert into operations.import_rows(batch_id,row_no,vin,payload,status,vehicle_id) values (${batch.id}::uuid,${item.rowNo},${item.row.vin},${tx.json(item.row)},'inserted',${vehicle.id}::uuid)`;
      }
    }
    if(mode==="replace"){
      const candidates=await tx<any[]>`select v.* from operations.vehicles v where v.is_deleted=false and v.archived_at is null and (${importedVins.length===0} or not(v.vin=any(${importedVins}::text[]))) and (${allowed===null} or v.location_id=any(${scopeIds}::uuid[])) for update`;
      for(const vehicle of candidates){
        await tx`insert into operations.vehicle_archives(vehicle_id,reason,snapshot,archived_by,archived_by_name,request_id) values (${vehicle.id}::uuid,'غير موجود في ملف الاستبدال الكامل',${tx.json(vehicle)},${user.id}::uuid,${user.fullName},${traceId})`;
        await tx`update operations.vehicles set archived_at=now(),archived_by=${user.id}::uuid,archive_reason='غير موجود في ملف الاستبدال الكامل',updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${vehicle.id}::uuid`;
      }
    }
    await tx`update operations.import_batches set inserted_rows=${inserted},updated_rows=${updated},skipped_rows=${skipped},failed_rows=0,status='completed',completed_at=now() where id=${batch.id}::uuid`;
    await writeOutbox(tx,"operations.inventory.imported","import_batch",batch.id,"تم استيراد مخزون السيارات",`مضاف ${inserted}، محدث ${updated}، متجاوز ${skipped}`,{mode,fileName:clean(body.fileName)||null,inserted,updated,skipped});
    return {batchId:batch.id,totalRows:rows.length,insertedRows:inserted,updatedRows:updated,skippedRows:skipped,failedRows:0,executedBy:user.fullName,executedAt:new Date().toISOString()};
  });
}

async function updateSettings(sql: ReturnType<typeof getSql>, user: SessionUser, body:any){
  assertPermission(user,"operations.settings.manage"); const kind=clean(body.kind);
  if(kind==="location"){
    const id=clean(body.id); const name=clean(body.name); if(!name) throw new ApiError(400,"VALIDATION_ERROR","اسم المكان مطلوب");
    const branchIds=[...new Set<string>((Array.isArray(body.branchIds)?body.branchIds:[]).map((value:unknown)=>clean(value)).filter(Boolean))];
    return sql.begin(async(tx)=>{
      if(branchIds.length){const [{count}]=await tx<any[]>`select count(*)::int as count from core.branches where id=any(${branchIds}::uuid[]) and is_active=true`;if(Number(count)!==branchIds.length)throw new ApiError(400,"VALIDATION_ERROR","أحد الفروع المحددة غير صالح");}
      const [row]=await tx<any[]>`update operations.locations set name=${name},sort_order=${Number(body.sortOrder||0)},branch_id=${branchIds[0]||null}::uuid,updated_at=now() where id=${id}::uuid returning id::text,code,name,sort_order,branch_id::text`; if(!row) throw new ApiError(404,"CONFLICT","المكان غير موجود");
      await tx`delete from operations.location_branches where location_id=${id}::uuid`;
      for(const branchId of branchIds) await tx`insert into operations.location_branches(location_id,branch_id) values (${id}::uuid,${branchId}::uuid) on conflict do nothing`;
      return {...row,branch_ids:branchIds};
    });
  }
  if(kind==="status"){
    const code=clean(body.code); const name=clean(body.name); if(!name) throw new ApiError(400,"VALIDATION_ERROR","اسم الحالة مطلوب");
    const [row]=await sql<any[]>`update operations.vehicle_statuses set name=${name},sort_order=${Number(body.sortOrder||0)},requires_status_note=${Boolean(body.requiresStatusNote)},is_inventory=${Boolean(body.isInventory)},updated_at=now() where code=${code} returning *`; if(!row) throw new ApiError(404,"CONFLICT","الحالة غير موجودة"); return row;
  }
  throw new ApiError(400,"VALIDATION_ERROR","نوع الإعداد غير صالح");
}

export default async function handler(request: VercelRequest,response: VercelResponse){
  const traceId=requestId();
  try{
    await ensureOperationsSchema(); const user=await requireUser(request,response); if(!user)return;
    if(!hasPermission(user,"operations.view")) throw new ApiError(403,"FORBIDDEN","ليس لديك صلاحية عرض نظام العمليات");
    const sql=getSql();
    if(request.method==="GET"){
      const resource=clean(queryValue(request.query.resource))||"vehicles";
      if(resource==="meta") return response.status(200).json({ok:true,...await listMeta(sql,user),requestId:traceId});
      if(resource==="vehicles") return response.status(200).json({ok:true,...await listVehicles(sql,user,request),requestId:traceId});
      if(resource==="vehicle") return response.status(200).json({ok:true,...await vehicleDetail(sql,user,clean(queryValue(request.query.id))),requestId:traceId});
      if(resource==="movements") return response.status(200).json({ok:true,...await listMovements(sql,user,request),requestId:traceId});
      if(resource==="transfers") return response.status(200).json({ok:true,...await listTransfers(sql,user,request),requestId:traceId});
      if(resource==="transfer") return response.status(200).json({ok:true,...await transferDetail(sql,user,clean(queryValue(request.query.id))),requestId:traceId});
      if(resource==="approvals") return response.status(200).json({ok:true,...await listApprovals(sql,user,request),requestId:traceId});
      throw new ApiError(404,"CONFLICT","مصدر البيانات المطلوب غير موجود");
    }
    if(request.method==="POST"){
      const body=bodyOf(request); const action=clean(body.action); let data:any; let message="تم تنفيذ العملية بنجاح";
      if(action==="create_vehicle"){data=await createVehicle(sql,user,body,traceId);message="تمت إضافة السيارة بنجاح";}
      else if(action==="update_vehicle"){data=await updateVehicle(sql,user,body,traceId);message="تم تحديث بيانات السيارة";}
      else if(action==="move_vehicles"){data=await moveVehicles(sql,user,body,traceId);message="تم تنفيذ الحركة وتحديث السيارات";}
      else if(action==="create_transfer"){data=await createTransfer(sql,user,body,traceId);message="تم إنشاء طلب النقل";}
      else if(action==="advance_transfer"){data=await advanceTransfer(sql,user,body,traceId);message="تم تنفيذ مرحلة طلب النقل";}
      else if(action==="cancel_transfer"){data=await cancelTransfer(sql,user,body,traceId);message="تم إلغاء طلب النقل";}
      else if(action==="delete_transfer"){data=await deleteTransfer(sql,user,body,traceId);message="تم حذف طلب النقل قبل التنفيذ";}
      else if(action==="approval"){data=await approvalAction(sql,user,body,traceId);message="تم تحديث الموافقات";}
      else if(action==="archive_vehicle"){data=await archiveVehicle(sql,user,body,traceId);message="تمت أرشفة السيارة";}
      else if(action==="delete_vehicle"){data=await deleteVehicle(sql,user,body,traceId);message="تم مسح السيارة نهائيًا";}
      else if(action==="import_vehicles"){data=await importVehicles(sql,user,body,traceId);message=body.preview?"تمت مراجعة ملف الاستيراد":"تم استيراد السيارات";}
      else if(action==="update_settings"){data=await updateSettings(sql,user,body);message="تم حفظ إعدادات العمليات";}
      else throw new ApiError(400,"VALIDATION_ERROR","الإجراء المطلوب غير معروف");
      return response.status(200).json({ok:true,data,message,requestId:traceId});
    }
    return response.status(405).json({ok:false,code:"VALIDATION_ERROR",message:"Method not allowed",requestId:traceId});
  }catch(error){ return sendApiError(response,error,traceId); }
}
