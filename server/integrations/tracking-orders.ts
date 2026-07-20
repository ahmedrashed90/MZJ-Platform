import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { safeSecretEquals } from "../_auth.js";
import { getSql } from "../_db.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { clean, dateValue, ensureVehicleStageRows, numberValue } from "../_tracking-utils.js";

function requestBody(request: VercelRequest) {
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return request.body || {};
}
function requestKey(request: VercelRequest) { return clean(request.headers["x-mzj-tracking-key"] || request.query.key); }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

function sourceDescriptor(body: any, orderNo: string) {
  const source = clean(body.integrationSource) || "google-sheets-next-erp";
  const sourceOriginalId = clean(body.sourceOriginalId || body.nextErpOrderId || body.originalOrderId || body.erpOrderId);
  const sourceMessageId = clean(body.sourceMessageId || body.messageId);
  const sourceSheetId = clean(body.sourceSheetId || body.sheetId);
  const sourceRowNumber = clean(body.sourceOrderRowNumber || body.orderRowNumber || body.sourceRowNumber || body.rowNumber);
  const explicit = clean(body.sourceIdentity) || sourceOriginalId || sourceMessageId || (sourceSheetId && sourceRowNumber ? `${sourceSheetId}:${sourceRowNumber}` : "");
  const stableFallback = [
    source,
    orderNo,
    clean(body.originalCreatedAt || body.sourceCreatedAt || body.orderDate),
    clean(body.customerVat || body.customerPhone || body.customerName),
    clean(body.salesPerson),
  ].join("|");
  const sourceIdentity = explicit ? `${source}:${explicit}` : `${source}:fingerprint:${hash(stableFallback)}`;
  return {
    source,
    sourceIdentity,
    sourceFingerprint: hash(sourceIdentity),
    sourceOriginalId: sourceOriginalId || null,
    sourceMessageId: sourceMessageId || null,
    sourceSheetId: sourceSheetId || null,
    sourceRowNumber: sourceRowNumber || null,
  };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  await ensureOperationsSchema();
  await ensureTrackingSchema();

  const configuredKey = clean(process.env.TRACKING_INGEST_KEY);
  if (configuredKey && !safeSecretEquals(requestKey(request), configuredKey)) return response.status(401).json({ ok: false, error: "مفتاح مزامنة التتبع غير صحيح" });

  let body: any;
  try { body = requestBody(request); } catch { return response.status(400).json({ ok: false, error: "صيغة JSON غير صحيحة" }); }

  const orderNo = clean(body.orderNo || body.salesOrderNo);
  const item = body.item || {};
  const totals = body.totals || {};
  const itemNo = clean(item.no || item.itemNo) || "1";
  const rawVin = clean(item.vin || body.vin);
  const vin = rawVin || `PENDING-${orderNo}-${itemNo}`;
  if (!orderNo) return response.status(400).json({ ok: false, error: "رقم طلب البيع مطلوب" });

  const identity = sourceDescriptor(body, orderNo);
  const sql = getSql();
  const [deletedSource] = await sql<any[]>`select sales_order_no,deleted_at from tracking.deleted_source_identities where source_fingerprint=${identity.sourceFingerprint}`;
  if (deletedSource) {
    return response.status(200).json({
      ok: true,
      ignored: true,
      deletedSource: true,
      orderNo,
      message: "تم تجاهل نسخة المصدر القديمة لأنها حُذفت من المنصة سابقًا",
    });
  }

  try {
    const result = await sql.begin(async (tx) => {
      const [order] = await tx<any[]>`
        insert into tracking.orders(
          sales_order_no,customer_name,customer_mobile,customer_vat,branch,order_date,delivery_date,sales_person,
          subtotal_before_tax,tax_value,total_incl_vat,registration_fee,source,source_identity,source_fingerprint,
          source_sheet_id,source_row_number,source_message_id,source_original_id,source_payload,source_updated_at,is_deleted,updated_at
        ) values (
          ${orderNo},${clean(body.customerName)||null},${clean(body.customerPhone)||null},${clean(body.customerVat)||null},${clean(body.branch)||null},
          ${dateValue(body.orderDate)},${dateValue(body.deliveryDate)},${clean(body.salesPerson)||null},
          ${numberValue(totals.subtotalBeforeTax)},${numberValue(totals.carTaxValue)},${numberValue(totals.grandTotal || totals.carTotalInclVAT)},
          ${numberValue(totals.registrationFee)},${identity.source},${identity.sourceIdentity},${identity.sourceFingerprint},${identity.sourceSheetId},
          ${identity.sourceRowNumber},${identity.sourceMessageId},${identity.sourceOriginalId},${tx.json(body)},now(),false,now()
        )
        on conflict (source_fingerprint) do update set
          sales_order_no=excluded.sales_order_no,
          customer_name=coalesce(excluded.customer_name,tracking.orders.customer_name),
          customer_mobile=coalesce(excluded.customer_mobile,tracking.orders.customer_mobile),
          customer_vat=coalesce(excluded.customer_vat,tracking.orders.customer_vat),
          branch=coalesce(excluded.branch,tracking.orders.branch),
          order_date=coalesce(excluded.order_date,tracking.orders.order_date),
          delivery_date=coalesce(excluded.delivery_date,tracking.orders.delivery_date),
          sales_person=coalesce(excluded.sales_person,tracking.orders.sales_person),
          subtotal_before_tax=greatest(tracking.orders.subtotal_before_tax,excluded.subtotal_before_tax),
          tax_value=greatest(tracking.orders.tax_value,excluded.tax_value),
          total_incl_vat=greatest(tracking.orders.total_incl_vat,excluded.total_incl_vat),
          registration_fee=greatest(tracking.orders.registration_fee,excluded.registration_fee),
          source=excluded.source,source_identity=excluded.source_identity,source_sheet_id=excluded.source_sheet_id,
          source_row_number=excluded.source_row_number,source_message_id=excluded.source_message_id,source_original_id=excluded.source_original_id,
          source_payload=excluded.source_payload,source_updated_at=now(),is_deleted=false,updated_at=now()
        returning *,id::text
      `;

      let [vehicle] = await tx<any[]>`
        select *,id::text from tracking.order_vehicles
        where order_id=${order.id}::uuid and ((item_no is not null and item_no=${itemNo}) or vin=${vin})
        order by case when item_no=${itemNo} then 0 else 1 end limit 1
      `;
      const vehicleValues = {
        carName: [clean(item.type),clean(item.category),clean(item.model)].filter(Boolean).join(" "),
        qty: numberValue(item.qty)||1, unitPrice:numberValue(item.unitPrice), itemValue:numberValue(item.value),
        subtotal:numberValue(totals.carSubtotalExclVAT), tax:numberValue(totals.carTaxValue), total:numberValue(totals.carTotalInclVAT), registrationFee:numberValue(totals.registrationFee),
      };
      const [operationsVehicle] = rawVin ? await tx<any[]>`select id::text from operations.vehicles where vin=${rawVin} and is_deleted=false limit 1` : [];
      if (vehicle) {
        [vehicle] = await tx<any[]>`
          update tracking.order_vehicles set vin=${vin},operations_vehicle_id=${operationsVehicle?.id||null}::uuid,item_no=${itemNo},car_name=${vehicleValues.carName||null},
            item_type=${clean(item.type)||null},item_category=${clean(item.category)||null},item_model=${clean(item.model)||null},interior_color=${clean(item.interiorColor)||null},
            exterior_color=${clean(item.exteriorColor)||null},dealer=${clean(item.dealer)||null},qty=${vehicleValues.qty},unit_price=${vehicleValues.unitPrice},
            item_value=${vehicleValues.itemValue},subtotal_excl_vat=${vehicleValues.subtotal},tax_value=${vehicleValues.tax},total_incl_vat=${vehicleValues.total},
            registration_fee=${vehicleValues.registrationFee},raw_payload=${tx.json(body)},updated_at=now()
          where id=${vehicle.id}::uuid returning *,id::text
        `;
      } else {
        [vehicle] = await tx<any[]>`
          insert into tracking.order_vehicles(order_id,vin,operations_vehicle_id,item_no,car_name,item_type,item_category,item_model,interior_color,exterior_color,dealer,qty,unit_price,item_value,subtotal_excl_vat,tax_value,total_incl_vat,registration_fee,raw_payload,updated_at)
          values (${order.id}::uuid,${vin},${operationsVehicle?.id||null}::uuid,${itemNo},${vehicleValues.carName||null},${clean(item.type)||null},${clean(item.category)||null},${clean(item.model)||null},${clean(item.interiorColor)||null},${clean(item.exteriorColor)||null},${clean(item.dealer)||null},${vehicleValues.qty},${vehicleValues.unitPrice},${vehicleValues.itemValue},${vehicleValues.subtotal},${vehicleValues.tax},${vehicleValues.total},${vehicleValues.registrationFee},${tx.json(body)},now()) returning *,id::text
        `;
      }

      await tx`
        update tracking.orders o set subtotal_before_tax=coalesce(x.subtotal_before_tax,0),tax_value=coalesce(x.tax_value,0),
          total_incl_vat=coalesce(x.total_incl_vat,0),registration_fee=coalesce(x.registration_fee,0),updated_at=now()
        from (select order_id,sum(subtotal_excl_vat)+max(registration_fee) as subtotal_before_tax,sum(tax_value) as tax_value,sum(total_incl_vat)+max(registration_fee) as total_incl_vat,max(registration_fee) as registration_fee from tracking.order_vehicles where order_id=${order.id}::uuid group by order_id) x
        where o.id=x.order_id
      `;
      await tx`
        insert into integrations.inbound_events(source,event_key,event_type,payload,status,processed_at)
        values (${identity.source},${`${identity.sourceFingerprint}:${itemNo}`},'tracking_order_upsert',${tx.json(body)},'processed',now())
        on conflict (source,event_key) do update set payload=excluded.payload,status='processed',error_message=null,processed_at=now()
      `;
      return {order,vehicle};
    });
    await ensureVehicleStageRows(result.vehicle.id);
    return response.status(200).json({ok:true,orderId:result.order.id,vehicleId:result.vehicle.id,orderNo,vin:rawVin,sourceIdentity:identity.sourceIdentity,message:"تم استلام طلب التتبع وحفظه في المنصة"});
  } catch (error) {
    console.error("Tracking ingest failed",error);
    return response.status(500).json({ok:false,error:"تعذر حفظ طلب التتبع في المنصة"});
  }
}
