import { useEffect, useMemo, useState } from "react";
import { ChartBar, FileCsv, FunnelSimple } from "@phosphor-icons/react";
import { marketingFetch } from "../api";
import type { CampaignRow, DashboardResponse, DashboardTask } from "../types";
import { Alert, Empty, marketingStatusLabel, PageHead, ProgressBar } from "../components/Ui";

function download(name: string, rows: Array<Array<string | number>>) {
  const text = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = name;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

type DepartmentReport = { id: string; name: string; tasks: number; progress: number };
type EmployeeReport = { id: string; name: string; tasks: number; completed: number; late: number; progress: number };

function isLate(task: DashboardTask, now: Date) {
  return Boolean(task.due_date && new Date(task.due_date) < now && task.progress < 100);
}

type CampaignsResponse = { ok: boolean; rows: CampaignRow[]; total: number };

export function MarketingReportsPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [campaignRows, setCampaignRows] = useState<CampaignRow[]>([]);
  const [error, setError] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    Promise.all([
      marketingFetch<DashboardResponse>("/api/marketing?resource=dashboard"),
      marketingFetch<CampaignsResponse>("/api/marketing?resource=campaigns&pageSize=500"),
    ])
      .then(([dashboard, campaigns]) => { setData(dashboard); setCampaignRows(campaigns.rows); })
      .catch((failure) => setError(failure instanceof Error ? failure.message : "تعذر تحميل التقارير"));
  }, []);

  const sourceTasks = data?.tasks ?? [];
  const departments = useMemo(() => {
    const rows = new Map<string, string>();
    sourceTasks.forEach((task) => rows.set(task.department_id, task.department_name));
    return [...rows.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [sourceTasks]);
  const employees = useMemo(() => {
    const rows = new Map<string, string>();
    sourceTasks.forEach((task) => rows.set(task.assigned_to, task.assigned_to_name));
    return [...rows.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [sourceTasks]);
  const statuses = useMemo(() => [...new Set(sourceTasks.map((task) => task.status))].sort(), [sourceTasks]);

  const tasks = useMemo(() => sourceTasks.filter((task) => {
    if (departmentId && task.department_id !== departmentId) return false;
    if (employeeId && task.assigned_to !== employeeId) return false;
    if (status && task.status !== status) return false;
    const comparisonDate = task.actual_received_at || task.due_date;
    if (from && (!comparisonDate || comparisonDate.slice(0, 10) < from)) return false;
    if (to && (!comparisonDate || comparisonDate.slice(0, 10) > to)) return false;
    return true;
  }), [departmentId, employeeId, from, sourceTasks, status, to]);

  const now = useMemo(() => new Date(), [data, departmentId, employeeId, status, from, to]);
  const lateTasks = useMemo(() => tasks.filter((task) => isLate(task, now)), [now, tasks]);
  const byStatus = useMemo(() => {
    const result = new Map<string, number>();
    tasks.forEach((task) => result.set(task.status, (result.get(task.status) ?? 0) + 1));
    return [...result.entries()];
  }, [tasks]);
  const byDepartment = useMemo<DepartmentReport[]>(() => {
    const result = new Map<string, DepartmentReport>();
    tasks.forEach((task) => {
      const current = result.get(task.department_id) ?? { id: task.department_id, name: task.department_name, tasks: 0, progress: 0 };
      current.tasks += 1;
      current.progress += task.progress;
      result.set(task.department_id, current);
    });
    return [...result.values()].map((row) => ({ ...row, progress: row.tasks ? row.progress / row.tasks : 0 }));
  }, [tasks]);
  const byEmployee = useMemo<EmployeeReport[]>(() => {
    const result = new Map<string, EmployeeReport>();
    tasks.forEach((task) => {
      const current = result.get(task.assigned_to) ?? { id: task.assigned_to, name: task.assigned_to_name, tasks: 0, completed: 0, late: 0, progress: 0 };
      current.tasks += 1;
      current.completed += task.progress >= 100 ? 1 : 0;
      current.late += isLate(task, now) ? 1 : 0;
      current.progress += task.progress;
      result.set(task.assigned_to, current);
    });
    return [...result.values()].map((row) => ({ ...row, progress: row.tasks ? row.progress / row.tasks : 0 }));
  }, [now, tasks]);
  const visibleCampaignIds = useMemo(() => new Set(tasks.map((task) => task.campaign_id)), [tasks]);
  const campaignProgress = useMemo(() => {
    const dashboardCards = new Map([...(data?.readiness ?? []), ...(data?.publishing ?? [])].map((campaign) => [campaign.id, campaign]));
    return campaignRows
      .filter((campaign) => {
        if ((departmentId || employeeId || status || from || to) && !visibleCampaignIds.has(campaign.id)) return false;
        return true;
      })
      .map((campaign) => dashboardCards.get(campaign.id) ?? {
        id: campaign.id, name: campaign.name, code: campaign.campaign_code, sourceKind: campaign.source_kind,
        workflowStage: campaign.workflow_stage, progress: 0, taskCount: campaign.tasks_count, departmentCount: 0,
      });
  }, [campaignRows, data, departmentId, employeeId, from, status, to, visibleCampaignIds]);

  function resetFilters() {
    setDepartmentId("");
    setEmployeeId("");
    setStatus("");
    setFrom("");
    setTo("");
  }

  function exportReport() {
    download("marketing-report.csv", [
      ["الموظف", "التاسكات", "المكتملة", "المتأخرة", "متوسط التقدم"],
      ...byEmployee.map((row) => [row.name, row.tasks, row.completed, row.late, Math.round(row.progress)]),
    ]);
  }

  return (
    <div className="marketing-page">
      <PageHead
        title="التقارير"
        description="متابعة الحملات والتاسكات والتأخير وأداء الأقسام والموظفين."
        actions={<button className="marketing-button secondary" type="button" onClick={exportReport}><FileCsv size={17} />تصدير التقرير</button>}
      />
      {error ? <Alert type="error">{error}</Alert> : null}

      <div className="marketing-filter-bar">
        <FunnelSimple size={20} />
        <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">كل الأقسام</option>{departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">كل الموظفين</option>{employees.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">كل الحالات</option>{statuses.map((value) => <option key={value} value={value}>{marketingStatusLabel(value)}</option>)}</select>
        <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="من تاريخ" />
        <input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="إلى تاريخ" />
        <button type="button" onClick={resetFilters}>إعادة ضبط</button>
      </div>

      <section className="marketing-report-overview">
        <div><small>نظرة عامة</small><h2>متابعة الحملات والتاسكات</h2><p>{campaignProgress.length} حملة · {tasks.length} تاسك · {lateTasks.length} متأخر</p></div>
        <b>{tasks.length ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length) : 0}%</b>
      </section>

      <div className="marketing-summary-cards">
        <div><span>إجمالي الحملات</span><b>{campaignProgress.length}</b></div>
        <div><span>إجمالي التاسكات</span><b>{tasks.length}</b></div>
        <div><span>التاسكات المتأخرة</span><b>{lateTasks.length}</b></div>
        <div><span>قائمة الانتظار</span><b>{tasks.filter((task) => !task.actual_received_at).length}</b></div>
        <div><span>التاسكات النشطة</span><b>{tasks.filter((task) => task.status === "active").length}</b></div>
      </div>

      <div className="marketing-report-grid">
        <section>
          <h3><ChartBar size={20} />عدد التاسكات في كل حالة</h3>
          {byStatus.map(([taskStatus, count]) => <div className="marketing-report-line" key={taskStatus}><span>{marketingStatusLabel(taskStatus)}</span><b>{count} تاسك</b><ProgressBar value={tasks.length ? (count / tasks.length) * 100 : 0} /></div>)}
          {!byStatus.length ? <Empty text="لا توجد بيانات مطابقة للفلاتر." /> : null}
        </section>
        <section>
          <h3>التاسكات المتأخرة</h3>
          {lateTasks.map((task) => <article key={task.id}><b>{task.task_no}</b><span>{task.assigned_to_name}</span><small>{task.creative_name}</small></article>)}
          {!lateTasks.length ? <Empty text="لا توجد تاسكات متأخرة." /> : null}
        </section>
        <section>
          <h3>أداء كل قسم</h3>
          {byDepartment.map((row) => <div className="marketing-report-line" key={row.id}><span>{row.name}</span><b>{row.tasks} تاسك</b><ProgressBar value={row.progress} /></div>)}
        </section>
        <section>
          <h3>نسبة اكتمال كل حملة</h3>
          {campaignProgress.map((row) => <div className="marketing-report-line" key={row.id}><span>{row.name}</span><b>{row.taskCount} تاسك</b><ProgressBar value={row.progress} /></div>)}
        </section>
        <section className="wide">
          <h3>أداء كل موظف</h3>
          <div className="marketing-table-wrap"><table className="marketing-table"><thead><tr><th>الموظف</th><th>التاسكات</th><th>المكتملة</th><th>المتأخرة</th><th>متوسط التقدم</th></tr></thead><tbody>{byEmployee.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.tasks}</td><td>{row.completed}</td><td>{row.late}</td><td><ProgressBar value={row.progress} /></td></tr>)}</tbody></table></div>
        </section>
      </div>
    </div>
  );
}
