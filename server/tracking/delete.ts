import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../_auth.js";
import { getSql } from "../_db.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { clean } from "../_tracking-utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureTrackingSchema();
  const user = await requireAdmin(request, response);
  if (!user) return;
  const sql = getSql();

  if (request.method === "GET") {
    const deleted = await sql<any[]>`
      select d.id::text,d.sales_order_no,d.customer_name,d.customer_mobile,d.reason,d.deleted_by_name,d.deleted_at,
        coalesce(b.is_blocked,false) as is_blocked,b.released_at
      from tracking.deleted_orders d
      left join tracking.deleted_order_blocks b on b.sales_order_no=d.sales_order_no
      order by d.deleted_at desc
      limit 150
    `;
    return response.status(200).json({ ok: true, deleted });
  }

  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const action = clean(body.action);

  if (action === "allow_resync") {
    const orderNo = clean(body.orderNo);
    if (!orderNo) return response.status(400).json({ ok: false, error: "رقم الطلب مطلوب" });
    await sql`
      update tracking.deleted_order_blocks set is_blocked=false,released_by=${user.id}::uuid,released_at=now()
      where sales_order_no=${orderNo}
    `;
    await sql`
      insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
      values (${user.id}::uuid,'tracking','allow_order_resync','tracking_order',${orderNo},${sql.json({ orderNo })})
    `;
    return response.status(200).json({ ok: true, message: "تم السماح بإعادة استقبال الطلب. اجعل PlatformSynced فارغًا في صفوف الطلب بالشيت لإرساله مرة أخرى." });
  }

  if (action !== "delete") return response.status(400).json({ ok: false, error: "الإجراء غير مدعوم" });
  const orderId = clean(body.orderId);
  const confirmation = clean(body.confirmation);
  const reason = clean(body.reason);
  if (!orderId || !reason) return response.status(400).json({ ok: false, error: "اختر الطلب واكتب سبب الحذف" });

  const [order] = await sql<any[]>`select *,id::text from tracking.orders where id=${orderId}::uuid and coalesce(is_deleted,false)=false`;
  if (!order) return response.status(404).json({ ok: false, error: "الطلب غير موجود أو تم حذفه" });
  if (confirmation !== order.sales_order_no) return response.status(400).json({ ok: false, error: "اكتب رقم الطلب كاملًا لتأكيد الحذف" });

  await sql.begin(async (tx) => {
    const vehicles = await tx<any[]>`select *,id::text from tracking.order_vehicles where order_id=${orderId}::uuid`;
    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    const stages = vehicleIds.length
      ? await tx<any[]>`
          select vs.*,vs.id::text,s.code,s.name,s.sort_order
          from tracking.vehicle_stages vs join tracking.stages s on s.id=vs.stage_id
          where vs.vehicle_id in ${tx(vehicleIds)}
        `
      : [];
    const events = await tx<any[]>`select * from tracking.stage_events where order_id=${orderId}::uuid order by created_at`;
    const sms = await tx<any[]>`select * from tracking.sms_messages where order_id=${orderId}::uuid order by queued_at`;
    const snapshot = { order, vehicles, stages, events, sms };

    await tx`
      insert into tracking.deleted_orders(sales_order_no,customer_name,customer_mobile,reason,snapshot,deleted_by,deleted_by_name)
      values (${order.sales_order_no},${order.customer_name},${order.customer_mobile},${reason},${tx.json(snapshot)},${user.id}::uuid,${user.fullName})
    `;
    await tx`
      insert into tracking.deleted_order_blocks(sales_order_no,is_blocked,reason,deleted_by,deleted_at,released_by,released_at)
      values (${order.sales_order_no},true,${reason},${user.id}::uuid,now(),null,null)
      on conflict (sales_order_no) do update set is_blocked=true,reason=excluded.reason,deleted_by=excluded.deleted_by,deleted_at=now(),released_by=null,released_at=null
    `;
    await tx`delete from tracking.orders where id=${orderId}::uuid`;
    await tx`
      insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data)
      values (${user.id}::uuid,'tracking','order_deleted','tracking_order',${order.sales_order_no},${tx.json(snapshot)},${tx.json({ reason, blockedFromResync: true })})
    `;
  });

  return response.status(200).json({ ok: true, message: "تم حذف طلب التتبع وكل بياناته وحظره من المزامنة التلقائية" });
}
