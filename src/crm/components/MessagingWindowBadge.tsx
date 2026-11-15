import { useEffect, useState } from "react";
import { Timer } from "@phosphor-icons/react";
import { formatWindowRemaining, messagingWindowState } from "../../../shared/crm-messaging-window";

/** Live countdown to the end of the reply window (counted from the customer's last message). */
export function MessagingWindowBadge({ expiresAt, windowHours = 24, compact = false }: { expiresAt: string | null | undefined; windowHours?: number; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const expires = expiresAt ? new Date(expiresAt).getTime() : NaN;
  if (!Number.isFinite(expires)) return null;
  const remaining = expires - now;
  const state = messagingWindowState(remaining);
  const label = state === "closed" ? "انتهت نافذة الرد" : `متبقي ${formatWindowRemaining(remaining)}`;
  const hint = state === "closed"
    ? "لا يمكن إرسال رسالة قبل أن يراسلنا العميل من جديد."
    : `نافذة الرد ${windowHours} ساعة من آخر رسالة للعميل. لا يمددها إلا رد جديد من العميل.`;
  return (
    <span className={`crm-window-badge ${state}${compact ? " compact" : ""}`} title={hint}>
      <Timer size={compact ? 13 : 16} weight="bold" />
      <b>{label}</b>
    </span>
  );
}
