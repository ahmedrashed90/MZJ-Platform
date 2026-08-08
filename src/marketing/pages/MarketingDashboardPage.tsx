import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import {
  Archive,
  CaretDown,
  CaretUp,
  CheckCircle,
  ClockCountdown,
  ListChecks,
  MagnifyingGlass,
  PaperPlaneTilt,
  Receipt,
  UserCircle,
} from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { marketingFetch, marketingQuery } from "../api";
import { MarketingAlert, MarketingPage, ProgressBar } from "../components/MarketingPage";
import { TaskDetailModal } from "../components/TaskDetailModal";

const DASHBOARD_LIVE_POLL_MS = 1000;

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

function formatProgress(value: unknown) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return `${safe.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

function sameAssignedUser(task: any) {
  const assignedId = String(task.assigned_to || "").trim();
  const contentId = String(task.paired_content_user_id || "").trim();
  if (assignedId && contentId) return assignedId === contentId;
  const assignedName = String(task.assigned_name || "").trim().toLocaleLowerCase("ar");
  const contentName = String(task.content_user_name || "").trim().toLocaleLowerCase("ar");
  return Boolean(assignedName && contentName && assignedName === contentName);
}

function assigneeColorStyle(value: unknown): CSSProperties | undefined {
  const color = String(value || "").trim();
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return undefined;
  const hex = match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return {
    borderColor: color,
    boxShadow: `5px 5px 0 ${color}, 0 8px 22px rgba(${red}, ${green}, ${blue}, .18)`,
  };
}

function DashboardTaskCard({
  task,
  onOpen,
  onReceive,
  onComplete,
  showReceive = false,
  completing = false,
}: {
  task: any;
  onOpen: () => void;
  onReceive?: () => void;
  onComplete?: () => void;
  showReceive?: boolean;
  completing?: boolean;
}) {
  const statusLabel = task.status === "completed"
    ? "منتهي"
    : task.status === "ready_to_complete"
      ? "جاهز للإنهاء"
      : templateStatusLabel(task.template_status);
  const statusClass = task.status === "completed" || task.status === "ready_to_complete" ? task.status : task.template_status || "not_started";
  const progress = taskProgress(task);
  const showContentWriter = Boolean(task.content_user_name) && !sameAssignedUser(task);

  return <article className="marketing-dashboard-task-card">
    <div className="marketing-dashboard-task-top">
      <span className={`marketing-dashboard-task-badge status-${statusClass}`}>{statusLabel || `${taskKindLabel(task)} - ${task.department_name || "القسم"}`}</span>
      <strong>{task.creative_name || task.title || "تاسك"}</strong>
    </div>
    <p className="marketing-dashboard-task-code">{task.campaign_code || task.source_name || "—"}</p>
    <div className="marketing-dashboard-task-progress">
      <span dir="ltr" title={`نسبة الاكتمال: ${formatProgress(progress)}`} aria-label={`نسبة الاكتمال ${formatProgress(progress)}`}>{formatProgress(progress)}</span>
      <ProgressBar value={progress} />
    </div>

    <div className="marketing-dashboard-assignees">
      <div className="marketing-dashboard-assignee">
        <span>المسؤول</span>
        <b style={assigneeColorStyle(task.assigned_user_color)}><UserCircle size={18} weight="fill" />{task.assigned_name || "—"}</b>
      </div>
      {showContentWriter ? <div className="marketing-dashboard-assignee content">
        <span>كاتب المحتوى</span>
        <b style={assigneeColorStyle(task.content_user_color)}><UserCircle size={18} weight="fill" />{task.content_user_name}</b>
      </div> : null}
    </div>

    <div className="marketing-dashboard-task-meta">
      <div><span>القسم</span><strong>{task.department_name || "—"}</strong></div>
      <div><span>الكرييتيف</span><strong>{task.creative_name || task.title || "—"}</strong></div>
    </div>

    <div className="marketing-dashboard-task-actions">
      <button type="button" className="secondary" onClick={onOpen}>تفاصيل</button>
      {showReceive && onReceive ? <button type="button" className="primary" onClick={onReceive}><CheckCircle size={17} />تم الاستلام</button> : null}
      {task.task_kind === "execution" && task.status !== "completed" && Boolean(task.received_at) && task.can_complete_task !== false && progress >= 100 && onComplete ? <button
        type="button"
        className="marketing-dashboard-complete-task"
        disabled={completing}
        onClick={onComplete}
      ><CheckCircle size={18} weight="fill" />{completing ? "جاري الإنهاء..." : "تم الانتهاء"}</button> : null}
    </div>
  </article>;
}

export function MarketingDashboardPage() {
  const [data, setData] = useState<any>({ required: [], received: [], completed: [], entities: [] });
  const [taskId, setTaskId] = useState<string | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [completedSearch, setCompletedSearch] = useState("");
  const [expandedRequired, setExpandedRequired] = useState<string[]>([]);
  const [expandedEntities, setExpandedEntities] = useState<string[]>([]);
  const [expandedReadinessDepartments, setExpandedReadinessDepartments] = useState<string[]>([]);
  const [movingEntityKey, setMovingEntityKey] = useState("");
  const [completingTaskId, setCompletingTaskId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const versionRef = useRef("");
  const loadInFlightRef = useRef(false);
  const pulseInFlightRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const payload = await marketingFetch<any>(`/api/marketing${marketingQuery({ resource: "dashboard" })}`);
      setData(payload);
      versionRef.current = String(payload.version || "");
    } catch (failure) {
      if (!silent) setError(failure instanceof Error ? failure.message : "تعذر تحميل الداش بورد");
    } finally {
      loadInFlightRef.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const refreshVisibleDashboard = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const pollVersion = async () => {
      if (document.visibilityState !== "visible" || pulseInFlightRef.current) return;
      pulseInFlightRef.current = true;
      try {
        const pulse = await marketingFetch<{ version?: string }>(`/api/marketing${marketingQuery({ resource: "dashboard_version" })}`);
        const nextVersion = String(pulse.version || "");
        if (nextVersion && nextVersion !== versionRef.current) await load(true);
      } catch {
        // Keep the dashboard usable if one background pulse fails.
      } finally {
        pulseInFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => void pollVersion(), DASHBOARD_LIVE_POLL_MS);
    window.addEventListener("focus", refreshVisibleDashboard);
    document.addEventListener("visibilitychange", refreshVisibleDashboard);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisibleDashboard);
      document.removeEventListener("visibilitychange", refreshVisibleDashboard);
    };
  }, [load]);

  async function receive(id: string) {
    try {
      await marketingFetch("/api/marketing", { method: "POST", body: JSON.stringify({ action: "receive_task", id }) });
      await load(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر استلام التاسك");
    }
  }

  async function moveToPublishing(entity: any) {
    const entityKey = `${entity.source_type}:${entity.id}`;
    setMovingEntityKey(entityKey);
    setError("");
    try {
      await marketingFetch("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "move_to_publishing", sourceType: entity.source_type, sourceId: entity.id }),
      });
      await load(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر نقل الحملة أو الأجندة إلى قسم النشر");
    } finally {
      setMovingEntityKey("");
    }
  }

  async function completeTask(task: any) {
    if (!task?.id || task.task_kind !== "execution" || task.status === "completed" || taskProgress(task) < 100) return;
    setCompletingTaskId(task.id);
    setError("");
    try {
      await marketingFetch("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "complete_task", taskId: task.id }),
      });
      if (taskId === task.id) setTaskId(null);
      await load(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر إنهاء التاسك");
    } finally {
      setCompletingTaskId("");
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
    () => (data.entities || []).filter((item: any) => item.status !== "publishing" && item.status !== "archived" && receivedBySource.has(`${item.source_type}:${item.id}`)),
    [data.entities, receivedBySource],
  );

  const publishingEntities = useMemo(
    () => (data.entities || []).filter((item: any) => item.status === "publishing"),
    [data.entities],
  );

  const canMoveToPublishing = useMemo(() => {
    const permissions = new Set<string>(Array.isArray(data.permissions) ? data.permissions : []);
    return permissions.has("marketing.publish_prep.manage") || permissions.has("marketing.campaign.edit") || permissions.has("marketing.agenda.edit");
  }, [data.permissions]);

  const completedTasks = useMemo(() => {
    const query = completedSearch.trim().toLocaleLowerCase("ar");
    const rows = Array.isArray(data.completed) ? data.completed : [];
    if (!query) return rows;
    return rows.filter((task: any) => [
      task.title,
      task.creative_name,
      task.source_name,
      task.campaign_code,
      task.department_name,
      task.assigned_name,
      task.completed_by_name,
    ].some((value) => String(value || "").toLocaleLowerCase("ar").includes(query)));
  }, [data.completed, completedSearch]);

  return <MarketingPage
    title="الداش بورد"
    description="متابعة المطلوب وجاهزية الحملات والأجندات داخل سيستم التسويق."
    actions={<button type="button" className="marketing-completed-tasks-trigger" onClick={() => setCompletedOpen(true)}><ListChecks size={20} weight="duotone" /><span>التاسكات المنتهية</span><b>{(data.completed || []).length.toLocaleString("ar-SA-u-nu-latn")}</b></button>}
  >
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
                <span className="marketing-dashboard-department-name">{group.name}</span>
                <div className="marketing-dashboard-department-controls">
                  <span className="marketing-dashboard-department-summary simple">{group.tasks.length} تاسك</span>
                  {open ? <CaretUp size={16} /> : <CaretDown size={16} />}
                </div>
              </button>
              {open ? <div className="marketing-dashboard-department-tasks">
                {group.tasks.map((task: any) => <DashboardTaskCard
                  key={task.id}
                  task={task}
                  onOpen={() => setTaskId(task.id)}
                  onReceive={() => void receive(task.id)}
                  onComplete={() => void completeTask(task)}
                  completing={completingTaskId === task.id}
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
                <div className="marketing-dashboard-entity-main">
                  <strong>{entity.name}</strong>
                  <small>{entity.code || (entity.source_type === "agenda" ? "أجندة" : "حملة")}</small>
                </div>
                <div className="marketing-dashboard-entity-stats">
                  <span>{tasks.length} تاسك</span>
                  <b dir="ltr">{formatProgress(entity.progress)}</b>
                </div>
                {entityOpen ? <CaretUp size={17} /> : <CaretDown size={17} />}
              </button>
              <ProgressBar value={entity.progress} />
              {Number(entity.progress || 0) >= 100 && entity.status === "ready_publish" ? <div className="marketing-dashboard-publish-transfer">
                <div><CheckCircle size={20} weight="fill" /><span><strong>اكتملت الحملة أو الأجندة بنسبة 100%</strong><small>انتهت كل التاسكات التنفيذية وأصبح الملف جاهزًا لقسم النشر.</small></span></div>
                <button type="button" disabled={!canMoveToPublishing || movingEntityKey === entityKey} onClick={() => void moveToPublishing(entity)} title={!canMoveToPublishing ? "لا توجد صلاحية للنقل إلى قسم النشر" : "نقل إلى قسم النشر"}>
                  <PaperPlaneTilt size={18} weight="fill" />{movingEntityKey === entityKey ? "جاري النقل..." : "نقل إلى قسم النشر"}
                </button>
              </div> : null}

              {entityOpen ? <div className="marketing-dashboard-readiness-departments">
                {Array.from(departments.entries()).map(([departmentKey, group]) => {
                  const expansionKey = `${entityKey}:${departmentKey}`;
                  const open = expandedReadinessDepartments.includes(expansionKey);
                  const completed = group.tasks.filter((task: any) => Number(task.progress || 0) >= 100).length;
                  const progress = group.tasks.reduce((sum: number, task: any) => sum + taskProgress(task), 0) / Math.max(1, group.tasks.length);
                  return <section className={`marketing-dashboard-department readiness ${open ? "open" : ""}`} key={departmentKey}>
                    <button type="button" className="marketing-dashboard-department-head" onClick={() => toggleList(setExpandedReadinessDepartments, expansionKey)}>
                      <span className="marketing-dashboard-department-name">{group.name}</span>
                      <div className="marketing-dashboard-department-controls">
                        <span className="marketing-dashboard-department-summary">
                          <small><span dir="ltr">{completed}/{group.tasks.length}</span> تاسك</small>
                          <strong dir="ltr">{formatProgress(progress)}</strong>
                        </span>
                        {open ? <CaretUp size={16} /> : <CaretDown size={16} />}
                      </div>
                    </button>
                    {open ? <div className="marketing-dashboard-department-tasks">
                      {group.tasks.map((task: any) => <DashboardTaskCard
                        key={task.id}
                        task={task}
                        onOpen={() => setTaskId(task.id)}
                        onComplete={() => void completeTask(task)}
                        completing={completingTaskId === task.id}
                      />)}
                    </div> : null}
                  </section>;
                })}
              </div> : null}
            </article>;
          }) : <div className="marketing-empty small">لا توجد تاسكات مستلمة حتى الآن.</div>}
        </div>
      </section>

      <section className="marketing-kanban-column publishing marketing-dashboard-column"><header><div><PaperPlaneTilt size={23} /><div><h2>قسم النشر</h2><p>الحملات والأجندات التي تم نقلها بعد اكتمالها بنسبة 100%.</p></div></div><b>{publishingEntities.length}</b></header><div className="marketing-kanban-body">{publishingEntities.length ? <div className="marketing-dashboard-publishing-list">{publishingEntities.map((entity: any) => <article key={`${entity.source_type}:${entity.id}`} className="marketing-dashboard-publishing-card"><div className="marketing-dashboard-publishing-icon"><PaperPlaneTilt size={22} weight="duotone" /></div><div><strong>{entity.name}</strong><small>{entity.code || (entity.source_type === "agenda" ? "أجندة" : "حملة")}</small></div><span>{entity.source_type === "agenda" ? "أجندة" : "حملة"}</span><b dir="ltr">{formatProgress(entity.progress)}</b><div className="marketing-dashboard-publishing-dates"><small>بداية النشر: {String(entity.publish_start || "—").slice(0,10)}</small><small>نهاية النشر: {String(entity.publish_end || "—").slice(0,10)}</small></div></article>)}</div> : <div className="marketing-empty small"><PaperPlaneTilt size={36} weight="duotone" /><span>لا توجد حملات أو أجندات منقولة إلى قسم النشر.</span></div>}</div></section>
      <section className="marketing-kanban-column archive"><header><div><Archive size={23} /><h2>قسم الأرشيف</h2></div><b>{data.entities.filter((item: any) => item.status === "archived").length}</b></header><div className="marketing-kanban-body"><div className="marketing-empty small"><Archive size={36} weight="duotone" /><span>قسم الأرشيف سيتم تجهيزه في المرحلة اللاحقة.</span></div></div></section>
    </div>}
    <Modal open={completedOpen} title="التاسكات المنتهية" subtitle="كل التاسكات التي تم إنهاؤها يدويًا بعد وصولها إلى 100%." onClose={() => setCompletedOpen(false)} className="marketing-completed-tasks-modal">
      <div className="marketing-completed-tasks-content">
        <label className="marketing-completed-tasks-search"><MagnifyingGlass size={19} /><input value={completedSearch} onChange={(event) => setCompletedSearch(event.target.value)} placeholder="بحث باسم الحملة أو التاسك أو المسؤول..." /></label>
        <div className="marketing-completed-tasks-summary"><span>إجمالي التاسكات المنتهية</span><strong>{(data.completed || []).length.toLocaleString("ar-SA-u-nu-latn")}</strong></div>
        <div className="marketing-completed-tasks-list">
          {completedTasks.length ? completedTasks.map((task: any) => <button type="button" key={task.id} onClick={() => { setCompletedOpen(false); setTaskId(task.id); }}>
            <div className="marketing-completed-task-title"><CheckCircle size={21} weight="fill" /><span><strong>{task.creative_name || task.title || "تاسك"}</strong><small>{task.source_name || task.campaign_code || "—"}</small></span></div>
            <div className="marketing-completed-task-meta">
              <span><small>القسم</small><strong>{task.department_name || "—"}</strong></span>
              <span><small>المسؤول</small><strong>{task.assigned_name || "—"}</strong></span>
              <span><small>أنهى التاسك</small><strong>{task.completed_by_name || "—"}</strong></span>
              <span><small>تاريخ الإنهاء</small><strong>{task.completed_at ? new Date(task.completed_at).toLocaleString("ar-SA-u-nu-latn") : "—"}</strong></span>
            </div>
          </button>) : <div className="marketing-empty small">لا توجد تاسكات منتهية مطابقة للبحث.</div>}
        </div>
      </div>
    </Modal>
    <TaskDetailModal taskId={taskId} onClose={() => setTaskId(null)} onChanged={() => void load(true)} />
  </MarketingPage>;
}
