import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { getSql } from "./_db.js";
import { actorBranch, actorRole, isSystemAdmin, userBranchScope } from "./_operations-auth.js";
import type { SessionUser } from "./_auth.js";

export class OperationsError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public fieldErrors?: Record<string, string>,
    public safeDetails?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const STATUS_CODES = {
  available: "available_for_sale",
  reserved: "reserved",
  reservation: "reservation",
  notes: "has_notes",
  underDelivery: "sold_under_delivery",
  delivered: "sold_delivered",
} as const;

export const ACTIVE_SHORTAGE_STATUSES = [STATUS_CODES.available, STATUS_CODES.reserved, STATUS_CODES.reservation, STATUS_CODES.notes];
export const SHORTAGE_LOCATIONS = ["multaqa", "qadisiyah", "hall", "warehouse"];
export const SHORTAGE_BRANCHES = ["multaqa", "hall", "qadisiyah"];
export const ACCESSORY_EXCLUSIONS = [
  "حساس", "حساسات", "sensor", "sensors", "كاميرا", "camera", "شاشة", "screen", "مسجل", "recorder",
  "ريموت", "remote", "فرش", "فرشات", "mats", "طفاية", "extinguisher", "شنطة سلامة", "safety bag", "احتياطي", "spare",
];

function clean(value: unknown) {
  return String(value ?? "").trim();
}
function asInt(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function uniqueText(values: unknown) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}
function roleName(user: SessionUser) {
  return user.roles[0] || actorRole(user);
}
function scopeValues(user: SessionUser) {
  const scope = userBranchScope(user);
  return { all: scope === null, branches: scope || [] };
}
type SqlJsonClient = Pick<postgres.TransactionSql, "json">;

function sqlJson(sql: SqlJsonClient, value: unknown) {
  return sql.json((value ?? {}) as never);
}
function statusCode(value: unknown) {
  const text = clean(value);
  const map: Record<string, string> = {
    "متاح للبيع": STATUS_CODES.available,
    "محجوز": STATUS_CODES.reserved,
    "حجز": STATUS_CODES.reservation,
    "بها ملاحظات": STATUS_CODES.notes,
    "مباع تحت التسليم": STATUS_CODES.underDelivery,
    "مباع تم التسليم": STATUS_CODES.delivered,
    under_delivery: STATUS_CODES.underDelivery,
    delivered: STATUS_CODES.delivered,
  };
  return map[text] || text;
}

export type VehicleFilters = {
  search?: string;
  location?: string;
  status?: string;
  model?: string;
  agent?: string;
  archived?: boolean;
  metric?: string;
  page?: number;
  pageSize?: number;
};

export async function getOperationsMeta() {
  const sql = getSql();
  const [locations, statuses, checklist] = await Promise.all([
    sql<any[]>`select id::text,code,name,branch_code,sort_order from operations.locations where is_active=true order by sort_order,name`,
    sql<any[]>`select code,name,sort_order,counts_as_active_inventory,is_final,requires_status_note from operations.vehicle_statuses where is_active=true order by sort_order,name`,
    sql<any[]>`select code,name,sort_order from operations.checklist_items where is_active=true order by sort_order`,
  ]);
  return { locations, statuses, checklist };
}

export async function listVehicles(user: SessionUser, filters: VehicleFilters = {}, exportAll = false) {
  const sql = getSql();
  const search = clean(filters.search);
  const pattern = `%${search}%`;
  const location = clean(filters.location);
  const status = statusCode(filters.status);
  const model = clean(filters.model);
  const agent = clean(filters.agent);
  const archivedOnly = Boolean(filters.archived);
  const metric = clean(filters.metric);
  const page = Math.max(asInt(filters.page, 1), 1);
  const pageSize = exportAll ? 100000 : Math.min(Math.max(asInt(filters.pageSize, 50), 10), 200);
  const offset = (page - 1) * pageSize;
  const scope = scopeValues(user);

  const [countRow] = await sql<any[]>`
    select count(distinct v.id)::int as total
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.vehicle_statuses s on s.code=v.status_code
    where coalesce(v.is_deleted,false)=false
      and ((${archivedOnly} and coalesce(v.is_archived,false)=true) or (not ${archivedOnly} and coalesce(v.is_archived,false)=false))
      and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern}
        or coalesce(v.model_year,'') ilike ${pattern} or coalesce(v.exterior_color,'') ilike ${pattern} or coalesce(v.interior_color,'') ilike ${pattern}
        or coalesce(l.name,'') ilike ${pattern} or coalesce(s.name,'') ilike ${pattern})
      and (${location}='' or l.code=${location})
      and (${status}='' or v.status_code=${status})
      and (${metric}='' or (${metric}='actual' and v.status_code not in (${STATUS_CODES.underDelivery},${STATUS_CODES.delivered}))
        or (${metric}='available' and v.status_code=${STATUS_CODES.available})
        or (${metric}='under_delivery' and v.status_code=${STATUS_CODES.underDelivery})
        or (${metric}='reserved' and v.status_code=any(${[STATUS_CODES.reserved,STATUS_CODES.reservation]}::text[]))
        or (${metric}='delivered' and v.status_code=${STATUS_CODES.delivered})
        or (${metric}='notes' and v.status_code=${STATUS_CODES.notes}))
      and (${model}='' or coalesce(v.model_year,'') ilike ${`%${model}%`})
      and (${agent}='' or coalesce(v.agent_name,'') ilike ${`%${agent}%`})
      and (${scope.all} or coalesce(v.branch_code,l.branch_code,'') = any(${scope.branches}::text[]))
  `;

  const rows = await sql<any[]>`
    select
      v.id::text,v.vin,v.car_name,v.statement,v.agent_name,v.interior_color,v.exterior_color,v.model_year,v.plate_no,v.batch_no,
      v.branch_code,v.status_code,s.name as status_name,v.has_notes,v.notes,v.status_notes,v.missing_reservation_location,v.version,
      v.is_archived,v.archived_at,v.archive_reason,v.created_at,v.updated_at,
      l.id::text as location_id,l.code as location_code,l.name as location_name,l.branch_code as location_branch_code,
      coalesce(a.financial_approved,false) as financial_approved,coalesce(a.administrative_approved,false) as administrative_approved,
      a.financial_note,a.administrative_note,a.cycle_no,
      tr.id::text as tracking_order_id,tr.sales_order_no as tracking_request_no,tr.status as tracking_status,tr.progress_percent as tracking_progress,
      tr.updated_at as tracking_updated_at,tr.is_archived as tracking_is_archived,
      lm.created_at as last_movement_at,fl.name as last_from_location,tl.name as last_to_location,lm.old_status as last_old_status,lm.new_status as last_new_status
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.vehicle_statuses s on s.code=v.status_code
    left join operations.vehicle_approvals a on a.vehicle_id=v.id and a.is_current=true
    left join lateral (
      select o.id,o.sales_order_no,o.status,o.updated_at,o.is_archived,
        case when count(vs.id)=0 then 0 else round((count(vs.id) filter(where vs.status='completed')::numeric/count(vs.id)::numeric)*100)::int end as progress_percent
      from tracking.order_vehicles ov
      join tracking.orders o on o.id=ov.order_id and coalesce(o.is_deleted,false)=false
      left join tracking.vehicle_stages vs on vs.vehicle_id=ov.id
      where (ov.operations_vehicle_id=v.id or (ov.operations_vehicle_id is null and ov.vin=v.vin))
      group by o.id
      order by (case when o.status in ('not_started','in_progress') and coalesce(o.is_archived,false)=false then 0 else 1 end),o.updated_at desc
      limit 1
    ) tr on true
    left join lateral (select * from operations.movements mx where mx.vehicle_id=v.id order by mx.created_at desc limit 1) lm on true
    left join operations.locations fl on fl.id=lm.from_location_id
    left join operations.locations tl on tl.id=lm.to_location_id
    where coalesce(v.is_deleted,false)=false
      and ((${archivedOnly} and coalesce(v.is_archived,false)=true) or (not ${archivedOnly} and coalesce(v.is_archived,false)=false))
      and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern}
        or coalesce(v.model_year,'') ilike ${pattern} or coalesce(v.exterior_color,'') ilike ${pattern} or coalesce(v.interior_color,'') ilike ${pattern}
        or coalesce(l.name,'') ilike ${pattern} or coalesce(s.name,'') ilike ${pattern})
      and (${location}='' or l.code=${location})
      and (${status}='' or v.status_code=${status})
      and (${metric}='' or (${metric}='actual' and v.status_code not in (${STATUS_CODES.underDelivery},${STATUS_CODES.delivered}))
        or (${metric}='available' and v.status_code=${STATUS_CODES.available})
        or (${metric}='under_delivery' and v.status_code=${STATUS_CODES.underDelivery})
        or (${metric}='reserved' and v.status_code=any(${[STATUS_CODES.reserved,STATUS_CODES.reservation]}::text[]))
        or (${metric}='delivered' and v.status_code=${STATUS_CODES.delivered})
        or (${metric}='notes' and v.status_code=${STATUS_CODES.notes}))
      and (${model}='' or coalesce(v.model_year,'') ilike ${`%${model}%`})
      and (${agent}='' or coalesce(v.agent_name,'') ilike ${`%${agent}%`})
      and (${scope.all} or coalesce(v.branch_code,l.branch_code,'') = any(${scope.branches}::text[]))
    order by v.updated_at desc,v.vin
    limit ${pageSize} offset ${offset}
  `;
  return { rows, total: Number(countRow?.total || 0), page, pageSize };
}

export async function searchVehicles(user: SessionUser, searchValue: unknown, limitValue: unknown = 20) {
  const search = clean(searchValue);
  if (!search) return [];
  const result = await listVehicles(user, { search, page: 1, pageSize: Math.min(Math.max(asInt(limitValue, 20), 1), 50) });
  return result.rows;
}

export async function getVehicleDetail(user: SessionUser, idValue: unknown) {
  const id = clean(idValue);
  if (!id) throw new OperationsError("VALIDATION_ERROR", "معرف السيارة مطلوب", 422, { id: "معرف السيارة مطلوب" });
  const sql = getSql();
  const scope = scopeValues(user);
  const [vehicle] = await sql<any[]>`
    select v.*,v.id::text,l.id::text as location_id,l.code as location_code,l.name as location_name,
      s.name as status_name,cu.full_name as created_by_name,uu.full_name as updated_by_name
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.vehicle_statuses s on s.code=v.status_code
    left join core.users cu on cu.id=v.created_by
    left join core.users uu on uu.id=v.updated_by
    where v.id=${id}::uuid and coalesce(v.is_deleted,false)=false
      and (${scope.all} or coalesce(v.branch_code,l.branch_code,'') = any(${scope.branches}::text[]))
  `;
  if (!vehicle) throw new OperationsError("VEHICLE_NOT_FOUND", "السيارة غير موجودة أو خارج نطاق صلاحيتك", 404);
  const [checklist, approval, approvalEvents, movements, requests, trackingOrders, statusNotes] = await Promise.all([
    sql<any[]>`
      select i.code,i.name,i.sort_order,coalesce(c.is_present,false) as is_present,c.note,c.updated_at,u.full_name as updated_by_name
      from operations.checklist_items i left join operations.vehicle_checklist c on c.item_code=i.code and c.vehicle_id=${id}::uuid
      left join core.users u on u.id=c.updated_by where i.is_active=true order by i.sort_order
    `,
    sql<any[]>`select a.*,a.id::text,fu.full_name as financial_approved_by_name,au.full_name as administrative_approved_by_name from operations.vehicle_approvals a left join core.users fu on fu.id=a.financial_approved_by left join core.users au on au.id=a.administrative_approved_by where a.vehicle_id=${id}::uuid and a.is_current=true limit 1`.then((x)=>x[0]||null),
    sql<any[]>`select e.*,e.id::text from operations.approval_events e where e.vehicle_id=${id}::uuid order by e.created_at desc limit 100`,
    sql<any[]>`select m.*,m.id::text,m.batch_id::text,fl.name as from_location_name,tl.name as to_location_name from operations.movements m left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id where m.vehicle_id=${id}::uuid order by m.created_at desc limit 100`,
    sql<any[]>`select r.*,r.id::text,rv.vehicle_snapshot,sl.name as source_location_name,dl.name as destination_location_name from operations.request_vehicles rv join operations.requests r on r.id=rv.request_id left join operations.locations sl on sl.id=r.source_location_id left join operations.locations dl on dl.id=r.destination_location_id where rv.vehicle_id=${id}::uuid order by r.requested_at desc limit 100`,
    sql<any[]>`
      select o.id::text,o.sales_order_no,o.status,o.is_archived,o.created_at,o.updated_at,o.order_date,
        count(vs.id)::int as total_stages,count(vs.id) filter(where vs.status='completed')::int as completed_stages,
        case when count(vs.id)=0 then 0 else round((count(vs.id) filter(where vs.status='completed')::numeric/count(vs.id)::numeric)*100)::int end as progress_percent
      from tracking.order_vehicles ov join tracking.orders o on o.id=ov.order_id and coalesce(o.is_deleted,false)=false
      left join tracking.vehicle_stages vs on vs.vehicle_id=ov.id where (ov.operations_vehicle_id=${id}::uuid or (ov.operations_vehicle_id is null and ov.vin=${vehicle.vin}))
      group by o.id order by o.updated_at desc
    `,
    sql<any[]>`select n.*,n.id::text,u.full_name as created_by_name,s.name as status_name from operations.vehicle_status_notes n left join core.users u on u.id=n.created_by left join operations.vehicle_statuses s on s.code=n.status_code where n.vehicle_id=${id}::uuid order by n.created_at desc`,
  ]);
  return { vehicle, checklist, approval, approvalEvents, movements, requests, trackingOrders, statusNotes };
}

async function audit(
  tx: postgres.TransactionSql,
  user: SessionUser,
  action: string,
  entityType: string,
  entityId: string,
  beforeData: unknown,
  afterData: unknown,
  reason?: string | null,
  requestId?: string | null,
  isOverride = false,
) {
  await tx`
    insert into audit.activity_log(user_id,actor_name,actor_role,system_code,action,entity_type,entity_id,before_data,after_data,reason,is_override,request_id)
    values (${user.id}::uuid,${user.fullName},${roleName(user)},'operations',${action},${entityType},${entityId},${sqlJson(tx,beforeData)},${sqlJson(tx,afterData)},${reason||null},${isOverride},${requestId||null})
  `;
}
async function outbox(tx: postgres.TransactionSql,user:SessionUser,eventType:string,entityType:string,entityId:string,metadata:Record<string,unknown>,vehicleId?:string|null,requestId?:string|null) {
  await tx`
    insert into operations.event_outbox(event_type,entity_type,entity_id,vehicle_id,request_id,actor_id,title,description,internal_path,metadata)
    values (${eventType},${entityType},${entityId},${vehicleId||null}::uuid,${requestId||null}::uuid,${user.id}::uuid,${clean(metadata.title)||eventType},${clean(metadata.description)||null},${clean(metadata.internalPath)||null},${sqlJson(tx,metadata)})
  `;
}

export async function recordOperationsAudit(
  user: SessionUser,
  action: string,
  entityType: string,
  entityId: string,
  beforeData: unknown,
  afterData: unknown,
  reason?: string | null,
  requestId?: string | null,
  isOverride = false,
) {
  const sql = getSql();
  await sql.begin(async (tx) => {
    await audit(tx, user, action, entityType, entityId, beforeData, afterData, reason, requestId, isOverride);
  });
}

export async function saveVehicle(user: SessionUser, payload: Record<string, unknown>) {
  const sql = getSql();
  const id = clean(payload.id);
  const vin = clean(payload.vin);
  const carName = clean(payload.carName);
  const locationId = clean(payload.locationId);
  const newStatus = statusCode(payload.statusCode || STATUS_CODES.available);
  const statusNotes = clean(payload.statusNotes);
  if (!vin || !carName || !locationId || !newStatus) {
    throw new OperationsError("VALIDATION_ERROR", "أكمل الحقول الإلزامية", 422, {
      ...(!vin ? { vin: "رقم الهيكل مطلوب" } : {}),
      ...(!carName ? { carName: "اسم السيارة مطلوب" } : {}),
      ...(!locationId ? { locationId: "المكان مطلوب" } : {}),
      ...(!newStatus ? { statusCode: "الحالة مطلوبة" } : {}),
    });
  }
  if (newStatus === STATUS_CODES.notes && !statusNotes) throw new OperationsError("VALIDATION_ERROR", "ملاحظات الحالة مطلوبة عند اختيار بها ملاحظات", 422, { statusNotes: "ملاحظات الحالة مطلوبة" });
  const scope = scopeValues(user);
  try {
    return await sql.begin(async (tx) => {
      const [location] = await tx<any[]>`select id::text,code,name,branch_code from operations.locations where id=${locationId}::uuid and is_active=true`;
      if (!location) throw new OperationsError("INVALID_DESTINATION_LOCATION", "المكان المحدد غير صحيح", 422, { locationId: "المكان غير صحيح" });
      if (!scope.all && location.branch_code && !scope.branches.includes(location.branch_code)) throw new OperationsError("FORBIDDEN", "لا يمكنك حفظ سيارة خارج نطاق فرعك", 403);
      const [existingVin] = await tx<any[]>`select id::text from operations.vehicles where vin=${vin} and coalesce(is_deleted,false)=false and (${id}='' or id<>${id||null}::uuid) limit 1`;
      if (existingVin) throw new OperationsError("CONFLICT", "رقم الهيكل مسجل بالفعل", 409, { vin: "رقم الهيكل مستخدم" });
      const data = {
        vin, carName,
        statement: clean(payload.statement) || null,
        agentName: clean(payload.agentName) || null,
        interiorColor: clean(payload.interiorColor) || null,
        exteriorColor: clean(payload.exteriorColor) || null,
        modelYear: clean(payload.modelYear) || null,
        plateNo: clean(payload.plateNo) || null,
        batchNo: clean(payload.batchNo) || null,
        locationId,
        branchCode: location.branch_code || clean(payload.branchCode) || null,
        statusCode: newStatus,
        notes: clean(payload.notes) || null,
        statusNotes: statusNotes || null,
        missingReservationLocation: clean(payload.missingReservationLocation) || null,
      };
      if (!id) {
        if (data.statusCode === STATUS_CODES.delivered) throw new OperationsError("VEHICLE_NOT_ELIGIBLE", "لا يمكن إنشاء سيارة مباشرة بحالة مباع تم التسليم؛ يجب المرور بفلو مباع تحت التسليم والموافقتين", 409);
        const [created] = await tx<any[]>`
          insert into operations.vehicles(vin,car_name,statement,agent_name,interior_color,exterior_color,model_year,plate_no,batch_no,location_id,branch_code,status_code,has_notes,notes,status_notes,missing_reservation_location,created_by,updated_by)
          values (${data.vin},${data.carName},${data.statement},${data.agentName},${data.interiorColor},${data.exteriorColor},${data.modelYear},${data.plateNo},${data.batchNo},${data.locationId}::uuid,${data.branchCode},${data.statusCode},${data.statusCode===STATUS_CODES.notes},${data.notes},${data.statusNotes},${data.missingReservationLocation},${user.id}::uuid,${user.id}::uuid)
          returning *,id::text
        `;
        if (data.statusNotes) await tx`insert into operations.vehicle_status_notes(vehicle_id,status_code,note,created_by) values (${created.id}::uuid,${data.statusCode},${data.statusNotes},${user.id}::uuid)`;
        if (data.statusCode === STATUS_CODES.underDelivery) {
          await tx`insert into operations.vehicle_approvals(vehicle_id,cycle_no,is_current,financial_approved,administrative_approved) values (${created.id}::uuid,1,true,false,false)`;
          await outbox(tx,user,"operations.vehicle.approval_pending","vehicle",created.id,{title:"سيارة في انتظار الموافقات",description:`دخلت السيارة ${vin} إلى مباع تحت التسليم`,internalPath:`/operations/approvals?vehicle=${created.id}`},created.id);
        }
        await audit(tx,user,"vehicle.created","vehicle",created.id,{},created);
        await outbox(tx,user,"operations.vehicle.created","vehicle",created.id,{ title:"إضافة سيارة", description:`تمت إضافة السيارة ${vin}`,internalPath:`/operations?vehicle=${created.id}`},created.id);
        return created;
      }
      const [before] = await tx<any[]>`select v.*,v.id::text,l.branch_code as location_branch_code from operations.vehicles v left join operations.locations l on l.id=v.location_id where v.id=${id}::uuid and coalesce(v.is_deleted,false)=false for update`;
      if (!before) throw new OperationsError("VEHICLE_NOT_FOUND", "السيارة غير موجودة", 404);
      if (!scope.all && !scope.branches.includes(before.branch_code || before.location_branch_code || "")) throw new OperationsError("FORBIDDEN", "السيارة خارج نطاق فرعك", 403);
      if (before.vin !== vin && !isSystemAdmin(user)) throw new OperationsError("FORBIDDEN", "تغيير رقم الهيكل متاح لمدير النظام فقط", 403);
      if (data.statusCode === STATUS_CODES.delivered && before.status_code !== STATUS_CODES.delivered) {
        if (before.status_code !== STATUS_CODES.underDelivery) throw new OperationsError("VEHICLE_NOT_ELIGIBLE", "يجب أن تكون السيارة بحالة مباع تحت التسليم قبل التسليم النهائي", 409);
        const [approval] = await tx<any[]>`select financial_approved,administrative_approved from operations.vehicle_approvals where vehicle_id=${id}::uuid and is_current=true limit 1`;
        if (!approval?.financial_approved || !approval?.administrative_approved) {
          const missing = !approval?.financial_approved ? "الموافقة المالية" : "الموافقة الإدارية";
          throw new OperationsError("VEHICLE_NOT_ELIGIBLE", `لا يمكن إتمام التسليم لأن ${missing} لم تكتمل`, 409, {}, { vin: before.vin, missingApproval: missing });
        }
      }
      const [updated] = await tx<any[]>`
        update operations.vehicles set vin=${data.vin},car_name=${data.carName},statement=${data.statement},agent_name=${data.agentName},interior_color=${data.interiorColor},exterior_color=${data.exteriorColor},model_year=${data.modelYear},plate_no=${data.plateNo},batch_no=${data.batchNo},location_id=${data.locationId}::uuid,branch_code=${data.branchCode},status_code=${data.statusCode},has_notes=${data.statusCode===STATUS_CODES.notes},notes=${data.notes},status_notes=${data.statusNotes},missing_reservation_location=${data.missingReservationLocation},updated_by=${user.id}::uuid,version=version+1,updated_at=now()
        where id=${id}::uuid returning *,id::text
      `;
      if (data.statusNotes && (before.status_code !== data.statusCode || before.status_notes !== data.statusNotes)) await tx`insert into operations.vehicle_status_notes(vehicle_id,status_code,note,created_by) values (${id}::uuid,${data.statusCode},${data.statusNotes},${user.id}::uuid)`;
      if (data.statusCode === STATUS_CODES.underDelivery && before.status_code !== STATUS_CODES.underDelivery) {
        const [last] = await tx<any[]>`select coalesce(max(cycle_no),0)::int as cycle from operations.vehicle_approvals where vehicle_id=${id}::uuid`;
        await tx`update operations.vehicle_approvals set is_current=false,updated_at=now() where vehicle_id=${id}::uuid and is_current=true`;
        await tx`insert into operations.vehicle_approvals(vehicle_id,cycle_no,is_current,financial_approved,administrative_approved) values (${id}::uuid,${Number(last?.cycle||0)+1},true,false,false)`;
        await outbox(tx,user,"operations.vehicle.approval_pending","vehicle",id,{title:"سيارة في انتظار الموافقات",description:`دخلت السيارة ${vin} إلى مباع تحت التسليم`,internalPath:`/operations/approvals?vehicle=${id}`},id);
      }
      if (before.location_id !== data.locationId || before.status_code !== data.statusCode) {
        await tx`insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,status_note,missing_reservation_location,performed_by,performed_by_name,performed_by_role,performed_by_branch,before_data,after_data) values (${id}::uuid,${before.location_id||null}::uuid,${data.locationId}::uuid,${before.status_code},${data.statusCode},${data.statusNotes},${data.missingReservationLocation},${user.id}::uuid,${user.fullName},${roleName(user)},${actorBranch(user)},${sqlJson(tx,before)},${sqlJson(tx,updated)})`;
      }
      await audit(tx,user,"vehicle.updated","vehicle",id,before,updated);
      return updated;
    });
  } catch (error: any) {
    if (error instanceof OperationsError) throw error;
    if (error?.code === "23505") throw new OperationsError("CONFLICT", "رقم الهيكل مسجل بالفعل", 409, { vin: "رقم الهيكل مستخدم" });
    throw error;
  }
}

export async function importVehicles(user: SessionUser, rawRows: unknown) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  if (!rows.length) throw new OperationsError("VALIDATION_ERROR", "ملف الاستيراد لا يحتوي على صفوف", 422);
  if (rows.length > 5000) throw new OperationsError("VALIDATION_ERROR", "الحد الأقصى 5000 صف في العملية الواحدة", 422);
  const seen = new Set<string>();
  const results: Array<Record<string, unknown>> = [];
  let added = 0, updated = 0, failed = 0;
  for (let index=0; index<rows.length; index+=1) {
    const row = (rows[index] || {}) as Record<string, unknown>;
    const vin = clean(row.vin || row["VIN"] || row["الهيكل"] || row["رقم الهيكل"]);
    if (!vin) { failed+=1; results.push({ row:index+2,vin,error:"رقم الهيكل مطلوب" }); continue; }
    if (seen.has(vin)) { failed+=1; results.push({ row:index+2,vin,error:"رقم الهيكل مكرر داخل الملف" }); continue; }
    seen.add(vin);
    try {
      const sql = getSql();
      const [existing] = await sql<any[]>`select *,id::text,location_id::text from operations.vehicles where vin=${vin} and coalesce(is_deleted,false)=false limit 1`;
      const supplied = (value: unknown) => clean(value) || undefined;
      await saveVehicle(user, {
        id: existing?.id,
        vin,
        carName: supplied(row.carName || row["السيارة"]) ?? existing?.car_name,
        statement: supplied(row.statement || row["البيان"] || row["الوصف"]) ?? existing?.statement,
        agentName: supplied(row.agentName || row["الوكيل"]) ?? existing?.agent_name,
        interiorColor: supplied(row.interiorColor || row["اللون الداخلي"]) ?? existing?.interior_color,
        exteriorColor: supplied(row.exteriorColor || row["اللون الخارجي"]) ?? existing?.exterior_color,
        modelYear: supplied(row.modelYear || row["الموديل"]) ?? existing?.model_year,
        plateNo: supplied(row.plateNo || row["اللوحة"]) ?? existing?.plate_no,
        batchNo: supplied(row.batchNo || row["اسم الدفعة بالتاريخ"]) ?? existing?.batch_no,
        locationId: supplied(row.locationId) ?? existing?.location_id,
        statusCode: supplied(row.statusCode) ?? existing?.status_code ?? STATUS_CODES.available,
        notes: supplied(row.notes || row["ملاحظات في السيارة"]) ?? existing?.notes,
        statusNotes: supplied(row.statusNotes || row["ملاحظات الحالة"]) ?? existing?.status_notes,
        missingReservationLocation: supplied(row.missingReservationLocation || row["حجز - نواقص - تحديد مكان"]) ?? existing?.missing_reservation_location,
      });
      if (existing) updated+=1; else added+=1;
      results.push({ row:index+2,vin,status:existing?"updated":"added" });
    } catch (error) {
      failed+=1; results.push({ row:index+2,vin,error:error instanceof Error?error.message:"تعذر حفظ الصف" });
    }
  }
  return { total:rows.length,added,updated,failed,skipped:0,results };
}

export async function createMovement(user: SessionUser, payload: Record<string, unknown>) {
  const vehicleIds = uniqueText(payload.vehicleIds);
  const destinationLocationId = clean(payload.destinationLocationId);
  const newStatusCode = statusCode(payload.newStatusCode);
  const statusNote = clean(payload.statusNote);
  const missingReservationLocation = clean(payload.missingReservationLocation);
  const checklistByVehicle = (payload.checklistByVehicle && typeof payload.checklistByVehicle === "object" ? payload.checklistByVehicle : {}) as Record<string,Record<string,unknown>>;
  if (!vehicleIds.length || !destinationLocationId || !newStatusCode) throw new OperationsError("VALIDATION_ERROR", "اختر سيارة واحدة على الأقل والمكان والحالة الجديدة", 422);
  if (newStatusCode === STATUS_CODES.notes && !statusNote) throw new OperationsError("VALIDATION_ERROR", "ملاحظات الحالة مطلوبة", 422, { statusNote:"ملاحظات الحالة مطلوبة" });
  const sql = getSql(); const scope=scopeValues(user); const batchNo=`MOV-${Date.now()}-${Math.floor(Math.random()*10000).toString().padStart(4,"0")}`;
  return sql.begin(async (tx) => {
    const [destination] = await tx<any[]>`select id::text,code,name,branch_code from operations.locations where id=${destinationLocationId}::uuid and is_active=true`;
    if (!destination) throw new OperationsError("INVALID_DESTINATION_LOCATION","المكان الجديد غير صحيح",422);
    if (!scope.all && destination.branch_code && !scope.branches.includes(destination.branch_code)) throw new OperationsError("FORBIDDEN","المكان الجديد خارج نطاق فرعك",403);
    const vehicles = await tx<any[]>`
      select v.*,v.id::text,l.code as location_code,l.name as location_name,l.branch_code as location_branch_code
      from operations.vehicles v left join operations.locations l on l.id=v.location_id
      where v.id=any(${vehicleIds}::uuid[]) and coalesce(v.is_deleted,false)=false and coalesce(v.is_archived,false)=false
      order by v.id for update
    `;
    if (vehicles.length !== vehicleIds.length) throw new OperationsError("VEHICLE_NOT_FOUND","إحدى السيارات غير موجودة أو مؤرشفة",404);
    for (const vehicle of vehicles) {
      if (!scope.all && !scope.branches.includes(vehicle.branch_code || vehicle.location_branch_code || "")) throw new OperationsError("FORBIDDEN",`السيارة ${vehicle.vin} خارج نطاق فرعك`,403);
      if (newStatusCode===STATUS_CODES.delivered) {
        if (vehicle.status_code!==STATUS_CODES.underDelivery) throw new OperationsError("VEHICLE_NOT_ELIGIBLE",`السيارة ${vehicle.vin} يجب أن تكون بحالة مباع تحت التسليم أولًا`,409);
        const [approval]=await tx<any[]>`select financial_approved,administrative_approved from operations.vehicle_approvals where vehicle_id=${vehicle.id}::uuid and is_current=true limit 1`;
        if (!approval?.financial_approved || !approval?.administrative_approved) {
          const missing=!approval?.financial_approved?"الموافقة المالية":!approval?.administrative_approved?"الموافقة الإدارية":"الموافقات";
          throw new OperationsError("VEHICLE_NOT_ELIGIBLE",`لا يمكن إتمام التسليم لأن ${missing} لم تكتمل`,409,{},{ vin:vehicle.vin,missingApproval:missing });
        }
      }
    }
    const [batch]=await tx<any[]>`insert into operations.movement_batches(batch_no,destination_location_id,new_status_code,vehicle_count,performed_by,performed_by_name,performed_by_role,performed_by_branch) values (${batchNo},${destinationLocationId}::uuid,${newStatusCode},${vehicles.length},${user.id}::uuid,${user.fullName},${roleName(user)},${actorBranch(user)}) returning id::text,batch_no`;
    const movements=[];
    for (const vehicle of vehicles) {
      const before={...vehicle};
      const movementId=randomUUID();
      if (vehicle.location_code==="agency") {
        const checks=checklistByVehicle[vehicle.id] || {};
        for (const [itemCode,value] of Object.entries(checks)) {
          const isPresent=Boolean(value && (typeof value!=="object" || (value as any).isPresent!==false));
          const note=typeof value==="object"?clean((value as any).note)||null:null;
          const [old]=await tx<any[]>`select is_present,note from operations.vehicle_checklist where vehicle_id=${vehicle.id}::uuid and item_code=${itemCode} limit 1`;
          await tx`insert into operations.vehicle_checklist(vehicle_id,item_code,is_present,note,updated_by,updated_at) values (${vehicle.id}::uuid,${itemCode},${isPresent},${note},${user.id}::uuid,now()) on conflict(vehicle_id,item_code) do update set is_present=excluded.is_present,note=excluded.note,updated_by=excluded.updated_by,updated_at=now()`;
          await tx`insert into operations.vehicle_checklist_history(vehicle_id,item_code,previous_value,new_value,note,movement_id,changed_by) values (${vehicle.id}::uuid,${itemCode},${old?.is_present??null},${isPresent},${note},${movementId}::uuid,${user.id}::uuid)`;
        }
      }
      const [updated]=await tx<any[]>`update operations.vehicles set location_id=${destinationLocationId}::uuid,branch_code=${destination.branch_code||vehicle.branch_code},status_code=${newStatusCode},has_notes=${newStatusCode===STATUS_CODES.notes},status_notes=${statusNote||null},missing_reservation_location=${missingReservationLocation||vehicle.missing_reservation_location||null},updated_by=${user.id}::uuid,version=version+1,updated_at=now() where id=${vehicle.id}::uuid returning *,id::text`;
      if (statusNote) await tx`insert into operations.vehicle_status_notes(vehicle_id,status_code,note,created_by) values (${vehicle.id}::uuid,${newStatusCode},${statusNote},${user.id}::uuid)`;
      if (newStatusCode===STATUS_CODES.underDelivery && vehicle.status_code!==STATUS_CODES.underDelivery) {
        const [last]=await tx<any[]>`select coalesce(max(cycle_no),0)::int as cycle from operations.vehicle_approvals where vehicle_id=${vehicle.id}::uuid`;
        await tx`update operations.vehicle_approvals set is_current=false,updated_at=now() where vehicle_id=${vehicle.id}::uuid and is_current=true`;
        await tx`insert into operations.vehicle_approvals(vehicle_id,cycle_no,is_current,financial_approved,administrative_approved) values (${vehicle.id}::uuid,${Number(last?.cycle||0)+1},true,false,false)`;
      }
      const [movement]=await tx<any[]>`insert into operations.movements(id,batch_id,vehicle_id,from_location_id,to_location_id,old_status,new_status,status_note,missing_reservation_location,performed_by,performed_by_name,performed_by_role,performed_by_branch,before_data,after_data) values (${movementId}::uuid,${batch.id}::uuid,${vehicle.id}::uuid,${vehicle.location_id||null}::uuid,${destinationLocationId}::uuid,${vehicle.status_code},${newStatusCode},${statusNote||null},${missingReservationLocation||null},${user.id}::uuid,${user.fullName},${roleName(user)},${actorBranch(user)},${sqlJson(tx,before)},${sqlJson(tx,updated)}) returning *,id::text`;
      movements.push(movement);
      await audit(tx,user,"vehicle.moved","vehicle",vehicle.id,before,updated,null,batch.id);
      await outbox(tx,user,"operations.vehicle.moved","vehicle",vehicle.id,{title:"حركة سيارة",description:`تم تحريك ${vehicle.vin} إلى ${destination.name}`,internalPath:`/operations/movements?vehicle=${vehicle.id}`,batchId:batch.id},vehicle.id);
    }
    return { batch, movements };
  });
}

export async function createRequest(user: SessionUser,payload:Record<string,unknown>) {
  const sql=getSql(); const requestType=clean(payload.requestType); const vehicleIds=uniqueText(payload.vehicleIds); const destinationLocationId=clean(payload.destinationLocationId); const photographyDate=clean(payload.photographyDate);
  if (!['transfer','photo'].includes(requestType)) throw new OperationsError("VALIDATION_ERROR","نوع الطلب غير صحيح",422,{requestType:"اختر نقل أو تصوير"});
  if (!vehicleIds.length) throw new OperationsError("VALIDATION_ERROR","اختر سيارة واحدة على الأقل",422,{vehicleIds:"السيارات مطلوبة"});
  if (!destinationLocationId) throw new OperationsError("VALIDATION_ERROR",requestType==='transfer'?"وجهة النقل مطلوبة":"مكان التصوير مطلوب",422,{destinationLocationId:requestType==='transfer'?"الوجهة مطلوبة":"مكان التصوير مطلوب"});
  if (requestType==='photo'&&!photographyDate) throw new OperationsError("VALIDATION_ERROR","تاريخ التصوير مطلوب",422,{photographyDate:"تاريخ التصوير مطلوب"});
  const scope=scopeValues(user); const requestNo=`${requestType==='transfer'?'TR':'PH'}-${Date.now()}-${Math.floor(Math.random()*10000).toString().padStart(4,'0')}`;
  return sql.begin(async(tx)=>{
    const vehicles=await tx<any[]>`select v.*,v.id::text,l.id::text as location_id,l.code as location_code,l.name as location_name,l.branch_code as location_branch_code from operations.vehicles v left join operations.locations l on l.id=v.location_id where v.id=any(${vehicleIds}::uuid[]) and coalesce(v.is_deleted,false)=false and coalesce(v.is_archived,false)=false order by v.id for update`;
    if(vehicles.length!==vehicleIds.length) throw new OperationsError("VEHICLE_NOT_FOUND","إحدى السيارات غير موجودة أو مؤرشفة",404);
    const active=await tx<any[]>`select rv.vehicle_id::text,r.request_no from operations.request_vehicles rv join operations.requests r on r.id=rv.request_id where rv.vehicle_id=any(${vehicleIds}::uuid[]) and r.status not in ('completed','cancelled','deleted') and r.deleted_at is null limit 1`;
    if(active[0]) throw new OperationsError("DUPLICATE_ACTIVE_REQUEST",`السيارة مرتبطة بطلب جارٍ ${active[0].request_no}`,409);
    let destination:any=null;
    if(destinationLocationId){ [destination]=await tx<any[]>`select id::text,code,name,branch_code from operations.locations where id=${destinationLocationId}::uuid and is_active=true`; if(!destination) throw new OperationsError("INVALID_DESTINATION_LOCATION","الوجهة غير صحيحة",422); }
    const sourceLocationIds=[...new Set(vehicles.map(v=>v.location_id).filter(Boolean))];
    const sourceBranchCodes=[...new Set(vehicles.map(v=>v.branch_code||v.location_branch_code).filter(Boolean))];
    if(sourceLocationIds.length!==1) throw new OperationsError("INVALID_SOURCE_LOCATION","يجب أن تكون جميع سيارات الطلب في مكان مصدر واحد",422,{vehicleIds:"اختر سيارات من مكان مصدر واحد"});
    if(sourceBranchCodes.length!==1) throw new OperationsError("INVALID_SOURCE_LOCATION","يجب أن تكون جميع سيارات الطلب في فرع مصدر واحد",422,{vehicleIds:"اختر سيارات من فرع مصدر واحد"});
    for(const vehicle of vehicles){
      if(!scope.all&&!scope.branches.includes(vehicle.branch_code||vehicle.location_branch_code||'')) throw new OperationsError("FORBIDDEN",`السيارة ${vehicle.vin} خارج نطاق فرعك`,403);
      if(!vehicle.location_id) throw new OperationsError("INVALID_SOURCE_LOCATION",`السيارة ${vehicle.vin} لا تحتوي على مكان حالي صالح`,422,{}, {vin:vehicle.vin});
      if(vehicle.status_code===STATUS_CODES.delivered) throw new OperationsError("VEHICLE_NOT_ELIGIBLE",`السيارة ${vehicle.vin} تم تسليمها ولا تقبل طلب نقل أو تصوير جديد`,409,{}, {vin:vehicle.vin,status:vehicle.status_code});
      if(requestType==='transfer'&&vehicle.location_id===destinationLocationId) throw new OperationsError("INVALID_DESTINATION_LOCATION",`وجهة السيارة ${vehicle.vin} مطابقة لمكانها الحالي`,422);
    }
    const [request]=await tx<any[]>`insert into operations.requests(request_no,request_type,source_location_id,destination_location_id,source_branch_code,destination_branch_code,status,current_stage,reason,priority,photography_type,photography_date,notes,requested_by,requested_by_name,requested_by_branch) values (${requestNo},${requestType},${sourceLocationIds[0]}::uuid,${destinationLocationId||null}::uuid,${sourceBranchCodes[0]},${destination?.branch_code||null},'new',0,${clean(payload.reason)||null},${clean(payload.priority)||null},${clean(payload.photographyType)||null},${photographyDate||null}::date,${clean(payload.notes)||null},${user.id}::uuid,${user.fullName},${actorBranch(user)}) returning *,id::text`;
    for(const vehicle of vehicles){ await tx`insert into operations.request_vehicles(request_id,vehicle_id,source_location_id,source_branch_code,vehicle_snapshot) values (${request.id}::uuid,${vehicle.id}::uuid,${vehicle.location_id||null}::uuid,${vehicle.branch_code||vehicle.location_branch_code||null},${sqlJson(tx,{vin:vehicle.vin,carName:vehicle.car_name,statement:vehicle.statement,modelYear:vehicle.model_year,interiorColor:vehicle.interior_color,exteriorColor:vehicle.exterior_color,locationName:vehicle.location_name,statusCode:vehicle.status_code})})`; }
    await tx`insert into operations.request_events(request_id,stage,stage_code,action,previous_state,new_state,actor_id,actor_name,actor_role,actor_branch) values (${request.id}::uuid,0,'new','created','{}'::jsonb,${sqlJson(tx,request)},${user.id}::uuid,${user.fullName},${roleName(user)},${actorBranch(user)})`;
    await audit(tx,user,"request.created","request",request.id,{},request,clean(payload.notes)||null,request.id);
    await outbox(tx,user,`operations.${requestType}_request.created`,'request',request.id,{title:requestType==='transfer'?'طلب نقل جديد':'طلب تصوير جديد',description:`تم إنشاء الطلب ${requestNo}`,internalPath:`/operations/requests?request=${request.id}`,vehicleIds},null,request.id);
    return request;
  });
}

export async function listRequests(user:SessionUser,filters:Record<string,unknown>={}){
  const sql=getSql(); const type=clean(filters.type); const status=clean(filters.status); const search=clean(filters.search); const pattern=`%${search}%`; const scope=scopeValues(user); const limit=Math.min(Math.max(asInt(filters.limit,200),1),1000);
  const rows=await sql<any[]>`
    select r.*,r.id::text,sl.name as source_location_name,dl.name as destination_location_name,
      count(rv.vehicle_id)::int as vehicles_count,string_agg(v.vin,', ' order by v.vin) as vins,
      jsonb_agg(jsonb_build_object('id',v.id::text,'vin',v.vin,'car_name',v.car_name,'statement',v.statement,'model_year',v.model_year,'interior_color',v.interior_color,'exterior_color',v.exterior_color,'location_name',vl.name,'status_code',v.status_code) order by v.vin) as vehicles
    from operations.requests r left join operations.locations sl on sl.id=r.source_location_id left join operations.locations dl on dl.id=r.destination_location_id
    join operations.request_vehicles rv on rv.request_id=r.id join operations.vehicles v on v.id=rv.vehicle_id left join operations.locations vl on vl.id=v.location_id
    where r.deleted_at is null and (${type}='' or r.request_type=${type}) and (${status}='' or r.status=${status})
      and (${search}='' or r.request_no ilike ${pattern} or coalesce(r.requested_by_name,'') ilike ${pattern} or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern})
      and (${scope.all} or r.source_branch_code=any(${scope.branches}::text[]) or r.destination_branch_code=any(${scope.branches}::text[]) or r.requested_by_branch=any(${scope.branches}::text[]))
    group by r.id,sl.name,dl.name order by r.requested_at desc limit ${limit}
  `;
  return rows;
}

export async function getRequestDetail(user:SessionUser,idValue:unknown){
  const id=clean(idValue); if(!id) throw new OperationsError("VALIDATION_ERROR","معرف الطلب مطلوب",422,{id:"معرف الطلب مطلوب"});
  const sql=getSql(); const scope=scopeValues(user);
  const [request]=await sql<any[]>`
    select r.*,r.id::text,sl.name as source_location_name,dl.name as destination_location_name,
      count(rv.vehicle_id)::int as vehicles_count,string_agg(v.vin,', ' order by v.vin) as vins,
      jsonb_agg(jsonb_build_object('id',v.id::text,'vin',v.vin,'car_name',v.car_name,'statement',v.statement,'model_year',v.model_year,'interior_color',v.interior_color,'exterior_color',v.exterior_color,'location_name',vl.name,'status_code',v.status_code) order by v.vin) as vehicles
    from operations.requests r
    left join operations.locations sl on sl.id=r.source_location_id
    left join operations.locations dl on dl.id=r.destination_location_id
    join operations.request_vehicles rv on rv.request_id=r.id
    join operations.vehicles v on v.id=rv.vehicle_id
    left join operations.locations vl on vl.id=v.location_id
    where r.id=${id}::uuid and r.deleted_at is null
      and (${scope.all} or r.source_branch_code=any(${scope.branches}::text[]) or r.destination_branch_code=any(${scope.branches}::text[]) or r.requested_by_branch=any(${scope.branches}::text[]))
    group by r.id,sl.name,dl.name
  `;
  if(!request) throw new OperationsError("REQUEST_NOT_FOUND","الطلب غير موجود أو خارج نطاق صلاحيتك",404);
  const events=await sql<any[]>`select e.*,e.id::text from operations.request_events e where e.request_id=${id}::uuid order by e.created_at`;
  return {...request,events};
}

const stageMap:Record<string,{stage:number,status:string,event:string}>={request_received:{stage:1,status:'request_received',event:'request_received'},vehicle_sent:{stage:2,status:'vehicle_sent',event:'vehicle_sent'},vehicle_received:{stage:3,status:'vehicle_received',event:'vehicle_received'},complete:{stage:4,status:'completed',event:'completed'}};
export async function progressRequest(user:SessionUser,payload:Record<string,unknown>){
  const sql=getSql(); const id=clean(payload.requestId); const action=clean(payload.requestAction || payload.action); const next=stageMap[action]; if(!id||!next) throw new OperationsError("VALIDATION_ERROR","الإجراء أو الطلب غير صحيح",422);
  return sql.begin(async(tx)=>{
    const [request]=await tx<any[]>`select r.*,r.id::text from operations.requests r where r.id=${id}::uuid and r.deleted_at is null for update`;
    if(!request) throw new OperationsError("REQUEST_NOT_FOUND","الطلب غير موجود",404);
    if(request.status==='cancelled') throw new OperationsError("CONFLICT","لا يمكن تنفيذ إجراء على طلب ملغي",409);
    if(request.status==='completed') throw new OperationsError("CONFLICT","الطلب مكتمل بالفعل",409);
    const admin=isSystemAdmin(user); const branch=actorBranch(user); const isOverride=Boolean(payload.override); const overrideReason=clean(payload.overrideReason);
    if(isOverride&&!admin) throw new OperationsError("FORBIDDEN","التجاوز الإداري متاح لمدير النظام فقط",403);
    if(isOverride&&!overrideReason) throw new OperationsError("VALIDATION_ERROR","سبب التجاوز الإداري مطلوب",422,{overrideReason:"سبب التجاوز مطلوب"});
    if(!isOverride&&next.stage!==Number(request.current_stage)+1) throw new OperationsError("CONFLICT","يجب تنفيذ مراحل الطلب بالترتيب ولا يمكن تكرار المرحلة",409);
    if(isOverride&&next.stage<=Number(request.current_stage)) throw new OperationsError("CONFLICT","لا يمكن استخدام التجاوز الإداري لتكرار مرحلة أو الرجوع إلى مرحلة سابقة",409);
    if(!admin){ if(action==='request_received'&&request.destination_branch_code&&branch!==request.destination_branch_code) throw new OperationsError("FORBIDDEN","استلام الطلب مسؤولية الفرع المستهدف",403); if(action==='vehicle_sent'&&request.source_branch_code&&branch!==request.source_branch_code) throw new OperationsError("FORBIDDEN","إرسال السيارة مسؤولية الفرع المصدر",403); if(action==='vehicle_received'&&request.destination_branch_code&&branch!==request.destination_branch_code) throw new OperationsError("FORBIDDEN","استلام السيارة مسؤولية الفرع المستهدف",403); if(action==='complete'&&request.destination_branch_code&&branch!==request.destination_branch_code) throw new OperationsError("FORBIDDEN","إنهاء الطلب مسؤولية الفرع المستهدف",403); }
    const before={...request};
    if(action==='vehicle_received'&&request.request_type==='transfer'){
      const vehicles=await tx<any[]>`select v.*,v.id::text from operations.request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id where rv.request_id=${id}::uuid order by v.id for update`;
      for(const vehicle of vehicles){ const [updated]=await tx<any[]>`update operations.vehicles set location_id=${request.destination_location_id}::uuid,branch_code=${request.destination_branch_code||vehicle.branch_code},updated_by=${user.id}::uuid,version=version+1,updated_at=now() where id=${vehicle.id}::uuid returning *,id::text`; await tx`insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,request_id,performed_by,performed_by_name,performed_by_role,performed_by_branch,before_data,after_data) values (${vehicle.id}::uuid,${vehicle.location_id||null}::uuid,${request.destination_location_id}::uuid,${vehicle.status_code},${vehicle.status_code},${id}::uuid,${user.id}::uuid,${user.fullName},${roleName(user)},${branch},${sqlJson(tx,vehicle)},${sqlJson(tx,updated)})`; }
    }
    const [updatedRequest]=await tx<any[]>`update operations.requests set current_stage=${next.stage},status=${next.status},completed_at=case when ${next.status}='completed' then now() else completed_at end,version=version+1,updated_at=now() where id=${id}::uuid returning *,id::text`;
    await tx`insert into operations.request_events(request_id,stage,stage_code,action,note,previous_state,new_state,actor_id,actor_name,actor_role,actor_branch,is_override,override_reason) values (${id}::uuid,${next.stage},${next.event},${action},${clean(payload.note)||null},${sqlJson(tx,before)},${sqlJson(tx,updatedRequest)},${user.id}::uuid,${user.fullName},${roleName(user)},${branch},${isOverride},${overrideReason||null})`;
    await audit(tx,user,`request.${action}`,'request',id,before,updatedRequest,clean(payload.note)||overrideReason||null,id,isOverride);
    await outbox(tx,user,`operations.${request.request_type}_request.${next.event}`,'request',id,{title:`تحديث الطلب ${request.request_no}`,description:`تم تنفيذ مرحلة ${next.event}`,internalPath:`/operations/requests?request=${id}`},null,id);
    return updatedRequest;
  });
}

export async function cancelOrDeleteRequest(user:SessionUser,payload:Record<string,unknown>){
  const sql=getSql(); const id=clean(payload.requestId); const mode=clean(payload.mode); const reason=clean(payload.reason); if(!id||!['delete','cancel'].includes(mode)) throw new OperationsError("VALIDATION_ERROR","الإجراء غير صحيح",422); if(mode==='cancel'&&!reason) throw new OperationsError("VALIDATION_ERROR","سبب الإلغاء مطلوب",422,{reason:"سبب الإلغاء مطلوب"});
  return sql.begin(async(tx)=>{ const [request]=await tx<any[]>`select *,id::text from operations.requests where id=${id}::uuid and deleted_at is null for update`; if(!request) throw new OperationsError("REQUEST_NOT_FOUND","الطلب غير موجود",404); const admin=isSystemAdmin(user); const branch=actorBranch(user); const relatedBranch=[request.source_branch_code,request.destination_branch_code,request.requested_by_branch].filter(Boolean).includes(branch); const isCreator=String(request.requested_by||'')===String(user.id||''); if(!admin&&mode==='delete'&&!isCreator) throw new OperationsError("FORBIDDEN","لا يستطيع حذف الطلب قبل التنفيذ إلا منشئه أو مدير النظام",403); if(!admin&&mode==='cancel'&&!isCreator&&!relatedBranch) throw new OperationsError("FORBIDDEN","لا تملك صلاحية إلغاء هذا الطلب",403); const before={...request}; if(mode==='delete'){ if(Number(request.current_stage)>0) throw new OperationsError("CONFLICT","لا يمكن حذف طلب بدأ تنفيذه؛ استخدم الإلغاء",409); const [updated]=await tx<any[]>`update operations.requests set status='deleted',deleted_at=now(),deleted_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid returning *,id::text`; await tx`insert into operations.request_events(request_id,stage,stage_code,action,previous_state,new_state,actor_id,actor_name,actor_role,actor_branch) values (${id}::uuid,${request.current_stage},${request.status},'deleted',${sqlJson(tx,before)},${sqlJson(tx,updated)},${user.id}::uuid,${user.fullName},${roleName(user)},${actorBranch(user)})`; await audit(tx,user,'request.deleted','request',id,before,updated,null,id); return updated; }
    if(['completed','cancelled'].includes(request.status)) throw new OperationsError("CONFLICT","لا يمكن إلغاء الطلب في حالته الحالية",409); const [updated]=await tx<any[]>`update operations.requests set status='cancelled',cancelled_at=now(),cancelled_by=${user.id}::uuid,cancellation_reason=${reason},updated_at=now() where id=${id}::uuid returning *,id::text`; await tx`insert into operations.request_events(request_id,stage,stage_code,action,note,previous_state,new_state,actor_id,actor_name,actor_role,actor_branch) values (${id}::uuid,${request.current_stage},${request.status},'cancelled',${reason},${sqlJson(tx,before)},${sqlJson(tx,updated)},${user.id}::uuid,${user.fullName},${roleName(user)},${actorBranch(user)})`; await audit(tx,user,'request.cancelled','request',id,before,updated,reason,id); return updated; });
}

export async function listApprovals(user:SessionUser,filter:Record<string,unknown>={}){
  const sql=getSql(); const scope=scopeValues(user); const type=clean(filter.type); const search=clean(filter.search); const pattern=`%${search}%`;
  const rows=await sql<any[]>`
    select a.*,a.id::text,v.id::text as vehicle_id,v.vin,v.car_name,v.statement,v.model_year,v.interior_color,v.exterior_color,v.status_code,s.name as status_name,l.name as location_name,l.branch_code,
      fu.full_name as financial_approved_by_name,au.full_name as administrative_approved_by_name
    from operations.vehicle_approvals a join operations.vehicles v on v.id=a.vehicle_id left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code left join core.users fu on fu.id=a.financial_approved_by left join core.users au on au.id=a.administrative_approved_by
    where a.is_current=true and v.status_code=${STATUS_CODES.underDelivery} and coalesce(v.is_deleted,false)=false and coalesce(v.is_archived,false)=false
      and (${type}='' or (${type}='financial' and a.financial_approved=false) or (${type}='administrative' and a.administrative_approved=false) or (${type}='completed' and a.financial_approved=true and a.administrative_approved=true))
      and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern})
      and (${scope.all} or coalesce(v.branch_code,l.branch_code,'')=any(${scope.branches}::text[]))
    order by a.updated_at desc,v.vin
  `;
  return rows;
}

export async function updateApproval(user:SessionUser,payload:Record<string,unknown>){
  const sql=getSql(); const vehicleId=clean(payload.vehicleId); const type=clean(payload.approvalType); const action=clean(payload.approvalAction || payload.action); const note=clean(payload.note); const reason=clean(payload.reason); if(!vehicleId||!['financial','administrative','all'].includes(type)||!['approve','reverse','note','reset'].includes(action)) throw new OperationsError("VALIDATION_ERROR","بيانات الموافقة غير صحيحة",422); if(['reverse','reset'].includes(action)&&!reason) throw new OperationsError("VALIDATION_ERROR","سبب التراجع أو المسح مطلوب",422,{reason:"السبب مطلوب"});
  return sql.begin(async(tx)=>{ const [approval]=await tx<any[]>`select a.*,a.id::text,v.status_code,v.vin from operations.vehicle_approvals a join operations.vehicles v on v.id=a.vehicle_id where a.vehicle_id=${vehicleId}::uuid and a.is_current=true for update`; if(!approval) throw new OperationsError("APPROVAL_NOT_FOUND","سجل الموافقات غير موجود",404); if(approval.status_code!==STATUS_CODES.underDelivery) throw new OperationsError("VEHICLE_NOT_ELIGIBLE","الموافقات متاحة فقط للسيارات بحالة مباع تحت التسليم",409); const before={...approval}; let financial=Boolean(approval.financial_approved),administrative=Boolean(approval.administrative_approved),financialNote=approval.financial_note,administrativeNote=approval.administrative_note,financialBy=approval.financial_approved_by,administrativeBy=approval.administrative_approved_by,financialAt=approval.financial_approved_at,administrativeAt=approval.administrative_approved_at;
    if(type==='financial'){ if(action==='approve'){financial=true;financialBy=user.id;financialAt=new Date();if(note)financialNote=note;} if(action==='reverse'){financial=false;financialBy=null;financialAt=null;} if(action==='note')financialNote=note||null; }
    if(type==='administrative'){ if(action==='approve'){administrative=true;administrativeBy=user.id;administrativeAt=new Date();if(note)administrativeNote=note;} if(action==='reverse'){administrative=false;administrativeBy=null;administrativeAt=null;} if(action==='note')administrativeNote=note||null; }
    if(type==='all'&&action==='reset'){financial=false;administrative=false;financialBy=null;administrativeBy=null;financialAt=null;administrativeAt=null;}
    const [updated]=await tx<any[]>`update operations.vehicle_approvals set financial_approved=${financial},administrative_approved=${administrative},financial_note=${financialNote||null},administrative_note=${administrativeNote||null},financial_approved_by=${financialBy||null}::uuid,administrative_approved_by=${administrativeBy||null}::uuid,financial_approved_at=${financialAt||null},administrative_approved_at=${administrativeAt||null},updated_at=now() where id=${approval.id}::uuid returning *,id::text`;
    await tx`insert into operations.approval_events(approval_id,vehicle_id,approval_type,action,previous_state,new_state,reason,actor_id,actor_name,actor_role) values (${approval.id}::uuid,${vehicleId}::uuid,${type},${action},${sqlJson(tx,before)},${sqlJson(tx,updated)},${reason||note||null},${user.id}::uuid,${user.fullName},${roleName(user)})`;
    await audit(tx,user,`approval.${type}.${action}`,'vehicle_approval',approval.id,before,updated,reason||note||null,vehicleId);
    await outbox(tx,user,`operations.vehicle.approval_${action}`,'vehicle',vehicleId,{title:"تحديث موافقات السيارة",description:`${approval.vin} - ${type} - ${action}`,internalPath:`/operations/approvals?vehicle=${vehicleId}`},vehicleId);
    return updated; });
}

export async function listMovements(user:SessionUser,filter:Record<string,unknown>={}){
  const sql=getSql(); const scope=scopeValues(user); const search=clean(filter.search); const pattern=`%${search}%`; const fromDate=clean(filter.fromDate); const toDate=clean(filter.toDate); const fromLocation=clean(filter.fromLocation); const toLocation=clean(filter.toLocation); const limit=Math.min(Math.max(asInt(filter.limit,500),1),2000);
  return sql<any[]>`
    select m.*,m.id::text,m.batch_id::text,v.vin,v.car_name,v.statement,v.model_year,fl.name as from_location_name,tl.name as to_location_name,os.name as old_status_name,ns.name as new_status_name
    from operations.movements m join operations.vehicles v on v.id=m.vehicle_id left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id left join operations.vehicle_statuses os on os.code=m.old_status left join operations.vehicle_statuses ns on ns.code=m.new_status
    where (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(m.performed_by_name,'') ilike ${pattern})
      and (${fromDate}='' or m.created_at>=${fromDate}::date) and (${toDate}='' or m.created_at<${toDate}::date+interval '1 day')
      and (${fromLocation}='' or fl.code=${fromLocation}) and (${toLocation}='' or tl.code=${toLocation})
      and (${scope.all} or coalesce(m.performed_by_branch,v.branch_code,fl.branch_code,tl.branch_code,'')=any(${scope.branches}::text[]))
    order by m.created_at desc limit ${limit}
  `;
}

export async function getShortages(user:SessionUser,branchFilter?:unknown){
  const sql=getSql(); const scope=scopeValues(user); const branch=clean(branchFilter); const exclusions=ACCESSORY_EXCLUSIONS.map((word)=>`%${word.toLowerCase()}%`);
  const rows=await sql<any[]>`
    with normalized as (
      select v.id,v.vin,lower(trim(coalesce(v.car_name,''))) as car_key,lower(trim(coalesce(v.statement,''))) as statement_key,
        lower(trim(coalesce(v.model_year,''))) as model_key,lower(trim(coalesce(v.exterior_color,''))) as exterior_key,lower(trim(coalesce(v.interior_color,''))) as interior_key,
        v.car_name,v.statement,v.model_year,v.exterior_color,v.interior_color,l.code as location_code,l.name as location_name
      from operations.vehicles v join operations.locations l on l.id=v.location_id
      where coalesce(v.is_deleted,false)=false and coalesce(v.is_archived,false)=false and v.status_code=any(${ACTIVE_SHORTAGE_STATUSES}::text[])
        and l.code=any(${SHORTAGE_LOCATIONS}::text[])
        and not (lower(trim(coalesce(v.statement,''))) like any(${exclusions}::text[]))
        and (${scope.all} or coalesce(v.branch_code,l.branch_code,'')=any(${scope.branches}::text[]) or l.code='warehouse')
    ), combos as (
      select car_key,statement_key,model_key,exterior_key,interior_key,min(car_name) as car_name,min(statement) as statement,min(model_year) as model_year,min(exterior_color) as exterior_color,min(interior_color) as interior_color,
        count(*)::int as total_count,array_agg(distinct location_name order by location_name) as existing_locations
      from normalized group by car_key,statement_key,model_key,exterior_key,interior_key
    ), branches(code,name) as (values ('multaqa','الملتقى'),('hall','الصالة'),('qadisiyah','القادسية'))
    select b.code as branch_code,b.name as branch_name,c.car_name,c.statement,c.model_year,c.exterior_color,c.interior_color,0::int as branch_count,c.existing_locations,c.total_count,
      concat_ws('|',c.car_key,c.statement_key,c.model_key,c.exterior_key,c.interior_key) as combination_key
    from combos c cross join branches b
    where (${branch}='' or b.code=${branch}) and not exists (
      select 1 from normalized n where n.location_code=b.code and n.car_key=c.car_key and n.statement_key=c.statement_key and n.model_key=c.model_key and n.exterior_key=c.exterior_key and n.interior_key=c.interior_key
    ) order by b.name,c.car_name,c.statement,c.model_year,c.exterior_color,c.interior_color
  `;
  const counts={multaqa:0,hall:0,qadisiyah:0,total:rows.length}; for(const row of rows){ if(row.branch_code in counts)(counts as any)[row.branch_code]+=1; }
  return {rows,counts};
}

export async function getOperationsDashboard(user:SessionUser){
  const sql=getSql(); const scope=scopeValues(user);
  const locations=await sql<any[]>`
    select l.code as key,l.name,
      count(v.id) filter(where v.status_code not in (${STATUS_CODES.underDelivery},${STATUS_CODES.delivered}) and coalesce(v.is_archived,false)=false and coalesce(v.is_deleted,false)=false)::int as actual_total,
      count(v.id) filter(where v.status_code=${STATUS_CODES.underDelivery} and coalesce(v.is_archived,false)=false and coalesce(v.is_deleted,false)=false)::int as under_delivery,
      count(v.id) filter(where v.status_code=${STATUS_CODES.available} and coalesce(v.is_archived,false)=false and coalesce(v.is_deleted,false)=false)::int as available_for_sale,
      count(v.id) filter(where v.status_code=any(${[STATUS_CODES.reserved,STATUS_CODES.reservation]}::text[]) and coalesce(v.is_archived,false)=false and coalesce(v.is_deleted,false)=false)::int as reserved,
      count(v.id) filter(where v.status_code=${STATUS_CODES.delivered} and coalesce(v.is_archived,false)=false and coalesce(v.is_deleted,false)=false)::int as delivered,
      count(v.id) filter(where v.status_code=${STATUS_CODES.notes} and coalesce(v.is_archived,false)=false and coalesce(v.is_deleted,false)=false)::int as has_notes
    from operations.locations l left join operations.vehicles v on v.location_id=l.id and (${scope.all} or coalesce(v.branch_code,l.branch_code,'')=any(${scope.branches}::text[]))
    where l.is_active=true group by l.code,l.name,l.sort_order order by l.sort_order
  `;
  const [inventory]=await sql<any[]>`
    select count(*) filter(where status_code not in (${STATUS_CODES.underDelivery},${STATUS_CODES.delivered}) and coalesce(is_archived,false)=false and coalesce(is_deleted,false)=false)::int as actual_total,
      count(*) filter(where status_code=${STATUS_CODES.available} and coalesce(is_archived,false)=false and coalesce(is_deleted,false)=false)::int as available_for_sale,
      count(*) filter(where status_code=${STATUS_CODES.underDelivery} and coalesce(is_archived,false)=false and coalesce(is_deleted,false)=false)::int as under_delivery,
      count(*) filter(where status_code=${STATUS_CODES.notes} and coalesce(is_archived,false)=false and coalesce(is_deleted,false)=false)::int as has_notes
    from operations.vehicles where (${scope.all} or coalesce(branch_code,'')=any(${scope.branches}::text[]))
  `;
  const approvalRows=await listApprovals(user,{}); const requests=await listRequests(user,{limit:1000}); const shortages=await getShortages(user);
  const approvals={total:approvalRows.length,missingFinancial:approvalRows.filter(r=>!r.financial_approved).length,missingAdministrative:approvalRows.filter(r=>!r.administrative_approved).length,completed:approvalRows.filter(r=>r.financial_approved&&r.administrative_approved).length};
  const transfers={total:requests.length,requestReceived:requests.filter(r=>r.status==='request_received').length,vehicleSent:requests.filter(r=>r.status==='vehicle_sent').length,vehicleReceived:requests.filter(r=>r.status==='vehicle_received').length,completed:requests.filter(r=>r.status==='completed').length};
  const agency=locations.find(r=>r.key==='agency');
  return {inventory:{actualTotal:Number(inventory?.actual_total||0),agency:Number(agency?.actual_total||0),availableForSale:Number(inventory?.available_for_sale||0),underDelivery:Number(inventory?.under_delivery||0),hasNotes:Number(inventory?.has_notes||0)},locations:locations.map(r=>({key:r.key,name:r.name,actualTotal:Number(r.actual_total||0),underDelivery:Number(r.under_delivery||0),availableForSale:Number(r.available_for_sale||0),reserved:Number(r.reserved||0),delivered:Number(r.delivered||0),hasNotes:Number(r.has_notes||0)})),approvals,shortages:{total:shortages.counts.total,multaqa:shortages.counts.multaqa,hall:shortages.counts.hall,qadisiyah:shortages.counts.qadisiyah},transfers,requests:requests.slice(0,20)};
}

export async function archiveVehicle(user:SessionUser,payload:Record<string,unknown>){
  const sql=getSql(); const vehicleId=clean(payload.vehicleId); const reason=clean(payload.reason); if(!vehicleId||!reason) throw new OperationsError("VALIDATION_ERROR","السيارة وسبب الأرشفة مطلوبان",422);
  return sql.begin(async(tx)=>{ const [vehicle]=await tx<any[]>`select v.*,v.id::text from operations.vehicles v where v.id=${vehicleId}::uuid and coalesce(v.is_deleted,false)=false for update`; if(!vehicle) throw new OperationsError("VEHICLE_NOT_FOUND","السيارة غير موجودة",404); if(vehicle.status_code!==STATUS_CODES.delivered) throw new OperationsError("VEHICLE_NOT_ELIGIBLE","يجب أن تكون السيارة بحالة مباع تم التسليم قبل الأرشفة",409); const [approval]=await tx<any[]>`select *,id::text from operations.vehicle_approvals where vehicle_id=${vehicleId}::uuid order by cycle_no desc limit 1`; if(!approval?.financial_approved||!approval?.administrative_approved) throw new OperationsError("VEHICLE_NOT_ELIGIBLE","لا يمكن الأرشفة قبل اكتمال الموافقتين",409); const [tracking]=await tx<any[]>`select o.id::text,o.status,o.is_archived,count(vs.id)::int as total,count(vs.id) filter(where vs.status='completed')::int as completed from tracking.order_vehicles ov join tracking.orders o on o.id=ov.order_id and coalesce(o.is_deleted,false)=false left join tracking.vehicle_stages vs on vs.vehicle_id=ov.id where (ov.operations_vehicle_id=${vehicleId}::uuid or (ov.operations_vehicle_id is null and ov.vin=${vehicle.vin})) group by o.id order by o.updated_at desc limit 1`; if(!tracking||Number(tracking.total)<=0||Number(tracking.completed)<Number(tracking.total)||tracking.status!=='completed') throw new OperationsError("TRACKING_NOT_COMPLETE","لا يمكن أرشفة السيارة لأن طلب التراكينج لم يكتمل بنسبة 100%",409); const active=await tx<any[]>`select 1 from operations.request_vehicles rv join operations.requests r on r.id=rv.request_id where rv.vehicle_id=${vehicleId}::uuid and r.status not in ('completed','cancelled','deleted') and r.deleted_at is null limit 1`; if(active[0]) throw new OperationsError("CONFLICT","لا يمكن أرشفة سيارة مرتبطة بطلب نقل أو تصوير جارٍ",409); const [updated]=await tx<any[]>`update operations.vehicles set is_archived=true,archived_at=now(),archived_by=${user.id}::uuid,archive_reason=${reason},updated_by=${user.id}::uuid,updated_at=now() where id=${vehicleId}::uuid returning *,id::text`; await tx`insert into operations.vehicle_archives(vehicle_id,approval_id,tracking_order_id,reason,status_at_archive,archived_by,archived_by_name,snapshot) values (${vehicleId}::uuid,${approval.id}::uuid,${tracking.id}::uuid,${reason},${vehicle.status_code},${user.id}::uuid,${user.fullName},${sqlJson(tx,{vehicle,approval,tracking})})`; await audit(tx,user,'vehicle.archived','vehicle',vehicleId,vehicle,updated,reason); await outbox(tx,user,'operations.vehicle.archived','vehicle',vehicleId,{title:'أرشفة سيارة',description:`تمت أرشفة ${vehicle.vin}`,internalPath:`/operations/archive?vehicle=${vehicleId}`},vehicleId); return updated; });
}

export async function listActivity(user:SessionUser,filter:Record<string,unknown>={}){
  if(!isSystemAdmin(user)&&!user.permissions.includes('operations.audit.view')&&!user.roleCodes.includes('operations_manager')) throw new OperationsError('FORBIDDEN','ليس لديك صلاحية عرض سجل التدقيق',403);
  const sql=getSql(); const search=clean(filter.search); const pattern=`%${search}%`; return sql<any[]>`select *,id::text from audit.activity_log where system_code='operations' and (${search}='' or action ilike ${pattern} or coalesce(actor_name,'') ilike ${pattern} or coalesce(entity_id,'') ilike ${pattern}) order by created_at desc limit 1000`;
}

export async function saveOperationLocation(user:SessionUser,payload:Record<string,unknown>){
  const sql=getSql();const id=clean(payload.id);const code=clean(payload.code);const name=clean(payload.name);const branchCode=clean(payload.branchCode)||null;const sortOrder=asInt(payload.sortOrder,0);if(!code||!name)throw new OperationsError('VALIDATION_ERROR','كود واسم الموقع مطلوبان',422,{...(!code?{code:'الكود مطلوب'}:{}),...(!name?{name:'الاسم مطلوب'}:{})});
  return sql.begin(async(tx)=>{const before=id?(await tx<any[]>`select *,id::text from operations.locations where id=${id}::uuid`)[0]:null;const [saved]=id?await tx<any[]>`update operations.locations set code=${code},name=${name},branch_code=${branchCode},sort_order=${sortOrder},is_active=${payload.isActive!==false},updated_at=now() where id=${id}::uuid returning *,id::text`:await tx<any[]>`insert into operations.locations(code,name,branch_code,sort_order,is_active) values (${code},${name},${branchCode},${sortOrder},${payload.isActive!==false}) returning *,id::text`;await audit(tx,user,id?'settings.location.updated':'settings.location.created','location',saved.id,before||{},saved);return saved;});
}

export async function saveOperationStatus(user:SessionUser,payload:Record<string,unknown>){
  const sql=getSql();const originalCode=clean(payload.originalCode);const code=clean(payload.code);const name=clean(payload.name);const sortOrder=asInt(payload.sortOrder,0);if(!code||!name)throw new OperationsError('VALIDATION_ERROR','كود واسم الحالة مطلوبان',422);
  return sql.begin(async(tx)=>{const before=originalCode?(await tx<any[]>`select * from operations.vehicle_statuses where code=${originalCode}`)[0]:null;if(originalCode&&originalCode!==code){const usage=(await tx<any[]>`select count(*)::int as count from operations.vehicles where status_code=${originalCode}`)[0];if(Number(usage?.count||0)>0)throw new OperationsError('CONFLICT','لا يمكن تغيير كود حالة مستخدمة في سيارات حالية',409);}const [saved]=await tx<any[]>`insert into operations.vehicle_statuses(code,name,sort_order,counts_as_active_inventory,is_final,requires_status_note,is_active,updated_at) values (${code},${name},${sortOrder},${Boolean(payload.countsAsActiveInventory)},${Boolean(payload.isFinal)},${Boolean(payload.requiresStatusNote)},${payload.isActive!==false},now()) on conflict(code) do update set name=excluded.name,sort_order=excluded.sort_order,counts_as_active_inventory=excluded.counts_as_active_inventory,is_final=excluded.is_final,requires_status_note=excluded.requires_status_note,is_active=excluded.is_active,updated_at=now() returning *`;await audit(tx,user,before?'settings.status.updated':'settings.status.created','vehicle_status',code,before||{},saved);return saved;});
}
