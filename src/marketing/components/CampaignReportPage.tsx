import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, ChartBar, ChartLineUp, FilePdf, FileXls, Funnel, Megaphone, UsersThree, Wallet } from '@phosphor-icons/react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Tooltip, XAxis, YAxis } from 'recharts';
import type { CampaignReportPayload, CampaignReportRow } from '../../../shared/campaign-report';
import { marketingFetch, marketingLocalDateKey, marketingQuery } from '../api';
import { downloadCampaignReportXlsx, filterCampaignReportRows, printCampaignReportPdf } from '../reporting/exportCampaignReport';

const number = (value: number | null, decimals = 0) => value === null ? '—' : value.toLocaleString('ar-SA-u-nu-latn', {minimumFractionDigits: decimals, maximumFractionDigits: decimals});
const currencyValue = (value: number | null, currency: string) => value === null ? '—' : `${number(value, 2)} ${currency || 'ر.س'}`;
const RECENT = 29 * 86_400_000;
type ChartMetric = 'interactions' | 'leads' | 'costPerLead';
const CHART_COLORS: Record<ChartMetric, string> = { interactions: '#167d91', leads: '#2e8b68', costPerLead: '#ca8741' };

function CampaignBars({ title, metric, rows, onSelect }: { title: string; metric: ChartMetric; rows: CampaignReportRow[]; onSelect: (key: string) => void }) {
  const ordered = useMemo(() => [...rows]
    .filter(row => row[metric] !== null && Number.isFinite(row[metric]))
    .sort((a, b) => (b[metric] || 0) - (a[metric] || 0) || a.campaignName.localeCompare(b.campaignName, 'ar')),
  [rows, metric]);
  const values = useMemo(() => ordered.map(row => ({
    key: row.key, label: row.campaignName, managerName: row.managerName, platform: row.platformName, currency: row.currency,
    value: Number(row[metric]) || 0,
  })), [ordered, metric]);
  const chartWidth = Math.max(360, values.length * 108);
  const digits = metric === 'costPerLead' ? 2 : 0;
  return <section className="panel mcr-chart" aria-label={title}>
    <header><h4>{title}</h4><span>{number(values.length)} حملة</span></header>
    {values.length ? <div className="mcr-chart-scroller" dir="ltr" tabIndex={0} aria-label={title}>
      <BarChart width={chartWidth} height={325} data={values} margin={{ top: 23, right: 12, left: 6, bottom: 74 }}>
        <CartesianGrid stroke="#e7edf1" strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="key" interval={0} tickLine={false} axisLine={false} height={76}
          tick={({ x, y, payload }) => {
            const current = values.find(row => row.key === String(payload?.value));
            const name = current?.label || ''; const manager = current?.managerName || '';
            return <g transform={`translate(${Number(x)},${Number(y)})`}
              role="button" tabIndex={0} style={{cursor:'pointer'}}
              aria-label={`فتح تفاصيل الحملة ${name}`}
              onClick={() => { if (current) onSelect(current.key); }}
              onKeyDown={event => { if (current && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(current.key); } }}>
              <text x={0} y={12} textAnchor="middle" fontSize={9} fill="#526779">{name.length > 17 ? `${name.slice(0,16)}…` : name}</text>
              {manager && <text x={0} y={27} textAnchor="middle" fontSize={9} fontWeight={700} fill="#8d513e">
                {`مدير: ${manager.length > 15 ? `${manager.slice(0,14)}…` : manager}`}
              </text>}
            </g>;
          }} />
        <YAxis width={35} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#718595' }} />
        <Tooltip cursor={{ fill: 'rgba(37,104,116,.06)' }} labelFormatter={key => {
          const row = values.find(item => item.key === key);
          return row ? `${row.label} · ${row.platform}${row.managerName ? ` · مدير الحملة: ${row.managerName}` : ''}` : String(key);
        }} formatter={value => [metric === 'costPerLead' ? `${number(Number(value), digits)} ر.س` : number(Number(value), digits), title]} />
        <Bar dataKey="value" name={title} fill={CHART_COLORS[metric]} radius={[6, 6, 0, 0]} maxBarSize={46} isAnimationActive={values.length < 40}
          style={{ cursor:'pointer' }} onClick={(_entry, index) => { const row = values[index]; if (row) onSelect(row.key); }}>
          {values.map(row => <Cell key={row.key} fill={CHART_COLORS[metric]} />)}
          <LabelList dataKey="value" position="top" formatter={value => number(Number(value), digits)} style={{ fontSize: 10, fill: '#405b70', fontWeight: 700 }} />
        </Bar>
      </BarChart>
    </div> : <div className="mcr-no-chart">لا توجد بيانات لهذا المقياس في الفترة المحددة.</div>}
  </section>;
}

/** Unified paid-ads reporting. No organic or campaign-management loads on this tab. */
export function CampaignReportPage({ refreshToken = 0, onLoadingChange }: {
  refreshToken?: number; onLoadingChange?: (busy: boolean) => void;
} = {}) {
  const [from, setFrom] = useState(() => marketingLocalDateKey(new Date(Date.now() - RECENT)));
  const [to, setTo] = useState(() => marketingLocalDateKey());
  const [applied, setApplied] = useState(() => ({from: marketingLocalDateKey(new Date(Date.now() - RECENT)), to: marketingLocalDateKey()}));
  const [data, setData] = useState<CampaignReportPayload | null>(null);
  const [platform, setPlatform] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [managerDraft, setManagerDraft] = useState('');
  const [managerBusy, setManagerBusy] = useState(false);
  const [managerMessage, setManagerMessage] = useState('');
  const [managerError, setManagerError] = useState('');
  const highlightedRow = useRef<HTMLTableRowElement | null>(null);
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const prefetchedExportReport = useRef<CampaignReportPayload | null>(null);
  const lastRefreshToken = useRef(refreshToken);
  const valid = Boolean(from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to && (Date.parse(to) - Date.parse(from)) / 86_400_000 <= 366);

  const load = useCallback(async (fresh = false) => {
    const requestId = ++seq.current;
    controller.current?.abort();
    if (fresh) prefetchedExportReport.current = null;
    // Exporting a newly selected date range already fetched this report. Reuse
    // that response instead of calling paid-ad providers a second time.
    const prefetched = prefetchedExportReport.current;
    if (!fresh && prefetched && prefetched.from === applied.from && prefetched.to === applied.to) {
      prefetchedExportReport.current = null;
      controller.current = null;
      setData(prefetched);
      setError('');
      setLoading(false);
      onLoadingChange?.(false);
      return;
    }
    const signal = new AbortController(); controller.current = signal;
    setLoading(true); onLoadingChange?.(true); setError('');
    const timeout = window.setTimeout(() => signal.abort(), 56_000);
    try {
      const response = await marketingFetch<CampaignReportPayload>(`/api/marketing${marketingQuery({resource: 'campaign_report', dateFrom: applied.from, dateTo: applied.to, refresh: fresh ? 'true' : undefined})}`, { signal: signal.signal });
      if (requestId === seq.current) setData(response);
    } catch (failure) {
      if (requestId === seq.current) setError(signal.signal.aborted ? 'انتهت مهلة قراءة تقرير الحملات. جرّب تحديد فترة أقصر أو أعد المحاولة.' : failure instanceof Error ? failure.message : 'تعذر قراءة تقرير الحملات');
    } finally {
      window.clearTimeout(timeout);
      if (requestId === seq.current) { controller.current = null; setLoading(false); onLoadingChange?.(false); }
    }
  }, [applied, onLoadingChange]);
  useEffect(() => {
    const fresh = refreshToken !== lastRefreshToken.current;
    lastRefreshToken.current = refreshToken;
    void load(fresh);
    return () => { controller.current?.abort(); ++seq.current; onLoadingChange?.(false); };
  }, [load, refreshToken, onLoadingChange]);
  const rows = useMemo(() => filterCampaignReportRows(data?.rows || [], platform, search), [data, platform, search]);
  const selectedCampaign = rows.find(row => row.key === selectedKey) || null;
  function selectCampaign(key: string) {
    const target = rows.find(row => row.key === key);
    if (!target) return;
    setSelectedKey(key); setManagerDraft(target.managerName || ''); setManagerError(''); setManagerMessage('');
    // A second click on an already selected bar should still locate its table row.
    if (key === selectedKey) window.requestAnimationFrame(() => highlightedRow.current?.scrollIntoView({behavior:'smooth',block:'center'}));
  }
  useEffect(() => {
    if (!selectedKey || !selectedCampaign) return;
    const frame = window.requestAnimationFrame(() => highlightedRow.current?.scrollIntoView({behavior:'smooth',block:'center'}));
    return () => window.cancelAnimationFrame(frame);
  }, [selectedKey]);
  async function saveManager() {
    if (!selectedCampaign || !data?.canEditManager || managerBusy) return;
    setManagerBusy(true); setManagerError(''); setManagerMessage('');
    try {
      const result = await marketingFetch<{ok:true;managerName:string}>('/api/marketing',{method:'POST',
        body:JSON.stringify({action:'save_campaign_report_manager',platform:selectedCampaign.platform,
          accountId:selectedCampaign.accountId,campaignId:selectedCampaign.campaignId,managerName:managerDraft.trim()})});
      setData(previous => previous ? {...previous,rows:previous.rows.map(row => row.key === selectedCampaign.key
        ? {...row,managerName:result.managerName} : row)} : previous);
      setManagerDraft(result.managerName); setManagerMessage('تم حفظ مدير الحملة وسيظهر في الرسوم البيانية');
    } catch (reason) { setManagerError(reason instanceof Error ? reason.message : 'تعذر حفظ مدير الحملة'); }
    finally { setManagerBusy(false); }
  }
  const allSpendKnown = rows.length > 0 && rows.every(row => row.spend !== null);
  const totalSpend = rows.reduce((sum, row) => sum + (row.spend || 0), 0);
  const allLeadsKnown = rows.length > 0 && rows.every(row => row.leads !== null);
  const allInteractionsKnown = rows.length > 0 && rows.every(row => row.interactions !== null);
  const totalLeads = rows.reduce((sum, row) => sum + (row.leads || 0), 0);
  const totalCpl = allSpendKnown && allLeadsKnown && totalLeads > 0 ? totalSpend / totalLeads : null;
  const totalInteractions = rows.reduce((sum, row) => sum + (row.interactions || 0), 0);
  const canExport = Boolean(data && !loading && !exportingExcel);
  const exportExcel = async () => {
    if (loading || exportingExcel) return;
    setExportError('');
    if (!valid) {
      setExportError('حدد تاريخ بداية ونهاية صحيحين قبل تصدير Excel.');
      return;
    }
    setExportingExcel(true);
    try {
      let report = data;
      // The date inputs are separate from the last applied "عرض التقرير" range.
      // Export must never silently use an older/empty report for newly chosen dates.
      if (!report || report.from !== from || report.to !== to) {
        const signal = new AbortController();
        const timeout = window.setTimeout(() => signal.abort(), 56_000);
        try {
          report = await marketingFetch<CampaignReportPayload>(`/api/marketing${marketingQuery({resource: 'campaign_report', dateFrom: from, dateTo: to})}`, {signal: signal.signal});
        } finally {
          window.clearTimeout(timeout);
        }
        if (report.from !== from || report.to !== to) throw new Error('الفترة المرتجعة من التقرير لا تطابق التاريخ المحدد.');
        prefetchedExportReport.current = report;
        setData(report);
        setApplied({from, to});
      }
      const exportRows = filterCampaignReportRows(report.rows, platform, search);
      if (!exportRows.length) throw new Error('لا توجد حملات مطابقة للتاريخ والفلاتر المحددة لتصديرها إلى Excel.');
      downloadCampaignReportXlsx(exportRows, report.providers, report.from, report.to);
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : 'تعذر تجهيز ملف Excel للحملات.');
    } finally {
      setExportingExcel(false);
    }
  };
  const exportPdf = () => {
    if (!data) return;
    setExportError('');
    try { printCampaignReportPdf(rows, data.providers, data.from, data.to); }
    catch (failure) { setExportError(failure instanceof Error ? failure.message : 'تعذر تجهيز PDF'); }
  };

  return <div className="mcr-shell" dir="rtl">
    <div className="mcr-charts">
      <CampaignBars title="التفاعلات لكل حملة" metric="interactions" rows={rows} onSelect={selectCampaign}/>
      <CampaignBars title="عدد الليدات لكل حملة" metric="leads" rows={rows} onSelect={selectCampaign}/>
      <CampaignBars title="تكلفة الليد لكل حملة" metric="costPerLead" rows={rows} onSelect={selectCampaign}/>
    </div>
    <section className="panel mcr-filters"><div className="mcr-filter-heading"><Funnel size={19}/><strong>تصفية التقرير</strong><div className="mcr-head-actions"><button type="button" className="secondary-button" disabled={!canExport} onClick={() => void exportExcel()}><FileXls size={19}/> {exportingExcel ? "جاري تجهيز Excel..." : "تصدير Excel"}</button><button type="button" className="secondary-button" disabled={!canExport} onClick={exportPdf}><FilePdf size={19}/> تصدير PDF</button></div></div>
      <div className="mcr-filter-row"><label><span>من تاريخ</span><input type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)}/></label>
        <label><span>إلى تاريخ</span><input type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)}/></label>
        <button type="button" className="primary-button" disabled={!valid || loading} onClick={() => setApplied({from, to})}>عرض التقرير</button>
        <button type="button" className="secondary-button" disabled={loading} onClick={() => void load(Boolean(data?.canRefreshReport))}><ArrowClockwise size={18} className={loading ? 'marketing-spin' : ''}/> تحديث</button></div>
      {!valid && <small className="mcr-error">حدد تاريخ بداية ونهاية صحيحين، بفترة لا تزيد عن سنة.</small>}
      <div className="mcr-filter-row mcr-secondary-filters"><label><span>المنصة</span><select value={platform} onChange={event => setPlatform(event.target.value)}><option value="all">كل المنصات</option>{(data?.providers || []).map(item => <option key={item.platform} value={item.platform}>{item.name}</option>)}</select></label>
        <span className="mcr-currency-fixed" title="الإنفاق بالدولار الأمريكي يُحوّل بسعر 3.75 ريال سعودي">العملة: ريال سعودي (1 USD = 3.75 SAR)</span>
        <label className="mcr-search"><span>بحث بالحملة أو الحساب</span><input type="search" placeholder="ابحث باسم الحملة..." value={search} onChange={event => setSearch(event.target.value)}/></label></div>
    </section>
    {error && <div className="mcr-warning" role="alert">{error}</div>}
    {exportError && <div className="mcr-warning" role="alert">{exportError}</div>}
    {loading && <div className="mcr-loading" role="status"><ArrowClockwise size={20} className="marketing-spin"/> جاري قراءة الحملات من المنصات الإعلانية…</div>}
    {data && <>
      <div className="mcr-provider-status" aria-label="حالة الربط والبيانات">{data.providers.map(provider => <article key={provider.platform} className={`mcr-provider ${provider.status}`}><strong>{provider.name}</strong><span>{provider.status === 'ready' ? 'متصل' : provider.status === 'failed' ? 'تعذر القراءة' : 'الربط مطلوب'}</span><small>{number(provider.campaignCount)} حملة</small></article>)}</div>
      {data.providers.filter(provider => provider.status !== 'ready' || ((provider.platform !== 'snapchat' && (provider.incomplete || provider.warnings.length)) || (provider.platform === 'snapchat' && Boolean(provider.note)))).map(provider => <div key={provider.platform} className="mcr-warning"><strong>{provider.name}:</strong> {provider.note || (provider.incomplete ? 'بعض النتائج غير مكتملة.' : 'تحقق من الربط.')}{provider.warnings.length ? ` • ${provider.warnings.join(' • ')}` : ''}</div>)}
      <section className="mcr-summary" aria-label="ملخص الحملات">
        <article><Megaphone size={23}/><span>الحملات</span><strong>{number(rows.length)}</strong><small>وفق الفلاتر المختارة</small></article>
        <article><Wallet size={23}/><span>المبلغ المصروف</span><strong>{allSpendKnown ? currencyValue(totalSpend, 'ر.س') : '—'}</strong><small>المبالغ بالدولار تُضرب × 3.75</small></article>
        <article><UsersThree size={23}/><span>إجمالي الليدات</span><strong>{allLeadsKnown ? number(totalLeads) : '—'}</strong><small>{allLeadsKnown ? 'ليدات منصات الإعلانات' : `متوفر لـ ${number(rows.filter(row => row.leads !== null).length)} من ${number(rows.length)} حملات`}</small></article>
        <article><ChartLineUp size={23}/><span>تكلفة الليد</span><strong>{currencyValue(totalCpl, 'ر.س')}</strong><small>المبلغ المصروف ÷ الليدات المؤكدة</small></article>
        <article><ChartBar size={23}/><span>تفاعلات الإعلانات</span><strong>{allInteractionsKnown ? number(totalInteractions) : '—'}</strong><small>{allInteractionsKnown ? 'وفق تعريف كل منصة' : 'بعض المنصات لا تعيد التفاعلات'}</small></article>
      </section>
      <section className="panel mcr-table-panel"><header><div><h4>الحملات</h4><p>{number(rows.length)} حملة • {data.from} إلى {data.to}</p></div><small title="وقت جلب تقرير MZJ؛ وقد تكون بيانات Windsor.ai مخزنة لدى المزود">آخر تحديث: {new Date(data.generatedAt).toLocaleString('ar-SA-u-nu-latn')}</small></header>
        <div className="mcr-table-scroll"><table><thead><tr><th>المنصة</th><th>الحساب</th><th>الحملات</th><th>مدير الحملة</th><th>العملة</th><th>المبلغ المصروف</th><th>إجمالي الليدات</th><th>تكلفة الليد</th><th>تفاعلات الإعلانات</th><th>النقرات</th></tr></thead>
          {rows.map(row => <tbody key={row.key} className={row.key === selectedKey ? 'mcr-selected-campaign' : ''}>
            <tr ref={element => { if (row.key === selectedKey) highlightedRow.current = element; }}
              tabIndex={0} role="button" aria-label={`تفاصيل الحملة ${row.campaignName}`}
              aria-expanded={row.key === selectedKey} onClick={() => selectCampaign(row.key)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCampaign(row.key); } }}>
              <td><span className={`mcr-platform-label ${row.platform}`}>{row.platformName}</span></td><td dir="auto">{row.accountName}</td>
              <td><bdi dir="auto">{row.campaignName}</bdi></td><td>{row.managerName || 'غير محدد'}</td>
              <td title={row.exchangeRate === 3.75 ? 'تم التحويل من USD × 3.75' : row.exchangeRate === null ? 'العملة الأصلية غير معروفة أو غير مدعومة؛ الإنفاق غير محتسب' : 'العملة الأصلية SAR'}>SAR</td>
              <td dir="ltr">{currencyValue(row.spend,'ر.س')}</td><td>{number(row.leads)}</td><td dir="ltr">{currencyValue(row.costPerLead,'ر.س')}</td><td title={row.interactionsDefinition}>{number(row.interactions)}</td><td>{number(row.clicks)}</td>
            </tr>
            {row.key === selectedKey && <tr className="mcr-selected-details"><td colSpan={10}>
              <div className="mcr-campaign-details">
                <div><strong>{row.campaignName}</strong><small>{row.platformName} · {row.accountName}</small></div>
                <div className="mcr-campaign-details-numbers">
                  <span>المصروف <b>{currencyValue(row.spend,'ر.س')}</b></span>
                  <span>الليدات <b>{number(row.leads)}</b></span>
                  <span>تكلفة الليد <b>{currencyValue(row.costPerLead,'ر.س')}</b></span>
                  <span>التفاعلات <b>{number(row.interactions)}</b></span>
                  <span>النقرات <b>{number(row.clicks)}</b></span>
                </div>
                <div className="mcr-campaign-manager"><label><span>مدير الحملة</span><input type="text" maxLength={120} value={managerDraft}
                  disabled={!data.canEditManager || managerBusy} placeholder="اكتب اسم مدير الحملة"
                  onClick={event => event.stopPropagation()} onChange={event => {setManagerDraft(event.target.value);setManagerMessage('');}}/></label>
                  {data.canEditManager && <button type="button" className="primary-button" disabled={managerBusy || managerDraft.trim() === row.managerName}
                    onClick={() => void saveManager()}>{managerBusy ? 'جاري الحفظ...' : 'حفظ مدير الحملة'}</button>}
                  {!data.canEditManager && <small>يمكنك مشاهدة مدير الحملة، لكن لا تملك صلاحية تعديله.</small>}
                </div>
                {managerError && <small className="mcr-error">{managerError}</small>}
                {managerMessage && <small className="mcr-manager-saved">{managerMessage}</small>}
              </div>
            </td></tr>}
          </tbody>)}
          {!rows.length && <tbody><tr><td colSpan={10} className="mcr-empty">لا توجد حملات في الفترة أو الفلاتر المختارة، أو أن جميع حسابات الإعلانات غير متاحة.</td></tr></tbody>}
        </table></div>
      </section>
    </>}
  </div>;
}
