import { useState } from 'react';
import { W, Empty, MediaLabel, ProductViewButton, Search, WorkAlert, WorkHeader } from '../workflow/components';
import { useWorkQuery, workPost } from '../workflow/api';
import type { WorkProduct } from '../../../shared/marketing-workflow';
import { ProductReference } from '../workflow/ProductReference';
import { StrategyProductsTab } from '../workflow/StrategyDrafts';

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
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [tab,setTab] = useState<'strategy' | 'approved'>('strategy');
  const query = useWorkQuery<{ rows: WorkProduct[]; canCreateManual: boolean }>('products');
  const term = search.trim().toLocaleLowerCase();
  const alreadyAdded = Boolean(query.data?.rows?.some(product=>product.manual_product));
  async function addManualKeywords() {
    if (busy || alreadyAdded) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await workPost('create_manual_keywords_product',{});
      await query.reload();
      setMessage('تمت إضافة كلمات بحث إلى المنتجات');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر إضافة المنتج'); }
    finally { setBusy(false); }
  }
  const rows = (query.data?.rows || []).filter(product =>
    `${product.statement} ${product.idea_name} ${product.task_no} ${product.idea_code||''}`.toLocaleLowerCase().includes(term))
    .sort((a, b) => {
      // The approved-products view is ordered by its own execution/approval date.
      const first = a.approved_at || a.released_at || '';
      const second = b.approved_at || b.released_at || '';
      if (!first) return second ? 1 : 0;
      if (!second) return -1;
      return first.localeCompare(second) || a.id.localeCompare(b.id);
    });

  return <div className="mkw">
    <WorkHeader title={W.products} onRefresh={() => void query.reload()} loading={query.loading}>
      {query.data?.canCreateManual && <button type="button" className="primary" onClick={() => void addManualKeywords()} disabled={busy || alreadyAdded || query.loading}>
        {alreadyAdded ? 'كلمات بحث موجود بالفعل' : busy ? W.loading : '+ إضافة منتج يدوي — كلمات بحث'}
      </button>}
    </WorkHeader>
    <WorkAlert>{query.error || error}</WorkAlert><WorkAlert success>{message}</WorkAlert>
    <div className="mkw-products-tabs" role="tablist" aria-label="أنواع المنتجات">
      <button type="button" role="tab" className="secondary" aria-selected={tab === 'strategy'} onClick={() => setTab('strategy')}>منتجات الاستراتيجية (الأفكار والتراكينج)</button>
      <button type="button" role="tab" className="secondary" aria-selected={tab === 'approved'} onClick={() => setTab('approved')}>المنتجات المعتمدة</button>
    </div>
    <div className="mkw-toolbar"><Search value={search} onChange={setSearch} /></div>
    {tab === 'strategy' ? <StrategyProductsTab search={search}/> : <div className="mkw-table-wrap">
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
            <td className="mkw-table-title"><ProductReference title={product.task_name} details={product}/>{!product.manual_product && <MediaLabel kind={product.media_kind} />}</td>
            <td>{product.idea_name}{product.idea_code && <small className="mkw-muted" style={{display:'block'}}>كود الفكرة: <span dir="ltr">{product.idea_code}</span></small>}</td>
            <td>{product.manual_product ? '—' : product.assignee_name || '—'}</td>
            <td><ProductViewButton id={product.id} /></td>
          </tr>;
        })}</tbody>
      </table>
      {!rows.length && <Empty>{query.loading ? W.loading : W.noData}</Empty>}
    </div>}
  </div>;
}
