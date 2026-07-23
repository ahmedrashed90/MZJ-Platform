export async function marketingFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; message?: string };
  if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || "تعذر تنفيذ العملية داخل نظام التسويق");
  return payload as T;
}

export function marketingQuery(values: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function formatMarketingDate(value: unknown, withTime = false) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "—";
  return withTime ? date.toLocaleString("ar-SA") : date.toLocaleDateString("ar-SA");
}

export function statusLabel(status: string | null | undefined) {
  const labels: Record<string, string> = {
    required: "مطلوب",
    waiting_template: "في انتظار اعتماد Task Template",
    active: "قيد التنفيذ",
    review: "في انتظار المراجعة",
    revision_requested: "مطلوب تعديل",
    approved: "معتمد",
    rejected: "مرفوض",
    completed: "مكتمل",
    publishing: "قسم النشر",
    request_received: "تم استلام الطلب",
    scheduled: "تمت الجدولة",
    in_progress: "قيد التنفيذ",
    cancelled: "ملغي",
    present: "حاضر",
    late: "متأخر",
    checked_out: "منصرف",
  };
  return labels[String(status || "")] || String(status || "—");
}

export async function uploadMarketingFile(input: {
  scope: "task" | "project";
  entityId: string;
  file: File;
  uploadKind?: string;
  fileKind?: string;
  metadata?: Record<string, unknown>;
}) {
  const prepared = await marketingFetch<{ ok: true; storageKey: string; uploadUrl: string }>("/api/marketing", {
    method: "POST",
    body: JSON.stringify({ action: "prepare_upload", scope: input.scope, entityId: input.entityId, fileName: input.file.name }),
  });
  const upload = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "content-type": input.file.type || "application/octet-stream" }, body: input.file });
  if (!upload.ok) throw new Error("تعذر رفع الملف إلى التخزين");
  return marketingFetch<{ ok: true; row: { id: string } }>("/api/marketing", {
    method: "POST",
    body: JSON.stringify({
      action: "register_upload",
      scope: input.scope,
      entityId: input.entityId,
      fileName: input.file.name,
      storageKey: prepared.storageKey,
      mimeType: input.file.type,
      fileSize: input.file.size,
      uploadKind: input.uploadKind,
      fileKind: input.fileKind,
      metadata: input.metadata || {},
    }),
  });
}
