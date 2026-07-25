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

function DetailItem({ label, value, wide = false }: { label: string; value: unknown; wide?: boolean }) {
  return <article className={wide ? "wide" : ""}><small>{label}</small><strong>{String(value || "—")}</strong></article>;
}

function writerFieldClass(key: string) {
  if (key === "mainScript") return "marketing-writer-field full script";
  if (key === "mainMessage") return "marketing-writer-field full message";
  return "marketing-writer-field";
}

function writerRows(key: string) {
  if (key === "mainScript") return 12;
  if (key === "mainMessage") return 5;
  if (["goal", "hook", "caption", "hashtags"].includes(key)) return 4;
  return 3;
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
    setLoading(true);
    setError("");
    try {
      const result = await marketingFetch<any>(`/api/marketing${marketingQuery({ resource: "task", id: taskId })}`);
      setPayload(result);
      setAdminNote(result.task.admin_note || "");
      setEditData(result.task.template_data || {});
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل التاسك");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [taskId]);

  async function action(body: Record<string, unknown>) {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message?: string }>("/api/marketing", { method: "POST", body: JSON.stringify(body) });
      setMessage(result.message || "تم التنفيذ");
      await load();
      onChanged?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء");
    } finally {
      setLoading(false);
    }
  }

  async function uploadTemplate(file: File) {
    if (!payload?.task) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const data = await parseTaskTemplate(file);
      const fileId = await uploadMarketingFile({ file, category: "task-template", sourceType: payload.task.source_type, sourceId: payload.task.source_id, taskId: payload.task.id });
      await action({ action: "upload_template", taskId: payload.task.id, fileId, templateData: data });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر رفع Task Template");
      setLoading(false);
    }
  }

  async function uploadFinal(file: File) {
    if (!payload?.task) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const fileId = await uploadMarketingFile({ file, category: "final-file", sourceType: payload.task.source_type, sourceId: payload.task.source_id, taskId: payload.task.id });
      await action({ action: "attach_final_file", taskId: payload.task.id, fileId });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر رفع الملف النهائي");
      setLoading(false);
    }
  }

  const task = payload?.task;
  const permissions = payload?.permissions || {};
  const canReview = Boolean(permissions.canApproveTemplate || permissions.canRejectTemplate);
  const approved = task?.approved_data || task?.approved_template_data || {};

  return (
    <Modal
      open={Boolean(taskId)}
      title={task?.title || "تفاصيل التاسك"}
      subtitle={task ? `${task.source_name || "—"} · ${task.department_name || "قسم المحتوى"}` : undefined}
      onClose={onClose}
      className="marketing-task-modal marketing-task-modal-fullscreen"
    >
      {loading && !task ? <div className="marketing-empty">جاري تحميل التاسك...</div> : null}
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

      {task ? <div className="marketing-task-detail">
        <section className="marketing-task-overview">
          <div className="marketing-task-section-heading">
            <div><h3>ملخص التكليف</h3><p>كل بيانات الحملة والتكليف في مكان واحد.</p></div>
            <span className={`marketing-task-status status-${task.status || "required"}`}>{task.status || "required"}</span>
          </div>
          <div className="marketing-detail-grid">
            <DetailItem label="الحملة أو الأجندة" value={task.source_name} />
            <DetailItem label="كود الحملة" value={task.campaign_code} />
            <DetailItem label="نوع الحملة" value={task.campaign_type || (task.source_type === "agenda" ? "أجندة" : "—")} />
            <DetailItem label="تاريخ الحملة" value={String(task.campaign_date || "—").slice(0, 10)} />
            <DetailItem label="بداية النشر" value={String(task.campaign_start || "—").slice(0, 10)} />
            <DetailItem label="نهاية النشر" value={String(task.campaign_end || "—").slice(0, 10)} />
            <DetailItem label="رقم التاسك" value={task.task_no || task.instance_code} />
            <DetailItem label="نوع الكرييتيف" value={task.creative_name} />
            <DetailItem label="موعد التسليم" value={String(task.due_at || task.template_due_on || "—").slice(0, 10)} />
            <DetailItem label="المسؤول" value={task.assigned_name} />
            <DetailItem label="كاتب المحتوى المرتبط" value={task.content_user_name} />
            <DetailItem label="هدف الحملة" value={task.objective} />
            <DetailItem label="السيارات" value={carsText(task.cars)} wide />
            <DetailItem label="ملاحظات القسم" value={task.note || task.template_department_note} wide />
            <DetailItem label="المطلوب من كاتب المحتوى" value={task.required_from_content} wide />
          </div>
          <div className="marketing-task-progress"><span>نسبة الإنجاز</span><ProgressBar value={Number(task.progress || 0)} /></div>
        </section>

        {task.task_kind === "task_template" ? <>
          <section className="marketing-task-toolbar">
            <div><h3>Task Template</h3><p>{task.template_department_note || task.note || "لا توجد ملاحظات إضافية"}</p></div>
            <div className="marketing-inline-actions">
              {permissions.canDownloadTemplate ? <button type="button" className="secondary" onClick={() => downloadTaskTemplate(task)}><DownloadSimple size={18} />تحميل Task Template</button> : null}
              {permissions.canUploadTemplate ? <label className="marketing-upload-button"><FileArrowUp size={18} />إرفاق Task Template Excel<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadTemplate(file); event.currentTarget.value = ""; }} /></label> : null}
              {task.template_file_id && permissions.canDownloadFile ? <button type="button" className="secondary" onClick={() => void downloadMarketingFile(task.template_file_id)}><DownloadSimple size={18} />تحميل الملف المرفوع</button> : null}
            </div>
          </section>

          <section className="marketing-task-section marketing-writer-section">
            <div className="marketing-task-section-heading"><div><h3>بيانات كاتب المحتوى</h3><p>الحقول الطويلة مهيأة للكتابة والقراءة بدون تداخل.</p></div></div>
            <div className="marketing-writer-form">
              {Object.entries(writerLabels).map(([key, label]) => <label key={key} className={writerFieldClass(key)}>
                <span>{label}</span>
                <textarea rows={writerRows(key)} value={editData[key] || ""} disabled={!canReview} onChange={(event) => setEditData((current) => ({ ...current, [key]: event.target.value }))} />
              </label>)}
            </div>
          </section>

          {canReview ? <section className="marketing-task-section admin">
            <div className="marketing-task-section-heading"><div><h3><ShieldCheck size={21} />مراجعة واعتماد</h3><p>هذه الإجراءات مخصصة للمراجعة الإدارية فقط.</p></div></div>
            <label className="marketing-review-note"><span>ملاحظة المراجع</span><textarea rows={4} value={adminNote} onChange={(event) => setAdminNote(event.target.value)} /></label>
            <div className="marketing-review-actions">
              {permissions.canRejectTemplate ? <>
                <button type="button" onClick={() => void action({ action: "review_template", templateId: task.task_template_id, reviewAction: "request_edit", note: adminNote, data: editData })}>طلب تعديل</button>
                <button type="button" onClick={() => void action({ action: "review_template", templateId: task.task_template_id, reviewAction: "edit", note: adminNote, data: editData })}>حفظ تعديل المراجع</button>
                <button type="button" className="danger" onClick={() => void action({ action: "review_template", templateId: task.task_template_id, reviewAction: "reject", note: adminNote, data: editData })}>رفض</button>
              </> : null}
              {permissions.canApproveTemplate ? <button type="button" className="primary" onClick={() => void action({ action: "review_template", templateId: task.task_template_id, reviewAction: "approve", note: adminNote, data: editData })}><CheckCircle size={18} />اعتماد التعليمات</button> : null}
            </div>
          </section> : null}

          {payload.history?.length ? <section className="marketing-task-section"><div className="marketing-task-section-heading"><div><h3>سجل المراجعات</h3></div></div><div className="marketing-history">{payload.history.map((item: any) => <article key={item.id}><strong>{item.action}</strong><span>{item.actor_name || "—"}</span><small>{new Date(item.created_at).toLocaleString("ar-SA")}</small>{item.note ? <p>{item.note}</p> : null}</article>)}</div></section> : null}
        </> : <>
          {task.template_status !== "approved" ? <MarketingAlert type="info"><WarningCircle size={18} />في انتظار اعتماد Task Template</MarketingAlert> : <section className="marketing-task-section"><div className="marketing-task-section-heading"><div><h3>بيانات Task Template المعتمدة</h3></div></div><div className="marketing-approved-data">{Object.entries(writerLabels).map(([key, label]) => <div key={key} className={key === "mainScript" ? "full script" : ""}><small>{label}</small><p>{approved[key] || "—"}</p></div>)}</div></section>}

          <section className="marketing-task-section">
            <div className="marketing-task-section-heading"><div><h3>إجراءات التكليف</h3><p>اضغط على الإجراء لتغيير حالته بدل استخدام علامات الاختيار.</p></div></div>
            <div className="marketing-action-buttons">
              {payload.actions?.length ? payload.actions.map((item: any) => {
                const allowed = item.admin_only ? permissions.canExecuteAdminAction : permissions.canExecuteAction;
                const disabled = loading || task.template_status !== "approved" || !allowed;
                return <button
                  key={item.id}
                  type="button"
                  className={`marketing-action-button ${item.completed ? "completed" : "pending"} ${item.admin_only ? "admin" : ""}`}
                  disabled={disabled}
                  aria-pressed={Boolean(item.completed)}
                  title={!allowed ? "لا توجد صلاحية لتنفيذ هذا الإجراء" : task.template_status !== "approved" ? "في انتظار اعتماد Task Template" : item.completed ? "اضغط لإعادة الإجراء إلى غير مكتمل" : "اضغط لتسجيل الإجراء كمكتمل"}
                  onClick={() => void action({ action: "toggle_task_action", taskId: task.id, actionId: item.id, completed: !item.completed })}
                >
                  <span className="marketing-action-icon">{item.completed ? <CheckCircle size={23} weight="fill" /> : <span />}</span>
                  <span className="marketing-action-copy"><strong>{item.name}</strong><small>{item.completed ? "تم التنفيذ" : "لم يتم التنفيذ"}{item.admin_only ? " · إجراء إداري" : ""}</small></span>
                  <b>{Number(item.percentage).toLocaleString("ar-SA")}%</b>
                </button>;
              }) : <p>لا توجد إجراءات تكليف معرفة لهذا القسم.</p>}
            </div>
          </section>

          <section className="marketing-task-section">
            <div className="marketing-task-section-heading"><div><h3>الملف النهائي</h3></div></div>
            <div className="marketing-inline-actions">
              {permissions.canUploadFinal ? <label className={`marketing-upload-button ${task.template_status !== "approved" ? "disabled" : ""}`}><FileArrowUp size={18} />رفع الملف النهائي<input type="file" disabled={task.template_status !== "approved"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFinal(file); event.currentTarget.value = ""; }} /></label> : null}
              {task.final_file_id && permissions.canDownloadFile ? <button type="button" className="secondary" onClick={() => void downloadMarketingFile(task.final_file_id)}><DownloadSimple size={18} />{task.final_file_name || "تحميل الملف النهائي"}</button> : null}
            </div>
          </section>
        </>}
      </div> : null}
    </Modal>
  );
}