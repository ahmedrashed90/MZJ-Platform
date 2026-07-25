import { useEffect, useState } from "react";
import { CheckCircle, DownloadSimple, FileArrowUp, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { downloadMarketingFile, marketingFetch, marketingQuery, uploadMarketingFile } from "../api";
import { downloadTaskTemplate, parseTaskTemplate } from "../templateExcel";
import { MarketingAlert, ProgressBar } from "./MarketingPage";

const writerLabels: Record<string, string> = {
  proposedName: "الاسم المقترح للكرييتيف",
  goal: "الهدف",
  mainMessage: "الرسالة الأساسية",
  hook: "الهوك",
  mainScript: "السكريبت الأساسي",
  cta: "CTA",
  caption: "Caption",
  hashtags: "Hashtag",
};

function carsText(cars: unknown) {
  if (!Array.isArray(cars) || !cars.length) return "—";
  return cars.map((car: any) => [car.car_name || car.name || car.vin || "سيارة", car.exterior_color, car.interior_color].filter(Boolean).join(" - ")).join("، ");
}

export function TaskDetailModal({ taskId, onClose, onChanged }: { taskId: string | null; onClose: () => void; onChanged?: () => void }) {
  const [payload, setPayload] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [editData, setEditData] = useState<Record<string, string>>({});

  async function load() {
    if (!taskId) return;
    setLoading(true); setError("");
    try {
      const result = await marketingFetch<any>(`/api/marketing${marketingQuery({ resource: "task", id: taskId })}`);
      setPayload(result); setAdminNote(result.task.admin_note || ""); setEditData(result.task.template_data || {});
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل التاسك"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [taskId]);

  async function action(body: Record<string, unknown>) {
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await marketingFetch<{ message?: string }>("/api/marketing", { method: "POST", body: JSON.stringify(body) });
      setMessage(result.message || "تم التنفيذ"); await load(); onChanged?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء"); }
    finally { setLoading(false); }
  }

  async function uploadTemplate(file: File) {
    if (!payload?.task) return;
    setLoading(true); setError("");
    try {
      const data = await parseTaskTemplate(file);
      const fileId = await uploadMarketingFile({ file, category: "task-template", sourceType: payload.task.source_type, sourceId: payload.task.source_id, taskId: payload.task.id });
      await action({ action: "upload_template", taskId: payload.task.id, fileId, templateData: data });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر رفع Task Template"); setLoading(false); }
  }

  async function uploadFinal(file: File) {
    if (!payload?.task) return;
    setLoading(true); setError("");
    try {
      const fileId = await uploadMarketingFile({ file, category: "final-file", sourceType: payload.task.source_type, sourceId: payload.task.source_id, taskId: payload.task.id });
      await action({ action: "attach_final_file", taskId: payload.task.id, fileId });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر رفع الملف النهائي"); setLoading(false); }
  }

  const task = payload?.task;
  const permissions = payload?.permissions || {};
  const canReview = Boolean(permissions.canApproveTemplate || permissions.canRejectTemplate);
  const approved = task?.approved_data || task?.approved_template_data || {};
  return (
    <Modal open={Boolean(taskId)} title={task?.title || "تفاصيل التاسك"} subtitle={task ? `${task.source_name || "—"} · ${task.department_name || "قسم المحتوى"}` : undefined} onClose={onClose} className="marketing-task-modal">
      {loading && !task ? <div className="marketing-empty">جاري تحميل التاسك...</div> : null}
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}
      {task ? <div className="marketing-task-detail">
        <div className="marketing-detail-grid">
          <div><small>الحملة أو الأجندة</small><strong>{task.source_name || "—"}</strong></div>
          <div><small>كود الحملة</small><strong>{task.campaign_code || "—"}</strong></div>
          <div><small>نوع الحملة</small><strong>{task.campaign_type || (task.source_type === "agenda" ? "أجندة" : "—")}</strong></div>
          <div><small>تاريخ الحملة</small><strong>{String(task.campaign_date || "—").slice(0, 10)}</strong></div>
          <div><small>بداية النشر</small><strong>{String(task.campaign_start || "—").slice(0, 10)}</strong></div>
          <div><small>نهاية النشر</small><strong>{String(task.campaign_end || "—").slice(0, 10)}</strong></div>
          <div><small>هدف الحملة</small><strong>{task.objective || "—"}</strong></div>
          <div><small>رقم التاسك</small><strong>{task.task_no || task.instance_code || "—"}</strong></div>
          <div><small>الكرييتيف</small><strong>{task.creative_name || "—"}</strong></div>
          <div><small>السيارات</small><strong>{carsText(task.cars)}</strong></div>
          <div><small>المسؤول</small><strong>{task.assigned_name || "—"}</strong></div>
          <div><small>كاتب المحتوى المرتبط</small><strong>{task.content_user_name || "—"}</strong></div>
          <div><small>موعد التسليم</small><strong>{String(task.due_at || task.template_due_on || "—").slice(0, 10)}</strong></div>
          <div><small>ملاحظات القسم</small><strong>{task.note || task.template_department_note || "—"}</strong></div>
          <div className="wide"><small>المطلوب من كاتب المحتوى</small><strong>{task.required_from_content || "—"}</strong></div>
        </div>
        <ProgressBar value={Number(task.progress || 0)} />
        {task.task_kind === "task_template" ? <>
          <section className="marketing-task-section"><h3>Task Template</h3><p>{task.template_department_note || task.note || "لا توجد ملاحظات"}</p><div className="marketing-inline-actions">{permissions.canDownloadTemplate ? <button type="button" className="secondary" onClick={() => downloadTaskTemplate(task)}><DownloadSimple size={17} />تحميل Task Template</button> : null}{permissions.canUploadTemplate ? <label className="marketing-upload-button"><FileArrowUp size={17} />إرفاق Task Template Excel<input type="file" accept=".xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadTemplate(file); event.currentTarget.value = ""; }} /></label> : null}{task.template_file_id && permissions.canDownloadFile ? <button type="button" className="secondary" onClick={() => void downloadMarketingFile(task.template_file_id)}><DownloadSimple size={17} />تحميل الملف المرفوع</button> : null}</div></section>
          <section className="marketing-task-section"><h3>بيانات كاتب المحتوى</h3><div className="marketing-form-grid">{Object.entries(writerLabels).map(([key, label]) => <label key={key}><span>{label}</span><textarea rows={key === "mainScript" ? 4 : 2} value={editData[key] || ""} disabled={!canReview} onChange={(event) => setEditData((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div></section>
          {canReview ? <section className="marketing-task-section admin"><h3><ShieldCheck size={21} />مراجعة واعتماد</h3><label><span>ملاحظة المراجع</span><textarea rows={3} value={adminNote} onChange={(event) => setAdminNote(event.target.value)} /></label><div className="marketing-review-actions">{permissions.canRejectTemplate ? <><button type="button" onClick={() => void action({ action: "review_template", templateId: task.task_template_id, reviewAction: "request_edit", note: adminNote, data: editData })}>طلب تعديل</button><button type="button" onClick={() => void action({ action: "review_template", templateId: task.task_template_id, reviewAction: "edit", note: adminNote, data: editData })}>تعديل</button><button type="button" className="danger" onClick={() => void action({ action: "review_template", templateId: task.task_template_id, reviewAction: "reject", note: adminNote, data: editData })}>مرفوض</button></> : null}{permissions.canApproveTemplate ? <button type="button" className="primary" onClick={() => void action({ action: "review_template", templateId: task.task_template_id, reviewAction: "approve", note: adminNote, data: editData })}><CheckCircle size={17} />اعتماد التعليمات</button> : null}</div></section> : null}
          {payload.history?.length ? <section className="marketing-task-section"><h3>سجل المراجعات</h3><div className="marketing-history">{payload.history.map((item: any) => <article key={item.id}><strong>{item.action}</strong><span>{item.actor_name || "—"}</span><small>{new Date(item.created_at).toLocaleString("ar-SA")}</small>{item.note ? <p>{item.note}</p> : null}</article>)}</div></section> : null}
        </> : <>
          {task.template_status !== "approved" ? <MarketingAlert type="info"><WarningCircle size={18} />في انتظار اعتماد Task Template</MarketingAlert> : <section className="marketing-task-section"><h3>بيانات Task Template المعتمدة</h3><div className="marketing-approved-data">{Object.entries(writerLabels).map(([key, label]) => <div key={key}><small>{label}</small><p>{approved[key] || "—"}</p></div>)}</div></section>}
          <section className="marketing-task-section"><h3>إجراءات التكليف</h3><div className="marketing-actions-list">{payload.actions?.length ? payload.actions.map((item: any) => <label key={item.id} className={item.completed ? "completed" : ""}><input type="checkbox" checked={Boolean(item.completed)} disabled={loading || task.template_status !== "approved" || (item.admin_only ? !permissions.canExecuteAdminAction : !permissions.canExecuteAction)} onChange={(event) => void action({ action: "toggle_task_action", taskId: task.id, actionId: item.id, completed: event.target.checked })} /><span>{item.name}</span><b>{Number(item.percentage).toLocaleString("ar-SA")}%</b>{item.admin_only ? <small>إجراء إداري</small> : null}</label>) : <p>لا توجد إجراءات تكليف معرفة لهذا القسم.</p>}</div></section>
          <section className="marketing-task-section"><h3>الملف النهائي</h3><div className="marketing-inline-actions">{permissions.canUploadFinal ? <label className={`marketing-upload-button ${task.template_status !== "approved" ? "disabled" : ""}`}><FileArrowUp size={17} />رفع الملف النهائي<input type="file" disabled={task.template_status !== "approved"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFinal(file); event.currentTarget.value = ""; }} /></label> : null}{task.final_file_id && permissions.canDownloadFile ? <button type="button" className="secondary" onClick={() => void downloadMarketingFile(task.final_file_id)}><DownloadSimple size={17} />{task.final_file_name || "تحميل الملف النهائي"}</button> : null}</div></section>
        </>}
      </div> : null}
    </Modal>
  );
}
