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
