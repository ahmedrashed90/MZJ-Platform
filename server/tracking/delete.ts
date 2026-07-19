import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ApiError, requestId, sendApiError } from "../_api-errors.js";
import { requirePermission } from "../_auth.js";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { clean } from "../_tracking-utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const traceId = requestId();
  try {
    await ensureTrackingSchema();
    await ensureOperationsSchema();
    const user = await requirePermission(request, response, "tracking.orders.delete");
    if (!user) return;
    const sql = getSql();

    if (request.method === "GET") {
      const deleted = await sql<any[]>`
        select id::text,order_internal_id::text,sales_order_no,customer_name,customer_mobile,reason,deleted_by_name,deleted_at,
          source_key,source_identity,source_fingerprint,snapshot
        from tracking.deleted_orders
        order by deleted_at desc
        limit 150
      `;
      return response.status(200).json({ ok: true, deleted, requestId: traceId });
    }

    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed", requestId: traceId });
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    if (clean(body.action) !== "delete") throw new ApiError(400, "VALIDATION_ERROR", "الإجراء غير مدعوم");

    const orderId = clean(body.orderId);
    const confirmation = clean(body.confirmation);
    const reason = clean(body.reason);
    if (!orderId) throw new ApiError(400, "VALIDATION_ERROR", "معرف الطلب مطلوب");
    if (!reason) throw new ApiError(400, "VALIDATION_ERROR", "سبب الحذف مطلوب", { reason: "مطلوب" });

    const result = await sql.begin(async (tx) => {
      const [order] = await tx<any[]>`
        select *,id::text from tracking.orders where id=${orderId}::uuid and coalesce(is_deleted,false)=false for update
      `;
      if (!order) {
        const [deleted] = await tx<any[]>`select id::text from tracking.deleted_orders where order_internal_id=${orderId}::uuid limit 1`;
        if (deleted) throw new ApiError(409, "TRACKING_SOURCE_ALREADY_DELETED", "تم حذف هذا الطلب مسبقًا");
        throw new ApiError(404, "TRACKING_REQUEST_NOT_FOUND", "الطلب غير موجود");
      }
      if (confirmation !== order.sales_order_no) {
        throw new ApiError(400, "VALIDATION_ERROR", "اكتب رقم الطلب كاملًا لتأكيد الحذف", { confirmation: "رقم الطلب غير مطابق" });
      }

      const vehicles = await tx<any[]>`
        select ov.*,ov.id::text,ov.operations_vehicle_id::text,op.car_name as operations_car_name,op.location_id::text as operations_location_id
        from tracking.order_vehicles ov left join operations.vehicles op on op.id=ov.operations_vehicle_id
        where ov.order_id=${orderId}::uuid order by ov.created_at
      `;
      const vehicleIds = vehicles.map((vehicle) => vehicle.id);
      const stages = vehicleIds.length ? await tx<any[]>`
        select vs.*,vs.id::text,s.code,s.name,s.sort_order
        from tracking.vehicle_stages vs join tracking.stages s on s.id=vs.stage_id
        where vs.vehicle_id=any(${vehicleIds}::uuid[]) order by s.sort_order
      ` : [];
      const events = await tx<any[]>`select * from tracking.stage_events where order_id=${orderId}::uuid order by created_at`;
      const sms = await tx<any[]>`select * from tracking.sms_messages where order_id=${orderId}::uuid order by queued_at`;
      const snapshot = { order, vehicles, stages, events, sms };

      await tx`
        insert into tracking.deleted_orders(
          order_internal_id,sales_order_no,customer_name,customer_mobile,reason,snapshot,deleted_by,deleted_by_name,
          deleted_by_email,deleted_by_role,source_key,source_identity,source_fingerprint,source_payload,request_id
        ) values (
          ${orderId}::uuid,${order.sales_order_no},${order.customer_name},${order.customer_mobile},${reason},${tx.json(snapshot)},
          ${user.id}::uuid,${user.fullName},${user.email},${user.roles[0]||user.roleCodes[0]||null},${order.source_key||null},
          ${order.source_identity||null},${order.source_fingerprint||null},${tx.json(order.source_payload||{})},${traceId}
        )
      `;
      await tx`delete from tracking.orders where id=${orderId}::uuid`;
      await tx`
        insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data)
        values (${user.id}::uuid,'tracking','order_deleted','tracking_order',${order.sales_order_no},${tx.json(snapshot)},${tx.json({ reason, sourceKey: order.source_key, requestId: traceId })})
      `;
      await tx`
        insert into operations.event_outbox(event_type,aggregate_type,aggregate_id,title,description,payload)
        values ('tracking.request.deleted','tracking_order',${orderId},'تم مسح طلب تراكينج',${`تم مسح الطلب ${order.sales_order_no} وفك ارتباط السيارات`},${tx.json({ orderNo: order.sales_order_no, vins: vehicles.map((vehicle) => vehicle.vin), requestId: traceId })})
      `;
      return { orderNo: order.sales_order_no, vins: vehicles.map((vehicle) => vehicle.vin) };
    });

    return response.status(200).json({
      ok: true,
      data: result,
      message: "تم مسح طلب التراكينج وفك ارتباط السيارات من المخزون بنجاح.",
      requestId: traceId,
    });
  } catch (error) {
    return sendApiError(response, error, traceId);
  }
}
