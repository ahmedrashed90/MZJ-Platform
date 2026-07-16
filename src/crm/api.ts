export async function crmFetch<T>(url: string, options?: RequestInit): Promise<T> {
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
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || "تعذر تنفيذ العملية");
  return payload as T;
}

export function queryString(values: Record<string, unknown>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function formatDate(value?: string | null, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ar-SA", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}

export function departmentKeyFromCode(value?: string | null) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("finance") || raw.includes("call_center")) return "finance";
  if (raw.includes("customer_service") || raw === "service") return "service";
  return "cash";
}

export function departmentLabel(value?: string | null) {
  const key = departmentKeyFromCode(value);
  if (key === "finance") return "مبيعات التمويل";
  if (key === "service") return "خدمة العملاء";
  return "مبيعات الكاش";
}

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = `\uFEFF${headers.map(escape).join(",")}\n${rows.map((row) => headers.map((key) => escape(row[key])).join(",")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
