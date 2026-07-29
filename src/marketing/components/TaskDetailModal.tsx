import { useEffect, useState } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  ChatCircleText,
  DownloadSimple,
  FileArrowUp,
  FloppyDisk,
  NotePencil,
  ShieldCheck,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { downloadMarketingFile, marketingFetch, marketingQuery, uploadMarketingFile } from "../api";
import { downloadTaskTemplate, inspectTaskTemplate, type TaskTemplateInspection } from "../templateExcel";
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

type ReviewFeedback = {
  generalNote: string;
  selectedFields: string[];
  fieldNotes: Record<string, string>;
};

const emptyFeedback: ReviewFeedback = {
  generalNote: "",
  selectedFields: [],
  fieldNotes: {},
};

function parseReviewFeedback(value: unknown): ReviewFeedback {
  const text = String(value || "").trim();
  if (!text) return emptyFeedback;

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || parsed.kind !== "task_template_review_feedback") {
      return { ...emptyFeedback, generalNote: text };
    }

    const selectedFields: string[] = Array.from(new Set<string>(
      (Array.isArray(parsed.selectedFields) ? parsed.selectedFields : [])
        .map((key: unknown) => String(key || ""))
        .filter((key: string) => Boolean(writerLabels[key])),
    ));

    const fieldNotes = Object.fromEntries(
      Object.entries(parsed.fieldNotes && typeof parsed.fieldNotes === "object" ? parsed.fieldNotes : {})
        .map(([key, note]) => [key, String(note || "").trim()])
        .filter(([key]) => Boolean(writerLabels[key])),
    ) as Record<string, string>;

    return {
      generalNote: String(parsed.generalNote || "").trim(),
      selectedFields: Array.from(new Set<string>([...selectedFields, ...Object.keys(fieldNotes)])),
      fieldNotes,
    };
  } catch {
    return { ...emptyFeedback, generalNote: text };
  }
}

function serializeReviewFeedback(feedback: ReviewFeedback) {
  const selectedFields = Array.from(new Set(
    feedback.selectedFields.filter((key) => Boolean(writerLabels[key])),
  ));
  const fieldNotes = Object.fromEntries(
    Object.entries(feedback.fieldNotes)
      .map(([key, note]) => [key, String(note || "").trim()])
      .filter(([key, note]) => Boolean(writerLabels[key]) && Boolean(note)),
  );

  if (!feedback.generalNote.trim() && !selectedFields.length && !Object.keys(fieldNotes).length) return "";

  return JSON.stringify({
    kind: "task_template_review_feedback",
    version: 1,
    generalNote: feedback.generalNote.trim(),
    selectedFields,
    fieldNotes,
  });
}

function historyNoteText(value: unknown) {
  const feedback = parseReviewFeedback(value);
  const fieldNames = feedback.selectedFields.map((key) => writerLabels[key]).filter(Boolean);
  if (feedback.generalNote && fieldNames.length) return `${feedback.generalNote}\nالحقول المطلوبة للتعديل: ${fieldNames.join("، ")}`;
  if (feedback.generalNote) return feedback.generalNote;
  if (fieldNames.length) return `الحقول المطلوبة للتعديل: ${fieldNames.join("، ")}`;
  return "";
}

function templateStatusLabel(status: unknown) {
  const labels: Record<string, string> = {
    not_started: "لم يبدأ",
    under_review: "قيد المراجعة",
    revision_requested: "مطلوب تعديل",
    rejected: "مرفوض",
    approved: "معتمد",
  };
  return labels[String(status || "")] || String(status || "—");
}

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
  const [reviewSelectedFields, setReviewSelectedFields] = useState<string[]>([]);
  const [reviewFieldNotes, setReviewFieldNotes] = useState<Record<string, string>>({});
  const [activeReviewField, setActiveReviewField] = useState<string | null>(null);
  const [editData, setEditData] = useState<Record<string, string>>({});
  const [templatePreview, setTemplatePreview] = useState<{ file: File; inspection: TaskTemplateInspection } | null>(null);
  const [unapproveOpen, setUnapproveOpen] = useState(false);
  const [unapproveReason, setUnapproveReason] = useState("");

  async function load() {
    if (!taskId) return;
    setLoading(true);
    setError("");
    try {
      const result = await marketingFetch<any>(`/api/marketing${marketingQuery({ resource: "task", id: taskId })}`);
      const feedback = parseReviewFeedback(result.task.admin_note);
      setPayload(result);
      setAdminNote(feedback.generalNote);
      setReviewSelectedFields(feedback.selectedFields);
      setReviewFieldNotes(feedback.fieldNotes);
      setActiveReviewField(null);
      setEditData(result.task.template_data || {});
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل التاسك");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setTemplatePreview(null);
    setUnapproveOpen(false);
    setUnapproveReason("");
    void load();
  }, [taskId]);

  async function action(body: Record<string, unknown>) {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingFetch<{ message?: string }>("/api/marketing", { method: "POST", body: JSON.stringify(body) });
      setMessage(result.message || "تم التنفيذ");
      await load();
      onChanged?.();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء");
      return false;
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
      const inspection = await inspectTaskTemplate(file, payload.task);
      setTemplatePreview({ file, inspection });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر معاينة Task Template");
    } finally {
      setLoading(false);
    }
  }

  async function confirmTemplateUpload() {
    if (!payload?.task || !templatePreview?.inspection.isValid) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const fileId = await uploadMarketingFile({ file: templatePreview.file, category: "task-template", sourceType: payload.task.source_type, sourceId: payload.task.source_id, taskId: payload.task.id });
      const succeeded = await action({ action: "upload_template", taskId: payload.task.id, fileId, templateData: templatePreview.inspection.data, validationVersion: 1 });
      if (succeeded) setTemplatePreview(null);
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
  const canViewFeedback = Boolean(permissions.canViewFeedback || canReview);
  const approved = task?.approved_data || task?.approved_template_data || {};
  const selectedReviewCount = reviewSelectedFields.length;
  const notedReviewCount = Object.values(reviewFieldNotes).filter((note: string) => note.trim()).length;
  const showFeedback = canViewFeedback && task?.template_status !== "approved" && (Boolean(adminNote.trim()) || selectedReviewCount > 0);

  function selectReviewField(key: string) {
    if (!canReview) return;
    setReviewSelectedFields((current) => current.includes(key) ? current : [...current, key]);
  }

  function openReviewField(key: string) {
    if (!canReview) return;
    selectReviewField(key);
    setActiveReviewField(key);
  }

  function clearReviewField(key: string) {
    setReviewSelectedFields((current) => current.filter((item) => item !== key));
    setReviewFieldNotes((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (activeReviewField === key) setActiveReviewField(null);
  }

  function reviewAction(reviewActionName: "request_edit" | "edit" | "reject" | "approve" | "unapprove") {
    const feedback = serializeReviewFeedback({
      generalNote: adminNote,
      selectedFields: reviewSelectedFields,
      fieldNotes: reviewFieldNotes,
    });
    const reviewNote = reviewActionName === "approve" ? "" : feedback;
    return action({
      action: "review_template",
      templateId: task.task_template_id,
      reviewAction: reviewActionName,
      note: reviewActionName === "unapprove" ? unapproveReason.trim() : reviewNote,
      data: editData,
    });
  }

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
            <span className={`marketing-task-status status-${task.status || "required"}`}>{templateStatusLabel(task.status)}</span>
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
              {permissions.canUploadTemplate ? <label className="marketing-upload-button"><FileArrowUp size={18} />اختيار ومعاينة Task Template<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadTemplate(file); event.currentTarget.value = ""; }} /></label> : null}
              {task.template_file_id && permissions.canDownloadFile ? <button type="button" className="secondary" onClick={() => void downloadMarketingFile(task.template_file_id)}><DownloadSimple size={18} />تحميل الملف المرفوع</button> : null}
            </div>
          </section>

          {!canReview && showFeedback ? <section className="marketing-revision-feedback-panel" aria-label="ملاحظات المراجع">
            <div className="marketing-revision-feedback-heading">
              <span><ChatCircleText size={22} weight="fill" /></span>
              <div>
                <h3>{task.template_status === "rejected" ? "ملاحظات الرفض" : "التعديلات المطلوبة من المراجع"}</h3>
                <p>الحقول المظللة باللون الأصفر هي الحقول المطلوب مراجعتها قبل إعادة رفع Task Template.</p>
              </div>
              <b>{selectedReviewCount.toLocaleString("ar-SA")} حقل</b>
            </div>
            {adminNote ? <p className="marketing-revision-general-note">{adminNote}</p> : null}
          </section> : null}

          <section className="marketing-task-section marketing-writer-section">
            <div className="marketing-task-section-heading">
              <div><h3>بيانات كاتب المحتوى</h3><p>{canReview ? "اضغط مرة واحدة لتحديد الحقل، واضغط مرتين لكتابة ملاحظة خاصة به." : "الحقول الطويلة مهيأة للقراءة بدون تداخل."}</p></div>
              {canReview ? <div className="marketing-review-selection-summary"><b>{selectedReviewCount}</b><span>حقول محددة</span><small>{notedReviewCount} بملاحظات</small></div> : null}
            </div>
            {canReview ? <div className="marketing-review-instruction"><NotePencil size={19} /><span>اختيار الحقل لا يغيّر محتواه. اللون الأصفر يحدد فقط المكان المطلوب تعديله عند كاتب المحتوى.</span></div> : null}
            <div className="marketing-writer-form">
              {Object.entries(writerLabels).map(([key, label]) => {
                const selected = reviewSelectedFields.includes(key);
                const note = reviewFieldNotes[key] || "";
                const noteOpen = selected && (activeReviewField === key || Boolean(note) || !canReview);
                return <div
                  key={key}
                  className={`${writerFieldClass(key)} ${selected ? "review-selected" : ""} ${note ? "has-review-note" : ""}`}
                  onClick={() => selectReviewField(key)}
                  onDoubleClick={() => openReviewField(key)}
                >
                  <div className="marketing-writer-field-title">
                    <span>{label}</span>
                    {canReview ? selected
                      ? <button type="button" className="review-field-clear" onClick={(event) => { event.stopPropagation(); clearReviewField(key); }}><XCircle size={16} />إلغاء التحديد</button>
                      : <button type="button" className="review-field-select" onClick={(event) => { event.stopPropagation(); selectReviewField(key); }}><NotePencil size={16} />تحديد للمراجعة</button>
                      : selected ? <b className="review-field-required"><WarningCircle size={16} weight="fill" />مطلوب تعديل</b> : null}
                  </div>
                  <textarea
                    rows={writerRows(key)}
                    value={editData[key] || ""}
                    disabled={!canReview}
                    onChange={(event) => setEditData((current) => ({ ...current, [key]: event.target.value }))}
                    onDoubleClick={(event) => { event.stopPropagation(); openReviewField(key); }}
                  />
                  {noteOpen ? <div className="marketing-field-review-note" onClick={(event) => event.stopPropagation()}>
                    <div><ChatCircleText size={18} weight="fill" /><strong>ملاحظة المراجع على {label}</strong></div>
                    {canReview
                      ? <textarea
                        rows={3}
                        value={note}
                        autoFocus={activeReviewField === key}
                        placeholder={`اكتب الملاحظة المطلوبة على ${label}`}
                        onChange={(event) => setReviewFieldNotes((current) => ({ ...current, [key]: event.target.value }))}
                      />
                      : <p>{note || "هذا الحقل محدد للتعديل من المراجع."}</p>}
                  </div> : null}
                </div>;
              })}
            </div>
          </section>

          {canReview ? <section className="marketing-task-section admin marketing-review-workspace">
            <div className="marketing-task-section-heading">
              <div><h3><ShieldCheck size={21} />مراجعة واعتماد</h3><p>راجع الحقول، أضف الملاحظات المطلوبة، ثم اختر الإجراء المناسب.</p></div>
              <span className={`marketing-template-review-status status-${task.template_status || "not_started"}`}>{templateStatusLabel(task.template_status)}</span>
            </div>
            <div className="marketing-review-overview">
              <article><small>الحقول المحددة</small><strong>{selectedReviewCount.toLocaleString("ar-SA")}</strong><span>ستظهر باللون الأصفر للمستخدم</span></article>
              <article><small>ملاحظات الحقول</small><strong>{notedReviewCount.toLocaleString("ar-SA")}</strong><span>ملاحظات مرتبطة بحقول محددة</span></article>
              <article><small>حالة القالب</small><strong>{templateStatusLabel(task.template_status)}</strong><span>آخر حالة محفوظة في النظام</span></article>
            </div>
            <label className="marketing-review-note">
              <span>ملاحظة عامة للمراجع</span>
              <small>تظهر أعلى الحقول المطلوبة للتعديل، ويمكن تركها فارغة عند الاكتفاء بملاحظات الحقول.</small>
              <textarea rows={4} value={adminNote} placeholder="اكتب ملاحظة عامة مختصرة وواضحة..." onChange={(event) => setAdminNote(event.target.value)} />
            </label>
            <div className="marketing-review-command-bar">
              <div>
                <strong>إجراءات المراجعة</strong>
                <span>{selectedReviewCount ? `تم تحديد ${selectedReviewCount} حقل للمراجعة` : "لم يتم تحديد حقول للمراجعة"}</span>
              </div>
              <div className="marketing-review-actions">
                {permissions.canRejectTemplate ? <>
                  <button type="button" className="review-request" disabled={loading} onClick={() => void reviewAction("request_edit")}><ArrowsClockwise size={19} />طلب تعديل</button>
                  <button type="button" className="review-save" disabled={loading} onClick={() => void reviewAction("edit")}><FloppyDisk size={19} />حفظ تعديل المراجع</button>
                  <button type="button" className="review-reject" disabled={loading} onClick={() => void reviewAction("reject")}><XCircle size={19} weight="fill" />رفض</button>
                </> : null}
                {permissions.canUnapproveTemplate && task.template_status === "approved" ? <button type="button" className="review-unapprove" disabled={loading} onClick={() => { setUnapproveReason(""); setUnapproveOpen(true); }}><ArrowsClockwise size={19} />إلغاء الاعتماد وإعادة الرفع</button> : null}
                {permissions.canApproveTemplate && task.template_status !== "approved" ? <button type="button" className="review-approve" disabled={loading} onClick={() => void reviewAction("approve")}><CheckCircle size={20} weight="fill" />اعتماد التعليمات</button> : null}
              </div>
            </div>
          </section> : null}

          {payload.history?.length ? <section className="marketing-task-section"><div className="marketing-task-section-heading"><div><h3>سجل المراجعات</h3></div></div><div className="marketing-history">{payload.history.map((item: any) => {
            const note = historyNoteText(item.note);
            return <article key={item.id}><strong>{item.action}</strong><span>{item.actor_name || "—"}</span><small>{new Date(item.created_at).toLocaleString("ar-SA")}</small>{note ? <p>{note}</p> : null}</article>;
          })}</div></section> : null}
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

      {templatePreview ? <div className="marketing-template-preview-backdrop" onMouseDown={() => !loading && setTemplatePreview(null)}>
        <section className="marketing-template-preview" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span>معاينة قبل الرفع</span><h3>{templatePreview.file.name}</h3><p>لن يتم رفع الملف إلا بعد التأكد من مطابقته للنموذج واعتماد المعاينة.</p></div><button type="button" className="secondary" disabled={loading} onClick={() => setTemplatePreview(null)}><XCircle size={20} /></button></header>
          <div className={`marketing-template-validation-summary ${templatePreview.inspection.isValid ? "valid" : "invalid"}`}>
            {templatePreview.inspection.isValid ? <CheckCircle size={24} weight="fill" /> : <WarningCircle size={24} weight="fill" />}
            <div><strong>{templatePreview.inspection.isValid ? "الملف مطابق ويمكن تأكيد الرفع" : "تم رفض الملف لعدم مطابقته للنموذج"}</strong><span>{templatePreview.inspection.isValid ? "راجع البيانات التالية ثم اضغط تأكيد الرفع." : "صحح الأخطاء التالية وارفع نفس النموذج مرة أخرى."}</span></div>
          </div>
          {templatePreview.inspection.errors.length ? <div className="marketing-template-validation-errors">{templatePreview.inspection.errors.map((item) => <p key={item}><XCircle size={16} weight="fill" />{item}</p>)}</div> : null}
          {templatePreview.inspection.warnings.length ? <div className="marketing-template-validation-warnings">{templatePreview.inspection.warnings.map((item) => <p key={item}><WarningCircle size={16} />{item}</p>)}</div> : null}
          <div className="marketing-template-preview-table"><table><thead><tr><th>الحقل</th><th>البيانات</th><th>التحقق</th></tr></thead><tbody>{templatePreview.inspection.rows.filter((row) => row.writer).map((row) => <tr key={row.key}><td><strong>{row.label}</strong></td><td><p>{row.value || "—"}</p></td><td>{row.value ? <span className="ok">موجود</span> : <span className="empty">فارغ</span>}</td></tr>)}</tbody></table></div>
          <footer><button type="button" className="secondary" disabled={loading} onClick={() => setTemplatePreview(null)}>إلغاء</button><button type="button" className="primary" disabled={loading || !templatePreview.inspection.isValid} onClick={() => void confirmTemplateUpload()}><FileArrowUp size={18} />{loading ? "جاري الرفع..." : "تأكيد رفع Task Template"}</button></footer>
        </section>
      </div> : null}

      {unapproveOpen ? <div className="marketing-template-preview-backdrop" onMouseDown={() => !loading && setUnapproveOpen(false)}><section className="marketing-unapprove-dialog" onMouseDown={(event) => event.stopPropagation()}><header><div><span>إجراء إداري</span><h3>إلغاء اعتماد Task Template</h3><p>سيعود Task Template إلى انتظار الرفع، وستتوقف التاسكات التنفيذية حتى رفع نسخة جديدة واعتمادها.</p></div></header><label><span>سبب إلغاء الاعتماد</span><textarea rows={4} value={unapproveReason} onChange={(event) => setUnapproveReason(event.target.value)} placeholder="اكتب سببًا واضحًا ليظهر في سجل المراجعات..." /></label><footer><button type="button" className="secondary" disabled={loading} onClick={() => setUnapproveOpen(false)}>تراجع</button><button type="button" className="review-unapprove" disabled={loading || !unapproveReason.trim()} onClick={async () => { const succeeded = await reviewAction("unapprove"); if (succeeded) setUnapproveOpen(false); }}><ArrowsClockwise size={18} />إلغاء الاعتماد وإعادة الرفع</button></footer></section></div> : null}
    </Modal>
  );
}
