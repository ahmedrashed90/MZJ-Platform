export async function trackingFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    const base = payload?.message || payload?.error || "تعذر تنفيذ العملية";
    const message = payload?.requestId ? `${base} — رقم المرجع: ${payload.requestId}` : base;
    throw new Error(message);
  }
  return payload as T;
}

export function trackingQuery(values: Record<string, unknown>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function formatTrackingDate(value?: string | null, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ar-SA", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}

export function formatTrackingMoney(value?: number | string | null) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "—";
  return `${number.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
}

export function trackingStatusLabel(status?: string | null, isArchived = false) {
  if (isArchived) return "مؤرشف";
  if (status === "completed") return "مكتمل";
  if (status === "in_progress") return "تحت الإجراء";
  return "لم يبدأ";
}
