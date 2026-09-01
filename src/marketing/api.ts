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
  return withTime ? date.toLocaleString("ar-SA-u-nu-latn") : date.toLocaleDateString("ar-SA-u-nu-latn");
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
  const url = `/api/marketing${marketingQuery({ resource: "file", id: fileId })}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function downloadMarketingFiles(fileIds: string[]) {
  const ids = [...new Set(fileIds.map((fileId) => String(fileId || "").trim()).filter(Boolean))];
  ids.forEach((fileId, index) => {
    window.setTimeout(() => {
      const anchor = document.createElement("a");
      anchor.href = `/api/marketing${marketingQuery({ resource: "file", id: fileId, download: 1 })}`;
      anchor.download = "";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }, index * 120);
  });
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

function uploadWholeFinalFile(input: {
  file: File;
  fileIndex: number;
  fileCount: number;
  uploadUrl: string;
  startedAt: number;
  cancellation: MarketingFinalUploadCancellation;
  onProgress?: (progress: MarketingFinalUploadProgress) => void;
}) {
  return new Promise<void>((resolve, reject) => {
    if (input.cancellation.cancelled) return reject(uploadCancelledError());
    const xhr = new XMLHttpRequest();
    input.cancellation.currentRequest = xhr;
    xhr.open("PUT", input.uploadUrl, true);
    xhr.timeout = 0;
    xhr.setRequestHeader("Content-Type", input.file.type || "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      const loaded = event.lengthComputable ? Math.min(event.loaded, input.file.size) : 0;
      const elapsedSeconds = Math.max((performance.now() - input.startedAt) / 1000, 0.2);
      const speedBytesPerSecond = loaded / elapsedSeconds;
      const remaining = Math.max(0, input.file.size - loaded);
      input.onProgress?.({
        fileIndex: input.fileIndex,
        fileCount: input.fileCount,
        fileName: input.file.name,
        loaded,
        total: input.file.size,
        percent: Math.min(100, Math.round((loaded / input.file.size) * 100)),
        speedBytesPerSecond,
        etaSeconds: speedBytesPerSecond > 0 ? Math.ceil(remaining / speedBytesPerSecond) : null,
        status: "uploading",
        detail: "جاري رفع الملف كاملًا بدون تجزئة",
      });
    };

    xhr.onerror = () => reject(new Error("تعذر رفع الملف الكامل إلى التخزين المؤقت"));
    xhr.ontimeout = () => reject(new Error("انتهت مهلة رفع الملف الكامل"));
    xhr.onabort = () => reject(uploadCancelledError());
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`تعذر رفع الملف الكامل (${xhr.status})`));
        return;
      }
      resolve();
    };

    xhr.send(input.file);
  }).finally(() => {
    input.cancellation.currentRequest = null;
  });
}

async function uploadWholeFinalFileToZoho(input: {
  file: File;
  fileIndex: number;
  fileCount: number;
  ticket: string;
  uploadUrl: string;
  cancellation: MarketingFinalUploadCancellation;
  onProgress?: (progress: MarketingFinalUploadProgress) => void;
}) {
  if (input.cancellation.cancelled) throw uploadCancelledError();
  const startedAt = performance.now();
  input.onProgress?.({
    fileIndex: input.fileIndex,
    fileCount: input.fileCount,
    fileName: input.file.name,
    loaded: 0,
    total: input.file.size,
    percent: 0,
    speedBytesPerSecond: 0,
    etaSeconds: null,
    status: "pending",
    detail: "جاري تجهيز رفع الملف الكامل",
  });

  await uploadWholeFinalFile({
    file: input.file,
    fileIndex: input.fileIndex,
    fileCount: input.fileCount,
    uploadUrl: input.uploadUrl,
    startedAt,
    cancellation: input.cancellation,
    onProgress: input.onProgress,
  });

  if (input.cancellation.cancelled) throw uploadCancelledError();
  const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.2);
  input.onProgress?.({
    fileIndex: input.fileIndex,
    fileCount: input.fileCount,
    fileName: input.file.name,
    loaded: input.file.size,
    total: input.file.size,
    percent: 100,
    speedBytesPerSecond: input.file.size / elapsedSeconds,
    etaSeconds: 0,
    status: "verifying",
    detail: "اكتمل رفع الملف كاملًا، جاري نقله كما هو إلى Zoho WorkDrive",
  });

  const committed = await marketingFetch<Record<string, unknown>>("/api/marketing", {
    method: "POST",
    body: JSON.stringify({ action: "commit_final_file_upload", ticket: input.ticket }),
  });
  input.onProgress?.({
    fileIndex: input.fileIndex,
    fileCount: input.fileCount,
    fileName: input.file.name,
    loaded: input.file.size,
    total: input.file.size,
    percent: 100,
    speedBytesPerSecond: input.file.size / elapsedSeconds,
    etaSeconds: 0,
    status: "completed",
    detail: "تم رفع الملف كاملًا إلى Zoho WorkDrive",
  });
  return committed;
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
    mediaKind: "image" | "carousel" | "video" | "file";
    uploads: Array<{
      ticket: string;
      fileId: string;
      orderIndex: number;
      originalFileName: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      uploadUrl: string;
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
      await uploadWholeFinalFileToZoho({
        file,
        fileIndex: index,
        fileCount: prepared.uploads.length,
        ticket: upload.ticket,
        uploadUrl: upload.uploadUrl,
        cancellation,
        onProgress: input.onProgress,
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
