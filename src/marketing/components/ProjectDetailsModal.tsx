import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowCounterClockwise, DownloadSimple, FileArrowUp, FloppyDisk, FolderOpen, LinkSimple, PaperPlaneTilt, PencilSimple, Printer, Trash, X } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { formatMarketingDate, marketingFetch, statusLabel, uploadMarketingFile } from "../api";
import type { MarketingMeta, MarketingTask, ProjectDetail } from "../types";
import { Field, MarketingBadge, MarketingError, MarketingLoading, ProgressBar } from "./Common";
import { TaskDetailsModal } from "./TaskDetailsModal";

const tabs = [
  ["overview", "البيانات"], ["creatives", "الكرييتيف"], ["assignments", "التكليفات"], ["users", "ملخص اليوزرات"], ["tasks", "التاسكات"],
  ["vehicles", "السيارات"], ["budget", "الميزانية"], ["schedule", "جدول النشر"], ["files", "الملفات والروابط"], ["activity", "سجل النشاط"],
] as const;

type TabKey = typeof tabs[number][0];

export function ProjectDetailsModal({ projectId, meta, onClose, onChanged }: { projectId: string | null; meta: MarketingMeta; onClose: () => void; onChanged?: () => Promise<void> | void }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");
  const [task, setTask] = useState<MarketingTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [projectForm, setProjectForm] = useState({ name: "", campaignTypeId: "", objective: "", contentBrief: "", campaignDate: "", startsOn: "", endsOn: "" });
  const [linkForm, setLinkForm] = useState({ platformId: "", url: "" });
  const [fileKind, setFileKind] = useState("other");

  async function load() {
    if (!projectId) return;
    setLoading(true); setError("");
    try {
      const result = await marketingFetch<ProjectDetail>(`/api/marketing?resource=project&id=${encodeURIComponent(projectId)}`);
      setDetail(result);
      setProjectForm({
        name: String(result.project.name || ""),
        campaignTypeId: String(result.project.campaign_type_id || ""),
        objective: String(result.project.objective || ""),
        contentBrief: String(result.project.content_brief || ""),
        campaignDate: String(result.project.campaign_date || result.project.starts_on || "").slice(0, 10),
        startsOn: String(result.project.starts_on || "").slice(0, 10),
        endsOn: String(result.project.ends_on || "").slice(0, 10),
      });
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل التفاصيل"); }
    finally { setLoading(false); }
  }

  useEffect(() => { setDetail(null); setTab("overview"); setMessage(""); void load(); }, [projectId]);

  const progress = Number(detail?.project.progress || 0);
  const canPublish = meta.permissions["marketing.publish.manage"] && progress >= 99.99 && detail?.project.stage !== "publishing";
  const groupedAssignments = useMemo(() => {
    if (!detail) return [];
    return detail.creatives.map((creative) => ({ creative, rows: detail.assignments.filter((row) => row.creative_id === creative.id) }));
  }, [detail]);
  const userSummary = useMemo(() => {
    if (!detail) return [];
    const map = new Map<string, { key: string; name: string; department: string; tasks: number; notStarted: number; active: number; delayed: number; nearestDue: string | null; lastReceived: string | null }>();
    const now = Date.now();
    for (const row of detail.tasks) {
      const key = `${row.assigned_to || row.assigned_name || "unknown"}:${row.department_id || row.department_name || "none"}`;
      const current = map.get(key) || { key, name: row.assigned_name || "غير محدد", department: row.department_name || (row.task_kind === "template" ? "قسم المحتوى" : "—"), tasks: 0, notStarted: 0, active: 0, delayed: 0, nearestDue: null, lastReceived: null };
      current.tasks += 1;
      if (!row.received_at) current.notStarted += 1;
      if (["active", "review", "revision_requested"].includes(row.status)) current.active += 1;
      if (row.due_at && new Date(row.due_at).getTime() < now && !["completed", "rejected"].includes(row.status)) current.delayed += 1;
      if (row.due_at && (!current.nearestDue || row.due_at < current.nearestDue)) current.nearestDue = row.due_at;
      if (row.received_at && (!current.lastReceived || row.received_at > current.lastReceived)) current.lastReceived = row.received_at;
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [detail]);
  const productFiles = useMemo(() => detail?.tasks.flatMap((row) => row.uploads.filter((upload) => upload.upload_kind === "final").map((upload) => ({ ...upload, task: row }))) || [], [detail]);

  async function run(payload: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setMessage("");
    try {
      const result = await marketingFetch<{ ok: true; message?: string }>("/api/marketing", { method: "POST", body: JSON.stringify(payload) });
      setMessage(result.message || "تم تنفيذ الإجراء");
      await load(); await onChanged?.();
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء"); }
    finally { setBusy(false); }
  }

  async function openFile(id: string) {
    try { const result = await marketingFetch<{ ok: true; url: string }>(`/api/marketing?resource=file&scope=project&id=${encodeURIComponent(id)}`); window.open(result.url, "_blank", "noopener,noreferrer"); }
    catch (failure) { setMessage(failure instanceof Error ? failure.message : "تعذر فتح الملف"); }
  }

  async function openTaskFile(id: string) {
    try { const result = await marketingFetch<{ ok: true; url: string }>(`/api/marketing?resource=file&scope=task&id=${encodeURIComponent(id)}`); window.open(result.url, "_blank", "noopener,noreferrer"); }
    catch (failure) { setMessage(failure instanceof Error ? failure.message : "تعذر فتح ملف المنتج"); }
  }

  async function saveProject() {
    if (!detail) return;
    await run({ action: "update_project", id: detail.project.id, ...projectForm });
    setEditing(false);
  }

  async function saveLink() {
    if (!detail || !linkForm.url.trim()) return;
    await run({ action: "save_project_link", campaignId: detail.project.id, platformId: linkForm.platformId || null, url: linkForm.url.trim() });
    setLinkForm({ platformId: "", url: "" });
  }

  async function uploadProjectFile(file: File | null) {
    if (!detail || !file) return;
    setBusy(true); setMessage("");
    try {
      await uploadMarketingFile({ scope: "project", entityId: detail.project.id, file, fileKind });
      setMessage("تم رفع الملف وربطه بالمشروع");
      await load(); await onChanged?.();
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "تعذر رفع الملف"); }
    finally { setBusy(false); }
  }

  function exportExcel() {
    if (!detail) return;
    const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
    const table = (headers: string[], rows: unknown[][]) => `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;direction:rtl}h1,h2{margin:18px 0 8px}table{border-collapse:collapse;width:100%;margin-bottom:18px}th,td{border:1px solid #999;padding:8px;text-align:right;vertical-align:top}th{background:#ececec}</style></head><body><h1>${escapeHtml(detail.project.name)}</h1>${table(["الكود","المصدر","المرحلة","البداية","النهاية","التقدم"], [[detail.project.campaign_code, detail.project.source_kind === "agenda" ? "أجندة" : "حملة", statusLabel(detail.project.stage), formatMarketingDate(detail.project.starts_on), formatMarketingDate(detail.project.ends_on), `${progress}%`]])}<h2>التاسكات</h2>${table(["رقم التاسك","النوع","الـInstance","القسم","المسؤول","كاتب المحتوى","الحالة","التقدم","الاستلام","التسليم"], detail.tasks.map((row) => [row.task_no,row.task_kind,row.instance_no || "",row.department_name || "",row.assigned_name || "",row.content_writer_name || "",statusLabel(row.status),`${row.progress}%`,formatMarketingDate(row.received_at,true),formatMarketingDate(row.due_at,true)]))}<h2>التكليفات</h2>${table(["الـInstance","القسم","الدور","المسؤول","كاتب المحتوى","موعد التسليم","الملاحظات"], detail.assignments.map((row) => [detail.creatives.find((creative) => creative.id === row.creative_id)?.instance_no || "",row.department_name,row.assignment_role,row.assigned_name,row.content_writer_name || "",formatMarketingDate(row.due_at,true),row.notes || ""]))}<h2>الميزانية</h2>${table(["الـInstance","المنصة","Funnel","عدد الإعلانات","هدف المحتوى","الهدف المتوقع","المبلغ","الملاحظات"], detail.budget.map((row) => [row.instance_no || "",row.platform_name || "",row.funnel || "",row.ad_count || 0,row.content_goal || "",row.expected_goal || "",row.amount || 0,row.notes || ""]))}<h2>جدول النشر</h2>${table(["التاريخ","الوقت","الـInstance","المنصة","نوع النشر","المقاسات","الملاحظات"], detail.schedule.map((row) => [formatMarketingDate(row.publish_date),row.publish_time || "",row.instance_no || "",row.platform_name,row.post_type_name,row.dimensions || "",row.notes || ""]))}</body></html>`;
    const url = URL.createObjectURL(new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${detail.project.campaign_code}-review.xls`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  return <>
    <Modal open={Boolean(projectId)} onClose={onClose} title={detail?.project.name || "تفاصيل الحملة أو الأجندة"} subtitle={detail?.project.campaign_code || ""} className="marketing-project-modal">
      {loading && !detail ? <MarketingLoading /> : error ? <MarketingError message={error} onRetry={() => void load()} /> : detail ? <div className="marketing-project-detail">
        <div className="marketing-project-summary">
          <div><span>المصدر</span><strong>{detail.project.source_kind === "agenda" ? "أجندة" : "حملة"}</strong></div>
          <div><span>المرحلة</span><MarketingBadge value={statusLabel(detail.project.stage)} /></div>
          <div><span>البداية</span><strong>{formatMarketingDate(detail.project.starts_on)}</strong></div>
          <div><span>النهاية</span><strong>{formatMarketingDate(detail.project.ends_on)}</strong></div>
          <div className="progress-cell"><span>جاهزية التنفيذ</span><ProgressBar value={progress} /></div>
        </div>
        <div className="marketing-project-toolbar">
          <button type="button" onClick={() => window.print()}><Printer size={17} />طباعة</button>
          <button type="button" onClick={exportExcel}><DownloadSimple size={17} />تصدير Excel</button>
          {meta.permissions["marketing.project.edit"] ? <button type="button" onClick={() => setEditing((value) => !value)}>{editing ? <X size={17} /> : <PencilSimple size={17} />}{editing ? "إلغاء التعديل" : "تعديل البيانات"}</button> : null}
          {meta.permissions["marketing.project.create"] ? <button type="button" disabled={busy} onClick={() => void run({ action: "create_raw_folders", campaignId: detail.project.id })}><FolderOpen size={17} />إنشاء فولدرات الخام</button> : null}
          {canPublish ? <button className="primary" type="button" disabled={busy} onClick={() => void run({ action: "move_to_publish", id: detail.project.id })}><PaperPlaneTilt size={17} />نقل إلى النشر</button> : null}
          {meta.permissions["marketing.project.archive"] ? detail.project.archived_at ? <button type="button" disabled={busy} onClick={() => void run({ action: "project_state", id: detail.project.id, stateAction: "restore" })}><ArrowCounterClockwise size={17} />استرجاع</button> : <button type="button" disabled={busy} onClick={() => void run({ action: "project_state", id: detail.project.id, stateAction: "archive" }, "تأكيد أرشفة السجل؟")}><Archive size={17} />أرشفة</button> : null}
          {meta.permissions["marketing.project.delete"] ? <button className="danger" type="button" disabled={busy} onClick={() => void run({ action: "project_state", id: detail.project.id, stateAction: "delete" }, "تأكيد المسح الناعم؟")}><Trash size={17} />مسح</button> : null}
        </div>
        {message ? <p className="marketing-form-message">{message}</p> : null}
        <nav className="marketing-detail-tabs">{tabs.map(([key, label]) => <button type="button" key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>

        {tab === "overview" ? editing ? <div className="panel marketing-settings-form marketing-project-edit-form">
          <div className="marketing-form-grid">
            <Field label="الاسم" wide><input value={projectForm.name} onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })} /></Field>
            {detail.project.source_kind === "campaign" ? <Field label="نوع الحملة"><select value={projectForm.campaignTypeId} onChange={(event) => setProjectForm({ ...projectForm, campaignTypeId: event.target.value })}><option value="">بدون نوع</option>{meta.campaignTypes.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field> : null}
            <Field label="تاريخ الحملة"><input type="date" value={projectForm.campaignDate} onChange={(event) => setProjectForm({ ...projectForm, campaignDate: event.target.value })} /></Field>
            <Field label="البداية"><input type="date" value={projectForm.startsOn} onChange={(event) => setProjectForm({ ...projectForm, startsOn: event.target.value })} /></Field>
            <Field label="النهاية"><input type="date" value={projectForm.endsOn} onChange={(event) => setProjectForm({ ...projectForm, endsOn: event.target.value })} /></Field>
            <Field label="الهدف" wide><textarea value={projectForm.objective} onChange={(event) => setProjectForm({ ...projectForm, objective: event.target.value })} /></Field>
            <Field label="ملخص المحتوى" wide><textarea value={projectForm.contentBrief} onChange={(event) => setProjectForm({ ...projectForm, contentBrief: event.target.value })} /></Field>
          </div>
          <button className="marketing-primary-button" type="button" disabled={busy || !projectForm.name.trim()} onClick={() => void saveProject()}><FloppyDisk size={17} />حفظ التعديلات</button>
        </div> : <div className="marketing-detail-grid expanded">
          <div><span>الاسم</span><strong>{detail.project.name}</strong></div><div><span>الكود</span><strong>{detail.project.campaign_code}</strong></div>
          <div><span>نوع الحملة</span><strong>{String(detail.project.campaign_type_name || detail.project.campaign_type || "—")}</strong></div><div><span>المنشئ</span><strong>{detail.project.created_by_name || "—"}</strong></div>
          <div className="wide"><span>الهدف</span><p>{String(detail.project.objective || "—")}</p></div><div className="wide"><span>ملخص المحتوى</span><p>{String(detail.project.content_brief || "—")}</p></div>
          <div><span>تاريخ الإنشاء</span><strong>{formatMarketingDate(detail.project.created_at, true)}</strong></div><div><span>النقل للنشر</span><strong>{formatMarketingDate(detail.project.moved_to_publish_at, true)}</strong></div>
        </div> : null}

        {tab === "creatives" ? <div className="marketing-card-list">{detail.creatives.map((row) => <article key={row.id}><header><strong>{row.instance_no} — {row.creative_type_name || row.creative_type}</strong><MarketingBadge value={statusLabel(row.status)} /></header><div><span>الكود المختصر: {row.short_code || "—"}</span><span>القسم الأساسي: {row.primary_department_name || "—"}</span><span>كاتب المحتوى قبل: {formatMarketingDate(row.content_due_at, true)}</span><span>يوم الأجندة: {formatMarketingDate(row.agenda_day)}</span></div>{row.content_notes ? <p>{row.content_notes}</p> : null}</article>)}</div> : null}

        {tab === "assignments" ? <div className="marketing-card-list">{groupedAssignments.map(({ creative, rows }) => <article key={creative.id}><header><strong>{creative.instance_no} — {creative.creative_type}</strong><span>{rows.length} تكليف</span></header><div className="marketing-mini-table"><table><thead><tr><th>القسم</th><th>المسؤول</th><th>كاتب المحتوى المرتبط</th><th>الدور</th><th>التسليم</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.department_name}</td><td>{row.assigned_name}</td><td>{row.content_writer_name || "—"}</td><td>{row.assignment_role === "content" ? "محتوى" : row.assignment_role === "optional" ? "اختياري" : "أساسي"}</td><td>{formatMarketingDate(row.due_at, true)}</td></tr>)}</tbody></table></div></article>)}</div> : null}

        {tab === "users" ? <div className="marketing-table-wrap"><table><thead><tr><th>اليوزر</th><th>القسم</th><th>التاسكات</th><th>لم تبدأ</th><th>نشطة</th><th>متأخرة</th><th>أقرب موعد</th><th>آخر استلام</th></tr></thead><tbody>{userSummary.map((row) => <tr key={row.key}><td><strong>{row.name}</strong></td><td>{row.department}</td><td>{row.tasks}</td><td>{row.notStarted}</td><td>{row.active}</td><td>{row.delayed}</td><td>{formatMarketingDate(row.nearestDue, true)}</td><td>{formatMarketingDate(row.lastReceived, true)}</td></tr>)}</tbody></table></div> : null}

        {tab === "tasks" ? <div className="marketing-task-cards">{detail.tasks.map((row) => <button type="button" key={row.id} onClick={() => setTask(row)}><div><strong>{row.task_no}</strong><span>{row.task_kind === "template" ? "Task Template" : row.department_name || "تنفيذي"}</span></div><MarketingBadge value={statusLabel(row.status)} /><ProgressBar value={row.progress} /></button>)}</div> : null}

        {tab === "vehicles" ? <div className="marketing-table-wrap"><table><thead><tr><th>الـInstance</th><th>السيارة</th><th>VIN</th><th>الخارجي</th><th>الداخلي</th><th>الموقع</th></tr></thead><tbody>{detail.vehicles.map((row, index) => <tr key={`${row.creative_id}-${row.vehicle_id}-${index}`}><td>{detail.creatives.find((item) => item.id === row.creative_id)?.instance_no}</td><td>{row.car_name || row.statement || "—"}</td><td>{row.vin}</td><td>{row.exterior_color || "—"}</td><td>{row.interior_color || "—"}</td><td>{row.location_name || "—"}</td></tr>)}</tbody></table></div> : null}

        {tab === "budget" ? <div className="marketing-table-wrap"><table><thead><tr><th>الكرييتيف</th><th>الفانل</th><th>عدد الإعلانات</th><th>هدف المحتوى</th><th>الهدف المتوقع</th><th>المنصة</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>{detail.budget.map((row) => <tr key={row.id}><td>{row.instance_no} — {row.creative_type}</td><td>{row.funnel}</td><td>{row.ad_count || 1}</td><td>{row.content_goal || "—"}</td><td>{row.expected_goal || "—"}</td><td>{row.platform_name || "—"}</td><td>{Number(row.amount).toLocaleString("ar-SA")}</td><td>{row.notes || "—"}</td></tr>)}</tbody><tfoot><tr><td colSpan={6}>الإجمالي</td><td><strong>{detail.budget.reduce((sum, row) => sum + Number(row.amount || 0), 0).toLocaleString("ar-SA")}</strong></td><td /></tr></tfoot></table></div> : null}

        {tab === "schedule" ? <div className="marketing-table-wrap"><table><thead><tr><th>التاريخ</th><th>الوقت</th><th>الكرييتيف</th><th>المنصة</th><th>نوع النشر</th><th>المقاس</th></tr></thead><tbody>{detail.schedule.map((row) => <tr key={row.id}><td>{formatMarketingDate(row.publish_date)}</td><td>{row.publish_time || "—"}</td><td>{row.instance_no} — {row.creative_type}</td><td>{row.platform_name}</td><td>{row.post_type_name}</td><td>{row.dimensions || "—"}</td></tr>)}</tbody></table></div> : null}

        {tab === "files" ? <div className="marketing-files-grid">
          <section><h3>الروابط</h3>{meta.permissions["marketing.project.edit"] ? <div className="marketing-file-add"><select value={linkForm.platformId} onChange={(event) => setLinkForm({ ...linkForm, platformId: event.target.value })}><option value="">رابط عام</option>{meta.platforms.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><input type="url" value={linkForm.url} onChange={(event) => setLinkForm({ ...linkForm, url: event.target.value })} placeholder="https://..." /><button type="button" disabled={busy || !linkForm.url.trim()} onClick={() => void saveLink()}><LinkSimple size={17} />إضافة الرابط</button></div> : null}{detail.links.map((row) => <a key={row.id} href={row.url} target="_blank" rel="noreferrer"><LinkSimple size={18} /><span>{row.platform_name || "رابط المشروع"}</span><small>{row.url}</small></a>)}</section>
          <section><h3>ملفات المشروع والنتائج</h3>{meta.permissions["marketing.project.edit"] ? <div className="marketing-file-add"><select value={fileKind} onChange={(event) => setFileKind(event.target.value)}><option value="other">ملف عام</option><option value="result">نتيجة نهائية</option><option value="schedule">جدول</option><option value="audit">مراجعة</option><option value="brief">بريف</option></select><label className="marketing-upload-label"><FileArrowUp size={17} /><span>اختيار ورفع ملف</span><input type="file" disabled={busy} onChange={(event) => { const file = event.target.files?.[0] || null; void uploadProjectFile(file); event.currentTarget.value = ""; }} /></label></div> : null}{detail.files.map((row) => <button type="button" key={row.id} onClick={() => void openFile(row.id)}><DownloadSimple size={18} /><span>{row.file_name}</span><small>{row.file_kind} — {formatMarketingDate(row.created_at, true)}</small></button>)}</section>
          <section><h3>ملفات المنتجات</h3>{productFiles.length ? productFiles.map((row) => <button type="button" key={row.id} onClick={() => void openTaskFile(row.id)}><DownloadSimple size={18} /><span>{row.file_name}</span><small>{row.task.department_name || "—"} — {row.task.instance_no || "—"} — {row.task.assigned_name || "—"}</small></button>) : <p>لا توجد ملفات نهائية مرفوعة حتى الآن.</p>}</section>
        </div> : null}

        {tab === "activity" ? <div className="marketing-timeline">{detail.activity.map((row) => <article key={row.id}><i /><div><strong>{row.actor_name || "النظام"}</strong><span>{row.action}</span><small>{formatMarketingDate(row.created_at, true)}</small></div></article>)}</div> : null}
      </div> : null}
    </Modal>
    <TaskDetailsModal task={task} meta={meta} onClose={() => setTask(null)} onChanged={async () => { await load(); const refreshed = detail?.tasks.find((row) => row.id === task?.id); if (refreshed) setTask(refreshed); }} />
  </>;
}
