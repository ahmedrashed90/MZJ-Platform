import { useEffect, useState } from 'react';
import { Ghost, TiktokLogo } from '@phosphor-icons/react';
import { marketingFetch, marketingQuery } from '../api';
import { CompactFollowerChart, TopEngagedSocialPost, type DailyFollower, type EngagedSocialPost } from './CompactFollowerChart';

type OrganicAccount = {
  id: number; name: string; connected: boolean; reconnect: boolean; stale: boolean; note: string;
  followers: number | null; monthlyChange: number | null; dailyChange: number | null;
  videoCount: number | null; likesCount: number | null; impressions: number | null;
  profileViews: number | null; views: number | null; reach: number | null;
  lastDate: string | null; snapshots: DailyFollower[]; topPost: EngagedSocialPost | null;
};
type PlatformResult = { connected: boolean; accounts: OrganicAccount[]; note?: string };
type Response = { ok: true; tiktok: PlatformResult; snapchat: PlatformResult };
const number = (value: number | null) => value === null ? '—' : value.toLocaleString('ar-SA-u-nu-latn');
const growth = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString('ar-SA-u-nu-latn')}`;
const platforms = [{ code: 'tiktok', name: 'TikTok' }, { code: 'snapchat', name: 'Snapchat' }] as const;

export function ConnectedAccountsOverview({ dateFrom, dateTo, refreshSignal = 0 }: { dateFrom: string; dateTo: string; refreshSignal?: number }) {
  const [value, setValue] = useState<Response | null>(null);
  const [loadedRange, setLoadedRange] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void marketingFetch<Response>(`/api/marketing${marketingQuery({ resource: 'social_accounts_overview', dateFrom, dateTo, ...(request || refreshSignal ? { refresh: '1' } : {}) })}`, { signal: controller.signal })
      .then(payload => { if (!controller.signal.aborted) { setValue(payload); setLoadedRange(`${dateFrom}/${dateTo}`); } })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'تعذر تحميل حسابات BulkPublish');
        // Preserve the last successful results while a refresh is failing.
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [dateFrom, dateTo, request, refreshSignal]);
  const displayed = loadedRange === `${dateFrom}/${dateTo}` ? value : null;
  return <>
    {platforms.map(({code, name}) => {
      const result = displayed?.[code];
      const accounts = result?.accounts || [];
      const logo = code === 'tiktok' ? <TiktokLogo size={20} weight="fill"/> : <Ghost size={20} weight="fill"/>;
      return <div key={code} className="marketing-social-extra-accounts" style={{display:'contents'}}>
        {accounts.map(account => <article key={`${code}-${account.id}`} className="panel marketing-meta-account-card marketing-social-account-card">
          <header className="marketing-meta-account-heading">
            <span className={`marketing-platform-chip ${code}`}>{logo}{name}</span>
            <span className={`marketing-sync-status ${account.connected ? 'synced' : 'pending'}`}>{account.reconnect ? 'إعادة ربط' : account.stale && account.note.includes('قائمة حسابات') ? 'تعذر التحقق' : account.connected ? 'متصل' : 'غير متصل'}</span>
          </header>
          <h4>{account.name}</h4>
          <div className="marketing-meta-follower-number"><strong>{number(account.followers)}</strong><small>متابع</small></div>
          <div className="marketing-meta-account-metrics">
            <div><span>نمو الشهر المسجل</span><strong>{growth(account.monthlyChange)}</strong></div>
            <div><span>{code === 'tiktok' ? 'عدد الفيديوهات' : 'عدد مقاطع Spotlight المتاحة'}</span><strong>{number(account.videoCount)}</strong></div>
            <div><span>إعجابات الحساب</span><strong>{number(account.likesCount)}</strong></div>
            <div><span>مرات الظهور</span><strong>{number(account.impressions)}</strong></div>
            <div><span>زيارات الملف الشخصي</span><strong>{number(account.profileViews)}</strong></div>
            {code === 'snapchat' && <>
              <div><span>المشاهدات</span><strong>{number(account.views)}</strong></div>
              <div><span>الوصول</span><strong>{number(account.reach)}</strong></div>
            </>}
          </div>
          <CompactFollowerChart snapshots={account.snapshots}/>
          <TopEngagedSocialPost post={account.topPost}/>
          {(account.stale || account.note) && <p className="marketing-social-account-note" role="status">
            {account.note || 'يتم عرض آخر إحصائيات متاحة إلى أن يكتمل التحديث.'}
          </p>}
          {code === 'snapchat' && account.followers === null && <p className="marketing-social-account-note">عدد متابعي Snapchat غير متوفر في استجابة BulkPublish الحالية؛ لا نعرض صفرًا بدلًا منه.</p>}
          <footer className="marketing-meta-account-footer"><span>آخر قراءة للمتابعين: {account.lastDate || '—'}</span></footer>
        </article>)}
        {!accounts.length && <article className="panel marketing-meta-account-card marketing-social-account-card">
          <header className="marketing-meta-account-heading"><span className={`marketing-platform-chip ${code}`}>{logo}{name}</span><span className="marketing-sync-status pending">غير متاح</span></header>
          <h4>حساب {name}</h4>
          <div className="marketing-meta-follower-number"><strong>—</strong><small>متابع</small></div>
          <p className="marketing-social-account-note">{result?.note || (loading ? 'جاري قراءة الحساب من BulkPublish…' : error || 'لا يوجد حساب متصل بهذه المنصة داخل BulkPublish.')}</p>
          <button type="button" className="secondary-button small" disabled={loading} onClick={() => setRequest(n => n + 1)}>تحديث</button>
        </article>}
      </div>;
    })}
    {error && displayed && <p className="marketing-social-account-note" role="alert">فشل التحديث الجديد؛ البيانات المعروضة هي آخر قراءة ناجحة. {error}</p>}
  </>;
}
