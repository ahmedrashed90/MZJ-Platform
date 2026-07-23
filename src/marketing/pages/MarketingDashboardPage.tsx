import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, CheckCircle, DownloadSimple, FileArrowUp, FolderOpen, PaperPlaneTilt, UploadSimple } from "@phosphor-icons/react";
import { useOutletContext } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { formatDate, marketingFetch } from "../api";
import type { CampaignDetailResponse, DashboardResponse, DashboardTask, MarketingTask } from "../types";
import type { MarketingOutletContext } from "../MarketingLayout";
import { Alert, ConfirmButton, Empty, Modal, PageHead, ProgressBar, StatusBadge } from "../components/Ui";
import { openMarketingFile, uploadMarketingFile } from "../components/files";

type TemplateScene = { id: string; title: string; description: string; voiceOver: string; onScreenText: string };
type TemplateForm = { proposedName: string; objective: string; mainMessage: string; voice: string; cta: string; script: string; hook: string; caption: string; hashtags: string; scenes: string; sceneRows: TemplateScene[] };
const blankTemplate: TemplateForm = { proposedName: "", objective: "", mainMessage: "", voice: "", cta: "", script: "", hook: "", caption: "", hashtags: "", scenes: "", sceneRows: [] };
const templateLabels: Record<Exclude<keyof TemplateForm, "sceneRows">, string> = { proposedName: "الاسم المقترح للكرييتيف", objective: "الهدف", mainMessage: "الرسالة الأساسية", voice: "الصوت", cta: "CTA", script: "السكريبت", hook: "الهوك", caption: "الكابشن", hashtags: "الهاشتاج", scenes: "ملاحظات عامة للمشاهد / السلايدات" };
function sceneId() { return `scene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function sceneRows(value: unknown): TemplateScene[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    return { id: String(record.id || `scene-${index + 1}`), title: String(record.title || ""), description: String(record.description || ""), voiceOver: String(record.voiceOver || ""), onScreenText: String(record.onScreenText || "") };
  });
}

function taskTitle(task: DashboardTask | MarketingTask) { return `${task.instance_code} - ${task.creative_name}`; }

export function MarketingDashboardPage() {
  const { meta } = useOutletContext<MarketingOutletContext>();
  const { user } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTask, setSelectedTask] = useState<DashboardTask | null>(null);
  const [detail, setDetail] = useState<CampaignDetailResponse | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [templateForm, setTemplateForm] = useState<TemplateForm>(blankTemplate);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [finalFile, setFinalFile] = useState<File | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  async function load() {
    setLoading(true); setError("");
    try { setData(await marketingFetch<DashboardResponse>("/api/marketing?resource=dashboard")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل لوحة التسويق"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function openTask(task: DashboardTask) {
    setSelectedTask(task); setDetail(null); setMessage(""); setReviewNote(""); setTemplateFile(null); setFinalFile(null); setTemplateForm(blankTemplate);
    try {
      const response = await marketingFetch<CampaignDetailResponse>(`/api/marketing?resource=campaign&id=${task.campaign_id}`);
      setDetail(response);
      const current = response.tasks.find((item) => item.id === task.id);
      const latest = current?.submissions?.[0]?.template_data || {};
      setTemplateForm({
        proposedName: String(latest.proposedName || ""), objective: String(latest.objective || ""), mainMessage: String(latest.mainMessage || ""), voice: String(latest.voice || ""), cta: String(latest.cta || ""),
        script: String(latest.script || ""), hook: String(latest.hook || ""), caption: String(latest.caption || ""), hashtags: String(latest.hashtags || ""), scenes: String(latest.scenes || ""), sceneRows: sceneRows(latest.sceneRows),
      });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر فتح تفاصيل التاسك"); }
  }
  async function openCampaign(id: string) {
    setSelectedCampaignId(id); setDetail(null);
    try { setDetail(await marketingFetch<CampaignDetailResponse>(`/api/marketing?resource=campaign&id=${id}`)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر فتح تفاصيل الحملة"); }
  }
  async function runTaskAction(taskAction: string, extra: Record<string, unknown> = {}) {
    if (!selectedTask) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await marketingFetch("/api/marketing", { method: "POST", body: JSON.stringify({ action: "task_action", taskAction, taskId: selectedTask.id, ...extra }) });
      setMessage("تم تنفيذ الإجراء بنجاح");
      const refreshed = await marketingFetch<CampaignDetailResponse>(`/api/marketing?resource=campaign&id=${selectedTask.campaign_id}`);
      setDetail(refreshed);
      const refreshedTask = refreshed.tasks.find((item) => item.id === selectedTask.id);
      if (refreshedTask) setSelectedTask((current) => current ? { ...current, ...refreshedTask } as DashboardTask : current);
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء"); }
    finally { setBusy(false); }
  }
  async function submitTemplate() {
    if (!selectedTask) return;
    setBusy(true); setError("");
    try {
      let fileMeta: { storageKey?: string; fileName?: string } = {};
      if (templateFile) fileMeta = await uploadMarketingFile(selectedTask.id, templateFile);
      await marketingFetch("/api/marketing", { method: "POST", body: JSON.stringify({ action: "task_action", taskAction: "submit_template", taskId: selectedTask.id, templateData: templateForm, ...fileMeta }) });
      setMessage("تم رفع Task Template وإرسالها للمراجعة"); setTemplateFile(null);
      await openTask(selectedTask); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر رفع Task Template"); }
    finally { setBusy(false); }
  }
  async function uploadFinal() {
    if (!selectedTask || !finalFile) return;
    setBusy(true); setError("");
    try {
      const metaFile = await uploadMarketingFile(selectedTask.id, finalFile);
      await runTaskAction("attach_final", metaFile);
      setFinalFile(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر رفع الملف النهائي"); setBusy(false); }
  }
  async function campaignAction(campaignAction: string, campaignId: string) {
    setBusy(true); setError("");
    try { await marketingFetch("/api/marketing", { method: "POST", body: JSON.stringify({ action: "campaign_action", campaignAction, campaignId }) }); await load(); if (selectedCampaignId) await openCampaign(selectedCampaignId); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تنفيذ إجراء الحملة"); }
    finally { setBusy(false); }
  }

  const groupedRequired = useMemo(() => {
    const map = new Map<string, DashboardTask[]>();
    for (const task of data?.required || []) { const list = map.get(task.department_name) || []; list.push(task); map.set(task.department_name, list); }
    return [...map.entries()];
  }, [data]);
  const currentTask = detail?.tasks.find((item) => item.id === selectedTask?.id) || null;
  const currentInstance = detail?.instances.find((item) => item.id === currentTask?.instance_id) || null;
  const currentDepartment = currentInstance?.departments.find((item) => item.department_id === currentTask?.department_id) || null;
  const templateTask = currentTask?.task_kind === "execution" ? detail?.tasks.find((item) => item.id === currentTask.template_task_id) : currentTask;
  const approvedTemplate = templateTask?.submissions.find((submission) => submission.review_status === "approved") || null;
  const isOwner = Boolean(user && currentTask?.assigned_to === user.id);
  const campaignDays = detail ? Math.max(1, Math.round((new Date(String(detail.campaign.publish_end_date)).getTime() - new Date(String(detail.campaign.publish_start_date)).getTime()) / 86_400_000) + 1) : 0;

  return <div className="marketing-page">
    <PageHead title="لوحة التحكم" description="TASK - المطلوب، جاهزية المطلوب، وقسم النشر بنفس فلو الحملات والأجندات." actions={<button className="marketing-icon-button" onClick={() => void load()}><ArrowClockwise size={18} />تحديث</button>} />
    {error ? <Alert type="error">{error}</Alert> : null}{message ? <Alert type="success">{message}</Alert> : null}
    <section className="marketing-dashboard-section">
      <header><div><h2>TASK - المطلوب</h2><p>عرض التاسكات مجمعة حسب الأقسام.</p></div><span>{data?.required.length || 0}</span></header>
      {loading ? <div className="crm-loading-panel">جاري تحميل التاسكات...</div> : groupedRequired.length ? groupedRequired.map(([department, tasks]) => <details className="marketing-department-group" key={department} open><summary><b>{department}</b><span>{tasks.length}</span></summary><div className="marketing-task-grid">{tasks.map((task) => <article className="marketing-task-card" key={task.id}><div className="marketing-card-top"><StatusBadge status={task.status} /><strong>{taskTitle(task)}</strong></div><small>{task.campaign_code}</small><ProgressBar value={task.progress} /><dl><div><dt>المسؤول</dt><dd>{task.assigned_to_name}</dd></div><div><dt>كاتب المحتوى</dt><dd>{task.content_writer_name}</dd></div><div><dt>القسم</dt><dd>{task.department_name}</dd></div><div><dt>موعد التسليم</dt><dd>{formatDate(task.due_date)}</dd></div></dl><ConfirmButton onClick={() => void openTask(task)}>تفاصيل</ConfirmButton></article>)}</div></details>) : <Empty text="لا توجد تاسكات مطلوبة حاليًا." />}
    </section>

    <section className="marketing-dashboard-section">
      <header><div><h2>جاهزية المطلوب</h2><p>الحملات والأجندات التي تحتوي على تاسكات تم استلامها ومتابعة نسب الأقسام.</p></div><span>{data?.readiness.length || 0}</span></header>
      <div className="marketing-campaign-card-grid">{data?.readiness.map((card) => <article className="marketing-ready-card" key={card.id} onClick={() => void openCampaign(card.id)}><div><span>{card.sourceKind === "agenda" ? "أجندة" : "حملة"}</span><strong>{card.name}</strong></div><small>{card.code}</small><ProgressBar value={card.progress} /><div className="marketing-ready-counts"><span>{card.departmentCount} قسم</span><span>{card.taskCount} تاسك</span></div></article>)}</div>
      {!data?.readiness.length ? <Empty text="لا توجد حملات في جاهزية المطلوب." /> : null}
    </section>

    <section className="marketing-dashboard-section">
      <header><div><h2>قسم النشر</h2><p>الحملات والأجندات التي تم نقلها بعد اكتمالها 100%.</p></div><span>{data?.publishing.length || 0}</span></header>
      <div className="marketing-campaign-card-grid">{data?.publishing.map((card) => <article className="marketing-ready-card publishing" key={card.id} onClick={() => void openCampaign(card.id)}><PaperPlaneTilt size={24} /><strong>{card.name}</strong><small>{card.code}</small><ProgressBar value={card.progress} /></article>)}</div>
      {!data?.publishing.length ? <Empty text="لا توجد حملات داخل قسم النشر." /> : null}
    </section>

    <Modal open={Boolean(selectedTask)} title={selectedTask ? `تنفيذ - ${taskTitle(selectedTask)}` : "تفاصيل التاسك"} subtitle={selectedTask?.campaign_code} onClose={() => { setSelectedTask(null); setDetail(null); }} wide>
      {!detail || !currentTask ? <div className="crm-loading-panel">جاري تحميل تفاصيل التاسك...</div> : <div className="marketing-task-detail">
        <div className="marketing-detail-grid">
          <div><small>اسم الحملة / الأجندة</small><strong>{detail.campaign.name}</strong></div><div><small>الكود</small><strong>{detail.campaign.campaign_code}</strong></div><div><small>نوع المصدر</small><strong>{detail.campaign.source_kind === "agenda" ? "أجندة" : "حملة"}</strong></div><div><small>نوع الحملة</small><strong>{String(detail.campaign.campaign_type_name || "—")}</strong></div>
          <div><small>المسؤول</small><strong>{currentTask.assigned_to_name}</strong></div><div><small>كاتب المحتوى المرتبط</small><strong>{currentTask.content_writer_name}</strong></div><div><small>القسم</small><strong>{currentTask.department_name}</strong></div><div><small>الكرييتيف</small><strong>{currentTask.instance_code} - {currentTask.creative_name}</strong></div>
          <div><small>بداية النشر</small><strong>{formatDate(detail.campaign.publish_start_date)}</strong></div><div><small>نهاية النشر</small><strong>{formatDate(detail.campaign.publish_end_date)}</strong></div><div><small>مدة الحملة</small><strong>{campaignDays} يوم</strong></div><div><small>العدد المطلوب</small><strong>1</strong></div>
          <div><small>تاريخ استلام قسم المحتوى</small><strong>{formatDate(currentInstance?.content_received_date)}</strong></div><div><small>تاريخ استلام القسم</small><strong>{formatDate(currentDepartment?.due_date)}</strong></div><div><small>موعد التسليم</small><strong>{formatDate(currentTask.due_date)}</strong></div><div><small>تاريخ الاستلام الفعلي</small><strong>{formatDate(currentTask.actual_received_at, true)}</strong></div><div><small>رقم التاسك</small><strong>{currentTask.task_no}</strong></div><div><small>الحالة</small><StatusBadge status={currentTask.status} /></div>
        </div>
        <div className="marketing-detail-columns"><div className="marketing-detail-section"><h3>ملاحظات التكليف</h3><p><b>ملاحظات قسم المحتوى:</b> {currentInstance?.content_notes || "—"}</p><p><b>ملاحظات القسم:</b> {currentDepartment?.notes || "—"}</p></div><div className="marketing-detail-section"><h3>ملاحظات الإدارة</h3><p>{currentTask.admin_note || currentTask.rejection_reason || "—"}</p></div></div>
        <div className="marketing-detail-section"><h3>السيارات</h3><div className="marketing-chip-list">{(() => { const vehicles = detail.instances.find((item) => item.id === currentTask.instance_id)?.vehicles || []; return vehicles.length ? vehicles.map((vehicle) => <span key={vehicle.id}>{vehicle.vin} · {vehicle.car_name || vehicle.statement || "سيارة"}</span>) : <span>لا توجد سيارات</span>; })()}</div></div>
        {currentTask.task_kind === "template" ? <>
          <div className="marketing-detail-section"><h3>بيانات Task Template</h3><div className="marketing-detail-toolbar"><a className="marketing-button secondary" href={detail.campaign.source_kind === "agenda" ? "/templates/marketing-agenda-task-template.xlsx" : "/templates/marketing-task-template.xlsx"} download><DownloadSimple size={18} />تحميل نموذج Task Template</a></div><div className="marketing-template-form">{Object.entries(templateLabels).map(([key, label]) => <label key={key}><span>{label}</span><textarea rows={key === "scenes" || key === "script" ? 4 : 2} value={templateForm[key as Exclude<keyof TemplateForm, "sceneRows">]} onChange={(event) => setTemplateForm((current) => ({ ...current, [key]: event.target.value }))} disabled={!isOwner || currentTask.status === "template_review" || currentTask.status === "completed"} /></label>)}</div>
            <div className="marketing-scene-editor"><div className="marketing-section-title"><div><h4>المشاهد / السلايدات</h4><p>أضف تفاصيل كل مشهد أو سلايد بصورة مستقلة.</p></div>{isOwner && !["template_review","completed"].includes(currentTask.status) ? <button type="button" onClick={() => setTemplateForm((current) => ({ ...current, sceneRows: [...current.sceneRows, { id: sceneId(), title: "", description: "", voiceOver: "", onScreenText: "" }] }))}>إضافة مشهد / سلايد</button> : null}</div>{templateForm.sceneRows.map((scene, index) => <article key={scene.id}><header><b>{index + 1}</b><input value={scene.title} placeholder="عنوان المشهد أو السلايد" disabled={!isOwner || currentTask.status === "template_review" || currentTask.status === "completed"} onChange={(event) => setTemplateForm((current) => ({ ...current, sceneRows: current.sceneRows.map((row) => row.id === scene.id ? { ...row, title: event.target.value } : row) }))} />{isOwner && !["template_review","completed"].includes(currentTask.status) ? <button type="button" onClick={() => setTemplateForm((current) => ({ ...current, sceneRows: current.sceneRows.filter((row) => row.id !== scene.id) }))}>حذف</button> : null}</header><label><span>شرح المشهد</span><textarea rows={3} value={scene.description} disabled={!isOwner || currentTask.status === "template_review" || currentTask.status === "completed"} onChange={(event) => setTemplateForm((current) => ({ ...current, sceneRows: current.sceneRows.map((row) => row.id === scene.id ? { ...row, description: event.target.value } : row) }))} /></label><label><span>الفويس أوفر</span><textarea rows={2} value={scene.voiceOver} disabled={!isOwner || currentTask.status === "template_review" || currentTask.status === "completed"} onChange={(event) => setTemplateForm((current) => ({ ...current, sceneRows: current.sceneRows.map((row) => row.id === scene.id ? { ...row, voiceOver: event.target.value } : row) }))} /></label><label><span>التكست</span><textarea rows={2} value={scene.onScreenText} disabled={!isOwner || currentTask.status === "template_review" || currentTask.status === "completed"} onChange={(event) => setTemplateForm((current) => ({ ...current, sceneRows: current.sceneRows.map((row) => row.id === scene.id ? { ...row, onScreenText: event.target.value } : row) }))} /></label></article>)}{!templateForm.sceneRows.length ? <Empty text="لا توجد مشاهد أو سلايدات مضافة." /> : null}</div>
            <div className="marketing-file-row"><label><UploadSimple size={18} /><span>{templateFile?.name || "إرفاق Task Template Excel"}</span><input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => setTemplateFile(event.target.files?.[0] || null)} /></label>{isOwner && !["template_review","completed"].includes(currentTask.status) ? <ConfirmButton onClick={() => void submitTemplate()} disabled={busy}>رفع Task Template</ConfirmButton> : null}</div>
          </div>
          <div className="marketing-detail-section"><h3>النسخ والمراجعات</h3>{currentTask.submissions.length ? <div className="marketing-submission-list">{currentTask.submissions.map((submission) => <article key={submission.id}><div><strong>النسخة {submission.version_no}</strong><StatusBadge status={submission.review_status === "pending" ? "template_review" : submission.review_status === "revision_requested" ? "template_revision" : submission.review_status} /></div><small>{formatDate(submission.submitted_at, true)}</small>{submission.review_note ? <p>{submission.review_note}</p> : null}{submission.storage_key ? <button onClick={() => void openMarketingFile(submission.storage_key || "")}><FolderOpen size={17} />فتح الملف</button> : null}</article>)}</div> : <Empty text="لم يتم رفع أي نسخة بعد." />}
          </div>
          {meta.permissions.canReviewTemplates && currentTask.status === "template_review" ? <div className="marketing-review-box"><label><span>ملاحظات المراجعة</span><textarea rows={3} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label><div><ConfirmButton onClick={() => void runTaskAction("approve_template", { note: reviewNote })} disabled={busy}>اعتماد</ConfirmButton><ConfirmButton tone="secondary" onClick={() => void runTaskAction("request_revision", { note: reviewNote })} disabled={busy || !reviewNote.trim()}>طلب تعديل</ConfirmButton><ConfirmButton tone="danger" onClick={() => void runTaskAction("reject_template", { note: reviewNote })} disabled={busy || !reviewNote.trim()}>رفض</ConfirmButton></div></div> : null}
        </> : <>
          <div className="marketing-detail-section"><h3>بيانات Task Template المعتمدة</h3>{approvedTemplate ? <div className="marketing-approved-template">{Object.entries(approvedTemplate.template_data).filter(([key]) => key !== "sceneRows").map(([key, value]) => <div key={key}><small>{templateLabels[key as Exclude<keyof TemplateForm, "sceneRows">] || key}</small><p>{String(value || "—")}</p></div>)}{sceneRows(approvedTemplate.template_data.sceneRows).length ? <section className="marketing-approved-scenes">{sceneRows(approvedTemplate.template_data.sceneRows).map((scene, index) => <article key={scene.id}><b>{index + 1}. {scene.title || "مشهد / سلايد"}</b><p><strong>شرح المشهد:</strong> {scene.description || "—"}</p><p><strong>الفويس أوفر:</strong> {scene.voiceOver || "—"}</p><p><strong>التكست:</strong> {scene.onScreenText || "—"}</p></article>)}</section> : null}</div> : <Alert type="warning">في انتظار اعتماد Task Template المرتبطة بهذا الكاتب والـInstance.</Alert>}</div>
          <div className="marketing-detail-section"><h3>إجراءات التكليف</h3><div className="marketing-actions-list">{currentTask.actions.map((action) => <label key={action.id} className={action.completed_at ? "done" : ""}><input type="checkbox" checked={Boolean(action.completed_at)} disabled={busy || !currentTask.actual_received_at || (action.admin_only && !meta.permissions.canReviewTemplates)} onChange={() => void runTaskAction("toggle_action", { actionId: action.id })} /><span>{action.name}</span><b>{action.progress_percent}%</b>{action.admin_only ? <em>أدمن فقط</em> : null}</label>)}</div><ProgressBar value={currentTask.progress} /></div>
          <div className="marketing-detail-section"><h3>الملف النهائي</h3>{currentTask.final_storage_key ? <button className="marketing-file-open" onClick={() => void openMarketingFile(currentTask.final_storage_key || "")}><FolderOpen size={18} />{currentTask.final_file_name || "فتح الملف النهائي"}</button> : <div className="marketing-file-row"><label><FileArrowUp size={18} /><span>{finalFile?.name || "اختيار الملف النهائي"}</span><input type="file" onChange={(event) => setFinalFile(event.target.files?.[0] || null)} /></label><ConfirmButton onClick={() => void uploadFinal()} disabled={busy || !finalFile || !currentTask.actual_received_at}>رفع الملف النهائي</ConfirmButton></div>}</div>
        </>}
        <div className="marketing-task-footer">{!currentTask.actual_received_at && currentTask.status !== "waiting_template" && currentTask.status !== "completed" ? <ConfirmButton onClick={() => void runTaskAction("receive")} disabled={busy}><CheckCircle size={18} />تم الاستلام</ConfirmButton> : null}</div>
      </div>}
    </Modal>

    <Modal
      open={Boolean(selectedCampaignId)}
      title={detail ? String(detail.campaign.name) : "تفاصيل الحملة"}
      subtitle={detail ? String(detail.campaign.campaign_code) : undefined}
      onClose={() => { setSelectedCampaignId(""); setDetail(null); }}
      wide
    >
      {!detail ? (
        <div className="crm-loading-panel">جاري تحميل التفاصيل...</div>
      ) : (
        <div className="marketing-campaign-detail">
          <div className="marketing-detail-grid">
            <div><small>النوع</small><strong>{detail.campaign.source_kind === "agenda" ? "أجندة" : "حملة"}</strong></div>
            <div><small>بداية النشر</small><strong>{formatDate(detail.campaign.publish_start_date)}</strong></div>
            <div><small>نهاية النشر</small><strong>{formatDate(detail.campaign.publish_end_date)}</strong></div>
            <div><small>الحالة</small><StatusBadge status={String(detail.campaign.workflow_stage)} /></div>
          </div>
          <ProgressBar value={detail.progress} />
          <div className="marketing-department-summary">
            {[...new Set(detail.tasks.map((task) => task.department_name))].map((department) => (
              <details key={department}>
                <summary>{department}<span>{detail.tasks.filter((task) => task.department_name === department).length}</span></summary>
                {detail.tasks.filter((task) => task.department_name === department).map((task) => {
                  const instance = detail.instances.find((item) => item.id === task.instance_id);
                  const dashboardTask: DashboardTask = {
                    ...task,
                    source_kind: detail.campaign.source_kind,
                    campaign_code: detail.campaign.campaign_code,
                    campaign_name: detail.campaign.name,
                    workflow_stage: detail.campaign.workflow_stage,
                    campaign_status: detail.campaign.status,
                    has_pending_submission: task.submissions.some((submission) => submission.review_status === "pending"),
                    approved_template_data: task.approved_template_data || {},
                    platform_ids: [...new Set((instance?.posts || []).map((post) => post.platform_id))],
                    publishing_posts: instance?.posts || [],
                    publish_dates: detail.schedule.filter((item) => item.instance_id === task.instance_id).map((item) => item.publish_date),
                  };
                  return <article key={task.id}>
                    <b>{task.instance_code} - {task.creative_name}</b>
                    <span>{task.assigned_to_name}</span>
                    <span>{task.content_writer_name}</span>
                    <StatusBadge status={task.status} />
                    <ProgressBar value={task.progress} />
                    <button type="button" className="marketing-task-detail-button" onClick={() => { setSelectedCampaignId(""); setDetail(null); void openTask(dashboardTask); }}>تفاصيل</button>
                  </article>;
                })}
              </details>
            ))}
          </div>
          {detail.campaign.workflow_stage === "publishing" ? (
            <div className="marketing-detail-section">
              <h3>جدول النشر</h3>
              {detail.schedule.map((item) => (
                <article className="marketing-schedule-row" key={item.id}>
                  <b>{formatDate(item.publish_date)}</b>
                  <span>{item.instance_code} - {item.creative_name}</span>
                  <span>{item.posts.map((post) => `${post.platform_name}: ${post.post_type_name}`).join("، ")}</span>
                </article>
              ))}
            </div>
          ) : detail.progress >= 100 && meta.permissions.canManage ? (
            <ConfirmButton onClick={() => void campaignAction("move_to_publish", String(detail.campaign.id))} disabled={busy}>
              <PaperPlaneTilt size={18} />نقل الحملة إلى قسم النشر
            </ConfirmButton>
          ) : null}
        </div>
      )}
    </Modal>
  </div>;
}
