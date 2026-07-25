import { useEffect, useMemo, useState } from "react";
import { Archive, CheckCircle, ClockCountdown, PaperPlaneTilt, Receipt } from "@phosphor-icons/react";
import { marketingFetch, marketingQuery } from "../api";
import { MarketingAlert, MarketingPage, ProgressBar } from "../components/MarketingPage";
import { TaskDetailModal } from "../components/TaskDetailModal";

export function MarketingDashboardPage() {
  const [data, setData] = useState<any>({ required: [], received: [], entities: [], permissions: [] });
  const [taskId, setTaskId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [movingId, setMovingId] = useState("");
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

  async function moveToPublishing(sourceType: string, id: string) {
    setMovingId(id);
    setError("");
    try {
      await marketingFetch("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "move_to_publishing", sourceType, id }),
      });
      if (expanded === `${sourceType}:${id}`) setExpanded(null);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر النقل إلى قسم النشر");
    } finally {
      setMovingId("");
    }
  }

  const receivedBySource = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const task of data.received || []) {
      const key = `${task.source_type}:${task.source_id}`;
      map.set(key, [...(map.get(key) || []), task]);
    }
    return map;
  }, [data.received]);

  const readinessEntities = useMemo(() => (data.entities || []).filter((item: any) => {
    const key = `${item.source_type}:${item.id}`;
    return receivedBySource.has(key) && !["publishing", "archived"].includes(item.status);
  }), [data.entities, receivedBySource]);

  const publishingEntities = useMemo(
    () => (data.entities || []).filter((item: any) => item.status === "publishing"),
    [data.entities],
  );

  const canMoveToPublishing = Array.isArray(data.permissions) && data.permissions.includes("marketing.publish_prep.manage");

  return (
    <MarketingPage title="الداش بورد" description="متابعة المطلوب وجاهزية الحملات والأجندات داخل سيستم التسويق.">
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {loading ? <div className="marketing-empty">جاري تحميل الداش بورد...</div> : (
        <div className="marketing-kanban">
          <section className="marketing-kanban-column required">
            <header><div><Receipt size={23} /><h2>TASK - المطلوب</h2></div><b>{data.required.length}</b></header>
            <div className="marketing-kanban-body">
              {data.required.length ? data.required.map((task: any) => (
                <article className="marketing-task-card" key={task.id}>
                  <div className="marketing-task-card-top"><span>{task.department_name || "قسم المحتوى"}</span><small>{task.task_kind === "task_template" ? "Task Template" : "تاسك تنفيذي"}</small></div>
                  <h3>{task.title}</h3>
                  <p>{task.source_name}</p>
                  <div className="marketing-card-meta"><span>المسؤول: <b>{task.assigned_name || "—"}</b></span><span>التسليم: <b>{String(task.due_at || "—").slice(0, 10)}</b></span></div>
                  <div className="marketing-task-card-actions"><button type="button" className="secondary" onClick={() => setTaskId(task.id)}>التفاصيل</button><button type="button" className="primary" onClick={() => void receive(task.id)}><CheckCircle size={16} />تم الاستلام</button></div>
                </article>
              )) : <div className="marketing-empty small">لا توجد تاسكات مطلوبة.</div>}
            </div>
          </section>

          <section className="marketing-kanban-column readiness">
            <header><div><ClockCountdown size={23} /><h2>جاهزية المطلوب</h2></div><b>{readinessEntities.length}</b></header>
            <div className="marketing-kanban-body">
              {readinessEntities.length ? readinessEntities.map((entity: any) => {
                const key = `${entity.source_type}:${entity.id}`;
                const tasks = receivedBySource.get(key) || [];
                const departments = new Map<string, any[]>();
                tasks.forEach((task: any) => {
                  const name = task.department_name || "قسم المحتوى";
                  departments.set(name, [...(departments.get(name) || []), task]);
                });
                const ready = Number(entity.progress || 0) >= 100;
                return (
                  <article className="marketing-readiness-card" key={key}>
                    <button type="button" className="marketing-readiness-head" onClick={() => setExpanded(expanded === key ? null : key)}>
                      <div><strong>{entity.name}</strong><small>{entity.code || (entity.source_type === "agenda" ? "أجندة" : "حملة")}</small></div>
                      <span>{Number(entity.progress || 0).toLocaleString("ar-SA", { maximumFractionDigits: 1 })}%</span>
                    </button>
                    <ProgressBar value={entity.progress} />
                    {ready && canMoveToPublishing ? (
                      <button type="button" className="marketing-move-publishing" disabled={movingId === entity.id} onClick={() => void moveToPublishing(entity.source_type, entity.id)}>
                        <PaperPlaneTilt size={17} />{movingId === entity.id ? "جاري النقل..." : "نقل إلى قسم النشر"}
                      </button>
                    ) : null}
                    {expanded === key ? (
                      <div className="marketing-department-progress">
                        {Array.from(departments.entries()).map(([name, departmentTasks]) => {
                          const progress = departmentTasks.reduce((sum: number, item: any) => sum + Number(item.progress || 0), 0) / Math.max(1, departmentTasks.length);
                          return (
                            <section key={name}>
                              <div><strong>{name}</strong><span>{departmentTasks.filter((item: any) => Number(item.progress) >= 100).length} / {departmentTasks.length}</span></div>
                              <ProgressBar value={progress} />
                              {departmentTasks.map((task: any) => <button key={task.id} type="button" onClick={() => setTaskId(task.id)}><span>{task.title}</span><b>{Number(task.progress || 0).toLocaleString("ar-SA")}%</b></button>)}
                            </section>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              }) : <div className="marketing-empty small">لا توجد حملات أو أجندات في الجاهزية.</div>}
            </div>
          </section>

          <section className="marketing-kanban-column publishing">
            <header><div><PaperPlaneTilt size={23} /><h2>قسم النشر</h2></div><b>{publishingEntities.length}</b></header>
            <div className="marketing-kanban-body">
              {publishingEntities.length ? publishingEntities.map((entity: any) => (
                <article className="marketing-publishing-card" key={`${entity.source_type}:${entity.id}`}>
                  <div><strong>{entity.name}</strong><small>{entity.code || (entity.source_type === "agenda" ? "أجندة" : "حملة")}</small></div>
                  <span>جاهزية {Number(entity.progress || 0).toLocaleString("ar-SA", { maximumFractionDigits: 1 })}%</span>
                  <ProgressBar value={entity.progress} />
                </article>
              )) : <div className="marketing-empty small"><PaperPlaneTilt size={36} weight="duotone" /><span>لا توجد حملات أو أجندات منقولة إلى قسم النشر.</span></div>}
            </div>
          </section>

          <section className="marketing-kanban-column archive">
            <header><div><Archive size={23} /><h2>قسم الأرشيف</h2></div><b>{data.entities.filter((item: any) => item.status === "archived").length}</b></header>
            <div className="marketing-kanban-body"><div className="marketing-empty small"><Archive size={36} weight="duotone" /><span>قسم الأرشيف سيتم تجهيزه في المرحلة اللاحقة.</span></div></div>
          </section>
        </div>
      )}
      <TaskDetailModal taskId={taskId} onClose={() => setTaskId(null)} onChanged={() => void load()} />
    </MarketingPage>
  );
}
