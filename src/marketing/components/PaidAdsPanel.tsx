import { useEffect, useState } from 'react';
import { FacebookLogo, GoogleLogo, TiktokLogo } from '@phosphor-icons/react';
import { MetaAdsPanel } from './MetaAdsPanel';
import { GoogleAdsPanel } from './GoogleAdsPanel';
import { TikTokAdsPanel } from './TikTokAdsPanel';

type ProviderFilter = 'all' | 'meta' | 'google' | 'tiktok';

/** Paid campaigns hub: no provider's OAuth, report, budget or CRM counts are shared. */
export function PaidAdsPanel() {
  const [selected, setSelected] = useState<ProviderFilter>('all');
  const [googleReady, setGoogleReady] = useState(false);
  const [tiktokReady, setTiktokReady] = useState(false);
  // Stagger independent provider requests when viewing all campaigns. This
  // prevents a three-provider cold start from blocking the existing Meta page.
  useEffect(() => {
    if (selected === 'google') { setGoogleReady(true); return; }
    if (selected !== 'all') { setGoogleReady(false); return; }
    const timer = window.setTimeout(() => setGoogleReady(true), 2_000);
    return () => window.clearTimeout(timer);
  }, [selected]);
  useEffect(() => {
    if (selected === 'tiktok') { setTiktokReady(true); return; }
    if (selected !== 'all') { setTiktokReady(false); return; }
    const timer = window.setTimeout(() => setTiktokReady(true), 4_000);
    return () => window.clearTimeout(timer);
  }, [selected]);

  return <div className="marketing-paid-ads-hub">
    <section className="panel marketing-paid-ads-header">
      <div className="marketing-paid-ads-headline"><h3>الحملات الممولة</h3><p>متابعة نتائج Meta وGoogle Ads وTikTok Ads مع الاحتفاظ بعملة ومصدر بيانات كل حساب دون دمج تحويلات غير متكافئة.</p><small>تفاعل المنشورات العادية في Facebook وInstagram وYouTube وTikTok وSnapchat يظل كما هو في تبويبات تفاعل النشر والحسابات.</small></div>
      <div className="marketing-paid-ads-filter" role="group" aria-label="فلتر المنصة الإعلانية">
        <button type="button" className={selected === 'all' ? 'active' : ''} aria-pressed={selected === 'all'} onClick={() => setSelected('all')}>كل المنصات</button>
        <button type="button" className={selected === 'meta' ? 'active' : ''} aria-pressed={selected === 'meta'} onClick={() => setSelected('meta')}><FacebookLogo size={17}/>Meta</button>
        <button type="button" className={selected === 'google' ? 'active' : ''} aria-pressed={selected === 'google'} onClick={() => setSelected('google')}><GoogleLogo size={17}/>Google Ads</button>
        <button type="button" className={selected === 'tiktok' ? 'active' : ''} aria-pressed={selected === 'tiktok'} onClick={() => setSelected('tiktok')}><TiktokLogo size={17} weight="fill"/>TikTok Ads</button>
      </div>
    </section>
    {(selected === 'all' || selected === 'meta') && <section aria-label="حملات Meta الممولة"><MetaAdsPanel /></section>}
    {(selected === 'google' || (selected === 'all' && googleReady)) && <section aria-label="حملات Google Ads الممولة"><GoogleAdsPanel /></section>}
    {(selected === 'tiktok' || (selected === 'all' && tiktokReady)) && <section aria-label="حملات TikTok Ads الممولة"><TikTokAdsPanel /></section>}
  </div>;
}
