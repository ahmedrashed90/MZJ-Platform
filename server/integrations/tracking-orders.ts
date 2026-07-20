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

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceFields(body: any, orderNo: string, itemNo: string) {
  const integrationSource = clean(body.integrationSource) || "google-sheets-next-erp";
  const sourceSheetId = clean(body.sourceSheetId || body.sheetId);
  const sourceSheetName = clean(body.sourceSheetName || body.sheetName);
  const sourceRowNumber = clean(body.sourceRowNumber || body.rowNumber || body.sheetRow);
  const sourceMessageId = clean(body.sourceMessageId || body.messageId);
  const sourceOriginalId = clean(body.sourceOriginalId || body.nextErpOriginalId || body.nextErpId || body.originalOrderId);
  const orderFingerprint = fingerprint({
    integrationSource,
    sourceSheetId,
    sourceSheetName,
    sourceRowNumber,
    sourceMessageId,
    sourceOriginalId,
    orderNo,
    originalCreatedAt: clean(body.originalCreatedAt || body.createdAt || body.orderDate),
    customerReference: clean(body.customerReference || body.customerMobile || body.customerPhone || body.customerName),
  });
  const sourceIdentity = clean(body.sourceIdentity)
    || (sourceOriginalId ? `${integrationSource}:original:${sourceOriginalId}` : "")
    || (sourceMessageId ? `${integrationSource}:message:${sourceMessageId}` : "")
    || (sourceSheetId && sourceRowNumber ? `${integrationSource}:sheet:${sourceSheetId}:row:${sourceRowNumber}:order:${orderNo}` : "")
    || `${integrationSource}:fingerprint:${orderFingerprint}`;
  const sourceItemIdentity = clean(body.sourceItemIdentity)
    || `${sourceIdentity}:item:${itemNo}`;
  const sourceFingerprint = clean(body.sourceFingerprint) || fingerprint({
    integrationSource,
    sourceSheetId,
    sourceRowNumber,
    sourceMessageId,
    sourceOriginalId,
    orderNo,
    itemNo,
    createdAt: clean(body.originalCreatedAt || body.createdAt || body.orderDate),
    vin: clean(body.item?.vin || body.vin),
  });
  return { integrationSource, sourceSheetId, sourceSheetName, sourceRowNumber, sourceMessageId, sourceOriginalId, sourceIdentity, sourceItemIdentity, sourceFingerprint };
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
  const source = sourceFields(body, orderNo, itemNo);
  const sql = getSql();

  const [deletedSource] = await sql<any[]>`
    select id::text,deleted_at from tracking.deleted_orders
    where source_identity=${source.sourceIdentity}
    order by deleted_at desc limit 1
  `;
  if (deletedSource) {
    return response.status(200).json({
      ok: true,
      ignored: true,
      deletedSource: true,
      orderNo,
      sourceIdentity: source.sourceIdentity,
      message: "تم تجاهل نسخة المصدر القديمة لأنها حُذفت سابقًا من المنصة",
    });
  }

  try {
    const result = await sql.begin(async (tx) => {
      let [order] = await tx<any[]>`
        select *,id::text from tracking.orders
        where coalesce(is_deleted,false)=false
          and (source_identity=${source.sourceIdentity} or (source_identity is null and sales_order_no=${orderNo}))
        order by case when source_identity=${source.sourceIdentity} then 0 else 1 end,updated_at desc
        limit 1 for update
      `;

      const orderValues = {
        customerName: clean(body.customerName) || null,
        customerPhone: clean(body.customerPhone) || null,
        customerVat: clean(body.customerVat) || null,
        branch: clean(body.branch) || null,
        orderDate: dateValue(body.orderDate),
        deliveryDate: dateValue(body.deliveryDate),
        salesPerson: clean(body.salesPerson) || null,
        subtotal: numberValue(totals.subtotalBeforeTax),
        tax: numberValue(totals.carTaxValue),
        total: numberValue(totals.grandTotal || totals.carTotalInclVAT),
        registrationFee: numberValue(totals.registrationFee),
      };

      if (order) {
        [order] = await tx<any[]>`
          update tracking.orders set
            sales_order_no=${orderNo},customer_name=coalesce(${orderValues.customerName},customer_name),customer_mobile=coalesce(${orderValues.customerPhone},customer_mobile),
            customer_vat=coalesce(${orderValues.customerVat},customer_vat),branch=coalesce(${orderValues.branch},branch),order_date=coalesce(${orderValues.orderDate},order_date),
            delivery_date=coalesce(${orderValues.deliveryDate},delivery_date),sales_person=coalesce(${orderValues.salesPerson},sales_person),
            subtotal_before_tax=greatest(subtotal_before_tax,${orderValues.subtotal}),tax_value=greatest(tax_value,${orderValues.tax}),
            total_incl_vat=greatest(total_incl_vat,${orderValues.total}),registration_fee=greatest(registration_fee,${orderValues.registrationFee}),
            source=${source.integrationSource},source_payload=${tx.json(body)},source_updated_at=now(),source_identity=coalesce(source_identity,${source.sourceIdentity}),
            source_fingerprint=${source.sourceFingerprint},source_sheet_id=${source.sourceSheetId||null},source_sheet_name=${source.sourceSheetName||null},
            source_row_number=${source.sourceRowNumber||null},source_message_id=${source.sourceMessageId||null},source_original_id=${source.sourceOriginalId||null},updated_at=now()
          where id=${order.id}::uuid returning *,id::text
        `;
      } else {
        [order] = await tx<any[]>`
          insert into tracking.orders(
            sales_order_no,customer_name,customer_mobile,customer_vat,branch,order_date,delivery_date,sales_person,
            subtotal_before_tax,tax_value,total_incl_vat,registration_fee,source,source_payload,source_updated_at,is_deleted,
            source_identity,source_fingerprint,source_sheet_id,source_sheet_name,source_row_number,source_message_id,source_original_id,updated_at
          ) values (
            ${orderNo},${orderValues.customerName},${orderValues.customerPhone},${orderValues.customerVat},${orderValues.branch},${orderValues.orderDate},${orderValues.deliveryDate},${orderValues.salesPerson},
            ${orderValues.subtotal},${orderValues.tax},${orderValues.total},${orderValues.registrationFee},${source.integrationSource},${tx.json(body)},now(),false,
            ${source.sourceIdentity},${source.sourceFingerprint},${source.sourceSheetId||null},${source.sourceSheetName||null},${source.sourceRowNumber||null},${source.sourceMessageId||null},${source.sourceOriginalId||null},now()
          ) returning *,id::text
        `;
      }

      let [vehicle] = await tx<any[]>`
        select *,id::text from tracking.order_vehicles
        where order_id=${order.id}::uuid
          and (source_item_identity=${source.sourceItemIdentity} or (source_item_identity is null and ((item_no is not null and item_no=${itemNo}) or vin=${vin})))
        order by case when source_item_identity=${source.sourceItemIdentity} then 0 when item_no=${itemNo} then 1 else 2 end
        limit 1 for update
      `;

      const [operationsVehicle] = rawVin ? await tx<any[]>`select id::text from operations.vehicles where vin=${rawVin} and is_deleted=false order by updated_at desc limit 1` : [null];
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
            vin=${vin},item_no=${itemNo},car_name=${vehicleValues.carName||null},item_type=${clean(item.type)||null},item_category=${clean(item.category)||null},
            item_model=${clean(item.model)||null},interior_color=${clean(item.interiorColor)||null},exterior_color=${clean(item.exteriorColor)||null},dealer=${clean(item.dealer)||null},
            qty=${vehicleValues.qty},unit_price=${vehicleValues.unitPrice},item_value=${vehicleValues.itemValue},subtotal_excl_vat=${vehicleValues.subtotal},tax_value=${vehicleValues.tax},
            total_incl_vat=${vehicleValues.total},registration_fee=${vehicleValues.registrationFee},raw_payload=${tx.json(body)},vehicle_id=${operationsVehicle?.id||null},
            source_item_identity=${source.sourceItemIdentity},updated_at=now()
          where id=${vehicle.id}::uuid returning *,id::text
        `;
      } else {
        [vehicle] = await tx<any[]>`
          insert into tracking.order_vehicles(
            order_id,vin,item_no,car_name,item_type,item_category,item_model,interior_color,exterior_color,dealer,qty,unit_price,item_value,
            subtotal_excl_vat,tax_value,total_incl_vat,registration_fee,raw_payload,vehicle_id,source_item_identity,updated_at
          ) values (
            ${order.id}::uuid,${vin},${itemNo},${vehicleValues.carName||null},${clean(item.type)||null},${clean(item.category)||null},${clean(item.model)||null},
            ${clean(item.interiorColor)||null},${clean(item.exteriorColor)||null},${clean(item.dealer)||null},${vehicleValues.qty},${vehicleValues.unitPrice},${vehicleValues.itemValue},
            ${vehicleValues.subtotal},${vehicleValues.tax},${vehicleValues.total},${vehicleValues.registrationFee},${tx.json(body)},${operationsVehicle?.id||null},${source.sourceItemIdentity},now()
          ) returning *,id::text
        `;
      }

      await tx`
        update tracking.orders o set
          subtotal_before_tax=coalesce(x.subtotal_before_tax,0),tax_value=coalesce(x.tax_value,0),total_incl_vat=coalesce(x.total_incl_vat,0),
          registration_fee=coalesce(x.registration_fee,0),updated_at=now()
        from (
          select order_id,sum(subtotal_excl_vat)+max(registration_fee) as subtotal_before_tax,sum(tax_value) as tax_value,
            sum(total_incl_vat)+max(registration_fee) as total_incl_vat,max(registration_fee) as registration_fee
          from tracking.order_vehicles where order_id=${order.id}::uuid group by order_id
        ) x where o.id=x.order_id
      `;

      await tx`
        insert into integrations.inbound_events(source,event_key,event_type,payload,status,processed_at)
        values (${source.integrationSource},${source.sourceFingerprint},'tracking_order_upsert',${tx.json(body)},'processed',now())
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
      sourceIdentity: source.sourceIdentity,
      message: "تم استلام طلب التتبع وحفظه في المنصة",
    });
  } catch (error) {
    console.error("Tracking ingest failed", { sourceIdentity: source.sourceIdentity, orderNo, error });
    return response.status(500).json({ ok: false, error: "تعذر حفظ طلب التتبع في المنصة" });
  }
}
