import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LeadFormRenderer, type RendererForm } from './LeadFormRenderer';
import './lead-forms.css';
export function PublicLeadFormPage(){
  const { slug='' }=useParams();
  const [form,setForm]=useState<RendererForm|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;setForm(null);setError('');
    fetch(`/api/marketing/lead-forms?view=public&slug=${encodeURIComponent(slug)}`,{cache:'no-store'})
      .then(async r=>{const payload=await r.json().catch(()=>({}));if(!r.ok||!payload.ok)throw new Error(payload.error || 'النموذج غير متاح');return payload.form as RendererForm;})
      .then(data=>{if(active)setForm({...data,slug});}).catch(e=>{if(active)setError(e instanceof Error?e.message:'تعذر تحميل النموذج');});
    return()=>{active=false;};
  },[slug]);
  return form?<LeadFormRenderer form={form}/>:<div className="mlf-public mlf-public-loading" dir="rtl"><div className="mlf-public-card"><img src="/logo.png" alt="MZJ"/><h2>{error || 'جاري تحميل الفورم...'}</h2>{error&&<p>يمكنك التواصل مع الشركة إذا استمرت المشكلة.</p>}</div></div>;
}
