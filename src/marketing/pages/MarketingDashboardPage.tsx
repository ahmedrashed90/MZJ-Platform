import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  Bell,
  CalendarBlank,
  Car,
  CheckCircle,
  ClockCountdown,
  Eye,
  Megaphone,
  Plus,
  RocketLaunch,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { marketingFetch } from "../api";
import { useMarketingMeta } from "../MarketingLayout";
import type { CampaignRow, TaskRow } from "../types";
import {
  DepartmentBadge,
  formatDate,
  MarketingAlert,
  MarketingEmpty,
  MarketingLoading,
  MarketingModal,
  MarketingPageHeader,
  ProgressBar,
  StatusBadge,
} from "../components/Ui";
import { CampaignDetailView } from "../components/CampaignDetailView";
import { TaskDetailView } from "../components/TaskDetailView";

type DashboardCampaign = Omit<CampaignRow, "departments"> & {
  task_count: number;
  started_count: number;
  completed_count: number;
  delayed_count: number;
  released_at?: string | null;
  users: Array<{ id: string; name: string; department: string; task_type: string }>;
  departments: Array<{ code: string; name: string; progress: number; task_count: number; started_count: number }>;
};

type DashboardTask = TaskRow & {
  writer_due_date?: string | null;
  department_note?: string | null;
  content_note?: string | null;
  released_at?: string | null;
};

type DashboardResponse = {
  ok: true;
  mode: "admin" | "user";
  stats: {
    campaigns: number;
    tasks: number;
    departments: number;
    stock_cars: number;
    completed_campaigns: number;
    active_campaigns: number;
    delayed_tasks: number;
    under_review: number;
  };
  campaigns: DashboardCampaign[];
  ownTasks: DashboardTask[];
  adminTasks: DashboardTask[];
  archiveTasks: DashboardTask[];
  notifications: Array<{ id: string; task_code: string; status: string; updated_at: string; campaign_name: string; creative_name: string }>;
};

function StatCard({ label, value, icon, hint, tone }: { label: string; value: number; icon: ReactNode; hint: string; tone: string }) {
  return <article className={`marketing-stat-card tone-${tone}`}><span className="marketing-stat-icon">{icon}</span><div><p>{label}</p><strong>{Number(value || 0).toLocaleString("ar-SA")}</strong><small>{hint}</small></div></article>;
}

function taskBucket(task: DashboardTask) {
  if (["completed", "content_done", "template_approved"].includes(task.status) || task.user_completed_at) return "done";
  if (task.status === "changes_requested") return "changes";
  if (["template_submitted", "under_review"].includes(task.status)) return "review";
  if (["received", "in_progress"].includes(task.status)) return "work";
  return "new";
}

function TaskCard({ task, onOpen, compact = false, ownerColors = {} }: { task: DashboardTask; onOpen: (id: string) => void; compact?: boolean; ownerColors?: Record<string, string> }) {
  const overdue = Boolean(task.due_at && new Date(task.due_at) < new Date() && Number(task.progress_percent || 0) < 100);
  const ownerColor = ownerColors[task.assigned_to] || "";
  return <button type="button" className={`marketing-dashboard-task-card${compact ? " compact" : ""}`} style={ownerColor ? { borderInlineStartColor: ownerColor, boxShadow: `inset -4px 0 0 ${ownerColor}` } : undefined} onClick={() => onOpen(task.id)}>
    <header><div><small>{task.task_code}</small><strong>{task.creative_name || task.title}</strong></div><StatusBadge status={task.status} /></header>
    <p>{task.campaign_name}</p>
    <div className="marketing-dashboard-task-people"><DepartmentBadge code={task.department_code} /><span style={ownerColor ? { color: ownerColor, fontWeight: 900 } : undefined}>{task.assigned_to_name || "غير مسند"}</span>{task.content_user_name && task.task_type === "execution" ? <small>كاتب المحتوى: {task.content_user_name}</small> : null}</div>
    <ProgressBar compact value={Number(task.progress_percent || 0)} />
    <footer><span className={overdue ? "late" : ""}>{overdue ? <WarningCircle size={15} /> : <ClockCountdown size={15} />}{formatDate(task.due_at)}</span><Eye size={17} /></footer>
  </button>;
}

function CampaignReadinessCard({ campaign, onOpen }: { campaign: DashboardCampaign; onOpen: (id: string) => void }) {
  return <button type="button" className="marketing-dashboard-ready-card" onClick={() => onOpen(campaign.id)}>
    <header><div><small>{campaign.campaign_code}</small><strong>{campaign.name}</strong><span>{campaign.source_type === "agenda" ? "أجندة" : campaign.campaign_type}</span></div><StatusBadge status={campaign.status} type="campaign" /></header>
    <ProgressBar value={Number(campaign.progress_percent || 0)} label="جاهزية المطلوب" />
    <div className="marketing-dashboard-metrics"><span><b>{campaign.started_count || 0}</b> بدأت</span><span><b>{campaign.completed_count || 0}</b> مكتملة</span><span className={campaign.delayed_count ? "danger" : ""}><b>{campaign.delayed_count || 0}</b> متأخرة</span></div>
    <div className="marketing-dashboard-departments">{(campaign.departments || []).map((department) => <div key={`${campaign.id}-${department.code}`}><div><DepartmentBadge code={department.code} /><span>{department.started_count || 0}/{department.task_count || 0}</span></div><ProgressBar compact value={Number(department.progress || 0)} /></div>)}</div>
    <footer><span><CalendarBlank size={15} />{formatDate(campaign.publish_start_date)} – {formatDate(campaign.publish_end_date)}</span><Eye size={17} /></footer>
  </button>;
}

function groupTasksByDepartment(tasks: DashboardTask[]) {
  const map = new Map<string, DashboardTask[]>();
  for (const task of tasks) {
    const key = task.department_code || "other";
    const list = map.get(key) || [];
    list.push(task);
    map.set(key, list);
  }
  const order = ["content", "montage", "photography", "design", "publishing"];
  return [...map.entries()].sort(([a], [b]) => {
    const ai = order.indexOf(a); const bi = order.indexOf(b);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.localeCompare(b, "ar");
  });
}

function groupTasksByCampaign(tasks: DashboardTask[]) {
  const map = new Map<string, { campaignName: string; campaignCode: string; tasks: DashboardTask[] }>();
  for (const task of tasks) {
    const row = map.get(task.campaign_id) || { campaignName: task.campaign_name, campaignCode: task.campaign_code, tasks: [] };
    row.tasks.push(task); map.set(task.campaign_id, row);
  }
  return [...map.entries()];
}

export function MarketingDashboardPage() {
  const { meta } = useMarketingMeta();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try { setData(await marketingFetch<DashboardResponse>("/api/marketing?resource=dashboard")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل لوحة التحكم"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const readinessCampaigns = useMemo(() => (data?.campaigns || []).filter((campaign) => !campaign.released_at && campaign.status !== "archived"), [data]);
  const publishingCampaigns = useMemo(() => (data?.campaigns || []).filter((campaign) => Boolean(campaign.released_at) && campaign.status !== "archived"), [data]);
  const userBuckets = useMemo(() => {
    const tasks = data?.ownTasks || [];
    return {
      new: tasks.filter((task) => taskBucket(task) === "new"),
      work: tasks.filter((task) => taskBucket(task) === "work"),
      review: tasks.filter((task) => taskBucket(task) === "review"),
      changes: tasks.filter((task) => taskBucket(task) === "changes"),
      done: tasks.filter((task) => taskBucket(task) === "done"),
    };
  }, [data]);

  if (loading && !data) return <MarketingLoading label="جاري تحميل تفاصيل الداش بورد..." />;

  return <div className="marketing-page marketing-dashboard-page">
    <MarketingPageHeader title="لوحة التحكم" description="نفس فلو الداش بورد المعتمد: المطلوب، جاهزية المطلوب، قسم النشر، الأرشيف، ولوحة اليوزر حسب حالة التاسك." actions={<><button type="button" className="marketing-button" onClick={() => void load()}>تحديث</button>{meta.access.campaignsManage ? <Link className="marketing-button primary" to="/marketing/campaigns/new"><Plus size={18} />حملة جديدة</Link> : null}</>} />
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}
    {data ? <>
      <section className="marketing-stats-grid">
        <StatCard label="إجمالي الحملات" value={data.stats.campaigns} icon={<Megaphone size={26} weight="duotone" />} hint={`${data.stats.active_campaigns || 0} في جاهزية المطلوب`} tone="brown" />
        <StatCard label="إجمالي التاسكات" value={data.stats.tasks} icon={<CheckCircle size={26} weight="duotone" />} hint={`${data.stats.under_review || 0} تحت المراجعة`} tone="purple" />
        <StatCard label="الأقسام" value={data.stats.departments} icon={<UsersThree size={26} weight="duotone" />} hint="الأقسام المشاركة فعليًا" tone="orange" />
        <StatCard label="السيارات في الاستوك" value={data.stats.stock_cars} icon={<Car size={26} weight="duotone" />} hint="قراءة مباشرة من مخزن العمليات" tone="green" />
      </section>
      <section className="marketing-dashboard-secondary-stats">
        <div><CheckCircle size={20} /><span>حملات مكتملة</span><b>{data.stats.completed_campaigns || 0}</b></div>
        <div><ClockCountdown size={20} /><span>تاسكات متأخرة</span><b>{data.stats.delayed_tasks || 0}</b></div>
        <div><Bell size={20} /><span>إجراءات مطلوبة</span><b>{data.notifications.length}</b></div>
      </section>

      {data.mode === "admin" ? <section className="marketing-admin-flow-board">
        <section className="marketing-flow-column required"><header><div><CheckCircle size={21} /><h2>TASK - المطلوب</h2></div><span>{data.adminTasks.length}</span><p>كل تاسكات الحملات، القسم، المسؤول، الاستلام والتقدم.</p></header><div className="marketing-flow-column-body">{groupTasksByDepartment(data.adminTasks).map(([department, tasks]) => <details key={department} open className="marketing-dashboard-department-group"><summary><DepartmentBadge code={department} /><span>{tasks.length} تاسك</span></summary><div>{tasks.map((task) => <TaskCard compact key={task.id} task={task} ownerColors={meta.ownerColors} onOpen={setSelectedTaskId} />)}</div></details>)}{!data.adminTasks.length ? <MarketingEmpty title="لا توجد تاسكات" /> : null}</div></section>
        <section className="marketing-flow-column readiness"><header><div><Megaphone size={21} /><h2>جاهزية المطلوب</h2></div><span>{readinessCampaigns.length}</span><p>تقدم الحملة محسوب من متوسط الأقسام المتساوي.</p></header><div className="marketing-flow-column-body">{readinessCampaigns.map((campaign) => <CampaignReadinessCard key={campaign.id} campaign={campaign} onOpen={setSelectedCampaignId} />)}{!readinessCampaigns.length ? <MarketingEmpty title="لا توجد حملات في جاهزية المطلوب" /> : null}</div></section>
        <section className="marketing-flow-column publishing"><header><div><RocketLaunch size={21} /><h2>قسم النشر</h2></div><span>{publishingCampaigns.length}</span><p>الحملات التي تم نقلها يدويًا بعد اكتمال الجاهزية.</p></header><div className="marketing-flow-column-body">{publishingCampaigns.map((campaign) => <CampaignReadinessCard key={campaign.id} campaign={campaign} onOpen={setSelectedCampaignId} />)}{!publishingCampaigns.length ? <MarketingEmpty title="قسم النشر ينتظر نقل الحملات الجاهزة" /> : null}</div></section>
        <section className="marketing-flow-column archive"><header><div><Archive size={21} /><h2>قسم الأرشيف</h2></div><span>{data.archiveTasks.length}</span><p>التاسكات المنتهية مع بقاء تفاصيلها وملفاتها.</p></header><div className="marketing-flow-column-body">{data.archiveTasks.map((task) => <TaskCard compact key={task.id} task={task} ownerColors={meta.ownerColors} onOpen={setSelectedTaskId} />)}{!data.archiveTasks.length ? <MarketingEmpty title="لا يوجد أرشيف" /> : null}</div></section>
      </section> : <section className="marketing-user-flow-section">
        <div className="marketing-user-flow-toolbar"><div><h2>لوحة التاسكات</h2><p>التاسكات المسندة لك فقط، مجمعة حسب الحملة في الجديد وجاري العمل.</p></div><button type="button" className={`marketing-button${showCompleted ? " primary" : ""}`} onClick={() => setShowCompleted((value) => !value)}>{showCompleted ? "إخفاء التاسكات المنتهية" : "التاسكات المنتهية"}</button></div>
        {showCompleted ? <section className="marketing-user-kanban single"><UserColumn title="التاسكات المنتهية" tasks={userBuckets.done} groupByCampaign={false} ownerColors={meta.ownerColors} onOpen={setSelectedTaskId} /></section> : <section className="marketing-user-kanban"><UserColumn title="جديد / لم يتم الاستلام" tasks={userBuckets.new} groupByCampaign ownerColors={meta.ownerColors} onOpen={setSelectedTaskId} /><UserColumn title="تم الاستلام / جاري العمل" tasks={userBuckets.work} groupByCampaign ownerColors={meta.ownerColors} onOpen={setSelectedTaskId} /><UserColumn title="في المراجعة" tasks={userBuckets.review} groupByCampaign={false} ownerColors={meta.ownerColors} onOpen={setSelectedTaskId} /><UserColumn title="محتاج تعديل" tasks={userBuckets.changes} groupByCampaign={false} ownerColors={meta.ownerColors} onOpen={setSelectedTaskId} /></section>}
      </section>}

      {data.notifications.length ? <section className="marketing-notifications-panel"><header><div><Bell size={20} /><h2>الإشعارات والإجراءات المطلوبة</h2></div><span>{data.notifications.length}</span></header><div>{data.notifications.map((item) => <button type="button" key={item.id} onClick={() => setSelectedTaskId(item.id)}><div><strong>{item.creative_name || item.task_code}</strong><small>{item.campaign_name} · {formatDate(item.updated_at, true)}</small></div><StatusBadge status={item.status} /></button>)}</div></section> : null}
    </> : null}
    <MarketingModal open={Boolean(selectedCampaignId)} title="تفاصيل الحملة" onClose={() => setSelectedCampaignId("")} wide>{selectedCampaignId ? <CampaignDetailView campaignId={selectedCampaignId} onTaskOpen={setSelectedTaskId} onChanged={load} /> : null}</MarketingModal>
    <MarketingModal open={Boolean(selectedTaskId)} title="تفاصيل التاسك" onClose={() => setSelectedTaskId("")} wide>{selectedTaskId ? <TaskDetailView taskId={selectedTaskId} onChanged={load} /> : null}</MarketingModal>
  </div>;
}

function UserColumn({ title, tasks, groupByCampaign, ownerColors, onOpen }: { title: string; tasks: DashboardTask[]; groupByCampaign: boolean; ownerColors: Record<string, string>; onOpen: (id: string) => void }) {
  return <section className="marketing-user-kanban-column"><header><h3>{title}</h3><span>{tasks.length}</span></header><div>{groupByCampaign ? groupTasksByCampaign(tasks).map(([campaignId, group]) => <details key={campaignId} open className="marketing-user-campaign-group"><summary><div><strong>{group.campaignName}</strong><small>{group.campaignCode}</small></div><span>{group.tasks.length}</span></summary><div>{group.tasks.map((task) => <TaskCard key={task.id} task={task} compact ownerColors={ownerColors} onOpen={onOpen} />)}</div></details>) : tasks.map((task) => <TaskCard key={task.id} task={task} compact ownerColors={ownerColors} onOpen={onOpen} />)}{!tasks.length ? <MarketingEmpty title="لا توجد تاسكات" /> : null}</div></section>;
}
