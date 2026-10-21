import { useState } from 'react';
import { FacebookLogo, GoogleLogo } from '@phosphor-icons/react';
import { MetaAdsPanel } from './MetaAdsPanel';
import { GoogleAdsPanel } from './GoogleAdsPanel';

type ProviderFilter = 'all' | 'meta' | 'google';

/** Paid campaigns hub: provider reports remain independent to avoid false cross-platform conversions/currency totals. */
export function PaidAdsPanel() {
  const [selected, setSelected] = useState<ProviderFilter>('all');
  return <div className="marketing-paid-ads-hub">
    <section className="panel marketing-paid-ads-header">
      <div className="marketing-paid-ads-headline"><h3>الحملات الممولة</h3><p>متابعة موحدة لنتائج Meta وGoogle Ads، مع الحفاظ على مصدر بيانات كل منصة وعملة كل حساب.</p><small>تفاعل المنشورات في Facebook وInstagram وYouTube وTikTok وSnapchat يظل في تبويبات تفاعل النشر والحسابات.</small></div>
      <div className="marketing-paid-ads-filter" role="group" aria-label="فلتر المنصة الإعلانية">
        <button type="button" className={selected === 'all' ? 'active' : ''} aria-pressed={selected === 'all'} onClick={() => setSelected('all')}>كل المنصات</button>
        <button type="button" className={selected === 'meta' ? 'active' : ''} aria-pressed={selected === 'meta'} onClick={() => setSelected('meta')}><FacebookLogo size={17}/>Meta</button>
        <button type="button" className={selected === 'google' ? 'active' : ''} aria-pressed={selected === 'google'} onClick={() => setSelected('google')}><GoogleLogo size={17}/>Google Ads</button>
      </div>
    </section>
    {(selected === 'all' || selected === 'meta') && <section aria-label="حملات Meta الممولة"><MetaAdsPanel /></section>}
    {(selected === 'all' || selected === 'google') && <section aria-label="حملات Google Ads الممولة"><GoogleAdsPanel /></section>}
  </div>;
}
