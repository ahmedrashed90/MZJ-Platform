import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  DownloadSimple,
  File,
  FolderOpen,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { marketingFetch, marketingQuery } from "../api";
import { MarketingAlert, ProgressBar } from "../components/MarketingPage";

type FolderKind = "raw" | "output";

type TaskFolderItem = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: string | null;
  modifiedTime: string | null;
  isFolder: boolean;
  managedByTask: boolean;
  canDelete: boolean;
};

type TaskFolderPayload = {
  ok: boolean;
  task: {
    id: string;
    title: string;
    sourceName: string;
    creativeName: string;
    departmentName: string;
    assignedName: string;
  };
  kind: FolderKind;
  rootFolderId: string;
  currentFolderId: string;
  breadcrumbs: Array<{ id: string; name: string }>;
  permissions: { canUpload: boolean; canDelete: boolean };
  items: TaskFolderItem[];
};

type UploadView = {
  fileName: string;
  fileIndex: number;
  fileCount: number;
  loaded: number;
  total: number;
  percent: number;
  speed: number;
  eta: number | null;
  status: "uploading" | "completed" | "cancelled";
};

function formatBytes(value: number) {
  const bytes = Math.max(0, Number(value || 0));
  if (!bytes) return "0 بايت";
  const units = ["بايت", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** unit;
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

function formatEta(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.max(0, Math.ceil(seconds))} ث`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} د ${Math.ceil(seconds % 60)} ث`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ar-SA-u-nu-latn", { dateStyle: "medium", timeStyle: "short" });
}

function putFile(
  file: File,
  uploadUrl: string,
  fileIndex: number,
  fileCount: number,
  requestRef: MutableRefObject<XMLHttpRequest | null>,
  cancelledRef: MutableRefObject<boolean>,
  onProgress: (state: UploadView) => void,
) {
  return new Promise<void>((resolve, reject) => {
    if (cancelledRef.current) {
      reject(new Error("تم إلغاء رفع الملفات"));
      return;
    }
    const request = new XMLHttpRequest();
    requestRef.current = request;
    const startedAt = performance.now();
    request.open("PUT", uploadUrl, true);
    request.timeout = 0;
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.upload.onprogress = (event) => {
      const loaded = event.lengthComputable ? Math.min(event.loaded, file.size) : 0;
      const elapsed = Math.max((performance.now() - startedAt) / 1000, 0.2);
      const speed = loaded / elapsed;
      const remaining = Math.max(0, file.size - loaded);
      onProgress({
        fileName: file.name,
        fileIndex,
        fileCount,
        loaded,
        total: file.size,
        percent: file.size ? Math.min(100, Math.round((loaded / file.size) * 100)) : 100,
        speed,
        eta: speed > 0 ? Math.ceil(remaining / speed) : null,
        status: "uploading",
      });
    };
    request.onerror = () => reject(new Error("تعذر رفع الملف إلى Google Drive"));
    request.ontimeout = () => reject(new Error("انتهت مهلة رفع الملف"));
    request.onabort = () => reject(new Error("تم إلغاء رفع الملفات"));
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`تعذر رفع الملف (${request.status})`));
        return;
      }
      const elapsed = Math.max((performance.now() - startedAt) / 1000, 0.2);
      onProgress({
        fileName: file.name,
        fileIndex,
        fileCount,
        loaded: file.size,
        total: file.size,
        percent: 100,
        speed: file.size / elapsed,
        eta: 0,
        status: "completed",
      });
      resolve();
    };
    request.send(file);
  }).finally(() => {
    requestRef.current = null;
  });
}

export function TaskFolderPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const taskId = String(searchParams.get("taskId") || "").trim();
  const kind: FolderKind = searchParams.get("kind") === "raw" ? "raw" : "output";
  const folderId = String(searchParams.get("folderId") || "").trim();
  const [payload, setPayload] = useState<TaskFolderPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [upload, setUpload] = useState<UploadView | null>(null);
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const cancelledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const title = kind === "raw" ? "فولدر الخام" : "فولدر التسليم";
  const subtitle = useMemo(() => [payload?.task.sourceName, payload?.task.creativeName, payload?.task.assignedName].filter(Boolean).join(" · "), [payload]);

  async function load() {
    if (!taskId) {
      setError("رقم التاسك غير موجود");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await marketingFetch<TaskFolderPayload>(`/api/marketing${marketingQuery({ resource: "task_folder", taskId, kind, folderId: folderId || undefined })}`);
      setPayload(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل الفولدر");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    requestRef.current?.abort();
    cancelledRef.current = false;
    setUpload(null);
    void load();
  }, [taskId, kind, folderId]);

  useEffect(() => () => requestRef.current?.abort(), []);

  function openFolder(id: string) {
    const next = new URLSearchParams({ taskId, kind });
    if (id && id !== payload?.rootFolderId) next.set("folderId", id);
    setSearchParams(next);
  }

  function downloadFile(item: TaskFolderItem) {
    const url = `/api/marketing${marketingQuery({ resource: "task_folder_file", taskId, kind, fileId: item.id, download: 1 })}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function deleteFile(item: TaskFolderItem) {
    if (!item.canDelete) return;
    if (!window.confirm(`مسح الملف "${item.name}"؟`)) return;
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message?: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "delete_task_folder_item", taskId, kind, fileId: item.id }),
      });
      setMessage(result.message || "تم مسح الملف");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر مسح الملف");
    }
  }

  async function uploadFiles(files: FileList | null) {
    const selected = Array.from(files || []).filter((file) => file.size > 0);
    if (!selected.length || !payload?.permissions.canUpload) return;
    cancelledRef.current = false;
    setError("");
    setMessage("");
    try {
      for (let index = 0; index < selected.length; index += 1) {
        if (cancelledRef.current) throw new Error("تم إلغاء رفع الملفات");
        const file = selected[index];
        setUpload({ fileName: file.name, fileIndex: index, fileCount: selected.length, loaded: 0, total: file.size, percent: 0, speed: 0, eta: null, status: "uploading" });
        const prepared = await marketingFetch<{ uploadUrl: string; verificationKey: string }>("/api/marketing", {
          method: "POST",
          body: JSON.stringify({
            action: "prepare_task_folder_upload",
            taskId,
            kind,
            folderId: payload.currentFolderId,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            fileSize: file.size,
          }),
        });
        try {
          await putFile(file, prepared.uploadUrl, index, selected.length, requestRef, cancelledRef, setUpload);
        } catch (failure) {
          if (cancelledRef.current) throw failure;
          // The binary can reach Drive successfully even when the browser cannot read
          // the cross-origin PUT response. The backend verification below is authoritative.
        }
        if (cancelledRef.current) throw new Error("تم إلغاء رفع الملفات");
        await marketingFetch("/api/marketing", {
          method: "POST",
          body: JSON.stringify({
            action: "verify_task_folder_upload",
            taskId,
            kind,
            folderId: payload.currentFolderId,
            verificationKey: prepared.verificationKey,
            fileName: file.name,
            fileSize: file.size,
          }),
        });
        setUpload((current) => current ? { ...current, loaded: file.size, total: file.size, percent: 100, eta: 0, status: "completed" } : current);
      }
      setMessage(selected.length > 1 ? `تم رفع ${selected.length.toLocaleString("ar-SA-u-nu-latn")} ملفات` : "تم رفع الملف");
      setUpload(null);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      await load();
    } catch (failure) {
      const text = failure instanceof Error ? failure.message : "تعذر رفع الملفات";
      if (cancelledRef.current || text.includes("إلغاء")) {
        setUpload((current) => current ? { ...current, status: "cancelled" } : null);
        setMessage("تم إلغاء رفع الملفات");
      } else {
        setError(text);
      }
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function cancelUpload() {
    cancelledRef.current = true;
    requestRef.current?.abort();
  }

  return (
    <div className="marketing-task-folder-page">
      <div className="marketing-task-folder-head">
        <div>
          <button type="button" className="marketing-task-folder-back" onClick={() => navigate(-1)}><ArrowRight size={18} />رجوع للتاسك</button>
          <h1><FolderOpen size={28} weight="duotone" />{title}</h1>
          <p>{subtitle || "ملفات التنفيذ داخل MZJ Platform"}</p>
        </div>
        {payload?.permissions.canUpload ? <label className="marketing-task-folder-upload secondary">
          <UploadSimple size={18} />رفع ملفات
          <input ref={fileInputRef} type="file" multiple onChange={(event) => void uploadFiles(event.target.files)} />
        </label> : null}
      </div>

      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

      {upload ? <section className="marketing-task-folder-upload-progress">
        <div className="marketing-task-folder-upload-progress-head">
          <div><strong>{upload.fileName}</strong><span>ملف {(upload.fileIndex + 1).toLocaleString("ar-SA-u-nu-latn")} من {upload.fileCount.toLocaleString("ar-SA-u-nu-latn")}</span></div>
          {upload.status === "uploading" ? <button type="button" className="danger ghost" onClick={cancelUpload}><X size={17} />إلغاء</button> : null}
        </div>
        <ProgressBar value={upload.percent} />
        <div className="marketing-task-folder-upload-stats">
          <span>{formatBytes(upload.loaded)} / {formatBytes(upload.total)}</span>
          <span>السرعة: {formatBytes(upload.speed)}/ث</span>
          <span>المتبقي: {formatEta(upload.eta)}</span>
        </div>
      </section> : null}

      <nav className="marketing-task-folder-breadcrumbs" aria-label="مسار الفولدر">
        {(payload?.breadcrumbs || []).map((crumb, index) => (
          <button key={crumb.id} type="button" onClick={() => openFolder(crumb.id)} disabled={index === (payload?.breadcrumbs.length || 0) - 1}>
            {crumb.name}
          </button>
        ))}
      </nav>

      <section className="marketing-task-folder-card">
        {loading && !payload ? <div className="marketing-empty">جاري تحميل الملفات...</div> : null}
        {!loading && payload && !payload.items.length ? <div className="marketing-empty">الفولدر فارغ</div> : null}
        {payload?.items.length ? <div className="marketing-task-folder-list">
          {payload.items.map((item) => (
            <article key={item.id} className={`marketing-task-folder-row ${item.isFolder ? "folder" : "file"}`}>
              <button type="button" className="marketing-task-folder-main" onClick={() => item.isFolder ? openFolder(item.id) : downloadFile(item)}>
                <span className="marketing-task-folder-icon">{item.isFolder ? <FolderOpen size={24} weight="duotone" /> : <File size={24} weight="duotone" />}</span>
                <span className="marketing-task-folder-name"><strong>{item.name}</strong><small>{item.isFolder ? "فولدر" : `${formatBytes(item.size)} · ${formatDate(item.modifiedTime || item.createdTime)}`}</small></span>
              </button>
              {!item.isFolder ? <div className="marketing-task-folder-actions">
                <button type="button" className="secondary ghost" title="تحميل" onClick={() => downloadFile(item)}><DownloadSimple size={18} /></button>
                {item.canDelete ? <button type="button" className="danger ghost" title="مسح" onClick={() => void deleteFile(item)}><Trash size={18} /></button> : null}
              </div> : null}
            </article>
          ))}
        </div> : null}
      </section>
    </div>
  );
}
