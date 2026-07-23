import type { VercelRequest } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { getSql } from "../_db.js";
import { MarketingError, clean, dateValue, hasPermission, isAdmin, pageValues, safeJson } from "./common.js";
import { cancelPhotographyRequest, transitionPhotographyRequest } from "../operations/photography-requests.js";

export async function listStock(request: VercelRequest) {
  const sql = getSql();
  const { page, pageSize, offset } = pageValues(request);
  const search = clean(request.query.search);
  const location = clean(request.query.location);
  const model = clean(request.query.model);
  const pattern = `%${search}%`;
  const where = sql`
    v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true
    and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern} or coalesce(v.exterior_color,'') ilike ${pattern} or coalesce(v.interior_color,'') ilike ${pattern})
    and (${location}='' or l.code=${location} or l.name=${location})
    and (${model}='' or v.model_year=${model})
  `;
  const [count] = await sql<{total:number}[]>`select count(*)::int total from operations.vehicles v left join operations.locations l on l.id=v.location_id where ${where}`;
  const rows = await sql<any[]>`
    select v.id::text,v.vin,v.car_name,v.statement,v.interior_color,v.exterior_color,v.model_year,l.code location_code,l.name location_name,
      v.status_code,coalesce(s.name,v.status_code) status_name,
      pr.id::text active_photography_request_id,pr.request_no active_photography_request_no,pr.photography_date active_photography_date,pr.status active_photography_status
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.vehicle_statuses s on s.code=v.status_code
    left join lateral (
      select r.id,r.request_no,r.photography_date,r.status from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id
      where rv.vehicle_id=v.id and r.request_kind='photography' and r.is_deleted=false and r.cancelled_at is null and r.status<>'completed'
      order by r.requested_at desc limit 1
    ) pr on true
    where ${where}
    order by l.sort_order,v.car_name,v.statement,v.vin limit ${pageSize} offset ${offset}
  `;
  const locations = await sql<any[]>`select code,name from operations.locations where is_active=true order by sort_order`;
  const models = await sql<any[]>`select distinct model_year from operations.vehicles where is_deleted=false and archived_at is null and model_year is not null order by model_year desc`;
  return { ok: true, rows, total: Number(count?.total || 0), page, pageSize, locations, models: models.map((row) => row.model_year) };
}

export async function listPhotographyRequests(request: VercelRequest) {
  const sql = getSql();
  const { page, pageSize, offset } = pageValues(request);
  const completed = clean(request.query.completed);
  const search = clean(request.query.search);
  const pattern = `%${search}%`;
  const where = sql`
    r.request_kind='photography' and r.is_deleted=false
    and (${completed}='' or (${completed}='true' and r.status='completed') or (${completed}='false' and r.status<>'completed'))
    and (${search}='' or r.request_no ilike ${pattern} or coalesce(r.requested_by_name,'') ilike ${pattern} or exists(select 1 from operations.transfer_request_vehicles rx join operations.vehicles vx on vx.id=rx.vehicle_id where rx.transfer_request_id=r.id and (vx.vin ilike ${pattern} or coalesce(vx.car_name,'') ilike ${pattern})))
  `;
  const [count] = await sql<{total:number}[]>`select count(*)::int total from operations.transfer_requests r where ${where}`;
  const rows = await sql<any[]>`
    select r.id::text,r.request_no,r.request_kind,r.status,r.note,r.photography_date,r.photography_location,r.requested_by::text,r.requested_by_name,r.requested_by_role,r.requested_by_branch,r.requested_at,r.completed_at,r.cancelled_at,r.cancellation_reason,
      coalesce(cars.vehicles,'[]'::json) vehicles,coalesce(events.events,'[]'::json) events
    from operations.transfer_requests r
    left join lateral (
      select json_agg(json_build_object('vehicle_id',v.id::text,'vin',v.vin,'car_name',v.car_name,'statement',v.statement,'model_year',v.model_year,'interior_color',v.interior_color,'exterior_color',v.exterior_color,'location_name',l.name,'status_name',coalesce(s.name,v.status_code)) order by v.vin) vehicles
      from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code
      where rv.transfer_request_id=r.id
    ) cars on true
    left join lateral (
      select json_agg(json_build_object('id',e.id::text,'stage',e.stage,'action',e.action,'note',e.note,'actor_name',e.actor_name,'actor_role',e.actor_role,'actor_branch',e.actor_branch,'created_at',e.created_at) order by e.created_at) events
      from operations.transfer_request_events e where e.transfer_request_id=r.id
    ) events on true
    where ${where} order by r.photography_date nulls last,r.requested_at desc limit ${pageSize} offset ${offset}
  `;
  return { ok: true, rows, total: Number(count?.total || 0), page, pageSize };
}

export async function photographyAction(user: SessionUser, body: Record<string, any>) {
  const sql = getSql();
  const action = clean(body.action);
  if (action === "create_photography_request") {
    if (!hasPermission(user, "marketing.photography_requests.create")) throw new MarketingError(403, "لا توجد لديك صلاحية إنشاء طلب تصوير", "FORBIDDEN");
    const vehicleId = clean(body.vehicleId);
    const photographyDate = dateValue(body.photographyDate);
    const note = clean(body.note);
    if (!vehicleId || !photographyDate) throw new MarketingError(400, "اختر السيارة وتاريخ التصوير", "VALIDATION_ERROR");
    return sql.begin(async (tx) => {
      const [vehicle] = await tx<any[]>`
        select v.*,v.id::text,l.name location_name,l.code location_code,l.branch_code
        from operations.vehicles v left join operations.locations l on l.id=v.location_id
        where v.id=${vehicleId}::uuid and v.is_deleted=false and v.archived_at is null for update of v
      `;
      if (!vehicle) throw new MarketingError(404, "السيارة غير موجودة في مخزن العمليات", "VEHICLE_NOT_FOUND");
      const [active] = await tx<any[]>`
        select r.request_no from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id
        where rv.vehicle_id=${vehicleId}::uuid and r.request_kind='photography' and r.is_deleted=false and r.cancelled_at is null and r.status<>'completed' limit 1
      `;
      if (active) throw new MarketingError(409, `السيارة مرتبطة بالفعل بطلب تصوير نشط ${active.request_no}`, "DUPLICATE_ACTIVE_REQUEST");
      const [sequence] = await tx<{n:number}[]>`select nextval('marketing.photography_request_no_seq')::bigint n`;
      const requestNo = `PH-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(sequence?.n || 1).padStart(6,'0')}`;
      const [request] = await tx<any[]>`
        insert into operations.transfer_requests(request_no,department_code,transfer_type,request_kind,source_location_id,status,requested_by,requested_by_name,requested_by_role,requested_by_branch,source_branch_code,note,photography_date,photography_location,marketing_campaign_id)
        values (${requestNo},'marketing','photography','photography',${vehicle.location_id},'photography_requested',${user.id}::uuid,${user.fullName},${user.roles.join('، ') || 'مستخدم التسويق'},${user.branches.join('، ') || null},${vehicle.branch_code || vehicle.location_code || null},${note || null},${photographyDate}::date,${vehicle.location_name || null},${clean(body.campaignId) || null}::uuid) returning *,id::text
      `;
      await tx`insert into operations.transfer_request_vehicles(transfer_request_id,vehicle_id,source_location_id,source_status) values (${request.id}::uuid,${vehicle.id}::uuid,${vehicle.location_id},${vehicle.status_code})`;
      await tx`
        insert into operations.transfer_request_events(transfer_request_id,stage,action,note,actor_id,actor_name,actor_role,actor_branch,after_data)
        values (${request.id}::uuid,'photography_requested','created',${note || null},${user.id}::uuid,${user.fullName},${user.roles.join('، ') || 'مستخدم التسويق'},${user.branches.join('، ') || null},${tx.json(safeJson({ requestNo, vehicleId, photographyDate }))})
      `;
      await tx`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data) values (${user.id}::uuid,'marketing','photography_request_created','photography_request',${request.id},${tx.json(safeJson(request))})`;
      return { ok: true, request, message: "تم إنشاء طلب التصوير وظهر في متابعة الطلبات بالتسويق والعمليات" };
    });
  }

  if (action === "photography_request_action") {
    if (!hasPermission(user, "marketing.photography_requests.manage") && !isAdmin(user)) throw new MarketingError(403, "لا توجد لديك صلاحية إدارة طلبات التصوير", "FORBIDDEN");
    const id = clean(body.id);
    const nextStatus = clean(body.nextStatus);
    if (!id || !["photography_scheduled", "photography_in_progress", "completed", "cancelled"].includes(nextStatus)) {
      throw new MarketingError(400, "الإجراء أو الحالة غير صحيح", "VALIDATION_ERROR");
    }
    return sql.begin(async (tx) => {
      const [request] = await tx<any[]>`select *,id::text from operations.transfer_requests where id=${id}::uuid and request_kind='photography' and is_deleted=false for update`;
      if (!request) throw new MarketingError(404, "طلب التصوير غير موجود", "REQUEST_NOT_FOUND");
      if (request.cancelled_at) throw new MarketingError(409, "طلب التصوير ملغي", "REQUEST_CANCELLED");
      const note = clean(body.note);
      const actor = {
        id: user.id,
        name: user.fullName,
        role: user.roles.join("، ") || "مستخدم التسويق",
        branch: user.branches.join("، ") || null,
      };
      if (nextStatus === "cancelled") {
        await cancelPhotographyRequest(tx, request, actor, note || "تم إلغاء طلب التصوير");
        return { ok: true, message: "تم إلغاء طلب التصوير مع الحفاظ على السجل" };
      }
      const requestedDate = dateValue(body.photographyDate);
      if (requestedDate) {
        await tx`update operations.transfer_requests set photography_date=${requestedDate}::date where id=${id}::uuid`;
        request.photography_date = requestedDate;
      }
      await transitionPhotographyRequest(tx, request, nextStatus, actor, note || null);
      return { ok: true, message: nextStatus === "completed" ? "تم إنهاء طلب التصوير" : "تم تحديث متابعة طلب التصوير" };
    });
  }
  throw new MarketingError(400, "إجراء طلب التصوير غير مدعوم", "INVALID_ACTION");
}
