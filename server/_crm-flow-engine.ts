import { clean, normalizePhone } from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { classifyConversationService, mergeDuplicateContacts } from "./_crm-lifecycle.js";
import { deliverConversationMessage } from "./_crm-messaging.js";

export type AutomationInboundInput = {
  eventKey: string;
  providerMessageId?: string;
  conversationId: string;
  contactId: string;
  platformCode: string;
  workerCode?: string;
  messageText?: string;
  payloadValue?: string;
  messageType?: string;
  occurredAt?: string | Date;
};

type FlowContext = {
  tx: any;
  definition: any;
  platform: any;
  session: any;
  event: any;
  input: AutomationInboundInput;
};

type FinalClassificationResult = {
  skipped?: boolean;
  reason?: string;
  request?: any;
  leadId?: string | null;
  reused?: boolean;
  reclassified?: boolean;
  assignment?: any;
  callCenter?: any;
  automaticTemplate?: any;
};

const ACTIVE_SESSION_STATES = ["awaiting_choice", "sending", "awaiting_answer"];

export function normalizeAutomationReply(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ـًٌٍَُِّْ]/g, "")
    .replace(/[✅🌹👨‍🔧👇🔥🏦🛠💰]/g, "")
    .replace(/[_\-–—|/\\]+/g, " ")
    .replace(/[\s،,:؛.!?؟]+/g, " ")
    .trim();
}

function occurredAt(value: unknown) {
  const parsed = value instanceof Date ? value : new Date(clean(value) || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function providerSucceeded(result: any) {
  const status = clean(result?.providerStatus).toLowerCase();
  return ["sent", "delivered", "accepted", "success", "ok"].includes(status) && !clean(result?.errorMessage);
}

function choiceButtons(choices: any[]) {
  return choices.map((choice) => ({
    type: "postback",
    title: `${clean(choice.emoji)} ${clean(choice.display_name)}`.trim(),
    payload: clean(choice.choice_code),
    id: clean(choice.choice_code),
  }));
}

async function sendFlowMessage(context: FlowContext, input: {
  kind: "start" | "step_message" | "question" | "validation_error" | "final";
  body: string;
  idempotencyKey: string;
  stepId?: string | null;
  buttons?: unknown[];
}) {
  const { tx, session } = context;
  const [record] = await tx<any[]>`
    insert into crm.automation_outbound_messages(session_id,step_id,message_kind,idempotency_key,body,buttons,status)
    values(${session.id}::uuid,${input.stepId || null}::uuid,${input.kind},${input.idempotencyKey},${input.body},${tx.json((input.buttons || []) as any)},'pending')
    on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key
    returning *,id::text,session_id::text,step_id::text
  `;
  if (record.status === "sent") return record;

  await tx`
    update crm.automation_outbound_messages
    set status='sending',error_message=null,failed_at=null
    where id=${record.id}::uuid
  `;

  const result = await deliverConversationMessage({
    conversationId: session.conversation_id,
    text: input.body,
    senderType: "bot",
    reason: `automation_${input.kind}`,
    idempotencyKey: input.idempotencyKey,
    buttons: input.buttons,
    awaitProviderResult: true,
  });

  if (!providerSucceeded(result)) {
    const error = clean(result?.errorMessage) || `فشل إرسال رسالة الأوتوميشن (${clean(result?.providerStatus) || "unknown"})`;
    await tx`
      update crm.automation_outbound_messages set status='failed',provider_message_id=${clean(result?.providerMessageId) || null},
        http_status=${Number(result?.httpStatus || 0) || null},provider_response=${tx.json((result?.providerResponse || {}) as any)},
        error_message=${error},failed_at=now()
      where id=${record.id}::uuid
    `;
    throw new Error(error);
  }

  const [sent] = await tx<any[]>`
    update crm.automation_outbound_messages set status='sent',provider_message_id=${clean(result?.providerMessageId) || null},
      http_status=${Number(result?.httpStatus || 0) || null},provider_response=${tx.json((result?.providerResponse || {}) as any)},
      error_message=null,sent_at=now()
    where id=${record.id}::uuid
    returning *,id::text,session_id::text,step_id::text
  `;
  await tx`
    update crm.automation_platforms set last_success_at=now(),last_error=null,updated_at=now()
    where id=${context.platform.id}::uuid
  `;
  return sent;
}

async function loadChoices(tx: any, automationId: string) {
  return tx<any[]>`
    select
      c.id::text as id,
      c.automation_id::text as automation_id,
      c.choice_code,
      c.display_name,
      c.emoji,
      c.department_code,
      c.service_key,
      c.branch_policy,
      c.branch_code,
      c.final_action,
      c.final_message,
      c.sort_order,
      c.is_active,
      c.is_archived,
      c.created_at,
      c.updated_at
    from crm.automation_choices c
    where c.automation_id=${automationId}::uuid and c.is_active=true and c.is_archived=false
    order by c.sort_order,c.id
  `;
}

async function loadStepOptions(tx: any, stepId: string) {
  return tx<any[]>`
    select
      o.id::text as id,
      o.step_id::text as step_id,
      o.option_code,
      o.label,
      o.accepted_replies,
      o.sort_order,
      o.is_active
    from crm.automation_step_options o
    where o.step_id=${stepId}::uuid and o.is_active=true
    order by o.sort_order,o.id
  `;
}

function stepOptionButtons(options: any[]) {
  return options.map((option) => ({
    type: "postback",
    title: clean(option.label),
    payload: clean(option.option_code),
    id: clean(option.option_code),
  }));
}

async function startSession(context: FlowContext) {
  const { tx, definition, session } = context;
  await tx`update crm.automation_sessions set status='sending',last_activity_at=now() where id=${session.id}::uuid`;
  session.status = "sending";

  const messages = await tx<any[]>`
    select
      m.id::text as id,
      m.automation_id::text as automation_id,
      m.message_code,
      m.body,
      m.sort_order,
      m.is_active,
      m.is_archived,
      m.created_at,
      m.updated_at
    from crm.automation_start_messages m
    where m.automation_id=${definition.id}::uuid and m.is_active=true and m.is_archived=false
    order by m.sort_order,m.id
  `;
  const choices = await loadChoices(tx, definition.id);
  try {
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      await sendFlowMessage(context, {
        kind: "start",
        body: message.body,
        idempotencyKey: `automation:${session.id}:start:${message.message_code}`,
        buttons: index === messages.length - 1 ? choiceButtons(choices) : [],
      });
    }
  } catch (error: any) {
    const message = clean(error?.message || error) || "فشل إرسال بداية الأوتوميشن";
    await tx`update crm.automation_sessions set status='sending',last_activity_at=now(),error_message=${message} where id=${session.id}::uuid`;
    return { action: "start_send_failed", retryable: true, error: message, sessionId: session.id };
  }
  const [updated] = await tx<any[]>`
    update crm.automation_sessions set status='awaiting_choice',last_activity_at=now(),error_message=null
    where id=${session.id}::uuid returning *,id::text,automation_id::text,contact_id::text,conversation_id::text,
      selected_choice_id::text,current_step_id::text
  `;
  context.session = updated;
  return { action: "session_started", sessionId: session.id };
}

async function resendChoicePrompt(context: FlowContext) {
  const choices = await loadChoices(context.tx, context.definition.id);
  const [last] = await context.tx<any[]>`
    select m.body,m.message_code from crm.automation_start_messages m
    where m.automation_id=${context.definition.id}::uuid and m.is_active=true and m.is_archived=false
    order by m.sort_order desc,m.id desc limit 1
  `;
  const body = clean(last?.body) || "برجاء اختيار الخدمة المطلوبة.";
  await sendFlowMessage(context, {
    kind: "validation_error",
    body,
    idempotencyKey: `automation:${context.session.id}:choice-retry:${context.event.id}`,
    buttons: choiceButtons(choices),
  });
  return { action: "choice_not_matched", sessionId: context.session.id };
}

async function matchChoice(context: FlowContext) {
  const payload = normalizeAutomationReply(context.input.payloadValue);
  const text = normalizeAutomationReply(context.input.messageText);
  const [choice] = await context.tx<any[]>`
    select c.*,c.id::text,c.automation_id::text
    from crm.automation_choice_replies r
    join crm.automation_choices c on c.id=r.choice_id
    where c.automation_id=${context.definition.id}::uuid and c.is_active=true and c.is_archived=false
      and ((r.reply_type='payload' and r.normalized_value=${payload})
        or (r.reply_type<>'payload' and r.normalized_value=${text}))
    order by case when r.reply_type='payload' then 0 else 1 end,c.sort_order
    limit 1
  `;
  return choice || null;
}

function validateStep(step: any, rawValue: string, options: any[] = []) {
  const rules = step.validation_rules || {};
  if (step.step_type === "choice") {
    const normalizedInput = normalizeAutomationReply(rawValue);
    const option = options.find((item) => {
      const accepted = Array.isArray(item.accepted_replies) ? item.accepted_replies : [];
      return [item.option_code, item.label, ...accepted].map(normalizeAutomationReply).includes(normalizedInput);
    });
    if (!option) return { valid: false, normalized: "", error: clean(step.validation_error_message) || "برجاء اختيار أحد الاختيارات المتاحة." };
    return { valid: true, normalized: clean(option.label), optionCode: clean(option.option_code), error: "" };
  }
  if (step.step_type === "phone") {
    const normalized = normalizePhone(rawValue);
    if (!/^9665\d{8}$/.test(normalized)) return { valid: false, normalized: "", error: clean(step.validation_error_message) || "رقم الجوال غير صحيح." };
    return { valid: true, normalized, error: "" };
  }
  const normalized = clean(rawValue);
  if (step.is_required && !normalized) return { valid: false, normalized, error: clean(step.validation_error_message) || "هذه الإجابة مطلوبة." };
  const minLength = Number(rules?.minLength || 0);
  const maxLength = Number(rules?.maxLength || 0);
  if (minLength && normalized.length < minLength) return { valid: false, normalized, error: clean(step.validation_error_message) || "الإجابة أقصر من المطلوب." };
  if (maxLength && normalized.length > maxLength) return { valid: false, normalized, error: clean(step.validation_error_message) || "الإجابة أطول من المسموح." };
  return { valid: true, normalized, error: "" };
}

async function sessionAnswerMap(tx: any, sessionId: string) {
  const rows = await tx<any[]>`
    select s.customer_field_key,a.normalized_value,a.raw_value
    from crm.automation_answers a join crm.automation_steps s on s.id=a.step_id
    where a.session_id=${sessionId}::uuid and a.validation_status='valid'
    order by a.created_at
  `;
  const values: Record<string, string> = {};
  for (const row of rows) if (clean(row.customer_field_key)) values[clean(row.customer_field_key)] = clean(row.normalized_value || row.raw_value);
  return values;
}

async function applyCustomerField(context: FlowContext, step: any, value: string) {
  const field = clean(step.customer_field_key);
  const { tx, session } = context;
  if (!field) return;

  if (field === "customer_name") {
    await tx`update crm.contacts set display_name=${value},metadata=coalesce(metadata,'{}'::jsonb)||'{"automationCustomerNameLocked":true}'::jsonb,updated_at=now() where id=${session.contact_id}::uuid`;
    await tx`update crm.automation_sessions set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('capturedCustomerName',${value}),last_activity_at=now() where id=${session.id}::uuid`;
    return;
  }

  if (field === "car_name") {
    await tx`update crm.automation_sessions set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('capturedCarName',${value}),last_activity_at=now() where id=${session.id}::uuid`;
    return;
  }

  if (field === "phone") {
    const [existing] = await tx<any[]>`select id::text from crm.contacts where primary_phone_normalized=${value} limit 1`;
    const pendingTargetContactId = existing?.id && existing.id !== session.contact_id ? existing.id : "";
    if (!pendingTargetContactId) {
      await tx`update crm.contacts set primary_phone=${value},primary_phone_normalized=${value},metadata=coalesce(metadata,'{}'::jsonb)||'{"automationPhoneCaptured":true}'::jsonb,updated_at=now() where id=${session.contact_id}::uuid`;
    }
    const metadata = { ...(session.metadata || {}), capturedPhone: value, pendingTargetContactId: pendingTargetContactId || null };
    await tx`update crm.automation_sessions set metadata=${tx.json(metadata)},last_activity_at=now() where id=${session.id}::uuid`;
    session.metadata = metadata;
    return;
  }

  await tx`
    update crm.automation_sessions set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(${field},${value}),last_activity_at=now()
    where id=${session.id}::uuid
  `;
}

async function projectCapturedFieldAfterDelivery(context: FlowContext, step: any, value: string) {
  const field = clean(step.customer_field_key);
  if (field === "customer_name") {
    await context.tx`
      update crm.conversations set customer_name=${value},
        metadata=coalesce(metadata,'{}'::jsonb)||'{"automationCustomerNameLocked":true}'::jsonb,updated_at=now()
      where id=${context.session.conversation_id}::uuid
    `;
    await context.tx`
      update crm.leads set customer_name=${value},
        extra_data=coalesce(extra_data,'{}'::jsonb)||'{"automationCustomerNameLocked":true}'::jsonb,updated_at=now()
      where contact_id=${context.session.contact_id}::uuid and is_deleted=false
    `;
  } else if (field === "car_name") {
    await context.tx`
      update crm.conversations set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('automationCarName',${value}),updated_at=now()
      where id=${context.session.conversation_id}::uuid
    `;
    await context.tx`
      update crm.leads set car_name=${value},car_type=${value},updated_at=now()
      where contact_id=${context.session.contact_id}::uuid and is_deleted=false
    `;
  }
}

async function completeFinalAction(context: FlowContext, choice: any) {
  const { tx, session, input } = context;
  const actionKey = `automation:${session.id}:final`;
  let [action] = await tx<any[]>`
    insert into crm.automation_final_actions(session_id,action_key,choice_id,contact_id,conversation_id,status)
    values(${session.id}::uuid,${actionKey},${choice.id}::uuid,${session.contact_id}::uuid,${session.conversation_id}::uuid,'processing')
    on conflict(session_id) do update set session_id=excluded.session_id
    returning *,id::text,session_id::text,choice_id::text,contact_id::text,conversation_id::text,lead_id::text,service_request_id::text
  `;
  if (action.status === "completed") return { action: "already_completed", sessionId: session.id };

  try {
    const finalAction = choice.final_action && typeof choice.final_action === "object" ? choice.final_action : {};
    const distributionEnabled = finalAction.requestDistribution !== false;
    const assignPrimary = distributionEnabled && (choice.service_key === "service"
      ? finalAction.assignCustomerService !== false
      : finalAction.assignSales !== false);
    const assignCallCenter = distributionEnabled && choice.service_key === "finance" && finalAction.assignCallCenter !== false;
    const shouldClassify = finalAction.createOrUpdateCustomer !== false && finalAction.classifyService !== false;
    const classification: FinalClassificationResult = shouldClassify
      ? await classifyConversationService({
          conversationId: session.conversation_id,
          serviceKey: choice.service_key,
          sourceCode: input.platformCode,
          classificationMethod: "automation_flow",
          eventKey: actionKey,
          actor: null,
          skipAutomaticTemplate: true,
          assignPrimary,
          assignCallCenter,
          requestedBranchCode: choice.branch_policy === "fixed" ? clean(choice.branch_code) : undefined,
        })
      : { skipped: true, reason: "final_action_disabled" };
    const answers = await sessionAnswerMap(tx, session.id);
    const pendingTargetContactId = clean(session?.metadata?.pendingTargetContactId);
    const leadId = clean(classification?.leadId || classification?.request?.lead_id);

    // Provider delivery updates the conversation through the shared messaging service.
    // Complete it before this transaction updates/merges conversation rows to avoid
    // cross-connection lock waits while preserving provider-confirmed progression.
    const finalRecord = finalAction.sendFinalMessage === false
      ? { skipped: true, reason: "final_message_disabled" }
      : await sendFlowMessage(context, {
          kind: "final",
          body: choice.final_message,
          idempotencyKey: `automation:${session.id}:final-message`,
        });

    if (pendingTargetContactId && pendingTargetContactId !== session.contact_id) {
      const sourceContactId = session.contact_id;
      await tx`
        update crm.automation_sessions set status='cancelled',completed_at=now(),last_activity_at=now(),
          error_message='تم دمج الجلسة مع جهة الاتصال الأساسية بعد التحقق من رقم الجوال'
        where contact_id=${pendingTargetContactId}::uuid and id<>${session.id}::uuid
          and status in ('awaiting_choice','sending','awaiting_answer')
      `;
      await mergeDuplicateContacts(tx, pendingTargetContactId, [sourceContactId]);
      session.contact_id = pendingTargetContactId;
      await tx`update crm.automation_sessions set contact_id=${pendingTargetContactId}::uuid,metadata=coalesce(metadata,'{}'::jsonb)-'pendingTargetContactId',last_activity_at=now() where id=${session.id}::uuid`;
      await tx`update crm.automation_final_actions set contact_id=${pendingTargetContactId}::uuid where id=${action.id}::uuid`;
    }
    await tx`
      update crm.contacts set display_name=coalesce(nullif(${answers.customer_name || ""},''),display_name),
        primary_phone=coalesce(nullif(${answers.phone || ""},''),primary_phone),
        primary_phone_normalized=coalesce(nullif(${answers.phone || ""},''),primary_phone_normalized),
        metadata=coalesce(metadata,'{}'::jsonb)||${tx.json({ automationPhoneCaptured: Boolean(answers.phone), automationCustomerNameLocked: Boolean(answers.customer_name) })}::jsonb,
        updated_at=now()
      where id=${session.contact_id}::uuid
    `;
    if (leadId) {
      await tx`
        update crm.leads set
          customer_name=coalesce(nullif(${answers.customer_name || ""},''),customer_name),
          car_name=coalesce(nullif(${answers.car_name || ""},''),car_name),
          car_type=coalesce(nullif(${answers.car_name || ""},''),car_type),
          phone=coalesce(nullif(${answers.phone || ""},''),phone),
          phone_normalized=coalesce(nullif(${answers.phone || ""},''),phone_normalized),
          extra_data=coalesce(extra_data,'{}'::jsonb)||${tx.json({ automationSessionId: session.id, automationCustomerNameLocked: Boolean(answers.customer_name) })}::jsonb,
          updated_at=now()
        where id=${leadId}::uuid
      `;
    }
    await tx`
      update crm.conversations set
        customer_name=coalesce(nullif(${answers.customer_name || ""},''),customer_name),
        metadata=coalesce(metadata,'{}'::jsonb)||${tx.json({ automationCustomerNameLocked: Boolean(answers.customer_name), automationCarName: answers.car_name || null, automationPhoneCaptured: Boolean(answers.phone) })}::jsonb,
        updated_at=now()
      where id=${session.conversation_id}::uuid
    `;

    [action] = await tx<any[]>`
      update crm.automation_final_actions set status='completed',lead_id=${leadId || null}::uuid,
        service_request_id=${clean(classification?.request?.id) || null}::uuid,
        assignment_result=${tx.json((classification || {}) as any)},final_message_result=${tx.json((finalRecord || {}) as any)},
        error_message=null,completed_at=now()
      where id=${action.id}::uuid
      returning *,id::text
    `;
    await tx`
      update crm.automation_sessions set status='completed',current_step_id=null,last_activity_at=now(),completed_at=now(),
        final_action_result=${tx.json((classification || {}) as any)},error_message=null
      where id=${session.id}::uuid
    `;
    return { action: "flow_completed", sessionId: session.id, serviceKey: choice.service_key, leadId, requestId: clean(classification?.request?.id) };
  } catch (error: any) {
    const message = clean(error?.message || error) || "فشل الإجراء النهائي للأوتوميشن";
    await tx`update crm.automation_final_actions set status='failed',error_message=${message},failed_at=now() where id=${action.id}::uuid`;
    await tx`update crm.automation_sessions set status='sending',current_step_id=null,last_activity_at=now(),error_message=${message} where id=${session.id}::uuid`;
    return { action: "final_action_failed", retryable: true, error: message, sessionId: session.id };
  }
}

async function advanceChoiceFlow(context: FlowContext, choice: any, afterSortOrder = -1) {
  const steps = await context.tx<any[]>`
    select
      s.id::text as id,
      s.choice_id::text as choice_id,
      s.step_code,
      s.name,
      s.prompt,
      s.step_type,
      s.customer_field_key,
      s.is_required,
      s.validation_rules,
      s.validation_error_message,
      s.max_attempts,
      s.sort_order,
      s.is_active,
      s.is_archived,
      s.created_at,
      s.updated_at
    from crm.automation_steps s
    where s.choice_id=${choice.id}::uuid and s.is_active=true and s.is_archived=false and s.sort_order>${afterSortOrder}
    order by s.sort_order,s.id
  `;
  for (const step of steps) {
    await context.tx`
      update crm.automation_sessions set status='sending',current_step_id=${step.id}::uuid,last_activity_at=now(),error_message=null
      where id=${context.session.id}::uuid
    `;
    context.session.current_step_id = step.id;
    context.session.status = "sending";
    const options = step.step_type === "choice" ? await loadStepOptions(context.tx, step.id) : [];
    try {
      await sendFlowMessage(context, {
        kind: step.step_type === "message" ? "step_message" : "question",
        body: step.prompt,
        idempotencyKey: `automation:${context.session.id}:step:${step.step_code}`,
        stepId: step.id,
        buttons: step.step_type === "choice" ? stepOptionButtons(options) : [],
      });
    } catch (error: any) {
      const message = clean(error?.message || error) || "فشل إرسال خطوة الأوتوميشن";
      await context.tx`
        update crm.automation_sessions set status='sending',current_step_id=${step.id}::uuid,error_message=${message},last_activity_at=now()
        where id=${context.session.id}::uuid
      `;
      return {
        action: step.step_type === "message" ? "step_message_send_failed" : "question_send_failed",
        retryable: true,
        step: step.step_code,
        error: message,
        sessionId: context.session.id,
      };
    }
    if (step.step_type === "message") continue;
    await context.tx`
      update crm.automation_sessions set status='awaiting_answer',current_step_id=${step.id}::uuid,last_activity_at=now(),error_message=null
      where id=${context.session.id}::uuid
    `;
    context.session.status = "awaiting_answer";
    return { action: "awaiting_answer", choice: choice.choice_code, currentStep: step.step_code, sessionId: context.session.id };
  }
  context.session.current_step_id = null;
  await context.tx`
    update crm.automation_sessions set status='sending',current_step_id=null,last_activity_at=now(),error_message=null
    where id=${context.session.id}::uuid
  `;
  return completeFinalAction(context, choice);
}

async function acceptChoice(context: FlowContext, choice: any) {
  await context.tx`
    update crm.automation_sessions set selected_choice_id=${choice.id}::uuid,current_step_id=null,
      status='sending',last_activity_at=now(),error_message=null
    where id=${context.session.id}::uuid
  `;
  context.session.selected_choice_id = choice.id;
  context.session.current_step_id = null;
  context.session.status = "sending";
  return advanceChoiceFlow(context, choice);
}

async function handleAnswer(context: FlowContext) {
  const [step] = await context.tx<any[]>`
    select *,id::text,choice_id::text from crm.automation_steps
    where id=${context.session.current_step_id}::uuid and is_active=true and is_archived=false limit 1
  `;
  if (!step) throw new Error("خطوة الأوتوميشن الحالية غير موجودة أو غير نشطة");
  const rawValue = clean(context.input.messageText || context.input.payloadValue);
  const options = step.step_type === "choice" ? await loadStepOptions(context.tx, step.id) : [];
  const validation = validateStep(step, rawValue, options);
  const [attemptRow] = await context.tx<any[]>`
    select count(*)::integer as count from crm.automation_answers
    where session_id=${context.session.id}::uuid and step_id=${step.id}::uuid
  `;
  const attempt = Number(attemptRow?.count || 0) + 1;
  await context.tx`
    insert into crm.automation_answers(session_id,step_id,inbound_event_id,raw_value,normalized_value,validation_status,validation_error,attempt_number)
    values(${context.session.id}::uuid,${step.id}::uuid,${context.event.id}::uuid,${rawValue || null},${validation.normalized || null},
      ${validation.valid ? "valid" : "invalid"},${validation.error || null},${attempt})
    on conflict(session_id,step_id,inbound_event_id) do nothing
  `;
  await context.tx`update crm.automation_sessions set last_activity_at=now() where id=${context.session.id}::uuid`;

  if (!validation.valid) {
    try {
      await sendFlowMessage(context, {
        kind: "validation_error",
        body: validation.error,
        idempotencyKey: `automation:${context.session.id}:step:${step.step_code}:invalid:${context.event.id}`,
        stepId: step.id,
      });
    } catch (error: any) {
      const message = clean(error?.message || error) || "فشل إرسال رسالة التحقق";
      await context.tx`update crm.automation_sessions set status='awaiting_answer',error_message=${message},last_activity_at=now() where id=${context.session.id}::uuid`;
      return { action: "validation_message_failed", retryable: true, step: step.step_code, attempt, error: message, sessionId: context.session.id };
    }
    return { action: "validation_failed", step: step.step_code, attempt, sessionId: context.session.id };
  }

  await applyCustomerField(context, step, validation.normalized);
  const [choice] = await context.tx<any[]>`select *,id::text from crm.automation_choices where id=${step.choice_id}::uuid and is_active=true and is_archived=false limit 1`;
  if (!choice) throw new Error("اختيار الأوتوميشن المرتبط بالخطوة غير موجود");
  const flowResult = await advanceChoiceFlow(context, choice, Number(step.sort_order));
  await projectCapturedFieldAfterDelivery(context, step, validation.normalized);
  return flowResult;
}

async function retrySendingSession(context: FlowContext) {
  const { tx, session } = context;
  if (!session.selected_choice_id) return startSession(context);
  if (session.current_step_id) {
    const [step] = await tx<any[]>`
      select *,id::text,choice_id::text from crm.automation_steps
      where id=${session.current_step_id}::uuid and is_active=true and is_archived=false limit 1
    `;
    if (!step) throw new Error("تعذر العثور على خطوة الأوتوميشن المطلوب إعادة إرسالها");
    const options = step.step_type === "choice" ? await loadStepOptions(tx, step.id) : [];
    try {
      await sendFlowMessage(context, {
        kind: step.step_type === "message" ? "step_message" : "question",
        body: step.prompt,
        idempotencyKey: `automation:${session.id}:step:${step.step_code}`,
        stepId: step.id,
        buttons: step.step_type === "choice" ? stepOptionButtons(options) : [],
      });
    } catch (error: any) {
      const message = clean(error?.message || error) || "تعذر إعادة إرسال سؤال الأوتوميشن";
      await tx`update crm.automation_sessions set status='sending',error_message=${message},last_activity_at=now() where id=${session.id}::uuid`;
      return { action: "question_retry_failed", retryable: true, step: step.step_code, error: message, sessionId: session.id };
    }
    if (step.step_type === "message") {
      const [choice] = await tx<any[]>`
        select *,id::text from crm.automation_choices
        where id=${step.choice_id}::uuid and is_active=true and is_archived=false limit 1
      `;
      if (!choice) throw new Error("تعذر العثور على اختيار خطوة الأوتوميشن");
      return advanceChoiceFlow(context, choice, Number(step.sort_order));
    }
    await tx`update crm.automation_sessions set status='awaiting_answer',error_message=null,last_activity_at=now() where id=${session.id}::uuid`;
    return { action: "question_retried", step: step.step_code, sessionId: session.id };
  }
  const [choice] = await tx<any[]>`
    select *,id::text from crm.automation_choices
    where id=${session.selected_choice_id}::uuid and is_active=true and is_archived=false limit 1
  `;
  if (!choice) throw new Error("تعذر العثور على اختيار الأوتوميشن المطلوب استكماله");
  return completeFinalAction(context, choice);
}

async function shouldStartSession(tx: any, definition: any, contactId: string, conversationId: string) {
  if (definition.trigger_policy === "every_message") return true;
  const [last] = await tx<any[]>`
    select started_at,last_activity_at,completed_at from crm.automation_sessions
    where automation_id=${definition.id}::uuid and (conversation_id=${conversationId}::uuid or contact_id=${contactId}::uuid)
    order by greatest(started_at,last_activity_at,coalesce(completed_at,'epoch')) desc limit 1
  `;
  if (!last) return true;
  const reference = new Date(last.completed_at || last.last_activity_at || last.started_at).getTime();
  const waitSeconds = definition.trigger_policy === "once_24_hours" ? 86400 : Number(definition.trigger_interval_seconds || 0);
  return waitSeconds > 0 && Date.now() - reference >= waitSeconds * 1000;
}

export async function handleAutomationInbound(input: AutomationInboundInput) {
  const sql = getSql();
  const eventKey = clean(input.eventKey);
  if (!eventKey || !clean(input.conversationId) || !clean(input.contactId)) throw new Error("بيانات حدث الأوتوميشن غير مكتملة");

  const [event] = await sql<any[]>`
    insert into crm.automation_inbound_events(event_key,provider_message_id,conversation_id,contact_id,platform_code,worker_code,message_text,payload_value,message_type,occurred_at,status)
    values(${eventKey},${clean(input.providerMessageId) || null},${input.conversationId}::uuid,${input.contactId}::uuid,
      ${clean(input.platformCode).toLowerCase()},${clean(input.workerCode) || null},${clean(input.messageText) || null},${clean(input.payloadValue) || null},
      ${clean(input.messageType) || "text"},${occurredAt(input.occurredAt)}::timestamptz,'received')
    on conflict(event_key) do update set event_key=excluded.event_key
    returning *,id::text,conversation_id::text,contact_id::text,session_id::text
  `;
  if (event.status === "processed" || event.status === "ignored") return { ok: true, duplicate: true, result: event.result || {} };

  try {
    const result = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${input.conversationId}::text)::bigint)`;
      const [lockedEvent] = await tx<any[]>`
        select *,id::text,conversation_id::text,contact_id::text,session_id::text
        from crm.automation_inbound_events where id=${event.id}::uuid for update
      `;
      if (["processed", "ignored"].includes(lockedEvent.status)) return lockedEvent.result || {};

      const [definition] = await tx<any[]>`
        select *,id::text from crm.automation_definitions
        where code='default_customer_entry' and is_active=true limit 1
      `;
      if (!definition) {
        const ignored = { action: "automation_inactive" };
        await tx`update crm.automation_inbound_events set status='ignored',result=${tx.json(ignored)},processed_at=now() where id=${event.id}::uuid`;
        return ignored;
      }
      const [platform] = await tx<any[]>`
        select p.*,p.id::text,p.automation_id::text,e.is_active as endpoint_active,
          coalesce(e.text_send_url,e.send_url) as endpoint_send_url
        from crm.automation_platforms p
        left join lateral (
          select ie.* from crm.integration_endpoints ie
          where ie.source_code=coalesce(nullif(p.worker_code,''),p.source_code)
          limit 1
        ) e on true
        where p.automation_id=${definition.id}::uuid and p.source_code=${clean(input.platformCode).toLowerCase()} limit 1
      `;
      if (!platform?.is_enabled || !platform?.endpoint_active || !clean(platform?.endpoint_send_url)) {
        const ignored = { action: "platform_disabled", platform: clean(input.platformCode).toLowerCase() };
        await tx`update crm.automation_inbound_events set status='ignored',result=${tx.json(ignored)},processed_at=now() where id=${event.id}::uuid`;
        return ignored;
      }

      let [session] = await tx<any[]>`
        select *,id::text,automation_id::text,contact_id::text,conversation_id::text,selected_choice_id::text,current_step_id::text
        from crm.automation_sessions
        where conversation_id=${input.conversationId}::uuid and status=any(${ACTIVE_SESSION_STATES}::text[])
        order by started_at desc limit 1 for update
      `;
      if (!session) {
        const canStart = await shouldStartSession(tx, definition, input.contactId, input.conversationId);
        if (!canStart) {
          const ignored = { action: "trigger_policy_wait", policy: definition.trigger_policy };
          await tx`update crm.automation_inbound_events set status='ignored',result=${tx.json(ignored)},processed_at=now() where id=${event.id}::uuid`;
          return ignored;
        }
        [session] = await tx<any[]>`
          insert into crm.automation_sessions(automation_id,contact_id,conversation_id,platform_code,worker_code,trigger_policy,status,metadata)
          values(${definition.id}::uuid,${input.contactId}::uuid,${input.conversationId}::uuid,${clean(input.platformCode).toLowerCase()},
            ${clean(input.workerCode || platform.worker_code) || null},${definition.trigger_policy},'sending',${tx.json({ startedByEventKey: eventKey, definitionVersion: definition.version })})
          returning *,id::text,automation_id::text,contact_id::text,conversation_id::text,selected_choice_id::text,current_step_id::text
        `;
        await tx`update crm.automation_inbound_events set session_id=${session.id}::uuid where id=${event.id}::uuid`;
        const context: FlowContext = { tx, definition, platform, session, event: lockedEvent, input };
        const started = await startSession(context);
        await tx`update crm.automation_inbound_events set status='processed',session_id=${session.id}::uuid,result=${tx.json(started)},processed_at=now() where id=${event.id}::uuid`;
        return started;
      }

      await tx`update crm.automation_inbound_events set session_id=${session.id}::uuid where id=${event.id}::uuid`;
      const context: FlowContext = { tx, definition, platform, session, event: lockedEvent, input };
      let flowResult: any;
      if (session.status === "awaiting_choice") {
        const choice = await matchChoice(context);
        flowResult = choice ? await acceptChoice(context, choice) : await resendChoicePrompt(context);
      } else if (session.status === "awaiting_answer") {
        flowResult = await handleAnswer(context);
      } else {
        flowResult = await retrySendingSession(context);
      }
      await tx`update crm.automation_inbound_events set status='processed',result=${tx.json(flowResult)},processed_at=now() where id=${event.id}::uuid`;
      return flowResult;
    });
    return { ok: true, result };
  } catch (error: any) {
    const message = clean(error?.message || error) || "فشل محرك الأوتوميشن";
    await sql`
      update crm.automation_inbound_events set status='failed',error_message=${message},processed_at=now()
      where id=${event.id}::uuid
    `.catch(() => undefined);
    await sql`
      update crm.automation_platforms set last_error=${message},updated_at=now()
      where automation_id=(select id from crm.automation_definitions where code='default_customer_entry')
        and source_code=${clean(input.platformCode).toLowerCase()}
    `.catch(() => undefined);
    throw error;
  }
}
