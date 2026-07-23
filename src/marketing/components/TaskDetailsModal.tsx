import { useEffect, useMemo, useState } from "react";
import { CheckCircle, DownloadSimple, FileArrowUp, HandTap, SealCheck, XCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { formatMarketingDate, marketingFetch, statusLabel, uploadMarketingFile } from "../api";
import type { MarketingMeta, MarketingTask } from "../types";
import { Field, MarketingBadge, ProgressBar } from "./Common";

const templateFields = [
  ["suggestedCreativeName", "الاسم المقترح للكرييتيف"],
  ["goal", "الهدف"],
  ["mainMessage", "الرسالة الأساسية"],
  ["voice", "الصوت"],
  ["cta", "CTA"],
  ["scenes", "المشاهد / تفاصيل كل مشهد"],
  ["slides", "السلايدات / تفاصيل كل سلايد"],
  ["script", "السكريبت الأساسي"],
  ["hook", "الهوك"],
  ["caption", "الكابشن"],
  ["hashtags", "الهاشتاج"],
] as const;

export function TaskDetailsModal({ task, meta, onClose, onChanged }: { task: MarketingTask | null; meta: MarketingMeta; onClose: () => void; onChanged: () => Promise<void> | void }) {
  const [templateData, setTemplateData] = useState<Record<string, string>>({});
  const [reviewNote, setReviewNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    const source = task?.template_data || {};
    setTemplateData(Object.fromEntries(templateFields.map(([key]) => [key, String(source[key] ?? "")])));
    setReviewNote(task?.review_note || "");
    setFile(null);
    setMessage("");
  }, [task]);

  const canReceive = Boolean(task && !task.received_at && meta.permissions["marketing.task.receive"] && (task.task_kind === "template" || !["waiting_template", "rejected"].includes(task.status)));
  const canEditTemplate = Boolean(task?.task_kind === "template" && task.received_at && meta.permissions["marketing.template.upload"] && ["active", "revision_requested"].includes(task.status));
  const canReview = Boolean(task?.task_kind === "template" && task.review_status === "pending_review" && meta.permissions["marketing.template.review"]);
  const canExecute = Boolean(task?.task_kind === "execution" && task.received_at && task.status !== "waiting_template" && meta.permissions["marketing.task.execute"]);
  const approvedData = useMemo(() => Object.entries(task?.template_data || {}).filter(([, value]) => String(value ?? "").trim()), [task]);

  function downloadTemplateSheet() {
    if (!task) return;
    const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
    const metadata = [
      ["رقم التاسك", task.task_no],
      ["المشروع", task.project_name],
      ["كود المشروع", task.campaign_code],
      ["نوع الكرييتيف", task.creative_type || ""],
      ["رقم الـInstance", task.instance_no || ""],
      ["كاتب المحتوى", task.content_writer_name || ""],
      ["موعد التسليم", formatMarketingDate(task.due_at, true)],
    ];
    const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:8px;text-align:right}th{background:#eee}</style></head><body><h2>Task Template — ${escapeHtml(task.task_no)}</h2><table><tbody>${metadata.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</tbody></table><br><table><thead><tr><th>الحقل</th><th>المحتوى</th></tr></thead><tbody>${templateFields.map(([key, label]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(templateData[key] || "")}</td></tr>`).join("")}</tbody></table></body></html>`;
    const url = URL.createObjectURL(new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${task.task_no}-task-template.xls`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function run(payload: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const result = await marketingFetch<{ ok: true; message?: string }>("/api/marketing", { method: "POST", body: JSON.stringify(payload) });
      setMessage(result.message || "تم تنفيذ الإجراء");
      await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر تنفيذ الإجراء"); }
    finally { setBusy(false); }
  }

  async function submitTemplate() {
    if (!task) return;
    setBusy(true); setMessage("");
    try {
      if (file) await uploadMarketingFile({ scope: "task", entityId: task.id, file, uploadKind: task.review_status === "revision_requested" ? "template_revision" : "template", metadata: templateData });
      const result = await marketingFetch<{ ok: true; message: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "submit_template", id: task.id, templateData }) });
      setMessage(result.message);
      await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر رفع Task Template"); }
    finally { setBusy(false); }
  }

  async function uploadFinalFile() {
    if (!task || !file) return setMessage("اختر الملف النهائي أولًا");
    setBusy(true); setMessage("");
    try {
      await uploadMarketingFile({ scope: "task", entityId: task.id, file, uploadKind: "final" });
      setMessage("تم رفع الملف النهائي داخل التاسك الصحيح");
      setFile(null);
      await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر رفع الملف النهائي"); }
    finally { setBusy(false); }
  }

  async function openUpload(uploadId: string) {
    try {
      const result = await marketingFetch<{ ok: true; url: string }>(`/api/marketing?resource=file&scope=task&id=${encodeURIComponent(uploadId)}`);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر فتح الملف"); }
  }

  return (
    <Modal open={Boolean(task)} onClose={onClose} title={task?.task_kind === "template" ? "تفاصيل Task Template" : "تفاصيل التاسك التنفيذي"} subtitle={task ? `${task.task_no} — ${task.project_name}` : ""} className="marketing-task-modal">
      {task ? <div className="marketing-task-detail">
        <div className="marketing-detail-grid">
          <div><span>المصدر</span><strong>{task.source_kind === "agenda" ? "أجندة" : "حملة"}</strong></div>
          <div><span>الكود</span><strong>{task.campaign_code}</strong></div>
          <div><span>نوع الحملة</span><strong>{task.campaign_type || "—"}</strong></div>
          <div><span>فترة المشروع</span><strong>{formatMarketingDate(task.project_starts_on)} — {formatMarketingDate(task.project_ends_on)}</strong></div>
          <div><span>الكرييتيف</span><strong>{task.creative_type || "—"}</strong></div>
          <div><span>رقم الـInstance</span><strong>{task.instance_no || "—"}</strong></div>
          {task.agenda_day ? <div><span>يوم الأجندة</span><strong>{formatMarketingDate(task.agenda_day)}</strong></div> : null}
          <div><span>القسم</span><strong>{task.department_name || "—"}</strong></div>
          <div><span>المسؤول</span><strong>{task.assigned_name || "—"}</strong></div>
          <div><span>كاتب المحتوى</span><strong>{task.content_writer_name || "—"}</strong></div>
          <div><span>موعد التسليم</span><strong>{formatMarketingDate(task.due_at, true)}</strong></div>
          <div><span>تاريخ الاستلام الفعلي</span><strong>{formatMarketingDate(task.received_at, true)}</strong></div>
          <div><span>الحالة</span><MarketingBadge value={statusLabel(task.status)} /></div>
        </div>
        <ProgressBar value={task.progress} />

        {task.project_objective || task.project_content_brief ? <div className="marketing-task-context-grid">
          {task.project_objective ? <div className="marketing-note"><strong>هدف المشروع</strong><p>{task.project_objective}</p></div> : null}
          {task.project_content_brief ? <div className="marketing-note"><strong>ملخص المحتوى</strong><p>{task.project_content_brief}</p></div> : null}
        </div> : null}

        {task.content_notes || task.admin_notes || task.assignment_notes ? <div className="marketing-task-context-grid">
          {task.content_notes ? <div className="marketing-note"><strong>ملاحظات المحتوى</strong><p>{task.content_notes}</p></div> : null}
          {task.admin_notes ? <div className="marketing-note"><strong>ملاحظات الإدارة</strong><p>{task.admin_notes}</p></div> : null}
          {task.assignment_notes ? <div className="marketing-note"><strong>ملاحظات التكليف</strong><p>{task.assignment_notes}</p></div> : null}
        </div> : null}

        {task.vehicles?.length ? <section className="marketing-detail-section"><h3>السيارات المرتبطة</h3><div className="marketing-task-vehicles">{task.vehicles.map((vehicle) => <div key={vehicle.id}><strong>{vehicle.car_name || vehicle.statement || "سيارة"}</strong><span>{vehicle.vin || "بدون VIN"}</span><small>{vehicle.model_year || "—"} — {vehicle.exterior_color || "—"} / {vehicle.interior_color || "—"} — {vehicle.location_name || "—"}</small></div>)}</div></section> : null}

        {task.review_note ? <div className="marketing-note warning"><strong>ملاحظة المراجعة</strong><p>{task.review_note}</p></div> : null}

        {canReceive ? <button className="marketing-primary-button" type="button" disabled={busy} onClick={() => void run({ action: "receive_task", id: task.id })}><HandTap size={18} />تم الاستلام</button> : null}

        {task.task_kind === "template" ? <section className="marketing-detail-section">
          <div className="marketing-section-title compact"><div><h3>بيانات Task Template</h3><p>استلم التاسك أولًا، ثم أكمل البيانات وارفع النسخة للمراجعة.</p></div><button type="button" onClick={downloadTemplateSheet}><DownloadSimple size={18} />تحميل النموذج</button></div>
          <div className="marketing-form-grid">
            {templateFields.map(([key, label]) => <Field key={key} label={label} wide={["scenes", "slides", "script"].includes(key)}>{["scenes", "slides", "script", "caption", "hashtags"].includes(key) ? <textarea value={templateData[key] || ""} disabled={!canEditTemplate} onChange={(event) => setTemplateData((current) => ({ ...current, [key]: event.target.value }))} /> : <input value={templateData[key] || ""} disabled={!canEditTemplate} onChange={(event) => setTemplateData((current) => ({ ...current, [key]: event.target.value }))} />}</Field>)}
          </div>
          {canEditTemplate ? <div className="marketing-upload-row"><label><FileArrowUp size={18} /><span>{file?.name || "اختيار ملف Excel للـTask Template"}</span><input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><button type="button" disabled={busy} onClick={() => void submitTemplate()}>رفع وإرسال للمراجعة</button></div> : null}
          {canReview ? <div className="marketing-review-box"><Field label="ملاحظة مدير النظام" wide><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></Field><div className="marketing-review-actions"><button className="approve" type="button" disabled={busy} onClick={() => void run({ action: "review_template", id: task.id, reviewAction: "approve", note: reviewNote })}><SealCheck size={18} />اعتماد</button><button className="revision" type="button" disabled={busy} onClick={() => void run({ action: "review_template", id: task.id, reviewAction: "request_revision", note: reviewNote })}>طلب تعديل</button><button className="reject" type="button" disabled={busy} onClick={() => void run({ action: "review_template", id: task.id, reviewAction: "reject", note: reviewNote })}><XCircle size={18} />رفض</button></div></div> : null}
        </section> : <>
          <section className="marketing-detail-section"><h3>Task Template المعتمدة</h3>{approvedData.length ? <div className="marketing-template-view">{approvedData.map(([key, value]) => <div key={key}><span>{templateFields.find(([field]) => field === key)?.[1] || key}</span><p>{String(value)}</p></div>)}</div> : <div className="marketing-note warning">لا توجد بيانات معتمدة حتى الآن.</div>}</section>
          <section className="marketing-detail-section"><h3>إجراءات التكليف</h3><div className="marketing-action-list">{task.actions.length ? task.actions.map((action) => <label key={action.id} className={action.completed ? "done" : ""}><input type="checkbox" checked={action.completed} disabled={!canExecute || busy} onChange={(event) => void run({ action: "task_action", taskId: task.id, actionId: action.id, completed: event.target.checked })} /><div><strong>{action.name}</strong><span>{action.percentage}%</span></div>{action.completed ? <CheckCircle size={21} weight="fill" /> : null}</label>) : <p>لا توجد إجراءات معرفة لهذا القسم داخل إعدادات التسويق.</p>}</div></section>
          <section className="marketing-detail-section"><h3>الملف النهائي</h3><div className="marketing-upload-row"><label><FileArrowUp size={18} /><span>{file?.name || "اختيار الملف النهائي"}</span><input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><button type="button" disabled={busy || !canExecute} onClick={() => void uploadFinalFile()}>رفع الملف النهائي</button></div></section>
        </>}

        {task.uploads.length ? <section className="marketing-detail-section"><h3>الملفات والنسخ السابقة</h3><div className="marketing-files-list">{task.uploads.map((upload) => <button type="button" key={upload.id} onClick={() => void openUpload(upload.id)}><DownloadSimple size={18} /><span>{upload.file_name}</span><small>نسخة {upload.version_no || 1} — {formatMarketingDate(upload.created_at, true)}</small></button>)}</div></section> : null}
        {message ? <p className="marketing-form-message">{message}</p> : null}
      </div> : null}
    </Modal>
  );
}
