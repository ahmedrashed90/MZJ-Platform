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
export type MarketingFinalUploadStatus = "pending" | "uploading" | "verifying" | "completed" | "cancelled" | "error";

export type MarketingFinalUploadProgress = {
  fileIndex: number;
  fileCount: number;
  fileName: string;
  loaded: number;
  total: number;
  percent: number;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  status: MarketingFinalUploadStatus;
  detail?: string;
};

export type MarketingFinalUploadCancellation = {
  cancelled: boolean;
  groupId: string;
  currentRequest: XMLHttpRequest | null;
  cancel: () => void;
};

export function createMarketingFinalUploadCancellation(): MarketingFinalUploadCancellation {
  const control: MarketingFinalUploadCancellation = {
    cancelled: false,
    groupId: "",
    currentRequest: null,
    cancel() {
      control.cancelled = true;
      control.currentRequest?.abort();
    },
  };
  return control;
}

function uploadCancelledError() {
  const error = new Error("تم إلغاء رفع الملف النهائي");
  error.name = "UploadCancelledError";
  return error;
}

function parseUploadResponse(xhr: XMLHttpRequest) {
  const text = String(xhr.responseText || "").trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function uploadFileDirectlyToZoho(input: {
  file: File;
  fileIndex: number;
  fileCount: number;
  uploadMode: "multipart" | "stream";
  uploadId: string;
  storedFileName: string;
  accessToken: string;
  apiDomain: string;
  uploadDomain: string;
  parentFolderId: string;
  cancellation: MarketingFinalUploadCancellation;
  onProgress?: (progress: MarketingFinalUploadProgress) => void;
}) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    if (input.cancellation.cancelled) return reject(uploadCancelledError());
    const xhr = new XMLHttpRequest();
    input.cancellation.currentRequest = xhr;
    const startedAt = performance.now();
    const uploadUrl = input.uploadMode === "stream"
      ? `${input.uploadDomain.replace(/\/+$/, "")}/workdrive-api/v1/stream/upload`
      : `${input.apiDomain.replace(/\/+$/, "")}/workdrive/api/v1/upload`;

    xhr.open("POST", uploadUrl, true);
    xhr.timeout = 0;
    xhr.setRequestHeader("Authorization", `Zoho-oauthtoken ${input.accessToken}`);
    xhr.setRequestHeader("Accept", "application/vnd.api+json");
    if (input.uploadMode === "stream") {
      xhr.setRequestHeader("Content-Type", input.file.type || "application/octet-stream");
      xhr.setRequestHeader("x-filename", encodeURIComponent(input.storedFileName));
      xhr.setRequestHeader("x-parent_id", input.parentFolderId);
      xhr.setRequestHeader("upload-id", input.uploadId);
      xhr.setRequestHeader("x-streammode", "1");
      xhr.setRequestHeader("x-override-name-exist", "false");
    }

    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : input.file.size;
      const loaded = Math.min(event.loaded, total);
      const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.2);
      const speedBytesPerSecond = loaded / elapsedSeconds;
      const remaining = Math.max(0, total - loaded);
      input.onProgress?.({
        fileIndex: input.fileIndex,
        fileCount: input.fileCount,
        fileName: input.file.name,
        loaded,
        total,
        percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
        speedBytesPerSecond,
        etaSeconds: speedBytesPerSecond > 0 ? Math.ceil(remaining / speedBytesPerSecond) : null,
        status: "uploading",
      });
    };

    xhr.onerror = () => reject(new Error("تعذر الاتصال المباشر بـZoho WorkDrive. تأكد من ربط الحساب والسماح بالرفع من دومين المنصة"));
    xhr.ontimeout = () => reject(new Error("انتهت مهلة رفع الملف إلى Zoho WorkDrive"));
    xhr.onabort = () => reject(uploadCancelledError());
    xhr.onload = () => {
      const payload = parseUploadResponse(xhr);
      if (xhr.status < 200 || xhr.status >= 300) {
        const errorPayload = payload as any;
        const first = Array.isArray(errorPayload.errors) ? errorPayload.errors[0] : null;
        const message = first?.title || first?.detail || errorPayload.message || errorPayload.error || `تعذر رفع الملف إلى Zoho (${xhr.status})`;
        reject(new Error(String(message)));
        return;
      }
      input.onProgress?.({
        fileIndex: input.fileIndex,
        fileCount: input.fileCount,
        fileName: input.file.name,
        loaded: input.file.size,
        total: input.file.size,
        percent: 100,
        speedBytesPerSecond: input.file.size / Math.max((performance.now() - startedAt) / 1000, 0.2),
        etaSeconds: 0,
        status: "verifying",
        detail: "جاري التحقق من الملف داخل Zoho",
      });
      resolve(payload);
    };

    if (input.uploadMode === "stream") {
      xhr.send(input.file);
    } else {
      const form = new FormData();
      form.append("filename", input.storedFileName);
      form.append("parent_id", input.parentFolderId);
      form.append("override-name-exist", "false");
      form.append("content", input.file, input.storedFileName);
      xhr.send(form);
    }
  });
}

async function waitForZohoConfirmation(input: { ticket: string; result: unknown; cancellation: MarketingFinalUploadCancellation }) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (input.cancellation.cancelled) throw uploadCancelledError();
    const confirmation = await marketingFetch<{ pending?: boolean; fileId?: string; resourceId?: string }>("/api/marketing", {
      method: "POST",
      body: JSON.stringify({ action: "confirm_final_upload", ticket: input.ticket, result: input.result }),
    });
    if (!confirmation.pending) return confirmation;
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error("استغرق Zoho وقتًا أطول من المتوقع في تأكيد الملف. حاول التحقق مرة أخرى");
}

export async function uploadMarketingFinalFiles(input: {
  files: File[];
  sourceType?: string;
  sourceId?: string;
  taskId: string;
  cancellation?: MarketingFinalUploadCancellation;
  onProgress?: (progress: MarketingFinalUploadProgress) => void;
}) {
  if (!input.files.length) throw new Error("اختر الملف النهائي أولًا");
  const cancellation = input.cancellation || createMarketingFinalUploadCancellation();
  const prepared = await marketingFetch<{
    groupId: string;
    mediaKind: "image" | "carousel" | "video";
    directUpload: {
      accessToken: string;
      apiDomain: string;
      uploadDomain: string;
      parentFolderId: string;
    };
    uploads: Array<{
      ticket: string;
      fileId: string;
      orderIndex: number;
      originalFileName: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      uploadMode: "multipart" | "stream";
      uploadId: string;
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
  cancellation.groupId = prepared.groupId;

  try {
    for (let index = 0; index < prepared.uploads.length; index += 1) {
      if (cancellation.cancelled) throw uploadCancelledError();
      const upload = prepared.uploads[index];
      const file = input.files[upload.orderIndex];
      if (!file) throw new Error(`تعذر مطابقة الملف ${upload.originalFileName}`);
      input.onProgress?.({
        fileIndex: index,
        fileCount: prepared.uploads.length,
        fileName: file.name,
        loaded: 0,
        total: file.size,
        percent: 0,
        speedBytesPerSecond: 0,
        etaSeconds: null,
        status: "uploading",
      });
      const result = await uploadFileDirectlyToZoho({
        file,
        fileIndex: index,
        fileCount: prepared.uploads.length,
        uploadMode: upload.uploadMode,
        uploadId: upload.uploadId,
        storedFileName: upload.fileName,
        accessToken: prepared.directUpload.accessToken,
        apiDomain: prepared.directUpload.apiDomain,
        uploadDomain: prepared.directUpload.uploadDomain,
        parentFolderId: prepared.directUpload.parentFolderId,
        cancellation,
        onProgress: input.onProgress,
      });
      await waitForZohoConfirmation({ ticket: upload.ticket, result, cancellation });
      input.onProgress?.({
        fileIndex: index,
        fileCount: prepared.uploads.length,
        fileName: file.name,
        loaded: file.size,
        total: file.size,
        percent: 100,
        speedBytesPerSecond: 0,
        etaSeconds: 0,
        status: "completed",
        detail: "تم الرفع والتحقق",
      });
    }

    const attached = await marketingFetch<{ message: string; groupId: string }>("/api/marketing", {
      method: "POST",
      body: JSON.stringify({ action: "attach_final_media_group", taskId: input.taskId, groupId: prepared.groupId }),
    });
    return { ...attached, mediaKind: prepared.mediaKind, fileCount: input.files.length };
  } catch (failure) {
    if (prepared.groupId) {
      await marketingFetch("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "cancel_final_upload", groupId: prepared.groupId }),
      }).catch(() => undefined);
    }
    throw failure;
  } finally {
    cancellation.currentRequest = null;
  }
}
