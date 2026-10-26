import { useState } from 'react';
import { W, Empty, MediaLabel, ProductViewButton, Search, WorkAlert, WorkHeader } from '../workflow/components';
import { useWorkQuery } from '../workflow/api';
import type { WorkProduct } from '../../../shared/marketing-workflow';

/** Display the actual product approval timestamp in MZJ's business timezone. */
function approvalDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';
}

export function ProductsPage() {
  const [search, setSearch] = useState('');
  const query = useWorkQuery<{ rows: WorkProduct[] }>('products');
  const term = search.trim().toLocaleLowerCase();
  const rows = (query.data?.rows || []).filter(product =>
    `${product.statement} ${product.idea_name} ${product.task_no}`.toLocaleLowerCase().includes(term));

  return <div className="mkw">
    <WorkHeader title={W.products} onRefresh={() => void query.reload()} loading={query.loading} />
    <WorkAlert>{query.error}</WorkAlert>
    <div className="mkw-toolbar"><Search value={search} onChange={setSearch} /></div>
    <div className="mkw-table-wrap">
      <table>
        <thead><tr>
          <th>مسلسل</th>
          <th>تاريخ اعتماد المنتج</th>
          <th>{W.statement}</th>
          <th>{W.ideaName}</th>
          <th>اسم المنفذ</th>
          <th>{W.viewProduct}</th>
        </tr></thead>
        <tbody>{rows.map((product, index) => {
          const approvedAt = product.approved_at || product.released_at;
          return <tr key={product.id}>
            <td><span className="mkw-code">{index + 1}</span></td>
            <td><time dateTime={approvedAt || undefined} dir="ltr" style={{ display: 'inline-block', direction: 'ltr', unicodeBidi: 'isolate', whiteSpace: 'nowrap' }}>{approvalDate(approvedAt)}</time></td>
            <td className="mkw-table-title">{product.task_name}<small className="mkw-code">{product.task_no}</small><MediaLabel kind={product.media_kind} /></td>
            <td>{product.idea_name}</td>
            <td>{product.assignee_name || '—'}</td>
            <td><ProductViewButton id={product.id} /></td>
          </tr>;
        })}</tbody>
      </table>
      {!rows.length && <Empty>{query.loading ? W.loading : W.noData}</Empty>}
    </div>
  </div>;
}
