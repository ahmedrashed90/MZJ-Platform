export async function attendanceFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    cache: init?.cache || "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error || "تعذر تنفيذ العملية") as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = payload?.code;
    throw error;
  }
  return payload as T;
}

export function formatAttendanceTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatAttendanceDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return String(value || "—");
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatAttendanceDay(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    timeZone: "Asia/Riyadh",
    weekday: "long",
  }).format(date);
}


export function formatAttendanceMinutes(value: number | null | undefined) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes} د`;
  if (!minutes) return `${hours} س`;
  return `${hours} س ${minutes} د`;
}
