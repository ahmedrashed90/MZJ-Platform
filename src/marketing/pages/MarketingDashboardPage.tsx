import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  Archive,
  CaretDown,
  CaretUp,
  CheckCircle,
  ClockCountdown,
  PaperPlaneTilt,
  Receipt,
  UserCircle,
} from "@phosphor-icons/react";
import { marketingFetch, marketingQuery } from "../api";
import { MarketingAlert, MarketingPage, ProgressBar } from "../components/MarketingPage";
import { TaskDetailModal } from "../components/TaskDetailModal";

function templateStatusLabel(status: unknown) {
  const labels: Record<string, string> = {
    not_started: "في انتظار رفع Task Template",
    under_review: "في انتظار اعتماد Task Template",
    revision_requested: "مطلوب تعديل Task Template",
    rejected: "تم رفض Task Template",
    approved: "تم اعتماد Task Template",
  };
  return labels[String(status || "")] || "";
}

function taskKindLabel(task: any) {
  return task.task_kind === "task_template" ? "Task Template" : "تاسك تنفيذي";
}

function taskProgress(task: any) {
  return Math.max(0, Math.min(100, Number(task.progress || 0)));
}

function DashboardTaskCard({
  task,
  onOpen,
  onReceive,
  showReceive = false,
}: {
  task: any;
  onOpen: () => void;
  onReceive?: () => void;
  showReceive?: boolean;
}) {
  const statusLabel = templateStatusLabel(task.template_status);
  const progress = taskProgress(task);

  return <article className="marketing-dashboard-task-card">
    <div className="marketing-dashboard-task-top">
      <span className={`marketing-dashboard-task-badge status-${task.template_status || "not_started"}`}>{statusLabel || `${taskKindLabel(task)} - ${task.department_name || "القسم"}`}</span>
      <strong>{task.creative_name || task.title || "تاسك"}</strong>
    </div>
    <p className="marketing-dashboard-task-code">{task.campaign_code || task.source_name || "—"}</p>
    <div className="marketing-dashboard-task-progress">
      <span>{progress.toLocaleString("ar-SA")}%</span>
      <ProgressBar value={progress} />
    </div>

    <div className="marketing-dashboard-assignees">
      <div className="marketing-dashboard-assignee">
        <span>المسؤول</span>
        <b><UserCircle size={18} weight="fill" />{task.assigned_name || "—"}</b>
      </div>
      {task.content_user_name ? <div className="marketing-dashboard-assignee content">
        <span>كاتب المحتوى</span>
        <b><UserCircle size={18} weight="fill" />{task.content_user_name}</b>
      </div> : null}
    </div>

    <div className="marketing-dashboard-task-meta">
      <div><span>القسم</span><strong>{task.department_name || "—"}</strong></div>
      <div><span>الكرييتيف</span><strong>{task.creative_name || task.title || "—"}</strong></div>
    </div>

    <div className="marketing-dashboard-task-actions">
      <button type="button" className="secondary" onClick={onOpen}>تفاصيل</button>
      {showReceive && onReceive ? <button type="button" className="primary" onClick={onReceive}><CheckCircle size={17} />تم الاستلام</button> : null}
    </div>
  </article>;
}

export function MarketingDashboardPage() {
  const [data, setData] = useState<any>({ required: [], received: [], entities: [] });
  const [taskId, setTaskId] = useState<string | null>(null);
  const [expandedRequired, setExpandedRequired] = useState<string[]>([]);
  const [expandedEntities, setExpandedEntities] = useState<string[]>([]);
  const [expandedReadinessDepartments, setExpandedReadinessDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await marketingFetch<any>(`/api/marketing${marketingQuery({ resource: "dashboard" })}`));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل الداش بورد");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function receive(id: string) {
    try {
      await marketingFetch("/api/marketing", { method: "POST", body: JSON.stringify({ action: "receive_task", id }) });
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر استلام التاسك");
    }
  }

  function toggleList(setter: Dispatch<SetStateAction<string[]>>, key: string) {
    setter((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  const requiredByDepartment = useMemo(() => {
    const map = new Map<string, { name: string; tasks: any[] }>();
    for (const task of data.required || []) {
      const key = task.department_id || task.department_name || "unknown";
      const current: { name: string; tasks: any[] } = map.get(key) || { name: task.department_name || "قسم المحتوى", tasks: [] };
      current.tasks.push(task);
      map.set(key, current);
    }
    return Array.from(map.entries());
  }, [data.required]);

  const receivedBySource = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const task of data.received || []) {
      const key = `${task.source_type}:${task.source_id}`;
      map.set(key, [...(map.get(key) || []), task]);
    }
    return map;
  }, [data.received]);

  const readinessEntities = useMemo(
    () => (data.entities || []).filter((item: any) => receivedBySource.has(`${item.source_type}:${item.id}`)),
    [data.entities, receivedBySource],
  );

  return <MarketingPage title="الداش بورد" description="متابعة المطلوب وجاهزية الحملات والأجندات داخل سيستم التسويق.">
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}
    {loading ? <div className="marketing-empty">جاري تحميل الداش بورد...</div> : <div className="marketing-kanban marketing-dashboard-workflow">
      <section className="marketing-kanban-column required marketing-dashboard-column">
        <header>
          <div><Receipt size={23} /><div><h2>TASK - المطلوب</h2><p>التاسكات التي لم يتم استلامها بعد، مجمعة حسب القسم.</p></div></div>
          <b>{data.required.length}</b>
        </header>
        <div className="marketing-kanban-body">
          {requiredByDepartment.length ? requiredByDepartment.map(([departmentKey, group]) => {
            const open = expandedRequired.includes(departmentKey);
            return <section className={`marketing-dashboard-department ${open ? "open" : ""}`} key={departmentKey}>
              <button type="button" className="marketing-dashboard-department-head" onClick={() => toggleList(setExpandedRequired, departmentKey)}>
                <span>{group.name}</span>
                <div><b>{group.tasks.length}</b>{open ? <CaretUp size={17} /> : <CaretDown size={17} />}</div>
              </button>
              {open ? <div className="marketing-dashboard-department-tasks">
                {group.tasks.map((task: any) => <DashboardTaskCard
                  key={task.id}
                  task={task}
                  onOpen={() => setTaskId(task.id)}
                  onReceive={() => void receive(task.id)}
                  showReceive
                />)}
              </div> : null}
            </section>;
          }) : <div className="marketing-empty small">لا توجد تاسكات مطلوبة.</div>}
        </div>
      </section>

      <section className="marketing-kanban-column readiness marketing-dashboard-column">
        <header>
          <div><ClockCountdown size={23} /><div><h2>جاهزية المطلوب</h2><p>التاسكات المستلمة، مجمعة حسب الحملة والقسم.</p></div></div>
          <b>{readinessEntities.length}</b>
        </header>
        <div className="marketing-kanban-body">
          {readinessEntities.length ? readinessEntities.map((entity: any) => {
            const entityKey = `${entity.source_type}:${entity.id}`;
            const tasks = receivedBySource.get(entityKey) || [];
            const entityOpen = expandedEntities.includes(entityKey);
            const departments = new Map<string, { name: string; tasks: any[] }>();
            tasks.forEach((task: any) => {
              const departmentKey = task.department_id || task.department_name || "unknown";
              const current: { name: string; tasks: any[] } = departments.get(departmentKey) || { name: task.department_name || "قسم المحتوى", tasks: [] };
              current.tasks.push(task);
              departments.set(departmentKey, current);
            });

            return <article className={`marketing-readiness-card marketing-dashboard-entity ${entityOpen ? "open" : ""}`} key={entityKey}>
              <button type="button" className="marketing-readiness-head marketing-dashboard-entity-head" onClick={() => toggleList(setExpandedEntities, entityKey)}>
                <div>
                  <strong>{entity.name}</strong>
                  <small>{entity.code || (entity.source_type === "agenda" ? "أجندة" : "حملة")} · {Number(entity.progress || 0).toLocaleString("ar-SA", { maximumFractionDigits: 1 })}%</small>
                </div>
                <span className="marketing-dashboard-entity-count">{tasks.length}</span>
                {entityOpen ? <CaretUp size={18} /> : <CaretDown size={18} />}
              </button>
              <ProgressBar value={entity.progress} />

              {entityOpen ? <div className="marketing-dashboard-readiness-departments">
                {Array.from(departments.entries()).map(([departmentKey, group]) => {
                  const expansionKey = `${entityKey}:${departmentKey}`;
                  const open = expandedReadinessDepartments.includes(expansionKey);
                  const completed = group.tasks.filter((task: any) => Number(task.progress || 0) >= 100).length;
                  const progress = group.tasks.reduce((sum: number, task: any) => sum + taskProgress(task), 0) / Math.max(1, group.tasks.length);
                  return <section className={`marketing-dashboard-department readiness ${open ? "open" : ""}`} key={departmentKey}>
                    <button type="button" className="marketing-dashboard-department-head" onClick={() => toggleList(setExpandedReadinessDepartments, expansionKey)}>
                      <span>{group.name}</span>
                      <div><b>{completed}/{group.tasks.length} · {progress.toLocaleString("ar-SA", { maximumFractionDigits: 1 })}%</b>{open ? <CaretUp size={17} /> : <CaretDown size={17} />}</div>
                    </button>
                    {open ? <div className="marketing-dashboard-department-tasks">
                      {group.tasks.map((task: any) => <DashboardTaskCard key={task.id} task={task} onOpen={() => setTaskId(task.id)} />)}
                    </div> : null}
                  </section>;
                })}
              </div> : null}
            </article>;
          }) : <div className="marketing-empty small">لا توجد تاسكات مستلمة حتى الآن.</div>}
        </div>
      </section>

      <section className="marketing-kanban-column publishing"><header><div><PaperPlaneTilt size={23} /><h2>قسم النشر</h2></div><b>{data.entities.filter((item: any) => item.status === "publishing").length}</b></header><div className="marketing-kanban-body"><div className="marketing-empty small"><PaperPlaneTilt size={36} weight="duotone" /><span>قسم النشر سيتم تجهيزه في المرحلة اللاحقة.</span></div></div></section>
      <section className="marketing-kanban-column archive"><header><div><Archive size={23} /><h2>قسم الأرشيف</h2></div><b>{data.entities.filter((item: any) => item.status === "archived").length}</b></header><div className="marketing-kanban-body"><div className="marketing-empty small"><Archive size={36} weight="duotone" /><span>قسم الأرشيف سيتم تجهيزه في المرحلة اللاحقة.</span></div></div></section>
    </div>}
    <TaskDetailModal taskId={taskId} onClose={() => setTaskId(null)} onChanged={() => void load()} />
  </MarketingPage>;
}
