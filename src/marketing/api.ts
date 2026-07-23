export async function marketingFetch<T>(resource: string, options?: RequestInit): Promise<T> {
  const separator = resource.includes("?") ? "&" : "?";
  const response = await fetch(`/api/marketing${separator}${resource}`, {
    credentials: "include",
    cache: "no-store",
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || "تعذر تنفيذ العملية داخل نظام التسويق");
  return payload as T;
}

export function marketingQuery(values: Record<string, unknown>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  return params.toString();
}

export function formatMarketingDate(value?: string | null, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ar-SA", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}

export function todayInput() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}


export type MarketingTaskUpload = {
  uploadUrl: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  fileRole: "template" | "final" | "attachment";
  expiresIn: number;
};

export async function uploadMarketingTaskFile(taskId: string, file: File, fileRole: MarketingTaskUpload["fileRole"]) {
  const prepared = await marketingFetch<{ ok: boolean; upload: MarketingTaskUpload }>("resource=task-file-prepare", {
    method: "POST",
    body: JSON.stringify({
      taskId,
      fileRole,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      fileSize: file.size,
    }),
  });
  const uploadResponse = await fetch(prepared.upload.uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "content-type": prepared.upload.mimeType },
  });
  if (!uploadResponse.ok) throw new Error("تعذر رفع الملف إلى التخزين الآمن");
  return prepared.upload;
}

export async function openMarketingTaskFile(fileId: string) {
  const result = await marketingFetch<{ ok: boolean; file: { downloadUrl: string } }>(`resource=task-file-download&id=${encodeURIComponent(fileId)}`);
  window.open(result.file.downloadUrl, "_blank", "noopener,noreferrer");
}

export async function openMarketingTemplateVersion(versionId: string) {
  const result = await marketingFetch<{ ok: boolean; file: { downloadUrl: string } }>(`resource=task-template-version-download&id=${encodeURIComponent(versionId)}`);
  window.open(result.file.downloadUrl, "_blank", "noopener,noreferrer");
}
