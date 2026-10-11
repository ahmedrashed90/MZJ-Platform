import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { W, Empty, Readiness, Search, Status, WorkAlert, WorkHeader } from '../workflow/components';
import { showDate, showRange, useWorkQuery } from '../workflow/api';
import { TaskDetail } from '../workflow/TaskDetail';
import { PlanDetail } from '../workflow/PlanDetail';
import { marketingFetch, marketingQuery } from '../api';

type DatabaseRow = { id: string; kind: 'task' | 'agenda' | 'campaign'; code: string; name: string; created_at: string; date_from: string | null; date_to: string | null; product_count: number; status: string; readiness: number | null; legacy?: boolean };
export function MarketingDatabasePage() {
  const query = useWorkQuery<{ rows: DatabaseRow[] }>('database');
  const [type, setType] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const [selected, setSelected] = useState<DatabaseRow | null>(null), [legacy, setLegacy] = useState<any>(null), [error, setError] = useState('');
  const term = search.trim().toLocaleLowerCase();
  const rows = (query.data?.rows || []).filter(row => (!type || row.kind === type) && `${row.name} ${row.code}`.toLocaleLowerCase().includes(term));
  const maxPage = Math.max(0, Math.ceil(rows.length / 30) - 1), currentPage = Math.min(page, maxPage), visible = rows.slice(currentPage * 30, currentPage * 30 + 30);
  const kindName = (value: string) => value === 'task' ? W.task : value === 'agenda' ? W.agenda : W.campaign;
  async function open(row: DatabaseRow) {
    setError(''); setSelected(row); setLegacy(null);
    if (row.legacy) try { setLegacy(await marketingFetch<any>(`/api/marketing${marketingQuery({ resource: 'entity', sourceType: row.kind, id: row.id })}`)); }
    catch (e) { setError(e instanceof Error ? e.message : W.invalid); }
  }
  return <div className="mkw"><WorkHeader title={W.database} onRefresh={() => void query.reload()} loading={query.loading} /><WorkAlert>{query.error}</WorkAlert><div className="mkw-toolbar"><Search value={search} onChange={value => { setSearch(value); setPage(0); }} /><select aria-label={W.type} value={type} onChange={event => { setType(event.target.value); setPage(0); }}><option value="">{W.all}</option><option value="task">{W.task}</option><option value="agenda">{W.agenda}</option><option value="campaign">{W.campaign}</option></select></div>
    <div className="mkw-table-wrap"><table><thead><tr><th>{W.number}</th><th>{W.name}</th><th>{W.type}</th><th>{W.createdAt}</th><th>{W.dueOn} / {W.publishDate} / {W.fundingDate}</th><th>{W.productCount}</th><th>{W.readiness}</th><th>{W.status}</th><th>{W.view}</th></tr></thead><tbody>{visible.map(row => <tr key={`${row.kind}:${row.id}`}><td><span className="mkw-code">{row.code}</span></td><td className="mkw-table-title">{row.name}</td><td>{kindName(row.kind)}</td><td>{showDate(row.created_at)}</td><td>{showRange(row.date_from, row.date_to)}</td><td>{row.product_count}</td><td>{row.kind === 'task' ? <Readiness value={row.readiness || 0} /> : '\u2014'}</td><td><Status value={row.status} /></td><td><button type="button" className="secondary" onClick={() => void open(row)}>{W.open}</button></td></tr>)}</tbody></table>{!visible.length && <Empty>{query.loading ? W.loading : W.noData}</Empty>}</div>
    {rows.length > 30 && <footer className="mkw-section-title"><span>{currentPage + 1} / {maxPage + 1}</span><div className="mkw-actions"><button type="button" className="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{W.previous}</button><button type="button" className="secondary" disabled={currentPage === maxPage} onClick={() => setPage(currentPage + 1)}>{W.next}</button></div></footer>}
    {selected && !selected.legacy && (selected.kind === 'task' ? <TaskDetail id={selected.id} onClose={() => setSelected(null)} onChanged={() => void query.reload()} /> : <PlanDetail id={selected.id} onClose={() => setSelected(null)} />)}
    {selected?.legacy && <Modal open title={selected.name} onClose={() => setSelected(null)} className="mkw-modal"><div className="mkw"><WorkAlert>{error}</WorkAlert><div className="mkw-summary"><div><small>{W.number}</small><strong>{selected.code}</strong></div><div><small>{W.type}</small><strong>{kindName(selected.kind)}</strong></div><div><small>{W.createdAt}</small><strong>{showDate(selected.created_at)}</strong></div><div><small>{W.status}</small><Status value={selected.status} /></div></div>{!legacy && !error ? <Empty>{W.loading}</Empty> : (legacy?.tasks || []).map((task: any) => <article key={task.id} className="mkw-task-card"><h3>{task.title || task.creative_name || W.task}</h3><span className="mkw-muted">{task.assigned_to_name || task.assignee_name || task.user_name || ''}</span><Status value={task.status} /><p>{task.note}</p></article>)}</div></Modal>}
  </div>;
}
