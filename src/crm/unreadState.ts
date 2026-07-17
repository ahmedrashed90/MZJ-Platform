import type { CrmLead } from "./types";

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function crmTimestampMs(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function leadHasUnreadMessage(lead: CrmLead) {
  if (Number(lead.unread_count || 0) > 0) return true;
  if (lead.dashboard_unread === true || lead.has_unread_message === true || lead.has_unread_messages === true || lead.message_unread === true || lead.is_unread === true) return true;
  const direction = text(lead.last_message_direction).toLowerCase();
  const incomingAt = crmTimestampMs(lead.last_incoming_message_at || lead.last_message_at);
  const readAt = crmTimestampMs(lead.dashboard_message_read_at);
  return direction === "in" && incomingAt > readAt;
}
