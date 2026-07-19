import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { canAccessAllOperationsBranches, canAccessBranch, requireOperationsUser } from "../_operations-auth.js";
import { bodyOf, clean, handleOperationsError, integer, OperationsError, primaryBranch, primaryRole, writeAudit, writeOutbox } from "../_operations-utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    await ensureOperationsSchema();
    const user = await requireOperationsUser(request, response, request.method === "GET" ? "operations.movements.view" : "operations.movements.create");
    if (!user) return;
    const sql = getSql();

    if (request.method === "GET") {
      const page = integer(request.query.page, 1, 1, 100000);
      const limit = integer(request.query.limit, 40, 1, 100);
      const offset = (page - 1) * limit;
      const search = clean(request.query.search);
      const fromDate = clean(request.query.fromDate);
      const toDate = clean(request.query.toDate);
      const fromTime = clean(request.query.fromTime);
      const toTime = clean(request.query.toTime);
      const fromLocationId = clean(request.query.fromLocationId);
      const toLocationId = clean(request.query.toLocationId);
      const oldStatus = clean(request.query.oldStatus);
      const newStatus = clean(request.query.newStatus);
      const performer = clean(request.query.performer);
      const requestNo = clean(request.query.requestNo);
      const pattern = `%${search}%`;
      const performerPattern = `%${performer}%`;
      const requestPattern = `%${requestNo}%`;
      const branches = user.branchCodes;
  const allBranches = canAccessAllOperationsBranches(user);

      const [countRow] = await sql<any[]>`
        select count(*)::int as total
        from operations.movements m join operations.vehicles v on v.id=m.vehicle_id
        left join operations.transfer_requests r on r.id=m.request_id
        where (${allBranches} or coalesce(v.branch_code,'')=any(${branches}::text[]))
          and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern})
          and (${fromDate}='' or m.created_at::date >= ${fromDate || null}::date)
          and (${toDate}='' or m.created_at::date <= ${toDate || null}::date)
          and (${fromTime}='' or m.created_at::time >= ${fromTime || null}::time)
          and (${toTime}='' or m.created_at::time <= ${toTime || null}::time)
          and (${fromLocationId}='' or m.from_location_id=${fromLocationId || null}::uuid)
          and (${toLocationId}='' or m.to_location_id=${toLocationId || null}::uuid)
          and (${oldStatus}='' or m.old_status=${oldStatus})
          and (${newStatus}='' or m.new_status=${newStatus})
          and (${performer}='' or coalesce(m.performed_by_name,'') ilike ${performerPattern})
          and (${requestNo}='' or coalesce(r.request_no,'') ilike ${requestPattern})
      `;
      const movements = await sql<any[]>`
        select m.id::text,m.batch_id::text,m.request_id::text,m.old_status,m.new_status,m.note,m.status_note,m.reservation_shortage_location_note,
          m.performed_by_name,m.performed_role,m.performed_branch,m.created_at,v.id::text as vehicle_id,v.vin,v.car_name,v.statement,
          fl.name as from_location,tl.name as to_location,r.request_no
        from operations.movements m join operations.vehicles v on v.id=m.vehicle_id
        left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id
        left join operations.transfer_requests r on r.id=m.request_id
        where (${allBranches} or coalesce(v.branch_code,'')=any(${branches}::text[]))
          and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern})
          and (${fromDate}='' or m.created_at::date >= ${fromDate || null}::date)
          and (${toDate}='' or m.created_at::date <= ${toDate || null}::date)
          and (${fromTime}='' or m.created_at::time >= ${fromTime || null}::time)
          and (${toTime}='' or m.created_at::time <= ${toTime || null}::time)
          and (${fromLocationId}='' or m.from_location_id=${fromLocationId || null}::uuid)
          and (${toLocationId}='' or m.to_location_id=${toLocationId || null}::uuid)
          and (${oldStatus}='' or m.old_status=${oldStatus})
          and (${newStatus}='' or m.new_status=${newStatus})
          and (${performer}='' or coalesce(m.performed_by_name,'') ilike ${performerPattern})
          and (${requestNo}='' or coalesce(r.request_no,'') ilike ${requestPattern})
        order by m.created_at desc limit ${limit} offset ${offset}
      `;
      return response.status(200).json({ ok: true, movements, total: Number(countRow?.total || 0), page, limit });
    }

    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
    const body = bodyOf(request);
    const action = clean(body.action);
    const items = action === "batch" ? (Array.isArray(body.vehicles) ? body.vehicles : []) : [body];
    const neededPermission = action === "batch" ? "operations.movements.batch" : "operations.movements.create";
    if (!user.isSystemAdmin && !user.permissions.includes(neededPermission)) throw new OperationsError("ليس لديك صلاحية تنفيذ هذه الحركة", 403);
    if (!items.length) throw new OperationsError("اختر سيارة واحدة على الأقل");
    if (items.length > 200) throw new OperationsError("الحد الأقصى للحركة الجماعية 200 سيارة");
    const ids = items.map((item: any) => clean(item.vehicleId)).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw new OperationsError("لا يمكن اختيار السيارة نفسها مرتين");
    const destinationLocationId = clean(body.destinationLocationId);
    const newStatus = clean(body.newStatus);
    const generalNote = clean(body.generalNote) || null;
    const idempotencyKey = clean(body.idempotencyKey) || randomUUID();
    if (!destinationLocationId || !newStatus) throw new OperationsError("المكان الجديد والحالة الجديدة مطلوبان");

    const result = await sql.begin(async (tx) => {
      const [destination] = await tx`select id::text,code,name,branch_code from operations.locations where id=${destinationLocationId}::uuid and is_active=true`;
      if (!destination) throw new OperationsError("المكان الجديد غير صحيح");
      if (!canAccessBranch(user, destination.branch_code) && !user.isSystemAdmin) throw new OperationsError("المكان الجديد خارج صلاحية فرعك", 403);
      const [status] = await tx`select code,name,requires_status_note,starts_delivery_cycle,is_final_delivery from operations.vehicle_statuses where code=${newStatus} and is_active=true`;
      if (!status) throw new OperationsError("الحالة الجديدة غير صحيحة");
      const vehicles = await tx`
        select v.*,l.code as current_location_code,l.name as current_location_name
        from operations.vehicles v left join operations.locations l on l.id=v.location_id
        where v.id=any(${ids}::uuid[]) and v.is_deleted=false and v.is_archived=false order by v.id for update
      `;
      if (vehicles.length !== ids.length) throw new OperationsError("إحدى السيارات غير موجودة أو مؤرشفة");
      const byId = new Map(items.map((item: any) => [clean(item.vehicleId), item]));
      for (const vehicle of vehicles) {
        if (!canAccessBranch(user, vehicle.branch_code)) throw new OperationsError(`السيارة ${vehicle.vin} خارج صلاحية فرعك`, 403);
        const item: any = byId.get(vehicle.id);
        const statusNote = clean(item?.statusNote || body.statusNote);
        if (status.requires_status_note && !statusNote) throw new OperationsError(`ملاحظات الحالة مطلوبة للسيارة ${vehicle.vin}`);
        if (status.is_final_delivery) {
          if (vehicle.status_code !== "under_delivery") throw new OperationsError(`السيارة ${vehicle.vin} لم تمر بحالة مباع تحت التسليم`);
          const [approval] = await tx`select financial_approved,administrative_approved from operations.vehicle_approvals where vehicle_id=${vehicle.id}::uuid order by created_at desc limit 1`;
          if (!approval?.financial_approved || !approval?.administrative_approved) throw new OperationsError(`لا يمكن تسليم السيارة ${vehicle.vin} قبل اكتمال الموافقتين`);
        }
        const active = await tx`
          select r.request_no from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id
          where rv.vehicle_id=${vehicle.id}::uuid and r.is_deleted=false and r.status not in ('completed','cancelled') limit 1
        `;
        if (active.length) throw new OperationsError(`السيارة ${vehicle.vin} مرتبطة بطلب جارٍ رقم ${active[0].request_no}`);
        const checks = Array.isArray(item?.checks) ? item.checks : [];
        if (checks.length && vehicle.current_location_code !== "agency") throw new OperationsError(`التشيك يظهر فقط عندما يكون مكان السيارة الحالي هو الوكالة: ${vehicle.vin}`);
      }

      const [batch] = await tx`
        insert into operations.movement_batches(destination_location_id,new_status,general_note,performed_by,performed_by_name)
        values (${destinationLocationId}::uuid,${newStatus},${generalNote},${user.id}::uuid,${user.fullName}) returning id::text
      `;
      const movementIds: string[] = [];
      for (const vehicle of vehicles) {
        const item: any = byId.get(vehicle.id);
        const itemNote = clean(item?.note) || null;
        const statusNote = clean(item?.statusNote || body.statusNote) || null;
        const reservationNote = clean(item?.reservationShortageLocationNote) || null;
        const before = { locationId: vehicle.location_id, statusCode: vehicle.status_code, branchCode: vehicle.branch_code, version: vehicle.version };
        const after = { locationId: destinationLocationId, statusCode: newStatus, branchCode: destination.branch_code };
        const [movement] = await tx`
          insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,note,status_note,reservation_shortage_location_note,performed_by,performed_by_name,performed_role,performed_branch,batch_id,before_data,after_data,idempotency_key)
          values (${vehicle.id}::uuid,${vehicle.location_id}::uuid,${destinationLocationId}::uuid,${vehicle.status_code},${newStatus},${itemNote || generalNote},${statusNote},${reservationNote},${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${batch.id}::uuid,${tx.json(before)},${tx.json(after)},${`${idempotencyKey}:${vehicle.id}`}) returning id::text
        `;
        movementIds.push(movement.id);
        await tx`
          update operations.vehicles set location_id=${destinationLocationId}::uuid,branch_code=${destination.branch_code || null},status_code=${newStatus},status_note=coalesce(${statusNote},status_note),reservation_shortage_location_note=coalesce(${reservationNote},reservation_shortage_location_note),has_notes=has_notes or ${Boolean(statusNote || reservationNote || itemNote)},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${vehicle.id}::uuid
        `;
        if (vehicle.status_code !== "under_delivery" && status.starts_delivery_cycle) {
          const [approval] = await tx`
            insert into operations.vehicle_approvals(vehicle_id,delivery_cycle_id,financial_approved,administrative_approved,updated_at)
            values (${vehicle.id}::uuid,${randomUUID()}::uuid,false,false,now()) returning id::text
          `;
          await tx`insert into operations.approval_events(vehicle_id,approval_id,approval_type,action,actor_id,actor_name) values (${vehicle.id}::uuid,${approval.id}::uuid,'both','initialized',${user.id}::uuid,${user.fullName})`;
        }
        for (const [type, note] of [["status", statusNote], ["reservation_shortage_location", reservationNote], ["vehicle", itemNote]] as const) {
          if (note) await tx`insert into operations.vehicle_notes(vehicle_id,note_type,note,movement_id,created_by) values (${vehicle.id}::uuid,${type},${note},${movement.id}::uuid,${user.id}::uuid)`;
        }
        const checks = Array.isArray(item?.checks) ? item.checks : [];
        for (const check of checks) {
          const code = clean(check.code); const checkStatus = clean(check.status) || "unknown"; const checkNote = clean(check.note) || null;
          if (!code || !["unknown","available","missing","damaged"].includes(checkStatus)) continue;
          const [oldCheck] = await tx`select status,note from operations.vehicle_checks where vehicle_id=${vehicle.id}::uuid and item_code=${code}`;
          await tx`
            insert into operations.vehicle_checks(vehicle_id,item_code,status,note,updated_by,updated_at,movement_id)
            values (${vehicle.id}::uuid,${code},${checkStatus},${checkNote},${user.id}::uuid,now(),${movement.id}::uuid)
            on conflict(vehicle_id,item_code) do update set status=excluded.status,note=excluded.note,updated_by=excluded.updated_by,updated_at=now(),movement_id=excluded.movement_id
          `;
          if (!oldCheck || oldCheck.status !== checkStatus || (oldCheck.note || null) !== checkNote) {
            await tx`insert into operations.vehicle_check_history(vehicle_id,item_code,old_status,new_status,old_note,new_note,changed_by,movement_id) values (${vehicle.id}::uuid,${code},${oldCheck?.status || null},${checkStatus},${oldCheck?.note || null},${checkNote},${user.id}::uuid,${movement.id}::uuid)`;
          }
        }
        await writeAudit(tx, request, user, { action: "vehicle_moved", entityType: "vehicle", entityId: vehicle.id, before, after });
        await writeOutbox(tx, { eventType: "operations.vehicle.moved", aggregateType: "vehicle", aggregateId: vehicle.id, title: "حركة سيارة", description: vehicle.vin, path: `/operations/inventory?vehicle=${vehicle.id}`, metadata: { vin: vehicle.vin, movementId: movement.id, batchId: batch.id, ...after } });
      }
      return { batchId: batch.id, movementIds };
    });
    return response.status(201).json({ ok: true, ...result, message: items.length > 1 ? "تم تنفيذ الحركة الجماعية بالكامل" : "تم تنفيذ حركة السيارة" });
  } catch (error) { return handleOperationsError(response, error); }
}
