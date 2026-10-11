import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CaretDown, CaretLeft, ClipboardText, Eye, PaperPlaneTilt, Plus } from '@phosphor-icons/react';
import { W, Empty, MediaLabel, ProductViewButton, Readiness, Search, Status, WorkAlert, WorkHeader } from '../workflow/components';
import { showDate, showRange, useWorkQuery } from '../workflow/api';
import { TaskDetail } from '../workflow/TaskDetail';
import { DeleteTaskButton } from '../workflow/DeleteTaskButton';
import type { WorkCapabilities, WorkPlanLine, WorkTask } from '../../../shared/marketing-workflow';

export function MarketingDashboardPage() {
  const [params, setParams] = useSearchParams(), [search, setSearch] = useState('');
  const query = useWorkQuery<{ tasks: WorkTask[]; lines: WorkPlanLine[]; capabilities: WorkCapabilities }>('dashboard');
  const taskId = params.get('task') || '';
  const term = search.trim().toLocaleLowerCase();
  const tasks = (query.data?.tasks || []).filter(task => `${task.name} ${task.task_no} ${task.type_name}`.toLocaleLowerCase().includes(term));
  const lines = (query.data?.lines || []).filter(line => `${line.name} ${line.plan_no} ${line.idea_name} ${line.task_name}`.toLocaleLowerCase().includes(term));
  const groups = new Map<string, WorkPlanLine[]>();
  for (const line of lines) groups.set(line.plan_id, [...(groups.get(line.plan_id) || []), line]);
  function openTask(id: string) { setParams({ task: id }); }
  return <div className="mkw mkw-dashboard"><WorkHeader title={W.dashboard} onRefresh={() => void query.reload()} loading={query.loading}>{query.data?.capabilities.createTask && <Link className="mkw-link-button" to="/marketing/create"><Plus size={17} />{W.createTask}</Link>}</WorkHeader><WorkAlert>{query.error}</WorkAlert>
    <div className="mkw-toolbar mkw-dashboard-search"><Search value={search} onChange={setSearch} /></div>
    <div className="mkw-board mkw-dashboard-board">
      <section className="mkw-column"><header><div className="mkw-column-title"><ClipboardText size={21} /><h2>{W.execution}</h2></div><span>{tasks.length}</span></header>
        <div className="mkw-column-body">{!tasks.length && <Empty>{query.loading ? W.loading : W.noData}</Empty>}
          {tasks.map(task => <article className="mkw-dashboard-task" key={task.id}>
            <div className="mkw-dashboard-task-heading"><div><span className="mkw-code">{task.task_no}</span><h3>{task.name}</h3></div><div className="mkw-dashboard-task-buttons"><button type="button" className="mkw-dashboard-view" aria-label={`${W.open} ${task.name}`} onClick={() => openTask(task.id)}><Eye size={20} /></button><DeleteTaskButton compact id={task.id} name={task.name} code={task.task_no} onDeleted={() => query.reload()} /></div></div>
            <div className="mkw-dashboard-stats"><div><small>{W.createdAt}</small><strong>{showDate(task.created_at)}</strong></div><div><small>{W.dueOn}</small><strong>{showRange(task.due_from, task.due_to)}</strong></div><div><small>{W.productCount}</small><strong>{task.product_count}</strong></div></div>
            <Readiness value={task.readiness} />
            <div className="mkw-delivery-summary" aria-label="مواعيد تسليم المطلوبات">
              <div className="mkw-delivery-summary-card is-on-time"><span>{W.deliveryOnTime}</span><strong>{task.submitted_on_time_count ?? 0}</strong></div>
              <div className="mkw-delivery-summary-card is-late"><span>{W.deliveryLate}</span><strong>{task.submitted_late_count ?? 0}</strong></div>
            </div>
            <button type="button" className="mkw-dashboard-open" onClick={() => openTask(task.id)}>{W.open}<CaretLeft size={16} /></button>
          </article>)}
        </div>
      </section>
      <section className="mkw-column"><header><div className="mkw-column-title"><PaperPlaneTilt size={21} /><h2>{W.publishingSection}</h2></div><span>{lines.length}</span></header>
        <div className="mkw-column-body">{!groups.size && <Empty>{query.loading ? W.loading : W.noData}</Empty>}
          {[...groups.entries()].map(([id, group]) => <details className="mkw-plan-group mkw-dashboard-plan" key={id} open={lines.length < 18}><summary><div><span className="mkw-code">{group[0].plan_no}</span><h3>{group[0].name}</h3><span className="mkw-muted">{group[0].kind === 'agenda' ? W.agenda : W.campaign} · {W.productCount}: {group.length}</span></div><CaretDown size={18} /></summary>
            <div className="mkw-plan-lines">{group.map(line => <article key={line.id} className="mkw-plan-line mkw-dashboard-line"><div className="mkw-plan-row"><div><strong>{line.idea_name}</strong><span className="mkw-muted">{line.task_name}</span></div><MediaLabel kind={line.media_kind} /></div><div className="mkw-plan-row"><span className="mkw-muted">{line.kind === 'agenda' ? W.publishDate : W.fundingDate}: {showDate(line.scheduled_on)}</span><Status value={line.status} /></div><div className="mkw-plan-row mkw-plan-cta"><ProductViewButton id={line.product_id} /><Link className="mkw-link-button" to={`/marketing/publish-prep?line=${encodeURIComponent(line.id)}`}><PaperPlaneTilt size={17} />{W.prepare}</Link></div></article>)}</div>
          </details>)}
        </div>
      </section>
    </div>
    {taskId && <TaskDetail id={taskId} onClose={() => setParams({})} onChanged={() => void query.reload()} />}
  </div>;
}
