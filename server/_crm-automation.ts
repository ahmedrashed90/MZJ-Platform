import crypto from "node:crypto";
import type { SessionUser } from "./_auth.js";
import { clean, departmentKey, normalizePhone } from "./_crm-utils.js";
import { classifyConversationService, closeCurrentServiceRequest } from "./_crm-lifecycle.js";
import { deliverConversationMessage, deliverDirectWhatsapp } from "./_crm-messaging.js";
import { getSql } from "./_db.js";

export type AutomationEventInput = {
  eventKey: string;
  eventType: string;
  source?: string;
  contactId?: string | null;
  conversationId?: string | null;
  serviceRequestId?: string | null;
  leadId?: string | null;
  payload?: Record<string, unknown>;
  actor?: SessionUser | null;
};

type Rule = { id:string; rule_key:string; name:string; trigger_event:string; priority:number; is_active:boolean; run_mode:string; conditions:any[]; actions:any[]; stop_after_match:boolean; max_runs_per_entity:number };

function valueAt(context: any, path: string) {
  return String(path || "").split(".").reduce((value, key) => value == null ? undefined : value[key], context);
}
function normalizedText(value: unknown) { return clean(value).toLowerCase().replace(/[أإآ]/g,"ا").replace(/ة/g,"ه").replace(/[\s_-]+/g," "); }
function equals(a: unknown,b: unknown) { if(typeof b === "boolean") return Boolean(a)===b; if(typeof b === "number") return Number(a)===b; return normalizedText(a)===normalizedText(b); }
function conditionMatches(condition: any, context: any) {
  const actual = valueAt(context, clean(condition?.field)); const expected = condition?.value; const op=clean(condition?.operator||"eq");
  if(op==="eq") return equals(actual,expected);
  if(op==="neq") return !equals(actual,expected);
  if(op==="exists") return expected === false ? actual == null || actual === "" : actual != null && actual !== "";
  if(op==="in") return Array.isArray(expected) && expected.some((item)=>equals(actual,item));
  if(op==="contains") return normalizedText(actual).includes(normalizedText(expected));
  if(op==="gt") return Number(actual)>Number(expected);
  if(op==="gte") return Number(actual)>=Number(expected);
  return false;
}
function conditionsMatch(conditions: any[], context: any) { return !Array.isArray(conditions) || conditions.every((condition)=>conditionMatches(condition,context)); }

async function loadContext(event: any) {
  const sql=getSql();
  const [conversation]=event.conversation_id ? await sql<any[]>`
    select c.*,c.id::text,c.contact_id::text,c.lead_id::text,c.service_request_id::text,
      exists(select 1 from crm.service_requests r where r.contact_id=c.contact_id and r.request_state='open') as has_open_request,
      l.phone,l.phone_normalized,l.customer_name as lead_customer_name,l.status_label,l.source_code,l.source_name,l.platform_code,
      u.full_name as assigned_name
    from crm.conversations c left join crm.leads l on l.id=c.lead_id left join core.users u on u.id=c.assigned_to
    where c.id=${event.conversation_id}::uuid limit 1
  ` : [];
  const [request]=event.service_request_id ? await sql<any[]>`select *,id::text,contact_id::text,lead_id::text,conversation_id::text,assigned_to::text,call_center_assigned_to::text from crm.service_requests where id=${event.service_request_id}::uuid` : conversation?.contact_id ? await sql<any[]>`select *,id::text,contact_id::text,lead_id::text,conversation_id::text,assigned_to::text,call_center_assigned_to::text from crm.service_requests where contact_id=${conversation.contact_id}::uuid and request_state='open' order by opened_at desc limit 1` : [];
  const payload=event.payload||{};
  return {
    event:{...payload,type:event.event_type,direction:payload.direction||"",senderType:payload.senderType||payload.sender_type||"",text:payload.text||payload.body||""},
    conversation: conversation ? {...conversation,hasOpenRequest:Boolean(conversation.has_open_request),serviceSelectionSent:Boolean(conversation.service_selection_sent_at),classificationState:conversation.classification_state} : {hasOpenRequest:false,serviceSelectionSent:false,classificationState:""},
    request:request||null,
    payload,
  };
}

async function getAutomationSettings() {
  const sql=getSql();
  const [settings]=await sql<any[]>`select * from crm.automation_settings where id='default'`;
  return settings||{};
}

export function detectServiceChoice(text: unknown, options: any[]) {
  const normalized=normalizedText(text);
  if(!normalized) return "";
  for(const option of Array.isArray(options)?options:[]) {
    const aliases=[option?.key,option?.label,...(Array.isArray(option?.aliases)?option.aliases:[])].map(normalizedText).filter(Boolean);
    if(aliases.some((alias)=>normalized===alias || normalized.includes(alias))) return departmentKey(option?.key||option?.label);
  }
  return "";
}

async function sendServiceSelection(event:any, context:any) {
  const settings=await getAutomationSettings();
  if(settings.service_selection_enabled===false || !event.conversation_id) return {skipped:true,reason:"selection_disabled_or_no_conversation"};
  if(context.conversation?.hasOpenRequest || context.conversation?.serviceSelectionSent) return {skipped:true,reason:"already_classified_or_sent"};
  const text=clean(settings.service_selection_message);
  if(!text) return {skipped:true,reason:"empty_selection_message"};
  const options=Array.isArray(settings.service_options)?settings.service_options:[];
  const buttons=options.slice(0,3).map((option:any)=>({id:clean(option?.key),title:clean(option?.label)})).filter((button:any)=>button.id&&button.title);
  const result=await deliverConversationMessage({conversationId:event.conversation_id,text,senderType:"bot",idempotencyKey:`service-selection:${event.conversation_id}:${event.id}`,reason:"service_selection",buttons});
  const sql=getSql();
  await sql`update crm.conversations set classification_state='awaiting_service',service_selection_sent_at=now(),service_selection_version=service_selection_version+1,updated_at=now() where id=${event.conversation_id}::uuid`;
  return {ok:true,providerStatus:result.providerStatus};
}

async function classifyFromMessage(event:any,context:any,actor?:SessionUser|null) {
  if(!event.conversation_id) return {skipped:true,reason:"no_conversation"};
  const settings=await getAutomationSettings();
  const choice=detectServiceChoice(context.event.text,settings.service_options||[]);
  if(!choice) return {skipped:true,reason:"no_service_match"};
  const result=await classifyConversationService({conversationId:event.conversation_id,serviceKey:choice,sourceCode:event.source||context.conversation?.channel_code,classificationMethod:"customer_selection",actor,eventKey:event.event_key});
  return {ok:true,serviceKey:choice,reused:result.reused,requestId:result.request?.id,leadId:result.leadId};
}

function jobKey(type:string,conversationId:string,messageId:string,attempt:number) { return `${type}:${conversationId}:${messageId}:${attempt}`; }

type AutomationJobRow = {
  id:string;
  idempotency_key:string;
  job_type:string;
  status:string;
  due_at:string|Date;
  scheduler_status?:string|null;
  processed_at?:string|Date|null;
  [key:string]:unknown;
};

function schedulerUrl() { return clean(process.env.AUTOMATION_SCHEDULER_URL).replace(/\/+$/,""); }
function schedulerSecret() { return clean(process.env.AUTOMATION_SCHEDULER_SECRET); }

async function scheduleAutomationWakeup(job:AutomationJobRow) {
  if(!job?.id) throw new Error("automation_job_id_missing");
  if(job.status!=="queued") return {skipped:true,reason:"job_not_queued"};
  const base=schedulerUrl();
  const secret=schedulerSecret();
  if(!base||!secret) {
    const sql=getSql();
    await sql`update crm.automation_jobs set scheduler_status='failed',scheduler_error='AUTOMATION_SCHEDULER_URL/AUTOMATION_SCHEDULER_SECRET missing',updated_at=now() where id=${job.id}::uuid`;
    throw new Error("AUTOMATION_SCHEDULER_URL و AUTOMATION_SCHEDULER_SECRET مطلوبان لتشغيل المهام المؤجلة بدون Vercel Cron");
  }
  const dueAt=new Date(job.due_at);
  if(Number.isNaN(dueAt.getTime())) throw new Error("automation_job_due_at_invalid");
  const payload={jobId:job.id,dueAt:dueAt.toISOString(),eventId:`automation-job:${job.id}:${dueAt.toISOString()}`};
  try {
    const response=await fetch(`${base}/schedule`,{
      method:"POST",
      headers:{"content-type":"application/json","x-mzj-automation-secret":secret},
      body:JSON.stringify(payload),
    });
    const raw=await response.text();
    let data:any;try{data=JSON.parse(raw)}catch{data={raw}}
    if(!response.ok||data?.ok===false) throw new Error(clean(data?.error||data?.message||raw)||`scheduler_http_${response.status}`);
    const sql=getSql();
    await sql`update crm.automation_jobs set scheduler_status='scheduled',scheduler_message_id=${clean(data?.messageId||data?.eventId)||payload.eventId},scheduler_error=null,scheduled_at=now(),updated_at=now() where id=${job.id}::uuid`;
    return {ok:true,eventId:data?.eventId||payload.eventId,dueAt:payload.dueAt};
  } catch(error:any) {
    const message=error?.message||String(error);
    const sql=getSql();
    await sql`update crm.automation_jobs set scheduler_status='failed',scheduler_error=${message},updated_at=now() where id=${job.id}::uuid`;
    throw error;
  }
}

async function loadAutomationJob(jobId:string) {
  const sql=getSql();
  const [job]=await sql<AutomationJobRow[]>`select *,id::text,contact_id::text,conversation_id::text,service_request_id::text,lead_id::text,trigger_message_id::text from crm.automation_jobs where id=${jobId}::uuid limit 1`;
  return job||null;
}

async function createAndScheduleJob(input:{
  idempotencyKey:string;jobType:string;contactId?:string|null;conversationId?:string|null;serviceRequestId?:string|null;leadId?:string|null;triggerMessageId?:string|null;attempt?:number;delaySeconds:number;payload?:Record<string,unknown>;
}) {
  const sql=getSql();
  const delay=Math.max(60,Math.round(Number(input.delaySeconds||60)));
  const [job]=await sql<AutomationJobRow[]>`
    insert into crm.automation_jobs(idempotency_key,job_type,contact_id,conversation_id,service_request_id,lead_id,trigger_message_id,status,attempt,due_at,payload,scheduler_status)
    values (${input.idempotencyKey},${input.jobType},${input.contactId||null}::uuid,${input.conversationId||null}::uuid,${input.serviceRequestId||null}::uuid,${input.leadId||null}::uuid,${input.triggerMessageId||null}::uuid,'queued',${Math.max(1,Number(input.attempt||1))},now()+(${delay}||' seconds')::interval,${sql.json((input.payload||{}) as any)},'pending')
    on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key
    returning *,id::text,contact_id::text,conversation_id::text,service_request_id::text,lead_id::text,trigger_message_id::text
  `;
  if(job?.status==="queued"&&!job.processed_at&&job.scheduler_status!=="scheduled") await scheduleAutomationWakeup(job);
  return job;
}

async function scheduleInboxAgent(event:any,context:any) {
  const sql=getSql();
  const conversationId=clean(event.conversation_id); const messageId=clean(event.payload?.messageId||event.payload?.message_id);
  if(!conversationId||!messageId) return {skipped:true,reason:"missing_conversation_or_message"};
  const [settings]=await sql<any[]>`select * from crm.inbox_agent_settings where id='default'`;
  if(!settings?.enabled) return {skipped:true,reason:"agent_disabled"};
  const channel=clean(context.conversation?.channel_code||event.source);
  if(channel!=="whatsapp") {
    const platforms=Array.isArray(settings.social_platforms)?settings.social_platforms:[];
    if(!settings.social_enabled || !platforms.includes(channel)) return {skipped:true,reason:"channel_not_enabled"};
  }
  const delay=Math.max(60,Number(settings.first_delay_seconds||240));
  const idempotency=jobKey("inbox_agent",conversationId,messageId,1);
  const job=await createAndScheduleJob({
    idempotencyKey:idempotency,
    jobType:"inbox_agent_check",
    contactId:context.conversation?.contact_id||event.contact_id||null,
    conversationId,
    serviceRequestId:context.request?.id||event.service_request_id||null,
    leadId:context.request?.lead_id||event.lead_id||null,
    triggerMessageId:messageId,
    attempt:1,
    delaySeconds:delay,
    payload:{customerMessageAt:event.payload?.createdAt||event.payload?.receivedAt||new Date().toISOString(),sourceEventKey:event.event_key},
  });
  return {ok:true,jobId:job?.id,dueInSeconds:delay};
}

async function cancelInboxAgent(event:any) {
  if(!event.conversation_id) return {skipped:true,reason:"no_conversation"};
  const sql=getSql();
  const rows=await sql<any[]>`update crm.automation_jobs set status='cancelled',scheduler_status='cancelled',processed_at=now(),updated_at=now() where conversation_id=${event.conversation_id}::uuid and job_type like 'inbox_agent%' and status='queued' returning id::text`;
  return {ok:true,cancelled:rows.length};
}

async function setConversationState(event:any,action:any) {
  if(!event.conversation_id) return {skipped:true,reason:"no_conversation"};
  const sql=getSql();
  await sql`update crm.conversations set classification_state=${clean(action?.state)||"new"},updated_at=now() where id=${event.conversation_id}::uuid`;
  return {ok:true,state:clean(action?.state)};
}

async function closeIfFinal(event:any,actor?:SessionUser|null) {
  const leadId=clean(event.lead_id||event.payload?.leadId); const status=clean(event.payload?.newStatus||event.payload?.statusLabel||event.payload?.status);
  if(!leadId||!status) return {skipped:true,reason:"missing_lead_or_status"};
  return closeCurrentServiceRequest({leadId,statusLabel:status,actor,reason:status});
}

async function executeAction(action:any,event:any,context:any,actor?:SessionUser|null) {
  switch(clean(action?.type)) {
    case "send_service_selection": return sendServiceSelection(event,context);
    case "set_conversation_state": return setConversationState(event,action);
    case "classify_service_from_message": return classifyFromMessage(event,context,actor);
    case "schedule_inbox_agent": return scheduleInboxAgent(event,await loadContext(event));
    case "cancel_inbox_agent": return cancelInboxAgent(event);
    case "close_request_if_final": return closeIfFinal(event,actor);
    default:return {skipped:true,reason:`unknown_action:${clean(action?.type)}`};
  }
}

export async function publishAutomationEvent(input:AutomationEventInput) {
  const sql=getSql();
  const eventKey=clean(input.eventKey); if(!eventKey) throw new Error("eventKey مطلوب لمنع تكرار الأوتوميشن");
  const [event]=await sql<any[]>`
    insert into crm.automation_events(event_key,event_type,source,contact_id,conversation_id,service_request_id,lead_id,payload,status)
    values (${eventKey},${clean(input.eventType)},${clean(input.source)||null},${input.contactId||null}::uuid,${input.conversationId||null}::uuid,
      ${input.serviceRequestId||null}::uuid,${input.leadId||null}::uuid,${sql.json((input.payload||{}) as any)},'received')
    on conflict(event_key) do update set event_key=excluded.event_key
    returning *,id::text,contact_id::text,conversation_id::text,service_request_id::text,lead_id::text
  `;
  if(event.status==="processed") return {ok:true,duplicate:true,eventId:event.id,runs:[]};
  const rules=await sql<Rule[]>`select *,id::text from crm.automation_rules where is_active=true and trigger_event=${event.event_type} order by priority,created_at`;
  const runs:any[]=[];
  for(const rule of rules) {
    const context=await loadContext(event);
    if(!conditionsMatch(rule.conditions,context)) { runs.push({ruleKey:rule.rule_key,status:"skipped",reason:"conditions_not_matched"}); continue; }
    const idempotency=`${event.event_key}:${rule.rule_key}`;
    const [run]=await sql<any[]>`
      insert into crm.automation_runs(idempotency_key,event_id,rule_id,contact_id,conversation_id,service_request_id,lead_id,status,trigger_payload)
      values (${idempotency},${event.id}::uuid,${rule.id}::uuid,${event.contact_id||null}::uuid,${event.conversation_id||null}::uuid,${event.service_request_id||null}::uuid,${event.lead_id||null}::uuid,'running',${sql.json(event.payload||{})})
      on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning *,id::text
    `;
    if(run.status!=="running" && run.finished_at) { runs.push({ruleKey:rule.rule_key,status:run.status,duplicate:true}); continue; }
    const results:any[]=[]; let status="success"; let errorMessage="";
    try {
      for(const action of Array.isArray(rule.actions)?rule.actions:[]) results.push({type:action?.type,...(await executeAction(action,event,context,input.actor))});
    } catch(error:any) { status="failed"; errorMessage=error?.message||String(error); }
    await sql`update crm.automation_runs set status=${status},action_results=${sql.json(results)},error_message=${errorMessage||null},finished_at=now() where id=${run.id}::uuid`;
    runs.push({ruleKey:rule.rule_key,status,results,error:errorMessage||undefined});
    if(status==="success" && rule.stop_after_match) break;
  }
  await sql`update crm.automation_events set status='processed',processed_at=now() where id=${event.id}::uuid`;
  return {ok:true,eventId:event.id,runs};
}

function withinBusinessHours(settings:any,date=new Date()) {
  if(!settings?.business_hours_only) return true;
  const offsetMinutes=180; const shifted=new Date(date.getTime()+offsetMinutes*60000);
  const now=shifted.getUTCHours()*60+shifted.getUTCMinutes();
  const parse=(v:any)=>{const [h,m]=String(v||"00:00").split(":").map(Number);return h*60+m;};
  const start=parse(settings.business_start),end=parse(settings.business_end);
  return start===end?true:start<end?(now>=start&&now<end):(now>=start||now<end);
}
function secondsUntilStart(settings:any,date=new Date()) { const offset=180; const shifted=new Date(date.getTime()+offset*60000); const now=shifted.getUTCHours()*60+shifted.getUTCMinutes(); const [h,m]=String(settings.business_start||"09:00").split(":").map(Number); let minutes=h*60+m-now;if(minutes<=0)minutes+=1440;return Math.max(60,minutes*60); }

async function addAgentLog(data:any) { const sql=getSql(); await sql`insert into crm.inbox_agent_logs(conversation_id,lead_id,action,reason,message_text,customer_name,customer_phone,branch_code,assigned_name,manager_name,metadata) values(${data.conversationId||null}::uuid,${data.leadId||null}::uuid,${data.action},${data.reason||null},${data.messageText||null},${data.customerName||null},${data.customerPhone||null},${data.branchCode||null},${data.assignedName||null},${data.managerName||null},${sql.json(data.metadata||{})})`; }

async function conversationForJob(job:any) { const sql=getSql(); const [row]=await sql<any[]>`
  select c.*,c.id::text,c.lead_id::text,c.contact_id::text,c.service_request_id::text,l.phone,l.phone_normalized,l.customer_name as lead_customer_name,
    u.full_name as assigned_name,r.request_state,r.branch_code as request_branch_code,r.department_code as request_department_code
  from crm.conversations c left join crm.leads l on l.id=c.lead_id left join core.users u on u.id=c.assigned_to left join crm.service_requests r on r.id=c.service_request_id
  where c.id=${job.conversation_id}::uuid limit 1`;
  return row||null;
}

async function branchManagerFor(conversation:any,settings:any) {
  const sql=getSql();
  const keys=[conversation.request_branch_code,conversation.branch_code,conversation.request_department_code,conversation.department_code,conversation.service_key,"__unassigned__","default"].map(clean).filter(Boolean);
  for(const key of keys){const [row]=await sql<any[]>`select * from crm.inbox_agent_managers where scope_code=${key} and is_active=true limit 1`;if(row)return row;}
  const fallback=normalizePhone(settings?.fallback_phone);
  return fallback?{manager_name:"مسؤول صندوق الوارد",whatsapp_phone:fallback,scope_code:"default"}:null;
}
function renderAgentAlert(template:any,fallback:string,conversation:any) {
  const raw=clean(template)||fallback;
  const values:Record<string,string>={
    customerName:conversation.lead_customer_name||conversation.customer_name||"-",
    customerPhone:conversation.phone||conversation.phone_normalized||"-",
    branchName:conversation.request_branch_code||conversation.branch_code||conversation.request_department_code||conversation.department_code||"-",
    assignedName:conversation.assigned_name||"غير محدد",
    lastMessageText:conversation.preview_text||"-",
  };
  return raw.replace(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g,(match:string,key:string)=>values[key]||match);
}

async function rescheduleJob(job:any,dueSeconds:number,payload:any={}) {
  const sql=getSql();
  const [updated]=await sql<AutomationJobRow[]>`update crm.automation_jobs set status='queued',scheduler_status='pending',scheduler_error=null,due_at=now()+(${Math.max(60,dueSeconds)}||' seconds')::interval,payload=coalesce(payload,'{}'::jsonb)||${sql.json(payload)},updated_at=now() where id=${job.id}::uuid returning *,id::text,contact_id::text,conversation_id::text,service_request_id::text,lead_id::text,trigger_message_id::text`;
  if(updated) await scheduleAutomationWakeup(updated);
}

async function finishJob(job:any,status:string,error?:string) { const sql=getSql(); await sql`update crm.automation_jobs set status=${status},scheduler_status=${status},error_message=${error||null},processed_at=now(),updated_at=now() where id=${job.id}::uuid`; }

async function processInboxAgentJob(job:any) {
  const sql=getSql(); const [settings]=await sql<any[]>`select * from crm.inbox_agent_settings where id='default'`; const conversation=await conversationForJob(job);
  if(!settings?.enabled||!conversation) return finishJob(job,"skipped","agent_disabled_or_conversation_missing");
  if(conversation.status==="closed"||conversation.request_state!=="open") return finishJob(job,"skipped","conversation_or_request_closed");
  if(!withinBusinessHours(settings)) return rescheduleJob(job,secondsUntilStart(settings),{rescheduledReason:"outside_business_hours"});
  const [trigger]=job.trigger_message_id?await sql<any[]>`select *,id::text from crm.messages where id=${job.trigger_message_id}::uuid`:[];
  const triggerAt=new Date(trigger?.created_at||job.payload?.customerMessageAt||job.created_at).getTime();
  if(!triggerAt) return finishJob(job,"skipped","trigger_missing");
  const latestCustomer=new Date(conversation.last_customer_message_at||0).getTime();
  if(latestCustomer>triggerAt+1000) return finishJob(job,"skipped","newer_customer_message");
  const humanAt=new Date(conversation.last_human_reply_at||0).getTime();
  if(humanAt>triggerAt) return finishJob(job,"cancelled","human_reply_detected");
  const stopWords=Array.isArray(settings.stop_keywords)?settings.stop_keywords:[]; const lastText=normalizedText(conversation.preview_text);
  if(stopWords.some((word:any)=>lastText.includes(normalizedText(word)))) return finishJob(job,"cancelled","customer_stop_keyword");
  const attempt=Number(job.attempt||1); const max=Math.max(1,Number(settings.max_bot_messages||2));
  if(attempt<=max) {
    const replies=Array.isArray(settings.replies)&&settings.replies.length?settings.replies:["تم استلام رسالتك وسيقوم المختص بالرد عليك قريبًا."];
    const text=String(replies[Math.min(attempt-1,replies.length-1)]).replace(/{{customerName}}/g,conversation.lead_customer_name||conversation.customer_name||"عميلنا الكريم").replace(/{{agentName}}/g,conversation.assigned_name||"المختص");
    const result=await deliverConversationMessage({conversationId:conversation.id,text,senderType:"bot",idempotencyKey:`inbox-agent:${job.id}:${attempt}`,reason:"no_human_reply"});
    await addAgentLog({conversationId:conversation.id,leadId:conversation.lead_id,action:"bot_reply",reason:"no_human_reply_after_delay",messageText:text,customerName:conversation.lead_customer_name||conversation.customer_name,customerPhone:conversation.phone||conversation.phone_normalized,branchCode:conversation.request_branch_code||conversation.branch_code,assignedName:conversation.assigned_name,metadata:{attempt,providerStatus:result.providerStatus}});
    await finishJob(job,"processed");
    const delay=Math.max(60,Number(settings.between_replies_seconds||120)); const nextAttempt=attempt+1; const key=jobKey("inbox_agent",conversation.id,job.trigger_message_id,nextAttempt);
    await createAndScheduleJob({idempotencyKey:key,jobType:"inbox_agent_check",contactId:conversation.contact_id||null,conversationId:conversation.id,serviceRequestId:conversation.service_request_id||null,leadId:conversation.lead_id||null,triggerMessageId:job.trigger_message_id||null,attempt:nextAttempt,delaySeconds:delay,payload:job.payload||{}});
    return;
  }
  if(settings.escalate_to_branch_manager!==false) {
    const manager=await branchManagerFor(conversation,settings);
    if(manager?.whatsapp_phone) {
      const alert=renderAgentAlert(
        settings.branch_escalation_template,
        `تنبيه من وكيل صندوق الوارد\n\nيوجد عميل لم يتم الرد عليه.\n\nالعميل: {{customerName}}\nالجوال: {{customerPhone}}\nالقسم: {{branchName}}\nالمندوب: {{assignedName}}\nآخر رسالة: {{lastMessageText}}`,
        conversation,
      );
      await deliverDirectWhatsapp({phone:manager.whatsapp_phone,text:alert,idempotencyKey:`inbox-branch-escalation:${job.trigger_message_id}`,reason:"inbox_agent_branch_escalation"});
      await addAgentLog({conversationId:conversation.id,leadId:conversation.lead_id,action:"branch_manager_escalation",reason:"max_bot_replies_reached",messageText:alert,customerName:conversation.lead_customer_name,customerPhone:conversation.phone||conversation.phone_normalized,branchCode:conversation.request_branch_code||conversation.branch_code,assignedName:conversation.assigned_name,managerName:manager.manager_name});
    }
  }
  await finishJob(job,"processed");
  if(settings.escalate_to_sales_manager!==false&&normalizePhone(settings.sales_manager_phone)) {
    const delay=Math.max(60,Number(settings.sales_manager_delay_seconds||300));
    await createAndScheduleJob({idempotencyKey:`inbox-sales-escalation:${job.trigger_message_id}`,jobType:"inbox_agent_sales_escalation",contactId:conversation.contact_id||null,conversationId:conversation.id,serviceRequestId:conversation.service_request_id||null,leadId:conversation.lead_id||null,triggerMessageId:job.trigger_message_id||null,attempt:1,delaySeconds:delay,payload:job.payload||{}});
  }
}

async function processSalesEscalation(job:any) {
  const sql=getSql(); const [settings]=await sql<any[]>`select * from crm.inbox_agent_settings where id='default'`; const conversation=await conversationForJob(job);
  if(!settings?.enabled||!conversation) return finishJob(job,"skipped","agent_disabled_or_conversation_missing");
  if(!withinBusinessHours(settings)) return rescheduleJob(job,secondsUntilStart(settings),{rescheduledReason:"outside_business_hours"});
  const [trigger]=job.trigger_message_id?await sql<any[]>`select created_at from crm.messages where id=${job.trigger_message_id}::uuid`:[]; const triggerAt=new Date(trigger?.created_at||job.created_at).getTime(); const humanAt=new Date(conversation.last_human_reply_at||0).getTime();
  if(humanAt>triggerAt) return finishJob(job,"cancelled","human_reply_detected");
  const phone=normalizePhone(settings.sales_manager_phone); if(!phone)return finishJob(job,"skipped","sales_manager_phone_missing");
  const alert=`تنبيه تصعيد من وكيل صندوق الوارد\n\nما زال العميل بدون رد بشري.\nالعميل: ${conversation.lead_customer_name||conversation.customer_name||"-"}\nالجوال: ${conversation.phone||conversation.phone_normalized||"-"}\nالمندوب: ${conversation.assigned_name||"غير محدد"}\nآخر رسالة: ${conversation.preview_text||"-"}`;
  await deliverDirectWhatsapp({phone,text:alert,idempotencyKey:`inbox-sales-send:${job.trigger_message_id}`,reason:"inbox_agent_sales_escalation"});
  await addAgentLog({conversationId:conversation.id,leadId:conversation.lead_id,action:"sales_manager_escalation",reason:"no_human_reply_after_branch_escalation",messageText:alert,customerName:conversation.lead_customer_name,customerPhone:conversation.phone||conversation.phone_normalized,assignedName:conversation.assigned_name,managerName:settings.sales_manager_name||"مدير المبيعات"});
  await finishJob(job,"processed");
}

async function executeAutomationJob(job:any) {
  const sql=getSql();
  const claimed=await sql<any[]>`update crm.automation_jobs set status='processing',scheduler_status='processing',updated_at=now() where id=${job.id}::uuid and status='queued' returning id::text`;
  if(!claimed.length) return {id:job.id,status:"skipped",reason:"already_claimed_or_finished"};
  try {
    if(job.job_type==="inbox_agent_check") await processInboxAgentJob(job);
    else if(job.job_type==="inbox_agent_sales_escalation") await processSalesEscalation(job);
    else await finishJob(job,"skipped","unknown_job_type");
    return {id:job.id,status:"ok"};
  } catch(error:any) {
    await finishJob(job,"failed",error?.message||String(error));
    return {id:job.id,status:"failed",error:error?.message||String(error)};
  }
}

export async function processAutomationJobById(jobId:string) {
  const job=await loadAutomationJob(clean(jobId));
  if(!job) return {processed:0,status:"skipped",reason:"job_not_found"};
  if(job.status!=="queued") return {processed:0,status:"skipped",reason:`job_${job.status}`};
  const dueAt=new Date(job.due_at).getTime();
  if(Number.isFinite(dueAt)&&dueAt>Date.now()+1500) {
    await scheduleAutomationWakeup({...job,scheduler_status:"pending"});
    return {processed:0,status:"rescheduled",reason:"job_not_due",dueAt:new Date(dueAt).toISOString()};
  }
  return {processed:1,result:await executeAutomationJob(job)};
}

export async function processDueAutomationJobs(limit=50) {
  const sql=getSql();
  const jobs=await sql<any[]>`select *,id::text,contact_id::text,conversation_id::text,service_request_id::text,lead_id::text,trigger_message_id::text from crm.automation_jobs where status='queued' and due_at<=now() order by due_at for update skip locked limit ${Math.max(1,Math.min(200,limit))}`;
  const results:any[]=[];
  for(const job of jobs) results.push(await executeAutomationJob(job));
  return {processed:jobs.length,results};
}

export async function retryAutomationJobSchedule(jobId:string) {
  const job=await loadAutomationJob(clean(jobId));
  if(!job) return {ok:false,reason:"job_not_found"};
  if(job.status!=="queued") return {ok:false,reason:`job_${job.status}`};
  const result=await scheduleAutomationWakeup({...job,scheduler_status:"pending"});
  return {ok:true,result};
}

export async function previewAutomationRule(input:{ruleId?:string;eventType?:string;payload?:Record<string,unknown>;conversationId?:string}) {
  const sql=getSql(); const rules=input.ruleId?await sql<Rule[]>`select *,id::text from crm.automation_rules where id=${input.ruleId}::uuid`:await sql<Rule[]>`select *,id::text from crm.automation_rules where trigger_event=${clean(input.eventType)} order by priority`;
  const fake={event_type:clean(input.eventType),conversation_id:input.conversationId||null,payload:input.payload||{}}; const context=await loadContext(fake);
  return rules.map((rule)=>({id:rule.id,ruleKey:rule.rule_key,name:rule.name,matches:conditionsMatch(rule.conditions,context),conditions:rule.conditions,actions:rule.actions}));
}
