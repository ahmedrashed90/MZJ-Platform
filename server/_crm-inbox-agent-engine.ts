import { getSql } from "./_db.js";
import { clean, normalizePhone, sourceLabel } from "./_crm-utils.js";
import { deliverConversationMessage, deliverDirectWhatsapp } from "./_crm-messaging.js";

/**
 * Inbox agent v2 — time based escalation.
 *
 * Condition A ("idle"):   the customer's last message is `idle_minutes` old (default 60) and no employee replied since.
 * Condition B ("window"): the customer's last message is `window_hours` old (default 23) and no employee replied since.
 * Each condition runs the same sequence, one step every `step_minutes` (default 10):
 *   step 1: notice to the customer + alert to the branch manager
 *   step 2: alert to the sales manager        (only if still no employee reply)
 *   step 3: alert to the system manager       (only if still no employee reply)
 * Alerts go out through Mersal (WhatsApp) using an approved template with variables.
 */

let schemaPromise: Promise<void> | null = null;
export async function ensureInboxAgentEngineSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`alter table crm.inbox_agent_settings add column if not exists idle_minutes integer not null default 60`;
      await sql`alter table crm.inbox_agent_settings add column if not exists window_hours integer not null default 23`;
      await sql`alter table crm.inbox_agent_settings add column if not exists step_minutes integer not null default 10`;
      await sql`alter table crm.inbox_agent_settings add column if not exists customer_message text`;
      await sql`alter table crm.inbox_agent_settings add column if not exists excluded_statuses text[] not null default '{}'`;
      await sql`alter table crm.inbox_agent_settings add column if not exists system_manager_name text`;
      await sql`alter table crm.inbox_agent_settings add column if not exists system_manager_phone text`;
      await sql`alter table crm.inbox_agent_settings add column if not exists escalation_template_id uuid`;
      await sql`alter table crm.inbox_agent_settings add column if not exists status_escalation_template_id uuid`;
      await sql`alter table crm.inbox_agent_settings add column if not exists escalate_to_system_manager boolean not null default true`;
      await sql`alter table crm.inbox_agent_settings add column if not exists escalation_started_at timestamptz`;
      await sql`alter table crm.inbox_agent_settings add column if not exists engine_v2 boolean not null default false`;
      // Per-conversation mute: an employee can stop the agent for one conversation. A newer customer message re-arms it.
      await sql`alter table crm.conversations add column if not exists agent_muted_at timestamptz`;
      await sql`alter table crm.conversations add column if not exists agent_muted_by uuid`;
      // Phone-capture flag: set by the automation when it asks the customer for their number.
      // Cleared once a valid number is saved to the lead. While set (and lead has no phone), agent skips escalation.
      await sql`alter table crm.conversations add column if not exists phone_requested_at timestamptz`;
      // Status-change escalation: track when the rep last changed the lead status on this conversation's lead.
      await sql`alter table crm.conversations add column if not exists status_changed_at timestamptz`;
      await sql`alter table crm.conversations add column if not exists status_changed_label text`;
      // Per-status escalation rules: one rule per status_label, with up to 3 stages each having its own delay + target.
      await sql`
        create table if not exists crm.inbox_agent_status_rules (
          id uuid primary key default gen_random_uuid(),
          status_label text not null unique,
          is_active boolean not null default true,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          updated_by uuid
        )
      `;
      await sql`
        create table if not exists crm.inbox_agent_status_rule_stages (
          id uuid primary key default gen_random_uuid(),
          rule_id uuid not null references crm.inbox_agent_status_rules(id) on delete cascade,
          stage integer not null,
          delay_minutes integer not null default 60,
          target text not null default 'branch_manager',
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          unique (rule_id, stage)
        )
      `;
      await sql`
        create table if not exists crm.inbox_agent_escalations (
          id uuid primary key default gen_random_uuid(),
          conversation_id uuid not null,
          cycle text not null,
          anchor_at timestamptz not null,
          stage integer not null default 0,
          stage_at timestamptz,
          status text not null default 'active',
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          unique (conversation_id, cycle, anchor_at)
        )
      `;
      // One-time: Mersal (WhatsApp) becomes the fourth supported platform, and the 4 steps no longer depend on the old social switch.
      const [row] = await sql<any[]>`select engine_v2 from crm.inbox_agent_settings where id='default'`;
      if (row && !row.engine_v2) {
        await sql`update crm.inbox_agent_settings set social_platforms = case when 'whatsapp'=any(social_platforms) then social_platforms else array_append(social_platforms,'whatsapp') end, engine_v2=true where id='default'`;
      }
    })().catch((error) => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

export const DEFAULT_CUSTOMER_MESSAGE = "هلا فيك 👋 لا نزال في خدمتك. سيتم التواصل معك قريباً من أحد ممثلي المبيعات.";

function withinBusinessHours(settings: any, date = new Date()) {
  if (!settings?.business_hours_only) return true;
  const shifted = new Date(date.getTime() + 180 * 60000);
  const now = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  const parse = (v: any) => { const [h, m] = String(v || "00:00").split(":").map(Number); return h * 60 + m; };
  const start = parse(settings.business_start), end = parse(settings.business_end);
  return start === end ? true : start < end ? (now >= start && now < end) : (now >= start || now < end);
}

function normalizedText(value: unknown) {
  return clean(value).toLowerCase().replace(/[ً-ٟ]/g, "").replace(/[أإآ]/g, "ا").replace(/\s+/g, " ");
}

async function addLog(data: { conversationId: string; leadId?: string | null; action: string; reason: string; messageText?: string; customerName?: string; customerPhone?: string; branchCode?: string; assignedName?: string; managerName?: string; metadata?: any }) {
  const sql = getSql();
  await sql`
    insert into crm.inbox_agent_logs(conversation_id,lead_id,action,reason,message_text,customer_name,customer_phone,branch_code,assigned_name,manager_name,metadata)
    values (${data.conversationId}::uuid,${data.leadId || null}::uuid,${data.action},${data.reason},${data.messageText || null},${data.customerName || null},${data.customerPhone || null},${data.branchCode || null},${data.assignedName || null},${data.managerName || null},${sql.json((data.metadata || {}) as any)})
  `.catch((error) => console.error("inbox agent log failed", error));
}

async function branchManagerFor(row: any, settings: any) {
  const sql = getSql();
  const keys = [row.request_branch_code, row.branch_code, row.request_department_code, row.department_code, row.service_key, "__unassigned__", "default"].map(clean).filter(Boolean);
  for (const key of keys) {
    const [manager] = await sql<any[]>`select * from crm.inbox_agent_managers where scope_code=${key} and is_active=true limit 1`;
    if (manager) return { name: clean(manager.manager_name) || "مدير الفرع", phone: normalizePhone(manager.whatsapp_phone) };
  }
  const fallback = normalizePhone(settings.fallback_phone);
  return fallback ? { name: "مسؤول صندوق الوارد", phone: fallback } : null;
}

function renderTemplateText(content: string, values: string[]) {
  return content.replace(/{{\s*(\d+)\s*}}/g, (match, index) => values[Number(index) - 1] ?? "-");
}

async function sendAlert(input: {
  settings: any; row: any; phone: string; stageLabel: string;
  idempotencyKey: string; reason: string;
  // Optional extra params for status-change escalation template (5-variable)
  statusLabel?: string; elapsedLabel?: string;
}) {
  const sql = getSql();
  const customerName = clean(row_name(input.row));
  const platform = sourceLabel(input.row.channel_code) || clean(input.row.channel_code);
  const assigned = clean(input.row.assigned_name) || "غير موزع";
  // If statusLabel + elapsedLabel provided → 5-variable template (inbox_agent_status_escalation)
  // Otherwise → 4-variable template (inbox_agent_escalation)
  const values = input.statusLabel
    ? [customerName, platform, assigned, input.statusLabel, input.elapsedLabel || "—"]
    : [customerName, platform, assigned, input.stageLabel];
  let template: any = null;
  // Status-change escalation uses its own template; idle escalation uses the general one.
  const templateId = input.statusLabel
    ? (input.settings.status_escalation_template_id || null)
    : (input.settings.escalation_template_id || null);
  if (templateId) {
    [template] = await sql<any[]>`select *,id::text from crm.message_templates where id=${templateId}::uuid and is_active=true`;
  }
  if (template) {
    const text = renderTemplateText(clean(template.content), values);
    await deliverDirectWhatsapp({ phone: input.phone, text, template, idempotencyKey: input.idempotencyKey, reason: input.reason });
    return text;
  }
  // No template selected: plain text (only deliverable inside the manager's 24h WhatsApp window).
  const text = input.statusLabel
    ? `تنبيه من وكيل صندوق الوارد — تغيير حالة\nالعميل: ${customerName}\nالمنصة: ${platform}\nالمندوب المسؤول: ${assigned}\nالحالة المغيّرة إلى: ${input.statusLabel}\nالوقت منذ التغيير: ${input.elapsedLabel || "—"}\nلم يتم التواصل مع العميل حتى الآن.`
    : `تنبيه من وكيل صندوق الوارد (${input.stageLabel})\nالعميل: ${customerName}\nالمنصة: ${platform}\nالمندوب المسؤول: ${assigned}\nلم يتم التواصل مع العميل حتى الآن.`;
  await deliverDirectWhatsapp({ phone: input.phone, text, idempotencyKey: input.idempotencyKey, reason: input.reason });
  return text;
}

function row_name(row: any) {
  return row.lead_customer_name || row.customer_name || row.contact_name || "عميل";
}

const STAGES = [
  { stage: 1, key: "branch_manager", label: "مدير الفرع", action: "branch_manager_escalation" },
  { stage: 2, key: "sales_manager", label: "مدير المبيعات", action: "sales_manager_escalation" },
  { stage: 3, key: "system_manager", label: "مدير النظام", action: "system_manager_escalation" },
] as const;

export async function runInboxAgentTick() {
  await ensureInboxAgentEngineSchema();
  const sql = getSql();
  const [settings] = await sql<any[]>`select * from crm.inbox_agent_settings where id='default'`;
  if (!settings?.enabled) return { ok: true, enabled: false };
  if (!settings.escalation_started_at) {
    await sql`update crm.inbox_agent_settings set escalation_started_at=now() where id='default'`;
    settings.escalation_started_at = new Date().toISOString();
  }
  if (!withinBusinessHours(settings)) return { ok: true, enabled: true, skipped: "outside_business_hours" };

  const idleMinutes = Math.max(1, Number(settings.idle_minutes || 60));
  const windowMinutes = Math.max(idleMinutes + 1, Number(settings.window_hours || 23) * 60);
  // TikTok has a 48-hour messaging window; trigger the "window" cycle at 47h so the alert goes out before the window closes.
  const tiktokWindowMinutes = Math.max(idleMinutes + 1, 47 * 60);
  const stepMs = Math.max(1, Number(settings.step_minutes || 10)) * 60_000;
  const platforms: string[] = (Array.isArray(settings.social_platforms) ? settings.social_platforms : []).map(clean).filter(Boolean);
  const channels = Array.from(new Set(platforms.flatMap((p) => p === "whatsapp" ? ["whatsapp", "mersal"] : [p])));
  if (!channels.length) return { ok: true, enabled: true, skipped: "no_platforms" };
  const excluded: string[] = (Array.isArray(settings.excluded_statuses) ? settings.excluded_statuses : []).map(clean).filter(Boolean);

  // Housekeeping: an employee replied, customer wrote again, or agent was muted => cancel open escalations.
  await sql`
    update crm.inbox_agent_escalations e set status='cancelled',updated_at=now()
    from crm.conversations c
    where e.status='active' and c.id=e.conversation_id
      and (c.last_customer_message_at>e.anchor_at
        or (c.last_human_reply_at is not null and c.last_human_reply_at>=e.anchor_at)
        or (c.agent_muted_at is not null and c.agent_muted_at>=c.last_customer_message_at))
  `;

  const candidates = await sql<any[]>`
    select c.id::text,c.lead_id::text,c.channel_code,c.customer_name,c.preview_text,c.last_customer_message_at,c.branch_code,c.department_code,c.service_key,
      c.phone_requested_at,
      l.customer_name as lead_customer_name,l.phone,l.phone_normalized,l.status_label,
      u.full_name as assigned_name,r.branch_code as request_branch_code,r.department_code as request_department_code
    from crm.conversations c
    left join crm.leads l on l.id=c.lead_id
    left join core.users u on u.id=c.assigned_to
    left join crm.service_requests r on r.id=c.service_request_id
    where c.last_customer_message_at is not null
      and c.last_customer_message_at >= greatest(now()-interval '50 hours', ${settings.escalation_started_at}::timestamptz)
      and c.last_customer_message_at <= now()-(${idleMinutes}||' minutes')::interval
      and c.channel_code = any(${channels}::text[])
      and coalesce(c.status,'open')<>'closed'
      and c.classification_state<>'closed'
      and (c.agent_muted_at is null or c.agent_muted_at < c.last_customer_message_at)
      and (c.last_human_reply_at is null or c.last_human_reply_at < c.last_customer_message_at)
      and (l.id is null or l.is_deleted=false)
      and (cardinality(${excluded}::text[])=0 or coalesce(l.status_label,'')<>all(${excluded}::text[]))
    order by c.last_customer_message_at asc
    limit 500
  `;

  const now = Date.now();
  const stopWords: string[] = (Array.isArray(settings.stop_keywords) ? settings.stop_keywords : []).map(normalizedText).filter(Boolean);
  const counters = { scanned: candidates.length, notices: 0, escalations: 0, failures: 0 };

  for (const row of candidates) {
    const anchor = new Date(row.last_customer_message_at);
    const ageMinutes = (now - anchor.getTime()) / 60_000;
    const lastText = normalizedText(row.preview_text);
    if (stopWords.some((word) => lastText.includes(word))) continue;

    // Skip entirely if the phone automation is waiting for the customer to provide their number.
    // Once a valid number is saved, phone_requested_at is cleared and escalation resumes normally.
    if (row.phone_requested_at && !row.phone_normalized) continue;

    // TikTok has a 48h window, so the "window" cycle starts at 47h instead of the standard window_hours.
    const effectiveWindowMinutes = clean(row.channel_code) === "tiktok" ? tiktokWindowMinutes : windowMinutes;

    const cycles: string[] = [];
    if (ageMinutes >= idleMinutes && ageMinutes < effectiveWindowMinutes) cycles.push("idle");
    if (ageMinutes >= effectiveWindowMinutes) cycles.push("window");
    // An "idle" cycle that already started keeps going even after the window mark.
    const [activeIdle] = await sql<any[]>`select id from crm.inbox_agent_escalations where conversation_id=${row.id}::uuid and cycle='idle' and anchor_at=${anchor.toISOString()}::timestamptz and status='active'`;
    if (activeIdle && !cycles.includes("idle")) cycles.push("idle");

    for (const cycle of cycles) {
      await sql`
        insert into crm.inbox_agent_escalations(conversation_id,cycle,anchor_at) values (${row.id}::uuid,${cycle},${anchor.toISOString()}::timestamptz)
        on conflict (conversation_id,cycle,anchor_at) do nothing
      `;
      const [state] = await sql<any[]>`select * from crm.inbox_agent_escalations where conversation_id=${row.id}::uuid and cycle=${cycle} and anchor_at=${anchor.toISOString()}::timestamptz`;
      if (!state || state.status !== "active" || state.stage >= 3) continue;
      if (state.stage > 0 && now - new Date(state.stage_at).getTime() < stepMs) continue;

      const nextStage = STAGES[state.stage];
      // Optimistic claim: only one worker advances a given stage.
      const [claimed] = await sql<any[]>`
        update crm.inbox_agent_escalations set stage=${nextStage.stage},stage_at=now(),updated_at=now(),status=${nextStage.stage >= 3 ? "done" : "active"}
        where id=${state.id}::uuid and stage=${state.stage} and status='active' returning id::text
      `;
      if (!claimed) continue;

      const customerName = row_name(row);
      const common = { conversationId: row.id, leadId: row.lead_id, customerName, customerPhone: row.phone || row.phone_normalized || "", branchCode: row.request_branch_code || row.branch_code || "", assignedName: row.assigned_name || "", metadata: { cycle, stage: nextStage.stage, anchor: anchor.toISOString() } };

      if (nextStage.stage === 1) {
        const text = clean(settings.customer_message) || DEFAULT_CUSTOMER_MESSAGE;
        try {
          await deliverConversationMessage({ conversationId: row.id, text, senderType: "bot", reason: "inbox_agent_customer_notice", idempotencyKey: `inbox-agent-notice:${state.id}` });
          counters.notices += 1;
          await addLog({ ...common, action: "customer_notice", reason: cycle === "idle" ? "no_reply_after_idle_minutes" : "no_reply_near_window_end", messageText: text });
        } catch (error) {
          await addLog({ ...common, action: "customer_notice_failed", reason: error instanceof Error ? error.message.slice(0, 300) : "send_failed", messageText: text });
        }
      }

      const enabledFlag = nextStage.key === "branch_manager" ? settings.escalate_to_branch_manager !== false
        : nextStage.key === "sales_manager" ? settings.escalate_to_sales_manager !== false
        : settings.escalate_to_system_manager !== false;
      if (!enabledFlag) continue;

      let recipient: { name: string; phone: string } | null = null;
      if (nextStage.key === "branch_manager") recipient = await branchManagerFor(row, settings);
      else if (nextStage.key === "sales_manager") recipient = { name: clean(settings.sales_manager_name) || "مدير المبيعات", phone: normalizePhone(settings.sales_manager_phone) };
      else recipient = { name: clean(settings.system_manager_name) || "مدير النظام", phone: normalizePhone(settings.system_manager_phone) };

      if (!recipient?.phone) {
        await addLog({ ...common, action: "escalation_skipped", reason: `${nextStage.key}_phone_missing` });
        continue;
      }
      try {
        const text = await sendAlert({ settings, row, phone: recipient.phone, stageLabel: nextStage.label, idempotencyKey: `inbox-agent:${state.id}:${nextStage.stage}`, reason: `inbox_agent_${nextStage.key}` });
        counters.escalations += 1;
        await addLog({ ...common, action: nextStage.action, reason: cycle === "idle" ? "no_reply_after_idle_minutes" : "no_reply_near_window_end", messageText: text, managerName: recipient.name });
      } catch (error) {
        counters.failures += 1;
        await addLog({ ...common, action: "escalation_failed", reason: error instanceof Error ? error.message.slice(0, 300) : "send_failed", managerName: recipient.name });
      }
    }
  }
  // ── Status-change escalation (multi-stage) ───────────────────────────────
  // Each rule (one per status_label) can have up to 3 stages, each with its own delay_minutes + target.
  // The agent runs every minute; for each conversation whose status changed, it checks which stage is due next.
  const statusRulesWithStages = await sql<any[]>`
    select r.id::text as rule_id, r.status_label, r.is_active,
      json_agg(s order by s.stage) as stages
    from crm.inbox_agent_status_rules r
    left join crm.inbox_agent_status_rule_stages s on s.rule_id=r.id
    where r.is_active=true
    group by r.id, r.status_label, r.is_active
  `.catch(() => [] as any[]);

  if (statusRulesWithStages.length > 0) {
    const statusCounters = { scanned: 0, escalations: 0, failures: 0 };
    const cyclePfx = "status_rule";

    // Gather all status labels covered by active rules
    const activeLabels = statusRulesWithStages.map((r: any) => r.status_label);

    // Find all open conversations whose status_changed_at is set and status matches a rule
    const statusCandidates = await sql<any[]>`
      select c.id::text,c.lead_id::text,c.channel_code,c.customer_name,c.branch_code,c.department_code,c.service_key,
        c.status_changed_at,c.status_changed_label,
        l.customer_name as lead_customer_name,l.phone,l.phone_normalized,l.status_label,
        u.full_name as assigned_name,r2.branch_code as request_branch_code,r2.department_code as request_department_code
      from crm.conversations c
      left join crm.leads l on l.id=c.lead_id
      left join core.users u on u.id=c.assigned_to
      left join crm.service_requests r2 on r2.id=c.service_request_id
      where c.status_changed_at is not null
        and c.status_changed_label = any(${activeLabels}::text[])
        and coalesce(c.status,'open')<>'closed'
        and c.classification_state<>'closed'
        and (c.agent_muted_at is null or c.agent_muted_at < c.status_changed_at)
        and (c.last_human_reply_at is null or c.last_human_reply_at < c.status_changed_at)
        and (l.id is null or l.is_deleted=false)
        and (cardinality(${excluded}::text[])=0 or coalesce(l.status_label,'')<>all(${excluded}::text[]))
      limit 500
    `;

    statusCounters.scanned = statusCandidates.length;

    for (const conv of statusCandidates) {
      const rule = statusRulesWithStages.find((r: any) => r.status_label === conv.status_changed_label);
      if (!rule) continue;
      const stages: any[] = Array.isArray(rule.stages) ? rule.stages.filter(Boolean) : [];
      if (!stages.length) continue;

      const anchor = new Date(conv.status_changed_at);
      const cycleName = `${cyclePfx}:${rule.status_label}`;

      // Upsert escalation tracker for this conversation+cycle+anchor
      await sql`
        insert into crm.inbox_agent_escalations(conversation_id,cycle,anchor_at,stage,status)
        values (${conv.id}::uuid,${cycleName},${anchor.toISOString()}::timestamptz,0,'active')
        on conflict (conversation_id,cycle,anchor_at) do nothing
      `;
      const [state] = await sql<any[]>`
        select * from crm.inbox_agent_escalations
        where conversation_id=${conv.id}::uuid and cycle=${cycleName} and anchor_at=${anchor.toISOString()}::timestamptz
      `;
      if (!state || state.status === "done") continue;

      // Find which stage is next
      const currentStage = Number(state.stage || 0);
      const nextStageData = stages.find((s: any) => Number(s.stage) > currentStage);
      if (!nextStageData) {
        // All stages done — mark done
        await sql`update crm.inbox_agent_escalations set status='done',updated_at=now() where id=${state.id}::uuid and status='active'`;
        continue;
      }

      const delayMs = Math.max(1, Number(nextStageData.delay_minutes)) * 60_000;
      if (now - anchor.getTime() < delayMs) continue; // not yet time

      // Optimistic claim
      const [claimed] = await sql<any[]>`
        update crm.inbox_agent_escalations
        set stage=${nextStageData.stage},stage_at=now(),updated_at=now(),
            status=${nextStageData.stage >= stages.length ? "done" : "active"}
        where id=${state.id}::uuid and stage=${currentStage} and status='active'
        returning id::text
      `;
      if (!claimed) continue;

      const targetKey = clean(nextStageData.target);
      const targetLabel = targetKey === "branch_manager" ? "مدير الفرع" : targetKey === "sales_manager" ? "مدير المبيعات" : "مدير النظام";

      let recipient: { name: string; phone: string } | null = null;
      if (targetKey === "branch_manager") recipient = await branchManagerFor(conv, settings);
      else if (targetKey === "sales_manager") recipient = { name: clean(settings.sales_manager_name) || "مدير المبيعات", phone: normalizePhone(settings.sales_manager_phone) };
      else recipient = { name: clean(settings.system_manager_name) || "مدير النظام", phone: normalizePhone(settings.system_manager_phone) };

      const common = { conversationId: conv.id, leadId: conv.lead_id, customerName: row_name(conv), customerPhone: conv.phone || conv.phone_normalized || "", branchCode: conv.request_branch_code || conv.branch_code || "", assignedName: conv.assigned_name || "", metadata: { cycle: cycleName, statusLabel: rule.status_label, stage: nextStageData.stage, target: targetKey, anchor: anchor.toISOString() } };

      if (!recipient?.phone) {
        await addLog({ ...common, action: "escalation_skipped", reason: `status_rule_stage${nextStageData.stage}_${targetKey}_phone_missing` });
        continue;
      }
      try {
        const elapsed = Math.round((now - anchor.getTime()) / 60_000);
        const elapsedLabel = elapsed >= 1440 ? `${Math.round(elapsed / 1440)} يوم` : elapsed >= 60 ? `${Math.round(elapsed / 60)} ساعة` : `${elapsed} دقيقة`;
        const alertText = await sendAlert({
          settings,
          row: conv,
          phone: recipient.phone,
          stageLabel: targetLabel,
          statusLabel: rule.status_label,
          elapsedLabel,
          idempotencyKey: `inbox-agent-status:${state.id}:${nextStageData.stage}`,
          reason: `status_change_escalation_stage${nextStageData.stage}`,
        });
        statusCounters.escalations += 1;
        await addLog({ ...common, action: `status_stage${nextStageData.stage}_${targetKey}_escalation`, reason: `status_changed_to_${rule.status_label}_stage${nextStageData.stage}_after_${nextStageData.delay_minutes}m`, messageText: alertText, managerName: recipient.name });
      } catch (error) {
        statusCounters.failures += 1;
        await addLog({ ...common, action: "escalation_failed", reason: error instanceof Error ? error.message.slice(0, 300) : "send_failed", managerName: recipient.name });
      }
    }

    counters.scanned += statusCounters.scanned;
    counters.escalations += statusCounters.escalations;
    counters.failures += statusCounters.failures;
  }

  return { ok: true, enabled: true, ...counters };
}
