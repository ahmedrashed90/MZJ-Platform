import { useState } from 'react';
import { W, Empty, MediaLabel, ProductViewButton, Search, WorkAlert, WorkHeader } from '../workflow/components';
import { useWorkQuery } from '../workflow/api';
import type { WorkProduct } from '../../../shared/marketing-workflow';
export function ProductsPage() {
  const [search, setSearch] = useState(''), query = useWorkQuery<{ rows: WorkProduct[] }>('products');
  const term = search.trim().toLocaleLowerCase();
  const rows = (query.data?.rows || []).filter(product => `${product.statement} ${product.idea_name} ${product.task_no}`.toLocaleLowerCase().includes(term));
  return <div className="mkw"><WorkHeader title={W.products} onRefresh={() => void query.reload()} loading={query.loading} /><WorkAlert>{query.error}</WorkAlert><div className="mkw-toolbar"><Search value={search} onChange={setSearch} /></div><div className="mkw-table-wrap"><table><thead><tr><th>{W.statement}</th><th>{W.ideaName}</th><th>{W.viewProduct}</th></tr></thead><tbody>{rows.map(product => <tr key={product.id}><td className="mkw-table-title">{product.task_name}<small className="mkw-code">{product.task_no}</small><MediaLabel kind={product.media_kind} /></td><td>{product.idea_name}</td><td><ProductViewButton id={product.id} /></td></tr>)}</tbody></table>{!rows.length && <Empty>{query.loading ? W.loading : W.noData}</Empty>}</div></div>;
}
