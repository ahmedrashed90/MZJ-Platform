import type { SessionUser } from "./_auth.js";
import { clean, normalizePhone } from "./_crm-utils.js";
import { classifyConversationService } from "./_crm-lifecycle.js";
import { deliverConversationMessage } from "./_crm-messaging.js";
import { getSql } from "./_db.js";
import {
  intervalMilliseconds,
  loadCustomerAutomationSettings,
  normalizeCustomerAutomationSettings,
  type AutomationChoice,
  type CustomerAutomationSettings,
} from "./_crm-customer-automation-settings.js";

export type CustomerAutomationInbound = {
  event: any;
  context: any;
  actor?: SessionUser | null;
};

type SessionState =
  | "awaiting_service"
  | "awaiting_name"
  | "awaiting_car"
  | "awaiting_phone"
  | "completed"
  | "cancelled"
  | "failed";

type ProcessResult = {
  handled: boolean;
  consumed: boolean;
  action: string;
  sessionId?: string;
  reason?: string;
  serviceKey?: string;
  state?: SessionState;
};

type AutomationMessage = {
  conversationId: string;
  text: string;
  idempotencyKey: string;
  reason: string;
  buttons?: Array<{ id: string; title: string }>;
};

function normalized(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ـًٌٍَُِّْ]/g, "")
    .replace(/[\s،,:؛.!?؟_\-–—|/\\]+/g, " ")
    .trim();
}

function incomingCandidates(context: any) {
  const payload = context?.payload || {};
  return [
    context?.event?.text,
    payload?.payload,
    payload?.buttonTitle,
    payload?.button_title,
    payload?.serviceSelectionKey,
    payload?.service_selection_key,
    payload?.serviceKey,
    payload?.service_key,
  ].map(normalized).filter(Boolean);
}

export function findAutomationChoice(context: any, choices: AutomationChoice[]) {
  const candidates = incomingCandidates(context);
  if (!candidates.length) return null;
  for (const choice of [...choices].filter((item) => item.enabled).sort((a, b) => a.sortOrder - b.sortOrder)) {
    const tokens = [choice.key, choice.label, `${choice.emoji} ${choice.label}`, ...choice.aliases]
      .map(normalized)
      .filter(Boolean);
    if (candidates.some((candidate) => tokens.includes(candidate))) return choice;
  }
  return null;
}

function platformAndWorker(event: any, context: any) {
  const payload = context?.payload || {};
  const platformCode = clean(
    event?.source || context?.conversation?.channel_code || payload?.platform || payload?.channel,
  ).toLowerCase();
  const workerCode = clean(
    payload?.workerCode || payload?.worker_code || payload?.entryFlowProvider || payload?.entry_flow_provider || platformCode,
  ).toLowerCase();
  return { platformCode, workerCode };
}

function bindingEnabled(settings: CustomerAutomationSettings, platformCode: string, workerCode: string) {
  return settings.bindings.some((binding) => (
    binding.enabled && binding.platformCode === platformCode && binding.workerCode === workerCode
  ));
}

function entryText(settings: CustomerAutomationSettings) {
  const choiceLines = [...settings.choices]
    .filter((choice) => choice.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((choice) => `${choice.emoji ? `${choice.emoji} ` : ""}${choice.label}`)
    .join("\n");
  return [settings.messages.greeting, settings.messages.servicePrompt, choiceLines]
    .map(clean)
    .filter(Boolean)
    .join("\n\n");
}

function entryButtons(settings: CustomerAutomationSettings) {
  return [...settings.choices]
    .filter((choice) => choice.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, 3)
    .map((choice) => ({
      id: choice.key,
      title: `${choice.emoji ? `${choice.emoji} ` : ""}${choice.label}`.trim(),
    }));
}

function financePrompt(settings: CustomerAutomationSettings, state: "awaiting_name" | "awaiting_car" | "awaiting_phone") {
  if (state === "awaiting_name") {
    return [settings.flows.finance.startMessage, settings.flows.finance.nameQuestion]
      .map(clean)
      .filter(Boolean)
      .join("\n");
  }
  if (state === "awaiting_car") return clean(settings.flows.finance.carQuestion);
  return clean(settings.flows.finance.phoneQuestion);
}

function policyAllows(lastStartedAt: unknown, settings: CustomerAutomationSettings) {
  const interval = intervalMilliseconds(settings);
  if (!interval) return true;
  const timestamp = new Date(String(lastStartedAt || "")).getTime();
  return !Number.isFinite(timestamp) || Date.now() - timestamp >= interval;
}

function settingsForSession(session: any, current: CustomerAutomationSettings) {
  if (!session?.settings_snapshot || typeof session.settings_snapshot !== "object") return current;
  return normalizeCustomerAutomationSettings(session.settings_snapshot);
}

async function sendAutomationMessage(message: AutomationMessage) {
  if (!clean(message.text)) throw new Error("رسالة الأوتوميشن المطلوبة فارغة");
  return deliverConversationMessage({
    conversationId: message.conversationId,
    text: message.text,
    senderType: "bot",
    idempotencyKey: message.idempotencyKey,
    reason: message.reason,
    buttons: message.buttons,
    awaitProvider: true,
  });
}

async function logSessionEvent(tx: any, input: {
  sessionId: string;
  eventKey: string;
  eventType: string;
  stateBefore?: SessionState | null;
  stateAfter?: SessionState | null;
  messageId?: string | null;
  payload?: Record<string, unknown>;
}) {
  await tx`
    insert into crm.customer_automation_session_events(
      session_id,event_key,event_type,state_before,state_after,message_id,payload
    ) values(
      ${input.sessionId}::uuid,${input.eventKey},${input.eventType},${input.stateBefore || null},${input.stateAfter || null},
      ${input.messageId || null},${tx.json((input.payload || {}) as any)}
    )
    on conflict(event_key) do nothing
  `;
}

async function saveCapturedName(tx: any, session: any, value: string) {
  const customerName = clean(value).replace(/\s+/g, " ");
  if (customerName.length < 2) return null;
  if (!session.lead_id) throw new Error("طلب التمويل غير مربوط بملف عميل");

  await tx`
    update crm.contacts set
      display_name=${customerName},
      metadata=coalesce(metadata,'{}'::jsonb)||${tx.json({ automationCapturedName: true })}::jsonb,
      updated_at=now()
    where id=${session.contact_id}::uuid
  `;
  await tx`
    update crm.conversations set customer_name=${customerName},updated_at=now()
    where id=${session.conversation_id}::uuid
  `;
  await tx`
    update crm.leads set customer_name=${customerName},updated_at=now()
    where id=${session.lead_id}::uuid and is_deleted=false
  `;
  return customerName;
}

async function keepCapturedName(tx: any, session: any) {
  const customerName = clean(session.customer_name);
  if (!customerName) return;
  await tx`update crm.contacts set display_name=${customerName},updated_at=now() where id=${session.contact_id}::uuid`;
  await tx`update crm.conversations set customer_name=${customerName},updated_at=now() where id=${session.conversation_id}::uuid`;
  if (session.lead_id) {
    await tx`update crm.leads set customer_name=${customerName},updated_at=now() where id=${session.lead_id}::uuid and is_deleted=false`;
  }
}

async function saveCapturedCar(tx: any, session: any, value: string) {
  const carName = clean(value).replace(/\s+/g, " ");
  if (carName.length < 2) return null;
  if (!session.lead_id) throw new Error("طلب التمويل غير مربوط بملف عميل");
  await keepCapturedName(tx, session);
  await tx`
    update crm.leads set car_name=${carName},car_type=${carName},updated_at=now()
    where id=${session.lead_id}::uuid and is_deleted=false
  `;
  return carName;
}

async function saveCapturedPhone(tx: any, session: any, value: string) {
  const phone = clean(value);
  const phoneNormalized = normalizePhone(phone);
  if (!phoneNormalized) return { ok: false as const, reason: "invalid" };
  if (!session.lead_id) throw new Error("طلب التمويل غير مربوط بملف عميل");

  const [duplicateContact] = await tx<any[]>`
    select id::text,display_name from crm.contacts
    where primary_phone_normalized=${phoneNormalized} and id<>${session.contact_id}::uuid
    limit 1
  `;
  const [duplicateLead] = await tx<any[]>`
    select id::text,customer_name from crm.leads
    where phone_normalized=${phoneNormalized} and id<>${session.lead_id}::uuid and is_deleted=false
    limit 1
  `;
  if (duplicateContact || duplicateLead) return { ok: false as const, reason: "duplicate" };

  await keepCapturedName(tx, session);
  await tx`
    update crm.contacts set primary_phone=${phone},primary_phone_normalized=${phoneNormalized},updated_at=now()
    where id=${session.contact_id}::uuid
  `;
  await tx`
    update crm.leads set phone=${phone},phone_normalized=${phoneNormalized},updated_at=now()
    where id=${session.lead_id}::uuid and is_deleted=false
  `;
  return { ok: true as const, phone, phoneNormalized };
}

export async function processCustomerAutomationInbound(input: CustomerAutomationInbound): Promise<ProcessResult> {
  const event = input.event;
  const context = input.context;
  const conversationId = clean(event?.conversation_id);
  const contactId = clean(event?.contact_id);
  if (!conversationId || !contactId) {
    return { handled: false, consumed: false, action: "skipped", reason: "missing_contact_or_conversation" };
  }

  const currentSettings = await loadCustomerAutomationSettings();
  if (!currentSettings?.enabled) {
    return { handled: false, consumed: false, action: "skipped", reason: "automation_disabled" };
  }

  const { platformCode, workerCode } = platformAndWorker(event, context);
  if (!bindingEnabled(currentSettings, platformCode, workerCode)) {
    return { handled: false, consumed: false, action: "skipped", reason: "platform_worker_not_enabled" };
  }

  const sql = getSql();
  const eventKey = clean(event.event_key);
  const messageId = clean(context?.payload?.messageId || context?.payload?.message_id);
  const answerText = clean(context?.event?.text);

  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${contactId}))`;

    const [session] = await tx<any[]>`
      select *,id::text,contact_id::text,conversation_id::text,service_request_id::text,lead_id::text,last_outbound_message_id::text
      from crm.customer_automation_sessions
      where contact_id=${contactId}::uuid
        and state in ('awaiting_service','awaiting_name','awaiting_car','awaiting_phone')
      order by started_at desc
      limit 1
      for update
    `;

    if (!session) {
      const [latest] = await tx<any[]>`
        select started_at from crm.customer_automation_sessions
        where contact_id=${contactId}::uuid
        order by started_at desc limit 1
      `;
      if (!policyAllows(latest?.started_at, currentSettings)) {
        return { handled: false, consumed: false, action: "skipped", reason: "trigger_policy_cooldown" };
      }

      const [created] = await tx<any[]>`
        insert into crm.customer_automation_sessions(
          contact_id,conversation_id,platform_code,worker_code,state,last_inbound_event_key,last_inbound_message_id,
          settings_version,settings_snapshot
        ) values(
          ${contactId}::uuid,${conversationId}::uuid,${platformCode},${workerCode},'awaiting_service',${eventKey},${messageId || null},
          ${currentSettings.version},${tx.json(currentSettings as any)}
        )
        returning *,id::text,contact_id::text,conversation_id::text
      `;

      const delivery = await sendAutomationMessage({
        conversationId,
        text: entryText(currentSettings),
        buttons: entryButtons(currentSettings),
        idempotencyKey: `customer-automation:entry:${contactId}:${eventKey}`,
        reason: "customer_automation_entry",
      });
      await tx`
        update crm.customer_automation_sessions set
          last_outbound_key=${`customer-automation:entry:${contactId}:${eventKey}`},
          last_outbound_message_id=${delivery.message?.id || null}::uuid,last_activity_at=now(),updated_at=now()
        where id=${created.id}::uuid
      `;
      await logSessionEvent(tx, {
        sessionId: created.id,
        eventKey,
        eventType: "flow.started",
        stateAfter: "awaiting_service",
        messageId,
        payload: { platformCode, workerCode },
      });
      return { handled: true, consumed: true, action: "started", sessionId: created.id, state: "awaiting_service" };
    }

    if (session.last_inbound_event_key === eventKey) {
      return { handled: true, consumed: true, action: "duplicate", sessionId: session.id, state: session.state };
    }

    const settings = settingsForSession(session, currentSettings);
    const state = session.state as SessionState;

    if (state === "awaiting_service") {
      const choice = findAutomationChoice(context, settings.choices);
      if (!choice) {
        const idempotencyKey = `customer-automation:no-match:${session.id}:${eventKey}`;
        const delivery = await sendAutomationMessage({
          conversationId: session.conversation_id,
          text: settings.messages.noMatch,
          buttons: entryButtons(settings),
          idempotencyKey,
          reason: "customer_automation_no_match",
        });
        await tx`
          update crm.customer_automation_sessions set
            last_inbound_event_key=${eventKey},last_inbound_message_id=${messageId || null},last_outbound_key=${idempotencyKey},
            last_outbound_message_id=${delivery.message?.id || null}::uuid,last_activity_at=now(),updated_at=now()
          where id=${session.id}::uuid
        `;
        await logSessionEvent(tx, {
          sessionId: session.id,
          eventKey,
          eventType: "service.invalid",
          stateBefore: state,
          stateAfter: state,
          messageId,
          payload: { text: answerText },
        });
        return { handled: true, consumed: true, action: "no_match", sessionId: session.id, state };
      }

      const classified = await classifyConversationService({
        conversationId: session.conversation_id,
        serviceKey: choice.key,
        sourceCode: platformCode,
        classificationMethod: "customer_automation",
        actor: input.actor,
        eventKey,
      });
      const leadId = clean(classified.leadId || classified.request?.lead_id);
      const requestId = clean(classified.request?.id);
      if (!leadId || !requestId) throw new Error("تعذر ربط اختيار الخدمة بطلب العميل");

      if (choice.key === "finance") {
        const nextState: SessionState = "awaiting_name";
        const idempotencyKey = `customer-automation:finance-name:${session.id}:${eventKey}`;
        const delivery = await sendAutomationMessage({
          conversationId: session.conversation_id,
          text: financePrompt(settings, nextState),
          idempotencyKey,
          reason: "customer_automation_finance_name",
        });
        await tx`
          update crm.customer_automation_sessions set
            service_request_id=${requestId}::uuid,lead_id=${leadId}::uuid,choice_key='finance',service_key='finance',state=${nextState},
            last_inbound_event_key=${eventKey},last_inbound_message_id=${messageId || null},last_outbound_key=${idempotencyKey},
            last_outbound_message_id=${delivery.message?.id || null}::uuid,last_activity_at=now(),updated_at=now()
          where id=${session.id}::uuid
        `;
        await logSessionEvent(tx, {
          sessionId: session.id,
          eventKey,
          eventType: "service.selected",
          stateBefore: state,
          stateAfter: nextState,
          messageId,
          payload: { choice: choice.key, leadId, requestId },
        });
        return { handled: true, consumed: true, action: "service_selected", sessionId: session.id, serviceKey: "finance", state: nextState };
      }

      const nextState: SessionState = "completed";
      const completionText = choice.key === "cash"
        ? settings.flows.cash.completionMessage
        : settings.flows.service.completionMessage;
      const idempotencyKey = `customer-automation:${choice.key}-completion:${session.id}:${eventKey}`;
      const delivery = await sendAutomationMessage({
        conversationId: session.conversation_id,
        text: completionText,
        idempotencyKey,
        reason: `customer_automation_${choice.key}_completion`,
      });
      await tx`
        update crm.customer_automation_sessions set
          service_request_id=${requestId}::uuid,lead_id=${leadId}::uuid,choice_key=${choice.key},service_key=${choice.key},state=${nextState},
          last_inbound_event_key=${eventKey},last_inbound_message_id=${messageId || null},last_outbound_key=${idempotencyKey},
          last_outbound_message_id=${delivery.message?.id || null}::uuid,last_activity_at=now(),completed_at=now(),updated_at=now()
        where id=${session.id}::uuid
      `;
      await logSessionEvent(tx, {
        sessionId: session.id,
        eventKey,
        eventType: "flow.completed",
        stateBefore: state,
        stateAfter: nextState,
        messageId,
        payload: { choice: choice.key, leadId, requestId },
      });
      return { handled: true, consumed: true, action: "completed", sessionId: session.id, serviceKey: choice.key, state: nextState };
    }

    if (state === "awaiting_name") {
      const customerName = await saveCapturedName(tx, session, answerText);
      if (!customerName) {
        const idempotencyKey = `customer-automation:name-error:${session.id}:${eventKey}`;
        const delivery = await sendAutomationMessage({
          conversationId: session.conversation_id,
          text: settings.flows.finance.nameError,
          idempotencyKey,
          reason: "customer_automation_name_error",
        });
        await tx`
          update crm.customer_automation_sessions set
            last_inbound_event_key=${eventKey},last_inbound_message_id=${messageId || null},last_outbound_key=${idempotencyKey},
            last_outbound_message_id=${delivery.message?.id || null}::uuid,last_activity_at=now(),updated_at=now()
          where id=${session.id}::uuid
        `;
        await logSessionEvent(tx, { sessionId: session.id, eventKey, eventType: "answer.invalid", stateBefore: state, stateAfter: state, messageId });
        return { handled: true, consumed: true, action: "validation_error", sessionId: session.id, state };
      }

      const nextState: SessionState = "awaiting_car";
      const idempotencyKey = `customer-automation:car-question:${session.id}:${eventKey}`;
      const delivery = await sendAutomationMessage({
        conversationId: session.conversation_id,
        text: financePrompt(settings, nextState),
        idempotencyKey,
        reason: "customer_automation_finance_car",
      });
      await tx`
        update crm.customer_automation_sessions set
          customer_name=${customerName},state=${nextState},last_inbound_event_key=${eventKey},last_inbound_message_id=${messageId || null},
          last_outbound_key=${idempotencyKey},last_outbound_message_id=${delivery.message?.id || null}::uuid,last_activity_at=now(),updated_at=now()
        where id=${session.id}::uuid
      `;
      await logSessionEvent(tx, {
        sessionId: session.id,
        eventKey,
        eventType: "answer.saved",
        stateBefore: state,
        stateAfter: nextState,
        messageId,
        payload: { field: "customer_name", value: customerName },
      });
      return { handled: true, consumed: true, action: "answer_saved", sessionId: session.id, state: nextState };
    }

    if (state === "awaiting_car") {
      const carName = await saveCapturedCar(tx, session, answerText);
      if (!carName) {
        const idempotencyKey = `customer-automation:car-error:${session.id}:${eventKey}`;
        const delivery = await sendAutomationMessage({
          conversationId: session.conversation_id,
          text: settings.flows.finance.carError,
          idempotencyKey,
          reason: "customer_automation_car_error",
        });
        await tx`
          update crm.customer_automation_sessions set
            last_inbound_event_key=${eventKey},last_inbound_message_id=${messageId || null},last_outbound_key=${idempotencyKey},
            last_outbound_message_id=${delivery.message?.id || null}::uuid,last_activity_at=now(),updated_at=now()
          where id=${session.id}::uuid
        `;
        await logSessionEvent(tx, { sessionId: session.id, eventKey, eventType: "answer.invalid", stateBefore: state, stateAfter: state, messageId });
        return { handled: true, consumed: true, action: "validation_error", sessionId: session.id, state };
      }

      const nextState: SessionState = "awaiting_phone";
      const idempotencyKey = `customer-automation:phone-question:${session.id}:${eventKey}`;
      const delivery = await sendAutomationMessage({
        conversationId: session.conversation_id,
        text: financePrompt(settings, nextState),
        idempotencyKey,
        reason: "customer_automation_finance_phone",
      });
      await tx`
        update crm.customer_automation_sessions set
          car_name=${carName},state=${nextState},last_inbound_event_key=${eventKey},last_inbound_message_id=${messageId || null},
          last_outbound_key=${idempotencyKey},last_outbound_message_id=${delivery.message?.id || null}::uuid,last_activity_at=now(),updated_at=now()
        where id=${session.id}::uuid
      `;
      await logSessionEvent(tx, {
        sessionId: session.id,
        eventKey,
        eventType: "answer.saved",
        stateBefore: state,
        stateAfter: nextState,
        messageId,
        payload: { field: "car_name", value: carName },
      });
      return { handled: true, consumed: true, action: "answer_saved", sessionId: session.id, state: nextState };
    }

    if (state === "awaiting_phone") {
      const phoneResult = await saveCapturedPhone(tx, session, answerText);
      if (!phoneResult.ok) {
        const idempotencyKey = `customer-automation:phone-error:${session.id}:${eventKey}`;
        const delivery = await sendAutomationMessage({
          conversationId: session.conversation_id,
          text: settings.flows.finance.phoneError,
          idempotencyKey,
          reason: "customer_automation_phone_error",
        });
        await tx`
          update crm.customer_automation_sessions set
            last_inbound_event_key=${eventKey},last_inbound_message_id=${messageId || null},last_outbound_key=${idempotencyKey},
            last_outbound_message_id=${delivery.message?.id || null}::uuid,last_activity_at=now(),updated_at=now()
          where id=${session.id}::uuid
        `;
        await logSessionEvent(tx, {
          sessionId: session.id,
          eventKey,
          eventType: "answer.invalid",
          stateBefore: state,
          stateAfter: state,
          messageId,
          payload: { reason: phoneResult.reason },
        });
        return { handled: true, consumed: true, action: "validation_error", sessionId: session.id, state };
      }

      const nextState: SessionState = "completed";
      const idempotencyKey = `customer-automation:finance-completion:${session.id}:${eventKey}`;
      const delivery = await sendAutomationMessage({
        conversationId: session.conversation_id,
        text: settings.flows.finance.completionMessage,
        idempotencyKey,
        reason: "customer_automation_finance_completion",
      });
      await tx`
        update crm.customer_automation_sessions set
          phone=${phoneResult.phone},phone_normalized=${phoneResult.phoneNormalized},state=${nextState},
          last_inbound_event_key=${eventKey},last_inbound_message_id=${messageId || null},last_outbound_key=${idempotencyKey},
          last_outbound_message_id=${delivery.message?.id || null}::uuid,last_activity_at=now(),completed_at=now(),updated_at=now()
        where id=${session.id}::uuid
      `;
      await logSessionEvent(tx, {
        sessionId: session.id,
        eventKey,
        eventType: "flow.completed",
        stateBefore: state,
        stateAfter: nextState,
        messageId,
        payload: { field: "phone", phoneNormalized: phoneResult.phoneNormalized },
      });
      return { handled: true, consumed: true, action: "completed", sessionId: session.id, serviceKey: "finance", state: nextState };
    }

    return { handled: true, consumed: true, action: "skipped", sessionId: session.id, reason: "invalid_active_state", state };
  });
}
