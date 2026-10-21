import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, ChartLineUp, CheckCircle, CurrencyDollar, FileArrowUp, LinkSimple, MagnifyingGlass, Megaphone, PauseCircle, PlayCircle, PlusCircle, TiktokLogo, UsersThree, WarningCircle, Wallet } from '@phosphor-icons/react';
import { useAuth } from '../../auth/AuthContext';
import { hasPermission } from '../../systemAccess';
import { marketingFetch, marketingLocalDateKey, marketingQuery } from '../api';

type AdsAccount = { id: string; name: string; currency: string; timeZone: string };
type Metrics = { spend: number | null; impressions: number | null; clicks: number | null; ctr: number | null; conversions: number | null; leads: number | null; costPerLead: number | null };
type Campaign = { id: string; accountId: string; name: string; status: string; deliveryStatus: string; objective: string; type: string; budget: number | null; budgetMode: string; createdAt: string; metrics: Metrics };
type AccountReport = { account: AdsAccount; campaigns: Campaign[]; warnings: string[]; incomplete: boolean; metricsAvailable: boolean };
type AdsResponse = { ok: true; status: 'ready' | 'needs_connection' | 'needs_account' | 'failed'; accounts: AdsAccount[]; reports: AccountReport[]; errors: { accountId: string; message: string }[]; dateRange: { since: string; until: string }; syncedAt: string; note: string };
type Preset = 'today' | 'yesterday' | 'last_7d' | 'last_30d' | 'this_month' | 'custom';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'اليوم' }, { value: 'yesterday', label: 'أمس' },
  { value: 'last_7d', label: 'آخر 7 أيام' }, { value: 'last_30d', label: 'آخر 30 يومًا' },
  { value: 'this_month', label: 'الشهر الحالي' }, { value: 'custom', label: 'تاريخ مخصص' },
];
const ROWS_PER_PAGE = 25;
// This is the PUBLIC OAuth client identifier used in the earlier successful local MCP link.
// It is not a secret and can be changed when importing a different authorized file.
const EXISTING_MCP_CLIENT_ID = '9d1ecd6209fada581114c38cb9a43ad3';
const count = (value: number | null | undefined, fraction = 0) => value == null ? '—' : value.toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: fraction, maximumFractionDigits: fraction });
const money = (value: number | null | undefined, currency: string) => value == null ? '—' : `${count(value, 2)}${currency ? ` ${currency}` : ''}`;
function objectiveLabel(value: string) {
  const names: Record<string, string> = { LEAD_GENERATION: 'جمع العملاء المحتملين', REACH: 'الوصول', VIDEO_VIEWS: 'مشاهدات الفيديو', TRAFFIC: 'زيارات', ENGAGEMENT: 'التفاعل', CONVERSIONS: 'التحويلات', PRODUCT_SALES: 'المبيعات', APP_PROMOTION: 'ترويج التطبيق' };
  return names[value] || value || '—';
}
function budgetLabel(campaign: Campaign, currency: string) {
  if (campaign.budgetMode === 'BUDGET_MODE_INFINITE') return 'بدون حد على مستوى الحملة';
  if (campaign.budget == null) return '—';
  const mode = campaign.budgetMode === 'BUDGET_MODE_TOTAL' ? 'إجمالية' : campaign.budgetMode === 'BUDGET_MODE_DAY' || campaign.budgetMode === 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET' ? 'يومية' : 'محددة';
  return `${money(campaign.budget, currency)} (${mode})`;
}
function campaignStatus(campaign: Campaign) {
  if (campaign.status !== 'ENABLE') return 'متوقفة';
  if (campaign.deliveryStatus === 'CAMPAIGN_STATUS_BUDGET_EXCEED') return 'الميزانية مستنفدة';
  if (campaign.deliveryStatus.includes('DELETE')) return 'محذوفة';
  return 'مفعلة';
}
function uploadTokenObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('الملف المختار ليس JSON صالحًا');
  const result = input as Record<string, unknown>;
  const nested = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data as Record<string, unknown> : result;
  if (typeof nested.access_token !== 'string' || typeof nested.refresh_token !== 'string') {
    throw new Error('الملف لا يحتوي على access_token وrefresh_token. استخدم ملف tiktok-mcp-token.json الناتج من الربط السابق.');
  }
  return nested;
}

export function TikTokAdsPanel() {
  const { user } = useAuth();
  const canManage = hasPermission(user, 'marketing.campaign.edit');
  const canCreate = hasPermission(user, 'marketing.campaign.create');
  const [data, setData] = useState<AdsResponse | null>(null);
  const [preset, setPreset] = useState<Preset>('last_30d');
  const [dateFrom, setDateFrom] = useState(marketingLocalDateKey(new Date(Date.now() - 29 * 86400_000)));
  const [dateTo, setDateTo] = useState(marketingLocalDateKey());
  const [accountId, setAccountId] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ name: '', objective: 'LEAD_GENERATION', budgetMode: 'BUDGET_MODE_DAY', budget: '100' });
  const [clientId, setClientId] = useState(EXISTING_MCP_CLIENT_ID);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const requestId = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const dateError = preset === 'custom' && (!dateFrom || !dateTo || dateFrom > dateTo);

  const load = useCallback(async (fresh = false) => {
    if (dateError) return;
    const current = ++requestId.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    let timedOut = false;
    const deadline = window.setTimeout(() => { timedOut = true; controller.abort(); }, 55_000);
    setLoading(true); setError('');
    try {
      const query = marketingQuery({ resource: 'tiktok_ads', accountId, preset, dateFrom: preset === 'custom' ? dateFrom : undefined, dateTo: preset === 'custom' ? dateTo : undefined, refresh: fresh ? 'true' : undefined });
      const result = await marketingFetch<AdsResponse>(`/api/marketing${query}`, { signal: controller.signal });
      if (requestId.current !== current) return;
      setData(result);
      if (result.status === 'needs_connection') setShowConnect(true);
    } catch (failure) {
      if (requestId.current === current) setError(timedOut ? 'انتهت مهلة TikTok MCP. جرب التحديث أو اختر حسابًا واحدًا.' : failure instanceof Error ? failure.message : 'تعذر قراءة TikTok Ads');
    } finally {
      window.clearTimeout(deadline);
      if (requestId.current === current) { activeRequest.current = null; setLoading(false); }
    }
  }, [accountId, dateError, dateFrom, dateTo, preset]);

  useEffect(() => {
    void load();
    return () => { activeRequest.current?.abort(); activeRequest.current = null; ++requestId.current; };
  }, [load]);
  useEffect(() => { setPage(1); }, [accountId, search, statusFilter, preset]);

  const rows = useMemo(() => (data?.reports || []).flatMap(report => report.campaigns.map(campaign => ({ account: report.account, campaign })))
    .filter(row => statusFilter === 'all' || row.campaign.status === statusFilter)
    .filter(row => !search.trim() || `${row.campaign.name} ${row.campaign.id} ${row.account.name} ${row.campaign.objective}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(b.campaign.metrics.spend ?? -1) - Number(a.campaign.metrics.spend ?? -1)), [data, search, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const visibleRows = rows.slice((Math.min(page, totalPages) - 1) * ROWS_PER_PAGE, Math.min(page, totalPages) * ROWS_PER_PAGE);
  const reports = data?.reports || [];
  const totalCampaigns = reports.reduce((sum, report) => sum + report.campaigns.length, 0);
  const commonCurrency = reports.length && reports.every(report => report.account.currency && report.account.currency === reports[0].account.currency) ? reports[0].account.currency : '';
  const completeMetrics = reports.length > 0 && reports.every(report => report.metricsAvailable);
  const sum = (key: 'spend' | 'clicks' | 'impressions' | 'leads') => reports.reduce((total, report) => total + report.campaigns.reduce((subtotal, campaign) => subtotal + (campaign.metrics[key] || 0), 0), 0);
  const leadsKnown = completeMetrics && reports.every(report => report.campaigns.every(campaign => campaign.metrics.leads !== null));
  const spend = sum('spend');
  const leads = sum('leads');

  async function createDraft() {
    const target = data?.accounts.find(account => account.id === accountId)
      || (data?.accounts.length === 1 ? data.accounts[0] : null);
    if (!target) { setError('اختر الحساب الإعلاني قبل إنشاء مسودة حملة.'); return; }
    if (!window.confirm(`إنشاء حملة «${draft.name}» متوقفة في حساب ${target.name} بميزانية ${draft.budget} من عملة الحساب؟ المسودة وحدها لا تحتوي على إعلانات ولن تبدأ الصرف.`)) return;
    setBusy('create'); setError(''); setMessage('');
    try {
      const result = await marketingFetch<{ message: string }>('/api/marketing', {
        method: 'POST', body: JSON.stringify({ action: 'tiktok_ads_create_campaign', accountId: target.id, name: draft.name, objective: draft.objective, budgetMode: draft.budgetMode, budget: Number(draft.budget) }),
      });
      setMessage(result.message); setShowCreate(false);
      setDraft({ name: '', objective: 'LEAD_GENERATION', budgetMode: 'BUDGET_MODE_DAY', budget: '100' });
      await load(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر إنشاء مسودة الحملة'); }
    finally { setBusy(''); }
  }

  async function linkAccounts() {
    if (!selectedFile) { setError('اختار ملف tiktok-mcp-token.json من الكمبيوتر.'); return; }
    if (selectedFile.size > 64 * 1024) { setError('ملف OAuth كبير بشكل غير متوقع.'); return; }
    setBusy('link'); setError(''); setMessage('');
    try {
      const token = uploadTokenObject(JSON.parse(await selectedFile.text()));
      const result = await marketingFetch<{ message: string }>('/api/marketing', {
        method: 'POST', body: JSON.stringify({ action: 'tiktok_ads_link', clientId: clientId.trim(), token }),
      });
      setMessage(result.message);
      setSelectedFile(null);
      setShowConnect(false);
      setAccountId('');
      await load(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذر توصيل TikTok Ads');
    } finally { setBusy(''); }
  }

  async function disconnect() {
    if (!window.confirm('فصل TikTok Ads فقط؟ لن يتأثر ربط TikTok للنشر أو أي منصة أخرى.')) return;
    setBusy('disconnect'); setError(''); setMessage('');
    try {
      const result = await marketingFetch<{ message: string }>('/api/marketing', { method: 'POST', body: JSON.stringify({ action: 'tiktok_ads_disconnect' }) });
      setMessage(result.message); setData(null); setShowConnect(true); await load(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر فصل الربط'); }
    finally { setBusy(''); }
  }

  async function changeStatus(account: AdsAccount, campaign: Campaign) {
    const enable = campaign.status !== 'ENABLE';
    const confirmation = enable
      ? `تشغيل الحملة «${campaign.name}» قد يبدأ إنفاقًا إعلانيًا حقيقيًا من حساب ${account.name}. هل تؤكد التشغيل؟`
      : `هل تريد إيقاف الحملة «${campaign.name}» داخل TikTok Ads؟`;
    if (!window.confirm(confirmation)) return;
    setBusy(`${account.id}:${campaign.id}`); setError(''); setMessage('');
    try {
      const result = await marketingFetch<{ message: string }>('/api/marketing', {
        method: 'POST', body: JSON.stringify({ action: 'tiktok_ads_campaign_status', accountId: account.id, campaignId: campaign.id, status: enable ? 'ENABLE' : 'DISABLE', confirmSpend: enable }),
      });
      setMessage(result.message); await load(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر تغيير حالة الحملة'); }
    finally { setBusy(''); }
  }

  return <div className="marketing-tiktok-ads" dir="rtl">
    <section className="panel marketing-tiktok-hero">
      <div className="marketing-tiktok-heading">
        <span className="marketing-tiktok-mark"><TiktokLogo size={27} weight="fill"/></span>
        <div><h3>TikTok Ads — الحملات الممولة</h3><p>الحملات والميزانيات والأداء الفعلي من TikTok for Business عبر الاتصال الآمن MCP.</p><small>ربط الإعلانات منفصل تمامًا عن TikTok للنشر وMeta وGoogle Ads.</small></div>
      </div>
      <div className="marketing-tiktok-hero-actions">
        <span className={`marketing-tiktok-badge ${data?.status === 'ready' ? 'ready' : ''}`}>{loading ? 'جارٍ جلب البيانات' : data?.status === 'ready' ? `${reports.length} حساب متصل` : 'الربط مطلوب'}</span>
        <div className="marketing-tiktok-buttons">
          {canCreate && data?.status === 'ready' && <button className="primary-button" type="button" onClick={() => setShowCreate(value => !value)}><PlusCircle size={17}/>مسودة حملة جديدة</button>}
          {canManage && <button className="secondary-button" type="button" onClick={() => setShowConnect(value => !value)}>{data?.status === 'ready' ? 'تجديد ربط MCP' : 'ربط TikTok Ads'}</button>}
          <button className="secondary-button" type="button" onClick={() => void load(true)} disabled={loading}><ArrowClockwise size={17} className={loading ? 'marketing-spin' : ''}/>{loading ? 'جارٍ التحديث' : 'تحديث الآن'}</button>
        </div>
      </div>
    </section>

    {error && <section className="marketing-tiktok-notice error" role="alert"><WarningCircle size={19}/><span>{error}</span></section>}
    {message && <section className="marketing-tiktok-notice success" role="status"><CheckCircle size={19}/><span>{message}</span></section>}

    {showCreate && canCreate && data?.status === 'ready' && <section className="panel marketing-tiktok-create">
      <h4>إنشاء مسودة حملة متوقفة</h4>
      <p>أنشئ الحملة الأساسية فقط بدون مجموعات إعلانية أو إعلانات. لن يبدأ الصرف إلا بعد إكمال إعداداتها وتشغيلها صراحة.</p>
      <div className="marketing-tiktok-create-fields">
        <label>اسم الحملة<input value={draft.name} maxLength={120} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="مثال: MZJ | Sonata | October 2026"/></label>
        <label>الهدف<select value={draft.objective} onChange={event => setDraft(current => ({ ...current, objective: event.target.value }))}><option value="LEAD_GENERATION">عملاء محتملون (Leads)</option><option value="TRAFFIC">زيارات</option><option value="REACH">وصول</option><option value="VIDEO_VIEWS">مشاهدات فيديو</option></select></label>
        <label>نوع الميزانية<select value={draft.budgetMode} onChange={event => setDraft(current => ({ ...current, budgetMode: event.target.value }))}><option value="BUDGET_MODE_DAY">يومية</option><option value="BUDGET_MODE_TOTAL">إجمالية</option></select></label>
        <label>الميزانية بعملة الحساب<input type="number" min="50" step="1" value={draft.budget} onChange={event => setDraft(current => ({ ...current, budget: event.target.value }))}/></label>
      </div>
      <div className="marketing-tiktok-buttons"><button type="button" className="primary-button" disabled={busy === 'create' || !draft.name.trim() || !accountId} onClick={() => void createDraft()}>{busy === 'create' ? 'جارٍ إنشاء المسودة…' : 'إنشاء الحملة المتوقفة'}</button><button type="button" className="secondary-button" onClick={() => setShowCreate(false)}>إلغاء</button></div>
      {!accountId && <small>اختار حساب TikTok واحدًا من فلتر «الحساب الإعلاني» بالأسفل قبل الإنشاء.</small>}
    </section>}

    {showConnect && canManage && <section className="panel marketing-tiktok-connect">
      <div className="marketing-tiktok-connect-title"><FileArrowUp size={26}/><div><h4>ربط حسابات TikTok Ads الموجودة</h4><p>اختار ملف <bdi dir="ltr">tiktok-mcp-token.json</bdi> اللي حفظته تجربة OAuth الناجحة على جهازك. لا ترسل الملف في المحادثة ولا تضفه للسورس؛ التوكن يُرسل إلى سيرفر MZJ بحسابك المسجل ويتحفظ مشفرًا.</p></div></div>
      <div className="marketing-tiktok-connect-fields">
        <label>Client ID للربط الحالي<input dir="ltr" autoComplete="off" value={clientId} onChange={event => setClientId(event.target.value)} placeholder="TikTok MCP public client ID"/></label>
        <label>ملف OAuth المحلي<input type="file" accept=".json,application/json" onChange={event => setSelectedFile(event.target.files?.[0] || null)}/></label>
      </div>
      <div className="marketing-tiktok-buttons"><button type="button" className="primary-button" disabled={busy === 'link' || !selectedFile} onClick={() => void linkAccounts()}>{busy === 'link' ? 'جارٍ فحص التوكن وربط الحسابات…' : 'تأكيد الربط الآمن'}</button>{data?.status === 'ready' && <button type="button" className="secondary-button" disabled={busy === 'disconnect'} onClick={() => void disconnect()}>فصل TikTok Ads فقط</button>}</div>
      <small>لن تُغيَّر أي بيانات للمنشورات أو العملاء أو المنصات الأخرى. التوكن لازم يحتوي على access_token وrefresh_token.</small>
    </section>}

    {data?.status === 'needs_connection' && !canManage && <section className="panel marketing-tiktok-empty">TikTok Ads غير مرتبط. اطلب من مسؤول الحملات ربط ملف OAuth من نفس الصفحة.</section>}
    {data?.status === 'failed' && <section className="marketing-tiktok-notice error" role="alert"><WarningCircle size={19}/><span>{data.note || 'تعذر تحميل TikTok Ads'} — تأكد من صلاحية الربط ثم حاول التحديث.</span></section>}

    {data?.status === 'ready' && <>
      <section className="panel marketing-tiktok-filters">
        <label>الحساب الإعلاني<select value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">كل الحسابات المتصلة</option>{data.accounts.map(account => <option key={account.id} value={account.id}>{account.name} — {account.id}</option>)}</select></label>
        <label>الفترة<select value={preset} onChange={event => setPreset(event.target.value as Preset)}>{PRESETS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label>الحالة<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">كل الحالات</option><option value="ENABLE">مفعلة</option><option value="DISABLE">متوقفة</option></select></label>
        <label className="marketing-tiktok-search">البحث<div><MagnifyingGlass size={18}/><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="اسم الحملة أو رقمها"/></div></label>
        {preset === 'custom' && <div className="marketing-tiktok-dates"><label>من<input type="date" value={dateFrom} max={dateTo} onChange={event => setDateFrom(event.target.value)}/></label><label>إلى<input type="date" value={dateTo} min={dateFrom} onChange={event => setDateTo(event.target.value)}/></label></div>}
      </section>
      <section className="marketing-tiktok-stats" aria-label="ملخص أداء حملات TikTok">
        <article><Megaphone size={23}/><span>عدد الحملات</span><strong>{count(totalCampaigns)}</strong><small>{reports.length} حساب</small></article>
        <article><Wallet size={23}/><span>الإنفاق الفعلي</span><strong>{completeMetrics ? (commonCurrency ? money(spend, commonCurrency) : 'حسب الحساب') : '—'}</strong><small>للفترة المختارة فقط</small></article>
        <article><UsersThree size={23}/><span>الليدات</span><strong>{leadsKnown ? count(leads) : '—'}</strong><small>ليدات منصة TikTok عند توفر مقياس مباشر</small></article>
        <article><ChartLineUp size={23}/><span>تكلفة الليد</span><strong>{leadsKnown && commonCurrency && leads > 0 ? money(spend / leads, commonCurrency) : '—'}</strong><small>الصرف ÷ الليدات الحقيقية المقاسة</small></article>
        <article><CurrencyDollar size={23}/><span>النقرات</span><strong>{completeMetrics ? count(sum('clicks')) : '—'}</strong><small>{completeMetrics ? count(sum('impressions')) : '—'} ظهور</small></article>
      </section>
      <section className="panel marketing-tiktok-table-panel">
        <header><div><h4>تفاصيل الحملات</h4><p>{count(rows.length)} حملة مطابقة · {data.dateRange.since} إلى {data.dateRange.until}</p></div><small>{loading ? 'جارٍ التحديث…' : `آخر قراءة: ${new Date(data.syncedAt).toLocaleString('ar-SA-u-nu-latn')}`}</small></header>
        <div className="marketing-tiktok-table-scroll"><table className="marketing-tiktok-table"><thead><tr><th>الحملة / الحساب</th><th>الهدف</th><th>الحالة</th><th>الميزانية</th><th>الصرف</th><th>الظهور</th><th>النقرات</th><th>CTR</th><th>التحويلات</th><th>الليدات</th><th>تكلفة الليد</th><th>إجراءات</th></tr></thead><tbody>
          {visibleRows.map(({ account, campaign }) => <tr key={`${account.id}:${campaign.id}`}>
            <td><strong dir="auto">{campaign.name}</strong><small dir="auto">{account.name} · {campaign.type === 'UPGRADED_SMART_PLUS' ? 'Smart+' : 'عادية'} · ID: {campaign.id}</small></td>
            <td>{objectiveLabel(campaign.objective)}</td>
            <td><span className={`marketing-tiktok-status ${campaign.status === 'ENABLE' && campaign.deliveryStatus !== 'CAMPAIGN_STATUS_BUDGET_EXCEED' ? 'active' : campaign.deliveryStatus === 'CAMPAIGN_STATUS_BUDGET_EXCEED' ? 'limit' : ''}`}>{campaignStatus(campaign)}</span></td>
            <td>{budgetLabel(campaign, account.currency)}</td>
            <td className="numeric">{money(campaign.metrics.spend, account.currency)}</td>
            <td className="numeric">{count(campaign.metrics.impressions)}</td>
            <td className="numeric">{count(campaign.metrics.clicks)}</td>
            <td className="numeric">{campaign.metrics.ctr === null ? '—' : `${count(campaign.metrics.ctr, 2)}%`}</td>
            <td className="numeric">{count(campaign.metrics.conversions)}</td>
            <td className="numeric">{count(campaign.metrics.leads)}</td>
            <td className="numeric">{money(campaign.metrics.costPerLead, account.currency)}</td>
            <td><div className="marketing-tiktok-row-actions">
              {canManage && ['ENABLE', 'DISABLE'].includes(campaign.status) && <button className="secondary-button small" type="button" disabled={Boolean(busy)} onClick={() => void changeStatus(account, campaign)} title={campaign.status === 'ENABLE' ? 'إيقاف الحملة' : 'تشغيل الحملة وقد يبدأ الإنفاق'}>{campaign.status === 'ENABLE' ? <PauseCircle size={18}/> : <PlayCircle size={18}/>}<span>{campaign.status === 'ENABLE' ? 'إيقاف' : 'تشغيل'}</span></button>}
              <a className="secondary-button small" href="https://ads.tiktok.com/i18n/perf" target="_blank" rel="noreferrer" title="فتح TikTok Ads Manager"><LinkSimple size={17}/></a>
            </div></td>
          </tr>)}
        </tbody></table></div>
        {!rows.length && <div className="marketing-tiktok-empty">لا توجد حملات مطابقة للفلاتر المختارة.</div>}
        {totalPages > 1 && <nav className="marketing-tiktok-pagination" aria-label="صفحات حملات TikTok"><button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>السابق</button><span>صفحة {count(Math.min(page, totalPages))} من {count(totalPages)}</span><button type="button" className="secondary-button" disabled={page >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>التالي</button></nav>}
      </section>
      {reports.flatMap(report => report.warnings.map(warning => `${report.account.name}: ${warning}`)).concat(data.errors.map(item => `${item.accountId}: ${item.message}`)).concat(data.note ? [data.note] : []).map((warning, index) => <p key={index} className="marketing-tiktok-warning"><WarningCircle size={16}/>{warning}</p>)}
      <p className="marketing-tiktok-disclaimer">الميزانيات المعروضة حدود إعدادات الحملات وليست المبلغ المصروف. «الليدات» لا تُحسب من التحويلات العامة عند عدم توفر مقياس مستقل، ولا تُنشئ هذه الصفحة عملاء CRM أو تغيّر المنشورات. يتم احتساب الإجماليات المالية فقط إذا كانت عملات الحسابات متطابقة ومعروفة.</p>
    </>}
    {loading && !data && <section className="panel marketing-tiktok-empty" role="status"><ArrowClockwise size={21} className="marketing-spin"/> جارٍ قراءة حسابات وحملات TikTok Ads…</section>}
  </div>;
}
