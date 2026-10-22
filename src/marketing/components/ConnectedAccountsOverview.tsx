import { useEffect, useState } from 'react';
import { TiktokLogo } from '@phosphor-icons/react';
import { marketingFetch, marketingQuery } from '../api';
import { CompactFollowerChart, TopEngagedSocialPost, type DailyFollower, type EngagedSocialPost } from './CompactFollowerChart';

type OrganicAccount = {
  id: number; name: string;
  followers: number | null; monthlyChange: number | null; dailyChange: number | null;
  videoCount: number | null; likesCount: number | null; impressions: number | null; profileViews: number | null;
  lastDate: string | null; snapshots: DailyFollower[]; topPost: EngagedSocialPost | null;
};
type Response = { ok: true; tiktok: { connected: boolean; accounts: OrganicAccount[] } };
const optionalCount = (value: number | null) => value === null ? '—' : value.toLocaleString('ar-SA-u-nu-latn');
const growth = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString('ar-SA-u-nu-latn')}`;

export function ConnectedAccountsOverview({ dateFrom, dateTo, refreshSignal = 0 }: { dateFrom: string; dateTo: string; refreshSignal?: number }) {
  const [value, setValue] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void marketingFetch<Response>(`/api/marketing${marketingQuery({ resource: 'social_accounts_overview', dateFrom, dateTo, ...(request || refreshSignal ? { refresh: '1' } : {}) })}`, { signal: controller.signal })
      .then(payload => { if (!controller.signal.aborted) setValue(payload); })
      .catch(() => { if (!controller.signal.aborted) setValue(null); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [dateFrom, dateTo, request, refreshSignal]);
  const accounts = value?.tiktok.accounts || [];
  return <>
    {accounts.map(account => <article key={account.id} className="panel marketing-meta-account-card marketing-social-account-card">
      <header className="marketing-meta-account-heading">
        <span className="marketing-platform-chip tiktok"><TiktokLogo size={20} weight="fill"/>TikTok</span>
        <span className="marketing-sync-status synced">متصل</span>
      </header>
      <h4>{account.name}</h4>
      <div className="marketing-meta-follower-number"><strong>{optionalCount(account.followers)}</strong><small>متابع</small></div>
      <div className="marketing-meta-account-metrics">
        <div><span>نمو الشهر المسجل</span><strong>{growth(account.monthlyChange)}</strong></div>
        <div><span>عدد الفيديوهات</span><strong>{optionalCount(account.videoCount)}</strong></div>
        <div><span>إعجابات الحساب</span><strong>{optionalCount(account.likesCount)}</strong></div>
        <div><span>مرات الظهور</span><strong>{optionalCount(account.impressions)}</strong></div>
        <div><span>زيارات الملف الشخصي</span><strong>{optionalCount(account.profileViews)}</strong></div>
      </div>
      <CompactFollowerChart snapshots={account.snapshots}/>
      <TopEngagedSocialPost post={account.topPost}/>
      <footer className="marketing-meta-account-footer"><span>{account.lastDate || '—'}</span></footer>
    </article>)}
    {loading && !value && <article className="panel marketing-meta-account-empty">جاري تحميل TikTok…</article>}
    {!loading && !accounts.length && <article className="panel marketing-meta-account-card marketing-social-account-card">
      <header className="marketing-meta-account-heading"><span className="marketing-platform-chip tiktok"><TiktokLogo size={20}/>TikTok</span><span className="marketing-sync-status pending">غير متاح</span></header>
      <h4>حساب TikTok</h4><div className="marketing-meta-follower-number"><strong>—</strong><small>متابع</small></div>
      <button type="button" className="secondary-button small" onClick={() => setRequest(n => n + 1)}>تحديث</button>
    </article>}
  </>;
}
