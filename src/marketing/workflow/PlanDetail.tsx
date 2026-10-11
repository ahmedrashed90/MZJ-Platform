import { Link } from 'react-router-dom';
import { Modal } from '../../components/Modal';
import { W, Empty, ProductViewButton, Status, WorkAlert } from './components';
import { showDate, useWorkQuery } from './api';
import type { WorkPlanLine } from '../../../shared/marketing-workflow';
export function PlanDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useWorkQuery<{ plan: { plan_no: string; name: string; kind: 'agenda' | 'campaign' }; lines: WorkPlanLine[] }>('plan', { id });
  return <Modal open title={query.data?.plan.name || W.view} onClose={onClose} className="mkw-modal"><div className="mkw"><WorkAlert>{query.error}</WorkAlert>{!query.data ? <Empty>{query.loading ? W.loading : W.noData}</Empty> : <><div className="mkw-section-title"><strong>{query.data.plan.plan_no}</strong><Status value={query.data.plan.kind === 'agenda' ? W.agenda : W.campaign} /></div><div className="mkw-table-wrap"><table><thead><tr><th>{query.data.plan.kind === 'agenda' ? W.publishDate : W.fundingDate}</th><th>{W.ideaName}</th><th>{W.taskNo}</th><th>{W.status}</th><th>{W.view}</th></tr></thead><tbody>{query.data.lines.map(line => <tr key={line.id}><td>{showDate(line.scheduled_on)}</td><td>{line.idea_name}</td><td><span className="mkw-code">{line.task_no}</span></td><td><Status value={line.status} /></td><td><div className="mkw-actions"><ProductViewButton id={line.product_id} /><Link className="mkw-link-button" to={`/marketing/publish-prep?line=${encodeURIComponent(line.id)}`} onClick={onClose}>{W.prepare}</Link></div></td></tr>)}</tbody></table></div></>}</div></Modal>;
}
