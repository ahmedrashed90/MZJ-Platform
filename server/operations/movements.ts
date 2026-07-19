import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { OPERATIONS_PERMISSIONS, requireOperationsPermission, requireOperationsUser } from "../_operations-auth.js";
import { clean, nextOperationsNumber, normalizeContents, nullableText, uniqueCleanStrings } from "../_operations-utils.js";

function parseBody(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { return {}; }
  }
  return {};
}

function scopeAll(user: { roleCodes: string[]; branchCodes: string[] }) {
  if (user.roleCodes.some((code) => ["admin", "sales_manager"].includes(code))) return true;
  return user.roleCodes.includes("operations_user") && user.branchCodes.length === 0;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureOperationsSchema();
  const user = await requireOperationsUser(request, response);
  if (!user) return;
  const sql = getSql();

  try {
    if (request.method === "GET") {
      if (!requireOperationsPermission(user, response, OPERATIONS_PERMISSIONS.movementsView)) return;
      const search = clean(request.query.search);
      const from = clean(request.query.from);
      const to = clean(request.query.to);
      const dateFrom = clean(request.query.dateFrom);
      const dateTo = clean(request.query.dateTo);
      const limit = Math.min(Math.max(Number(request.query.limit || 500), 1), 2000);
      const pattern = `%${search}%`;
      const all = scopeAll(user);

      const movements = await sql<any[]>`
        select
          m.id::text,m.movement_type,m.old_status,m.new_status,m.note,m.performed_by_name,m.created_at,
          v.id::text as vehicle_id,v.vin,v.car_name,v.statement,v.model_year,v.exterior_color,v.interior_color,
          fl.id::text as from_location_id,fl.code as from_location_code,fl.name as from_location_name,
          tl.id::text as to_location_id,tl.code as to_location_code,tl.name as to_location_name,
          mb.id::text as batch_id,mb.batch_no,tr.id::text as request_id,tr.request_no,
          os.name as old_status_name,ns.name as new_status_name
        from operations.movements m
        join operations.vehicles v on v.id=m.vehicle_id
        left join operations.locations fl on fl.id=m.from_location_id
        left join operations.locations tl on tl.id=m.to_location_id
        left join core.branches fb on fb.id=fl.branch_id
        left join core.branches tb on tb.id=tl.branch_id
        left join operations.movement_batches mb on mb.id=m.movement_batch_id
        left join operations.transfer_requests tr on tr.id=m.request_id
        left join operations.vehicle_statuses os on os.code=m.old_status
        left join operations.vehicle_statuses ns on ns.code=m.new_status
        where (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(mb.batch_no,'') ilike ${pattern} or coalesce(tr.request_no,'') ilike ${pattern})
          and (${from}='' or fl.code=${from} or fl.id::text=${from})
          and (${to}='' or tl.code=${to} or tl.id::text=${to})
          and (${dateFrom}='' or m.created_at::date>=${dateFrom}::date)
          and (${dateTo}='' or m.created_at::date<=${dateTo}::date)
          and (${all}::boolean or ((coalesce(fl.location_type,'other')<>'branch' or coalesce(fb.code,'')=any(${user.branchCodes}::text[])) and (coalesce(tl.location_type,'other')<>'branch' or coalesce(tb.code,'')=any(${user.branchCodes}::text[]))))
        order by m.created_at desc
        limit ${limit}
      `;

      const [counts] = await sql<any[]>`
        select
          count(m.id)::int as total,
          count(m.id) filter (where m.created_at::date=current_date)::int as today,
          count(distinct m.movement_batch_id)::int as batches,
          count(m.id) filter (where m.movement_type='request')::int as from_requests
        from operations.movements m
        join operations.vehicles v on v.id=m.vehicle_id
        left join operations.locations fl on fl.id=m.from_location_id
        left join operations.locations tl on tl.id=m.to_location_id
        left join core.branches fb on fb.id=fl.branch_id
        left join core.branches tb on tb.id=tl.branch_id
        where (${all}::boolean or ((coalesce(fl.location_type,'other')<>'branch' or coalesce(fb.code,'')=any(${user.branchCodes}::text[])) and (coalesce(tl.location_type,'other')<>'branch' or coalesce(tb.code,'')=any(${user.branchCodes}::text[]))))
      `;
      return response.status(200).json({ ok: true, movements, counts });
    }

    if (request.method === "POST") {
      if (!requireOperationsPermission(user, response, OPERATIONS_PERMISSIONS.movementsCreate)) return;
      const body = parseBody(request);
      const vehicleIds = uniqueCleanStrings(body.vehicleIds);
      const destinationLocationId = clean(body.destinationLocationId);
      const targetStatusCode = clean(body.targetStatusCode);
      const note = nullableText(body.note);
      const overrides = body.vehicleOverrides && typeof body.vehicleOverrides === "object" ? body.vehicleOverrides as Record<string, any> : {};

      if (!vehicleIds.length) return response.status(400).json({ ok: false, error: "اختر سيارة واحدة على الأقل" });
      if (!destinationLocationId) return response.status(400).json({ ok: false, error: "اختر موقع الحركة الجديد" });
      if (!targetStatusCode) return response.status(400).json({ ok: false, error: "اختر حالة السيارة بعد الحركة" });

      const all = scopeAll(user);
      const [meta] = await sql<any[]>`
        select
          exists(
            select 1 from operations.locations l left join core.branches b on b.id=l.branch_id
            where l.id=${destinationLocationId}::uuid and l.is_active=true
              and (${all}::boolean or l.location_type<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
          ) as location_ok,
          exists(select 1 from operations.vehicle_statuses where code=${targetStatusCode} and is_active=true and code<>'archived') as status_ok
      `;
      if (!meta?.location_ok || !meta?.status_ok) return response.status(400).json({ ok: false, error: "الموقع أو الحالة الجديدة غير صحيحة" });

      const batchNo = nextOperationsNumber("MOV");
      const result = await sql.begin(async (tx) => {
        const vehicles = await tx<any[]>`
          select v.*,v.id::text,l.code as location_code,b.code as branch_code,
            coalesce(ap.financial_approved,false) as financial_approved,
            coalesce(ap.administrative_approved,false) as administrative_approved
          from operations.vehicles v
          left join operations.locations l on l.id=v.location_id
          left join core.branches b on b.id=l.branch_id
          left join lateral(select a.* from operations.vehicle_approvals a where a.vehicle_id=v.id order by a.updated_at desc limit 1) ap on true
          where v.id=any(${vehicleIds}::uuid[]) and v.is_deleted=false and v.is_archived=false
            and (${all}::boolean or coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
          for update of v
        `;
        if (vehicles.length !== vehicleIds.length) throw Object.assign(new Error("VEHICLES_SCOPE"), { code: "VEHICLES_SCOPE" });
        if (targetStatusCode === "delivered") {
          const blocked = vehicles.filter((vehicle) => !vehicle.financial_approved || !vehicle.administrative_approved);
          if (blocked.length) {
            throw Object.assign(new Error(blocked.slice(0, 5).map((item) => item.vin).join("، ")), { code: "APPROVALS_REQUIRED" });
          }
        }

        const [batch] = await tx<any[]>`
          insert into operations.movement_batches(batch_no,movement_type,destination_location_id,target_status_code,note,performed_by,performed_by_name)
          values (${batchNo},'direct',${destinationLocationId}::uuid,${targetStatusCode},${note},${user.id}::uuid,${user.fullName})
          returning id::text,batch_no
        `;

        const moved: Array<{ id: string; vin: string }> = [];
        for (const vehicle of vehicles) {
          const override = overrides[vehicle.id] || overrides[vehicle.vin] || {};
          const contents = override.contents ? { ...(vehicle.contents || {}), ...normalizeContents(override.contents) } : (vehicle.contents || {});
          const interiorColor = nullableText(override.interiorColor) ?? vehicle.interior_color;
          const locationNote = Object.prototype.hasOwnProperty.call(override, "locationNote") ? nullableText(override.locationNote) : vehicle.location_note;
          const shortageNote = Object.prototype.hasOwnProperty.call(override, "shortageNote") ? nullableText(override.shortageNote) : vehicle.shortage_note;
          const before = {
            locationId: vehicle.location_id,
            statusCode: vehicle.status_code,
            interiorColor: vehicle.interior_color,
            contents: vehicle.contents,
            locationNote: vehicle.location_note,
            shortageNote: vehicle.shortage_note,
          };
          const after = {
            locationId: destinationLocationId,
            statusCode: targetStatusCode,
            interiorColor,
            contents,
            locationNote,
            shortageNote,
          };

          await tx`
            update operations.vehicles set location_id=${destinationLocationId}::uuid,status_code=${targetStatusCode},
              interior_color=${interiorColor},contents=${tx.json(contents)},location_note=${locationNote},shortage_note=${shortageNote},
              has_notes=${Boolean(locationNote || shortageNote || vehicle.notes || targetStatusCode === "has_notes")},
              updated_by=${user.id}::uuid,updated_at=now()
            where id=${vehicle.id}::uuid
          `;

          if (shortageNote) {
            const [existingShortage] = await tx<any[]>`
              select id::text from operations.vehicle_shortages
              where vehicle_id=${vehicle.id}::uuid and shortage_type='general' and is_resolved=false
              order by created_at desc limit 1 for update
            `;
            if (existingShortage) {
              await tx`update operations.vehicle_shortages set note=${shortageNote},updated_at=now() where id=${existingShortage.id}::uuid`;
            } else {
              await tx`
                insert into operations.vehicle_shortages(vehicle_id,shortage_type,note,created_by)
                values (${vehicle.id}::uuid,'general',${shortageNote},${user.id}::uuid)
              `;
            }
          } else {
            await tx`
              update operations.vehicle_shortages set is_resolved=true,resolved_by=${user.id}::uuid,resolved_at=now(),updated_at=now()
              where vehicle_id=${vehicle.id}::uuid and shortage_type='general' and is_resolved=false
            `;
          }

          if (targetStatusCode === "under_delivery") {
            await tx`
              insert into operations.vehicle_approvals(vehicle_id)
              select ${vehicle.id}::uuid where not exists(select 1 from operations.vehicle_approvals where vehicle_id=${vehicle.id}::uuid)
            `;
          } else if (vehicle.status_code === "under_delivery" && targetStatusCode !== "delivered") {
            await tx`
              update operations.vehicle_approvals set financial_approved=false,administrative_approved=false,
                financial_approved_by=null,administrative_approved_by=null,financial_approved_at=null,administrative_approved_at=null,updated_at=now()
              where vehicle_id=${vehicle.id}::uuid
            `;
          }

          await tx`
            insert into operations.movements(
              movement_batch_id,vehicle_id,movement_type,from_location_id,to_location_id,old_status,new_status,note,
              before_data,after_data,performed_by,performed_by_name
            ) values (
              ${batch.id}::uuid,${vehicle.id}::uuid,'direct',${vehicle.location_id}::uuid,${destinationLocationId}::uuid,
              ${vehicle.status_code},${targetStatusCode},${note},${tx.json(before)},${tx.json(after)},${user.id}::uuid,${user.fullName}
            )
          `;
          moved.push({ id: vehicle.id, vin: vehicle.vin });
        }

        await tx`
          insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
          values (${user.id}::uuid,'operations','movement_batch_created','movement_batch',${batch.id},
            ${tx.json({ batchNo, vehicleIds, destinationLocationId, targetStatusCode, note })})
        `;
        return { batch, moved };
      });

      return response.status(201).json({ ok: true, ...result, message: `تم تنفيذ الحركة على ${result.moved.length} سيارة` });
    }

    return response.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error: any) {
    console.error("Operations movements failed", error);
    if (error?.code === "VEHICLES_SCOPE") return response.status(400).json({ ok: false, error: "بعض السيارات غير موجودة أو خارج نطاق صلاحيتك" });
    if (error?.code === "APPROVALS_REQUIRED") return response.status(400).json({ ok: false, error: `لا يمكن تسجيل مباع تم التسليم قبل اكتمال الاعتماد المالي والإداري: ${error.message}` });
    if (error?.code === "22P02") return response.status(400).json({ ok: false, error: "إحدى القيم المحددة غير صالحة" });
    if (error?.code === "23505") return response.status(409).json({ ok: false, error: "تعذر إنشاء رقم حركة فريد؛ أعد المحاولة" });
    return response.status(500).json({ ok: false, error: "تعذر تنفيذ حركة السيارات" });
  }
}
