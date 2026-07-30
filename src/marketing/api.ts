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
  await marketingFetch("/api/marketing", { method: "POST", body: JSON.stringify({ action: "mark_file_ready", fileId: prepared.fileId, category: input.category, sourceType: input.sourceType, sourceId: input.sourceId, taskId: input.taskId }) });
  return prepared.fileId;
}

export async function downloadMarketingFile(fileId: string) {
  const payload = await marketingFetch<{ url: string }>(`/api/marketing${marketingQuery({ resource: "file", id: fileId })}`);
  window.open(payload.url, "_blank", "noopener,noreferrer");
}
export async function uploadMarketingFinalFiles(input: {
  files: File[];
  sourceType?: string;
  sourceId?: string;
  taskId: string;
  onProgress?: (completed: number, total: number, fileName: string, detail?: string) => void;
}) {
  if (!input.files.length) throw new Error("اختر الملف النهائي أولًا");
  const prepared = await marketingFetch<{
    groupId: string;
    mediaKind: "image" | "carousel" | "video";
    uploads: Array<{
      fileId: string;
      orderIndex: number;
      fileName: string;
      uploadUrl: string;
      partUploadUrl: string;
      finalizeUrl: string;
    }>;
  }>("/api/marketing", {
    method: "POST",
    body: JSON.stringify({
      action: "prepare_final_upload",
      taskId: input.taskId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      files: input.files.map((file) => ({ name: file.name, mimeType: file.type || "application/octet-stream", size: file.size })),
    }),
  });

  // Every browser request stays well below Cloudflare's request-body ceiling. The
  // gateway temporarily stages the parts in R2, streams the assembled object to
  // Zoho, then deletes the temporary parts.
  const chunkSize = 20 * 1024 * 1024;
  for (let index = 0; index < prepared.uploads.length; index += 1) {
    const upload = prepared.uploads[index];
    const file = input.files[upload.orderIndex];
    if (!file) throw new Error(`تعذر مطابقة الملف ${upload.fileName}`);
    const totalParts = Math.max(1, Math.ceil(file.size / chunkSize));
    input.onProgress?.(index, prepared.uploads.length, file.name, `الجزء 1 من ${totalParts}`);

    for (let partIndex = 0; partIndex < totalParts; partIndex += 1) {
      const partNumber = partIndex + 1;
      const start = partIndex * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const partUrl = new URL(upload.partUploadUrl);
      partUrl.searchParams.set("partNumber", String(partNumber));
      partUrl.searchParams.set("totalParts", String(totalParts));
      const response = await fetch(partUrl.toString(), {
        method: "POST",
        body: file.slice(start, end),
        headers: { "content-type": "application/octet-stream" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || `تعذر رفع الجزء ${partNumber} من ${file.name}`);
      input.onProgress?.(index, prepared.uploads.length, file.name, `الجزء ${partNumber} من ${totalParts}`);
    }

    const finalizeUrl = new URL(upload.finalizeUrl);
    finalizeUrl.searchParams.set("totalParts", String(totalParts));
    const finalized = await fetch(finalizeUrl.toString(), { method: "POST" });
    const finalizedPayload = await finalized.json().catch(() => ({}));
    if (!finalized.ok || finalizedPayload.ok === false) throw new Error(finalizedPayload.error || finalizedPayload.message || `تعذر استكمال رفع ${file.name} إلى Zoho WorkDrive`);
    input.onProgress?.(index + 1, prepared.uploads.length, file.name, "تم رفع الملف إلى Zoho");
  }

  const attached = await marketingFetch<{ message: string; groupId: string }>("/api/marketing", {
    method: "POST",
    body: JSON.stringify({ action: "attach_final_media_group", taskId: input.taskId, groupId: prepared.groupId }),
  });
  return { ...attached, mediaKind: prepared.mediaKind, fileCount: input.files.length };
}

