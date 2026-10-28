import { useEffect, useState } from 'react';
import { ChartLineUp, ArrowClockwise, LinkSimple } from '@phosphor-icons/react';
import { marketingDate, marketingFetch, marketingQuery } from '../api';
import { marketingResultCount, type EngagementResultGroup, type EngagementResultsPayload } from '../engagementResults';
import { EngagementResultDetail } from './EngagementResultDetail';
import { Modal } from '../../components/Modal';

type ResultPayload = { results: EngagementResultsPayload };

/** Historical results of content published under MZJ campaigns.
 * Does not mix organic engagement with provider-funded spend or lead totals.
 * Lazy loaded: never blocks the paid provider dashboards at page open.
 */
export function OrganicCampaignResults() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<EngagementResultGroup[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<EngagementResultGroup | null>(null);
  async function load(signal?: AbortSignal) {
    setLoading(true); setError('');
    try {
      const result = await marketingFetch<ResultPayload>(`/api/marketing${marketingQuery({ resource: 'engagement', view: 'campaigns' })}`, { signal });
      if (!signal?.aborted) setData(result.results.campaigns || []);
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'تعذرت قراءة نتائج نشر الحملات');
    } finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    if (!open || data) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [open]);
  return <section className="panel marketing-paid-content-results">
    <header><div><h3>نتائج نشر محتوى الحملات</h3><p>نتائج المنشورات المرتبطة بحملات MZJ، منفصلة عن أرقام الحملات المدفوعة لمنع ازدواج الحساب.</p></div><button className="secondary-button" type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}>{open ? 'إخفاء النتائج' : 'عرض النتائج'}</button></header>
    {open && <>
      <div className="marketing-paid-content-toolbar"><span><ChartLineUp size={17}/> {data ? marketingResultCount(data.length) : '—'} حملة لها نتائج</span><button type="button" className="secondary-button small" disabled={loading} onClick={() => void load()}><ArrowClockwise size={16}/> تحديث</button></div>
      {error && <p role="alert" className="marketing-tiktok-warning">{error}</p>}
      {loading && !data && <p className="marketing-meta-account-disclaimer">جارٍ تحميل نتائج نشر الحملات…</p>}
      {data && <div className="marketing-engagement-table-wrap"><table className="marketing-engagement-table"><thead><tr><th>الحملة</th><th>الفترة</th><th>المنشورات</th><th>التفاعلات</th><th>عملاء CRM</th><th>مبيعات</th><th>التفاصيل</th></tr></thead><tbody>
        {data.map(item => <tr key={item.sourceId}><td><strong>{item.name}</strong><small>{item.code}</small></td><td>{marketingDate(item.publishStart)} — {marketingDate(item.publishEnd)}</td><td>{marketingResultCount(item.summary.posts)}</td><td>{marketingResultCount(item.summary.engagements)}</td><td>{marketingResultCount(item.summary.crmLeads)}</td><td>{marketingResultCount(item.summary.soldLeads)}</td><td><button className="secondary-button small" type="button" onClick={() => setSelected(item)}><LinkSimple size={15}/> التفاصيل</button></td></tr>)}
        {!data.length && <tr><td colSpan={7}>لا توجد نتائج نشر مرتبطة بحملات حتى الآن.</td></tr>}
      </tbody></table></div>}
    </>}
    <Modal open={!!selected} title={selected ? `نتائج الحملة — ${selected.name}` : 'نتائج النشر'} onClose={() => setSelected(null)} className="marketing-result-modal"><EngagementResultDetail result={selected}/></Modal>
  </section>;
}
