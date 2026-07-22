import { clean, normalizePhone } from "./_crm-utils.js";
import { classifyConversationService } from "./_crm-lifecycle.js";
import { deliverConversationMessage } from "./_crm-messaging.js";
import { getSql } from "./_db.js";

export type ConversationAutomationInput = {
  eventKey: string;
  providerMessageId?: string | null;
  platformCode: string;
  contactId: string;
  conversationId: string;
  messageId?: string | null;
  text?: string | null;
  payload?: Record<string, unknown>;
};

type SendResult = {
  ok: boolean;
  providerStatus: string;
  providerMessageId: string;
  httpStatus: number;
  errorMessage: string;
};

function normalizeChoice(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[✅🌹👨‍🔧👇🔥🏦🛠💰]/g, "")
    .replace(/[_\-–—|/\\]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function first(...values: unknown[]) {
  for (const value of values) {
    const normalized = clean(value);
    if (normalized) return normalized;
  }
  return "";
}

function ksaMobile(value: unknown) {
  const normalized = normalizePhone(value);
  return /^9665\d{8}$/.test(normalized) ? normalized : "";
}

function intervalMilliseconds(settings: any) {
  if (settings.trigger_policy === "once_24_hours") return 24 * 60 * 60 * 1000;
  if (settings.trigger_policy !== "custom") return 0;
  const value = Math.max(1, Number(settings.custom_interval_value || 1));
  const unit = clean(settings.custom_interval_unit);
  if (unit === "minute") return value * 60 * 1000;
  if (unit === "day") return value * 24 * 60 * 60 * 1000;
  return value * 60 * 60 * 1000;
}

async function loadPlatform(tx: any, platformCode: string) {
  let [platform] = await tx<any[]>`
    select p.*,p.id::text,e.is_active as worker_is_active,
      coalesce(nullif(e.text_send_url,''),nullif(e.send_url,'')) as worker_send_url,
      e.health_url as endpoint_health_url
    from crm.automation_platforms p
    left join crm.integration_endpoints e on e.source_code=p.worker_code
    where p.platform_code=${platformCode}
    limit 1
  `;
  if (!platform) {
    const [endpoint] = await tx<any[]>`
      select * from crm.integration_endpoints where source_code=${platformCode} limit 1
    `;
    if (!endpoint) return null;
    [platform] = await tx<any[]>`
      insert into crm.automation_platforms(platform_code,worker_code,is_enabled,connection_status,health_url,metadata)
      values(${platformCode},${endpoint.source_code},${endpoint.is_active},
        case when ${endpoint.is_active} and coalesce(nullif(${endpoint.text_send_url},''),nullif(${endpoint.send_url},'')) is not null then 'connected' else 'unknown' end,
        ${endpoint.health_url || null},jsonb_build_object('createdFromIntegrationEndpoint',true))
      on conflict(platform_code) do update set updated_at=now()
      returning *,id::text,${endpoint.is_active}::boolean as worker_is_active,
        coalesce(nullif(${endpoint.text_send_url},''),nullif(${endpoint.send_url},'')) as worker_send_url,
        ${endpoint.health_url || null}::text as endpoint_health_url
    `;
  }
  return platform;
}

async function loadSession(tx: any, conversationId: string) {
  const [session] = await tx<any[]>`
    select s.*,s.id::text,s.contact_id::text,s.conversation_id::text,s.flow_id::text,s.current_step_id::text,
      f.flow_code,f.display_name as flow_name,f.service_key,f.department_code,f.branch_policy,f.branch_code,
      f.final_action,f.final_message,f.button_payload
    from crm.automation_sessions s
    left join crm.automation_flows f on f.id=s.flow_id
    where s.conversation_id=${conversationId}::uuid
      and s.status in ('awaiting_service','awaiting_answer')
    order by s.started_at desc
    limit 1
    for update of s
  `;
  return session || null;
}

async function activeSessionForContact(tx: any, contactId: string) {
  const [row] = await tx<any[]>`
    select s.*,s.id::text,s.contact_id::text,s.conversation_id::text,s.flow_id::text,s.current_step_id::text
    from crm.automation_sessions s
    where s.contact_id=${contactId}::uuid and s.status in ('awaiting_service','awaiting_answer')
    order by s.started_at desc
    limit 1
    for update
  `;
  return row || null;
}

async function latestSession(tx: any, contactId: string) {
  const [row] = await tx<any[]>`
    select *,id::text from crm.automation_sessions
    where contact_id=${contactId}::uuid
    order by coalesce(completed_at,last_activity_at,started_at) desc
    limit 1
  `;
  return row || null;
}

async function retryableFailedFinalSession(tx: any, contactId: string, conversationId: string, sessionId?: string | null) {
  const [row] = await tx<any[]>`
    select s.*,s.id::text,s.contact_id::text,s.conversation_id::text,s.flow_id::text,s.current_step_id::text,
      f.flow_code,f.display_name as flow_name,f.service_key,f.department_code,f.branch_policy,f.branch_code,
      f.final_action,f.final_message,f.button_payload
    from crm.automation_sessions s
    join crm.automation_flows f on f.id=s.flow_id
    join crm.automation_final_actions a on a.session_id=s.id and a.status='failed'
    where s.status='failed' and s.contact_id=${contactId}::uuid and s.conversation_id=${conversationId}::uuid
      and (${clean(sessionId) || null}::uuid is null or s.id=${clean(sessionId) || null}::uuid)
    order by s.last_activity_at desc
    limit 1
    for update of s
  `;
  return row || null;
}

async function loadFlows(tx: any) {
  const flows = await tx<any[]>`
    select f.*,f.id::text,
      coalesce(json_agg(json_build_object(
        'id',a.id::text,'type',a.alias_type,'value',a.alias_value,'normalized',a.normalized_value
      ) order by a.created_at) filter(where a.id is not null),'[]'::json) as aliases
    from crm.automation_flows f
    left join crm.automation_flow_aliases a on a.flow_id=f.id
    where f.is_active=true
    group by f.id
    order by f.sort_order,f.display_name
  `;
  return flows;
}

function matchFlow(flows: any[], text: string, payload: Record<string, unknown>) {
  const payloadCandidates = [
    payload.payload,
    payload.buttonTitle,
    payload.button_title,
    payload.serviceSelectionKey,
    payload.service_selection_key,
    payload.serviceKey,
    payload.service_key,
  ].map(normalizeChoice).filter(Boolean);
  const textCandidate = normalizeChoice(text);
  const allCandidates = [...payloadCandidates, textCandidate].filter(Boolean);
  for (const flow of flows) {
    const direct = [flow.flow_code, flow.button_payload, flow.display_name, `${flow.emoji || ""} ${flow.display_name || ""}`]
      .map(normalizeChoice).filter(Boolean);
    if (allCandidates.some((candidate) => direct.some((accepted) => candidate === accepted || candidate.includes(accepted)))) return flow;

    const aliases = Array.isArray(flow.aliases) ? flow.aliases : [];
    for (const item of aliases) {
      const alias = normalizeChoice(item.normalized || item.value);
      if (!alias) continue;
      const aliasType = clean(item.type);
      if (aliasType === "number") {
        if (textCandidate === alias) return flow;
      } else if (aliasType === "payload") {
        if (payloadCandidates.includes(alias)) return flow;
      } else if (allCandidates.some((candidate) => candidate === alias || candidate.includes(alias))) {
        return flow;
      }
    }
  }
  return null;
}

async function loadStep(tx: any, stepId: string | null) {
  if (!stepId) return null;
  const [row] = await tx<any[]>`
    select *,id::text,flow_id::text from crm.automation_flow_steps where id=${stepId}::uuid limit 1
  `;
  return row || null;
}

async function firstStep(tx: any, flowId: string) {
  const [row] = await tx<any[]>`
    select *,id::text,flow_id::text from crm.automation_flow_steps
    where flow_id=${flowId}::uuid and is_active=true
    order by sort_order,id
    limit 1
  `;
  return row || null;
}

async function nextStep(tx: any, step: any) {
  const [row] = await tx<any[]>`
    select *,id::text,flow_id::text from crm.automation_flow_steps
    where flow_id=${step.flow_id}::uuid and is_active=true
      and (sort_order>${Number(step.sort_order || 0)} or (sort_order=${Number(step.sort_order || 0)} and id>${step.id}::uuid))
    order by sort_order,id
    limit 1
  `;
  return row || null;
}

async function sendAutomationMessage(tx: any, input: {
  sessionId: string;
  conversationId: string;
  stepId?: string | null;
  kind: "start" | "question" | "validation_error" | "final";
  text: string;
  key: string;
  buttons?: Array<{ id: string; title: string }>;
}): Promise<SendResult> {
  const [existing] = await tx<any[]>`
    select * from crm.automation_outbound_messages where idempotency_key=${input.key} limit 1
  `;
  if (existing?.status === "sent") {
    return {
      ok: true,
      providerStatus: "sent",
      providerMessageId: clean(existing.provider_message_id),
      httpStatus: Number(existing.http_status || 0),
      errorMessage: "",
    };
  }

  const [outbound] = await tx<any[]>`
    insert into crm.automation_outbound_messages(
      idempotency_key,session_id,conversation_id,step_id,message_kind,message_text,status
    ) values(
      ${input.key},${input.sessionId}::uuid,${input.conversationId}::uuid,${input.stepId || null}::uuid,
      ${input.kind},${input.text},'queued'
    )
    on conflict(idempotency_key) do update set message_text=excluded.message_text
    returning *,id::text
  `;

  try {
    const delivered: any = await deliverConversationMessage({
      conversationId: input.conversationId,
      text: input.text,
      senderType: "bot",
      idempotencyKey: input.key,
      reason: `conversation_automation_${input.kind}`,
      buttons: input.buttons || [],
      awaitProvider: true,
      db: tx,
    });
    const status = clean(delivered.providerStatus) === "sent" ? "sent" : "failed";
    const providerMessageId = clean(delivered.providerMessageId || delivered.message?.provider_message_id);
    const httpStatus = Number(delivered.httpStatus || 0);
    const errorMessage = clean(delivered.errorMessage);
    await tx`
      update crm.automation_outbound_messages set
        status=${status},provider_message_id=${providerMessageId || null},http_status=${httpStatus || null},
        error_message=${errorMessage || null},provider_response=${delivered.providerResponse ? tx.json(delivered.providerResponse) : null},
        sent_at=case when ${status}='sent' then now() else sent_at end,
        failed_at=case when ${status}='failed' then now() else failed_at end
      where id=${outbound.id}::uuid
    `;
    return { ok: status === "sent", providerStatus: status, providerMessageId, httpStatus, errorMessage };
  } catch (error: any) {
    const errorMessage = clean(error?.message || error) || "فشل إرسال رسالة الأوتوميشن";
    await tx`
      update crm.automation_outbound_messages set status='failed',error_message=${errorMessage},failed_at=now()
      where id=${outbound.id}::uuid
    `;
    return { ok: false, providerStatus: "failed", providerMessageId: "", httpStatus: 0, errorMessage };
  }
}

async function sendStartMessages(tx: any, session: any, flows: any[]) {
  const messages = await tx<any[]>`
    select *,id::text from crm.automation_start_messages
    where is_active=true order by sort_order,id
  `;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const isLast = index === messages.length - 1;
    const buttons = isLast ? flows.slice(0, 13).map((flow: any) => ({
      id: clean(flow.button_payload || flow.flow_code),
      title: `${clean(flow.emoji)} ${clean(flow.display_name)}`.trim(),
    })).filter((button: any) => button.id && button.title) : [];
    const result = await sendAutomationMessage(tx, {
      sessionId: session.id,
      conversationId: session.conversation_id,
      kind: "start",
      text: clean(message.message_text),
      key: `automation:${session.id}:start:${message.id}`,
      buttons,
    });
    if (!result.ok) throw new Error(result.errorMessage || "تعذر إرسال رسالة بداية الأوتوميشن");
  }
}

async function sendQuestion(tx: any, session: any, step: any) {
  const result = await sendAutomationMessage(tx, {
    sessionId: session.id,
    conversationId: session.conversation_id,
    stepId: step.id,
    kind: "question",
    text: clean(step.prompt_text),
    key: `automation:${session.id}:question:${step.id}`,
  });
  if (!result.ok) throw new Error(result.errorMessage || "تعذر إرسال سؤال الأوتوميشن");
}

async function retryFailedCurrentQuestion(tx: any, session: any, step: any) {
  const [outbound] = await tx<any[]>`
    select status from crm.automation_outbound_messages
    where idempotency_key=${`automation:${session.id}:question:${step.id}`}
    limit 1
  `;
  if (outbound?.status !== "failed") return false;
  await sendQuestion(tx, session, step);
  return true;
}

function validateStep(step: any, raw: string) {
  const value = clean(raw);
  const rules = step.validation_rules && typeof step.validation_rules === "object" ? step.validation_rules : {};
  if (step.is_required !== false && !value) return { ok: false, value: "", error: clean(step.validation_error) };
  if (step.step_type === "phone") {
    const normalized = ksaMobile(value);
    if (!normalized) return { ok: false, value: "", error: clean(step.validation_error) || "رقم الجوال غير صحيح" };
    return { ok: true, value: normalized, error: "" };
  }
  const minLength = Math.max(0, Number(rules.minLength || 0));
  const maxLength = Math.max(0, Number(rules.maxLength || 0));
  if (minLength && value.length < minLength) return { ok: false, value: "", error: clean(step.validation_error) };
  if (maxLength && value.length > maxLength) return { ok: false, value: "", error: clean(step.validation_error) };
  const allowedValues = Array.isArray(rules.allowedValues) ? rules.allowedValues.map(normalizeChoice).filter(Boolean) : [];
  if (allowedValues.length && !allowedValues.includes(normalizeChoice(value))) {
    return { ok: false, value: "", error: clean(step.validation_error) };
  }
  return { ok: true, value, error: "" };
}

async function moveToNextInteractiveStep(tx: any, session: any, first: any) {
  let step = first;
  while (step) {
    if (clean(step.step_type) !== "message") {
      await tx`
        update crm.automation_sessions set status='awaiting_answer',current_step_id=${step.id}::uuid,
          last_activity_at=now(),error_message=null,updated_at=now()
        where id=${session.id}::uuid
      `;
      await sendQuestion(tx, session, step);
      return { awaitingAnswer: true, step };
    }
    await sendQuestion(tx, session, step);
    step = await nextStep(tx, step);
  }
  return { awaitingAnswer: false, step: null };
}

async function updateCustomerField(tx: any, session: any, step: any, rawValue: string, normalizedValue: string) {
  const field = clean(step.customer_field);
  if (!field) return session;
  let currentSession = session;
  if (field === "customer_name") {
    const name = clean(rawValue);
    await tx`
      update crm.contacts set display_name=${name},metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('automationCustomerNameLocked',true,'automationCustomerName',${name}),updated_at=now()
      where id=${session.contact_id}::uuid
    `;
    await tx`
      update crm.conversations set customer_name=${name},metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('automationCustomerNameLocked',true),updated_at=now()
      where id=${session.conversation_id}::uuid
    `;
    await tx`update crm.leads set customer_name=${name},updated_at=now() where contact_id=${session.contact_id}::uuid and is_deleted=false`;
  } else if (field === "car_name") {
    const car = clean(rawValue);
    await tx`update crm.leads set car_name=${car},car_type=${car},updated_at=now() where contact_id=${session.contact_id}::uuid and is_deleted=false`;
  } else if (field === "phone") {
    const phone = normalizedValue;
    const [phoneContact] = await tx<any[]>`
      select *,id::text from crm.contacts where primary_phone_normalized=${phone} limit 1 for update
    `;
    let targetId = session.contact_id;
    if (phoneContact && String(phoneContact.id) !== String(session.contact_id)) {
      targetId = String(phoneContact.id);
      const sourceId = String(session.contact_id);
      const [sourceContact] = await tx<any[]>`
        select display_name,metadata from crm.contacts where id=${sourceId}::uuid limit 1 for update
      `;
      await tx`
        update crm.automation_sessions set status='cancelled',completed_at=now(),last_activity_at=now(),
          error_message='تم دمج جهة الاتصال في جلسة أوتوميشن أخرى نشطة',
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cancelledByMergedSessionId',${session.id}),updated_at=now()
        where contact_id=${targetId}::uuid and id<>${session.id}::uuid and status in ('awaiting_service','awaiting_answer')
      `;
      if (sourceContact?.metadata?.automationCustomerNameLocked === true || sourceContact?.metadata?.automationCustomerNameLocked === "true") {
        await tx`
          update crm.contacts set display_name=${clean(sourceContact.display_name) || "عميل"},
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'automationCustomerNameLocked',true,
              'automationCustomerName',${clean(sourceContact.display_name) || "عميل"}
            ),updated_at=now()
          where id=${targetId}::uuid
        `;
      }

      const openRequests = await tx<any[]>`
        select id::text,contact_id::text,lead_id::text,opened_at,updated_at
        from crm.service_requests
        where contact_id in (${targetId}::uuid,${sourceId}::uuid) and request_state='open'
        order by opened_at desc,updated_at desc
      `;
      const closeIds = openRequests.slice(1).map((row: any) => row.id);
      if (closeIds.length) {
        await tx`
          update crm.service_requests set request_state='closed',closed_at=coalesce(closed_at,now()),
            closure_reason=coalesce(nullif(closure_reason,''),'دمج جهة اتصال مكررة بواسطة الأوتوميشن'),updated_at=now()
          where id=any(${closeIds}::uuid[])
        `;
        await tx`update crm.leads set current_request_id=null,updated_at=now() where current_request_id=any(${closeIds}::uuid[])`;
      }

      await tx`update crm.contact_identities set contact_id=${targetId}::uuid,updated_at=now() where contact_id=${sourceId}::uuid`;
      await tx`update crm.leads set contact_id=${targetId}::uuid,updated_at=now() where contact_id=${sourceId}::uuid`;
      await tx`update crm.service_requests set contact_id=${targetId}::uuid,updated_at=now() where contact_id=${sourceId}::uuid`;
      await tx`update crm.conversations set contact_id=${targetId}::uuid,updated_at=now() where contact_id=${sourceId}::uuid`;
      await tx`update crm.ownership_events set contact_id=${targetId}::uuid where contact_id=${sourceId}::uuid`;
      await tx`update crm.automation_events set contact_id=${targetId}::uuid where contact_id=${sourceId}::uuid`;
      await tx`update crm.automation_jobs set contact_id=${targetId}::uuid,updated_at=now() where contact_id=${sourceId}::uuid`;
      await tx`update crm.automation_inbound_events set contact_id=${targetId}::uuid where contact_id=${sourceId}::uuid`;
      await tx`update crm.automation_final_actions set contact_id=${targetId}::uuid where contact_id=${sourceId}::uuid`;
      await tx`update crm.automation_sessions set contact_id=${targetId}::uuid,updated_at=now() where contact_id=${sourceId}::uuid`;
      await tx`delete from crm.contacts where id=${sourceId}::uuid`;
      currentSession = { ...session, contact_id: targetId };
    }
    await tx`
      update crm.contacts set contact_key=${`phone:${phone}`},primary_phone=${phone},primary_phone_normalized=${phone},updated_at=now()
      where id=${targetId}::uuid
    `;
    await tx`
      update crm.leads set phone=${phone},phone_normalized=${phone},updated_at=now()
      where contact_id=${targetId}::uuid and is_deleted=false
    `;
  }
  return currentSession;
}

async function applyCollectedFields(tx: any, session: any, leadId: string | null) {
  if (!leadId) return;
  const rows = await tx<any[]>`
    select s.customer_field,a.raw_value,a.normalized_value
    from crm.automation_answers a
    join crm.automation_flow_steps s on s.id=a.step_id
    where a.session_id=${session.id}::uuid and a.validation_status='valid'
  `;
  const values = Object.fromEntries(rows.map((row: any) => [clean(row.customer_field), clean(row.normalized_value || row.raw_value)]));
  await tx`
    update crm.leads set
      customer_name=coalesce(nullif(${values.customer_name || ""},''),customer_name),
      car_name=coalesce(nullif(${values.car_name || ""},''),car_name),
      car_type=coalesce(nullif(${values.car_name || ""},''),car_type),
      phone=coalesce(nullif(${values.phone || ""},''),phone),
      phone_normalized=coalesce(nullif(${values.phone || ""},''),phone_normalized),
      updated_at=now()
    where id=${leadId}::uuid
  `;
}

async function executeFinalAction(tx: any, session: any, flow: any, eventKey: string) {
  let [action] = await tx<any[]>`
    insert into crm.automation_final_actions(session_id,contact_id,conversation_id,flow_id,status,result)
    values(${session.id}::uuid,${session.contact_id}::uuid,${session.conversation_id}::uuid,${flow.id}::uuid,'processing','{}'::jsonb)
    on conflict(session_id) do update set updated_at=now()
    returning *,id::text,session_id::text,contact_id::text,conversation_id::text,flow_id::text,service_request_id::text,lead_id::text
  `;
  if (action.status === "completed") return action.result || {};

  try {
    const finalAction = flow.final_action && typeof flow.final_action === "object" ? flow.final_action : {};
    const shouldCreate = finalAction.createOrUpdateCustomer !== false;
    const shouldClassify = shouldCreate && finalAction.setService !== false && finalAction.setDepartment !== false;
    const fixedBranch = clean(flow.branch_policy) === "fixed" ? clean(flow.branch_code) : "";
    const assignPrimary = flow.service_key === "service"
      ? finalAction.assignCustomerService !== false
      : finalAction.assignSales !== false;
    const assignCallCenter = flow.service_key === "finance" && finalAction.assignCallCenter === true;
    const classified: any = shouldClassify
      ? await classifyConversationService({
          conversationId: session.conversation_id,
          serviceKey: flow.service_key,
          sourceCode: session.platform_code,
          classificationMethod: "conversation_automation",
          eventKey,
          branchCode: fixedBranch || null,
          assignPrimary,
          assignCallCenter,
          suppressAutomaticTemplate: true,
          db: tx,
        })
      : { request: null, leadId: null, reused: false, skipped: true, skipReason: shouldCreate ? "service_or_department_action_disabled" : "customer_action_disabled" };
    const request = classified.request || null;
    const leadId = clean(classified.leadId || request?.lead_id) || null;
    await applyCollectedFields(tx, session, leadId);
    const waitingAssignment = shouldClassify && (
      (assignPrimary && !clean(request?.assigned_to)) ||
      (assignCallCenter && !clean(request?.call_center_assigned_to))
    );
    if (request?.id) {
      await tx`
        update crm.service_requests set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'assignmentState',${waitingAssignment ? "waiting_assignment" : "assigned"},
          'missingPrimaryAssignment',${assignPrimary && !clean(request?.assigned_to)},
          'missingCallCenterAssignment',${assignCallCenter && !clean(request?.call_center_assigned_to)}
        ),updated_at=now() where id=${request.id}::uuid
      `;
    }
    const result = {
      serviceKey: flow.service_key,
      departmentCode: flow.department_code,
      requestId: request?.id || null,
      leadId,
      assignedTo: request?.assigned_to || null,
      callCenterAssignedTo: request?.call_center_assigned_to || null,
      reused: classified.reused === true,
      waitingAssignment,
    };
    [action] = await tx<any[]>`
      update crm.automation_final_actions set
        service_request_id=${request?.id || null}::uuid,lead_id=${leadId}::uuid,
        status=${waitingAssignment ? "waiting_assignment" : "processing"},result=${tx.json(result)},error_message=null,updated_at=now()
      where id=${action.id}::uuid
      returning *,id::text,session_id::text,contact_id::text,conversation_id::text,flow_id::text,service_request_id::text,lead_id::text
    `;

    const finalMessage = clean(flow.final_message);
    if (finalAction.sendFinalMessage !== false && finalMessage) {
      const sent = await sendAutomationMessage(tx, {
        sessionId: session.id,
        conversationId: session.conversation_id,
        kind: "final",
        text: finalMessage,
        key: `automation:${session.id}:final`,
      });
      if (!sent.ok) throw new Error(sent.errorMessage || "تعذر إرسال رسالة نهاية الأوتوميشن");
    }

    const finalStatus = waitingAssignment ? "waiting_assignment" : "completed";
    await tx`
      update crm.automation_final_actions set status=${finalStatus},completed_at=now(),updated_at=now()
      where id=${action.id}::uuid
    `;
    await tx`
      update crm.automation_sessions set status='completed',completed_at=now(),last_activity_at=now(),
        final_result=${tx.json(result)},error_message=null,updated_at=now()
      where id=${session.id}::uuid
    `;
    return result;
  } catch (error: any) {
    const message = clean(error?.message || error) || "فشل الإجراء النهائي للأوتوميشن";
    await tx`
      update crm.automation_final_actions set status='failed',error_message=${message},updated_at=now()
      where id=${action.id}::uuid
    `;
    await tx`
      update crm.automation_sessions set status='failed',error_message=${message},last_activity_at=now(),updated_at=now()
      where id=${session.id}::uuid
    `;
    throw error;
  }
}

async function startSession(tx: any, input: ConversationAutomationInput, settings: any, platform: any, inboundEventId: string) {
  const [session] = await tx<any[]>`
    insert into crm.automation_sessions(contact_id,conversation_id,platform_code,worker_code,trigger_policy,status,metadata)
    values(${input.contactId}::uuid,${input.conversationId}::uuid,${input.platformCode},${platform.worker_code || null},${settings.trigger_policy},'awaiting_service',
      jsonb_build_object('startedByEventKey',${input.eventKey},'automationName',${settings.automation_name || ""}))
    returning *,id::text,contact_id::text,conversation_id::text,flow_id::text,current_step_id::text
  `;
  await tx`update crm.automation_inbound_events set session_id=${session.id}::uuid,status='processing' where id=${inboundEventId}::uuid`;
  const flows = await loadFlows(tx);
  await sendStartMessages(tx, session, flows);
  await tx`
    update crm.conversations set classification_state='awaiting_service',service_selection_sent_at=now(),
      service_selection_version=service_selection_version+1,updated_at=now()
    where id=${input.conversationId}::uuid
  `;
  return { session, flows };
}

export async function processConversationAutomationEvent(input: ConversationAutomationInput) {
  const eventKey = clean(input.eventKey);
  const conversationId = clean(input.conversationId);
  const contactId = clean(input.contactId);
  const platformCode = clean(input.platformCode).toLowerCase();
  if (!eventKey || !conversationId || !contactId || !platformCode) {
    return { handled: false, reason: "missing_automation_identity", sessionId: null };
  }

  const sql = getSql();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${conversationId}))`;

    const [settings] = await tx<any[]>`select * from crm.automation_settings where id='default' limit 1`;
    if (!settings?.automation_enabled) return { handled: false, reason: "automation_disabled", sessionId: null };

    const platform = await loadPlatform(tx, platformCode);
    if (!platform?.is_enabled) return { handled: false, reason: "platform_disabled", sessionId: null };
    if (!platform.worker_code || platform.worker_is_active !== true || !clean(platform.worker_send_url)) {
      return { handled: false, reason: "worker_unavailable", sessionId: null };
    }

    const providerMessageId = clean(input.providerMessageId);
    let [inbound] = await tx<any[]>`
      select *,id::text,contact_id::text,conversation_id::text,session_id::text
      from crm.automation_inbound_events
      where event_key=${eventKey}
        or (${providerMessageId || null}::text is not null and platform_code=${platformCode} and provider_message_id=${providerMessageId || null})
      order by received_at
      limit 1
      for update
    `;
    if (!inbound) {
      [inbound] = await tx<any[]>`
        insert into crm.automation_inbound_events(event_key,provider_message_id,platform_code,contact_id,conversation_id,payload,status)
        values(${eventKey},${providerMessageId || null},${platformCode},${contactId}::uuid,${conversationId}::uuid,
          ${tx.json((input.payload || {}) as any)},'received')
        returning *,id::text,contact_id::text,conversation_id::text,session_id::text
      `;
    }
    if (inbound.status === "processed" || inbound.status === "ignored") {
      return { handled: true, duplicate: true, sessionId: inbound.session_id || null };
    }

    let session = await loadSession(tx, conversationId);
    if (!session) {
      const failedFinalSession = await retryableFailedFinalSession(tx, contactId, conversationId, inbound.session_id);
      if (failedFinalSession) {
        await tx`update crm.automation_inbound_events set session_id=${failedFinalSession.id}::uuid,status='processing' where id=${inbound.id}::uuid`;
        try {
          const result = await executeFinalAction(tx, failedFinalSession, { ...failedFinalSession, id: failedFinalSession.flow_id }, eventKey);
          await tx`update crm.automation_inbound_events set status='processed',error_message=null,processed_at=now(),
            payload=payload||jsonb_build_object('retriedFailedFinalAction',true) where id=${inbound.id}::uuid`;
          return { handled: true, completed: true, retriedFinalAction: true, sessionId: failedFinalSession.id, flowCode: failedFinalSession.flow_code, result };
        } catch (error: any) {
          const message = clean(error?.message || error) || "فشل إعادة محاولة الإجراء النهائي";
          await tx`update crm.automation_inbound_events set status='failed',error_message=${message},processed_at=now() where id=${inbound.id}::uuid`;
          return { handled: true, failed: true, retriedFinalAction: true, sessionId: failedFinalSession.id, error: message };
        }
      }
      const otherActiveSession = await activeSessionForContact(tx, contactId);
      if (otherActiveSession && String(otherActiveSession.conversation_id) !== conversationId) {
        await tx`
          update crm.automation_inbound_events set status='ignored',processed_at=now(),session_id=${otherActiveSession.id}::uuid,
            payload=payload||jsonb_build_object('ignoredReason','active_session_on_other_conversation')
          where id=${inbound.id}::uuid
        `;
        return { handled: true, ignored: true, reason: "active_session_on_other_conversation", sessionId: otherActiveSession.id };
      }
      const previous = await latestSession(tx, contactId);
      const cooldown = intervalMilliseconds(settings);
      const lastAt = previous ? new Date(previous.completed_at || previous.last_activity_at || previous.started_at).getTime() : 0;
      if (cooldown > 0 && lastAt && Date.now() - lastAt < cooldown) {
        await tx`update crm.automation_inbound_events set status='ignored',processed_at=now() where id=${inbound.id}::uuid`;
        return { handled: false, reason: "trigger_policy_cooldown", sessionId: null };
      }
      try {
        const started = await startSession(tx, input, settings, platform, inbound.id);
        session = started.session;
        await tx`
          update crm.automation_inbound_events set status='processed',processed_at=now(),session_id=${session.id}::uuid
          where id=${inbound.id}::uuid
        `;
        return { handled: true, started: true, sessionId: session.id, status: session.status };
      } catch (error: any) {
        const message = clean(error?.message || error) || "فشل إرسال بداية الأوتوميشن";
        const [failedInbound] = await tx<any[]>`
          update crm.automation_inbound_events set status='failed',error_message=${message},processed_at=now()
          where id=${inbound.id}::uuid
          returning session_id::text
        `;
        if (failedInbound?.session_id) {
          await tx`
            update crm.automation_sessions set error_message=${message},last_activity_at=now(),updated_at=now()
            where id=${failedInbound.session_id}::uuid
          `;
        }
        return { handled: true, failed: true, reason: "start_message_send_failed", sessionId: failedInbound?.session_id || null, error: message };
      }
    }

    await tx`update crm.automation_inbound_events set session_id=${session.id}::uuid,status='processing' where id=${inbound.id}::uuid`;
    const text = first(input.text, input.payload?.text, input.payload?.message, input.payload?.payload);

    try {
      if (session.status === "awaiting_service") {
        const flows = await loadFlows(tx);
        await sendStartMessages(tx, session, flows);
        const flow = matchFlow(flows, text, input.payload || {});
        if (!flow) {
          await tx`
            update crm.automation_inbound_events set status='ignored',processed_at=now() where id=${inbound.id}::uuid
          `;
          return { handled: true, sessionId: session.id, status: session.status, matched: false };
        }
        const step = await firstStep(tx, flow.id);
        await tx`
          update crm.automation_sessions set flow_id=${flow.id}::uuid,last_activity_at=now(),updated_at=now()
          where id=${session.id}::uuid
        `;
        session = { ...session, ...flow, flow_id: flow.id };
        await tx`
          update crm.automation_inbound_events set payload=payload||jsonb_build_object(
            'selectedFlowId',${flow.id},'selectedFlowCode',${flow.flow_code}
          ) where id=${inbound.id}::uuid
        `;
        if (step) {
          const progress = await moveToNextInteractiveStep(tx, session, step);
          if (progress.awaitingAnswer) {
            await tx`update crm.automation_inbound_events set status='processed',processed_at=now() where id=${inbound.id}::uuid`;
            return { handled: true, sessionId: session.id, flowCode: flow.flow_code, status: "awaiting_answer", currentStep: progress.step.step_key };
          }
        }
        const result = await executeFinalAction(tx, session, flow, eventKey);
        await tx`update crm.automation_inbound_events set status='processed',processed_at=now() where id=${inbound.id}::uuid`;
        return { handled: true, completed: true, sessionId: session.id, flowCode: flow.flow_code, result };
      }

      if (session.status === "awaiting_answer") {
        const step = await loadStep(tx, session.current_step_id);
        if (!step) throw new Error("خطوة الأوتوميشن الحالية غير موجودة");
        const retriedQuestion = await retryFailedCurrentQuestion(tx, session, step);
        if (retriedQuestion) {
          const [consumption] = await tx<any[]>`
            select exists(select 1 from crm.automation_answers where inbound_event_id=${inbound.id}::uuid) as answered,
              coalesce(payload ? 'selectedFlowId',false) as selected_flow,
              coalesce(payload ? 'answeredStepId',false) as answered_step
            from crm.automation_inbound_events where id=${inbound.id}::uuid
          `;
          const repeatedFlow = matchFlow(await loadFlows(tx), text, input.payload || {});
          const alreadyConsumed = consumption?.answered || consumption?.selected_flow || consumption?.answered_step ||
            (repeatedFlow && String(repeatedFlow.id) === String(session.flow_id));
          if (alreadyConsumed) {
            await tx`
              update crm.automation_inbound_events set status='processed',processed_at=now(),error_message=null,
                payload=payload||jsonb_build_object('retriedFailedQuestion',true,'notConsumedTwice',true)
              where id=${inbound.id}::uuid
            `;
            return { handled: true, retriedQuestion: true, sessionId: session.id, status: session.status, currentStep: step.step_key };
          }
        }
        const validation = validateStep(step, text);
        if (!validation.ok) {
          const errorText = validation.error || "البيانات المدخلة غير صحيحة، برجاء المحاولة مرة أخرى.";
          const attemptCount = Number((await tx<any[]>`
            select count(*)::int as count from crm.automation_inbound_events
            where session_id=${session.id}::uuid and status='processed' and payload->>'validationStepId'=${step.id}
          `)[0]?.count || 0) + 1;
          const validationSent = await sendAutomationMessage(tx, {
            sessionId: session.id,
            conversationId: session.conversation_id,
            stepId: step.id,
            kind: "validation_error",
            text: errorText,
            key: `automation:${session.id}:validation:${step.id}:${attemptCount}`,
          });
          if (!validationSent.ok) throw new Error(validationSent.errorMessage || "تعذر إرسال رسالة التحقق");
          const maxAttempts = Math.max(0, Number(step.max_attempts || 0));
          const exhausted = maxAttempts > 0 && attemptCount >= maxAttempts;
          await tx`
            update crm.automation_inbound_events set status='processed',processed_at=now(),
              payload=payload||jsonb_build_object('validationStepId',${step.id},'validationError',${errorText},'attemptCount',${attemptCount})
            where id=${inbound.id}::uuid
          `;
          if (exhausted) {
            await tx`
              update crm.automation_sessions set status='failed',error_message='تم تجاوز عدد محاولات التحقق',
                last_activity_at=now(),completed_at=now(),updated_at=now()
              where id=${session.id}::uuid
            `;
          }
          return { handled: true, sessionId: session.id, status: exhausted ? "failed" : session.status, validationError: errorText, attemptCount, exhausted };
        }

        const [answer] = await tx<any[]>`
          insert into crm.automation_answers(session_id,step_id,inbound_event_id,raw_value,normalized_value,validation_status,metadata)
          values(${session.id}::uuid,${step.id}::uuid,${inbound.id}::uuid,${text},${validation.value || null},'valid',
            jsonb_build_object('providerMessageId',${clean(input.providerMessageId) || null}))
          on conflict(session_id,step_id) do update set
            inbound_event_id=excluded.inbound_event_id,raw_value=excluded.raw_value,normalized_value=excluded.normalized_value,
            validation_status='valid',metadata=excluded.metadata
          returning *,id::text,session_id::text,step_id::text,inbound_event_id::text
        `;
        await tx`
          update crm.automation_inbound_events set payload=payload||jsonb_build_object(
            'answeredStepId',${step.id},'answeredStepKey',${step.step_key}
          ) where id=${inbound.id}::uuid
        `;
        session = await updateCustomerField(tx, session, step, text, validation.value);
        const next = await nextStep(tx, step);
        if (next) {
          const progress = await moveToNextInteractiveStep(tx, session, next);
          if (progress.awaitingAnswer) {
            await tx`update crm.automation_inbound_events set status='processed',processed_at=now() where id=${inbound.id}::uuid`;
            return { handled: true, sessionId: session.id, status: "awaiting_answer", savedAnswerId: answer.id, currentStep: progress.step.step_key };
          }
        }

        const [flow] = await tx<any[]>`select *,id::text from crm.automation_flows where id=${session.flow_id}::uuid limit 1`;
        if (!flow) throw new Error("فلو الأوتوميشن غير موجود");
        const result = await executeFinalAction(tx, session, flow, eventKey);
        await tx`update crm.automation_inbound_events set status='processed',processed_at=now() where id=${inbound.id}::uuid`;
        return { handled: true, completed: true, sessionId: session.id, flowCode: flow.flow_code, savedAnswerId: answer.id, result };
      }

      await tx`update crm.automation_inbound_events set status='ignored',processed_at=now() where id=${inbound.id}::uuid`;
      return { handled: false, reason: "session_not_active", sessionId: session.id };
    } catch (error: any) {
      const message = clean(error?.message || error) || "فشل تشغيل الأوتوميشن";
      await tx`
        update crm.automation_inbound_events set status='failed',error_message=${message},processed_at=now()
        where id=${inbound.id}::uuid
      `;
      await tx`
        update crm.automation_sessions set error_message=${message},last_activity_at=now(),updated_at=now()
        where id=${session.id}::uuid and status in ('awaiting_service','awaiting_answer','failed')
      `;
      return { handled: true, failed: true, sessionId: session.id, status: session.status, error: message };
    }
  });
}
