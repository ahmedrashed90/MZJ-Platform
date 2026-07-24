import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { requireTrackingUser } from "../_tracking-auth.js";
import { getSystemAccess, hasPermission } from "../_access-control.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { tryArchiveVehicleForTrackingRecord } from "../_operations-auto-archive.js";
import { clean, ensureVehicleStageRows, recalculateTrackingOrder } from "../_tracking-utils.js";

async function getOrderDetail(id: string, user: NonNullable<Awaited<ReturnType<typeof requireTrackingUser>>>) {
  const access = getSystemAccess(user, "tracking");
  const unrestricted = access.dataScope === "all";
  const branches = access.branchCodes.length ? access.branchCodes : ["__none__"];
  const sql = getSql();
  const [order] = await sql<any[]>`
    select o.*,o.id::text,
      coalesce((select count(*) from tracking.order_vehicles v where v.order_id=o.id),0)::int as vehicles_count,
      coalesce((select count(*) from tracking.vehicle_stages vs join tracking.order_vehicles v on v.id=vs.vehicle_id join tracking.stages s on s.id=vs.stage_id and s.is_active=true where v.order_id=o.id and vs.status='completed'),0)::int as completed_stages,
      coalesce((select count(*) from tracking.vehicle_stages vs join tracking.order_vehicles v on v.id=vs.vehicle_id join tracking.stages s on s.id=vs.stage_id and s.is_active=true where v.order_id=o.id),0)::int as total_stages
    from tracking.orders o
    where o.id=${id}::uuid and coalesce(o.is_deleted,false)=false
      and (${unrestricted}=true or o.branch in ${sql(branches)} or exists(select 1 from tracking.stage_events se where se.order_id=o.id and se.actor_id=${user.id}::uuid))
  `;
  if (!order) return null;

  const vehicles = await sql<any[]>`
    select v.*,v.id::text
    from tracking.order_vehicles v
    where v.order_id=${id}::uuid
    order by coalesce(nullif(regexp_replace(v.item_no,'\\D','','g'),''),'999999')::int, v.created_at
  `;

  for (const vehicle of vehicles) {
    await ensureVehicleStageRows(vehicle.id);
    vehicle.stages = await sql<any[]>`
      select
        s.id::text as stage_id,s.code,s.name,s.description,s.owner_type,s.sort_order,s.sms_enabled,s.is_active,
        vs.id::text as vehicle_stage_id,vs.status,vs.completed_at,vs.reverted_at,
        cu.full_name as completed_by_name,ru.full_name as reverted_by_name
      from tracking.stages s
      left join tracking.vehicle_stages vs on vs.stage_id=s.id and vs.vehicle_id=${vehicle.id}::uuid
      left join core.users cu on cu.id=vs.completed_by
      left join core.users ru on ru.id=vs.reverted_by
      where s.is_active=true
      order by s.sort_order
    `;
  }

  const events = await sql<any[]>`
    select e.id::text,e.action,e.actor_name,e.note,e.created_at,s.name as stage_name,s.sort_order,v.vin,v.item_no
    from tracking.stage_events e
    join tracking.stages s on s.id=e.stage_id
    join tracking.order_vehicles v on v.id=e.vehicle_id
    where e.order_id=${id}::uuid
    order by e.created_at desc
    limit 100
  `;

  const smsMessages = await sql<any[]>`
    select m.id::text,m.phone,m.message,m.status,m.firestore_document_id,m.queued_by_name,m.queued_at,m.sent_at,
      s.name as stage_name,s.sort_order,v.vin
    from tracking.sms_messages m
    left join tracking.stages s on s.id=m.stage_id
    left join tracking.order_vehicles v on v.id=m.vehicle_id
    where m.order_id=${id}::uuid
    order by m.queued_at desc
    limit 50
  `;

  return { ...order, vehicles, events, smsMessages };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureTrackingSchema();
  await ensureOperationsSchema();
  const user = await requireTrackingUser(request, response);
  if (!user) return;
  const sql = getSql();

  if (request.method === "GET") {
    const id = clean(request.query.id);
    if (id) {
      const detail = await getOrderDetail(id, user);
      if (!detail) return response.status(404).json({ ok: false, error: "طلب التتبع غير موجود" });
      return response.status(200).json({ ok: true, order: detail });
    }

    const search = clean(request.query.search);
    const status = clean(request.query.status);
    const archivedOnly = ["1", "true", "yes"].includes(clean(request.query.archived).toLowerCase());
    const limit = Math.min(Math.max(Number(request.query.limit || 1000), 1), 2000);
    const pattern = `%${search}%`;
    const access = getSystemAccess(user, "tracking");
    const unrestricted = access.dataScope === "all";
    const branches = access.branchCodes.length ? access.branchCodes : ["__none__"];
    const orders = await sql<any[]>`
      select
        o.id::text,o.sales_order_no,o.customer_name,o.customer_mobile,o.branch,o.order_date,o.delivery_date,o.sales_person,
        o.status,o.tracking_token,o.is_archived,o.subtotal_before_tax,o.tax_value,o.total_incl_vat,o.registration_fee,o.created_at,o.updated_at,
        count(distinct v.id)::int as vehicles_count,
        count(vs.id)::int as total_stages,
        count(vs.id) filter (where vs.status='completed')::int as completed_stages,
        string_agg(distinct nullif(v.vin,''), ', ') as vins
      from tracking.orders o
      left join tracking.order_vehicles v on v.order_id=o.id
      left join tracking.vehicle_stages vs on vs.vehicle_id=v.id
      left join tracking.stages sx on sx.id=vs.stage_id and sx.is_active=true
      where coalesce(o.is_deleted,false)=false
        and (${unrestricted}=true or o.branch in ${sql(branches)} or exists(select 1 from tracking.stage_events se where se.order_id=o.id and se.actor_id=${user.id}::uuid))
        and coalesce(o.is_archived,false)=${archivedOnly}
        and (vs.id is null or sx.id is not null)
        and (${status}='' or o.status=${status})
        and (
          ${search}='' or o.sales_order_no ilike ${pattern} or coalesce(o.customer_name,'') ilike ${pattern}
          or coalesce(o.customer_mobile,'') ilike ${pattern} or exists (
            select 1 from tracking.order_vehicles vx where vx.order_id=o.id and vx.vin ilike ${pattern}
          )
        )
      group by o.id
      order by o.updated_at desc
      limit ${limit}
    `;
    const [counts] = await sql<any[]>`
      select
        count(*) filter (where coalesce(is_archived,false)=false)::int as total,
        count(*) filter (where coalesce(is_archived,false)=false and status='not_started')::int as not_started,
        count(*) filter (where coalesce(is_archived,false)=false and status='in_progress')::int as in_progress,
        count(*) filter (where coalesce(is_archived,false)=false and status='completed')::int as completed,
        count(*) filter (where coalesce(is_archived,false)=true)::int as archived
      from tracking.orders o where coalesce(is_deleted,false)=false
        and (${unrestricted}=true or o.branch in ${sql(branches)} or exists(select 1 from tracking.stage_events se where se.order_id=o.id and se.actor_id=${user.id}::uuid))
    `;
    return response.status(200).json({ ok: true, orders, counts });
  }

  if (request.method === "POST") {
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const action = clean(body.action);

    if (action === "archive_order") {
      const orderId = clean(body.orderId);
      if (!orderId) return response.status(400).json({ ok: false, error: "رقم الطلب الداخلي مطلوب" });

      const [archiveState] = await sql<any[]>`
        select o.id::text,o.is_archived,
          count(vs.id) filter (where s.is_active=true)::int as total_stages,
          count(vs.id) filter (where s.is_active=true and vs.status='completed')::int as completed_stages
        from tracking.orders o
        left join tracking.order_vehicles v on v.order_id=o.id
        left join tracking.vehicle_stages vs on vs.vehicle_id=v.id
        left join tracking.stages s on s.id=vs.stage_id
        where o.id=${orderId}::uuid and coalesce(o.is_deleted,false)=false
        group by o.id
      `;
      if (!archiveState) return response.status(404).json({ ok: false, error: "طلب التتبع غير موجود" });
      if (archiveState.is_archived) {
        const detail = await getOrderDetail(orderId, user);
        return response.status(200).json({ ok: true, order: detail, message: "الطلب موجود في الأرشيف بالفعل" });
      }
      const totalStages = Number(archiveState.total_stages || 0);
      const completedStages = Number(archiveState.completed_stages || 0);
      if (totalStages <= 0 || completedStages < totalStages) {
        return response.status(400).json({ ok: false, error: "زر الأرشفة يتاح بعد اكتمال المراحل العشر لجميع سيارات الطلب" });
      }
      await sql`
        update tracking.orders
        set is_archived=true,archived_at=now(),archived_by=${user.id}::uuid,archived_by_name=${user.fullName},
            archive_reason='اكتملت جميع مراحل التتبع',updated_at=now()
        where id=${orderId}::uuid
      `;
      const detail = await getOrderDetail(orderId, user);
      return response.status(200).json({ ok: true, order: detail, message: "تم نقل الطلب إلى الأرشيف" });
    }

    const vehicleId = clean(body.vehicleId);
    const stageId = clean(body.stageId);
    if (!["complete_stage", "revert_stage"].includes(action)) {
      return response.status(400).json({ ok: false, error: "الإجراء غير مدعوم" });
    }
    if (!vehicleId || !stageId) return response.status(400).json({ ok: false, error: "السيارة والمرحلة مطلوبتان" });

    const [row] = await sql<any[]>`
      select vs.id::text,vs.status,v.order_id::text,s.name,s.sort_order,o.is_archived,o.branch
      from tracking.vehicle_stages vs
      join tracking.order_vehicles v on v.id=vs.vehicle_id
      join tracking.orders o on o.id=v.order_id
      join tracking.stages s on s.id=vs.stage_id
      where vs.vehicle_id=${vehicleId}::uuid and vs.stage_id=${stageId}::uuid
    `;
    if (!row) return response.status(404).json({ ok: false, error: "مرحلة السيارة غير موجودة" });
    const access = getSystemAccess(user, "tracking");
    const canAccessOrder = access.dataScope === "all" || access.branchCodes.includes(clean(row.branch)) || Boolean((await sql<any[]>`select 1 from tracking.stage_events where order_id=${row.order_id}::uuid and actor_id=${user.id}::uuid limit 1`)[0]);
    if (!canAccessOrder) return response.status(403).json({ ok: false, error: "الطلب خارج نطاق بياناتك" });
    const stageNo = String(Number(row.sort_order || 0)).padStart(2, "0");
    const permissionCode = action === "complete_stage" ? `tracking.stage.${stageNo}.complete` : `tracking.stage.${stageNo}.rollback`;
    if (!hasPermission(user, permissionCode)) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لتنفيذ هذه المرحلة", permission: permissionCode });
    if (action === "revert_stage" && !clean(body.note)) return response.status(400).json({ ok: false, error: "سبب التراجع مطلوب" });
    if (action === "complete_stage") {
      const [previousPending] = await sql<any[]>`
        select 1 from tracking.vehicle_stages pvs join tracking.stages ps on ps.id=pvs.stage_id and ps.is_active=true
        where pvs.vehicle_id=${vehicleId}::uuid and ps.sort_order<${Number(row.sort_order)} and pvs.status<>'completed' limit 1
      `;
      if (previousPending) return response.status(400).json({ ok: false, error: "لا يمكن تنفيذ المرحلة قبل استكمال المراحل السابقة" });
    }
    if (row.is_archived) return response.status(400).json({ ok: false, error: "الطلب مؤرشف ولا يمكن تعديل مراحله" });

    if (action === "complete_stage") {
      if (row.status !== "completed") {
        await sql.begin(async (tx) => {
          await tx`
            update tracking.vehicle_stages set status='completed',completed_by=${user.id}::uuid,completed_at=now(),reverted_by=null,reverted_at=null,updated_at=now()
            where vehicle_id=${vehicleId}::uuid and stage_id=${stageId}::uuid
          `;
          await tx`
            insert into tracking.stage_events(order_id,vehicle_id,stage_id,action,actor_id,actor_name,note)
            values (${row.order_id}::uuid,${vehicleId}::uuid,${stageId}::uuid,'completed',${user.id}::uuid,${user.fullName},${clean(body.note)||null})
          `;
          await tryArchiveVehicleForTrackingRecord(tx, vehicleId, { id: user.id, name: user.fullName });
        });
      }
    } else if (row.status === "completed") {
      await sql.begin(async (tx) => {
        await tx`
          update tracking.vehicle_stages set status='pending',reverted_by=${user.id}::uuid,reverted_at=now(),completed_by=null,completed_at=null,updated_at=now()
          where vehicle_id=${vehicleId}::uuid and stage_id=${stageId}::uuid
        `;
        await tx`
          insert into tracking.stage_events(order_id,vehicle_id,stage_id,action,actor_id,actor_name,note)
          values (${row.order_id}::uuid,${vehicleId}::uuid,${stageId}::uuid,'reverted',${user.id}::uuid,${user.fullName},${clean(body.note)||null})
        `;
      });
    }

    await recalculateTrackingOrder(row.order_id);
    const detail = await getOrderDetail(row.order_id, user);
    return response.status(200).json({ ok: true, order: detail, message: action === "complete_stage" ? "تم إنهاء المرحلة" : "تم التراجع عن المرحلة" });
  }

  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
