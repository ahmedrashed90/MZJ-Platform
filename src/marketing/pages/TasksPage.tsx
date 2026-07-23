import { useEffect, useMemo, useState } from "react";
import { Funnel, MagnifyingGlass } from "@phosphor-icons/react";
import { marketingFetch, queryString } from "../api";
import type { TaskRow } from "../types";
import { useMarketingMeta } from "../MarketingLayout";
import { TaskDetailView } from "../components/TaskDetailView";
import { DepartmentBadge, MarketingAlert, MarketingEmpty, MarketingLoading, MarketingModal, MarketingPageHeader, ProgressBar, StatusBadge, formatDate } from "../components/Ui";

type Payload = { ok: true; rows: TaskRow[]; total: number; page: number; pageSize: number };
const buckets = [
  { key: "new", label: "جديدة", statuses: ["pending_template", "ready", "blocked_by_template"] },
  { key: "working", label: "تم الاستلام / جاري العمل", statuses: ["received", "in_progress"] },
  { key: "changes", label: "مطلوب تعديل", statuses: ["changes_requested"] },
  { key: "review", label: "تحت المراجعة", statuses: ["template_submitted", "under_review"] },
  { key: "done", label: "منتهية", statuses: ["template_approved", "content_done", "completed"] },
];

export function TasksPage() {
  const { meta } = useMarketingMeta();
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [taskType, setTaskType] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [delayed, setDelayed] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true); setError("");
    try { const payload = await marketingFetch<Payload>(`/api/marketing?${queryString({ resource: "tasks", pageSize: 500, search, department, taskType, assignedTo, delayed })}`); setRows(payload.rows); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل المتابعة"); }
    finally { setLoading(false); }
  }
  useEffect(() => { const timer = window.setTimeout(() => void load(), 220); return () => window.clearTimeout(timer); }, [search, department, taskType, assignedTo, delayed]);
  const grouped = useMemo(() => Object.fromEntries(buckets.map((bucket) => [bucket.key, rows.filter((row) => bucket.statuses.includes(row.status))])), [rows]);
  const other = rows.filter((row) => !buckets.some((bucket) => bucket.statuses.includes(row.status)));
  return <div className="marketing-page"><MarketingPageHeader title="المتابعة" description="متابعة مهام المحتوى والتنفيذ بنفس تقسيم النظام القديم، مع الاعتماد الدقيق لكل Pair وإجراءات كل قسم." />{error ? <MarketingAlert>{error}</MarketingAlert> : null}<section className="marketing-panel"><div className="marketing-toolbar"><label className="marketing-field"><span>بحث</span><div style={{ position: "relative" }}><MagnifyingGlass style={{ position: "absolute", right: 10, top: 12 }} /><input style={{ paddingRight: 36 }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="كود التاسك أو الحملة أو الكرييتيف" /></div></label><label className="marketing-field"><span>القسم</span><select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">كل الأقسام</option>{meta.departments.map((item) => <option key={item.department_code} value={item.department_code}>{item.display_name}</option>)}</select></label><label className="marketing-field"><span>نوع التاسك</span><select value={taskType} onChange={(event) => setTaskType(event.target.value)}><option value="">الكل</option><option value="content_template">Task Template</option><option value="execution">تنفيذ</option></select></label><label className="marketing-field"><span>المسؤول</span><select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}><option value="">كل اليوزرات</option>{meta.users.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label><label className="marketing-check"><input type="checkbox" checked={delayed} onChange={(event) => setDelayed(event.target.checked)} /><span>المتأخرة فقط</span></label></div></section>{loading ? <MarketingLoading /> : !rows.length ? <section className="marketing-panel"><MarketingEmpty title="لا توجد مهام مطابقة" /></section> : <div className="marketing-task-board">{buckets.map((bucket) => <section className="marketing-task-column" key={bucket.key}><header><h3>{bucket.label}</h3><span>{grouped[bucket.key].length}</span></header>{grouped[bucket.key].map((task: TaskRow) => <TaskCard key={task.id} task={task} ownerColors={meta.ownerColors} onClick={() => setSelectedId(task.id)} />)}{!grouped[bucket.key].length ? <MarketingEmpty title="فارغ" /> : null}</section>)}{other.length ? <section className="marketing-task-column"><header><h3>حالات أخرى</h3><span>{other.length}</span></header>{other.map((task) => <TaskCard key={task.id} task={task} ownerColors={meta.ownerColors} onClick={() => setSelectedId(task.id)} />)}</section> : null}</div>}<MarketingModal open={Boolean(selectedId)} title="تفاصيل التاسك" onClose={() => setSelectedId("")} wide>{selectedId ? <TaskDetailView taskId={selectedId} onChanged={() => void load()} /> : null}</MarketingModal></div>;
}
function TaskCard({ task, ownerColors, onClick }: { task: TaskRow; ownerColors: Record<string, string>; onClick: () => void }) { const overdue = Boolean(task.due_at && new Date(task.due_at).getTime() < Date.now() && task.progress_percent < 100); const ownerColor = ownerColors[task.assigned_to] || ""; return <article className="marketing-task-card" style={ownerColor ? { borderInlineStartColor: ownerColor, boxShadow: `inset -4px 0 0 ${ownerColor}` } : undefined} onClick={onClick}><small>{task.task_code}</small><h4>{task.creative_name || task.title}</h4><b>{task.campaign_name}</b><div className="meta"><DepartmentBadge code={task.department_code} /><StatusBadge status={task.status} />{overdue ? <span className="marketing-status status-failed">متأخر</span> : null}</div><ProgressBar compact value={task.progress_percent} /><small style={ownerColor ? { color: ownerColor, fontWeight: 900 } : undefined}>المسؤول: {task.assigned_to_name || "—"}</small><small style={{ display: "block" }}>الاستلام: {formatDate(task.due_at)}</small></article>; }
