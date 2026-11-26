import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowLeft, ArrowRight, CaretDown, Check, Copy, DeviceMobile, DotsSixVertical, ImageSquare, Monitor, Plus, Trash } from '@phosphor-icons/react';
import type { FormConfig, FormField, FormFieldType, FormTemplate } from '../../../shared/lead-forms';
import { displayContactTitle, FORM_FIELD_TYPES } from '../../../shared/lead-forms';
import { FORM_CRM_FIELDS, resolveFormCrmField, type FormCrmField } from '../../../shared/lead-form-crm-fields';
import { allChoiceOptions, removeChoiceOption, isChoiceType, isSingleChoiceType } from '../../../shared/lead-form-rules';
import { ConditionalChoicesEditor } from './ConditionalChoicesEditor';
import { DESIGN_BLOCK_LABELS, REQUIRED_DESIGN_BLOCKS, createTemplateDesign, resolveFormDesign, choiceLayoutFor, fieldStepId, formStepIds, blockFieldId, orderedFormFields, type DesignBlock, type DesignBlockKind, type FormDesign } from '../../../shared/lead-form-design';
import './lead-forms.css';

type DragDescriptor={source:'palette'|'canvas';kind?:DesignBlockKind;fieldType?:FormFieldType;blockId?:string;x:number;y:number;over:number;active:boolean;pointerId:number};
const palette:DesignBlockKind[]=['title','text','image','video','badge','divider','spacer','brand','cover','heading','progress','question','contact','actions','success'];
const idFor=()=>`el_${Math.random().toString(36).slice(2,11)}`;
const getDefault=(kind:DesignBlockKind):DesignBlock=>({id:idFor(),kind,width:'full',align:kind==='badge'?'center':'right',size:'md',height:24,
  ...(kind==='text'?{text:'اكتب النص هنا'}:{}),...(kind==='title'?{text:'عنوان جديد'}:{}),...(kind==='badge'?{text:'عرض مميز'}:{}),...(kind==='image'?{text:'صورة السيارة'}:{})});
const clone=<T,>(v:T):T=>structuredClone(v);
const fieldWith=(config:FormConfig,id:string,patch:Partial<FormField>):FormConfig=>({...config,fields:config.fields.map(f=>f.id===id?{...f,...patch}:f)});
async function optimizeImage(file:File):Promise<string>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('ارفع صورة JPG أو PNG أو WebP فقط');
  if(file.size>8_000_000)throw new Error('حجم الصورة أكبر من 8MB');
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();img.src=url;await img.decode();
    const ratio=Math.min(1,1200/img.naturalWidth,850/img.naturalHeight);
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('تعذر تجهيز الصورة');
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    let result=canvas.toDataURL('image/webp',.72);
    if(!result.startsWith('data:image/webp;'))result=canvas.toDataURL('image/jpeg',.68);
    if(result.length>250000)throw new Error('الصورة كبيرة بعد الضغط. اختار صورة أصغر أو استخدم رابط HTTPS.');
    return result;
  }finally{URL.revokeObjectURL(url);}
}

function allows(kind:DesignBlockKind,screen:string,blocks:DesignBlock[]){
  if(kind==='question'&&['contact','success'].includes(screen))return false;
  if(kind==='contact'&&screen!=='contact')return false;
  if(kind==='success'&&screen!=='success')return false;
  if(kind==='actions'&&screen==='success')return false;
  if(['brand','cover','heading','progress','question','contact','actions','trust','success'].includes(kind) && blocks.some(b=>b.kind===kind))return false;
  return blocks.length<30;
}

export function FormVisualDesigner({config,template,onChange}:{config:FormConfig;template:FormTemplate;onChange:(config:FormConfig)=>void}){
  const [screen,setScreen]=useState('');
  const [selected,setSelected]=useState<string>('');
  const [viewport,setViewport]=useState<'mobile'|'desktop'>('mobile');
  const [drag,setDrag]=useState<DragDescriptor|null>(null);
  const currentDrag=useRef<DragDescriptor|null>(null);
  const history=useRef<{undo:FormConfig[];redo:FormConfig[]}>({undo:[],redo:[]});
  const design=resolveFormDesign(config.design,template,config.fields);
  const steps=formStepIds(config.fields);
  const ordered=orderedFormFields(config.fields,design);
  const screenId=screen&&(screen==='contact'||screen==='success'||steps.includes(screen))?screen:(steps[0]||'contact');
  const blocks=design.screens[screenId]||[];
  const stepFields=ordered.filter(f=>fieldStepId(f)===screenId);
  const stepField=stepFields[0];
  const active=blocks.find(b=>b.id===selected)||blocks.find(b=>b.kind==='question')||null;
  const currentField=active?.kind==='question'?stepFields.find(f=>f.id===blockFieldId(active,screenId)):stepField;
  const modern=blocks.filter(b=>b.kind==='question').length>1||blocks.some(b=>b.kind==='question'&&b.fieldId);
  const questionChoiceLayout=currentField&&isChoiceType(currentField.type)?choiceLayoutFor(design,currentField.id):design.choices;
  const unboundField=stepFields.find(f=>!blocks.some(b=>b.kind==='question'&&blockFieldId(b,screenId)===f.id));
  const canAddField=!!stepField&&blocks.length<30&&(config.fields.length<14||!!unboundField);
  const insertIndex=()=>{const i=blocks.findIndex(b=>b.kind==='actions');return i<0?blocks.length:i;};
  const fieldTypeLabel=(type:FormFieldType)=>FORM_FIELD_TYPES.find(t=>t.value===type)?.label||'سؤال';
  const savedContactTitle=displayContactTitle(config.style.contactTitle || design.screens.contact?.find(b=>b.kind==='heading')?.text);
  const colors={'--lf-brown':config.style.brown,'--lf-cream':config.style.cream,'--lf-cover-height':`${config.style.coverHeight||120}px`} as CSSProperties;
  function commit(next:FormConfig){history.current.undo.push(clone(config));if(history.current.undo.length>50)history.current.undo.shift();history.current.redo=[];onChange(next);}
  function updateDesign(next:FormDesign){commit({...config,design:next,fields:orderedFormFields(config.fields,next)});}
  function keepsDependencies(fields:FormField[],nextDesign:FormDesign){
    const list=orderedFormFields(fields,nextDesign);
    const invalid=list.some((field,i)=>{
      const refs=[...(field.showIf?[field.showIf.fieldId]:[]),...(field.optionRules||[]).flatMap(rule=>rule.conditions.map(c=>c.fieldId))];
      return refs.some(id=>{const index=list.findIndex(f=>f.id===id);if(index<i)return false;const parent=list[index];const screen=nextDesign.screens[fieldStepId(parent)];return !screen||screen.some(b=>b.kind==='question'&&blockFieldId(b,fieldStepId(parent))===id);});
    });
    if(invalid){window.alert('لا يمكن وضع سؤال قبل السؤال الذي يعتمد عليه. عدّل شرط الظهور أو الاختيارات أولًا.');return false;}
    return true;
  }
  function makeField(type:FormFieldType,id:string,stepId?:string):FormField{
    return {id,...(stepId&&stepId!==id?{stepId}:{}),label:type==='consent'?'أوافق على الشروط':'سؤال جديد',type,required:true,options:isChoiceType(type)?['الاختيار الأول','الاختيار الثاني']:[],placeholder:''};
  }
  function changeType(field:FormField,type:FormFieldType):FormField{
    if(field.type===type)return field;
    return {...field,type,options:isChoiceType(type)?(isChoiceType(field.type)?field.options:['الاختيار الأول','الاختيار الثاني']):[],optionRules:isChoiceType(type)?field.optionRules:[],optionImages:isChoiceType(type)?field.optionImages:{},optionImageModes:isChoiceType(type)?field.optionImageModes:{},placeholder:''};
  }
  function addTypedQuestion(type:FormFieldType,index=insertIndex()){
    if(!canAddField)return;
    const reuse=unboundField;
    const field=reuse?changeType(reuse,type):makeField(type,`q_${idFor().slice(3)}`,screenId);
    const item:DesignBlock={...getDefault('question'),fieldId:field.id};
    const nextDesign={...design,screens:{...design.screens,[screenId]:[...blocks.slice(0,index),item,...blocks.slice(index)]}};
    const fields=reuse?config.fields.map(f=>f.id===field.id?field:f):[...config.fields,field];
    if(!keepsDependencies(fields,nextDesign))return;
    commit({...config,fields:orderedFormFields(fields,nextDesign),design:nextDesign});setSelected(item.id);
  }
  function withBlocks(next:DesignBlock[]){updateDesign({...design,screens:{...design.screens,[screenId]:next}});}
  function updateBlock(patch:Partial<DesignBlock>){if(!active)return;withBlocks(blocks.map(b=>b.id===active.id?{...b,...patch}:b));}
  function add(kind:DesignBlockKind,index=insertIndex()){
    if(!allows(kind,screenId,blocks))return;
    if(kind==='question'&&!unboundField)return;
    const item={...getDefault(kind),...(kind==='question'&&unboundField&&unboundField.id!==screenId?{fieldId:unboundField.id}:{})};
    withBlocks([...blocks.slice(0,index),item,...blocks.slice(index)]);setSelected(item.id);
  }
  function move(blockId:string,index:number){const original=blocks.findIndex(b=>b.id===blockId);if(original<0)return;const newBlocks=[...blocks];const [item]=newBlocks.splice(original,1);const target=original<index?index-1:index;newBlocks.splice(Math.min(Math.max(target,0),newBlocks.length),0,item);if(newBlocks.every((b,i)=>b.id===blocks[i]?.id))return;const nextDesign={...design,screens:{...design.screens,[screenId]:newBlocks}};if(!keepsDependencies(config.fields,nextDesign))return;updateDesign(nextDesign);setSelected(blockId);}
  function removeBlock(blockId:string){
    const item=blocks.find(b=>b.id===blockId);if(!item||REQUIRED_DESIGN_BLOCKS.includes(item.kind))return;
    const nextBlocks=blocks.filter(b=>b.id!==blockId);
    const nextDesign={...design,screens:{...design.screens,[screenId]:nextBlocks}};
    // A legacy input can be restored; remove independent question metadata when sibling fields remain.
    const removeId=item.kind==='question'&&item.fieldId&&stepFields.length>1?item.fieldId:undefined;
    if(removeId){const choiceLayouts={...nextDesign.choiceLayouts};delete choiceLayouts[removeId];nextDesign.choiceLayouts=choiceLayouts;}
    const fields=removeId?config.fields.filter(f=>f.id!==removeId):config.fields;
    commit({...config,design:nextDesign,fields:orderedFormFields(fields,nextDesign)});setSelected('');
  }
  function removeChoice(option:string,field=currentField){if(!field||!isChoiceType(field.type))return;commit(fieldWith(config,field.id,removeChoiceOption(field,option)));}
  function updateField(patch:Partial<FormField>){if(!currentField)return;const next=fieldWith(config,currentField.id,patch);if(active?.kind==='question'&&(patch.label!==undefined||patch.description!==undefined||patch.placeholder!==undefined||patch.required!==undefined)){next.design={...design,screens:{...design.screens,[screenId]:blocks.map(b=>b.id===active.id?{...b,fieldId:currentField.id}:b)}};}commit(next);}
  function setQuestionType(type:FormFieldType){
    if(!currentField||!active)return;
    const nextDesign={...design,screens:{...design.screens,[screenId]:blocks.map(b=>b.id===active.id?{...b,fieldId:currentField.id}:b)}};
    commit({...config,design:nextDesign,fields:config.fields.map(f=>f.id===currentField.id?changeType(f,type):f)});
  }
  function duplicateBlock(blockId:string){
    const item=blocks.find(b=>b.id===blockId);if(!item||blocks.length>=30)return;
    const index=blocks.indexOf(item)+1;
    if(item.kind==='question'){
      const field=stepFields.find(f=>f.id===blockFieldId(item,screenId));if(!field||config.fields.length>=14)return;
      const id=`q_${idFor().slice(3)}`;
      const nextField={...clone(field),id,stepId:screenId,label:`${field.label} (نسخة)`};
      const copy={...clone(item),id:idFor(),fieldId:id};
      const nextDesign={...design,screens:{...design.screens,[screenId]:[...blocks.slice(0,index),copy,...blocks.slice(index)]},choiceLayouts:{...design.choiceLayouts,[id]:choiceLayoutFor(design,field.id)}};
      commit({...config,design:nextDesign,fields:orderedFormFields([...config.fields,nextField],nextDesign)});setSelected(copy.id);
    }else if(!['brand','cover','heading','progress','contact','actions','trust','success'].includes(item.kind)){
      const copy={...clone(item),id:idFor()};withBlocks([...blocks.slice(0,index),copy,...blocks.slice(index)]);setSelected(copy.id);
    }
  }
  function addQuestion(){
    if(config.fields.length>=14)return;
    const id=`q_${idFor().slice(3)}`;
    const nextField=makeField('text',id);
    const screenBlocks=createTemplateDesign(template,[nextField]).screens[id].map(b=>b.kind==='question'?{...b,fieldId:id}:b);
    const nextDesign={...design,screens:{...design.screens,[id]:screenBlocks},choiceLayouts:{...design.choiceLayouts,[id]:design.choices}};
    commit({...config,fields:[...config.fields,nextField],design:nextDesign});setScreen(id);setSelected(screenBlocks.find(b=>b.kind==='question')?.id||'');
  }
  function deleteStep(){
    if(!stepField||steps.length<=1||!window.confirm('حذف هذه الخطوة وكل أسئلتها؟'))return;
    const fields=config.fields.filter(f=>fieldStepId(f)!==screenId);
    const screens={...design.screens},choiceLayouts={...design.choiceLayouts};delete screens[screenId];stepFields.forEach(f=>delete choiceLayouts[f.id]);
    commit({...config,fields,design:{...design,screens,choiceLayouts}});setScreen(steps[steps.indexOf(screenId)+1]||steps[steps.indexOf(screenId)-1]);setSelected('');
  }
  function reorderStep(direction:number){
    const i=steps.indexOf(screenId),j=i+direction;
    if(i<0||j<0||j>=steps.length)return;
    const order=[...steps];[order[i],order[j]]=[order[j],order[i]];
    const fields=order.flatMap(id=>ordered.filter(f=>fieldStepId(f)===id));
    if(keepsDependencies(fields,design))commit({...config,fields});
  }

  function undo(){const old=history.current.undo.pop();if(!old)return;history.current.redo.push(clone(config));onChange(old);setSelected('');}
  function redo(){const next=history.current.redo.pop();if(!next)return;history.current.undo.push(clone(config));onChange(next);setSelected('');}
  function dropIndexAt(el:HTMLElement|null,y:number,fallback:number){
    const slot=el?.closest<HTMLElement>('[data-mlf-drop-index]');
    if(slot?.dataset.mlfScreen===screenId)return Number(slot.dataset.mlfDropIndex);
    const block=el?.closest<HTMLElement>('[data-mlf-block-index]');
    if(block?.dataset.mlfScreen===screenId){const rect=block.getBoundingClientRect();return Number(block.dataset.mlfBlockIndex)+(y>rect.top+rect.height/2?1:0);}
    return fallback;
  }
  function pointerDown(e:PointerEvent<HTMLButtonElement>,descriptor:Pick<DragDescriptor,'source'|'kind'|'fieldType'|'blockId'>){
    if(e.button!==0)return;
    const d:DragDescriptor={...descriptor,x:e.clientX,y:e.clientY,over:blocks.length,active:false,pointerId:e.pointerId};
    currentDrag.current=d;setDrag(d);e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e:PointerEvent<HTMLButtonElement>){
    const d=currentDrag.current;if(!d||d.pointerId!==e.pointerId)return;
    const active=d.active||Math.hypot(e.clientX-d.x,e.clientY-d.y)>7;
    const el=document.elementFromPoint(e.clientX,e.clientY) as HTMLElement|null;
    const over=dropIndexAt(el,e.clientY,d.over);
    currentDrag.current={...d,active,over};setDrag(currentDrag.current);
  }
  function pointerUp(e:PointerEvent<HTMLButtonElement>){
    const d=currentDrag.current;if(!d||d.pointerId!==e.pointerId)return;
    currentDrag.current=null;setDrag(null);
    if(d.source==='palette'){
      const index=d.active?dropIndexAt(document.elementFromPoint(e.clientX,e.clientY) as HTMLElement|null,e.clientY,-1):insertIndex();
      if(index>=0){if(d.fieldType)addTypedQuestion(d.fieldType,index);else if(d.kind)add(d.kind,index);}
    }
    if(d.source==='canvas'&&d.blockId&&d.active){const el=document.elementFromPoint(e.clientX,e.clientY) as HTMLElement|null;const index=dropIndexAt(el,e.clientY,-1);if(index>=0)move(d.blockId,index);}
  }
  function previewBlock(b:DesignBlock):ReactNode{
    switch(b.kind){
      case 'brand':return <div className="mlf-dv-brand">{config.style.logoUrl&&<img src={config.style.logoUrl} alt=""/>}<span>محمد ذعار العجمي للسيارات<small>{config.style.subtitle||'طلب سيارة إلكتروني'}</small></span></div>;
      case 'cover':return config.style.coverUrl?<img className="mlf-dv-cover" src={config.style.coverUrl} alt="صورة الغلاف"/>:<div className="mlf-dv-placeholder"><ImageSquare size={26}/> صورة الغلاف</div>;
      case 'heading':return <div className="mlf-dv-heading">{screenId!=='contact'&&<small>{screenId==='success'?'نجاح التسجيل':`الخطوة ${steps.indexOf(screenId)+1}`}</small>}<h3>{screenId==='contact' ? savedContactTitle : (b.text||(modern?'بيانات الطلب':stepField?.label)||'تم التسجيل')}</h3>{!modern&&stepField?.description&&<p>{stepField.description}</p>}</div>;
      case 'progress':return <div className="mlf-dv-progress"><span style={{width:`${Math.max(16,100*(steps.indexOf(screenId)+1)/Math.max(steps.length+1,1))}%`}}/></div>;
      case 'question':{
        const field=stepFields.find(f=>f.id===blockFieldId(b,screenId));if(!field)return null;
        const showLabel=modern||!blocks.some(b=>b.kind==='heading')||!isChoiceType(field.type);
        const questionChoiceLayout=choiceLayoutFor(design,field.id);
        return <div className="mlf-dv-question">
          {showLabel&&field.type!=='consent'&&<><strong className="mlf-dv-question-label">{field.label}{field.required&&<span className="mlf-required"> *</span>}</strong>{field.description&&<small>{field.description}</small>}</>}
          {field.type==='choice'||field.type==='multi'?<div className={`mlf-dv-options mlf-dv-options-${questionChoiceLayout}`}>{field.options.filter(Boolean).map((option,i)=><div key={`${option}-${i}`}>{field.optionImages?.[option]?<img className={field.optionImageModes?.[option]==='logo'?'mlf-dv-option-logo':''} src={field.optionImages[option]} alt=""/>:<span>{field.type==='multi'?'□':String(i+1).padStart(2,'0')}</span>}{option}<button type="button" className="mlf-dv-choice-delete" title={`حذف الاختيار: ${option}`} aria-label={`حذف الاختيار: ${option}`} onClick={e=>{e.stopPropagation();removeChoice(option,field);}}><Trash size={14}/></button></div>)}{!field.options.filter(Boolean).length&&<small>لا توجد اختيارات — أضف اختيارًا من الخصائص أو احذف السؤال.</small>}</div>
          :field.type==='dropdown'?<div className="mlf-dv-input mlf-dv-dropdown"><span>{field.placeholder||'اختر الإجابة'}</span><CaretDown size={15}/></div>
          :field.type==='consent'?<div className="mlf-dv-consent"><span>□</span> {field.label}{field.required&&<span className="mlf-required"> *</span>}</div>
          :<div className={`mlf-dv-input ${field.type==='longtext'?'mlf-dv-input-long':''}`}>{field.placeholder||(field.type==='number'?'اكتب الرقم':field.type==='phone'?'05XXXXXXXX':field.type==='email'?'name@example.com':field.type==='date'?'يوم / شهر / سنة':'اكتب إجابتك هنا')}</div>}
        </div>;
      }
      case 'contact':return <div className="mlf-dv-contact">{config.contact?.askName!==false&&<div>الاسم الكامل</div>}<div>رقم الجوال</div><small>سياسة الخصوصية</small></div>;
      case 'actions':return <div className="mlf-dv-actions"><span>السابق</span><strong>{screenId==='contact'?config.style.actionLabel:'التالي'}</strong></div>;
      case 'trust':return null;
      case 'success':return <div className="mlf-dv-success"><Check size={38}/><strong>{config.style.successTitle}</strong><p>{config.style.successMessage}</p></div>;
      case 'title':return <h3 className="mlf-dv-title">{b.text||'عنوان جديد'}</h3>;
      case 'video':return <div className="mlf-dv-placeholder">{b.videoUrl?'فيديو — جاهز للمعاينة المباشرة':'أضف رابط فيديو MP4 أو WebM'}</div>;
      case 'text':return <p className="mlf-dv-text">{b.text||'نص جديد'}</p>;
      case 'image':return b.imageUrl?<img className="mlf-dv-cover" src={b.imageUrl} alt={b.text||'صورة'}/>:<div className="mlf-dv-placeholder"><ImageSquare size={22}/> أضف رابط الصورة من الخصائص</div>;
      case 'badge':return <span className="mlf-dv-badge">{b.text||'عرض مميز'}</span>;
      case 'divider':return <hr/>;
      case 'spacer':return <div style={{height:b.height||24}}/>;
    }
  }
  return <section className="marketing-card mlf-designer-root" dir="rtl">
    <div className="mlf-designer-header"><div><h2>مصمم الفورم بالسحب والإفلات</h2></div><div className="mlf-card-actions">
      <button type="button" className="secondary" onClick={undo} disabled={!history.current.undo.length} title="تراجع"><ArrowRight size={18}/></button>
      <button type="button" className="secondary" onClick={redo} disabled={!history.current.redo.length} title="إعادة"><ArrowLeft size={18}/></button>
      <button type="button" className={viewport==='mobile'?'primary':'secondary'} onClick={()=>setViewport('mobile')} title="معاينة الموبايل"><DeviceMobile size={18}/></button>
      <button type="button" className={viewport==='desktop'?'primary':'secondary'} onClick={()=>setViewport('desktop')} title="معاينة الكمبيوتر"><Monitor size={18}/></button>
    </div></div>
    <div className="mlf-designer-screenbar"><label>الخطوة التي تصممها<select value={screenId} onChange={e=>{setScreen(e.target.value);setSelected('');}}>{steps.map((id,i)=>{const group=ordered.filter(f=>fieldStepId(f)===id);return <option key={id} value={id}>الخطوة {i+1} — {group[0]?.label} ({group.length} سؤال)</option>;})}<option value="contact">بيانات التواصل</option><option value="success">نجاح التسجيل</option></select></label><div className="mlf-designer-step-actions"><button type="button" className="secondary" disabled={!stepField||steps.indexOf(screenId)===0} onClick={()=>reorderStep(-1)} title="تقديم الخطوة"><ArrowUp size={16}/></button><button type="button" className="secondary" disabled={!stepField||steps.indexOf(screenId)===steps.length-1} onClick={()=>reorderStep(1)} title="تأخير الخطوة"><ArrowDown size={16}/></button><button type="button" className="danger" disabled={!stepField||steps.length<=1} onClick={deleteStep} title="حذف الخطوة"><Trash size={16}/></button><button type="button" className="primary" disabled={config.fields.length>=14} onClick={addQuestion}><Plus size={16}/> إضافة خطوة</button></div><span>{config.fields.length} / 14 سؤال</span></div>
    <div className="mlf-designer-layout">
      <aside className="mlf-designer-toolbox"><h3>العناصر</h3><p className="mlf-tool-help">اضغط أو اسحب العنصر إلى الخطوة الحالية.</p>
        <h4>الأسئلة والإجابات</h4><div className="mlf-designer-tools">{FORM_FIELD_TYPES.map(item=><button type="button" key={item.value} className="mlf-tool mlf-question-tool" disabled={!canAddField} title={`إضافة ${item.label}`} style={{touchAction:'none'}}
          onPointerDown={e=>pointerDown(e,{source:'palette',fieldType:item.value})} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={()=>{currentDrag.current=null;setDrag(null);}} onClick={e=>{if(e.detail===0)addTypedQuestion(item.value);}}>
          <Plus size={15}/><span><strong>{item.label}</strong><small>{item.hint}</small></span><DotsSixVertical size={14}/></button>)}</div>
        <h4>عناصر التصميم</h4><div className="mlf-designer-tools">{palette.map(kind=><button type="button" key={kind} className="mlf-tool" disabled={!allows(kind,screenId,blocks)||(kind==='question'&&!unboundField)} title="اسحب للمساحة أو اضغط للإضافة" style={{touchAction:'none'}}
          onPointerDown={e=>pointerDown(e,{source:'palette',kind})} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={()=>{currentDrag.current=null;setDrag(null);}} onClick={e=>{if(e.detail===0)add(kind);}}>
          <Plus size={15}/><span>{DESIGN_BLOCK_LABELS[kind]}</span><DotsSixVertical size={14}/></button>)}</div></aside>
      <div className="mlf-designer-workspace"><div className={`mlf-designer-surface mlf-designer-surface-${viewport}`} style={colors}>
        <div className={`mlf-designer-form mlf-dv-surface-${design.surface}`}>
          {blocks.map((b,index)=><div key={b.id} className={`mlf-designer-slot-group ${b.width==='half'?'half':''}`}>
            <div data-mlf-drop-index={index} data-mlf-screen={screenId} className={`mlf-designer-drop ${drag?.active&&drag.over===index?'target':''}`}/>
            <div data-mlf-block-index={index} data-mlf-screen={screenId} className={`mlf-designer-block ${selected===b.id?'selected':''} mlf-dv-width-${b.width||'full'} mlf-dv-size-${b.size||'md'}`} onClick={()=>setSelected(b.id)}>
              <div className="mlf-designer-block-toolbar"><button type="button" className="mlf-designer-handle" title="اسحب لترتيب العنصر" aria-label={`سحب ${DESIGN_BLOCK_LABELS[b.kind]}`} style={{touchAction:'none'}}
                onPointerDown={e=>pointerDown(e,{source:'canvas',blockId:b.id})} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={()=>{currentDrag.current=null;setDrag(null);}}><DotsSixVertical size={17}/></button>
                <span>{b.kind==='question'&&b.fieldId?fieldTypeLabel(stepFields.find(f=>f.id===b.fieldId)?.type||'text'):DESIGN_BLOCK_LABELS[b.kind]}</span><button type="button" title="تحريك لأعلى" disabled={index===0} onClick={e=>{e.stopPropagation();move(b.id,index-1);}}><ArrowUp size={14}/></button><button type="button" title="تحريك لأسفل" disabled={index===blocks.length-1} onClick={e=>{e.stopPropagation();move(b.id,index+2);}}><ArrowDown size={14}/></button>{(b.kind==='question'||!['brand','cover','heading','progress','contact','actions','trust','success'].includes(b.kind))&&<button type="button" disabled={blocks.length>=30||(b.kind==='question'&&config.fields.length>=14)} title="نسخ العنصر" aria-label="نسخ العنصر" onClick={e=>{e.stopPropagation();duplicateBlock(b.id);}}><Copy size={14}/></button>}{!REQUIRED_DESIGN_BLOCKS.includes(b.kind)&&<button type="button" title={b.kind==='question'?'حذف بلوك الإجابات والاختيارات':'حذف العنصر'} aria-label={b.kind==='question'?'حذف بلوك الإجابات والاختيارات':'حذف العنصر'} onClick={e=>{e.stopPropagation();removeBlock(b.id);}}><Trash size={14}/></button>}
              </div>
              <div className={`mlf-designer-block-preview mlf-align-${b.align||'right'}`}>{previewBlock(b)}</div>
            </div>
          </div>)}
          <div data-mlf-drop-index={blocks.length} data-mlf-screen={screenId} className={`mlf-designer-drop end ${drag?.active&&drag.over===blocks.length?'target':''}`}>اسحب عنصرًا هنا</div>
        </div>
      </div></div>
      <aside className="mlf-designer-inspector"><h3>خصائص التصميم</h3>
        {active?<div className="mlf-inspector-fields"><strong>{active.kind==='question'&&currentField?fieldTypeLabel(currentField.type):DESIGN_BLOCK_LABELS[active.kind]}</strong>
          {['title','text','badge','heading'].includes(active.kind)&&<label>{active.kind==='heading'&&screenId==='contact'?'عنوان خطوة التواصل':'المحتوى'}<textarea rows={3} value={active.kind==='heading'&&screenId==='contact'?savedContactTitle:active.text||''} onChange={e=>active.kind==='heading'&&screenId==='contact'?commit({...config,style:{...config.style,contactTitle:e.target.value}}):updateBlock({text:e.target.value})} placeholder={active.kind==='heading'?'اتركه فارغًا لاستخدام سؤال الفورم':'اكتب النص'}/></label>}
          {active.kind==='video'&&<label>رابط فيديو مباشر (HTTPS — MP4 / WebM)<input dir="ltr" value={active.videoUrl||''} onChange={e=>updateBlock({videoUrl:e.target.value})} placeholder="https://example.com/video.mp4"/><small>يتم تشغيل الفيديو عند اختيار العميل، وليس تلقائيًا.</small></label>}
          {(active.kind==='image'||active.kind==='cover')&&<><label>رابط الصورة (HTTPS)<input dir="ltr" value={active.kind==='cover'?config.style.coverUrl:active.imageUrl||''} onChange={e=>active.kind==='cover'?commit({...config,style:{...config.style,coverUrl:e.target.value}}):updateBlock({imageUrl:e.target.value})} placeholder="https://..."/></label><label>أو ارفع صورة من جهازك<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const url=await optimizeImage(file);if(active.kind==='cover')commit({...config,style:{...config.style,coverUrl:url}});else updateBlock({imageUrl:url});}catch(err){window.alert(err instanceof Error?err.message:'تعذر قراءة الصورة');}e.target.value='';}}/></label></>}
          {active.kind==='cover'&&<label>أقصى ارتفاع لصورة الغلاف — {config.style.coverHeight||120} بكسل<input type="range" min="64" max="260" step="4" value={config.style.coverHeight||120} onChange={e=>commit({...config,style:{...config.style,coverHeight:Number(e.target.value)}})}/></label>}
          {active.kind==='brand'&&<><label>رابط الشعار<input dir="ltr" value={config.style.logoUrl} onChange={e=>commit({...config,style:{...config.style,logoUrl:e.target.value}})}/></label><label>أو ارفع الشعار<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const logoUrl=await optimizeImage(file);commit({...config,style:{...config.style,logoUrl}});}catch(err){window.alert(err instanceof Error?err.message:'تعذر قراءة الشعار');}e.target.value='';}}/></label></>}
          {active.kind==='question'&&currentField&&<>
            <label>نوع الإجابة<select value={currentField.type} onChange={e=>setQuestionType(e.target.value as FormFieldType)}>{FORM_FIELD_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
            <label>نص السؤال<input maxLength={120} value={currentField.label} onChange={e=>updateField({label:e.target.value})}/></label>
            <label>وصف السؤال<input value={currentField.description||''} onChange={e=>updateField({description:e.target.value})}/></label>
            <label>ربط بحقل CRM<select value={currentField.crmField==='notes'&&resolveFormCrmField(currentField.id,currentField.label,'notes')==='job'?'job':currentField.crmField||'auto'} onChange={e=>updateField({crmField:e.target.value as FormCrmField})}>{FORM_CRM_FIELDS.filter(f=>f.value!=='notes'||resolveFormCrmField(currentField.id,currentField.label,'notes')!=='job').map(f=><option key={f.value} value={f.value}>{f.label}</option>)}</select><small className="mlf-hint">{(!currentField.crmField||currentField.crmField==='auto')?`الربط الحالي: ${FORM_CRM_FIELDS.find(f=>f.value===resolveFormCrmField(currentField.id,currentField.label))?.label||'الملاحظات'}`:'يتم حفظ الإجابة في الحقل المحدد أو في الملاحظات إذا تعذر تحويلها.'} تُحفظ شرائح الراتب والالتزامات في حقولها، وتُحفظ الوظيفة في الحقل المخصص الموجود في إعدادات CRM.</small></label>
            <label className="mlf-question-required"><input type="checkbox" checked={currentField.required} onChange={e=>updateField({required:e.target.checked})}/> السؤال إلزامي</label>
            {(!isChoiceType(currentField.type)||currentField.type==='dropdown')&&currentField.type!=='consent'&&<label>النص الإرشادي داخل الإجابة<input maxLength={140} value={currentField.placeholder||''} onChange={e=>updateField({placeholder:e.target.value})} placeholder="مثال: اكتب اسم السيارة"/></label>}
            <label>شرط ظهور السؤال<select value={currentField.showIf?JSON.stringify(currentField.showIf):''} onChange={e=>updateField({showIf:e.target.value?JSON.parse(e.target.value):null})}><option value="">دائمًا</option>{currentField.showIf&&!ordered.slice(0,ordered.findIndex(f=>f.id===currentField.id)).some(f=>f.id===currentField.showIf?.fieldId&&isSingleChoiceType(f.type)&&f.options.includes(currentField.showIf?.equals||''))&&<option value={JSON.stringify(currentField.showIf)}>شرط سابق غير متاح — {currentField.showIf.equals}</option>}{ordered.slice(0,ordered.findIndex(f=>f.id===currentField.id)).filter(f=>isSingleChoiceType(f.type)).flatMap(f=>f.options.filter(Boolean).map(o=><option key={`${f.id}-${o}`} value={JSON.stringify({fieldId:f.id,equals:o})}>لو «{f.label}» = {o}</option>))}</select></label>
            {isChoiceType(currentField.type)&&<><div className="mlf-choice-editor"><strong>الاختيارات الأساسية</strong>{currentField.options.map((option,i)=><div className="mlf-choice-editor-row" key={i}><input aria-label={`الاختيار ${i+1}`} value={option} maxLength={80} placeholder={`الاختيار ${i+1}`} onChange={e=>updateField({options:currentField.options.map((value,index)=>index===i?e.target.value:value)})}/><button type="button" className="danger" title={`مسح الاختيار ${i+1}`} aria-label={`مسح الاختيار ${i+1}`} onClick={()=>removeChoice(option)}><Trash size={15}/></button></div>)}</div><details><summary>إضافة أو تعديل اختيارات دفعة واحدة</summary><label>كل اختيار في سطر<textarea rows={4} value={currentField.options.join('\n')} onChange={e=>{const options=e.target.value.split('\n').slice(0,12);updateField({options});}} placeholder="كل اختيار في سطر"/></label></details><button type="button" className="secondary" disabled={currentField.options.length>=12} onClick={()=>{let i=currentField.options.length+1;while(currentField.options.includes(`اختيار ${i}`))i++;updateField({options:[...currentField.options,`اختيار ${i}`]});}}><Plus size={15}/> إضافة اختيار</button>
              <ConditionalChoicesEditor field={currentField} fields={ordered} onChange={updateField}/>
              <details><summary>صور وشعارات اختيارات هذا السؤال — كاش، تمويل، السيارات وغيرها</summary>{allChoiceOptions(currentField).map(option=><div key={option} className="mlf-designer-option-image"><div className="mlf-dv-option-heading"><strong>{option}</strong><button type="button" className="danger" title={`حذف الاختيار من السؤال: ${option}`} onClick={()=>removeChoice(option)}><Trash size={14}/> حذف الاختيار</button></div><label>نوع الصورة<select value={currentField.optionImageModes?.[option]||'photo'} onChange={e=>updateField({optionImageModes:{...currentField.optionImageModes,[option]:e.target.value as 'photo'|'logo'}})}><option value="logo">لوجو / شعار صغير بدون قص</option><option value="photo">صورة عادية</option></select></label><label>رابط الصورة<input dir="ltr" placeholder="رابط HTTPS" value={currentField.optionImages?.[option]||''} onChange={e=>updateField({optionImages:{...currentField.optionImages,[option]:e.target.value}})}/></label><label>رفع الشعار أو الصورة<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const image=await optimizeImage(file);updateField({optionImages:{...currentField.optionImages,[option]:image},optionImageModes:{...currentField.optionImageModes,[option]:'logo'}});}catch(err){window.alert(err instanceof Error?err.message:'تعذر قراءة الصورة');}e.target.value='';}}/></label></div>)}</details></>}
          </>}
          {active.kind==='spacer'&&<label>المسافة (بالبكسل)<input type="number" min={8} max={280} value={active.height||24} onChange={e=>updateBlock({height:Number(e.target.value)})}/></label>}
          {active.kind==='brand'&&<label>العنوان أسفل اسم الشركة<input value={config.style.subtitle||'طلب سيارة إلكتروني'} onChange={e=>commit({...config,style:{...config.style,subtitle:e.target.value}})}/></label>}
          {active.kind==='contact'&&<><label>عنوان خطوة التواصل<input value={savedContactTitle} onChange={e=>commit({...config,style:{...config.style,contactTitle:e.target.value}})}/></label><label>حقول التواصل<select value={config.contact?.askName===false?'phone':'name-phone'} onChange={e=>commit({...config,contact:{askName:e.target.value==='name-phone'}})}><option value="name-phone">الاسم + الجوال</option><option value="phone">الجوال فقط</option></select></label></>}
          <label>المحاذاة<select value={active.align||'right'} onChange={e=>updateBlock({align:e.target.value as DesignBlock['align']})}><option value="right">يمين</option><option value="center">وسط</option><option value="left">يسار</option></select></label>
          <label>عرض العنصر<select value={active.width||'full'} onChange={e=>updateBlock({width:e.target.value as DesignBlock['width']})}><option value="full">كامل العرض</option><option value="half">نصف العرض</option></select></label>
          <label>الحجم<select value={active.size||'md'} onChange={e=>updateBlock({size:e.target.value as DesignBlock['size']})}><option value="sm">صغير</option><option value="md">متوسط</option><option value="lg">كبير</option></select></label>
          {!REQUIRED_DESIGN_BLOCKS.includes(active.kind)&&<button type="button" className="danger" onClick={()=>removeBlock(active.id)}><Trash size={16}/> حذف العنصر</button>}
        </div>:<p className="mlf-designer-empty">اضغط على أي عنصر في مساحة التصميم لتعديل خصائصه.</p>}
        <div className="mlf-designer-global"><h3>تنسيق الفورم</h3>
          <label>الحركة بين الخطوات<select value={design.animation} onChange={e=>updateDesign({...design,animation:e.target.value as FormDesign['animation']})}><option value="slide">انزلاق</option><option value="fade">تلاشي</option><option value="zoom">تكبير سلس</option><option value="none">بدون حركة</option></select></label>
          <label>شكل اختيارات السؤال الحالي<select value={questionChoiceLayout} disabled={!currentField||!isChoiceType(currentField.type)||currentField.type==='dropdown'} onChange={e=>{if(!currentField||!isChoiceType(currentField.type)||currentField.type==='dropdown')return;updateDesign({...design,choiceLayouts:{...design.choiceLayouts,[currentField.id]:e.target.value as FormDesign['choices']}});}}><option value="list">قائمة</option><option value="cards">بطاقات مصورة</option><option value="tiles">مربعات</option><option value="pills">اختيارات دائرية</option></select><small>كل سؤال له شكل مستقل؛ تغيير هذا الاختيار لن يغير بقية الأسئلة.</small></label>
          <label>الخلفية<select value={design.surface} onChange={e=>updateDesign({...design,surface:e.target.value as FormDesign['surface']})}><option value="paper">كريمي</option><option value="soft">خلفية ناعمة</option><option value="dark">بني غامق</option><option value="borderless">بدون حدود</option></select></label>
          <label>شكل الأزرار<select value={design.buttonShape} onChange={e=>updateDesign({...design,buttonShape:e.target.value as FormDesign['buttonShape']})}><option value="rounded">مستديرة</option><option value="pill">دائرية كاملة</option><option value="square">زوايا بسيطة</option></select></label>
          <label>عرض الفورم على الويب <span>{design.maxWidth}px</span><input type="range" min={360} max={860} step={20} value={design.maxWidth} onChange={e=>updateDesign({...design,maxWidth:Number(e.target.value)})}/></label>
        </div>
      </aside>
    </div>
    {drag?.active&&<div className="mlf-designer-drag-label" aria-live="polite">{drag.source==='palette'?(drag.fieldType?fieldTypeLabel(drag.fieldType):DESIGN_BLOCK_LABELS[drag.kind!] ):'إعادة ترتيب العنصر'} <CaretDown size={13}/></div>}
  </section>;
}
