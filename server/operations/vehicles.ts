import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { canAccessAllOperationsBranches, canAccessBranch, requireOperationsUser } from "../_operations-auth.js";
import { getOperationsVehicleDetail } from "../_operations-data.js";
import { bodyOf, bool, clean, handleOperationsError, integer, OperationsError, primaryBranch, primaryRole, writeAudit, writeOutbox } from "../_operations-utils.js";

function vehiclePayload(body: Record<string, any>) {
  return {
    vin: clean(body.vin), carName: clean(body.carName) || null, statement: clean(body.statement) || null,
    agentName: clean(body.agentName) || null, exteriorColor: clean(body.exteriorColor) || null,
    interiorColor: clean(body.interiorColor) || null, modelYear: clean(body.modelYear) || null,
    plateNo: clean(body.plateNo) || null, batchNo: clean(body.batchNo) || null,
    locationId: clean(body.locationId) || null, statusCode: clean(body.statusCode),
    notes: clean(body.notes) || null, statusNote: clean(body.statusNote) || null,
    reservationNote: clean(body.reservationShortageLocationNote) || null,
    sourceType: clean(body.sourceType) || null,
  };
}

async function validateLocationStatus(tx: any, locationId: string | null, statusCode: string) {
  const [location] = locationId ? await tx`select id::text,code,name,branch_code,location_type from operations.locations where id=${locationId}::uuid and is_active=true` : [];
  if (locationId && !location) throw new OperationsError("المكان المحدد غير صحيح");
  const [status] = await tx`select code,name,requires_status_note,starts_delivery_cycle,is_final_delivery from operations.vehicle_statuses where code=${statusCode} and is_active=true`;
  if (!status) throw new OperationsError("حالة السيارة المحددة غير صحيحة");
  return { location, status };
}

async function initializeApprovals(tx: any, vehicleId: string, user: any) {
  const cycleId = randomUUID();
  const [approval] = await tx`
    insert into operations.vehicle_approvals(vehicle_id,delivery_cycle_id,financial_approved,administrative_approved,updated_at)
    values (${vehicleId}::uuid,${cycleId}::uuid,false,false,now()) returning id::text
  `;
  await tx`
    insert into operations.approval_events(vehicle_id,approval_id,approval_type,action,actor_id,actor_name,after_data)
    values (${vehicleId}::uuid,${approval.id}::uuid,'both','initialized',${user.id}::uuid,${user.fullName},${tx.json({ financialApproved:false, administrativeApproved:false, cycleId })})
  `;
}

async function listVehicles(request: VercelRequest, response: VercelResponse, user: any) {
  const sql = getSql();
  const id = clean(request.query.id);
  if (id) {
    const vehicle = await getOperationsVehicleDetail(id, user);
    if (!vehicle) return response.status(404).json({ ok: false, error: "السيارة غير موجودة أو غير متاحة لك" });
    return response.status(200).json({ ok: true, vehicle });
  }

  const search = clean(request.query.search);
  const locationId = clean(request.query.locationId);
  const statusCode = clean(request.query.statusCode);
  const modelYear = clean(request.query.modelYear);
  const agentName = clean(request.query.agentName);
  const includeArchived = bool(request.query.includeArchived);
  const archivedOnly = bool(request.query.archivedOnly);
  const suggest = clean(request.query.mode) === "suggest";
  const page = integer(request.query.page, 1, 1, 100000);
  const limit = suggest ? 20 : integer(request.query.limit, 30, 1, 100);
  const offset = (page - 1) * limit;
  const pattern = `%${search}%`;
  const branches = user.branchCodes;
  const allBranches = canAccessAllOperationsBranches(user);

  const [countRow] = await sql<any[]>`
    select count(*)::int as total from operations.vehicles v
    where v.is_deleted=false
      and (${allBranches} or coalesce(v.branch_code,'')=any(${branches}::text[]))
      and (${archivedOnly} = false or v.is_archived=true)
      and (${includeArchived} = true or ${archivedOnly} = true or v.is_archived=false)
      and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern} or coalesce(v.plate_no,'') ilike ${pattern})
      and (${locationId}='' or v.location_id=${locationId || null}::uuid)
      and (${statusCode}='' or v.status_code=${statusCode})
      and (${modelYear}='' or v.model_year=${modelYear})
      and (${agentName}='' or v.agent_name=${agentName})
  `;

  const vehicles = await sql<any[]>`
    select v.id::text,v.vin,v.car_name,v.statement,v.agent_name,v.interior_color,v.exterior_color,v.model_year,v.plate_no,v.batch_no,
      v.location_id::text,v.branch_code,v.status_code,v.status_note,v.notes,v.reservation_shortage_location_note,v.has_notes,
      v.is_archived,v.archived_at,v.created_at,v.updated_at,v.version,l.code as location_code,l.name as location_name,
      s.name as status_name,
      coalesce(a.financial_approved,false) as financial_approved,coalesce(a.administrative_approved,false) as administrative_approved,
      tr.tracking_request_id::text,tr.request_no as tracking_request_no,tr.status as tracking_status,tr.progress as tracking_progress,
      tr.is_archived as tracking_archived,tr.is_deleted as tracking_deleted,
      (select count(*)::int from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id where rv.vehicle_id=v.id and r.is_deleted=false and r.status not in ('completed','cancelled')) as active_requests
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.vehicle_statuses s on s.code=v.status_code
    left join lateral (
      select x.* from operations.vehicle_approvals x where x.vehicle_id=v.id order by x.created_at desc limit 1
    ) a on true
    left join lateral (
      select t.* from operations.vehicle_tracking_summary t where t.vehicle_id=v.id
      order by case when t.status in ('not_started','in_progress') and not t.is_archived then 0 else 1 end,t.updated_at desc limit 1
    ) tr on true
    where v.is_deleted=false
      and (${allBranches} or coalesce(v.branch_code,'')=any(${branches}::text[]))
      and (${archivedOnly} = false or v.is_archived=true)
      and (${includeArchived} = true or ${archivedOnly} = true or v.is_archived=false)
      and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern} or coalesce(v.plate_no,'') ilike ${pattern})
      and (${locationId}='' or v.location_id=${locationId || null}::uuid)
      and (${statusCode}='' or v.status_code=${statusCode})
      and (${modelYear}='' or v.model_year=${modelYear})
      and (${agentName}='' or v.agent_name=${agentName})
    order by case when ${search}<>'' and v.vin ilike ${search + '%'} then 0 else 1 end,v.updated_at desc
    limit ${limit} offset ${offset}
  `;
  return response.status(200).json({ ok: true, vehicles, total: Number(countRow?.total || 0), page, limit });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    await ensureOperationsSchema();
    const permission = request.method === "GET" ? "operations.vehicles.view" : "operations.view";
    const user = await requireOperationsUser(request, response, permission);
    if (!user) return;
    if (request.method === "GET") return listVehicles(request, response, user);
    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });

    const body = bodyOf(request);
    const action = clean(body.action);
    const sql = getSql();

    if (action === "create") {
      if (!user.isSystemAdmin && !user.permissions.includes("operations.vehicles.create")) throw new OperationsError("ليس لديك صلاحية إضافة سيارة", 403);
      const p = vehiclePayload(body);
      if (!p.vin) throw new OperationsError("رقم الهيكل VIN مطلوب");
      if (!p.statusCode) throw new OperationsError("حالة السيارة مطلوبة");
      const createdId = await sql.begin(async (tx) => {
        const { location, status } = await validateLocationStatus(tx, p.locationId, p.statusCode);
        if (!canAccessBranch(user, location?.branch_code)) throw new OperationsError("لا يمكنك إضافة سيارة في هذا الفرع", 403);
        if (status.requires_status_note && !p.statusNote) throw new OperationsError("ملاحظات الحالة مطلوبة عند اختيار حالة بها ملاحظات");
        const [created] = await tx`
          insert into operations.vehicles(vin,car_name,statement,agent_name,exterior_color,interior_color,model_year,plate_no,batch_no,location_id,branch_code,status_code,source_type,has_notes,notes,status_note,reservation_shortage_location_note,created_by,updated_by)
          values (${p.vin},${p.carName},${p.statement},${p.agentName},${p.exteriorColor},${p.interiorColor},${p.modelYear},${p.plateNo},${p.batchNo},${p.locationId}::uuid,${location?.branch_code || null},${p.statusCode},${p.sourceType},${Boolean(p.notes || p.statusNote || p.reservationNote)},${p.notes},${p.statusNote},${p.reservationNote},${user.id}::uuid,${user.id}::uuid)
          returning id::text
        `;
        if (p.notes) await tx`insert into operations.vehicle_notes(vehicle_id,note_type,note,created_by) values (${created.id}::uuid,'vehicle',${p.notes},${user.id}::uuid)`;
        if (p.statusNote) await tx`insert into operations.vehicle_notes(vehicle_id,note_type,note,created_by) values (${created.id}::uuid,'status',${p.statusNote},${user.id}::uuid)`;
        if (p.reservationNote) await tx`insert into operations.vehicle_notes(vehicle_id,note_type,note,created_by) values (${created.id}::uuid,'reservation_shortage_location',${p.reservationNote},${user.id}::uuid)`;
        if (status.starts_delivery_cycle) await initializeApprovals(tx, created.id, user);
        await writeAudit(tx, request, user, { action: "vehicle_created", entityType: "vehicle", entityId: created.id, after: p });
        await writeOutbox(tx, { eventType: "operations.vehicle.created", aggregateType: "vehicle", aggregateId: created.id, title: "إضافة سيارة", description: p.vin, path: `/operations/inventory?vehicle=${created.id}`, metadata: { vin: p.vin } });
        return created.id;
      });
      return response.status(201).json({ ok: true, vehicle: await getOperationsVehicleDetail(createdId, user), message: "تمت إضافة السيارة" });
    }

    if (action === "update") {
      if (!user.isSystemAdmin && !user.permissions.includes("operations.vehicles.update")) throw new OperationsError("ليس لديك صلاحية تعديل السيارة", 403);
      const id = clean(body.id);
      if (!id) throw new OperationsError("معرف السيارة مطلوب");
      const p = vehiclePayload(body);
      const expectedVersion = integer(body.version, 0, 0, 1000000);
      await sql.begin(async (tx) => {
        const [old] = await tx`select v.*,l.branch_code as location_branch from operations.vehicles v left join operations.locations l on l.id=v.location_id where v.id=${id}::uuid and v.is_deleted=false for update`;
        if (!old) throw new OperationsError("السيارة غير موجودة", 404);
        if (!canAccessBranch(user, old.branch_code)) throw new OperationsError("لا يمكنك تعديل سيارة في فرع آخر", 403);
        if (expectedVersion && Number(old.version) !== expectedVersion) throw new OperationsError("تم تعديل السيارة بواسطة مستخدم آخر. حدّث الصفحة ثم أعد المحاولة", 409);
        const { location, status } = await validateLocationStatus(tx, p.locationId, p.statusCode);
        if (!canAccessBranch(user, location?.branch_code)) throw new OperationsError("المكان الجديد خارج صلاحية فرعك", 403);
        if (status.requires_status_note && !p.statusNote) throw new OperationsError("ملاحظات الحالة مطلوبة عند اختيار حالة بها ملاحظات");
        if (p.vin !== old.vin && !user.isSystemAdmin && !user.permissions.includes("operations.vehicles.change_vin")) throw new OperationsError("ليس لديك صلاحية تغيير رقم الهيكل", 403);
        if (status.is_final_delivery) {
          if (old.status_code !== "under_delivery") throw new OperationsError("يجب أن تمر السيارة أولًا بحالة مباع تحت التسليم");
          const [approval] = await tx`select financial_approved,administrative_approved from operations.vehicle_approvals where vehicle_id=${id}::uuid order by created_at desc limit 1`;
          if (!approval?.financial_approved || !approval?.administrative_approved) throw new OperationsError("لا يمكن تغيير الحالة إلى مباع تم التسليم قبل اكتمال الموافقة المالية والإدارية");
        }
        await tx`
          update operations.vehicles set vin=${p.vin},car_name=${p.carName},statement=${p.statement},agent_name=${p.agentName},exterior_color=${p.exteriorColor},interior_color=${p.interiorColor},model_year=${p.modelYear},plate_no=${p.plateNo},batch_no=${p.batchNo},location_id=${p.locationId}::uuid,branch_code=${location?.branch_code || null},status_code=${p.statusCode},source_type=${p.sourceType},has_notes=${Boolean(p.notes || p.statusNote || p.reservationNote)},notes=${p.notes},status_note=${p.statusNote},reservation_shortage_location_note=${p.reservationNote},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${id}::uuid
        `;
        const changedFlow = old.location_id !== p.locationId || old.status_code !== p.statusCode;
        if (changedFlow) {
          await tx`
            insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,note,status_note,reservation_shortage_location_note,performed_by,performed_by_name,performed_role,performed_branch,before_data,after_data)
            values (${id}::uuid,${old.location_id}::uuid,${p.locationId}::uuid,${old.status_code},${p.statusCode},'تعديل بيانات السيارة',${p.statusNote},${p.reservationNote},${user.id}::uuid,${user.fullName},${primaryRole(user)},${primaryBranch(user)},${tx.json(old)},${tx.json(p)})
          `;
        }
        if (old.status_code !== "under_delivery" && status.starts_delivery_cycle) await initializeApprovals(tx, id, user);
        for (const [type, note, oldNote] of [["vehicle", p.notes, old.notes], ["status", p.statusNote, old.status_note], ["reservation_shortage_location", p.reservationNote, old.reservation_shortage_location_note]] as const) {
          if (note && note !== oldNote) await tx`insert into operations.vehicle_notes(vehicle_id,note_type,note,created_by) values (${id}::uuid,${type},${note},${user.id}::uuid)`;
        }
        await writeAudit(tx, request, user, { action: "vehicle_updated", entityType: "vehicle", entityId: id, before: old, after: p });
        await writeOutbox(tx, { eventType: changedFlow ? "operations.vehicle.moved" : "operations.vehicle.updated", aggregateType: "vehicle", aggregateId: id, title: "تحديث سيارة", description: p.vin, path: `/operations/inventory?vehicle=${id}`, metadata: { vin: p.vin, oldStatus: old.status_code, newStatus: p.statusCode } });
      });
      return response.status(200).json({ ok: true, vehicle: await getOperationsVehicleDetail(id, user), message: "تم حفظ بيانات السيارة" });
    }

    if (action === "save_checks") {
      if (!user.isSystemAdmin && !user.permissions.includes("operations.checks.update")) throw new OperationsError("ليس لديك صلاحية تعديل التشيك", 403);
      const id = clean(body.id);
      const checks = Array.isArray(body.checks) ? body.checks : [];
      await sql.begin(async (tx) => {
        const [vehicle] = await tx`select id::text,branch_code from operations.vehicles where id=${id}::uuid and is_deleted=false for update`;
        if (!vehicle) throw new OperationsError("السيارة غير موجودة", 404);
        if (!canAccessBranch(user, vehicle.branch_code)) throw new OperationsError("السيارة خارج صلاحية فرعك", 403);
        for (const item of checks) {
          const code = clean(item.code); const status = clean(item.status) || "unknown"; const note = clean(item.note) || null;
          if (!code || !["unknown","available","missing","damaged"].includes(status)) continue;
          const [old] = await tx`select status,note from operations.vehicle_checks where vehicle_id=${id}::uuid and item_code=${code}`;
          if (!old || old.status !== status || (old.note || null) !== note) {
            await tx`
              insert into operations.vehicle_checks(vehicle_id,item_code,status,note,updated_by,updated_at)
              values (${id}::uuid,${code},${status},${note},${user.id}::uuid,now())
              on conflict(vehicle_id,item_code) do update set status=excluded.status,note=excluded.note,updated_by=excluded.updated_by,updated_at=now()
            `;
            await tx`insert into operations.vehicle_check_history(vehicle_id,item_code,old_status,new_status,old_note,new_note,changed_by) values (${id}::uuid,${code},${old?.status || null},${status},${old?.note || null},${note},${user.id}::uuid)`;
          }
        }
        await writeAudit(tx, request, user, { action: "vehicle_checks_updated", entityType: "vehicle", entityId: id, after: checks });
      });
      return response.status(200).json({ ok: true, vehicle: await getOperationsVehicleDetail(id, user), message: "تم حفظ التشيك" });
    }

    if (action === "import") {
      if (!user.isSystemAdmin && !user.permissions.includes("operations.vehicles.import")) throw new OperationsError("ليس لديك صلاحية استيراد السيارات", 403);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) throw new OperationsError("لا توجد صفوف للاستيراد");
      if (rows.length > 5000) throw new OperationsError("الحد الأقصى للملف الواحد 5000 صف");
      const report = { read: rows.length, added: 0, updated: 0, failed: 0, errors: [] as Array<{ row: number; vin: string; error: string }> };
      const seen = new Set<string>();
      for (let index = 0; index < rows.length; index += 1) {
        const raw = rows[index] || {}; const p = vehiclePayload(raw); const rowNo = index + 2;
        try {
          if (!p.vin) throw new OperationsError("VIN مطلوب");
          if (seen.has(p.vin)) throw new OperationsError("VIN مكرر داخل الملف");
          seen.add(p.vin);
          await sql.begin(async (tx) => {
            const { location, status } = await validateLocationStatus(tx, p.locationId, p.statusCode || "available_for_sale");
            if (!canAccessBranch(user, location?.branch_code)) throw new OperationsError("المكان خارج صلاحية الفرع");
            if (status.requires_status_note && !p.statusNote) throw new OperationsError("ملاحظات الحالة مطلوبة");
            const [existing] = await tx`select id::text,branch_code from operations.vehicles where vin=${p.vin} and is_deleted=false for update`;
            if (existing) {
              if (!canAccessBranch(user, existing.branch_code)) throw new OperationsError("السيارة موجودة في فرع غير مسموح");
              await tx`
                update operations.vehicles set car_name=coalesce(${p.carName},car_name),statement=coalesce(${p.statement},statement),agent_name=coalesce(${p.agentName},agent_name),exterior_color=coalesce(${p.exteriorColor},exterior_color),interior_color=coalesce(${p.interiorColor},interior_color),model_year=coalesce(${p.modelYear},model_year),plate_no=coalesce(${p.plateNo},plate_no),batch_no=coalesce(${p.batchNo},batch_no),location_id=coalesce(${p.locationId}::uuid,location_id),branch_code=coalesce(${location?.branch_code || null},branch_code),status_code=coalesce(nullif(${p.statusCode},''),status_code),source_type=coalesce(${p.sourceType},source_type),notes=coalesce(${p.notes},notes),status_note=coalesce(${p.statusNote},status_note),reservation_shortage_location_note=coalesce(${p.reservationNote},reservation_shortage_location_note),updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${existing.id}::uuid
              `;
              report.updated += 1;
            } else {
              await tx`
                insert into operations.vehicles(vin,car_name,statement,agent_name,exterior_color,interior_color,model_year,plate_no,batch_no,location_id,branch_code,status_code,source_type,has_notes,notes,status_note,reservation_shortage_location_note,created_by,updated_by)
                values (${p.vin},${p.carName},${p.statement},${p.agentName},${p.exteriorColor},${p.interiorColor},${p.modelYear},${p.plateNo},${p.batchNo},${p.locationId}::uuid,${location?.branch_code || null},${p.statusCode || "available_for_sale"},${p.sourceType},${Boolean(p.notes || p.statusNote || p.reservationNote)},${p.notes},${p.statusNote},${p.reservationNote},${user.id}::uuid,${user.id}::uuid)
              `;
              report.added += 1;
            }
          });
        } catch (error) {
          report.failed += 1; report.errors.push({ row: rowNo, vin: p.vin, error: error instanceof Error ? error.message : "خطأ غير معروف" });
        }
      }
      await writeAudit(sql, request, user, { action: "vehicles_imported", entityType: "vehicle_import", entityId: randomUUID(), after: report });
      return response.status(200).json({ ok: true, report, message: "اكتمل الاستيراد" });
    }

    throw new OperationsError("الإجراء غير مدعوم");
  } catch (error) { return handleOperationsError(response, error); }
}
