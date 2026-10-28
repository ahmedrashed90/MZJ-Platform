import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle, LockKey, WarningCircle, ChatCircleDots, CarProfile } from '@phosphor-icons/react';
import type { FormConfig, FormField, FormTemplate } from '../../../shared/lead-forms';
import { DEFAULT_FORM_CONFIG } from '../../../shared/lead-forms';
import { resolveFormDesign, type DesignBlock } from '../../../shared/lead-form-design';
import './lead-forms.css';

export type RendererForm = { title:string; description:string; template:FormTemplate; config:FormConfig; slug?:string };
function uuid() { return typeof crypto!=='undefined' && crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-4000-8000-${Math.floor(Math.random()*2**48).toString(16).padStart(12,'0')}`; }
function getVisitor(slug:string) {
  try {const key=`mzj-form-visitor-${slug}`,old=sessionStorage.getItem(key);if(old)return old;const next=uuid();sessionStorage.setItem(key,next);return next;} catch { return uuid(); }
}
function getTracking() {
  const u=new URLSearchParams(window.location.search);
  return { source:(u.get('utm_source')||u.get('source')||'direct').slice(0,100), campaign:(u.get('utm_campaign')||'').slice(0,160), medium:(u.get('utm_medium')||'').slice(0,120), adId:(u.get('ad_id')||u.get('utm_content')||'').slice(0,140) };
}
export function LeadFormRenderer({ form, preview=false, compact=false }:{ form:RendererForm;preview?:boolean;compact?:boolean }) {
  const config=form.config?.fields?.length?form.config:DEFAULT_FORM_CONFIG;
  const style=config.style || DEFAULT_FORM_CONFIG.style;
  const design=useMemo(()=>resolveFormDesign(config.design,form.template,config.fields),[config.design,config.fields,form.template]);
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const [step,setStep]=useState(0);
  const [name,setName]=useState(''),[phone,setPhone]=useState(''),[consent,setConsent]=useState(false);
  const [sending,setSending]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
  const session=useRef(getVisitor(form.slug || 'preview'));
  const submissionKey=useRef(uuid());
  const touch=useRef<{x:number;y:number}|null>(null);
  const tracking=useMemo(getTracking,[]);
  const fields=config.fields.filter(f=>!f.showIf || answers[f.showIf.fieldId]===f.showIf.equals);
  const count=fields.length+1;
  const current=fields[step];
  const stageId=done?'success':current?.id||'contact';
  const blocks=design.screens[stageId] || [];
  useEffect(()=>{if(step>fields.length)setStep(fields.length);},[step,fields.length]);
  useEffect(()=>{
    if(preview || !form.slug)return;
    void fetch('/api/marketing/lead-forms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'view',slug:form.slug,visitor:session.current,...tracking}),keepalive:true}).catch(()=>undefined);
  },[preview,form.slug,tracking]);
  useEffect(()=>{
    if(preview||!form.slug||done)return;
    void fetch('/api/marketing/lead-forms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'step',slug:form.slug,visitor:session.current,step:current?.id || 'contact',...tracking}),keepalive:true}).catch(()=>undefined);
  },[preview,form.slug,current?.id,done,tracking]);
  const answer=(field:FormField,value:string)=>{
    setAnswers(prev=>({...prev,[field.id]:value}));setError('');
    if(field.type==='choice')setStep(s=>Math.min(s+1,fields.length));
  };
  const next=()=>{
    if(current && current.required && !String(answers[current.id]||'').trim()){setError('أجب عن السؤال قبل المتابعة');return;}
    setError('');setStep(s=>Math.min(s+1,fields.length));
  };
  const previous=()=>{setError('');setStep(s=>Math.max(0,s-1));};
  async function submit() {
    if(name.trim().length<2){setError('يرجى إدخال الاسم الكامل');return;}
    if(!/^(?:05\d{8}|(?:\+?966)5\d{8})$/.test(phone.replace(/[\s()-]/g,''))){setError('أدخل رقم جوال سعودي صحيح');return;}
    if(!consent){setError('يلزم الموافقة على سياسة الخصوصية');return;}
    if(preview){setDone(true);return;}
    setSending(true);setError('');
    try {
      const result=await fetch('/api/marketing/lead-forms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'submit',slug:form.slug,visitor:session.current,submissionKey:submissionKey.current,name:name.trim(),phone,consent,answers,...tracking,website:''})});
      const json=await result.json().catch(()=>({}));
      if(!result.ok||!json.ok)throw new Error(String(json.error||'تعذر إرسال الطلب'));
      setDone(true);
    } catch(e) {setError(e instanceof Error?e.message:'تعذر إرسال الطلب');}
    finally {setSending(false);}
  }
  function fieldContent(){
    if(!current)return null;
    if(current.type!=='choice')return <label className="mlf-public-input"><span>{current.label}</span><input type={current.type==='number'?'number':'text'} inputMode={current.type==='number'?'decimal':'text'} value={answers[current.id]||''} placeholder="اكتب إجابتك هنا" onChange={e=>answer(current,e.target.value)} maxLength={180}/></label>;
    return <div className={`mlf-choice-grid mlf-choice-mode-${design.choices}`} role="group" aria-label={current.label}>{current.options.map((option,index)=>
      <button type="button" key={`${index}-${option}`} className={`mlf-choice ${answers[current.id]===option?'selected':''}`} onClick={()=>answer(current,option)}>
        {current.optionImages?.[option]?<img className="mlf-option-image" src={current.optionImages[option]} alt="" loading="lazy"/>:
          <span className="mlf-choice-icon">{form.template==='visual'?<CarProfile size={25} weight="duotone"/>:String(index+1).padStart(2,'0')}</span>}
        <strong>{option}</strong><ArrowLeft className="mlf-choice-arrow" size={17}/>
      </button>)}</div>;
  }
  function contactContent(){return <div className="mlf-contact"><label>الاسم الكامل<input autoComplete="name" value={name} placeholder="اكتب اسمك" maxLength={130} onChange={e=>setName(e.target.value)}/></label><label>رقم الجوال<input type="tel" inputMode="tel" autoComplete="tel" value={phone} placeholder="05XXXXXXXX" maxLength={24} onChange={e=>setPhone(e.target.value)}/></label><label className="mlf-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>أوافق على استخدام بياناتي للتواصل معي بخصوص السيارة المطلوبة وفق <a href="/privacy" target="_blank" rel="noopener noreferrer">سياسة الخصوصية</a>.</span></label></div>;}
  function actionsContent(){return <footer className="mlf-public-actions">
    {step>0&&<button type="button" className="mlf-public-back" onClick={previous}><ArrowRight size={18}/> السابق</button>}
    {current?.type==='choice'?<small>اختار إجابة للانتقال تلقائيًا</small>:<button type="button" disabled={sending} className="mlf-public-button" onClick={()=>current?next():void submit()}>{sending?'جاري إرسال الطلب...':current?'التالي':style.actionLabel}<ArrowLeft size={19}/></button>}
  </footer>;}
  function successContent(){return <div className="mlf-done" role="status"><CheckCircle size={72} weight="duotone"/><h1>{style.successTitle}</h1><p>{style.successMessage}</p>{preview&&<button type="button" className="mlf-public-button" onClick={()=>{setStep(0);setAnswers({});setName('');setPhone('');setConsent(false);setDone(false);}}>إعادة التجربة</button>}</div>;}
  function history():ReactNode {
    if(form.template!=='chat'||!current)return null;
    return <div className="mlf-chat-history">{fields.slice(0,step).filter(f=>answers[f.id]).map(f=><div key={f.id} className="mlf-chat-exchange"><div className="mlf-chat-bot">{f.label}</div><div className="mlf-chat-human">{answers[f.id]}</div></div>)}</div>;
  }
  function renderBlock(block:DesignBlock){
    let content:ReactNode=null;
    switch(block.kind){
      case 'brand':content=<header className="mlf-public-brand">{style.logoUrl&&<img src={style.logoUrl} alt="شعار محمد ذعار العجمي للسيارات" onError={e=>{e.currentTarget.style.display='none';}}/>}<div><strong>محمد ذعار العجمي للسيارات</strong><small>طلب سيارة إلكتروني</small></div></header>;break;
      case 'cover':content=style.coverUrl?<img className="mlf-cover" src={style.coverUrl} alt="صورة السيارة"/>:null;break;
      case 'heading':content=<div className={`mlf-public-heading ${form.template==='chat'?'mlf-chat-question':''}`}>
        {form.template==='chat'&&<ChatCircleDots size={22} weight="duotone"/>}
        <span>{current?`الخطوة ${step+1} من ${count}`:'بيانات التواصل'}</span>
        <h1>{block.text || (current?.label || 'آخر خطوة.. خلينا نتواصل معاك')}</h1>
        {(current?.description||(!step?style.welcome:undefined))&&<p>{current?.description||style.welcome}</p>}
      </div>;break;
      case 'progress':content=<div className="mlf-progress" role="progressbar" aria-valuenow={step+1} aria-valuemin={1} aria-valuemax={count}><span style={{width:`${(step+1)/count*100}%`}}/></div>;break;
      case 'question':content=<div className="mlf-question-region">{history()}{fieldContent()}</div>;break;
      case 'contact':content=contactContent();break;
      case 'actions':content=actionsContent();break;
      case 'trust':content=<div className="mlf-public-security"><LockKey size={14}/>{preview?'وضع معاينة: لا يتم حفظ أي بيانات':'يتم استخدام بياناتك للرد على طلبك فقط'}</div>;break;
      case 'success':content=successContent();break;
      case 'text':content=<p className="mlf-custom-text">{block.text||''}</p>;break;
      case 'image':content=block.imageUrl?<img className="mlf-custom-image" src={block.imageUrl} alt={block.text||'صورة الفورم'} loading="lazy"/>:null;break;
      case 'badge':content=<span className="mlf-custom-badge">{block.text||'عرض خاص'}</span>;break;
      case 'divider':content=<hr className="mlf-custom-divider"/>;break;
      case 'spacer':content=<div aria-hidden="true" className="mlf-custom-spacer" style={{height:block.height||24}}/>;break;
    }
    if(content===null)return null;
    return <div key={block.id} className={`mlf-render-block mlf-render-block-${block.kind} mlf-align-${block.align||'right'} mlf-width-${block.width||'full'} mlf-size-${block.size||'md'}`}>{content}</div>;
  }
  const screenStyle={ '--lf-brown':style.brown || '#4A211C','--lf-cream':style.cream || '#F3E8DC','--lf-max-width':`${design.maxWidth}px` } as CSSProperties;
  return <div className={`mlf-public mlf-template-${form.template} mlf-surface-${design.surface} mlf-animation-${design.animation} mlf-button-${design.buttonShape} ${compact?'mlf-compact':''}`} style={screenStyle} dir="rtl"
    onTouchStart={e=>{const el=e.target as HTMLElement;if(el.closest('input,textarea,select,button,a'))return;touch.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}}
    onTouchEnd={e=>{if(!touch.current||done)return;const dx=e.changedTouches[0].clientX-touch.current.x,dy=e.changedTouches[0].clientY-touch.current.y;touch.current=null;if(Math.abs(dx)<100||Math.abs(dy)>Math.abs(dx)*.6)return;if(dx>0&&step>0)previous();else if(dx<0&&current)next();}}>
    <div className="mlf-public-glow" aria-hidden="true"/>
    <div className="mlf-public-card">
      <div key={stageId} className="mlf-design-screen">
        {blocks.map(renderBlock)}
      </div>
      {error&&<p className="mlf-public-error" role="alert"><WarningCircle size={17}/>{error}</p>}
    </div>
  </div>;
}
