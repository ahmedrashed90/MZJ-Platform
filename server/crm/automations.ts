import type { VercelRequest,VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { audit,clean,isCrmManager,parseBody,requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { previewAutomationRule,processDueAutomationJobs,publishAutomationEvent } from "../_crm-automation.js";

function array(value:unknown){return Array.isArray(value)?value:[];}
export default async function handler(request:VercelRequest,response:VercelResponse){
  const user=await requireCrmUser(request,response);if(!user)return;
  const sql=getSql();
  if(request.method==="GET"){
    const [settings]=await sql<any[]>`select * from crm.automation_settings where id='default'`;
    const rules=await sql<any[]>`select *,id::text,created_by::text,updated_by::text from crm.automation_rules order by priority,created_at`;
    const runs=await sql<any[]>`select r.*,r.id::text,r.event_id::text,r.rule_id::text,r.contact_id::text,r.conversation_id::text,r.service_request_id::text,r.lead_id::text,ar.name as rule_name,ar.rule_key from crm.automation_runs r left join crm.automation_rules ar on ar.id=r.rule_id order by r.started_at desc limit 150`;
    const jobs=await sql<any[]>`select *,id::text,contact_id::text,conversation_id::text,service_request_id::text,lead_id::text,trigger_message_id::text from crm.automation_jobs order by created_at desc limit 100`;
    return response.status(200).json({ok:true,settings,rules,runs,jobs});
  }
  if(!isCrmManager(user))return response.status(403).json({ok:false,error:"إدارة الأوتوميشن متاحة للإدارة فقط"});
  const body=parseBody(request),action=clean(body.action),section=clean(body.section);
  if(request.method==="POST"&&action==="preview")return response.status(200).json({ok:true,rows:await previewAutomationRule({ruleId:clean(body.ruleId)||undefined,eventType:clean(body.eventType)||undefined,payload:body.payload||{},conversationId:clean(body.conversationId)||undefined})});
  if(request.method==="POST"&&action==="process_due")return response.status(200).json({ok:true,...await processDueAutomationJobs(100)});
  if(request.method==="POST"&&action==="test_event")return response.status(200).json(await publishAutomationEvent({eventKey:`manual-test:${crypto.randomUUID()}`,eventType:clean(body.eventType),source:"manual_test",conversationId:clean(body.conversationId)||null,leadId:clean(body.leadId)||null,payload:body.payload||{},actor:user}));
  if(section==="settings"&&["PUT","PATCH","POST"].includes(request.method||"")){
    const serviceOptions=array(body.serviceOptions).map((item:any)=>({key:clean(item.key),label:clean(item.label),aliases:array(item.aliases).map(clean).filter(Boolean)})).filter((item:any)=>item.key&&item.label);
    const [row]=await sql<any[]>`
      update crm.automation_settings set service_selection_enabled=${body.serviceSelectionEnabled!==false},service_selection_message=${clean(body.serviceSelectionMessage)},
        service_options=${sql.json(serviceOptions)},ask_for_branch=false,no_match_behavior=${clean(body.noMatchBehavior)||"wait"},unclassified_label=${clean(body.unclassifiedLabel)||"بانتظار اختيار الخدمة"},
        closed_statuses=${sql.json(body.closedStatuses||{})},updated_by=${user.id}::uuid,updated_at=now() where id='default' returning *
    `;
    await audit(user,"automation_settings_updated","automation_settings","default",row);return response.status(200).json({ok:true,row});
  }
  if(section==="rule"){
    const id=clean(body.id);
    if(request.method==="DELETE"||action==="delete"){
      if(!id)return response.status(400).json({ok:false,error:"رقم القاعدة مطلوب"});
      await sql`delete from crm.automation_rules where id=${id}::uuid`;await audit(user,"automation_rule_deleted","automation_rule",id);return response.status(200).json({ok:true});
    }
    const ruleKey=clean(body.ruleKey||body.rule_key).toLowerCase().replace(/[^a-z0-9_-]+/g,"-");const name=clean(body.name),trigger=clean(body.triggerEvent||body.trigger_event);
    if(!ruleKey||!name||!trigger)return response.status(400).json({ok:false,error:"اسم وكود ومحفز القاعدة مطلوبة"});
    const [row]=await sql<any[]>`
      insert into crm.automation_rules(id,rule_key,name,description,trigger_event,priority,is_active,run_mode,conditions,actions,stop_after_match,max_runs_per_entity,created_by,updated_by,updated_at)
      values(coalesce(${id||null}::uuid,gen_random_uuid()),${ruleKey},${name},${clean(body.description)||null},${trigger},${Number(body.priority||100)},${body.isActive!==false},${clean(body.runMode)||"automatic"},
        ${sql.json(array(body.conditions))},${sql.json(array(body.actions))},${body.stopAfterMatch===true},${Number(body.maxRunsPerEntity||1)},${user.id}::uuid,${user.id}::uuid,now())
      on conflict(rule_key) do update set name=excluded.name,description=excluded.description,trigger_event=excluded.trigger_event,priority=excluded.priority,is_active=excluded.is_active,run_mode=excluded.run_mode,
        conditions=excluded.conditions,actions=excluded.actions,stop_after_match=excluded.stop_after_match,max_runs_per_entity=excluded.max_runs_per_entity,updated_by=excluded.updated_by,updated_at=now()
      returning *,id::text
    `;
    await audit(user,"automation_rule_saved","automation_rule",row.id,row);return response.status(200).json({ok:true,row});
  }
  return response.status(405).json({ok:false,error:"الإجراء غير مدعوم"});
}
