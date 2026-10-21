import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, ChartLineUp, CurrencyDollar, GoogleLogo, LinkSimple, MagnifyingGlass, Megaphone, PauseCircle, PlayCircle, PlusCircle, UsersThree, Wallet } from '@phosphor-icons/react';
import { useAuth } from '../../auth/AuthContext';
import { hasPermission } from '../../systemAccess';
import { marketingDate, marketingFetch, marketingLocalDateKey, marketingQuery } from '../api';
import { MarketingAlert } from './MarketingPage';

type AdsAccount = { id: string; name: string; currency: string; timeZone: string; manager: boolean; loginCustomerId: string };
type AdsMetrics = { spend: number; impressions: number; clicks: number; ctr: number; engagements: number; conversions: number; leads: number | null; costPerLead: number | null };
type GoogleCampaign = { id: string; accountId: string; name: string; status: string; channel: string; startTime: string; stopTime: string; dailyBudget: number | null; metrics: AdsMetrics; ads: { id: string; name: string; status: string; type: string }[] };
type AccountReport = { account: AdsAccount; campaigns: GoogleCampaign[]; incomplete: boolean; warnings: string[] };
type AdsResponse = { ok: true; status: string; accounts: AdsAccount[]; reports: AccountReport[]; errors: { accountId: string; message: string }[]; preset: string; dateRange: { since: string; until: string } | null; syncedAt: string; note: string };
type Preset = 'today' | 'yesterday' | 'last_7d' | 'last_30d' | 'this_month' | 'custom';
const PRESETS: { label: string; value: Preset }[] = [
  { label: 'اليوم', value: 'today' }, { label: 'أمس', value: 'yesterday' },
  { label: 'آخر 7 أيام', value: 'last_7d' }, { label: 'آخر 30 يومًا', value: 'last_30d' },
  { label: 'الشهر الحالي', value: 'this_month' }, { label: 'من تاريخ إلى تاريخ', value: 'custom' },
];
function format(value: number | null | undefined, decimal = 0) {
  return value == null ? '—' : value.toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: decimal, maximumFractionDigits: decimal });
}
function money(value: number | null | undefined, currency: string) { return value == null ? '—' : `${format(value, 2)} ${currency}`; }
function state(status: string) { return status === 'ENABLED' ? 'نشطة' : status === 'PAUSED' ? 'متوقفة' : status === 'REMOVED' ? 'محذوفة' : status || '—'; }
function accountLink(id: string, campaignId?: string) {
  const base = `https://ads.google.com/aw/campaigns?ocid=${encodeURIComponent(id)}`;
  return campaignId ? `${base}&campaignId=${encodeURIComponent(campaignId)}` : base;
}
const DEFAULT_DRAFT = { name: '', dailyBudget: '50', finalUrl: '', headlines: '', descriptions: '', keywords: '' };

export function GoogleAdsPanel() {
  const { user } = useAuth();
  const canCreate = hasPermission(user, 'marketing.campaign.create');
  const canEdit = hasPermission(user, 'marketing.campaign.edit');
  const [data, setData] = useState<AdsResponse | null>(null);
  const requestVersion = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const [preset, setPreset] = useState<Preset>('last_30d');
  const [dateFrom, setDateFrom] = useState(marketingLocalDateKey(new Date(Date.now() - 29 * 86400_000)));
  const [dateTo, setDateTo] = useState(marketingLocalDateKey());
  const [accountId, setAccountId] = useState('');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const customDateError = preset === 'custom' && (!dateFrom || !dateTo || dateFrom > dateTo);

  const load = useCallback(async () => {
    if (customDateError) return;
    const version = ++requestVersion.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    let timedOut = false;
    const deadline = window.setTimeout(() => { timedOut = true; controller.abort(); }, 25_000);
    setLoading(true); setError('');
    try {
      const result = await marketingFetch<AdsResponse>(`/api/marketing${marketingQuery({resource: 'google_ads', preset: preset === 'custom' ? 'last_30d' : preset, accountId, dateFrom: preset === 'custom' ? dateFrom : undefined, dateTo: preset === 'custom' ? dateTo : undefined})}`, { signal: controller.signal });
      if (requestVersion.current === version) setData(result);
    } catch (failure) {
      if (requestVersion.current === version) setError(timedOut ? 'انتهت مهلة قراءة Google Ads؛ جرب تحديث البيانات.' : failure instanceof Error ? failure.message : 'تعذر تحميل Google Ads');
    } finally {
      window.clearTimeout(deadline);
      if (requestVersion.current === version) { activeRequest.current = null; setLoading(false); }
    }
  }, [accountId, customDateError, dateFrom, dateTo, preset]);

  useEffect(() => {
    void load();
    return () => { activeRequest.current?.abort(); activeRequest.current = null; ++requestVersion.current; };
  }, [load]);
  const filtered = useMemo(() => (data?.reports || []).flatMap(report => report.campaigns.map(campaign => ({ account: report.account, campaign })))
    .filter(row => status === 'all' || row.campaign.status === status)
    .filter(row => !search.trim() || `${row.campaign.name} ${row.campaign.id} ${row.account.name} ${row.campaign.ads.map(ad => ad.name).join(' ')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((left, right) => right.campaign.metrics.spend - left.campaign.metrics.spend), [data, status, search]);
  const reports = data?.reports || [];
  const commonCurrency = reports.length && reports.every(report => report.account.currency === reports[0].account.currency) ? reports[0].account.currency : '';
  const totals = useMemo(() => reports.reduce((all, report) => {
    for (const campaign of report.campaigns) {
      all.campaigns += 1;
      all.spend += campaign.metrics.spend;
      all.clicks += campaign.metrics.clicks;
      all.impressions += campaign.metrics.impressions;
      all.engagements += campaign.metrics.engagements;
      if (campaign.metrics.leads === null) all.leadsKnown = false;
      else all.leads += campaign.metrics.leads;
    }
    return all;
  }, { campaigns: 0, spend: 0, clicks: 0, impressions: 0, engagements: 0, leads: 0, leadsKnown: true }), [reports]);

  async function changeCampaign(account: AdsAccount, campaign: GoogleCampaign, newStatus: 'ENABLED' | 'PAUSED') {
    if (newStatus === 'ENABLED' && !window.confirm(`تشغيل الحملة «${campaign.name}» على حساب ${account.name} قد يؤدي إلى خصم مبالغ حقيقية من ميزانية Google Ads. هل تؤكد التشغيل؟`)) return;
    if (newStatus === 'PAUSED' && !window.confirm(`هل تريد إيقاف حملة «${campaign.name}» مؤقتًا على Google Ads؟`)) return;
    setBusy(`${account.id}:${campaign.id}`); setError(''); setMessage('');
    try {
      const result = await marketingFetch<{message:string}>('/api/marketing', { method: 'POST', body: JSON.stringify({action:'google_ads_campaign_status',accountId:account.id,campaignId:campaign.id,status:newStatus,confirmSpend:newStatus==='ENABLED'}) });
      setMessage(result.message);
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر تغيير حالة الحملة'); }
    finally { setBusy(''); }
  }

  async function createSearchCampaign() {
    const target = data?.accounts.find(account => account.id === accountId && !account.manager)
      || (data?.accounts.filter(account => !account.manager).length === 1 ? data?.accounts.find(account => !account.manager) : undefined);
    if (!target) { setError('اختر الحساب الإعلاني الذي تريد إنشاء الحملة داخله من فلتر الحسابات أولًا.'); return; }
    if (!window.confirm(`سيتم إنشاء حملة Search جديدة في حساب ${target.name} بحالة «متوقفة مؤقتًا». لن يبدأ الصرف إلا بعد تشغيلك للحملة صراحة. متابعة؟`)) return;
    setBusy('create'); setError(''); setMessage('');
    try {
      const result = await marketingFetch<{message:string}>('/api/marketing', { method:'POST', body:JSON.stringify({action:'google_ads_create_search',accountId:target.id,...draft,
        headlines:draft.headlines.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
        descriptions:draft.descriptions.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
        keywords:draft.keywords.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
      }) });
      setMessage(result.message); setShowCreate(false); setDraft(DEFAULT_DRAFT); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر إنشاء حملة Search'); }
    finally { setBusy(''); }
  }

  return <div className="marketing-google-ads marketing-meta-ads">
    <section className="panel marketing-meta-ads-intro marketing-google-ads-intro">
      <header className="marketing-google-ads-hero">
        <div className="marketing-google-ads-heading">
          <span className="marketing-google-ads-logo" aria-hidden="true"><GoogleLogo size={27} weight="bold" /></span>
          <span className="marketing-google-ads-heading-text">
            <h3>حملات Google Ads</h3>
            <p>إدارة الحملات الممولة، قياس الإنفاق والتحويلات، ومقارنة الأداء بين الحسابات الإعلانية.</p>
            <small>حساب Google الموحد مع YouTube — مع الحفاظ على ربط ونشر YouTube مستقلًا.</small>
          </span>
        </div>
        <div className="marketing-google-ads-actions">
          <span className={`marketing-google-ads-connection-badge ${loading ? 'pending' : data?.status === 'ready' ? 'connected' : 'needs-setup'}`}>
            {loading ? 'جاري جلب الحملات' : data?.status === 'ready' ? `${reports.length} حساب جاهز` : 'يلزم التحقق من الربط'}
          </span>
          <div className="marketing-google-ads-action-row">
            {canCreate && <button type="button" className="primary-button" onClick={() => setShowCreate(value => !value)}><PlusCircle size={18}/>حملة Search جديدة</button>}
            <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
              <ArrowClockwise size={18} className={loading ? 'marketing-spin' : ''} />{loading ? 'جاري التحديث' : 'تحديث البيانات'}
            </button>
          </div>
        </div>
      </header>
      <div className="marketing-meta-ads-filters marketing-google-ads-filters">
        <label><span>الفترة</span><select value={preset} onChange={event => setPreset(event.target.value as Preset)}>{PRESETS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {preset === 'custom' && <><label><span>من</span><input type="date" max={dateTo || undefined} value={dateFrom} onChange={event => setDateFrom(event.target.value)}/></label><label><span>إلى</span><input type="date" min={dateFrom || undefined} value={dateTo} onChange={event => setDateTo(event.target.value)}/></label></>}
        <label><span>حساب Google Ads</span><select value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">كل الحسابات المختارة</option>{(data?.accounts || []).filter(account => !account.manager).map(account => <option key={account.id} value={account.id}>{account.name} — {account.id} ({account.currency})</option>)}</select></label>
        <label><span>حالة الحملة</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">كل الحالات</option><option value="ENABLED">نشطة</option><option value="PAUSED">متوقفة</option></select></label>
        <div className="marketing-engagement-search"><MagnifyingGlass size={18}/><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="بحث باسم الحملة أو الإعلان أو الحساب"/></div>
      </div>
      {customDateError && <MarketingAlert>راجع فترة التاريخ: اختار تاريخ البداية والنهاية بالترتيب الصحيح.</MarketingAlert>}
      {data?.status !== 'ready' && !loading && (data?.status === 'needs_connection' || data?.status === 'needs_account') && (
        <div className="marketing-google-ads-setup-banner" role="status">
          <div className="marketing-google-ads-setup-icon"><LinkSimple size={22} /></div>
          <div><strong>{data.status === 'needs_account' ? 'اختيار الحسابات الإعلانية مطلوب' : 'Google Ads غير مرتبط بعد'}</strong>
            <p>{data.note || 'أكمل ربط Google Ads في إعدادات التسويق، ثم اختر الحسابين الإعلانيين.'}</p></div>
          <a className="secondary-button small" href="/settings?section=marketing&tab=platforms">فتح ربط المنصات</a>
        </div>
      )}
      {data?.note && data.status !== 'needs_connection' && data.status !== 'needs_account' && <MarketingAlert type="info">{data.note}</MarketingAlert>}
      {error && <MarketingAlert>{error}</MarketingAlert>}
      {message && <MarketingAlert type="success">{message}</MarketingAlert>}
      {(data?.errors || []).map(item => <MarketingAlert key={item.accountId}>{item.accountId}: {item.message}</MarketingAlert>)}
      {reports.some(report => report.incomplete) && <MarketingAlert type="info">بعض الحسابات تتجاوز حد القراءة في الطلب الحالي؛ لا تعتبر إجمالياتها نهائية.</MarketingAlert>}
      {reports.flatMap(report => report.warnings).map((item, index) => <MarketingAlert key={index} type="info">{item}</MarketingAlert>)}
      {data?.syncedAt && data.status === 'ready' && <small className="mkw-muted">آخر قراءة من Google Ads: {marketingDate(data.syncedAt, true)} — نتائج الفترة المختارة وليس عدد عملاء CRM.</small>}
    </section>

    {showCreate && canCreate && <section className="panel marketing-google-ads-create">
      <h3>إنشاء حملة Search بحالة متوقفة (PAUSED)</h3>
      <p>الحملة تتضمن الميزانية ومجموعة إعلانات وكلمات بحث وإعلانًا نصيًا متجاوبًا. لن يبدأ صرف إعلاني بدون تشغيل الحملة صراحة.</p>
      <div className="marketing-google-ads-form">
        <label><span>اسم الحملة</span><input value={draft.name} maxLength={120} onChange={event => setDraft(current => ({...current,name:event.target.value}))} placeholder="بحث سيارات MZJ"/></label>
        <label><span>الميزانية اليومية بعملة الحساب</span><input type="number" min={10} max={100000} value={draft.dailyBudget} onChange={event => setDraft(current => ({...current,dailyBudget:event.target.value}))}/></label>
        <label className="wide"><span>رابط الموقع / صفحة الهبوط</span><input dir="ltr" type="url" value={draft.finalUrl} onChange={event => setDraft(current => ({...current,finalUrl:event.target.value}))} placeholder="https://..."/></label>
        <label><span>العناوين — عنوان في كل سطر (3–15، حتى 30 حرفًا)</span><textarea rows={5} value={draft.headlines} onChange={event => setDraft(current => ({...current,headlines:event.target.value}))} placeholder={'اختر سيارتك من MZJ\nعروض سيارات جديدة\nاطلب سيارتك أونلاين'}/></label>
        <label><span>الأوصاف — وصف في كل سطر (2–4، حتى 90 حرفًا)</span><textarea rows={5} value={draft.descriptions} onChange={event => setDraft(current => ({...current,descriptions:event.target.value}))} placeholder={'تصفح السيارات المتاحة وتعرّف على تفاصيلها عبر موقعنا.\nاطلب سيارتك بسهولة من خلال موقع محمد ذعار العجمي للسيارات.'}/></label>
        <label className="wide"><span>الكلمات المفتاحية — كلمة أو عبارة في كل سطر</span><textarea rows={4} value={draft.keywords} onChange={event => setDraft(current => ({...current,keywords:event.target.value}))} placeholder={'سيارات جديدة للبيع\nسيارات هيونداي السعودية\nشراء سيارة أونلاين'}/></label>
      </div>
      <p className="marketing-google-ads-disclaimer">الإعداد الافتراضي: استهداف السعودية، وشبكة بحث Google. راجع إعدادات الموقع والتحويلات والسياسات داخل Google Ads قبل تشغيل الحملة. التشغيل يحتاج موافقة منفصلة.</p>
      <div className="marketing-google-ads-action-row"><button type="button" className="primary-button" disabled={busy === 'create'} onClick={() => void createSearchCampaign()}>{busy === 'create' ? 'جاري التحقق من Google...' : 'إنشاء الحملة المتوقفة'}</button><button type="button" className="secondary-button" onClick={() => setShowCreate(false)}>إلغاء</button></div>
    </section>}

    {data?.status === 'ready' && <>
      <section className="marketing-engagement-stats marketing-meta-ads-stats" aria-label="ملخص حملات Google Ads">
        <article><Megaphone size={24}/><span>إجمالي الحملات</span><strong>{format(totals.campaigns)}</strong><small>{reports.length} حساب إعلاني</small></article>
        <article><Wallet size={24}/><span>الإنفاق</span><strong>{commonCurrency ? money(totals.spend,commonCurrency) : 'حسب الحساب'}</strong><small>خلال الفترة المختارة</small></article>
        <article><UsersThree size={24}/><span>الليدات</span><strong>{totals.leadsKnown ? format(totals.leads) : '—'}</strong><small>تحويلات Google المصنفة كعملاء، وليس سجلات CRM</small></article>
        <article><ChartLineUp size={24}/><span>تكلفة الليد</span><strong>{commonCurrency && totals.leadsKnown && totals.leads ? money(totals.spend/totals.leads,commonCurrency) : '—'}</strong><small>الإنفاق / الليدات المتاحة</small></article>
        <article><CurrencyDollar size={24}/><span>النقرات</span><strong>{format(totals.clicks)}</strong><small>{format(totals.impressions)} ظهور</small></article>
      </section>
      <div className="marketing-google-ads-account-reports">
        {reports.map(report => {
          const rows = filtered.filter(row => row.account.id === report.account.id);
          const accountTotal = report.campaigns.reduce((value,campaign) => value+campaign.metrics.spend,0);
          const maxLeads = Math.max(1,...rows.map(row => row.campaign.metrics.leads || 0));
          return <section className="panel marketing-google-ads-account" key={report.account.id}>
            <header><div><h3>{report.account.name || report.account.id}</h3><small dir="ltr">{report.account.id} · {report.account.currency}</small></div><strong>{money(accountTotal,report.account.currency)}</strong><a className="secondary-button small" href={accountLink(report.account.id)} rel="noreferrer" target="_blank"><LinkSimple size={16}/>Google Ads</a></header>
            {!!rows.length && <div className="marketing-google-ads-chart" aria-label="عدد الليدات لكل حملة">{rows.slice(0,8).map(({campaign}) => <div key={campaign.id} className="marketing-google-ads-chart-row"><span title={campaign.name}><bdi dir="auto">{campaign.name}</bdi></span><div className="marketing-google-ads-track"><i style={{width:`${((campaign.metrics.leads || 0)/maxLeads)*100}%`}}/></div><strong>{format(campaign.metrics.leads)}</strong></div>)}</div>}
            <div className="marketing-google-ads-campaign-list">{rows.map(({campaign}) => <details key={campaign.id} className="marketing-google-ads-campaign">
              <summary><div><strong dir="auto">{campaign.name}</strong><small>{campaign.channel || '—'} · {campaign.ads.length} إعلان · بداية {campaign.startTime || '—'}</small></div><span className={`marketing-google-ads-status ${campaign.status === 'ENABLED' ? 'active' : ''}`}>{state(campaign.status)}</span><b>{money(campaign.metrics.spend,report.account.currency)}</b></summary>
              <div className="marketing-google-ads-campaign-content"><div className="marketing-meta-ads-metrics">
                <div><small>الميزانية اليومية</small><strong>{money(campaign.dailyBudget,report.account.currency)}</strong></div>
                <div><small>الظهور</small><strong>{format(campaign.metrics.impressions)}</strong></div>
                <div><small>النقرات</small><strong>{format(campaign.metrics.clicks)}</strong></div>
                <div><small>CTR</small><strong>{campaign.metrics.ctr == null ? '—' : `${format(campaign.metrics.ctr,2)}%`}</strong></div>
                <div><small>التحويلات</small><strong>{format(campaign.metrics.conversions,1)}</strong></div>
                <div><small>الليدات</small><strong>{format(campaign.metrics.leads)}</strong></div>
                <div><small>تكلفة الليد</small><strong>{money(campaign.metrics.costPerLead,report.account.currency)}</strong></div>
                <div><small>التفاعلات</small><strong>{format(campaign.metrics.engagements)}</strong></div>
              </div><p className="marketing-google-ads-disclaimer">عدد الليدات تقديري وفق فئات التحويل المسجلة في Google Ads. لا تتم مزامنة عملاء CRM من هذه القراءة، ولا يتم خصم الإنفاق أثناء عرض النتائج.</p>
                {canEdit && ['PAUSED','ENABLED'].includes(campaign.status) && <button type="button" className={campaign.status === 'ENABLED' ? 'secondary-button' : 'primary-button'} disabled={busy === `${report.account.id}:${campaign.id}`} onClick={() => void changeCampaign(report.account,campaign,campaign.status === 'ENABLED' ? 'PAUSED' : 'ENABLED')}>{campaign.status === 'ENABLED' ? <><PauseCircle size={18}/>إيقاف الحملة</> : <><PlayCircle size={18}/>تشغيل الحملة (قد يبدأ الصرف)</>}</button>}
                <a href={accountLink(report.account.id,campaign.id)} target="_blank" rel="noreferrer" className="secondary-button small"><LinkSimple size={16}/>فتح الحملة في Google Ads</a>
                <h4>الإعلانات التابعة</h4>
                {campaign.ads.length ? <ul>{campaign.ads.map(ad => <li key={ad.id}><strong dir="auto">{ad.name}</strong> · {ad.type} · {state(ad.status)}</li>)}</ul> : <p>لا توجد تفاصيل إعلانات متاحة لهذه الحملة.</p>}
              </div>
            </details>)}</div>
            {!rows.length && <p>لا توجد حملات مطابقة لخيارات البحث والفلاتر في هذا الحساب.</p>}
          </section>;
        })}
      </div>
    </>}
    {loading && !data && <section className="panel marketing-google-ads-loading-card" role="status" aria-live="polite">
      <ArrowClockwise size={21} className="marketing-spin" />
      <div><strong>جاري قراءة نتائج Google Ads...</strong><small>يمكنك التنقل في الصفحة، وسيظهر كل حساب بمجرد انتهاء القراءة من Google.</small></div>
    </section>}
  </div>;
}
