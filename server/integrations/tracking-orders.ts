import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { safeSecretEquals } from "../_auth.js";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { clean, dateValue, ensureVehicleStageRows, numberValue } from "../_tracking-utils.js";

function requestBody(request: VercelRequest) {
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return request.body || {};
}

function requestKey(request: VercelRequest) {
  return clean(request.headers["x-mzj-tracking-key"] || request.query.key);
}

function stableFingerprint(payload: Record<string, any>) {
  const stable = JSON.stringify({
    integrationSource: clean(payload.integrationSource) || "google-sheets-next-erp",
    sourceSheetId: clean(payload.sourceSheetId || payload.sheetId),
    sourceSheetName: clean(payload.sourceSheetName || payload.sheetName),
    sourceRowNumber: clean(payload.sourceRowNumber || payload.rowNumber),
    sourceMessageId: clean(payload.sourceMessageId || payload.messageId),
    sourceOriginalId: clean(payload.nextErpOriginalId || payload.sourceOriginalId || payload.originalId),
    originalCreatedAt: clean(payload.originalCreatedAt || payload.createdAt || payload.orderCreatedAt),
    orderNo: clean(payload.orderNo || payload.salesOrderNo),
    customerReference: clean(payload.customerReference || payload.customerVat || payload.customerPhone),
  });
  return createHash("sha256").update(stable).digest("hex");
}

function sourceIdentity(payload: Record<string, any>, fingerprint: string) {
  const originalId = clean(payload.nextErpOriginalId || payload.sourceOriginalId || payload.originalId);
  if (originalId) return `original:${originalId}`;
  const messageId = clean(payload.sourceMessageId || payload.messageId);
  if (messageId) return `message:${messageId}`;
  const sheetId = clean(payload.sourceSheetId || payload.sheetId);
  const row = clean(payload.sourceRowNumber || payload.rowNumber);
  if (sheetId && row) return `sheet:${sheetId}:row:${row}`;
  return `fingerprint:${fingerprint}`;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  await ensureTrackingSchema();
  await ensureOperationsSchema();

  const configuredKey = clean(process.env.TRACKING_INGEST_KEY);
  if (configuredKey && !safeSecretEquals(requestKey(request), configuredKey)) {
    return response.status(401).json({ ok: false, error: "مفتاح مزامنة التتبع غير صحيح" });
  }

  let body: any;
  try {
    body = requestBody(request);
  } catch {
    return response.status(400).json({ ok: false, error: "صيغة JSON غير صحيحة" });
  }

  const orderNo = clean(body.orderNo || body.salesOrderNo);
  const item = body.item || {};
  const totals = body.totals || {};
  const itemNo = clean(item.no || item.itemNo) || "1";
  const rawVin = clean(item.vin || body.vin);
  const vin = rawVin || `PENDING-${orderNo}-${itemNo}`;
  if (!orderNo) return response.status(400).json({ ok: false, error: "رقم طلب البيع مطلوب" });

  const source = clean(body.integrationSource) || "google-sheets-next-erp";
  const fingerprint = stableFingerprint(body);
  const identity = sourceIdentity(body, fingerprint);
  const sourceKey = `${source}:${identity}`;
  const sourceRowNumber = clean(body.sourceRowNumber || body.rowNumber) || null;
  const sourceSheetId = clean(body.sourceSheetId || body.sheetId) || null;
  const sourceSheetName = clean(body.sourceSheetName || body.sheetName) || null;
  const sourceMessageId = clean(body.sourceMessageId || body.messageId) || null;
  const sourceOriginalId = clean(body.nextErpOriginalId || body.sourceOriginalId || body.originalId) || null;

  const sql = getSql();
  const [deletedSource] = await sql<any[]>`
    select id::text,deleted_at from tracking.deleted_orders where source_key=${sourceKey} order by deleted_at desc limit 1
  `;
  if (deletedSource) {
    return response.status(200).json({
      ok: true,
      ignored: true,
      sourceAlreadyDeleted: true,
      orderNo,
      sourceKey,
      message: "تم تجاهل نسخة المصدر القديمة لأنها حُذفت سابقًا من المنصة",
    });
  }

  try {
    const result = await sql.begin(async (tx) => {
      let [order] = await tx<any[]>`select *,id::text from tracking.orders where source_key=${sourceKey} for update`;
      if (order) {
        [order] = await tx<any[]>`
          update tracking.orders set
            sales_order_no=${orderNo},customer_name=coalesce(${clean(body.customerName)||null},customer_name),
            customer_mobile=coalesce(${clean(body.customerPhone)||null},customer_mobile),customer_vat=coalesce(${clean(body.customerVat)||null},customer_vat),
            branch=coalesce(${clean(body.branch)||null},branch),order_date=coalesce(${dateValue(body.orderDate)},order_date),
            delivery_date=coalesce(${dateValue(body.deliveryDate)},delivery_date),sales_person=coalesce(${clean(body.salesPerson)||null},sales_person),
            source=${source},source_payload=${tx.json(body)},source_updated_at=now(),source_identity=${identity},source_fingerprint=${fingerprint},
            source_row_number=${sourceRowNumber},source_sheet_id=${sourceSheetId},source_sheet_name=${sourceSheetName},source_message_id=${sourceMessageId},
            source_original_id=${sourceOriginalId},is_deleted=false,updated_at=now()
          where id=${order.id}::uuid returning *,id::text
        `;
      } else {
        [order] = await tx<any[]>`
          insert into tracking.orders(
            sales_order_no,customer_name,customer_mobile,customer_vat,branch,order_date,delivery_date,sales_person,
            subtotal_before_tax,tax_value,total_incl_vat,registration_fee,source,source_payload,source_updated_at,is_deleted,
            source_key,source_identity,source_fingerprint,source_row_number,source_sheet_id,source_sheet_name,source_message_id,source_original_id,updated_at
          ) values (
            ${orderNo},${clean(body.customerName)||null},${clean(body.customerPhone)||null},${clean(body.customerVat)||null},${clean(body.branch)||null},
            ${dateValue(body.orderDate)},${dateValue(body.deliveryDate)},${clean(body.salesPerson)||null},
            ${numberValue(totals.subtotalBeforeTax)},${numberValue(totals.carTaxValue)},${numberValue(totals.grandTotal || totals.carTotalInclVAT)},
            ${numberValue(totals.registrationFee)},${source},${tx.json(body)},now(),false,${sourceKey},${identity},${fingerprint},
            ${sourceRowNumber},${sourceSheetId},${sourceSheetName},${sourceMessageId},${sourceOriginalId},now()
          ) returning *,id::text
        `;
      }

      let [vehicle] = await tx<any[]>`
        select *,id::text from tracking.order_vehicles
        where order_id=${order.id}::uuid and ((item_no is not null and item_no=${itemNo}) or vin=${vin})
        order by case when item_no=${itemNo} then 0 else 1 end limit 1 for update
      `;

      const vehicleValues = {
        carName: [clean(item.type), clean(item.category), clean(item.model)].filter(Boolean).join(" "),
        qty: numberValue(item.qty) || 1,
        unitPrice: numberValue(item.unitPrice),
        itemValue: numberValue(item.value),
        subtotal: numberValue(totals.carSubtotalExclVAT),
        tax: numberValue(totals.carTaxValue),
        total: numberValue(totals.carTotalInclVAT),
        registrationFee: numberValue(totals.registrationFee),
      };

      if (vehicle) {
        [vehicle] = await tx<any[]>`
          update tracking.order_vehicles set
            vin=${vin},item_no=${itemNo},car_name=${vehicleValues.carName||null},item_type=${clean(item.type)||null},
            item_category=${clean(item.category)||null},item_model=${clean(item.model)||null},interior_color=${clean(item.interiorColor)||null},
            exterior_color=${clean(item.exteriorColor)||null},dealer=${clean(item.dealer)||null},qty=${vehicleValues.qty},
            unit_price=${vehicleValues.unitPrice},item_value=${vehicleValues.itemValue},subtotal_excl_vat=${vehicleValues.subtotal},
            tax_value=${vehicleValues.tax},total_incl_vat=${vehicleValues.total},registration_fee=${vehicleValues.registrationFee},
            operations_vehicle_id=(select id from operations.vehicles where vin=${rawVin} and is_deleted=false limit 1),
            raw_payload=${tx.json(body)},updated_at=now()
          where id=${vehicle.id}::uuid returning *,id::text
        `;
      } else {
        [vehicle] = await tx<any[]>`
          insert into tracking.order_vehicles(
            order_id,vin,item_no,car_name,item_type,item_category,item_model,interior_color,exterior_color,dealer,qty,
            unit_price,item_value,subtotal_excl_vat,tax_value,total_incl_vat,registration_fee,operations_vehicle_id,raw_payload,updated_at
          ) values (
            ${order.id}::uuid,${vin},${itemNo},${vehicleValues.carName||null},${clean(item.type)||null},${clean(item.category)||null},
            ${clean(item.model)||null},${clean(item.interiorColor)||null},${clean(item.exteriorColor)||null},${clean(item.dealer)||null},
            ${vehicleValues.qty},${vehicleValues.unitPrice},${vehicleValues.itemValue},${vehicleValues.subtotal},${vehicleValues.tax},
            ${vehicleValues.total},${vehicleValues.registrationFee},(select id from operations.vehicles where vin=${rawVin} and is_deleted=false limit 1),
            ${tx.json(body)},now()
          ) returning *,id::text
        `;
      }

      await tx`
        update tracking.orders o set
          subtotal_before_tax=coalesce(x.subtotal_before_tax,0),tax_value=coalesce(x.tax_value,0),
          total_incl_vat=coalesce(x.total_incl_vat,0),registration_fee=coalesce(x.registration_fee,0),updated_at=now()
        from (
          select order_id,sum(subtotal_excl_vat)+max(registration_fee) as subtotal_before_tax,sum(tax_value) as tax_value,
            sum(total_incl_vat)+max(registration_fee) as total_incl_vat,max(registration_fee) as registration_fee
          from tracking.order_vehicles where order_id=${order.id}::uuid group by order_id
        ) x where o.id=x.order_id
      `;

      await tx`
        insert into integrations.inbound_events(source,event_key,event_type,payload,status,processed_at)
        values (${source},${`${sourceKey}:item:${itemNo}`},'tracking_order_upsert',${tx.json(body)},'processed',now())
        on conflict (source,event_key) do update set payload=excluded.payload,status='processed',error_message=null,processed_at=now()
      `;
      return { order, vehicle };
    });

    await ensureVehicleStageRows(result.vehicle.id);
    return response.status(200).json({
      ok: true,
      orderId: result.order.id,
      vehicleId: result.vehicle.id,
      orderNo,
      vin: rawVin,
      sourceKey,
      message: "تم استلام طلب التتبع وحفظه في المنصة",
    });
  } catch (error) {
    console.error("Tracking ingest failed", { sourceKey, error });
    return response.status(500).json({ ok: false, error: "تعذر حفظ طلب التتبع في المنصة" });
  }
}
