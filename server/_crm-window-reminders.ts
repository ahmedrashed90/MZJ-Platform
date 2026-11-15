import { getSql } from "./_db.js";
import { createNotification, notificationDedupe } from "./_notifications.js";
import { computeMessagingWindow, formatWindowRemaining } from "../shared/crm-messaging-window.js";
import { tiktokWindowHours } from "./_crm-window.js";

const CHANNEL_LABEL: Record<string, string> = { facebook: "فيسبوك", instagram: "إنستجرام", tiktok: "تيك توك", whatsapp: "مرسال/واتساب" };

function flag(value: unknown, fallback: boolean) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return fallback;
  return !["0", "false", "no", "off"].includes(v);
}

/**
 * Warns the responsible rep shortly before a conversation's reply window closes, so the
 * conversation can be kept alive. Only a CUSTOMER message re-opens the window, therefore the
 * text asks the rep to send something that makes the customer answer.
 *
 * Env:
 *  CRM_WINDOW_REMINDER_LEAD_MINUTES   minutes before expiry to remind (default 60 => reminder at ~23h)
 *  CRM_WINDOW_REMINDER_UNCLASSIFIED   remind the branch/department about unclassified chats too (default true)
 *  CRM_WINDOW_REMINDER_ENABLED        false to disable
 */
export async function runCrmWindowReminders() {
  if (!flag(process.env.CRM_WINDOW_REMINDER_ENABLED, true)) return { ok: true, disabled: true, scanned: 0, notified: 0 };
  const lead = Math.min(720, Math.max(5, Number(process.env.CRM_WINDOW_REMINDER_LEAD_MINUTES || 60)));
  const includeUnclassified = flag(process.env.CRM_WINDOW_REMINDER_UNCLASSIFIED, true);
  const sql = getSql();
  const rows = await sql<any[]>`
    select c.id::text, c.lead_id::text, c.channel_code, c.customer_name, c.classification_state, c.last_customer_message_at,
      c.assigned_to::text, c.call_center_assigned_to::text, c.branch_code, c.department_code, c.service_request_id::text
    from crm.conversations c
    where c.last_customer_message_at is not null
      and c.last_customer_message_at > now() - interval '48 hours'
      and c.channel_code in ('facebook','instagram','tiktok','whatsapp','mersal')
      and (c.classification_state<>'closed' or c.last_customer_message_at>coalesce(c.closed_at,'epoch'::timestamptz))
    limit 2000
  `;
  const now = Date.now();
  let notified = 0;
  for (const row of rows) {
    const window = computeMessagingWindow({ channelCode: row.channel_code, lastCustomerMessageAt: row.last_customer_message_at, tiktokHours: tiktokWindowHours(), now });
    if (!window || window.remainingMs === null || window.remainingMs <= 0 || window.remainingMs > lead * 60_000) continue;
    const unclassified = !row.service_request_id;
    if (unclassified && !includeUnclassified) continue;
    const audience = [row.assigned_to, row.call_center_assigned_to].filter(Boolean);
    const name = String(row.customer_name || "عميل").trim() || "عميل";
    const channel = CHANNEL_LABEL[window.channel] || window.channel;
    const left = formatWindowRemaining(window.remainingMs);
    const id = await createNotification({
      systemCode: "crm",
      eventType: "messaging_window_expiring",
      title: `نافذة الرد مع ${name} ستنتهي خلال ${left}`,
      body: [
        `العميل: ${name}`,
        `القناة: ${channel}`,
        `المتبقي: ${left}`,
        unclassified ? "المحادثة غير مصنفة ولم تُوزّع على مندوب بعد." : "",
        "أرسل الآن رسالة تدفع العميل للرد؛ المحادثة تُمدّد فقط عندما يراسلنا العميل.",
      ].filter(Boolean).join("\n"),
      entityType: "conversation",
      entityId: row.id,
      actionUrl: unclassified || !row.lead_id ? "/crm/inbox" : `/crm?lead=${encodeURIComponent(row.lead_id)}`,
      severity: unclassified ? "danger" : "warning",
      audienceUserIds: audience,
      branchCodes: audience.length ? [] : [row.branch_code].filter(Boolean),
      departmentCodes: audience.length ? [] : [row.department_code].filter(Boolean),
      metadata: { expiresAt: window.expiresAt, channel: window.channel },
      // One reminder per customer message: a new customer message re-opens the window and re-arms it.
      dedupeKey: notificationDedupe("crm-window-expiring", row.id, new Date(row.last_customer_message_at).toISOString()),
    });
    if (id) notified += 1;
  }
  return { ok: true, scanned: rows.length, notified, leadMinutes: lead };
}
