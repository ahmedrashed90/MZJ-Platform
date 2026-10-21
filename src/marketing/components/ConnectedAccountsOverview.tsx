import { useEffect, useState } from 'react';
import { ArrowClockwise, GoogleLogo, TiktokLogo, Megaphone, UsersThree } from '@phosphor-icons/react';
import { marketingFetch, marketingQuery } from '../api';

type AdsAccount = { id: string; name: string; currency?: string; timeZone?: string };
type OrganicAccount = { id: number; name: string };
type Response = {
  ok: true;
  googleAds: { connected: boolean; accounts: AdsAccount[]; note: string };
  tiktokAds: { connected: boolean; accounts: AdsAccount[]; note: string };
  tiktok: { connected: boolean; accounts: OrganicAccount[]; note: string };
};

/** Displays only provider-confirmed account identity. Ads channels have no follower counts. */
export function ConnectedAccountsOverview() {
  const [value, setValue] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void marketingFetch<Response>(`/api/marketing${marketingQuery({ resource: 'social_accounts_overview' })}`, { signal: controller.signal })
      .then(payload => { if (!controller.signal.aborted) setValue(payload); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'تعذر تحميل الحسابات'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request]);

  const google = value?.googleAds.accounts || [];
  const tiktokAds = value?.tiktokAds.accounts || [];
  const organic = value?.tiktok.accounts || [];
  return <section className="marketing-connected-accounts">
    <header className="marketing-connected-accounts-header"><div><h3>حسابات TikTok وGoogle Ads</h3><p>الحسابات المرتبطة فعليًا. المتابعون للمنصات الإعلانية غير متاحين بهذا الربط، لذا لا نعرض أرقامًا تقديرية.</p></div><button type="button" className="secondary-button small" disabled={loading} onClick={() => setRequest(n => n + 1)}><ArrowClockwise size={16} className={loading ? 'spin' : ''}/> تحديث الحسابات</button></header>
    {error && <p role="alert" className="marketing-tiktok-warning">{error}</p>}
    {loading && !value && <div className="panel marketing-meta-account-empty" role="status">جارٍ قراءة حسابات TikTok وGoogle Ads المرتبطة…</div>}
    {value && <div className="marketing-connected-accounts-grid">
      <article className="panel marketing-connected-account-group"><header><span className="marketing-connected-brand tiktok"><TiktokLogo size={21} weight="fill"/> TikTok</span><span className={`marketing-sync-status ${value.tiktok.connected ? 'synced' : 'pending'}`}>{value.tiktok.connected ? 'متصل' : 'بحاجة إلى ربط'}</span></header><p>النشر العضوي عبر BulkPublish</p>
        {organic.length ? organic.map(item => <div className="marketing-connected-account-entry" key={item.id}><strong dir="auto">{item.name}</strong><small><UsersThree size={15}/> بيانات المتابعين غير متاحة عبر BulkPublish</small></div>) : <small>{value.tiktok.note}</small>}
      </article>
      <article className="panel marketing-connected-account-group"><header><span className="marketing-connected-brand tiktok"><TiktokLogo size={21} weight="fill"/> TikTok Ads</span><span className={`marketing-sync-status ${value.tiktokAds.connected ? 'synced' : 'pending'}`}>{value.tiktokAds.connected ? 'متصل' : 'بحاجة إلى ربط'}</span></header><p>حسابات الحملات الممولة عبر MCP</p>
        {tiktokAds.length ? tiktokAds.map(item => <div className="marketing-connected-account-entry" key={item.id}><strong dir="auto">{item.name}</strong><small><Megaphone size={15}/> حساب إعلاني · <bdi dir="ltr">{item.id}</bdi>{item.currency ? ` · ${item.currency}` : ''}</small></div>) : <small>{value.tiktokAds.note}</small>}
      </article>
      <article className="panel marketing-connected-account-group"><header><span className="marketing-connected-brand google"><GoogleLogo size={21}/> Google Ads</span><span className={`marketing-sync-status ${value.googleAds.connected ? 'synced' : 'pending'}`}>{value.googleAds.connected ? 'متصل' : 'بحاجة إلى ربط'}</span></header><p>الحسابات المختارة لمتابعة الحملات</p>
        {google.length ? google.map(item => <div className="marketing-connected-account-entry" key={item.id}><strong dir="auto">{item.name}</strong><small><Megaphone size={15}/> حساب إعلاني · <bdi dir="ltr">{item.id}</bdi>{item.currency ? ` · ${item.currency}` : ''}</small></div>) : <small>{value.googleAds.note}</small>}
      </article>
    </div>}
  </section>;
}
