import type { VercelRequest,VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { safeSecretEquals } from "../_auth.js";
import { getSql } from "../_db.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { clean,dateValue,ensureVehicleStageRows,numberValue } from "../_tracking-utils.js";

function requestBody(request:VercelRequest){if(typeof request.body==="string")return JSON.parse(request.body||"{}");return request.body||{}}
function requestKey(request:VercelRequest){return clean(request.headers["x-mzj-tracking-key"]||request.query.key)}
function hash(value:string){return createHash("sha256").update(value).digest("hex")}
function sourceMeta(body:any,orderNo:string){
  const source=clean(body.integrationSource)||"google-sheets-next-erp";
  const originalId=clean(body.sourceOriginalId||body.nextErpOrderId||body.originalOrderId||body.erpOrderId);
  const messageId=clean(body.sourceMessageId||body.messageId);
  const sheetId=clean(body.sourceSheetId||body.sheetId);
  const row=clean(body.sourceRowNumber||body.rowNumber||body.sheetRow);
  const sheetName=clean(body.sourceSheetName||body.sheetName);
  let identity="";
  if(originalId)identity=`${source}:original:${originalId}`;
  else if(messageId)identity=`${source}:message:${messageId}`;
  else if(sheetId&&row)identity=`${source}:sheet:${sheetId}:row:${row}`;
  else identity=`${source}:fingerprint:${hash(JSON.stringify([orderNo,clean(body.orderDate),clean(body.customerPhone),clean(body.sourceCreatedAt||body.createdAt),clean(body.customerVat)]))}`;
  return {source,sourceKey:identity,sourceIdentity:identity,sourceFingerprint:hash(JSON.stringify(body)),originalId,messageId,sheetId,row,sheetName};
}

export default async function handler(request:VercelRequest,response:VercelResponse){
  if(request.method!=="POST")return response.status(405).json({ok:false,error:"Method not allowed"});
  await ensureTrackingSchema();await ensureOperationsSchema();
  const configuredKey=clean(process.env.TRACKING_INGEST_KEY);if(configuredKey&&!safeSecretEquals(requestKey(request),configuredKey))return response.status(401).json({ok:false,error:"مفتاح مزامنة التتبع غير صحيح"});
  let body:any;try{body=requestBody(request)}catch{return response.status(400).json({ok:false,error:"صيغة JSON غير صحيحة"})}
  const orderNo=clean(body.orderNo||body.salesOrderNo);const item=body.item||{};const totals=body.totals||{};const itemNo=clean(item.no||item.itemNo)||"1";const rawVin=clean(item.vin||body.vin);const vin=rawVin||`PENDING-${orderNo}-${itemNo}`;
  if(!orderNo)return response.status(400).json({ok:false,error:"رقم طلب البيع مطلوب"});
  const source=sourceMeta(body,orderNo);const sql=getSql();
  const [deleted]=await sql<any[]>`select id::text from tracking.deleted_orders where source_key=${source.sourceKey} order by deleted_at desc limit 1`;
  if(deleted)return response.status(200).json({ok:true,ignored:true,deletedSource:true,orderNo,message:"تم تجاهل نسخة المصدر القديمة المحذوفة"});
  try{
    const result=await sql.begin(async tx=>{
      const [order]=await tx<any[]>`insert into tracking.orders(
        sales_order_no,customer_name,customer_mobile,customer_vat,branch,order_date,delivery_date,sales_person,
        subtotal_before_tax,tax_value,total_incl_vat,registration_fee,source,source_payload,source_updated_at,is_deleted,updated_at,
        source_key,source_identity,source_fingerprint,source_row_number,source_sheet_id,source_sheet_name,source_message_id,source_original_id
      ) values(
        ${orderNo},${clean(body.customerName)||null},${clean(body.customerPhone)||null},${clean(body.customerVat)||null},${clean(body.branch)||null},
        ${dateValue(body.orderDate)},${dateValue(body.deliveryDate)},${clean(body.salesPerson)||null},${numberValue(totals.subtotalBeforeTax)},
        ${numberValue(totals.carTaxValue)},${numberValue(totals.grandTotal||totals.carTotalInclVAT)},${numberValue(totals.registrationFee)},
        ${source.source},${tx.json(body)},now(),false,now(),${source.sourceKey},${source.sourceIdentity},${source.sourceFingerprint},${source.row||null},${source.sheetId||null},${source.sheetName||null},${source.messageId||null},${source.originalId||null}
      ) on conflict(source_key) where source_key is not null do update set
        sales_order_no=excluded.sales_order_no,customer_name=coalesce(excluded.customer_name,tracking.orders.customer_name),customer_mobile=coalesce(excluded.customer_mobile,tracking.orders.customer_mobile),
        customer_vat=coalesce(excluded.customer_vat,tracking.orders.customer_vat),branch=coalesce(excluded.branch,tracking.orders.branch),order_date=coalesce(excluded.order_date,tracking.orders.order_date),
        delivery_date=coalesce(excluded.delivery_date,tracking.orders.delivery_date),sales_person=coalesce(excluded.sales_person,tracking.orders.sales_person),
        source_payload=excluded.source_payload,source_updated_at=now(),source_fingerprint=excluded.source_fingerprint,is_deleted=false,updated_at=now()
      returning *,id::text`;
      let [vehicle]=await tx<any[]>`select *,id::text from tracking.order_vehicles where order_id=${order.id}::uuid and ((item_no is not null and item_no=${itemNo}) or vin=${vin}) order by case when item_no=${itemNo} then 0 else 1 end limit 1`;
      const values={carName:[clean(item.type),clean(item.category),clean(item.model)].filter(Boolean).join(" "),qty:numberValue(item.qty)||1,unitPrice:numberValue(item.unitPrice),itemValue:numberValue(item.value),subtotal:numberValue(totals.carSubtotalExclVAT),tax:numberValue(totals.carTaxValue),total:numberValue(totals.carTotalInclVAT),registrationFee:numberValue(totals.registrationFee)};
      const [operationsVehicle]=rawVin?await tx<any[]>`select id::text from operations.vehicles where vin=${rawVin} and is_deleted=false limit 1`:[];
      if(vehicle){[vehicle]=await tx<any[]>`update tracking.order_vehicles set vin=${vin},item_no=${itemNo},car_name=${values.carName||null},item_type=${clean(item.type)||null},item_category=${clean(item.category)||null},item_model=${clean(item.model)||null},interior_color=${clean(item.interiorColor)||null},exterior_color=${clean(item.exteriorColor)||null},dealer=${clean(item.dealer)||null},qty=${values.qty},unit_price=${values.unitPrice},item_value=${values.itemValue},subtotal_excl_vat=${values.subtotal},tax_value=${values.tax},total_incl_vat=${values.total},registration_fee=${values.registrationFee},raw_payload=${tx.json(body)},operations_vehicle_id=${operationsVehicle?.id||null},updated_at=now() where id=${vehicle.id}::uuid returning *,id::text`;}
      else{[vehicle]=await tx<any[]>`insert into tracking.order_vehicles(order_id,vin,item_no,car_name,item_type,item_category,item_model,interior_color,exterior_color,dealer,qty,unit_price,item_value,subtotal_excl_vat,tax_value,total_incl_vat,registration_fee,raw_payload,operations_vehicle_id,updated_at) values(${order.id}::uuid,${vin},${itemNo},${values.carName||null},${clean(item.type)||null},${clean(item.category)||null},${clean(item.model)||null},${clean(item.interiorColor)||null},${clean(item.exteriorColor)||null},${clean(item.dealer)||null},${values.qty},${values.unitPrice},${values.itemValue},${values.subtotal},${values.tax},${values.total},${values.registrationFee},${tx.json(body)},${operationsVehicle?.id||null},now()) returning *,id::text`;}
      await tx`update tracking.orders o set subtotal_before_tax=coalesce(x.subtotal_before_tax,0),tax_value=coalesce(x.tax_value,0),total_incl_vat=coalesce(x.total_incl_vat,0),registration_fee=coalesce(x.registration_fee,0),updated_at=now() from(select order_id,sum(subtotal_excl_vat)+max(registration_fee) subtotal_before_tax,sum(tax_value) tax_value,sum(total_incl_vat)+max(registration_fee) total_incl_vat,max(registration_fee) registration_fee from tracking.order_vehicles where order_id=${order.id}::uuid group by order_id)x where o.id=x.order_id`;
      await tx`insert into integrations.inbound_events(source,event_key,event_type,payload,status,processed_at) values(${source.source},${`${source.sourceKey}:${itemNo}`},'tracking_order_upsert',${tx.json(body)},'processed',now()) on conflict(source,event_key) do update set payload=excluded.payload,status='processed',error_message=null,processed_at=now()`;
      return{order,vehicle};
    });
    await ensureVehicleStageRows(result.vehicle.id);return response.status(200).json({ok:true,orderId:result.order.id,vehicleId:result.vehicle.id,orderNo,vin:rawVin,message:"تم استلام طلب التتبع وحفظه في المنصة"});
  }catch(error){console.error("Tracking ingest failed",error);return response.status(500).json({ok:false,error:"تعذر حفظ طلب التتبع في المنصة"})}
}
