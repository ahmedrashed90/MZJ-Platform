import { CarProfile, ChatCircleDots, CheckCircle, Lightning } from '@phosphor-icons/react';
import type { FormConfig, FormTemplate } from '../../../shared/lead-forms';
import './lead-forms.css';
/** A real preview of each layout family, not six copies of the same decorative phone. */
export function FormTemplateThumbnail({template,config}:{template:FormTemplate;config?:FormConfig}){
  const label=config?.fields[0]?.label||'إيه السيارة اللي بتدور عليها؟';
  const choices=config?.fields[0]?.options?.slice(0,4)||['هيونداي','تويوتا','نيسان','أخرى'];
  return <div className={`mlf-gallery-frame mlf-gallery-${template}`} dir="rtl">
    {template==='steps'&&<div className="mlf-gallery-phone"><div className="mlf-gallery-brand">MZJ <span>01 / 04</span></div><div className="mlf-gallery-progress"/><strong>{label}</strong>{choices.slice(0,3).map((s,i)=><div key={i} className="mlf-gallery-row"><span>{i+1}</span>{s}</div>)}</div>}
    {template==='visual'&&<div className="mlf-gallery-visual"><div className="mlf-gallery-hero"><CarProfile size={50} weight="duotone"/><strong>اختار سيارتك</strong></div><div className="mlf-gallery-visual-options">{choices.slice(0,4).map((s,i)=><div key={i}><CarProfile size={20}/><small>{s}</small></div>)}</div></div>}
    {template==='chat'&&<div className="mlf-gallery-chat"><div className="mlf-gallery-chat-bar"><ChatCircleDots size={18}/> مساعد MZJ</div><div className="mlf-gallery-bubble bot">أهلاً بيك! 👋</div><div className="mlf-gallery-bubble bot">{label}</div><div className="mlf-gallery-bubble human">{choices[0]}</div><div className="mlf-gallery-chat-input">اكتب ردك ...</div></div>}
    {template==='quiz'&&<div className="mlf-gallery-quiz"><div className="mlf-gallery-quiz-badge"><Lightning size={18} weight="fill"/> اختبار سريع</div><span>السؤال 1 من 4</span><h3>{label}</h3><div className="mlf-gallery-quiz-grid">{choices.slice(0,4).map((s,i)=><div key={i}><span>{i+1}</span>{s}</div>)}</div></div>}
    {template==='minimal'&&<div className="mlf-gallery-minimal"><span>محمد ذعار العجمي للسيارات</span><div className="mlf-gallery-minimal-line"/><h3>{label}</h3>{choices.slice(0,2).map((s,i)=><div key={i}>{s}<span>←</span></div>)}<small>01 — 04</small></div>}
    {template==='classic'&&<div className="mlf-gallery-classic"><header><strong>طلب عرض سعر</strong><small>محمد ذعار العجمي للسيارات</small></header><div className="mlf-gallery-classic-row"><div>اسم العميل<div className="mlf-gallery-fake-input"/></div><div>رقم الجوال<div className="mlf-gallery-fake-input"/></div></div><div className="mlf-gallery-fake-input full">السيارة المطلوبة</div><div className="mlf-gallery-classic-button"><CheckCircle size={15}/> إرسال الطلب</div></div>}
  </div>;
}
