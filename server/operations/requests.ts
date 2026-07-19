import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { canAccessAllOperationsBranches, canAccessBranch, requireOperationsUser } from "../_operations-auth.js";
import { bodyOf, bool, clean, handleOperationsError, integer, OperationsError, primaryBranch, primaryRole, writeAudit, writeOutbox } from "../_operations-utils.js";

const stageOrder = ["created", "request_received", "vehicle_sent", "vehicle_received", "completed"] as const;

function requiredPermissionForStage(stage: string) {
  if (stage === "request_received") return "operations.requests.receive";
  if (stage === "vehicle_sent") return "operations.requests.send_vehicle";
  if (stage === "vehicle_received") return "operations.requests.receive_vehicle";
  if (stage === "completed") return "operations.requests.complete";
  return "operations.requests.view_all";
}

async function requestDetail(sql: any, id: string, user: any) {
  const branches = user.branchCodes;
  const allBranches = canAccessAllOperationsBranches(user);
  const [request] = await sql`
    select r.id::text,r.request_no,r.request_type,r.transfer_type,r.source_location_id::text,r.destination_location_id::text,
      r.source_branch_code,r.destination_branch_code,r.photography_date,r.status,r.notes,r.requested_by::text,r.requested_by_name,
      r.requested_by_branch,r.requested_at,r.updated_at,r.completed_at,r.cancelled_at,r.cancellation_reason,r.version,
      sl.name as source_location,dl.name as destination_location
    from operations.transfer_requests r
    left join operations.locations sl on sl.id=r.source_location_id left join operations.locations dl on dl.id=r.destination_location_id
    where r.id=${id}::uuid and r.is_deleted=false
      and (${allBranches} or r.source_branch_code=any(${branches}::text[]) or r.destination_branch_code=any(${branches}::text[]))
  `;
  if (!request) return null;
  const [vehicles, events] = await Promise.all([
    sql`
      select v.id::text,v.vin,v.car_name,v.statement,v.model_year,v.status_code,s.name as status_name,l.name as current_location,
        rv.source_location_id::text,rv.source_branch_code,rv.status_at_request,rv.created_at
      from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id
      left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code
      where rv.transfer_request_id=${id}::uuid order by rv.created_at,v.vin
    `,
    sql`
      select e.id::text,e.stage_code,e.action,e.actor_name,e.actor_role,e.actor_branch,e.note,e.before_data,e.after_data,e.is_override,e.override_reason,e.created_at
      from operations.request_stage_events e where e.request_id=${id}::uuid order by e.created_at
    `,
  ]);
  return { ...request, vehicles, events };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    await ensureOperationsSchema();
    const user = await requireOperationsUser(request, response);
    if (!user) return;
    const sql = getSql();

    if (request.method === "GET") {
      const id = clean(request.query.id);
      if (id) {
        const detail = await requestDetail(sql, id, user);
        if (!detail) return response.status(404).json({ ok: false, error: "الطلب غير موجود أو غير متاح لك" });
        return response.status(200).json({ ok: true, request: detail });
      }
      const page = integer(request.query.page, 1, 1, 100000);
      const limit = integer(request.query.limit, 30, 1, 100);
      const offset = (page - 1) * limit;
      const tab = clean(request.query.tab) || "active";
      const search = clean(request.query.search);
      const requestType = clean(request.query.requestType);
      const status = clean(request.query.status);
      const pattern = `%${search}%`;
      const branches = user.branchCodes;
      const allBranches = canAccessAllOperationsBranches(user);
      const canAll = allBranches || user.permissions.includes("operations.requests.view_all");
      const requests = await sql<any[]>`
        select r.id::text,r.request_no,r.request_type,r.source_branch_code,r.destination_branch_code,r.status,r.photography_date,r.notes,
          r.requested_by_name,r.requested_by_branch,r.requested_at,r.updated_at,r.completed_at,r.cancelled_at,
          sl.name as source_location,dl.name as destination_location,count(rv.vehicle_id)::int as vehicles_count,
          string_agg(v.vin,', ' order by v.vin) as vins
        from operations.transfer_requests r
        left join operations.locations sl on sl.id=r.source_location_id left join operations.locations dl on dl.id=r.destination_location_id
        left join operations.transfer_request_vehicles rv on rv.transfer_request_id=r.id left join operations.vehicles v on v.id=rv.vehicle_id
        where r.is_deleted=false
          and (${canAll} or r.source_branch_code=any(${branches}::text[]) or r.destination_branch_code=any(${branches}::text[]))
          and (${tab}='all' or (${tab}='outgoing' and r.source_branch_code=any(${branches}::text[])) or (${tab}='incoming' and r.destination_branch_code=any(${branches}::text[])) or (${tab}='completed' and r.status='completed') or (${tab}='cancelled' and r.status='cancelled') or (${tab}='active' and r.status not in ('completed','cancelled')))
          and (${search}='' or r.request_no ilike ${pattern} or coalesce(r.requested_by_name,'') ilike ${pattern} or exists(select 1 from operations.transfer_request_vehicles rx join operations.vehicles vx on vx.id=rx.vehicle_id where rx.transfer_request_id=r.id and vx.vin ilike ${pattern}))
          and (${requestType}='' or r.request_type=${requestType})
          and (${status}='' or r.status=${status})
        group by r.id,sl.name,dl.name order by r.requested_at desc limit ${limit} offset ${offset}
      `;
      return response.status(200).json({ ok: true, requests, page, limit });
    }

    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
    const body = bodyOf(request);
    const action = clean(body.action);

    if (action === "create") {
      const requestType = clean(body.requestType) === "photo" ? "photo" : "transfer";
      const permission = requestType === "photo" ? "operations.requests.create_photo" : "operations.requests.create_transfer";
      if (!user.isSystemAdmin && !user.permissions.includes(permission)) throw new OperationsError("ليس لديك صلاحية إنشاء هذا النوع من الطلبات", 403);
      const vehicleIds = Array.isArray(body.vehicleIds) ? body.vehicleIds.map(clean).filter(Boolean) : [];
      if (!vehicleIds.length) throw new OperationsError("اختر سيارة واحدة على الأقل");
      if (new Set(vehicleIds).size !== vehicleIds.length) throw new OperationsError("لا يمكن إضافة السيارة نفسها مرتين");
      const destinationLocationId = clean(body.destinationLocationId);
      const photographyDate = clean(body.photographyDate) || null;
      const notes = clean(body.notes) || null;
      if (!destinationLocationId) throw new OperationsError("المكان المستهدف مطلوب");
      if (requestType === "photo" && !photographyDate) throw new OperationsError("تاريخ التصوير مطلوب");

      const id = await sql.begin(async (tx) => {
        const [destination] = await tx`select id::text,name,branch_code from operations.locations where id=${destinationLocationId}::uuid and is_active=true`;
        if (!destination) throw new OperationsError("المكان المستهدف غير صحيح");
        const vehicles = await tx`
          select v.id::text,v.vin,v.location_id::text,v.branch_code,v.status_code,l.name as location_name
          from operations.vehicles v left join operations.locations l on l.id=v.location_id
          where v.id=any(${vehicleIds}::uuid[]) and v.is_deleted=false and v.is_archived=false order by v.id for update
        `;
        if (vehicles.length !== vehicleIds.length) throw new OperationsError("إحدى السيارات غير موجودة أو مؤرشفة");
        const sourceBranches = new Set(vehicles.map((v: any) => v.branch_code || ""));
        if (sourceBranches.size !== 1) throw new OperationsError("يجب أن تكون سيارات الطلب في فرع مصدر واحد");
        const sourceBranch = vehicles[0].branch_code || null;
        const sourceLocation = vehicles[0].location_id || null;
        if (!canAccessBranch(user, sourceBranch)) throw new OperationsError("لا يمكنك إنشاء طلب لسيارات فرع آخر", 403);
        if (requestType === "transfer" && sourceLocation === destinationLocationId) throw new OperationsError("لا يمكن اختيار المكان الحالي نفسه كوجهة");
        for (const vehicle of vehicles) {
          if (vehicle.location_id !== sourceLocation) throw new OperationsError("يجب أن تكون جميع السيارات في نفس المكان المصدر داخل الطلب الواحد");
          const conflict = await tx`
            select r.request_no from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id
            where rv.vehicle_id=${vehicle.id}::uuid and r.is_deleted=false and r.status not in ('completed','cancelled') limit 1
          `;
          if (conflict.length) throw new OperationsError(`السيارة ${vehicle.vin} مرتبطة بطلب جارٍ رقم ${conflict[0].request_no}`);
        }
        const [seq] = await tx`select nextval('operations.request_number_seq')::bigint as value`;
        const prefix = requestType === "photo" ? "OP-PH" : "OP-TR";
        const requestNo = `${prefix}-${new Date().getFullYear()}-${String(seq.value).padStart(6, "0")}`;
        const [created] = await tx`
          insert into operations.transfer_requests(request_no,department_code,transfer_type,request_type,source_location_id,destination_location_id,source_branch_code,destination_branch_code,photography_date,status,notes,requested_by,requested_by_name,requested_by_branch,requested_at,updated_at)
          values (${requestNo},'operations',${requestType},${requestType},${sourceLocation}::uuid,${destinationLocationId}::uuid,${sourceBranch},${destination.branch_code || null},${photographyDate}::date,'created',${notes},${user.id}::uuid,${user.fullName},${primaryBranch(user)},now(),now()) returning id::text
        `;
        for (const vehicle of vehicles) {
          await tx`
            insert into operations.transfer_request_vehicles(transfer_request_id,vehicle_id,source_location_id,source_branch_code,status_at_request)
            values (${created.id}::uuid,${vehicle.id}::uuid,${vehicle.location_id}::uuid,${vehicle.branch_code},${vehicle.status_code})
          `;
        }
        await tx`
          insert into operations.request_stage_events(request_id,stage_code,action,actor_id,actor_name,actor_role,actor_branch,note,after_data)
          values (${created.id}::uuid,'created','created',${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${notes},${tx.json({ requestNo, requestType, vehicleIds, sourceBranch, destinationBranch: destination.branch_code })})
        `;
        await writeAudit(tx, request, user, { action: "transfer_request_created", entityType: "transfer_request", entityId: created.id, after: { requestNo, requestType, vehicleIds, sourceBranch, destinationBranch: destination.branch_code, destinationLocationId } });
        await writeOutbox(tx, { eventType: "operations.transfer_request.created", aggregateType: "transfer_request", aggregateId: created.id, title: requestType === "photo" ? "طلب تصوير جديد" : "طلب نقل جديد", description: requestNo, path: `/operations/requests?request=${created.id}`, targetRoles: ["operations_branch_admin"], metadata: { requestNo, requestType, sourceBranch, destinationBranch: destination.branch_code, vehicleIds } });
        return created.id;
      });
      return response.status(201).json({ ok: true, request: await requestDetail(sql, id, user), message: "تم إنشاء الطلب" });
    }

    const id = clean(body.id);
    if (!id) throw new OperationsError("معرف الطلب مطلوب");

    if (action === "advance") {
      const stage = clean(body.stage);
      if (!stageOrder.includes(stage as any) || stage === "created") throw new OperationsError("مرحلة الطلب غير صحيحة");
      const permission = requiredPermissionForStage(stage);
      if (!user.isSystemAdmin && !user.permissions.includes(permission)) throw new OperationsError("ليس لديك صلاحية تنفيذ هذه المرحلة", 403);
      const note = clean(body.note) || null;
      const override = bool(body.override);
      const overrideReason = clean(body.overrideReason) || null;
      if (override && !user.isSystemAdmin && !user.permissions.includes("operations.override")) throw new OperationsError("ليس لديك صلاحية التجاوز الإداري", 403);
      if (override && !overrideReason) throw new OperationsError("سبب التجاوز الإداري مطلوب");

      await sql.begin(async (tx) => {
        const [row] = await tx`select * from operations.transfer_requests where id=${id}::uuid and is_deleted=false for update`;
        if (!row) throw new OperationsError("الطلب غير موجود", 404);
        if (row.status === "cancelled") throw new OperationsError("لا يمكن تنفيذ مرحلة على طلب ملغي");
        if (row.status === "completed") throw new OperationsError("الطلب مكتمل بالفعل");
        const expectedIndex = stageOrder.indexOf(row.status as any) + 1;
        const requestedIndex = stageOrder.indexOf(stage as any);
        const photoCompleteShortcut = row.request_type === "photo" && row.status === "request_received" && stage === "completed";
        if (!override && requestedIndex !== expectedIndex && !photoCompleteShortcut) throw new OperationsError("لا يمكن تخطي مراحل الطلب أو تنفيذها بترتيب غير صحيح");
        const responsibleBranch = stage === "vehicle_sent" ? row.source_branch_code : row.destination_branch_code;
        if (!user.isSystemAdmin && !canAccessBranch(user, responsibleBranch)) throw new OperationsError("هذه المرحلة تخص فرعًا آخر", 403);
        const existing = await tx`select id from operations.request_stage_events where request_id=${id}::uuid and stage_code=${stage} limit 1`;
        if (existing.length) throw new OperationsError("تم تنفيذ هذه المرحلة من قبل", 409);
        const vehicles = await tx`
          select v.*,rv.status_at_request from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id
          where rv.transfer_request_id=${id}::uuid order by v.id for update
        `;
        if (!vehicles.length) throw new OperationsError("الطلب لا يحتوي على سيارات");
        const before = { status: row.status, version: row.version };
        if (stage === "vehicle_received" && row.request_type === "transfer") {
          const [destination] = await tx`select id::text,branch_code,name from operations.locations where id=${row.destination_location_id}::uuid`;
          if (!destination) throw new OperationsError("المكان المستهدف لم يعد متاحًا");
          for (const vehicle of vehicles) {
            const [movement] = await tx`
              insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,note,performed_by,performed_by_name,performed_role,performed_branch,request_id,before_data,after_data)
              values (${vehicle.id}::uuid,${vehicle.location_id}::uuid,${row.destination_location_id}::uuid,${vehicle.status_code},${vehicle.status_code},${note || `استلام السيارة ضمن الطلب ${row.request_no}`},${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${id}::uuid,${tx.json({ locationId: vehicle.location_id, statusCode: vehicle.status_code })},${tx.json({ locationId: row.destination_location_id, statusCode: vehicle.status_code })}) returning id::text
            `;
            await tx`update operations.vehicles set location_id=${row.destination_location_id}::uuid,branch_code=${destination.branch_code || null},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${vehicle.id}::uuid`;
            await writeAudit(tx, request, user, { action: "vehicle_received_from_request", entityType: "vehicle", entityId: vehicle.id, before: { locationId: vehicle.location_id }, after: { locationId: row.destination_location_id, requestId: id, movementId: movement.id } });
          }
        }
        await tx`update operations.transfer_requests set status=${stage},completed_at=case when ${stage}='completed' then now() else completed_at end,updated_at=now(),version=version+1 where id=${id}::uuid`;
        await tx`
          insert into operations.request_stage_events(request_id,stage_code,action,actor_id,actor_name,actor_role,actor_branch,note,before_data,after_data,is_override,override_reason)
          values (${id}::uuid,${stage},${stage},${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${note},${tx.json(before)},${tx.json({ status: stage })},${override},${overrideReason})
        `;
        await writeAudit(tx, request, user, { action: `transfer_request_${stage}`, entityType: "transfer_request", entityId: id, before, after: { status: stage, override, overrideReason } });
        await writeOutbox(tx, { eventType: `operations.transfer_request.${stage}`, aggregateType: "transfer_request", aggregateId: id, title: "تحديث طلب العمليات", description: row.request_no, path: `/operations/requests?request=${id}`, metadata: { requestNo: row.request_no, stage, sourceBranch: row.source_branch_code, destinationBranch: row.destination_branch_code, override, overrideReason } });
      });
      return response.status(200).json({ ok: true, request: await requestDetail(sql, id, user), message: "تم تنفيذ المرحلة" });
    }

    if (action === "delete") {
      if (!user.isSystemAdmin && !user.permissions.includes("operations.requests.delete")) throw new OperationsError("ليس لديك صلاحية حذف الطلب", 403);
      await sql.begin(async (tx) => {
        const [row] = await tx`select * from operations.transfer_requests where id=${id}::uuid and is_deleted=false for update`;
        if (!row) throw new OperationsError("الطلب غير موجود", 404);
        if (!user.isSystemAdmin && row.requested_by !== user.id) throw new OperationsError("منشئ الطلب فقط يمكنه حذفه قبل بدء التنفيذ", 403);
        const actions = await tx`select count(*)::int as count from operations.request_stage_events where request_id=${id}::uuid and stage_code<>'created'`;
        if (Number(actions[0]?.count || 0) > 0 || row.status !== "created") throw new OperationsError("لا يمكن حذف الطلب بعد بدء التنفيذ. استخدم إلغاء الطلب");
        await tx`update operations.transfer_requests set is_deleted=true,deleted_at=now(),deleted_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid`;
        await tx`insert into operations.request_stage_events(request_id,stage_code,action,actor_id,actor_name,actor_role,actor_branch,note) values (${id}::uuid,'deleted','deleted',${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${clean(body.reason) || null})`;
        await writeAudit(tx, request, user, { action: "transfer_request_deleted", entityType: "transfer_request", entityId: id, before: row, after: { isDeleted: true } });
        await writeOutbox(tx, { eventType: "operations.transfer_request.deleted", aggregateType: "transfer_request", aggregateId: id, title: "حذف طلب عمليات", description: row.request_no, metadata: { requestNo: row.request_no } });
      });
      return response.status(200).json({ ok: true, message: "تم حذف الطلب قبل بدء التنفيذ" });
    }

    if (action === "cancel") {
      if (!user.isSystemAdmin && !user.permissions.includes("operations.requests.cancel")) throw new OperationsError("ليس لديك صلاحية إلغاء الطلب", 403);
      const reason = clean(body.reason);
      if (!reason) throw new OperationsError("سبب الإلغاء مطلوب");
      await sql.begin(async (tx) => {
        const [row] = await tx`select * from operations.transfer_requests where id=${id}::uuid and is_deleted=false for update`;
        if (!row) throw new OperationsError("الطلب غير موجود", 404);
        if (["completed","cancelled"].includes(row.status)) throw new OperationsError("لا يمكن إلغاء طلب مكتمل أو ملغي");
        await tx`update operations.transfer_requests set status='cancelled',cancelled_at=now(),cancelled_by=${user.id}::uuid,cancellation_reason=${reason},updated_at=now(),version=version+1 where id=${id}::uuid`;
        await tx`insert into operations.request_stage_events(request_id,stage_code,action,actor_id,actor_name,actor_role,actor_branch,note,before_data,after_data) values (${id}::uuid,'cancelled','cancelled',${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${reason},${tx.json({ status: row.status })},${tx.json({ status: 'cancelled' })})`;
        await writeAudit(tx, request, user, { action: "transfer_request_cancelled", entityType: "transfer_request", entityId: id, before: row, after: { status: "cancelled", reason } });
        await writeOutbox(tx, { eventType: "operations.transfer_request.cancelled", aggregateType: "transfer_request", aggregateId: id, title: "إلغاء طلب عمليات", description: row.request_no, path: `/operations/requests?request=${id}`, metadata: { requestNo: row.request_no, reason } });
      });
      return response.status(200).json({ ok: true, request: await requestDetail(sql, id, user), message: "تم إلغاء الطلب مع الحفاظ على السجل" });
    }

    throw new OperationsError("الإجراء غير مدعوم");
  } catch (error) { return handleOperationsError(response, error); }
}
