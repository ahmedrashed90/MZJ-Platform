import type { SessionUser } from "./_auth.js";
import { classifyConversationService } from "./_crm-lifecycle.js";
import { deliverConversationMessage } from "./_crm-messaging.js";
import {
  canonicalAutomationPlatform,
  customerAutomationBindingEnabled,
  getCustomerAutomationSettings,
  intervalSeconds,
  normalizeCustomerAutomationSettings,
  type AutomationServiceOption,
  type AutomationStep,
  type CustomerAutomationSettings,
} from "./_crm-customer-automation-settings.js";
import { clean, normalizePhone } from "./_crm-utils.js";
import { getSql } from "./_db.js";

function normalized(value: unknown) {
  return clean(value).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[ـ]/g, "").replace(/[\s_-]+/g, " ");
}


function flowExpiresAt(settings: CustomerAutomationSettings) {
  return new Date(Date.now() + intervalSeconds(settings.flowTimeoutValue, settings.flowTimeoutUnit) * 1000).toISOString();
}

function settingsForRun(current: CustomerAutomationSettings, run: any): CustomerAutomationSettings {
  const snapshot = run?.settings_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return current;
  return normalizeCustomerAutomationSettings(snapshot);
}

function withinSchedule(settings: CustomerAutomationSettings, now = new Date()) {
  if (!settings.scheduleEnabled) return true;
  const riyadh = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const day = riyadh.getUTCDay();
  if (!settings.scheduleDays.includes(day)) return false;
  const minutes = riyadh.getUTCHours() * 60 + riyadh.getUTCMinutes();
  const parse = (value: string) => {
    const [hour, minute] = String(value || "00:00").split(":").map(Number);
    return hour * 60 + minute;
  };
  const start = parse(settings.scheduleStart);
  const end = parse(settings.scheduleEnd);
  if (start === end) return true;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}


function optionDisplay(option: AutomationServiceOption) {
  return `${option.emoji ? `${option.emoji} ` : ""}${option.label}`;
}

function optionCandidates(event: any, context: any) {
  const payload = context?.payload || event?.payload || {};
  const nested = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || {};
  return [
    context?.event?.text,
    payload.serviceSelectionKey,
    payload.service_selection_key,
    payload.serviceKey,
    payload.service_key,
    payload.buttonPayload,
    payload.button_payload,
    payload.payload,
    nested?.button?.payload,
    nested?.interactive?.button_reply?.id,
    nested?.interactive?.button_reply?.title,
    nested?.interactive?.list_reply?.id,
    nested?.interactive?.list_reply?.title,
  ].map(normalized).filter(Boolean);
}

export function detectAutomationServiceChoice(event: any, context: any, options: AutomationServiceOption[]) {
  const candidates = optionCandidates(event, context);
  if (!candidates.length) return null;
  const active = options.filter((row) => row.active).sort((a, b) => a.sortOrder - b.sortOrder);
  for (const candidate of candidates) {
    if (!/^\d+$/.test(candidate)) continue;
    const numericIndex = Number(candidate) - 1;
    if (numericIndex >= 0 && numericIndex < active.length) return active[numericIndex];
  }
  const textCandidates = candidates.filter((candidate) => !/^\d+$/.test(candidate));
  for (const option of active) {
    const accepted = [option.key, option.serviceKey, option.label, ...option.aliases.filter((alias) => !/^\d+$/.test(normalized(alias)))]
      .map(normalized).filter(Boolean);
    if (textCandidates.some((candidate) => accepted.includes(candidate))) return option;
  }
  return null;
}

function keywordMatch(text: unknown, keywords: string[]) {
  const value = normalized(text);
  return Boolean(value && keywords.map(normalized).some((word) => word && value === word));
}

const FINANCE_STEP_ORDER = ["name", "car", "phone"] as const;

function activeSteps(option: AutomationServiceOption) {
  if (option.flowType === "message") return [];
  if (option.key === "finance") {
    const byKey = new Map(option.steps.filter((row) => row.active).map((row) => [row.key, row]));
    return FINANCE_STEP_ORDER.map((key) => byKey.get(key)).filter((row): row is AutomationStep => Boolean(row));
  }
  return option.steps.filter((row) => row.active).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function nextAutomationStepIndex(option: AutomationServiceOption, answeredStepKey: string) {
  const steps = activeSteps(option);
  const answeredIndex = steps.findIndex((row) => row.key === clean(answeredStepKey));
  return answeredIndex < 0 ? 0 : answeredIndex + 1;
}

function validateAnswer(step: AutomationStep, raw: unknown) {
  const text = clean(raw);
  if (step.answerType === "message") return { ok: true, value: "" };
  if (!text && step.required) return { ok: false, value: "" };
  if (!text) return { ok: true, value: "" };
  if (step.answerType === "phone") {
    const phone = normalizePhone(text);
    return phone ? { ok: true, value: phone } : { ok: false, value: text };
  }
  if (step.answerType === "number") {
    const value = Number(text.replace(/,/g, ""));
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, value: text };
  }
  if (step.answerType === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? { ok: true, value: text.toLowerCase() } : { ok: false, value: text };
  }
  if (step.answerType === "date") {
    const value = new Date(text);
    return Number.isNaN(value.getTime()) ? { ok: false, value: text } : { ok: true, value: value.toISOString().slice(0, 10) };
  }
  if (step.answerType === "select") {
    const candidate = normalized(text);
    const match = step.options.find((row, index) => [row.value, row.label, String(index + 1)].map(normalized).includes(candidate));
    return match ? { ok: true, value: match.value } : { ok: false, value: text };
  }
  return { ok: true, value: text.replace(/\s+/g, " ").trim() };
}

async function validateAnswerAvailability(tx: any, leadId: string | null, contactId: string | null, step: AutomationStep, value: any) {
  if (!leadId || step.fieldKey !== "phone") return { ok: true as const };
  const phone = normalizePhone(value);
  if (!phone) return { ok: false as const, errorMessage: step.errorMessage };
  const [duplicate] = await tx<any[]>`
    select 1 as found
    where exists(
      select 1 from crm.leads
      where phone_normalized=${phone} and id<>${leadId}::uuid and is_deleted=false
    ) or exists(
      select 1 from crm.contacts
      where primary_phone_normalized=${phone}
        and (${contactId || null}::uuid is null or id<>${contactId || null}::uuid)
    )
    limit 1
  `;
  return duplicate
    ? { ok: false as const, errorMessage: step.errorMessage }
    : { ok: true as const };
}

async function saveLeadAnswer(sql: any, leadId: string | null, contactId: string | null, step: AutomationStep, value: any) {
  if (!leadId || !step.fieldKey || step.answerType === "message") return;
  const field = clean(step.fieldKey);
  const columns = new Set([
    "customer_name", "phone", "age", "salary", "obligation", "salary_bank", "location", "car_name", "car_type", "car_model", "car_category", "color", "finance_type", "notes", "campaign_name", "campaign_date",
  ]);
  if (field === "phone") {
    const phone = normalizePhone(value);
    if (!phone) throw new Error("invalid_phone_answer");
    await sql`update crm.leads set phone=${phone},phone_normalized=${phone},updated_at=now() where id=${leadId}::uuid`;
  } else if (columns.has(field)) {
    await sql.unsafe(`update crm.leads set ${field}=$1,updated_at=now() where id=$2::uuid`, [value === "" ? null : value, leadId]);
  } else {
    await sql`
      update crm.leads set extra_data=coalesce(extra_data,'{}'::jsonb)||${sql.json({ [field]: value })}::jsonb,updated_at=now()
      where id=${leadId}::uuid
    `;
  }
  if (field === "customer_name" && contactId) {
    await sql`update crm.contacts set display_name=${clean(value)||"عميل"},updated_at=now() where id=${contactId}::uuid`;
    await sql`update crm.conversations set customer_name=${clean(value)||"عميل"},updated_at=now() where contact_id=${contactId}::uuid`;
  }
  if (field === "phone" && contactId) {
    const phone = normalizePhone(value);
    if (phone) await sql`update crm.contacts set primary_phone=${phone},primary_phone_normalized=${phone},updated_at=now() where id=${contactId}::uuid`;
  }
}

async function send(runId: string, conversationId: string, stage: string, text: string, buttons: any[] = []) {
  const finalText = clean(text);
  if (!finalText) return null;
  const result = await deliverConversationMessage({
    conversationId,
    text: finalText,
    senderType: "bot",
    idempotencyKey: `customer-automation:${runId}:${stage}`,
    reason: "customer_automation",
    buttons,
    waitForProvider: true,
  });
  const sql = getSql();
  await sql`update crm.customer_automation_runs set last_automation_message=${finalText},updated_at=now() where id=${runId}::uuid`;
  return result;
}

async function sendStartSequence(run: any, settings: CustomerAutomationSettings) {
  const options = settings.serviceOptions.filter((row) => row.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const list = options.map(optionDisplay).join("\n");
  const prompt = [
    settings.messages.welcome.enabled ? settings.messages.welcome.text : "",
    settings.messages.servicePrompt.enabled ? settings.messages.servicePrompt.text : "",
    list,
  ].filter(Boolean).join("\n\n");
  const buttons = options.length <= 3
    ? options.map((row) => ({ id: row.key, title: `${row.emoji ? `${row.emoji} ` : ""}${row.label}`.slice(0, 20) }))
    : [];
  await send(run.id, run.conversation_id, "service-list", prompt, buttons);
}

async function triggerAllowed(tx: any, conversationId: string, contactId: string, settings: CustomerAutomationSettings) {
  if (settings.triggerMode === "every_message") return true;
  const seconds = settings.triggerMode === "once_24h" ? 86400 : intervalSeconds(settings.customIntervalValue, settings.customIntervalUnit);
  const [recent] = await tx`
    select id from crm.customer_automation_runs
    where (conversation_id=${conversationId}::uuid or (${contactId || null}::uuid is not null and contact_id=${contactId || null}::uuid))
      and started_at > now()-(${seconds}||' seconds')::interval
    order by started_at desc limit 1
  `;
  return !recent;
}

type Plan =
  | { type: "skip"; reason: string }
  | { type: "start"; run: any }
  | { type: "cancel"; run: any }
  | { type: "restart"; run: any }
  | { type: "no_match"; run: any }
  | { type: "choice"; run: any; option: AutomationServiceOption }
  | { type: "invalid"; run: any; step: AutomationStep; errorMessage?: string }
  | { type: "max_attempts"; run: any; step: AutomationStep }
  | { type: "answer"; run: any; option: AutomationServiceOption; step: AutomationStep; value: any; nextStep: AutomationStep | null; nextStepIndex: number };

async function planInbound(event: any, context: any, settings: CustomerAutomationSettings, platformCode: string, workerCode: string): Promise<Plan> {
  const conversationId = clean(event.conversation_id);
  const contactId = clean(context?.conversation?.contact_id || event.contact_id);
  const eventKey = clean(event.event_key);
  const messageId = clean(context?.payload?.messageId || context?.payload?.providerMessageId);
  if (!conversationId) return { type: "skip", reason: "no_conversation" };
  const sql = getSql();

  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${contactId ? `customer-automation-contact:${contactId}` : `customer-automation-conversation:${conversationId}`}))`;
    let [run] = await tx<any[]>`
      select *,id::text,contact_id::text,conversation_id::text,service_request_id::text,lead_id::text
      from crm.customer_automation_runs
      where (conversation_id=${conversationId}::uuid or (${contactId || null}::uuid is not null and contact_id=${contactId || null}::uuid))
        and status in ('awaiting_service','classifying','awaiting_step')
      order by case when conversation_id=${conversationId}::uuid then 0 else 1 end,started_at desc
      limit 1 for update
    `;
    if (run?.expires_at && new Date(run.expires_at).getTime() <= Date.now()) {
      await tx`update crm.customer_automation_runs set status='timed_out',termination_reason='flow_timeout',completed_at=now(),updated_at=now() where id=${run.id}::uuid`;
      await tx`update crm.conversations set classification_state=case when service_request_id is null then 'new' else classification_state end,updated_at=now() where id=${run.conversation_id}::uuid`;
      run = null;
    }
    if (run && clean(run.conversation_id) !== conversationId) {
      return { type: "skip", reason: "active_flow_on_another_conversation" };
    }

    const effectiveSettings = run ? settingsForRun(settings, run) : settings;
    const incomingText = context?.event?.text;
    if (run?.status === "classifying" && run.current_step_key) {
      // A previous request may have persisted the next expected step before its response
      // finished. Recover that durable state instead of leaving all later messages deferred.
      [run] = await tx<any[]>`
        update crm.customer_automation_runs set status='awaiting_step',updated_at=now()
        where id=${run.id}::uuid
        returning *,id::text,contact_id::text,conversation_id::text,service_request_id::text,lead_id::text
      `;
    }
    if (run?.status === "classifying") {
      await tx`update crm.automation_events set status='deferred',processed_at=null where id=${event.id}::uuid and status='processing'`;
      return { type: "skip", reason: "flow_deferred" };
    }
    if (run && keywordMatch(incomingText, effectiveSettings.cancelKeywords)) {
      [run] = await tx<any[]>`update crm.customer_automation_runs set status='cancelled',termination_reason='customer_cancelled',completed_at=now(),last_event_key=${eventKey},last_message_id=${messageId||null},last_message_at=now(),updated_at=now() where id=${run.id}::uuid returning *,id::text,conversation_id::text`;
      await tx`update crm.conversations set classification_state=case when service_request_id is null then 'new' else classification_state end,updated_at=now() where id=${conversationId}::uuid`;
      return { type: "cancel", run };
    }
    if (run && keywordMatch(incomingText, effectiveSettings.restartKeywords)) {
      await tx`update crm.customer_automation_runs set status='cancelled',termination_reason='customer_restarted',completed_at=now(),last_event_key=${eventKey},last_message_id=${messageId||null},updated_at=now() where id=${run.id}::uuid`;
      [run] = await tx<any[]>`
        insert into crm.customer_automation_runs(contact_id,conversation_id,platform_code,worker_code,status,last_event_key,last_message_id,expires_at,automation_version,settings_snapshot,history)
        values(${contactId||null}::uuid,${conversationId}::uuid,${platformCode},${workerCode},'classifying',${eventKey},${messageId||null},${flowExpiresAt(settings)}::timestamptz,${settings.version||1},${tx.json(settings)},'[]'::jsonb)
        returning *,id::text,conversation_id::text,contact_id::text
      `;
      await tx`update crm.conversations set classification_state='awaiting_service',service_selection_sent_at=now(),service_selection_version=service_selection_version+1,updated_at=now() where id=${conversationId}::uuid`;
      return { type: "restart", run };
    }

    if (!run) {
      const [openRequest] = await tx<any[]>`
        select id from crm.service_requests
        where conversation_id=${conversationId}::uuid and request_state='open'
        order by opened_at desc limit 1
      `;
      if (openRequest) return { type: "skip", reason: "open_service_request_exists" };
      if (!withinSchedule(settings)) return { type: "skip", reason: "outside_schedule" };
      if (!(await triggerAllowed(tx, conversationId, contactId, settings))) return { type: "skip", reason: "trigger_cooldown" };

      // The first inbound message only starts the automation. Its text or button payload
      // must never be consumed as a service choice, even when it equals 1, 2, 3, or an
      // option key. The customer chooses a service only after the start sequence is sent.
      [run] = await tx<any[]>`
        insert into crm.customer_automation_runs(contact_id,conversation_id,platform_code,worker_code,status,option_key,service_key,last_event_key,last_message_id,expires_at,automation_version,settings_snapshot,history)
        values(${contactId||null}::uuid,${conversationId}::uuid,${platformCode},${workerCode},'classifying',null,null,${eventKey},${messageId||null},${flowExpiresAt(settings)}::timestamptz,${settings.version||1},${tx.json(settings)},
          ${tx.json([{ at: new Date().toISOString(), action: "started", eventKey }])})
        returning *,id::text,conversation_id::text,contact_id::text
      `;
      await tx`update crm.conversations set classification_state='awaiting_service',service_selection_sent_at=now(),service_selection_version=service_selection_version+1,updated_at=now() where id=${conversationId}::uuid`;
      return { type: "start", run };
    }

    if (run.status === "awaiting_service") {
      const option = detectAutomationServiceChoice(event, context, effectiveSettings.serviceOptions);
      if (!option) {
        [run] = await tx<any[]>`
          update crm.customer_automation_runs set status='awaiting_service',last_event_key=${eventKey},last_message_id=${messageId||null},last_message_at=now(),expires_at=${flowExpiresAt(effectiveSettings)}::timestamptz,updated_at=now()
          where id=${run.id}::uuid returning *,id::text,conversation_id::text,contact_id::text
        `;
        return { type: "no_match", run };
      }
      [run] = await tx<any[]>`
        update crm.customer_automation_runs set status='classifying',option_key=${option.key},service_key=${option.serviceKey},last_event_key=${eventKey},last_message_id=${messageId||null},last_message_at=now(),expires_at=${flowExpiresAt(effectiveSettings)}::timestamptz,
          history=history||${tx.json([{ at: new Date().toISOString(), action: "service_selected", optionKey: option.key, serviceKey: option.serviceKey }])}::jsonb,updated_at=now()
        where id=${run.id}::uuid returning *,id::text,conversation_id::text,contact_id::text
      `;
      return { type: "choice", run, option };
    }

    const option = effectiveSettings.serviceOptions.find((row) => row.key === run.option_key);
    if (!option) {
      await tx`update crm.customer_automation_runs set status='cancelled',termination_reason='option_missing',completed_at=now(),updated_at=now() where id=${run.id}::uuid`;
      return { type: "skip", reason: "option_missing" };
    }
    const steps = activeSteps(option);
    const storedStepIndex = run.current_step_key
      ? steps.findIndex((row) => row.key === clean(run.current_step_key))
      : Number(run.current_step_index || 0);
    const currentStepIndex = storedStepIndex >= 0 ? storedStepIndex : Number(run.current_step_index || 0);
    const step = steps[currentStepIndex];
    if (!step) return { type: "skip", reason: "step_missing" };
    const validated = validateAnswer(step, incomingText);
    const availability = validated.ok ? await validateAnswerAvailability(tx, run.lead_id || null, run.contact_id || null, step, validated.value) : { ok: true as const };
    if (!validated.ok || !availability.ok) {
      const attempt = Number(run.current_attempt || 0) + 1;
      if (attempt >= Math.max(1, Number(step.maxAttempts || 3))) {
        [run] = await tx<any[]>`update crm.customer_automation_runs set status='cancelled',current_attempt=${attempt},termination_reason='max_attempts',completed_at=now(),last_event_key=${eventKey},last_message_id=${messageId||null},last_message_at=now(),updated_at=now() where id=${run.id}::uuid returning *,id::text,conversation_id::text`;
        return { type: "max_attempts", run, step: availability.ok ? step : { ...step, errorMessage: availability.errorMessage } };
      }
      [run] = await tx<any[]>`
        update crm.customer_automation_runs set status='awaiting_step',current_attempt=${attempt},last_event_key=${eventKey},last_message_id=${messageId||null},last_message_at=now(),expires_at=${flowExpiresAt(effectiveSettings)}::timestamptz,updated_at=now()
        where id=${run.id}::uuid returning *,id::text,conversation_id::text,contact_id::text,service_request_id::text,lead_id::text
      `;
      return { type: "invalid", run, step, errorMessage: availability.ok ? undefined : availability.errorMessage };
    }
    await saveLeadAnswer(tx, run.lead_id || null, run.contact_id || null, step, validated.value);
    const nextStepIndex = nextAutomationStepIndex(option, step.key);
    const nextStep = steps[nextStepIndex] || null;
    [run] = await tx<any[]>`
      update crm.customer_automation_runs set
        status='classifying',
        current_step_index=${nextStepIndex},
        current_step_key=${nextStep?.key || null},
        current_attempt=0,
        last_event_key=${eventKey},last_message_id=${messageId||null},last_message_at=now(),expires_at=${flowExpiresAt(effectiveSettings)}::timestamptz,
        answers=jsonb_set(coalesce(answers,'{}'::jsonb),${[step.key]},${tx.json(validated.value)}::jsonb,true),
        history=history||${tx.json([{ at: new Date().toISOString(), action: "answer_saved", stepKey: step.key, nextStepKey: nextStep?.key || null }])}::jsonb,updated_at=now()
      where id=${run.id}::uuid returning *,id::text,conversation_id::text,contact_id::text,service_request_id::text,lead_id::text
    `;
    return { type: "answer", run, option, step, value: validated.value, nextStep, nextStepIndex };
  });
}

async function continueFlow(run: any, option: AutomationServiceOption, startIndex: number, introText = "") {
  const steps = activeSteps(option);
  let index = startIndex;
  while (index < steps.length && steps[index].answerType === "message") {
    const step = steps[index];
    const text = [introText, step.prompt].filter(Boolean).join("\n");
    if (text) await send(run.id, run.conversation_id, `message-step:${step.key}`, text);
    introText = "";
    index += 1;
  }
  const next = steps[index];
  const sql = getSql();
  if (next) {
    const text = [introText, next.prompt].filter(Boolean).join("\n");
    // Keep the run in a transition state until the Worker confirms delivery. The customer
    // must never be moved to the next expected answer before its question is actually sent.
    await sql`
      update crm.customer_automation_runs set status='classifying',current_step_index=${index},current_step_key=${next.key},current_attempt=0,termination_reason=null,updated_at=now()
      where id=${run.id}::uuid
    `;
    await send(run.id, run.conversation_id, introText ? `flow-start-question:${next.key}` : `question:${next.key}`, text);
    await sql`
      update crm.customer_automation_runs set status='awaiting_step',current_step_index=${index},current_step_key=${next.key},current_attempt=0,termination_reason=null,updated_at=now()
      where id=${run.id}::uuid
    `;
    return { completed: false, nextStepKey: next.key };
  }
  if (introText) await send(run.id, run.conversation_id, "flow-start", introText);
  if (option.endMessage.enabled) await send(run.id, run.conversation_id, "flow-end", option.endMessage.text);
  await sql`
    update crm.customer_automation_runs set status='completed',current_step_index=${index},current_step_key=null,current_attempt=0,completed_at=now(),termination_reason='flow_completed',updated_at=now()
    where id=${run.id}::uuid
  `;
  return { completed: true, nextStepKey: null };
}

export async function processCustomerAutomationInbound(event: any, context: any, actor?: SessionUser | null) {
  const settings = await getCustomerAutomationSettings();
  const platformCode = canonicalAutomationPlatform(event.source || context?.conversation?.channel_code);
  const workerCode = clean(context?.payload?.workerCode || context?.payload?.routeSource || event.source);
  if (!settings.enabled) return { skipped: true, reason: "automation_disabled" };
  if (!customerAutomationBindingEnabled(settings, platformCode, workerCode)) return { skipped: true, reason: "platform_or_worker_disabled", platformCode, workerCode };

  const plan = await planInbound(event, context, settings, platformCode, workerCode);
  if (plan.type === "skip") return { skipped: true, reason: plan.reason };
  const runtimeSettings = settingsForRun(settings, plan.run);
  if (plan.type === "start") {
    const sql = getSql();
    await sendStartSequence(plan.run, runtimeSettings);
    await sql`update crm.customer_automation_runs set status='awaiting_service',updated_at=now() where id=${plan.run.id}::uuid`;
    return { ok: true, action: "started", runId: plan.run.id };
  }
  if (plan.type === "restart") {
    const sql = getSql();
    if (runtimeSettings.messages.restarted.enabled) await send(plan.run.id, plan.run.conversation_id, "restarted", runtimeSettings.messages.restarted.text);
    await sendStartSequence(plan.run, runtimeSettings);
    await sql`update crm.customer_automation_runs set status='awaiting_service',updated_at=now() where id=${plan.run.id}::uuid`;
    return { ok: true, action: "restarted", runId: plan.run.id };
  }
  if (plan.type === "cancel") {
    if (runtimeSettings.messages.cancelled.enabled) await send(plan.run.id, plan.run.conversation_id, "cancelled", runtimeSettings.messages.cancelled.text);
    return { ok: true, action: "cancelled", runId: plan.run.id };
  }
  if (plan.type === "no_match") {
    const sql = getSql();
    try {
      if (runtimeSettings.messages.noMatch.enabled) await send(plan.run.id, plan.run.conversation_id, `no-match:${clean(event.id)}`, runtimeSettings.messages.noMatch.text);
    } finally {
      await sql`update crm.customer_automation_runs set status='awaiting_service',updated_at=now() where id=${plan.run.id}::uuid`;
    }
    return { skipped: true, reason: "no_service_match", runId: plan.run.id };
  }
  if (plan.type === "invalid") {
    const error = plan.errorMessage || plan.step.errorMessage || runtimeSettings.messages.validationFallback.text;
    const sql = getSql();
    try {
      await send(plan.run.id, plan.run.conversation_id, `validation:${plan.step.key}:${plan.run.current_attempt}`, error);
    } finally {
      await sql`update crm.customer_automation_runs set status='awaiting_step',updated_at=now() where id=${plan.run.id}::uuid`;
    }
    return { skipped: true, reason: "validation_failed", stepKey: plan.step.key, runId: plan.run.id };
  }
  if (plan.type === "max_attempts") {
    const error = plan.step.errorMessage || runtimeSettings.messages.validationFallback.text;
    await send(plan.run.id, plan.run.conversation_id, `validation-final:${plan.step.key}`, error);
    if (runtimeSettings.messages.cancelled.enabled) await send(plan.run.id, plan.run.conversation_id, "max-attempts-cancelled", runtimeSettings.messages.cancelled.text);
    return { skipped: true, reason: "max_attempts", stepKey: plan.step.key, runId: plan.run.id };
  }
  if (plan.type === "choice") {
    let classified: any;
    try {
      classified = await classifyConversationService({
        conversationId: plan.run.conversation_id,
        serviceKey: plan.option.serviceKey,
        sourceCode: event.source || context?.conversation?.channel_code,
        classificationMethod: "customer_automation",
        departmentCode: plan.option.departmentCode,
        branchCode: plan.option.defaultBranch,
        actor,
        eventKey: event.event_key,
      });
    } catch (error: any) {
      const sql = getSql();
      await sql`update crm.customer_automation_runs set status='awaiting_service',termination_reason=${`classification_error:${error?.message || String(error)}`},updated_at=now() where id=${plan.run.id}::uuid`;
      throw error;
    }
    const sql = getSql();
    const [updated] = await sql<any[]>`
      update crm.customer_automation_runs set service_request_id=${classified.request?.id||null}::uuid,lead_id=${classified.leadId||null}::uuid,status='classifying',current_step_index=0,current_step_key=null,current_attempt=0,updated_at=now()
      where id=${plan.run.id}::uuid returning *,id::text,conversation_id::text,contact_id::text,lead_id::text,service_request_id::text
    `;
    const progress = await continueFlow(
      updated || plan.run,
      plan.option,
      0,
      plan.option.startMessage.enabled ? plan.option.startMessage.text : "",
    );
    return { ok: true, action: "service_selected", runId: plan.run.id, serviceKey: plan.option.serviceKey, requestId: classified.request?.id, leadId: classified.leadId, assignedTo: classified.assignment?.assignedTo || null, distributionError: classified.distributionError || null, status: progress.completed ? "completed" : "awaiting_step", nextStepKey: progress.nextStepKey };
  }

  if (plan.nextStep) {
    await send(plan.run.id, plan.run.conversation_id, `question:${plan.nextStep.key}`, plan.nextStep.prompt);
    const sql = getSql();
    await sql`
      update crm.customer_automation_runs set status='awaiting_step',current_step_index=${plan.nextStepIndex},current_step_key=${plan.nextStep.key},current_attempt=0,termination_reason=null,updated_at=now()
      where id=${plan.run.id}::uuid
    `;
    return { ok: true, action: "next_step", runId: plan.run.id, savedField: plan.step.fieldKey, nextStepKey: plan.nextStep.key };
  }
  const progress = await continueFlow(plan.run, plan.option, plan.nextStepIndex);
  return { ok: true, action: progress.completed ? "completed" : "next_step", runId: plan.run.id, savedField: plan.step.fieldKey, nextStepKey: progress.nextStepKey };
}
