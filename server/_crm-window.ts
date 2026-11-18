import { computeMessagingWindow, type MessagingWindow } from "../shared/crm-messaging-window.js";

export function tiktokWindowHours(): number | null {
  const value = Number(process.env.TIKTOK_WINDOW_HOURS || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Adds `messaging_window` (expiry computed from the customer's last message) to a conversation row. */
export function withMessagingWindow<T extends Record<string, any>>(row: T): T & { messaging_window: MessagingWindow | null } {
  const messaging_window = computeMessagingWindow({
    channelCode: row.channel_code || row.platform_code || row.source_code,
    lastCustomerMessageAt: row.last_customer_message_at,
    tiktokHours: tiktokWindowHours(),
  });
  return { ...row, messaging_window };
}

/**
 * Link to the contact's ManyChat Live Chat. Replies typed there get Meta's HUMAN_AGENT tag from ManyChat
 * itself (up to 7 days), which the platform cannot apply on its own.
 * MANYCHAT_LIVE_CHAT_BASE overrides the account base URL (default: the MZJ ManyChat account).
 */
export function manychatLiveChatUrl(channelCode: unknown, manychatContactId: unknown, participantId?: unknown): string | null {
  const channel = String(channelCode ?? "").trim().toLowerCase();
  if (channel !== "facebook" && channel !== "instagram") return null;
  const contact = String(manychatContactId || (channel === "facebook" ? participantId : "") || "").trim();
  if (!/^\d{5,}$/.test(contact)) return null;
  const base = (process.env.MANYCHAT_LIVE_CHAT_BASE || "https://app.manychat.com/fb4223690").trim().replace(/\/+$/, "");
  return `${base}/chat/${contact}`;
}
