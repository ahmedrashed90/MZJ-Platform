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
  // A new opt-in on the contact step is committed only on a successful send.
  // This lets a visitor change their mind before sending without reloading.
  const [allowOnSubmit,setAllowOnSubmit] = useState(consent === 'allow');
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
    setConsent(choice);
    setAllowOnSubmit(choice === 'allow');
    if (consent === 'allow' && choice === 'deny') {
      // Once loaded, browser pixels cannot be safely unloaded; reload to stop them.
      window.location.reload();
    }
  }
  function onStored(lead:StoredFormLead) {
    if (!pixelEnabled) return;
    const choice = allowOnSubmit ? 'allow' : 'deny';
    // The checkbox is optional and never part of form validation or CRM data.
    // Confirm it before the conversion, including when React has not yet rendered.
    if (choice !== consent) {
      savePixelConsent(choice);
      setConsent(choice);
    }
    startFormAdPixel(platform,pixels,slug,choice);
    trackStoredFormLead(platform,pixels,choice,lead);
  }

  function renderTrackingPreferences({contact,sending}:{contact:boolean;sending:boolean}) {
    if (!pixelEnabled) return null;
    if (contact) return <div className="mlf-tracking-inline" dir="rtl">
      <label className="mlf-tracking-check">
        <input type="checkbox" checked={allowOnSubmit} disabled={sending}
          onChange={e=>{
            const checked=e.currentTarget.checked;
            if (!checked && consent==='allow') updateConsent('deny');
            else setAllowOnSubmit(checked);
          }}/>
        <span>أوافق على استخدام ملفات تعريف الارتباط ومعرّفات الجهاز لقياس أداء الإعلانات (اختياري).</span>
      </label>
      <small>يمكنك إرسال الطلب دون الموافقة. لا نرسل اسمك أو جوالك أو إجاباتك ضمن أحداث القياس.</small>
      {consent==='allow'&&<small>إلغاء موافقة سابقة يعيد تحميل النموذج.</small>}
    </div>;
    return <details className="mlf-tracking-settings" dir="rtl">
      <summary>إعدادات الخصوصية</summary>
      <p>يمكنك السماح بقياس أداء الإعلانات باستخدام ملفات تعريف الارتباط ومعرّفات الجهاز أو رفضه. اختيارك لا يؤثر على طلبك.</p>
      <small>الحالة: {consent==='allow'?'مسموح بالقياس':consent==='deny'?'القياس متوقف':'لم يتم الاختيار — القياس متوقف'}</small>
      {consent==='allow'&&<small>إلغاء الموافقة يعيد تحميل النموذج.</small>}
      <div className="mlf-tracking-actions">
        <button type="button" disabled={sending||consent==='allow'} onClick={()=>updateConsent('allow')}>السماح</button>
        <button type="button" disabled={sending||consent==='deny'} onClick={()=>updateConsent('deny')}>عدم السماح</button>
      </div>
    </details>;
  }

  if(!form) return <div className="mlf-public mlf-public-loading" dir="rtl"><div className="mlf-public-card"><img src="/logo.png" alt="MZJ"/><h2>{error||'جاري تحميل الفورم...'}</h2>{error&&<p>يمكنك التواصل مع الشركة إذا استمرت المشكلة.</p>}</div></div>;
  return <LeadFormRenderer form={form} onLeadStored={onStored} renderTrackingPreferences={renderTrackingPreferences}/>;
}
