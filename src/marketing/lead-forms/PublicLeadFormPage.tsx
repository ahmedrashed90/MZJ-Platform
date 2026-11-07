import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { LeadFormRenderer, type RendererForm, type StoredFormLead } from './LeadFormRenderer';
import type { LeadFormPixelSettings } from '../../../shared/lead-form-pixels';
import { detectFormAdPlatform, readPixelConsent, savePixelConsent, startFormAdPixel, trackStoredFormLead, type TrackingChoice } from './pixel-tracking';
import './lead-forms.css';

export function PublicLeadFormPage() {
  const { slug='' } = useParams();
  const location = useLocation();
  const [form,setForm] = useState<RendererForm|null>(null);
  const [pixels,setPixels] = useState<LeadFormPixelSettings|null>(null);
  const [error,setError] = useState('');
  const [consent,setConsent] = useState<TrackingChoice>(readPixelConsent);
  const [changeConsent,setChangeConsent] = useState(false);
  const platform = useMemo(() => detectFormAdPlatform(location.search,document.referrer),[location.search]);
  const pixelEnabled = !!(platform && pixels?.[platform]?.enabled && pixels[platform].id);

  useEffect(() => {
    let active=true;
    setForm(null);setPixels(null);setError('');
    fetch(`/api/marketing/lead-forms?view=public&slug=${encodeURIComponent(slug)}`,{cache:'no-store'})
      .then(async response => {
        const data=await response.json().catch(()=>({}));
        if(!response.ok||!data.ok)throw new Error(data.error||'النموذج غير متاح');
        return data as {form:RendererForm; pixels?:LeadFormPixelSettings};
      })
      .then(data=>{if(active){setForm({...data.form,slug});setPixels(data.pixels||null);}})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'تعذر تحميل النموذج');});
    return()=>{active=false;};
  },[slug]);

  useEffect(() => {
    if (form && pixelEnabled) startFormAdPixel(platform,pixels,slug,consent);
  },[form,pixelEnabled,platform,pixels,slug,consent]);

  function updateConsent(choice: Exclude<TrackingChoice,null>) {
    savePixelConsent(choice);
    setChangeConsent(false);
    if (consent === 'allow' && choice === 'deny') {
      // Once loaded, browser pixels cannot be safely unloaded; reload to stop them.
      window.location.reload();
      return;
    }
    setConsent(choice);
  }
  function onStored(lead:StoredFormLead) {
    trackStoredFormLead(platform,pixels,consent,lead);
  }

  if(!form) return <div className="mlf-public mlf-public-loading" dir="rtl"><div className="mlf-public-card"><img src="/logo.png" alt="MZJ"/><h2>{error||'جاري تحميل الفورم...'}</h2>{error&&<p>يمكنك التواصل مع الشركة إذا استمرت المشكلة.</p>}</div></div>;
  return <>
    <LeadFormRenderer form={form} onLeadStored={onStored}/>
    {pixelEnabled && (consent===null || changeConsent) &&
      <aside className="mlf-pixel-consent" dir="rtl" aria-label="تفضيلات تتبع الإعلانات">
        <strong>تفضيلات تتبع الإعلانات</strong>
        <p>هل تسمح باستخدام Pixel لقياس زيارة الفورم وإرسال الطلب على منصة الإعلان؟ اختيارك اختياري ولا يؤثر على طلبك. لن نرسل اسمك أو جوالك أو إجاباتك ضمن أحداث التتبع، وقد تستخدم المنصة ملفات تعريف الارتباط ومعرّفات الجهاز وفق سياستها.</p>
        <div className="mlf-pixel-consent-actions">
          <button type="button" className="primary" onClick={()=>updateConsent('allow')}>السماح بالتتبع</button>
          <button type="button" className="secondary" onClick={()=>updateConsent('deny')}>المتابعة بدون تتبع</button>
          <a href="/privacy" target="_blank" rel="noopener noreferrer">سياسة الخصوصية</a>
        </div>
      </aside>}
    {pixelEnabled && consent!==null && !changeConsent &&
      <button type="button" className="mlf-pixel-privacy-control" onClick={()=>setChangeConsent(true)}>إعدادات التتبع</button>}
  </>;
}
