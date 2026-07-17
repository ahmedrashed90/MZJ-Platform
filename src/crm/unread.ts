import type { CrmLead } from "./types";

function timestampMs(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function leadHasUnreadMessage(lead: CrmLead) {
  if (Number(lead.unread_count || 0) > 0) return true;
  if (lead.dashboard_unread === true || lead.has_unread_message === true || lead.has_unread_messages === true || lead.message_unread === true || lead.is_unread === true) return true;
  const direction = String(lead.last_message_direction || "").trim().toLowerCase();
  const incomingAt = timestampMs(lead.last_incoming_message_at || lead.last_message_at);
  const readAt = timestampMs(lead.dashboard_message_read_at);
  return direction === "in" && incomingAt > readAt;
}
