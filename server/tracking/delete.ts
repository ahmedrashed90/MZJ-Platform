import type { VercelRequest,VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { requirePermission } from "../_auth.js";
import { getSql } from "../_db.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { clean } from "../_tracking-utils.js";

export default async function handler(request:VercelRequest,response:VercelResponse){
 const requestId=`tracking-delete-${Date.now().toString(36)}-${randomUUID().slice(0,8)}`;
 try{
  await ensureTrackingSchema();await ensureOperationsSchema();const user=await requirePermission(request,response,"tracking.orders.delete");if(!user)return;const sql=getSql();
  if(request.method==="GET"){const deleted=await sql<any[]>`select id::text,order_internal_id::text,sales_order_no,customer_name,customer_mobile,reason,deleted_by_name,deleted_at,source_key from tracking.deleted_orders order by deleted_at desc limit 150`;return response.status(200).json({ok:true,deleted})}
  if(request.method!=="POST")return response.status(405).json({ok:false,error:"Method not allowed"});
  const body=typeof request.body==="string"?JSON.parse(request.body||"{}"):request.body||{};const action=clean(body.action);if(action!=="delete")return response.status(400).json({ok:false,code:"VALIDATION_ERROR",error:"الإجراء غير مدعوم",requestId});
  const orderId=clean(body.orderId),confirmation=clean(body.confirmation),reason=clean(body.reason);if(!orderId||!reason)return response.status(400).json({ok:false,code:"VALIDATION_ERROR",error:"اختر الطلب واكتب سبب الحذف",requestId});
  const result=await sql.begin(async tx=>{
    const [order]=await tx<any[]>`select *,id::text from tracking.orders where id=${orderId}::uuid and coalesce(is_deleted,false)=false for update`;
    if(!order){const error:any=new Error("الطلب غير موجود أو تم حذفه مسبقًا");error.status=404;error.code="TRACKING_REQUEST_NOT_FOUND";throw error}
    if(confirmation!==order.sales_order_no){const error:any=new Error("اكتب رقم الطلب كاملًا لتأكيد الحذف");error.status=400;error.code="VALIDATION_ERROR";throw error}
    const vehicles=await tx<any[]>`select *,id::text from tracking.order_vehicles where order_id=${orderId}::uuid order by item_no nulls last,created_at`;
    const ids=vehicles.map(v=>v.id);const stages=ids.length?await tx<any[]>`select vs.*,vs.id::text,s.code,s.name,s.sort_order from tracking.vehicle_stages vs join tracking.stages s on s.id=vs.stage_id where vs.vehicle_id in ${tx(ids)} order by s.sort_order`:[];
    const events=await tx<any[]>`select * from tracking.stage_events where order_id=${orderId}::uuid order by created_at`;
    const sms=await tx<any[]>`select * from tracking.sms_messages where order_id=${orderId}::uuid order by queued_at`;
    const snapshot={order,vehicles,stages,events,sms};
    await tx`insert into tracking.deleted_orders(order_internal_id,sales_order_no,customer_name,customer_mobile,reason,snapshot,source_payload,source_key,source_identity,source_fingerprint,deleted_by,deleted_by_name,deleted_by_email,deleted_by_role,request_id)
      values(${order.id}::uuid,${order.sales_order_no},${order.customer_name},${order.customer_mobile},${reason},${tx.json(snapshot)},${tx.json(order.source_payload||{})},${order.source_key},${order.source_identity},${order.source_fingerprint},${user.id}::uuid,${user.fullName},${user.email},${user.roles[0]||user.roleCodes[0]||null},${requestId})`;
    await tx`delete from tracking.sms_messages where order_id=${orderId}::uuid`;
    await tx`delete from tracking.orders where id=${orderId}::uuid`;
    await tx`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data) values(${user.id}::uuid,'tracking','order_deleted','tracking_order',${order.sales_order_no},${tx.json(snapshot)},${tx.json({reason,sourceKey:order.source_key,vehiclesRemainInOperations:true,requestId})})`;
    return{salesOrderNo:order.sales_order_no,vehicleCount:vehicles.length};
  });
  return response.status(200).json({ok:true,message:"تم مسح طلب التراكينج وفك ارتباط السيارات من المخزون بنجاح.",requestId,...result});
 }catch(error:any){console.error("Tracking delete failed",{requestId,error});return response.status(Number(error?.status||500)).json({ok:false,code:error?.code||"DATABASE_ERROR",error:error?.message||"تعذر مسح طلب التراكينج",requestId})}
}
