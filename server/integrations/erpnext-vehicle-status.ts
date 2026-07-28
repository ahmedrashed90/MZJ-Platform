import type { VercelRequest, VercelResponse } from "@vercel/node";
import { safeSecretEquals } from "../_auth.js";
import { getSql } from "../_db.js";
import { clean } from "../_tracking-utils.js";

const RESERVED_STATUS_CODE = "reserved";
const RESERVED_STATUS_VALUES = new Set([
  "reserved",
  "حجز",
  "محجوز",
  "محجوزة",
]);

function requestBody(request: VercelRequest) {
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return request.body || {};
}

function requestKey(request: VercelRequest) {
  return clean(
    request.headers["x-mzj-erpnext-key"]
      || request.headers["x-mzj-tracking-key"]
      || request.query.key,
  );
}

function normalizedStatus(value: unknown) {
  return clean(value).toLocaleLowerCase("ar-SA").replace(/\s+/g, " ");
}

function payloadFields(body: any) {
  const doc = body?.doc && typeof body.doc === "object" ? body.doc : body || {};
  return {
    serialNo: clean(doc.serial_no || doc.serialNo || doc.vin || doc.name || body.serial_no || body.serialNo || body.vin),
    vehicleStatus: clean(doc.vehicle_status || doc.vehicleStatus || doc.car_status || body.vehicle_status || body.vehicleStatus || body.car_status),
    modifiedAt: clean(doc.modified || body.modified),
    modifiedBy: clean(doc.modified_by || doc.modifiedBy || body.modified_by || body.modifiedBy) || "NEXT ERP",
    event: clean(body.event) || "serial_no.status_updated",
  };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });

  const configuredKey = clean(process.env.ERPNEXT_WEBHOOK_KEY || process.env.TRACKING_INGEST_KEY);
  if (!configuredKey) {
    return response.status(503).json({ ok: false, error: "يجب ضبط ERPNEXT_WEBHOOK_KEY في Vercel قبل تفعيل الربط" });
  }
  if (!safeSecretEquals(requestKey(request), configuredKey)) {
    return response.status(401).json({ ok: false, error: "مفتاح ERPNext Webhook غير صحيح" });
  }

  let body: unknown;
  try {
    body = requestBody(request);
  } catch {
    return response.status(400).json({ ok: false, error: "صيغة JSON القادمة من ERPNext غير صحيحة" });
  }

  const payload = payloadFields(body);
  if (!payload.serialNo) {
    return response.status(400).json({ ok: false, error: "رقم الهيكل Serial No مطلوب" });
  }
  if (!payload.vehicleStatus) {
    return response.status(400).json({ ok: false, error: "حالة السيارة car_status مطلوبة" });
  }

  const incomingStatus = normalizedStatus(payload.vehicleStatus);
  if (!RESERVED_STATUS_VALUES.has(incomingStatus)) {
    return response.status(200).json({
      ok: true,
      ignored: true,
      serialNo: payload.serialNo,
      vehicleStatus: payload.vehicleStatus,
      message: "تم تجاهل الحدث لأن المزامنة الحالية مخصصة لحالة محجوزة فقط",
    });
  }

  try {
    const sql = getSql();
    const result = await sql.begin(async (tx) => {
      const [vehicle] = await tx<any[]>`
        select v.*,v.id::text,l.code as location_code,l.name as location_name,l.branch_code,
          coalesce(s.name,v.status_code) as status_name
        from operations.vehicles v
        left join operations.locations l on l.id=v.location_id
        left join operations.vehicle_statuses s on s.code=v.status_code
        where trim(v.vin)=trim(${payload.serialNo})
          and v.is_deleted=false
          and v.archived_at is null
        order by v.updated_at desc
        limit 1
        for update of v
      `;
      if (!vehicle) {
        return { found: false as const };
      }

      const [targetStatus] = await tx<any[]>`
        select code,name from operations.vehicle_statuses
        where code=${RESERVED_STATUS_CODE} and is_active=true
        limit 1
      `;
      if (!targetStatus) {
        const error = new Error("حالة الحجز غير مفعلة في إعدادات العمليات");
        (error as Error & { status?: number }).status = 409;
        throw error;
      }

      if (vehicle.status_code === RESERVED_STATUS_CODE) {
        return {
          found: true as const,
          changed: false,
          vehicleId: vehicle.id,
          previousStatus: vehicle.status_code,
          previousStatusName: vehicle.status_name,
          currentStatus: targetStatus.code,
          currentStatusName: targetStatus.name,
          movementId: null,
          batchId: null,
        };
      }

      const before = { ...vehicle };
      const [batch] = await tx<any[]>`
        insert into operations.movement_batches(
          destination_location_id,new_status,general_note,requested_count,
          performed_by,performed_by_name,performed_by_role,performed_by_branch
        ) values (
          ${vehicle.location_id},${RESERVED_STATUS_CODE},
          ${`مزامنة حالة السيارة من NEXT ERP: ${payload.vehicleStatus}`},1,
          null,${payload.modifiedBy},'erpnext_webhook',${vehicle.branch_code || null}
        ) returning id::text,batch_no
      `;

      const [movement] = await tx<any[]>`
        insert into operations.movements(
          vehicle_id,from_location_id,to_location_id,old_status,new_status,note,
          performed_by,performed_by_name,performed_by_role,performed_by_branch,
          batch_id,movement_type,before_data
        ) values (
          ${vehicle.id}::uuid,${vehicle.location_id},${vehicle.location_id},
          ${vehicle.status_code},${RESERVED_STATUS_CODE},
          ${`تم تغيير حالة السيارة إلى محجوزة من NEXT ERP${payload.modifiedAt ? ` بتاريخ ${payload.modifiedAt}` : ""}`},
          null,${payload.modifiedBy},'erpnext_webhook',${vehicle.branch_code || null},
          ${batch.id}::uuid,'erpnext_vehicle_status',${tx.json(before)}
        ) returning id::text
      `;

      const [updated] = await tx<any[]>`
        update operations.vehicles set
          status_code=${RESERVED_STATUS_CODE},
          has_notes=false,
          updated_by=null,
          updated_by_name=${payload.modifiedBy},
          updated_at=now(),
          version=version+1
        where id=${vehicle.id}::uuid
        returning *,id::text
      `;

      await tx`
        update operations.movements
        set after_data=${tx.json(updated)}
        where id=${movement.id}::uuid
      `;
      await tx`
        insert into audit.activity_log(
          user_id,system_code,action,entity_type,entity_id,before_data,after_data
        ) values (
          null,'operations','erpnext_vehicle_status_synced','vehicle',${vehicle.id},
          ${tx.json(before)},${tx.json({ ...updated, erpEvent: payload.event, erpModifiedBy: payload.modifiedBy, erpModifiedAt: payload.modifiedAt || null })}
        )
      `;

      return {
        found: true as const,
        changed: true,
        vehicleId: vehicle.id,
        movementId: movement.id,
        batchId: batch.id,
        previousStatus: vehicle.status_code,
        previousStatusName: vehicle.status_name,
        currentStatus: targetStatus.code,
        currentStatusName: targetStatus.name,
      };
    });

    if (!result.found) {
      return response.status(404).json({
        ok: false,
        code: "VEHICLE_NOT_FOUND",
        serialNo: payload.serialNo,
        error: "لم يتم العثور على سيارة فعالة في المنصة بنفس رقم الهيكل",
      });
    }

    return response.status(200).json({
      ok: true,
      serialNo: payload.serialNo,
      vehicleStatus: payload.vehicleStatus,
      changed: result.changed,
      vehicleId: result.vehicleId,
      movementId: result.movementId,
      batchId: result.batchId,
      previousStatus: result.previousStatus,
      previousStatusName: result.previousStatusName,
      currentStatus: result.currentStatus,
      currentStatusName: result.currentStatusName,
      message: result.changed
        ? "تم تحديث حالة السيارة إلى محجوزة في المنصة"
        : "حالة السيارة في المنصة محجوزة بالفعل",
    });
  } catch (error) {
    console.error("ERPNext vehicle status webhook failed", {
      serialNo: payload.serialNo,
      vehicleStatus: payload.vehicleStatus,
      error,
    });
    const status = Number((error as { status?: unknown })?.status) || 500;
    return response.status(status).json({
      ok: false,
      error: status === 409
        ? clean((error as Error)?.message)
        : "تعذر تحديث حالة السيارة في المنصة",
    });
  }
}
