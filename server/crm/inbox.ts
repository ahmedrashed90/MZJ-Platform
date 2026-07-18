import type { VercelRequest,VercelResponse } from "@vercel/node";
import { clean,isCrmManager,parseBody,requireCrmUser,userScope } from "../_crm-utils.js";
import { classifyConversationService } from "../_crm-lifecycle.js";
import { getSql } from "../_db.js";
export default async function handler(request:VercelRequest,response:VercelResponse){
  const user=await requireCrmUser(request,response);if(!user)return;const sql=getSql();
  if(request.method==="GET"){
    const scope=userScope(user),state=clean(request.query.state),channel=clean(request.query.channel),search=clean(request.query.search);const like=`%${search}%`;
    const rows=await sql<any[]>`
      select c.*,c.id::text,c.lead_id::text,c.contact_id::text,c.service_request_id::text,ct.primary_phone,ct.primary_phone_normalized,
        l.customer_name as lead_customer_name,l.assigned_to::text,l.call_center_assigned_to::text,sales.full_name as assigned_name
      from crm.conversations c join crm.contacts ct on ct.id=c.contact_id left join crm.leads l on l.id=c.lead_id left join core.users sales on sales.id=c.assigned_to
      where (${state}='' or c.classification_state=${state}) and (${channel}='' or c.channel_code=${channel})
        and (${search}='' or coalesce(c.customer_name,'') ilike ${like} or coalesce(ct.primary_phone,'') ilike ${like} or coalesce(c.preview_text,'') ilike ${like})
        and (${scope.all} or c.assigned_to=${user.id}::uuid or c.call_center_assigned_to=${user.id}::uuid)
      order by c.last_message_at desc nulls last limit 300
    `;
    return response.status(200).json({ok:true,rows});
  }
  if(request.method==="POST"){
    if(!isCrmManager(user))return response.status(403).json({ok:false,error:"تصنيف المحادثات غير المحددة متاح للإدارة فقط"});
    const body=parseBody(request),conversationId=clean(body.conversationId),serviceKey=clean(body.serviceKey);if(!conversationId||!serviceKey)return response.status(400).json({ok:false,error:"المحادثة والخدمة مطلوبتان"});
    const result=await classifyConversationService({conversationId,serviceKey,sourceCode:clean(body.sourceCode),classificationMethod:"manual",actor:user,eventKey:`manual-classification:${conversationId}:${Date.now()}`});
    return response.status(200).json({ok:true,result});
  }
  return response.status(405).json({ok:false,error:"Method not allowed"});
}
