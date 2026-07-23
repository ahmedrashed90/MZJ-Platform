import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, DownloadSimple, FileArrowUp, FileText, Play, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import { useAuth } from "../../auth/AuthContext";
import { marketingFetch, marketingPost } from "../api";
import { downloadTaskTemplateFile, parseTaskTemplate, taskTemplateLabels } from "../excel";
import type { TaskRow } from "../types";
import { DepartmentBadge, formatDate, MarketingAlert, MarketingEmpty, MarketingLoading, ProgressBar, StatusBadge } from "./Ui";

type TaskResponse = { ok: true; rows: TaskRow[]; total: number };

type UploadPreparation = { ok: true; storageKey: string; uploadUrl: string; mimeType: string };

type ParsedTemplate = { templateType: string; taskTemplateFields: Array<{ key: string; label: string; value: string }>; parsedRows: Array<Record<string, unknown>>; fileName: string };

export function TaskDetailView({ taskId, onChanged }: { taskId: string; onChanged?: () => void | Promise<void> }) {
  const { user } = useAuth();
  const [task, setTask] = useState<TaskRow | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [parsedPreview, setParsedPreview] = useState<ParsedTemplate | null>(null);
  const templateInput = useRef<HTMLInputElement>(null);
  const finalInput = useRef<HTMLInputElement>(null);

  const isAdmin = Boolean(user?.roleCodes.some((code) => ["admin", "system_admin"].includes(code)) || user?.permissions.includes("marketing.tasks.review"));
  const isOwner = task?.assigned_to === user?.id;

  async function load() {
    setLoading(true); setError("");
    try {
      const result = await marketingFetch<TaskResponse>(`/api/marketing?resource=tasks&taskId=${encodeURIComponent(taskId)}&pageSize=1`);
      setTask(result.rows[0] || null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل التاسك"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [taskId]);

  const templateFields = useMemo(() => {
    const parsed = task?.latest_template?.parsed_data as { taskTemplateFields?: Array<{ key: string; label: string; value: string }>; parsedRows?: Array<Record<string, unknown>> } | undefined;
    if (Array.isArray(parsed?.taskTemplateFields)) return parsed.taskTemplateFields;
    const row = parsed?.parsedRows?.[0] || {};
    return taskTemplateLabels.map(([key, label]) => ({ key, label, value: String(row[key] || "") }));
  }, [task]);

  async function act(body: Record<string, unknown>) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await marketingPost<{ ok: true; message?: string }>({ ...body, taskId });
      setMessage(result.message || "تم تنفيذ الإجراء");
      await load(); await onChanged?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء"); }
    finally { setBusy(false); }
  }

  async function uploadFile(file: File, fileKind: "template" | "final", parsedData?: ParsedTemplate) {
    setBusy(true); setError(""); setMessage("");
    try {
      const prep = await marketingPost<UploadPreparation>({ action: "prepare_task_upload", taskId, fileKind, fileName: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size });
      const uploadResponse = await fetch(prep.uploadUrl, { method: "PUT", headers: { "content-type": prep.mimeType }, body: file });
      if (!uploadResponse.ok) throw new Error("تعذر رفع الملف إلى التخزين");
      const result = await marketingPost<{ ok: true; message: string }>({ action: "finalize_task_upload", taskId, fileKind, fileName: file.name, mimeType: file.type || prep.mimeType, fileSize: file.size, storageKey: prep.storageKey, parsedData: parsedData || {} });
      setMessage(result.message); setParsedPreview(null); await load(); await onChanged?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر رفع الملف"); }
    finally { setBusy(false); }
  }

  async function chooseTemplate(file?: File) {
    if (!file) return;
    try {
      const parsed = await parseTaskTemplate(file);
      setParsedPreview(parsed);
      await uploadFile(file, "template", parsed);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر قراءة Task Template"); }
    finally { if (templateInput.current) templateInput.current.value = ""; }
  }

  async function downloadFile(fileId: string) {
    setError("");
    try {
      const result = await marketingPost<{ ok: true; downloadUrl: string; fileName: string }>({ action: "download_task_file", taskId, fileId });
      const link = document.createElement("a"); link.href = result.downloadUrl; link.target = "_blank"; link.rel = "noopener"; link.download = result.fileName; link.click();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تنزيل الملف"); }
  }

  if (loading && !task) return <MarketingLoading label="جاري تحميل التاسك..." />;
  if (!task) return <MarketingAlert>{error || "التاسك غير موجود"}</MarketingAlert>;

  const overdue = task.due_at && new Date(task.due_at) < new Date() && Number(task.progress_percent) < 100;
  const templateTask = task.task_type === "content_template";
  const finalFile = task.files?.find((file) => file.file_kind === "final");

  return (
    <div className="marketing-task-detail">
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}
      <section className="marketing-task-detail-hero">
        <div><span>{task.task_code}</span><h3>{task.creative_name || task.title}</h3><p>{task.campaign_code} · {task.campaign_name}</p><div><DepartmentBadge code={task.department_code} /><StatusBadge status={task.status} /></div></div>
        <div><ProgressBar value={task.progress_percent} label="نسبة إنجاز التاسك" /><span className={overdue ? "late" : ""}>{overdue ? <WarningCircle size={16} /> : null} موعد التسليم: {formatDate(task.due_at)}</span></div>
      </section>

      <section className="marketing-task-meta-grid">
        <div><small>المسؤول</small><strong>{task.assigned_to_name || "—"}</strong></div>
        <div><small>كاتب المحتوى المرتبط</small><strong>{task.paired_content_user_name || task.content_user_name || "—"}</strong></div>
        <div><small>نوع التاسك</small><strong>{templateTask ? "Task Template" : "تاسك تنفيذي"}</strong></div>
        <div><small>تاريخ الاستلام</small><strong>{formatDate(task.received_at, true)}</strong></div>
      </section>

      <div className="marketing-task-main-actions">
        {isOwner && task.status === "ready" ? <button type="button" className="primary" disabled={busy} onClick={() => void act({ action: "receive_task" })}><CheckCircle size={18} />استلام التاسك</button> : null}
        {isOwner && ["ready", "received", "changes_requested"].includes(task.status) ? <button type="button" className="primary" disabled={busy} onClick={() => void act({ action: "start_task" })}><Play size={18} />بدء العمل</button> : null}
        {templateTask ? <button type="button" disabled={busy} onClick={() => void downloadTaskTemplateFile(task).catch((failure) => setError(failure instanceof Error ? failure.message : "تعذر تحميل القالب"))}><DownloadSimple size={18} />تحميل قالب Task Template</button> : null}
        {templateTask && isOwner && ["pending_template", "changes_requested", "template_submitted"].includes(task.status) ? <><input ref={templateInput} hidden type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void chooseTemplate(event.target.files?.[0])} /><button type="button" className="primary" disabled={busy} onClick={() => templateInput.current?.click()}><FileArrowUp size={18} />{task.status === "changes_requested" ? "رفع النسخة المعدلة" : "رفع Task Template"}</button></> : null}
        {!templateTask && isOwner && Number(task.progress_percent) >= 100 && task.status !== "completed" ? <><input ref={finalInput} hidden type="file" accept=".mp4,.mov,.webm,.jpg,.jpeg,.png,.pdf,.zip,.psd,.ai" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file, "final"); if (finalInput.current) finalInput.current.value = ""; }} /><button type="button" className="primary" disabled={busy} onClick={() => finalInput.current?.click()}><UploadSimple size={18} />رفع الملف النهائي</button></> : null}
        {templateTask && isOwner && Number(task.progress_percent) >= 100 && !task.user_completed_at ? <button type="button" disabled={busy} onClick={() => void act({ action: "mark_content_done" })}><CheckCircle size={18} />تم الانتهاء</button> : null}
      </div>

      {parsedPreview ? <section className="marketing-template-preview"><h3>تمت قراءة Task Template</h3><div>{parsedPreview.taskTemplateFields.map((field) => <div key={field.key}><span>{field.label}</span><strong>{field.value || "—"}</strong></div>)}</div></section> : null}

      {templateTask ? (
        <section className="marketing-task-template-section">
          <div className="marketing-section-title"><div><span>Task Template</span><small>البيانات الحقيقية المقروءة من الملف المرفوع</small></div></div>
          {task.latest_template ? <>
            <div className="marketing-template-review-summary"><div><FileText size={22} /><div><strong>الإصدار {task.latest_template.version_no}</strong><span>الحالة: {task.latest_template.status} · رفع {formatDate(task.latest_template.submitted_at, true)}</span></div></div><StatusBadge status={task.status} /></div>
            <div className="marketing-template-fields">{templateFields.map((field) => <div key={field.key}><span>{field.label}</span><strong>{field.value || "—"}</strong></div>)}</div>
            {task.latest_template.review_note ? <div className="marketing-review-note"><strong>ملاحظة المراجعة</strong><p>{task.latest_template.review_note}</p></div> : null}
            {isAdmin && task.status === "template_submitted" ? <div className="marketing-review-actions"><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="ملاحظات المراجعة أو التعديل" /><div><button type="button" className="danger" disabled={busy} onClick={() => void act({ action: "review_template", decision: "rejected", note: reviewNote })}>رفض</button><button type="button" className="warning" disabled={busy} onClick={() => void act({ action: "review_template", decision: "changes_requested", note: reviewNote })}>محتاج تعديل</button><button type="button" className="primary" disabled={busy} onClick={() => void act({ action: "review_template", decision: "approved", note: reviewNote })}>اعتماد Task Template</button></div></div> : null}
          </> : <MarketingEmpty title="لم يتم رفع Task Template" description="يظهر الملف والحقول هنا بعد رفع الكاتب للنسخة الحقيقية." />}
        </section>
      ) : (
        <section className="marketing-execution-workflow">
          <div className="marketing-section-title"><div><span>إجراءات التكليف</span><small>يتم تنفيذها بالترتيب، وإجراءات الأدمن لا ينفذها اليوزر العادي.</small></div></div>
          <div className="marketing-action-timeline">{task.actions?.length ? task.actions.map((step, index) => <article key={step.id} className={step.is_completed ? "done" : ""}><span>{step.is_completed ? <CheckCircle size={20} weight="fill" /> : index + 1}</span><div><strong>{step.action_name}</strong><small>{Number(step.weight)}% {step.is_admin_only ? "· إجراء أدمن" : "· إجراء تنفيذي"}</small>{step.note ? <p>{step.note}</p> : null}</div><button type="button" disabled={busy || (step.is_admin_only ? !isAdmin : !isOwner && !isAdmin)} onClick={() => void act({ action: step.is_completed ? "undo_task_action" : "complete_task_action", actionId: step.id })}>{step.is_completed ? "إلغاء التنفيذ" : "تم التنفيذ"}</button></article>) : <MarketingEmpty title="لا توجد إجراءات معرفة لهذا القسم" />}</div>
          <div className="marketing-files-list"><h3>الملفات</h3>{task.files?.length ? task.files.map((file) => <button type="button" key={file.id} onClick={() => void downloadFile(file.id)}><DownloadSimple size={18} /><div><strong>{file.file_name}</strong><span>{file.file_kind === "final" ? "ملف نهائي" : file.file_kind === "template" ? "Task Template" : "مرفق"} · {formatDate(file.uploaded_at, true)}</span></div></button>) : <MarketingEmpty title="لا توجد ملفات مرفوعة" />}</div>
          {isAdmin && finalFile && task.status === "under_review" ? <div className="marketing-review-actions"><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="ملاحظات مراجعة الملف النهائي" /><div><button type="button" className="danger" disabled={busy} onClick={() => void act({ action: "review_final_file", decision: "rejected", note: reviewNote })}>رفض</button><button type="button" className="warning" disabled={busy} onClick={() => void act({ action: "review_final_file", decision: "changes_requested", note: reviewNote })}>محتاج تعديل</button><button type="button" className="primary" disabled={busy} onClick={() => void act({ action: "review_final_file", decision: "approved", note: reviewNote })}>اعتماد ونقل لتجهيز النشر</button></div></div> : null}
        </section>
      )}
    </div>
  );
}
