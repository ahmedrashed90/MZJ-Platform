import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, ChartBar, ChartLineUp, FilePdf, FileXls, Funnel, Megaphone, UsersThree, Wallet } from '@phosphor-icons/react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Tooltip, XAxis, YAxis } from 'recharts';
import type { CampaignReportPayload, CampaignReportRow } from '../../../shared/campaign-report';
import { marketingFetch, marketingLocalDateKey, marketingQuery } from '../api';
import { downloadCampaignReportXlsx, printCampaignReportPdf } from '../reporting/exportCampaignReport';

const number = (value: number | null, decimals = 0) => value === null ? '—' : value.toLocaleString('ar-SA-u-nu-latn', {minimumFractionDigits: decimals, maximumFractionDigits: decimals});
const currencyValue = (value: number | null, currency: string) => value === null ? '—' : `${number(value, 2)} ${currency}`;
const RECENT = 29 * 86_400_000;
type ChartMetric = 'interactions' | 'leads' | 'costPerLead';
const CHART_COLORS: Record<ChartMetric, string> = { interactions: '#167d91', leads: '#2e8b68', costPerLead: '#ca8741' };

function CampaignBars({ title, metric, rows }: { title: string; metric: ChartMetric; rows: CampaignReportRow[] }) {
  const ordered = useMemo(() => [...rows]
    .filter(row => row[metric] !== null && Number.isFinite(row[metric]))
    .sort((a, b) => (b[metric] || 0) - (a[metric] || 0) || a.campaignName.localeCompare(b.campaignName, 'ar')),
  [rows, metric]);
  const values = useMemo(() => ordered.map(row => ({
    key: row.key, label: row.campaignName, platform: row.platformName, currency: row.currency,
    value: Number(row[metric]) || 0,
  })), [ordered, metric]);
  const chartWidth = Math.max(360, values.length * 84);
  const digits = metric === 'costPerLead' ? 2 : 0;
  return <section className="panel mcr-chart" aria-label={title}>
    <header><h4>{title}</h4><span>{number(values.length)} حملة</span></header>
    {values.length ? <div className="mcr-chart-scroller" dir="ltr" tabIndex={0} aria-label={title}>
      <BarChart width={chartWidth} height={310} data={values} margin={{ top: 23, right: 12, left: 6, bottom: 65 }}>
        <CartesianGrid stroke="#e7edf1" strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="key" interval={0} tickLine={false} axisLine={false} height={70} angle={-42}
          textAnchor="end" tick={{ fontSize: 10, fill: '#657b8b' }}
          tickFormatter={key => { const label = values.find(row => row.key === key)?.label || String(key); return label.length > 15 ? `${label.slice(0, 14)}…` : label; }} />
        <YAxis width={35} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#718595' }} />
        <Tooltip cursor={{ fill: 'rgba(37,104,116,.06)' }} labelFormatter={key => {
          const row = values.find(item => item.key === key);
          return row ? `${row.label} · ${row.platform}` : String(key);
        }} formatter={value => [number(Number(value), digits), title]} />
        <Bar dataKey="value" name={title} fill={CHART_COLORS[metric]} radius={[6, 6, 0, 0]} maxBarSize={46} isAnimationActive={values.length < 40}>
          {values.map(row => <Cell key={row.key} fill={CHART_COLORS[metric]} />)}
          <LabelList dataKey="value" position="top" formatter={value => number(Number(value), digits)} style={{ fontSize: 10, fill: '#405b70', fontWeight: 700 }} />
        </Bar>
      </BarChart>
    </div> : <div className="mcr-no-chart">لا توجد بيانات لهذا المقياس في الفترة المحددة.</div>}
  </section>;
}

/** Unified paid-ads reporting. No organic or campaign-management loads on this tab. */
export function CampaignReportPage() {
  const [from, setFrom] = useState(() => marketingLocalDateKey(new Date(Date.now() - RECENT)));
  const [to, setTo] = useState(() => marketingLocalDateKey());
  const [applied, setApplied] = useState(() => ({from: marketingLocalDateKey(new Date(Date.now() - RECENT)), to: marketingLocalDateKey()}));
  const [data, setData] = useState<CampaignReportPayload | null>(null);
  const [platform, setPlatform] = useState('all');
  const [currency, setCurrency] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const valid = Boolean(from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to && (Date.parse(to) - Date.parse(from)) / 86_400_000 <= 366);

  const load = useCallback(async () => {
    const requestId = ++seq.current;
    controller.current?.abort();
    const signal = new AbortController(); controller.current = signal;
    setLoading(true); setError('');
    const timeout = window.setTimeout(() => signal.abort(), 56_000);
    try {
      const response = await marketingFetch<CampaignReportPayload>(`/api/marketing${marketingQuery({resource: 'campaign_report', dateFrom: applied.from, dateTo: applied.to})}`, { signal: signal.signal });
      if (requestId === seq.current) setData(response);
    } catch (failure) {
      if (requestId === seq.current) setError(signal.signal.aborted ? 'انتهت مهلة قراءة تقرير الحملات. جرّب تحديد فترة أقصر أو أعد المحاولة.' : failure instanceof Error ? failure.message : 'تعذر قراءة تقرير الحملات');
    } finally {
      window.clearTimeout(timeout);
      if (requestId === seq.current) { controller.current = null; setLoading(false); }
    }
  }, [applied]);
  useEffect(() => { void load(); return () => { controller.current?.abort(); ++seq.current; }; }, [load]);
  const currencies = useMemo(() => [...new Set((data?.rows || []).map(row => row.currency).filter(Boolean))], [data]);
  const rows = useMemo(() => (data?.rows || []).filter(row => (platform === 'all' || row.platform === platform) &&
    (currency === 'all' || row.currency === currency) &&
    (!search.trim() || `${row.campaignName} ${row.accountName} ${row.platformName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [data, platform, currency, search]);
  const grouped = useMemo(() => currencies.filter(c => currency === 'all' || currency === c).map(name => {
    const matches = rows.filter(row => row.currency === name);
    const knownSpend = matches.every(row => row.spend !== null);
    const knownLeads = matches.every(row => row.leads !== null);
    const spend = matches.reduce((sum, row) => sum + (row.spend || 0), 0);
    const leads = matches.reduce((sum, row) => sum + (row.leads || 0), 0);
    return {name, matches: matches.length, spend: knownSpend ? spend : null, leads: knownLeads ? leads : null,
      cpl: knownSpend && knownLeads && leads > 0 ? spend / leads : null};
  }).filter(item => item.matches > 0), [currencies, currency, rows]);
  const allLeadsKnown = rows.length > 0 && rows.every(row => row.leads !== null);
  const allInteractionsKnown = rows.length > 0 && rows.every(row => row.interactions !== null);
  const totalLeads = rows.reduce((sum, row) => sum + (row.leads || 0), 0);
  const totalInteractions = rows.reduce((sum, row) => sum + (row.interactions || 0), 0);
  const canExport = Boolean(data && !loading);
  const exportPdf = () => {
    if (!data) return;
    setExportError('');
    try { printCampaignReportPdf(rows, data.providers, data.from, data.to); }
    catch (failure) { setExportError(failure instanceof Error ? failure.message : 'تعذر تجهيز PDF'); }
  };

  return <div className="mcr-shell" dir="rtl">
    <div className="mcr-charts">
      <CampaignBars title="التفاعلات لكل حملة" metric="interactions" rows={rows}/>
      <CampaignBars title="عدد الليدات لكل حملة" metric="leads" rows={rows}/>
      <CampaignBars title="تكلفة الليد لكل حملة" metric="costPerLead" rows={rows}/>
    </div>
    <section className="panel mcr-filters"><div className="mcr-filter-heading"><Funnel size={19}/><strong>تصفية التقرير</strong><div className="mcr-head-actions"><button type="button" className="secondary-button" disabled={!canExport} onClick={() => data && downloadCampaignReportXlsx(rows, data.providers, data.from, data.to)}><FileXls size={19}/> تصدير Excel</button><button type="button" className="secondary-button" disabled={!canExport} onClick={exportPdf}><FilePdf size={19}/> تصدير PDF</button></div></div>
      <div className="mcr-filter-row"><label><span>من تاريخ</span><input type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)}/></label>
        <label><span>إلى تاريخ</span><input type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)}/></label>
        <button type="button" className="primary-button" disabled={!valid || loading} onClick={() => setApplied({from, to})}>عرض التقرير</button>
        <button type="button" className="secondary-button" disabled={loading} onClick={() => void load()}><ArrowClockwise size={18} className={loading ? 'marketing-spin' : ''}/> تحديث</button></div>
      {!valid && <small className="mcr-error">حدد تاريخ بداية ونهاية صحيحين، بفترة لا تزيد عن سنة.</small>}
      <div className="mcr-filter-row mcr-secondary-filters"><label><span>المنصة</span><select value={platform} onChange={event => setPlatform(event.target.value)}><option value="all">كل المنصات</option>{(data?.providers || []).map(item => <option key={item.platform} value={item.platform}>{item.name}</option>)}</select></label>
        <label><span>عملة الحساب</span><select value={currency} onChange={event => setCurrency(event.target.value)}><option value="all">كل العملات</option>{currencies.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="mcr-search"><span>بحث بالحملة أو الحساب</span><input type="search" placeholder="ابحث باسم الحملة..." value={search} onChange={event => setSearch(event.target.value)}/></label></div>
    </section>
    {error && <div className="mcr-warning" role="alert">{error}</div>}
    {exportError && <div className="mcr-warning" role="alert">{exportError}</div>}
    {loading && <div className="mcr-loading" role="status"><ArrowClockwise size={20} className="marketing-spin"/> جاري قراءة الحملات من المنصات الإعلانية…</div>}
    {data && <>
      <div className="mcr-provider-status" aria-label="حالة الربط والبيانات">{data.providers.map(provider => <article key={provider.platform} className={`mcr-provider ${provider.status}`}><strong>{provider.name}</strong><span>{provider.status === 'ready' ? 'متصل' : provider.status === 'failed' ? 'تعذر القراءة' : 'الربط مطلوب'}</span><small>{number(provider.campaignCount)} حملة</small></article>)}</div>
      {data.providers.filter(provider => provider.incomplete || provider.status !== 'ready' || provider.warnings.length).map(provider => <div key={provider.platform} className="mcr-warning"><strong>{provider.name}:</strong> {provider.note || (provider.incomplete ? 'بعض النتائج غير مكتملة.' : 'تحقق من الربط.')}{provider.warnings.length ? ` • ${provider.warnings.join(' • ')}` : ''}</div>)}
      <section className="mcr-summary" aria-label="ملخص الحملات">
        <article><Megaphone size={23}/><span>الحملات</span><strong>{number(rows.length)}</strong><small>وفق الفلاتر المختارة</small></article>
        <article><Wallet size={23}/><span>المبلغ المصروف</span><strong>{grouped.length === 1 ? currencyValue(grouped[0].spend, grouped[0].name) : grouped.length ? 'حسب العملة' : '—'}</strong><small>لا يتم جمع عملات مختلفة</small></article>
        <article><UsersThree size={23}/><span>إجمالي الليدات</span><strong>{allLeadsKnown ? number(totalLeads) : '—'}</strong><small>{allLeadsKnown ? 'ليدات منصات الإعلانات' : `متوفر لـ ${number(rows.filter(row => row.leads !== null).length)} من ${number(rows.length)} حملات`}</small></article>
        <article><ChartLineUp size={23}/><span>تكلفة الليد</span><strong>{grouped.length === 1 ? currencyValue(grouped[0].cpl, grouped[0].name) : 'حسب العملة'}</strong><small>المبلغ المصروف ÷ الليدات المؤكدة</small></article>
        <article><ChartBar size={23}/><span>تفاعلات الإعلانات</span><strong>{allInteractionsKnown ? number(totalInteractions) : '—'}</strong><small>{allInteractionsKnown ? 'وفق تعريف كل منصة' : 'بعض المنصات لا تعيد التفاعلات'}</small></article>
      </section>
      {grouped.length > 1 && <div className="mcr-currencies">{grouped.map(group => <span key={group.name}>{group.name}: إنفاق <strong>{currencyValue(group.spend,group.name)}</strong> • ليدات <strong>{number(group.leads)}</strong> • CPL <strong>{currencyValue(group.cpl,group.name)}</strong></span>)}</div>}
      <section className="panel mcr-table-panel"><header><div><h4>الحملات</h4><p>{number(rows.length)} حملة • {data.from} إلى {data.to}</p></div><small>آخر تحديث: {new Date(data.generatedAt).toLocaleString('ar-SA-u-nu-latn')}</small></header>
        <div className="mcr-table-scroll"><table><thead><tr><th>المنصة</th><th>الحساب</th><th>الحملات</th><th>العملة</th><th>المبلغ المصروف</th><th>إجمالي الليدات</th><th>تكلفة الليد</th><th>تفاعلات الإعلانات</th></tr></thead><tbody>
          {rows.map(row => <tr key={row.key}><td><span className={`mcr-platform-label ${row.platform}`}>{row.platformName}</span></td><td dir="auto">{row.accountName}</td><td><bdi dir="auto">{row.campaignName}</bdi></td><td>{row.currency || '—'}</td><td dir="ltr">{currencyValue(row.spend,row.currency)}</td><td>{number(row.leads)}</td><td dir="ltr">{currencyValue(row.costPerLead,row.currency)}</td><td title={row.interactionsDefinition}>{number(row.interactions)}</td></tr>)}
          {!rows.length && <tr><td colSpan={8} className="mcr-empty">لا توجد حملات في الفترة أو الفلاتر المختارة، أو أن جميع حسابات الإعلانات غير متاحة.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
  </div>;
}
