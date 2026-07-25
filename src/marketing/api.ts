export async function marketingFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || "تعذر تنفيذ العملية");
  return payload as T;
}

export function marketingQuery(values: Record<string, unknown>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function marketingLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function marketingDate(value: unknown, withTime = false) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "—";
  return withTime ? date.toLocaleString("ar-SA") : date.toLocaleDateString("ar-SA");
}

export async function uploadMarketingFile(input: {
  file: File;
  category: string;
  sourceType?: string;
  sourceId?: string;
  taskId?: string;
}) {
  const prepared = await marketingFetch<{ fileId: string; uploadUrl: string }>("/api/marketing", {
    method: "POST",
    body: JSON.stringify({
      action: "prepare_upload",
      category: input.category,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      taskId: input.taskId,
      fileName: input.file.name,
      mimeType: input.file.type || "application/octet-stream",
      fileSize: input.file.size,
    }),
  });
  const uploaded = await fetch(prepared.uploadUrl, { method: "PUT", body: input.file, headers: { "content-type": input.file.type || "application/octet-stream" } });
  if (!uploaded.ok) throw new Error("تعذر رفع الملف إلى التخزين");
  await marketingFetch("/api/marketing", { method: "POST", body: JSON.stringify({ action: "mark_file_ready", fileId: prepared.fileId }) });
  return prepared.fileId;
}

export async function downloadMarketingFile(fileId: string) {
  const payload = await marketingFetch<{ url: string }>(`/api/marketing${marketingQuery({ resource: "file", id: fileId })}`);
  window.open(payload.url, "_blank", "noopener,noreferrer");
}
