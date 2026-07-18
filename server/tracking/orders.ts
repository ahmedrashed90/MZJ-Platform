import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { requireTrackingUser } from "../_tracking-auth.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { clean, ensureVehicleStageRows, recalculateTrackingOrder } from "../_tracking-utils.js";

async function getOrderDetail(id: string) {
  const sql = getSql();
  const [order] = await sql<any[]>`
    select o.*,o.id::text,
      coalesce((select count(*) from tracking.order_vehicles v where v.order_id=o.id),0)::int as vehicles_count,
      coalesce((select count(*) from tracking.vehicle_stages vs join tracking.order_vehicles v on v.id=vs.vehicle_id join tracking.stages s on s.id=vs.stage_id and s.is_active=true where v.order_id=o.id and vs.status='completed'),0)::int as completed_stages,
      coalesce((select count(*) from tracking.vehicle_stages vs join tracking.order_vehicles v on v.id=vs.vehicle_id join tracking.stages s on s.id=vs.stage_id and s.is_active=true where v.order_id=o.id),0)::int as total_stages
    from tracking.orders o
    where o.id=${id}::uuid and coalesce(o.is_deleted,false)=false
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
  const user = await requireTrackingUser(request, response);
  if (!user) return;
  const sql = getSql();

  if (request.method === "GET") {
    const id = clean(request.query.id);
    if (id) {
      const detail = await getOrderDetail(id);
      if (!detail) return response.status(404).json({ ok: false, error: "طلب التتبع غير موجود" });
      return response.status(200).json({ ok: true, order: detail });
    }

    const search = clean(request.query.search);
    const status = clean(request.query.status);
    const limit = Math.min(Math.max(Number(request.query.limit || 100), 1), 300);
    const pattern = `%${search}%`;
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
        count(*)::int as total,
        count(*) filter (where status='not_started')::int as not_started,
        count(*) filter (where status='in_progress')::int as in_progress,
        count(*) filter (where status='completed')::int as completed
      from tracking.orders where coalesce(is_deleted,false)=false
    `;
    return response.status(200).json({ ok: true, orders, counts });
  }

  if (request.method === "POST") {
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const action = clean(body.action);
    const vehicleId = clean(body.vehicleId);
    const stageId = clean(body.stageId);
    if (!["complete_stage", "revert_stage"].includes(action)) {
      return response.status(400).json({ ok: false, error: "الإجراء غير مدعوم" });
    }
    if (!vehicleId || !stageId) return response.status(400).json({ ok: false, error: "السيارة والمرحلة مطلوبتان" });

    const [row] = await sql<any[]>`
      select vs.id::text,vs.status,v.order_id::text,s.name,s.sort_order
      from tracking.vehicle_stages vs
      join tracking.order_vehicles v on v.id=vs.vehicle_id
      join tracking.stages s on s.id=vs.stage_id
      where vs.vehicle_id=${vehicleId}::uuid and vs.stage_id=${stageId}::uuid
    `;
    if (!row) return response.status(404).json({ ok: false, error: "مرحلة السيارة غير موجودة" });

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
    const detail = await getOrderDetail(row.order_id);
    return response.status(200).json({ ok: true, order: detail, message: action === "complete_stage" ? "تم إنهاء المرحلة" : "تم التراجع عن المرحلة" });
  }

  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
