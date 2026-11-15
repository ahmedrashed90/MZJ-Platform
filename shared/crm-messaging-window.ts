/**
 * Customer-service messaging window (shared by the API and the CRM UI).
 *
 * Facebook, Instagram and WhatsApp allow free-form replies for 24 hours after the
 * CUSTOMER's last message. Only a new customer message re-opens the window; a reply
 * from an agent does not extend it. TikTok's length is configurable on the server.
 */

export type MessagingWindowChannel = "facebook" | "instagram" | "tiktok" | "whatsapp";
export type MessagingWindowState = "open" | "warning" | "critical" | "closed" | "unknown";

export type MessagingWindow = {
  channel: MessagingWindowChannel;
  windowHours: number;
  /** ISO time the window closes, null when the customer has never written. */
  expiresAt: string | null;
  /** Milliseconds left at `now`; negative once closed; null when unknown. */
  remainingMs: number | null;
  state: MessagingWindowState;
};

export const DEFAULT_WINDOW_HOURS = 24;
/** Amber below this many minutes left. */
export const WARNING_MINUTES = 6 * 60;
/** Red below this many minutes left. */
export const CRITICAL_MINUTES = 60;

export function messagingWindowChannel(channelCode: unknown): MessagingWindowChannel | null {
  const code = String(channelCode ?? "").trim().toLowerCase();
  if (code === "facebook" || code === "instagram" || code === "tiktok") return code;
  if (code === "whatsapp" || code === "mersal") return "whatsapp";
  return null;
}

export function messagingWindowHours(channel: MessagingWindowChannel, tiktokHours?: number | null) {
  if (channel === "tiktok") {
    const configured = Number(tiktokHours);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_WINDOW_HOURS;
  }
  return DEFAULT_WINDOW_HOURS;
}

export function messagingWindowState(remainingMs: number | null): MessagingWindowState {
  if (remainingMs === null || !Number.isFinite(remainingMs)) return "unknown";
  if (remainingMs <= 0) return "closed";
  if (remainingMs <= CRITICAL_MINUTES * 60_000) return "critical";
  if (remainingMs <= WARNING_MINUTES * 60_000) return "warning";
  return "open";
}

export function computeMessagingWindow(input: {
  channelCode: unknown;
  lastCustomerMessageAt: string | Date | null | undefined;
  now?: number;
  tiktokHours?: number | null;
}): MessagingWindow | null {
  const channel = messagingWindowChannel(input.channelCode);
  if (!channel) return null;
  const windowHours = messagingWindowHours(channel, input.tiktokHours);
  const last = input.lastCustomerMessageAt ? new Date(input.lastCustomerMessageAt as string | Date).getTime() : NaN;
  if (!Number.isFinite(last)) return { channel, windowHours, expiresAt: null, remainingMs: null, state: "unknown" };
  const expires = last + windowHours * 3_600_000;
  const remainingMs = expires - (input.now ?? Date.now());
  return { channel, windowHours, expiresAt: new Date(expires).toISOString(), remainingMs, state: messagingWindowState(remainingMs) };
}

/** "5 س 12 د" / "42 د" / "انتهت". */
export function formatWindowRemaining(remainingMs: number | null): string {
  if (remainingMs === null || !Number.isFinite(remainingMs)) return "—";
  if (remainingMs <= 0) return "انتهت";
  const totalMinutes = Math.max(1, Math.floor(remainingMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} د`;
  return `${hours} س ${String(minutes).padStart(2, "0")} د`;
}
