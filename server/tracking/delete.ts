import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";
import { requireUser } from "../_auth.js";
import { hasPermission } from "../_operations-auth.js";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { clean } from "../_tracking-utils.js";

function requestId() { return `trk-del-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`; }

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const traceId = requestId();
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Request-Id", traceId);
  try {
    await ensureOperationsSchema();
    await ensureTrackingSchema();
    const user = await requireUser(request, response);
    if (!user) return;
    if (!hasPermission(user, "tracking.orders.delete")) return response.status(403).json({ ok: false, error: "ليس لديك صلاحية حذف طلبات التراكينج", code: "FORBIDDEN", requestId: traceId });
    const sql = getSql();

    if (request.method === "GET") {
      const deleted = await sql<any[]>`
        select id::text,internal_order_id::text,sales_order_no,customer_name,customer_mobile,reason,deleted_by_name,deleted_at,
          source,source_identity,source_fingerprint,source_sheet_id,source_row_number,source_message_id,source_original_id,request_id
        from tracking.deleted_orders order by deleted_at desc limit 150
      `;
      return response.status(200).json({ ok: true, deleted });
    }

    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed", requestId: traceId });
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const orderId = clean(body.orderId);
    const confirmation = clean(body.confirmation);
    const reason = clean(body.reason);
    if (!orderId || !reason) return response.status(400).json({ ok: false, error: "اختر الطلب واكتب سبب الحذف", code: "VALIDATION_ERROR", requestId: traceId });

    const result = await sql.begin(async (tx) => {
      const [order] = await tx<any[]>`select *,id::text from tracking.orders where id=${orderId}::uuid and coalesce(is_deleted,false)=false for update`;
      if (!order) return { notFound: true };
      if (confirmation !== order.sales_order_no) return { confirmationError: true };

      const vehicles = await tx<any[]>`select *,id::text,operations_vehicle_id::text from tracking.order_vehicles where order_id=${orderId}::uuid order by item_no nulls last,created_at`;
      const vehicleIds = vehicles.map((vehicle) => vehicle.id);
      const stages = vehicleIds.length ? await tx<any[]>`
        select vs.*,vs.id::text,s.code,s.name,s.sort_order
        from tracking.vehicle_stages vs join tracking.stages s on s.id=vs.stage_id
        where vs.vehicle_id in ${tx(vehicleIds)} order by s.sort_order
      ` : [];
      const events = await tx<any[]>`select * from tracking.stage_events where order_id=${orderId}::uuid order by created_at`;
      const sms = await tx<any[]>`select * from tracking.sms_messages where order_id=${orderId}::uuid order by queued_at`;
      const snapshot = { order, vehicles, stages, events, sms };

      const [deleted] = await tx<any[]>`
        insert into tracking.deleted_orders(
          internal_order_id,sales_order_no,customer_name,customer_mobile,reason,snapshot,deleted_by,deleted_by_name,
          source,source_identity,source_fingerprint,source_sheet_id,source_row_number,source_message_id,source_original_id,request_id
        ) values (
          ${order.id}::uuid,${order.sales_order_no},${order.customer_name},${order.customer_mobile},${reason},${tx.json(snapshot)},${user.id}::uuid,${user.fullName},
          ${order.source},${order.source_identity},${order.source_fingerprint},${order.source_sheet_id},${order.source_row_number},${order.source_message_id},${order.source_original_id},${traceId}
        ) returning id::text
      `;
      if (order.source_fingerprint) {
        await tx`
          insert into tracking.deleted_source_identities(source_fingerprint,source_identity,internal_order_id,sales_order_no,deleted_order_id)
          values (${order.source_fingerprint},${order.source_identity},${order.id}::uuid,${order.sales_order_no},${deleted.id}::uuid)
          on conflict (source_fingerprint) do update set deleted_order_id=excluded.deleted_order_id,deleted_at=now()
        `;
      }
      await tx`delete from tracking.orders where id=${orderId}::uuid`;
      await tx`
        insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data)
        values (${user.id}::uuid,'tracking','order_deleted','tracking_order',${order.sales_order_no},${tx.json(snapshot)},${tx.json({reason,requestId:traceId,sourceFingerprint:order.source_fingerprint})})
      `;
      return { order, vehicles };
    });

    if ("notFound" in result) return response.status(404).json({ ok: false, error: "الطلب غير موجود أو تم حذفه مسبقًا", code: "TRACKING_REQUEST_NOT_FOUND", requestId: traceId });
    if ("confirmationError" in result) return response.status(400).json({ ok: false, error: "اكتب رقم الطلب كاملًا لتأكيد الحذف", code: "VALIDATION_ERROR", requestId: traceId });
    return response.status(200).json({ ok: true, message: "تم مسح طلب التراكينج وفك ارتباط السيارات من المخزون بنجاح.", requestId: traceId, affectedVehicles: result.vehicles.length });
  } catch (error) {
    console.error("Tracking delete failed", { requestId: traceId, error });
    return response.status(500).json({ ok: false, error: "تعذر مسح طلب التراكينج", code: "DATABASE_ERROR", requestId: traceId });
  }
}
