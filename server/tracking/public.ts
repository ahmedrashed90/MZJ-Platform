import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { clean, ensureVehicleStageRows } from "../_tracking-utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  await ensureTrackingSchema();
  const key = clean(request.query.key || request.query.vin || request.query.order || request.query.orderNo || request.query.o);
  if (!key) return response.status(400).json({ ok: false, error: "أدخل رقم الطلب أو رقم الهيكل" });

  const sql = getSql();
  const [order] = await sql<any[]>`
    select o.*,o.id::text
    from tracking.orders o
    where coalesce(o.is_deleted,false)=false
      and (
        lower(o.sales_order_no)=lower(${key})
        or exists (select 1 from tracking.order_vehicles v where v.order_id=o.id and lower(v.vin)=lower(${key}))
      )
    limit 1
  `;
  if (!order) return response.status(404).json({ ok: false, error: "لم يتم العثور على طلب بهذا الرقم. تأكد من رقم الطلب أو رقم الهيكل وحاول مرة أخرى." });

  const vehicles = await sql<any[]>`
    select v.*,v.id::text
    from tracking.order_vehicles v
    where v.order_id=${order.id}::uuid
    order by coalesce(nullif(regexp_replace(v.item_no,'\\D','','g'),''),'999999')::int,v.created_at
  `;
  for (const vehicle of vehicles) {
    await ensureVehicleStageRows(vehicle.id);
    vehicle.stages = await sql<any[]>`
      select s.code,s.name,s.description,s.owner_type,s.sort_order,vs.status,vs.completed_at
      from tracking.stages s
      left join tracking.vehicle_stages vs on vs.stage_id=s.id and vs.vehicle_id=${vehicle.id}::uuid
      where s.is_active=true
      order by s.sort_order
    `;
  }

  return response.status(200).json({
    ok: true,
    order: {
      id: order.id,
      sales_order_no: order.sales_order_no,
      customer_name: order.customer_name,
      branch: order.branch,
      order_date: order.order_date,
      delivery_date: order.delivery_date,
      subtotal_before_tax: order.subtotal_before_tax,
      tax_value: order.tax_value,
      total_incl_vat: order.total_incl_vat,
      registration_fee: order.registration_fee,
      status: order.status,
      is_archived: order.is_archived,
      updated_at: order.updated_at,
      vehicles,
    },
  });
}
