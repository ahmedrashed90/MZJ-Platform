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
  currentReader: FileReader | null;
  cancel: () => void;
};

export function createMarketingFinalUploadCancellation(): MarketingFinalUploadCancellation {
  const control: MarketingFinalUploadCancellation = {
    cancelled: false,
    groupId: "",
    currentRequest: null,
    currentReader: null,
    cancel() {
      control.cancelled = true;
      control.currentReader?.abort();
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

function fileToDataUrl(input: { file: File; cancellation: MarketingFinalUploadCancellation }) {
  return new Promise<string>((resolve, reject) => {
    if (input.cancellation.cancelled) return reject(uploadCancelledError());
    const reader = new FileReader();
    input.cancellation.currentReader = reader;
    reader.onerror = () => reject(new Error("تعذر قراءة الملف المحدد"));
    reader.onabort = () => reject(uploadCancelledError());
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(input.file);
  }).finally(() => {
    input.cancellation.currentReader = null;
  });
}

function uploadFileThroughPlatform(input: {
  file: File;
  fileIndex: number;
  fileCount: number;
  ticket: string;
  cancellation: MarketingFinalUploadCancellation;
  onProgress?: (progress: MarketingFinalUploadProgress) => void;
}) {
  return new Promise<Record<string, unknown>>(async (resolve, reject) => {
    if (input.cancellation.cancelled) return reject(uploadCancelledError());
    let dataUrl = "";
    try {
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
        detail: "جاري تجهيز الملف للرفع",
      });
      dataUrl = await fileToDataUrl({ file: input.file, cancellation: input.cancellation });
    } catch (error) {
      reject(error);
      return;
    }
    if (input.cancellation.cancelled) return reject(uploadCancelledError());

    const xhr = new XMLHttpRequest();
    input.cancellation.currentRequest = xhr;
    const startedAt = performance.now();
    xhr.open("POST", "/api/marketing", true);
    xhr.withCredentials = true;
    xhr.timeout = 0;
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Accept", "application/json");

    xhr.upload.onprogress = (event) => {
      const ratio = event.lengthComputable && event.total > 0 ? Math.min(1, event.loaded / event.total) : 0;
      const loaded = Math.round(input.file.size * ratio);
      const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.2);
      const speedBytesPerSecond = loaded / elapsedSeconds;
      const remaining = Math.max(0, input.file.size - loaded);
      input.onProgress?.({
        fileIndex: input.fileIndex,
        fileCount: input.fileCount,
        fileName: input.file.name,
        loaded,
        total: input.file.size,
        percent: Math.min(100, Math.round(ratio * 100)),
        speedBytesPerSecond,
        etaSeconds: speedBytesPerSecond > 0 ? Math.ceil(remaining / speedBytesPerSecond) : null,
        status: "uploading",
      });
    };

    xhr.onerror = () => reject(new Error("تعذر رفع الملف إلى Zoho WorkDrive عبر المنصة"));
    xhr.ontimeout = () => reject(new Error("انتهت مهلة رفع الملف إلى Zoho WorkDrive"));
    xhr.onabort = () => reject(uploadCancelledError());
    xhr.onload = () => {
      const payload = parseUploadResponse(xhr) as any;
      if (xhr.status < 200 || xhr.status >= 300 || payload.ok === false) {
        reject(new Error(String(payload.error || payload.message || `تعذر رفع الملف إلى Zoho (${xhr.status})`)));
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
        status: "completed",
        detail: "تم الرفع إلى Zoho WorkDrive",
      });
      resolve(payload);
    };

    xhr.send(JSON.stringify({
      action: "upload_final_file_proxy",
      ticket: input.ticket,
      fileName: input.file.name,
      mimeType: input.file.type || "application/octet-stream",
      fileSize: input.file.size,
      fileData: dataUrl,
    }));
  }).finally(() => {
    input.cancellation.currentRequest = null;
  });
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
    uploads: Array<{
      ticket: string;
      fileId: string;
      orderIndex: number;
      originalFileName: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
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
      await uploadFileThroughPlatform({
        file,
        fileIndex: index,
        fileCount: prepared.uploads.length,
        ticket: upload.ticket,
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
