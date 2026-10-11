import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CaretDown, Eye, ListChecks, PaperPlaneTilt } from '@phosphor-icons/react';
import { W, Empty, MediaLabel, ProductViewButton, Readiness, Search, Status, WorkAlert, WorkHeader } from '../workflow/components';
import { showDate, showRange, useWorkQuery } from '../workflow/api';
import { TaskDetail } from '../workflow/TaskDetail';
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
  return <div className="mkw"><WorkHeader title={W.dashboard} onRefresh={() => void query.reload()} loading={query.loading}>{query.data?.capabilities.createTask && <Link className="mkw-link-button" to="/marketing/create">{W.createTask}</Link>}</WorkHeader><WorkAlert>{query.error}</WorkAlert>
    <div className="mkw-toolbar"><Search value={search} onChange={setSearch} /></div>
    <div className="mkw-board"><section className="mkw-column"><header><h2><ListChecks size={21} /> {W.execution}</h2><span>{tasks.length}</span></header><div className="mkw-column-body">
      {!tasks.length && <Empty>{query.loading ? W.loading : W.noData}</Empty>}
      {tasks.map(task => <article className="mkw-task-card" key={task.id}><header><div><span className="mkw-code">{task.task_no}</span><h3>{task.name}</h3></div><button type="button" className="icon-button" aria-label={W.open} onClick={() => openTask(task.id)}><Eye size={19} /></button></header>
        <div className="mkw-card-data"><div><small>{W.createdAt}</small><strong>{showDate(task.created_at)}</strong></div><div><small>{W.dueOn}</small><strong>{showRange(task.due_from, task.due_to)}</strong></div><div><small>{W.productCount}</small><strong>{task.product_count}</strong></div></div><Readiness value={task.readiness} />
        <button type="button" className="secondary" onClick={() => openTask(task.id)}>{W.open}</button>
      </article>)}
    </div></section>
    <section className="mkw-column"><header><h2><PaperPlaneTilt size={21} /> {W.publishingSection}</h2><span>{lines.length}</span></header><div className="mkw-column-body">
      {!groups.size && <Empty>{query.loading ? W.loading : W.noData}</Empty>}
      {[...groups.entries()].map(([id, group]) => <details className="mkw-plan-group" key={id} open={!!term}><summary><div><div className="mkw-code">{group[0].plan_no}</div><h3>{group[0].name}</h3><span className="mkw-muted">{group[0].kind === 'agenda' ? W.agenda : W.campaign} - {W.productCount}: {group.length}</span></div><CaretDown size={18} /></summary><div className="mkw-plan-lines">{group.map(line => <article key={line.id} className="mkw-plan-line"><div className="mkw-section-title"><strong>{line.idea_name}</strong><MediaLabel kind={line.media_kind} /></div><div className="mkw-section-title"><span className="mkw-muted">{line.kind === 'agenda' ? W.publishDate : W.fundingDate}: {showDate(line.scheduled_on)}</span><Status value={line.status} /></div><div className="mkw-actions"><ProductViewButton id={line.product_id} /><Link className="mkw-link-button" to={`/marketing/publish-prep?line=${encodeURIComponent(line.id)}`}>{W.prepare}</Link></div></article>)}</div></details>)}
    </div></section></div>
    {taskId && <TaskDetail id={taskId} onClose={() => setParams({})} onChanged={() => void query.reload()} />}
  </div>;
}
