import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle, WarningCircle, ChatCircleDots, CarProfile } from '@phosphor-icons/react';
import type { FormConfig, FormField, FormTemplate } from '../../../shared/lead-forms';
import { DEFAULT_FORM_CONFIG } from '../../../shared/lead-forms';
import { resolveFormDesign, choiceLayoutFor, type DesignBlock } from '../../../shared/lead-form-design';
import { effectiveChoiceOptions, isVisibleField, validFormAnswers } from '../../../shared/lead-form-rules';
import { formLeadAttribution } from './pixel-tracking';
import './lead-forms.css';

export type RendererForm = { title:string; description:string; template:FormTemplate; config:FormConfig; slug?:string };
export type StoredFormLead = {id:string;created:boolean;crmStatus:string|null};
function uuid() { return typeof crypto!=='undefined' && crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-4000-8000-${Math.floor(Math.random()*2**48).toString(16).padStart(12,'0')}`; }
function getVisitor(slug: string, tracking: ReturnType<typeof formLeadAttribution>) {
  // Same browser tab can test multiple campaign links for the same form. A
  // visit's UTM is immutable on the server, so keep a distinct visit per link.
  const scope = JSON.stringify([tracking.source.toLowerCase(), tracking.campaign, tracking.medium, tracking.adId]);
  try {
    const key = `mzj-form-visitor-${slug}`;
    const record = JSON.parse(sessionStorage.getItem(key) || 'null') as { id?: string; scope?: string } | null;
    if (record?.scope === scope && record.id && /^[0-9a-f-]{36}$/i.test(record.id)) return record.id;
    const id = uuid();
    sessionStorage.setItem(key, JSON.stringify({ id, scope }));
    return id;
  } catch { return uuid(); }
}
function getTracking() {
  return formLeadAttribution(window.location.search, document.referrer);
}
export function LeadFormRenderer({ form, preview=false, compact=false, onLeadStored }:{ form:RendererForm;preview?:boolean;compact?:boolean;onLeadStored?:(lead:StoredFormLead)=>void }) {
  const config=form.config?.fields?.length?form.config:DEFAULT_FORM_CONFIG;
  const style=config.style || DEFAULT_FORM_CONFIG.style;
  const askName=config.contact?.askName!==false;
  const design=useMemo(()=>resolveFormDesign(config.design,form.template,config.fields),[config.design,config.fields,form.template]);
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const [step,setStep]=useState(0);
  const [name,setName]=useState(''),[phone,setPhone]=useState('');
  const [sending,setSending]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
  const tracking=useMemo(getTracking,[]);
  const session=useRef(getVisitor(form.slug || 'preview',tracking));
  const submissionKey=useRef(uuid());
  const touch=useRef<{x:number;y:number}|null>(null);
  const fields=config.fields.filter(f=>isVisibleField(f,answers));
  const count=fields.length+1;
  const current=fields[step];
  const stageId=done?'success':current?.id||'contact';
  const blocks=design.screens[stageId] || [];
  useEffect(()=>{if(step>fields.length)setStep(fields.length);},[step,fields.length]);
  useEffect(()=>{setAnswers(previous=>{const cleaned=validFormAnswers(config.fields,previous);return Object.keys(cleaned).length===Object.keys(previous).length?previous:cleaned;});},[config.fields]);
  useEffect(()=>{
    if(preview || !form.slug)return;
    void fetch('/api/marketing/lead-forms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'view',slug:form.slug,visitor:session.current,...tracking}),keepalive:true}).catch(()=>undefined);
  },[preview,form.slug,tracking]);
  useEffect(()=>{
    if(preview||!form.slug||done)return;
    void fetch('/api/marketing/lead-forms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'step',slug:form.slug,visitor:session.current,step:current?.id || 'contact',...tracking}),keepalive:true}).catch(()=>undefined);
  },[preview,form.slug,current?.id,done,tracking]);
  const answer=(field:FormField,value:string)=>{
    setAnswers(prev=>validFormAnswers(config.fields,{...prev,[field.id]:value}));setError('');
    if(field.type==='choice')setStep(s=>Math.min(s+1,fields.length));
  };
  const next=()=>{
    if(current && current.required && !String(answers[current.id]||'').trim()){setError('أجب عن السؤال قبل المتابعة');return;}
    setError('');setStep(s=>Math.min(s+1,fields.length));
  };
  const previous=()=>{setError('');setStep(s=>Math.max(0,s-1));};
  async function submit() {
    if(askName && name.trim().length<2){setError('يرجى إدخال الاسم الكامل');return;}
    if(!/^(?:05\d{8}|(?:\+?966)5\d{8})$/.test(phone.replace(/[\s()-]/g,''))){setError('أدخل رقم جوال سعودي صحيح');return;}
    if(preview){setDone(true);return;}
    setSending(true);setError('');
    try {
      const result=await fetch('/api/marketing/lead-forms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'submit',slug:form.slug,visitor:session.current,submissionKey:submissionKey.current,name:askName?name.trim():'',phone,consent:false,noticeProvided:true,answers:validFormAnswers(config.fields,answers),...tracking,website:''})});
      const json=await result.json().catch(()=>({}));
      if(!result.ok||!json.ok)throw new Error(String(json.error||'تعذر إرسال الطلب'));
      setDone(true);
      // A third-party pixel must never change the result of a successful form save.
      try { if(typeof json.id==='string')onLeadStored?.({id:json.id,created:json.created===true,crmStatus:typeof json.crmStatus==='string'?json.crmStatus:null}); }
      catch { /* Nonessential measurement cannot affect customer submissions. */ }
    } catch(e) {setError(e instanceof Error?e.message:'تعذر إرسال الطلب');}
    finally {setSending(false);}
  }
  function fieldContent(){
    if(!current)return null;
    if(current.type!=='choice')return <label className="mlf-public-input"><span>{current.label}</span><input type={current.type==='number'?'number':'text'} inputMode={current.type==='number'?'decimal':'text'} value={answers[current.id]||''} placeholder="اكتب إجابتك هنا" onChange={e=>answer(current,e.target.value)} maxLength={180}/></label>;
    return <div className={`mlf-choice-grid mlf-choice-mode-${choiceLayoutFor(design,current.id)}`} role="group" aria-label={current.label}>{effectiveChoiceOptions(current,answers).map((option,index)=>
      <button type="button" key={`${index}-${option}`} className={`mlf-choice ${answers[current.id]===option?'selected':''}`} onClick={()=>answer(current,option)}>
        {current.optionImages?.[option]?<img className={current.optionImageModes?.[option]==='logo'?'mlf-option-image mlf-option-logo':'mlf-option-image'} src={current.optionImages[option]} alt="" loading="lazy"/>:
          <span className="mlf-choice-icon">{form.template==='visual'?<CarProfile size={25} weight="duotone"/>:String(index+1).padStart(2,'0')}</span>}
        <strong>{option}</strong><ArrowLeft className="mlf-choice-arrow" size={17}/>
      </button>)}</div>;
  }
  function contactContent(){return <div className="mlf-contact">
    {askName&&<label>الاسم الكامل<input autoComplete="name" value={name} placeholder="اكتب اسمك" maxLength={130} onChange={e=>setName(e.target.value)}/></label>}
    <label>رقم الجوال<input type="tel" inputMode="tel" autoComplete="tel" value={phone} placeholder="05XXXXXXXX" maxLength={24} onChange={e=>setPhone(e.target.value)}/></label>
  </div>;}
  function actionsContent(){return <footer className="mlf-public-actions">
    {step>0&&<button type="button" className="mlf-public-back" onClick={previous}><ArrowRight size={18}/> السابق</button>}
    {current?.type==='choice'?<small>اختار إجابة للانتقال تلقائيًا</small>:<button type="button" disabled={sending} className="mlf-public-button" onClick={()=>current?next():void submit()}>{sending?'جاري إرسال الطلب...':current?'التالي':style.actionLabel}<ArrowLeft size={19}/></button>}
  </footer>;}
  function successContent(){return <div className="mlf-done" role="status"><CheckCircle size={72} weight="duotone"/><h1>{style.successTitle}</h1><p>{style.successMessage}</p>{preview&&<button type="button" className="mlf-public-button" onClick={()=>{setStep(0);setAnswers({});setName('');setPhone('');setDone(false);}}>إعادة التجربة</button>}</div>;}
  function history():ReactNode {
    if(form.template!=='chat'||!current)return null;
    return <div className="mlf-chat-history">{fields.slice(0,step).filter(f=>answers[f.id]).map(f=><div key={f.id} className="mlf-chat-exchange"><div className="mlf-chat-bot">{f.label}</div><div className="mlf-chat-human">{answers[f.id]}</div></div>)}</div>;
  }
  function renderBlock(block:DesignBlock){
    let content:ReactNode=null;
    switch(block.kind){
      case 'brand':content=<header className="mlf-public-brand">{style.logoUrl&&<img src={style.logoUrl} alt="شعار محمد ذعار العجمي للسيارات" onError={e=>{e.currentTarget.style.display='none';}}/>}<div><strong>محمد ذعار العجمي للسيارات</strong><small>{style.subtitle||'طلب سيارة إلكتروني'}</small></div></header>;break;
      case 'cover':content=style.coverUrl?<img className="mlf-cover" src={style.coverUrl} alt="صورة السيارة"/>:null;break;
      case 'heading':content=<div className={`mlf-public-heading ${form.template==='chat'?'mlf-chat-question':''}`}>
        {form.template==='chat'&&<ChatCircleDots size={22} weight="duotone"/>}
        <span>{current?`الخطوة ${step+1} من ${count}`:'بيانات التواصل'}</span>
        <h1>{current ? (block.text || current.label) : (style.contactTitle || block.text || 'آخر خطوة.. خلينا نتواصل معاك')}</h1>
        {(current?.description||(!step?style.welcome:undefined))&&<p>{current?.description||style.welcome}</p>}
      </div>;break;
      case 'progress':content=<div className="mlf-progress" role="progressbar" aria-valuenow={step+1} aria-valuemin={1} aria-valuemax={count}><span style={{width:`${(step+1)/count*100}%`}}/></div>;break;
      case 'question':content=<div className="mlf-question-region">{history()}{fieldContent()}</div>;break;
      case 'contact':content=contactContent();break;
      case 'actions':content=actionsContent();break;
      case 'trust':content=null;break; // Legacy decorative note: no longer shown to customers.
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
  const screenStyle={ '--lf-brown':style.brown || '#4A211C','--lf-cream':style.cream || '#F3E8DC','--lf-max-width':`${design.maxWidth}px`,'--lf-cover-height':`${style.coverHeight||120}px` } as CSSProperties;
  return <div className={`mlf-public mlf-template-${form.template} mlf-surface-${design.surface} mlf-animation-${design.animation} mlf-button-${design.buttonShape} ${compact?'mlf-compact':''}`} style={screenStyle} dir="rtl"
    onTouchStart={e=>{const el=e.target as HTMLElement;if(el.closest('input,textarea,select,button,a'))return;touch.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}}
    onTouchEnd={e=>{if(!touch.current||done)return;const dx=e.changedTouches[0].clientX-touch.current.x,dy=e.changedTouches[0].clientY-touch.current.y;touch.current=null;if(Math.abs(dx)<100||Math.abs(dy)>Math.abs(dx)*.6)return;if(dx>0&&step>0)previous();else if(dx<0&&current)next();}}>
    <div className="mlf-public-glow" aria-hidden="true"/>
    <div className="mlf-public-card">
      <div key={stageId} className="mlf-design-screen">
        {blocks.map(renderBlock)}
      </div>
      {error&&<p className="mlf-public-error" role="alert"><WarningCircle size={17}/>{error}</p>}
      {!done&&<div className="mlf-privacy-link"><a href="/privacy" target="_blank" rel="noopener noreferrer">سياسة الخصوصية</a></div>}
    </div>
  </div>;
}
