import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "../_auth.js";
import { getSql } from "../_db.js";
import { hasPermission, isSystemAdmin, primaryRole } from "../_operations-auth.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { OperationError, requestId, sendOperationError } from "../_operations-utils.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { clean } from "../_tracking-utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const traceId = requestId("tracking-delete");
  response.setHeader("Cache-Control", "no-store");
  try {
    await ensureTrackingSchema();
    await ensureOperationsSchema();
    const user = await requireUser(request, response);
    if (!user) return;
    if (!isSystemAdmin(user) && !hasPermission(user, "tracking.orders.delete")) {
      return response.status(403).json({ ok: false, code: "FORBIDDEN", error: "لا توجد لديك صلاحية حذف طلبات التراكينج", requestId: traceId });
    }
    const sql = getSql();

    if (request.method === "GET") {
      const deleted = await sql<any[]>`
        select d.id::text,d.order_internal_id::text,d.sales_order_no,d.customer_name,d.customer_mobile,d.reason,d.deleted_by_name,d.deleted_at,
          d.source_identity,d.source_fingerprint,d.request_id
        from tracking.deleted_orders d order by d.deleted_at desc limit 250
      `;
      return response.status(200).json({ ok: true, deleted, requestId: traceId });
    }

    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed", requestId: traceId });
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const action = clean(body.action);
    if (action !== "delete") throw new OperationError(400, "VALIDATION_ERROR", "الإجراء غير مدعوم");

    const orderId = clean(body.orderId);
    const confirmation = clean(body.confirmation);
    const reason = clean(body.reason);
    if (!orderId || !reason) throw new OperationError(400, "VALIDATION_ERROR", "اختر الطلب واكتب سبب الحذف");

    const result = await sql.begin(async (tx) => {
      const [order] = await tx<any[]>`
        select *,id::text from tracking.orders
        where id=${orderId}::uuid and coalesce(is_deleted,false)=false
        for update
      `;
      if (!order) throw new OperationError(404, "TRACKING_REQUEST_NOT_FOUND", "الطلب غير موجود أو تم حذفه مسبقًا");
      if (confirmation !== order.sales_order_no) throw new OperationError(400, "VALIDATION_ERROR", "اكتب رقم الطلب كاملًا لتأكيد الحذف");

      const vehicles = await tx<any[]>`select *,id::text,vehicle_id::text from tracking.order_vehicles where order_id=${orderId}::uuid order by created_at`;
      const stages = await tx<any[]>`
        select vs.*,vs.id::text,vs.vehicle_id::text,s.code,s.name,s.sort_order
        from tracking.vehicle_stages vs join tracking.order_vehicles v on v.id=vs.vehicle_id join tracking.stages s on s.id=vs.stage_id
        where v.order_id=${orderId}::uuid order by v.created_at,s.sort_order
      `;
      const events = await tx<any[]>`select * from tracking.stage_events where order_id=${orderId}::uuid order by created_at`;
      const sms = await tx<any[]>`select * from tracking.sms_messages where order_id=${orderId}::uuid order by queued_at`;
      const snapshot = { order, vehicles, stages, events, sms };

      await tx`
        insert into tracking.deleted_orders(
          order_internal_id,sales_order_no,customer_name,customer_mobile,reason,snapshot,deleted_by,deleted_by_name,deleted_by_email,deleted_by_role,
          source_identity,source_fingerprint,request_id
        ) values (
          ${orderId}::uuid,${order.sales_order_no},${order.customer_name},${order.customer_mobile},${reason},${tx.json(snapshot)},${user.id}::uuid,
          ${user.fullName},${user.email},${primaryRole(user)},${order.source_identity||null},${order.source_fingerprint||null},${traceId}
        )
      `;
      for (const vehicle of vehicles) {
        try {
          await tx`
            insert into operations.event_outbox(event_type,entity_type,entity_id,vehicle_id,vin,actor_id,actor_name,title,description,metadata)
            values ('tracking.request.deleted','tracking_order',${orderId},${vehicle.vehicle_id||null},${vehicle.vin||null},${user.id}::uuid,${user.fullName},'تم مسح طلب تراكينج',${order.sales_order_no},${tx.json({ orderId, orderNo: order.sales_order_no, reason, requestId: traceId })})
          `;
        } catch (outboxError) {
          console.error('[tracking/delete] event_outbox insert failed', outboxError);
        }
      }
      await tx`delete from tracking.orders where id=${orderId}::uuid`;
      try {
        await tx`
          insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data)
          values (${user.id}::uuid,'tracking','order_deleted','tracking_order',${order.sales_order_no},${tx.json(snapshot)},${tx.json({ reason, requestId: traceId, sourceIdentity: order.source_identity })})
        `;
      } catch (logError) {
        console.error('[tracking/delete] audit log insert failed', logError);
      }
      return { vins: vehicles.map((vehicle) => vehicle.vin).filter(Boolean), vehiclesCount: vehicles.length };
    });

    return response.status(200).json({
      ok: true,
      message: "تم مسح طلب التراكينج وفك ارتباط السيارات من المخزون بنجاح.",
      requestId: traceId,
      ...result,
    });
  } catch (error) {
    console.error("Tracking delete failed", { traceId, error });
    if (response.headersSent) return;
    return sendOperationError(response, error, traceId);
  }
}
