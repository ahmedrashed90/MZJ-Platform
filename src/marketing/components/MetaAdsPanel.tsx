import { useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, ChartLineUp, FacebookLogo, FloppyDisk, LinkSimple, MagnifyingGlass, Megaphone, UsersThree, Wallet } from '@phosphor-icons/react';
import { useAuth } from '../../auth/AuthContext';
import { hasPermission } from '../../systemAccess';
import { marketingDate, marketingFetch, marketingLocalDateKey, marketingQuery } from '../api';
import { MarketingAlert } from './MarketingPage';

type MetaAdsMetrics = { spend: number; reach: number | null; impressions: number | null; clicks: number | null; ctr: number | null; leads: number | null; costPerLead: number | null; interactions: number | null };
type MetaAd = { id: string; campaignId: string; name: string; status: string; adsetName: string; thumbnailUrl: string; storyId: string; metrics: MetaAdsMetrics };
type MetaCampaign = { id: string; accountId: string; name: string; managerName: string; status: string; objective: string; startTime: string; stopTime: string; dailyBudget: number | null; lifetimeBudget: number | null; metrics: MetaAdsMetrics; ads: MetaAd[] };
type MetaAdAccount = { id: string; name: string; currency: string; status: number | null };
type MetaAdsReport = { account: MetaAdAccount; campaigns: MetaCampaign[]; incomplete: boolean; adsUnlinked: number };
type MetaAdsResponse = { ok: true; status: string; preset: string; dateRange?: { since: string; until: string } | null; accounts: MetaAdAccount[]; reports: MetaAdsReport[]; errors: { accountId: string; message: string }[]; syncedAt: string; truncatedAccounts?: boolean; note?: string };
type Preset = 'today' | 'yesterday' | 'last_7d' | 'last_30d' | 'this_month' | 'custom';
type ChartMetric = 'costPerLead' | 'leads' | 'interactions';
type ChartPoint = { key: string; name: string; managerName: string; currency: string; costPerLead: number | null; leads: number | null; interactions: number | null };

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'اليوم' },
  { value: 'yesterday', label: 'أمس' },
  { value: 'last_7d', label: 'آخر 7 أيام' },
  { value: 'last_30d', label: 'آخر 30 يومًا' },
  { value: 'this_month', label: 'الشهر الحالي' },
  { value: 'custom', label: 'من تاريخ إلى تاريخ' },
];
const num = (value: number | null | undefined, decimals = 0) => value === null || value === undefined
  ? '—' : Number(value).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const money = (value: number | null | undefined, currency: string) => value === null || value === undefined ? '—' : `${num(value, 2)} ${currency}`;
const accountNumber = (id: string) => id.replace(/^act_/, '');
const campaignUrl = (account: string, id: string) => `https://www.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(accountNumber(account))}&selected_campaign_ids=${encodeURIComponent(id)}`;
const adUrl = (account: string, id: string) => `https://www.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(accountNumber(account))}&selected_ad_ids=${encodeURIComponent(id)}`;
function defaultRangeDate(daysBack: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  return marketingLocalDateKey(date);
}
const adStatus = (status: string) => {
  const value = status.toUpperCase();
  if (value === 'ACTIVE') return 'نشط';
  if (value === 'PAUSED' || value === 'CAMPAIGN_PAUSED' || value === 'ADSET_PAUSED') return 'متوقف مؤقتًا';
  if (value === 'IN_PROCESS') return 'قيد التجهيز';
  if (value === 'PENDING_REVIEW') return 'بانتظار مراجعة Meta';
  if (value === 'WITH_ISSUES') return 'يحتاج مراجعة';
  if (value === 'DISAPPROVED') return 'مرفوض';
  if (value === 'ARCHIVED') return 'مؤرشف';
  if (value === 'DELETED') return 'محذوف';
  return status || 'غير معروف';
};

function CampaignManagerEditor({ managerName, editable, onSave }: {
  managerName: string; editable: boolean; onSave: (name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(managerName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setDraft(managerName); }, [managerName]);
  const changed = draft.trim() !== managerName;
  return <div className="marketing-meta-ads-manager">
    <label><span>اسم مدير الحملة</span>
      {editable ? <input type="text" value={draft} maxLength={120} autoComplete="off" placeholder="اكتب اسم مدير الحملة" onChange={event => { setDraft(event.target.value); setMessage(''); setError(''); }} disabled={busy} />
        : <strong>{managerName || 'لم يتم تحديد مدير الحملة'}</strong>}
    </label>
    {editable && <button type="button" className="secondary-button small" disabled={busy || !changed} onClick={async () => {
      setBusy(true); setMessage(''); setError('');
      try { await onSave(draft.trim()); setMessage('تم حفظ اسم مدير الحملة في قاعدة بيانات MZJ'); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر حفظ اسم مدير الحملة'); }
      finally { setBusy(false); }
    }}><FloppyDisk size={17}/>{busy ? 'جاري الحفظ...' : 'حفظ الاسم'}</button>}
    {message && <small className="marketing-meta-ads-manager-success" role="status">{message}</small>}
    {error && <small className="marketing-meta-ads-manager-error" role="alert">{error}</small>}
    <small className="marketing-meta-ads-manager-help">الاسم يُحفظ داخل MZJ ويظهر في الرسوم، ولا يغيّر أي بيانات في Meta Ads Manager.</small>
  </div>;
}

const CHART_METRICS: { metric: ChartMetric; label: string; hint: string }[] = [
  { metric: 'costPerLead', label: 'تكلفة الليد', hint: 'بالعملة المسجلة للحساب' },
  { metric: 'leads', label: 'عدد الليدات', hint: 'العملاء المحتملون حسب Meta' },
  { metric: 'interactions', label: 'التفاعلات', hint: 'التفاعل المتاح من Meta' },
];
const CAMPAIGN_CHART_PAGE_SIZE = 8;
const campaignDomId = (key: string) => `marketing-meta-ads-campaign-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

function CampaignMetricBar({ point, metric, maximum }: { point: ChartPoint; metric: ChartMetric; maximum: number }) {
  const value = point[metric];
  const width = value !== null && value > 0 && maximum > 0 ? Math.max(2, (value / maximum) * 100) : 0;
  const label = CHART_METRICS.find(item => item.metric === metric)?.label || metric;
  const displayValue = metric === 'costPerLead' ? money(value, point.currency) : num(value);
  return <div className={`marketing-meta-ads-chart-metric is-${metric}`} aria-label={`${label}: ${displayValue}`}>
    <span className="marketing-meta-ads-chart-mobile-label" aria-hidden="true">{label}</span>
    <span className="marketing-meta-ads-chart-track" aria-hidden="true">
      <span className="marketing-meta-ads-chart-fill" style={{ width: `${width}%` }} />
    </span>
    <strong className="marketing-meta-ads-chart-value" dir="ltr">{displayValue}</strong>
  </div>;
}

function CampaignOverviewChart({ points }: { points: ChartPoint[] }) {
  const [orderBy, setOrderBy] = useState<ChartMetric>('leads');
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(() => [...points].sort((a, b) => {
    const aValue = a[orderBy];
    const bValue = b[orderBy];
    if (aValue === null && bValue !== null) return 1;
    if (bValue === null && aValue !== null) return -1;
    if (aValue !== null && bValue !== null && aValue !== bValue) {
      // A lower cost per lead is better; leads and interactions sort high to low.
      return orderBy === 'costPerLead' ? aValue - bValue : bValue - aValue;
    }
    return a.name.localeCompare(b.name, 'ar');
  }), [points, orderBy]);
  const maxima = useMemo(() => ({
    costPerLead: Math.max(0, ...points.map(point => point.costPerLead ?? 0)),
    leads: Math.max(0, ...points.map(point => point.leads ?? 0)),
    interactions: Math.max(0, ...points.map(point => point.interactions ?? 0)),
  }), [points]);
  const visible = showAll ? sorted : sorted.slice(0, CAMPAIGN_CHART_PAGE_SIZE);
  const hasMultipleCurrencies = new Set(points.map(point => point.currency)).size > 1;

  const openCampaign = (key: string) => {
    const details = document.getElementById(campaignDomId(key));
    if (details instanceof HTMLDetailsElement) {
      details.open = true;
      details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return <section className="panel marketing-meta-ads-chart-card" aria-label="مقارنة أداء الحملات الإعلانية">
    <header className="marketing-meta-ads-chart-heading">
      <div>
        <h4>مقارنة أداء الحملات</h4>
        <p>تكلفة الليد وعدد الليدات والتفاعلات، مع اسم الحملة ومديرها — حسب الفترة والفلاتر المحددة.</p>
      </div>
      <label className="marketing-meta-ads-chart-sort">ترتيب الحملات حسب
        <select value={orderBy} onChange={event => { setOrderBy(event.target.value as ChartMetric); setShowAll(false); }}>
          <option value="leads">الأكثر ليدات</option>
          <option value="costPerLead">الأقل تكلفة لليد</option>
          <option value="interactions">الأكثر تفاعلًا</option>
        </select>
      </label>
    </header>
    {hasMultipleCurrencies && <p className="marketing-meta-ads-chart-currency-note">تكلفة الليد معروضة بعملة كل حساب إعلاني؛ لا تقارن التكاليف بين عملات مختلفة مباشرة.</p>}
    <div className="marketing-meta-ads-chart-legend" aria-hidden="true">
      <span>الحملة / مدير الحملة</span>
      {CHART_METRICS.map(item => <span key={item.metric} className={`is-${item.metric}`}><i />{item.label}<small>{item.hint}</small></span>)}
    </div>
    <div className="marketing-meta-ads-chart-rows">
      {visible.map(point => <div key={point.key} className="marketing-meta-ads-chart-row">
        <div className="marketing-meta-ads-chart-campaign">
          <button type="button" className="marketing-meta-ads-chart-campaign-name" title={`فتح تفاصيل: ${point.name}`} onClick={() => openCampaign(point.key)}>{point.name}</button>
          <small title={point.managerName || 'غير محدد'}>مدير الحملة: {point.managerName || 'غير محدد'}</small>
        </div>
        {CHART_METRICS.map(item => <CampaignMetricBar key={item.metric} point={point} metric={item.metric} maximum={maxima[item.metric]} />)}
      </div>)}
    </div>
    <footer className="marketing-meta-ads-chart-footer">
      <span>عرض {num(visible.length)} من أصل {num(points.length)} حملة · طول كل شريط نسبي داخل مؤشره</span>
      {points.length > CAMPAIGN_CHART_PAGE_SIZE && <button type="button" className="secondary-button small" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>
        {showAll ? 'عرض حملات أقل' : `عرض جميع الحملات (${num(points.length)})`}
      </button>}
    </footer>
  </section>;
}

export function MetaAdsPanel() {
  const { user } = useAuth();
  const canEditManager = hasPermission(user, 'marketing.engagement.refresh') || hasPermission(user, 'marketing.campaign.edit');
  const [data, setData] = useState<MetaAdsResponse | null>(null);
  const [preset, setPreset] = useState<Preset>('last_30d');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [managerOverrides, setManagerOverrides] = useState<Record<string, string>>({});
  const [reloadCount, setReloadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const customRangeInvalid = preset === 'custom' && (!dateFrom || !dateTo || dateFrom > dateTo);
  useEffect(() => {
    if (customRangeInvalid) { setLoading(false); setData(null); setError(''); return; }
    let cancelled = false;
    setLoading(true);
    setData(null); // Never show a previous period's totals under a newly chosen date range.
    setError('');
    const url = `/api/marketing${marketingQuery({ resource: 'meta_ads', preset, accountId: selectedAccount, dateFrom: preset === 'custom' ? dateFrom : '', dateTo: preset === 'custom' ? dateTo : '' })}`;
    void marketingFetch<MetaAdsResponse>(url)
      .then(result => { if (!cancelled) setData(result); })
      .catch(reason => { if (!cancelled) { setData(null); setError(reason instanceof Error ? reason.message : 'تعذر تحميل الإعلانات'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [preset, dateFrom, dateTo, selectedAccount, reloadCount, customRangeInvalid]);
  const filtered = useMemo(() => (data?.reports || []).flatMap(report => report.campaigns.map(campaign => ({
    account: report.account,
    campaign: { ...campaign, managerName: managerOverrides[`${report.account.id}:${campaign.id}`] ?? campaign.managerName },
  }))).filter(({ campaign, account }) => {
    const text = `${campaign.name} ${campaign.managerName} ${campaign.objective} ${account.name} ${campaign.ads.map(ad => ad.name).join(' ')}`.toLowerCase();
    return (!search.trim() || text.includes(search.trim().toLowerCase())) && (status === 'all' || (status === 'ACTIVE' ? campaign.status === 'ACTIVE' : campaign.status !== 'ACTIVE'));
  }), [data, managerOverrides, search, status]);
  const summary = useMemo(() => filtered.reduce((total, { campaign }) => ({
    campaigns: total.campaigns + 1,
    ads: total.ads + campaign.ads.length,
    spend: total.spend + campaign.metrics.spend,
    leads: total.leads + (campaign.metrics.leads || 0),
    interactions: total.interactions + (campaign.metrics.interactions || 0),
  }), { campaigns: 0, ads: 0, spend: 0, leads: 0, interactions: 0 }), [filtered]);
  const currencies = [...new Set(filtered.map(({ account }) => account.currency))];
  const commonCurrency = currencies.length === 1 ? currencies[0] : '';
  const chartPoints: ChartPoint[] = useMemo(() => filtered.map(({ campaign, account }) => ({
    key: `${account.id}:${campaign.id}`, name: campaign.name, managerName: campaign.managerName, currency: account.currency,
    costPerLead: campaign.metrics.costPerLead, leads: campaign.metrics.leads, interactions: campaign.metrics.interactions,
  })).sort((a, b) => (b.leads || 0) - (a.leads || 0) || a.name.localeCompare(b.name, 'ar')), [filtered]);

  function updatePreset(value: Preset) {
    if (value === 'custom') {
      if (!dateFrom) setDateFrom(defaultRangeDate(29));
      if (!dateTo) setDateTo(defaultRangeDate(0));
    }
    setPreset(value);
  }
  function changeDate(value: string, field: 'from' | 'to') {
    if (field === 'from') { setDateFrom(value); if (!dateTo) setDateTo(defaultRangeDate(0)); }
    else { setDateTo(value); if (!dateFrom) setDateFrom(defaultRangeDate(29)); }
    setPreset('custom');
  }
  async function saveManager(accountId: string, campaignId: string, managerName: string) {
    const result = await marketingFetch<{ ok: true; managerName: string }>('/api/marketing', {
      method: 'POST', body: JSON.stringify({ action: 'save_meta_ads_campaign_manager', accountId, campaignId, managerName }),
    });
    setManagerOverrides(current => ({ ...current, [`${accountId}:${campaignId}`]: result.managerName }));
  }

  return <div className="marketing-meta-ads">
    <section className="panel marketing-engagement-panel marketing-meta-ads-intro"><header><div>
      <h3>الحملات والإعلانات الممولة — Meta Ads Manager</h3>
      <p>قراءة حقيقية مستقلة من الحساب الإعلاني، بما فيها الإعلانات غير الظاهرة في منشورات الصفحة. البيانات للفترة المحددة فقط ولا تضيف عملاء أو تعدل الحملات في CRM.</p>
    </div><button type="button" className="secondary-button" onClick={() => setReloadCount(n => n + 1)} disabled={loading}><ArrowClockwise size={17} className={loading ? 'spin' : ''} /> تحديث بيانات Meta Ads</button></header>
      <div className="marketing-engagement-control-panel marketing-meta-ads-filters">
        <label><span>الفترة الإعلانية</span><select value={preset} onChange={event => updatePreset(event.target.value as Preset)}>{PRESETS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label><span>من تاريخ</span><input type="date" value={dateFrom} max={dateTo || undefined} onChange={event => changeDate(event.target.value, 'from')} /></label>
        <label><span>إلى تاريخ</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={event => changeDate(event.target.value, 'to')} /></label>
        <label><span>الحساب الإعلاني</span><select value={selectedAccount} onChange={event => setSelectedAccount(event.target.value)}><option value="">كل الحسابات المرتبطة</option>{(data?.accounts || []).map(account => <option key={account.id} value={account.id}>{account.name} — {accountNumber(account.id)}</option>)}</select></label>
        <label><span>حالة الحملة</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">كل الحالات</option><option value="ACTIVE">النشطة</option><option value="other">المتوقفة وغيرها</option></select></label>
        <div className="marketing-engagement-search"><MagnifyingGlass size={18}/><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="اسم الحملة أو مديرها أو الإعلان" /></div>
      </div>
      {customRangeInvalid && <MarketingAlert type="info">اختر تاريخ البداية والنهاية بشكل صحيح؛ التاريخ الأول يجب ألا يكون بعد الثاني.</MarketingAlert>}
      {data?.syncedAt && data.status === 'ready' && <small className="mkw-muted">آخر قراءة مباشرة: {marketingDate(data.syncedAt, true)} · {data.dateRange ? `من ${data.dateRange.since} إلى ${data.dateRange.until} (شاملًا اليومين)` : 'النتائج حسب الفترة المختارة'}</small>}
      {data?.note && <MarketingAlert type="info">{data.note}</MarketingAlert>}
      {error && <MarketingAlert>{error}</MarketingAlert>}
      {data?.errors?.map(item => <MarketingAlert key={item.accountId}>{item.accountId}: {item.message}</MarketingAlert>)}
      {data?.truncatedAccounts && <MarketingAlert type="info">يوجد حسابات أكثر من حد القراءة الحالية. حدد حسابات MZJ المطلوبة في إعداد META_AD_ACCOUNT_IDS.</MarketingAlert>}
      {(data?.reports || []).some(report => report.incomplete) && <MarketingAlert type="info">بعض الحسابات لديها نتائج أكثر من حدود القراءة في الدفعة الحالية؛ الأرقام الظاهرة تخص البيانات التي أعادتها Meta فقط.</MarketingAlert>}
    </section>
    {data?.status === 'needs_permission' && <section className="panel marketing-meta-ads-setup"><h4>تفعيل قراءة إعلانات Meta</h4><p>صلاحيات المنشورات لا تمنح تلقائيًا صلاحية الحملات الممولة. أضف <code>ads_read</code> إلى إعداد Meta Login for Business المستخدم في الربط، ثم أعد ربط Facebook. أو اربط توكن System User للقراءة فقط عبر <code>META_ADS_ACCESS_TOKEN</code> مع حق الوصول إلى الحساب الإعلاني.</p><p>لن تتأثر مزامنة المنشورات والتعليقات الحالية.</p></section>}
    {data?.status === 'ready' && <>
      <section className="marketing-engagement-stats marketing-meta-ads-stats">
        <article><Megaphone size={24}/><span>الحملات</span><strong>{num(summary.campaigns)}</strong><small>{num(summary.ads)} إعلان مرتبط بها</small></article>
        <article><Wallet size={24}/><span>المبلغ المصروف</span><strong>{commonCurrency ? money(summary.spend, commonCurrency) : 'حسب كل حساب'}</strong><small>الصرف الفعلي في الفترة المحددة</small></article>
        <article><UsersThree size={24}/><span>ليدات الإعلانات</span><strong>{num(summary.leads)}</strong><small>حسب إجراءات Meta وليس إجمالي CRM</small></article>
        <article><ChartLineUp size={24}/><span>تكلفة الليد</span><strong>{commonCurrency && summary.leads ? money(summary.spend / summary.leads, commonCurrency) : '—'}</strong><small>صرف الفترة ÷ ليداتها</small></article>
        <article><FacebookLogo size={24}/><span>تفاعلات الإعلانات</span><strong>{num(summary.interactions)}</strong><small>ما توفر من بيانات التفاعل لدى Meta</small></article>
      </section>
      {chartPoints.length > 0 && <div className="marketing-meta-ads-charts" aria-label="الرسوم البيانية للحملات الإعلانية"><CampaignOverviewChart points={chartPoints} /></div>}
      <div className="marketing-meta-ads-list">{filtered.map(({ campaign, account }) => <details key={`${account.id}:${campaign.id}`} id={campaignDomId(`${account.id}:${campaign.id}`)} className="panel marketing-meta-ads-campaign">
        <summary className="marketing-meta-ads-campaign-summary">
          <div><span className="marketing-meta-ads-account">{account.name} · {accountNumber(account.id)}</span><h4>{campaign.name}</h4><small>مدير الحملة: {campaign.managerName || 'غير محدد'} · {campaign.objective || 'الهدف غير مسجل'} · {campaign.ads.length} إعلان · بداية {marketingDate(campaign.startTime)}</small></div>
          <span className={`marketing-meta-ads-status ${campaign.status === 'ACTIVE' ? 'is-active' : ''}`}>{adStatus(campaign.status)}</span>
          <strong>{money(campaign.metrics.spend, account.currency)}</strong><span className="marketing-meta-ads-open">تفاصيل الحملة والإعلانات</span>
        </summary>
        <div className="marketing-meta-ads-campaign-body">
          <CampaignManagerEditor managerName={campaign.managerName} editable={canEditManager} onSave={name => saveManager(account.id, campaign.id, name)} />
          <div className="marketing-meta-ads-metrics"><div><small>ميزانية يومية</small><strong>{money(campaign.dailyBudget, account.currency)}</strong></div><div><small>ميزانية إجمالية</small><strong>{money(campaign.lifetimeBudget, account.currency)}</strong></div><div><small>الوصول</small><strong>{num(campaign.metrics.reach)}</strong></div><div><small>الظهور</small><strong>{num(campaign.metrics.impressions)}</strong></div><div><small>النقرات</small><strong>{num(campaign.metrics.clicks)}</strong></div><div><small>CTR</small><strong>{campaign.metrics.ctr === null ? '—' : `${num(campaign.metrics.ctr, 2)}%`}</strong></div><div><small>الليدات</small><strong>{num(campaign.metrics.leads)}</strong></div><div><small>تكلفة الليد</small><strong>{money(campaign.metrics.costPerLead, account.currency)}</strong></div><div><small>التفاعلات</small><strong>{num(campaign.metrics.interactions)}</strong></div></div>
          <p className="marketing-meta-ads-note">الميزانية المعروضة للحملة فقط؛ في بعض حملات Meta يتم تحديد الميزانية على مستوى مجموعة الإعلانات. القياسات تشمل الفترة المختارة ولا يُفترض أن تساوي العدد الكلي في CRM.</p>
          <a className="secondary-button small" href={campaignUrl(account.id, campaign.id)} target="_blank" rel="noreferrer"><LinkSimple size={16}/> فتح الحملة في Ads Manager</a>
          <h5>الإعلانات التابعة للحملة</h5>
          <div className="marketing-engagement-table-wrap"><table className="marketing-engagement-table marketing-meta-ads-table"><thead><tr><th>الإعلان</th><th>الحالة</th><th>الصرف</th><th>الوصول</th><th>الظهور</th><th>النقرات</th><th>الليدات</th><th>تكلفة الليد</th><th>التفاعلات</th><th>فتح</th></tr></thead><tbody>
            {campaign.ads.map(ad => <tr key={ad.id}><td><div className="marketing-meta-ads-ad-identify">{ad.thumbnailUrl && /^https:\/\//i.test(ad.thumbnailUrl) ? <img src={ad.thumbnailUrl} alt="معاينة الكرييتيف" loading="lazy"/> : null}<span><strong>{ad.name}</strong><small>{ad.adsetName || 'مجموعة الإعلان غير مسجلة'}</small></span></div></td><td>{adStatus(ad.status)}</td><td>{money(ad.metrics.spend, account.currency)}</td><td>{num(ad.metrics.reach)}</td><td>{num(ad.metrics.impressions)}</td><td>{num(ad.metrics.clicks)}</td><td>{num(ad.metrics.leads)}</td><td>{money(ad.metrics.costPerLead, account.currency)}</td><td>{num(ad.metrics.interactions)}</td><td><a href={adUrl(account.id, ad.id)} target="_blank" rel="noreferrer" className="secondary-button small"><LinkSimple size={15}/> فتح</a></td></tr>)}
            {!campaign.ads.length && <tr><td colSpan={10} className="empty-cell">لا توجد إعلانات مرتبطة بالحملة ضمن البيانات المتاحة حاليًا.</td></tr>}
          </tbody></table></div>
        </div>
      </details>)}
      {!filtered.length && <div className="panel marketing-meta-ads-empty">{loading ? 'جاري القراءة من Meta Ads...' : 'لا توجد حملات مطابقة للفلاتر المختارة. جرّب عرض جميع الحالات أو اختيار حساب آخر.'}</div>}
      </div>
    </>}
    {loading && <p className="marketing-meta-ads-loading" role="status"><ArrowClockwise size={18} className="spin" /> جاري قراءة الحملات والإعلانات من Meta Ads Manager...</p>}
    {data?.status === 'needs_account' && <p className="panel marketing-meta-ads-empty">راجع وصول التوكن إلى الحساب الإعلاني من Meta Business Settings.</p>}
    <p className="marketing-meta-account-disclaimer">المنشورات العادية تظل في تبويب «تفاعل النشر»، والحملات التي أنشأها السيستم تظل في «نتائج الحملات». هنا تظهر الحملات والإعلانات الممولة مباشرة من Ads Manager بصلاحيات قراءة فقط.</p>
  </div>;
}
