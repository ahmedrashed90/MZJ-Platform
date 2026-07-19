export class OperationsApiError extends Error {
  code?: string;
  fieldErrors?: Record<string, string>;
  requestId?: string;
  details?: Record<string, unknown>;
  constructor(message: string, payload?: Record<string, unknown>) {
    super(message);
    this.code = typeof payload?.code === "string" ? payload.code : undefined;
    this.fieldErrors = payload?.fieldErrors && typeof payload.fieldErrors === "object" ? payload.fieldErrors as Record<string, string> : undefined;
    this.requestId = typeof payload?.requestId === "string" ? payload.requestId : undefined;
    this.details = payload?.details && typeof payload.details === "object" ? payload.details as Record<string, unknown> : undefined;
  }
}

export async function operationsFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new OperationsApiError(payload?.message || payload?.error || "تعذر تنفيذ العملية", payload);
  return payload as T;
}
export function operationsQuery(values: Record<string, unknown>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== "") params.set(key, String(value)); });
  return params.toString() ? `?${params.toString()}` : "";
}
export function formatOperationsDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value); if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });
}
export function statusLabel(code?: string | null) {
  const map: Record<string,string> = { available_for_sale:"متاح للبيع",reserved:"محجوز",reservation:"حجز",has_notes:"بها ملاحظات",sold_under_delivery:"مباع تحت التسليم",sold_delivered:"مباع تم التسليم" };
  return map[String(code || "")] || String(code || "—");
}
export function requestStatusLabel(code?: string | null) {
  const map: Record<string,string> = { new:"جديد",request_received:"تم استلام الطلب",vehicle_sent:"تم إرسال السيارة",vehicle_received:"تم استلام السيارة",completed:"تم الانتهاء",cancelled:"ملغي",deleted:"محذوف" };
  return map[String(code || "")] || String(code || "—");
}
function escapeXml(value: unknown) { return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
export function downloadExcel(filename: string, headers: string[], rows: Array<Array<unknown>>, textColumns = new Set<number>([0])) {
  const table = `<table><thead><tr>${headers.map((h)=>`<th>${escapeXml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row)=>`<tr>${row.map((cell,index)=>`<td${textColumns.has(index)?' style="mso-number-format:\'\\@\';"':''}>${escapeXml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"></head><body>${table}</body></html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href=url; link.download=filename.endsWith(".xls")?filename:`${filename}.xls`; link.click(); URL.revokeObjectURL(url);
}
