import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowLeft, ArrowRight, CaretDown, Check, DeviceMobile, DotsSixVertical, ImageSquare, Monitor, Plus, Trash } from '@phosphor-icons/react';
import type { FormConfig, FormField, FormTemplate } from '../../../shared/lead-forms';
import { DESIGN_BLOCK_LABELS, REQUIRED_DESIGN_BLOCKS, createTemplateDesign, resolveFormDesign, type DesignBlock, type DesignBlockKind, type FormDesign } from '../../../shared/lead-form-design';
import './lead-forms.css';

type DragDescriptor={source:'palette'|'canvas';kind?:DesignBlockKind;blockId?:string;x:number;y:number;over:number;active:boolean;pointerId:number};
const palette:DesignBlockKind[]=['text','image','badge','divider','spacer','brand','cover','heading','progress','question','contact','actions','trust','success'];
const idFor=()=>`el_${Math.random().toString(36).slice(2,11)}`;
const getDefault=(kind:DesignBlockKind):DesignBlock=>({id:idFor(),kind,width:'full',align:kind==='badge'?'center':'right',size:'md',height:24,
  ...(kind==='text'?{text:'اكتب النص هنا'}:{}),...(kind==='badge'?{text:'عرض مميز'}:{}),...(kind==='image'?{text:'صورة السيارة'}:{})});
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
  const screenId=screen&&(screen==='contact'||screen==='success'||config.fields.some(f=>f.id===screen))?screen:(config.fields[0]?.id||'contact');
  const blocks=design.screens[screenId]||[];
  const active=blocks.find(b=>b.id===selected)||null;
  const currentField=config.fields.find(f=>f.id===screenId);
  const colors={'--lf-brown':config.style.brown,'--lf-cream':config.style.cream} as CSSProperties;
  function commit(next:FormConfig){history.current.undo.push(clone(config));if(history.current.undo.length>50)history.current.undo.shift();history.current.redo=[];onChange(next);}
  function updateDesign(next:FormDesign){commit({...config,design:next});}
  function withBlocks(next:DesignBlock[]){updateDesign({...design,screens:{...design.screens,[screenId]:next}});}
  function updateBlock(patch:Partial<DesignBlock>){if(!active)return;withBlocks(blocks.map(b=>b.id===active.id?{...b,...patch}:b));}
  function add(kind:DesignBlockKind,index=blocks.length){if(!allows(kind,screenId,blocks))return;const item=getDefault(kind);withBlocks([...blocks.slice(0,index),item,...blocks.slice(index)]);setSelected(item.id);}
  function move(blockId:string,index:number){const original=blocks.findIndex(b=>b.id===blockId);if(original<0)return;const newBlocks=[...blocks];const [item]=newBlocks.splice(original,1);const target=original<index?index-1:index;newBlocks.splice(Math.min(Math.max(target,0),newBlocks.length),0,item);if(newBlocks.every((b,i)=>b.id===blocks[i]?.id))return;withBlocks(newBlocks);setSelected(blockId);}
  function remove(){if(!active||REQUIRED_DESIGN_BLOCKS.includes(active.kind))return;withBlocks(blocks.filter(b=>b.id!==active.id));setSelected('');}
  function updateField(patch:Partial<FormField>){if(!currentField)return;commit(fieldWith(config,currentField.id,patch));}
  function addQuestion(){
    if(config.fields.length>=14)return;
    const id=`q_${Math.random().toString(36).slice(2,11)}`;
    const nextField:FormField={id,label:'سؤال جديد',type:'choice',required:true,options:['الاختيار الأول','الاختيار الثاني']};
    const nextDesign={...design,screens:{...design.screens,[id]:createTemplateDesign(template,[nextField]).screens[id]}};
    commit({...config,fields:[...config.fields,nextField],design:nextDesign});setScreen(id);setSelected('');
  }
  function reorderStep(direction:number){
    const i=config.fields.findIndex(f=>f.id===screenId),j=i+direction;
    if(i<0||j<0||j>=config.fields.length)return;
    const fields=[...config.fields];[fields[i],fields[j]]=[fields[j],fields[i]];
    commit({...config,fields});
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
  function pointerDown(e:PointerEvent<HTMLButtonElement>,descriptor:Pick<DragDescriptor,'source'|'kind'|'blockId'>){
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
    if(d.source==='palette'&&d.kind){if(d.active){const el=document.elementFromPoint(e.clientX,e.clientY) as HTMLElement|null;const index=dropIndexAt(el,e.clientY,-1);if(index>=0)add(d.kind,index);}else add(d.kind);}
    if(d.source==='canvas'&&d.blockId&&d.active){const el=document.elementFromPoint(e.clientX,e.clientY) as HTMLElement|null;const index=dropIndexAt(el,e.clientY,-1);if(index>=0)move(d.blockId,index);}
  }
  function previewBlock(b:DesignBlock):ReactNode{
    switch(b.kind){
      case 'brand':return <div className="mlf-dv-brand">{config.style.logoUrl&&<img src={config.style.logoUrl} alt=""/>}<span>محمد ذعار العجمي للسيارات</span></div>;
      case 'cover':return config.style.coverUrl?<img className="mlf-dv-cover" src={config.style.coverUrl} alt="صورة الغلاف"/>:<div className="mlf-dv-placeholder"><ImageSquare size={26}/> صورة الغلاف</div>;
      case 'heading':return <div className="mlf-dv-heading"><small>{screenId==='contact'?'بيانات التواصل':screenId==='success'?'نجاح التسجيل':`السؤال ${config.fields.findIndex(f=>f.id===screenId)+1}`}</small><h3>{b.text||currentField?.label||(screenId==='contact'?'اكتب بيانات التواصل':'تم التسجيل')}</h3>{currentField?.description&&<p>{currentField.description}</p>}</div>;
      case 'progress':return <div className="mlf-dv-progress"><span style={{width:`${Math.max(16,100*(config.fields.findIndex(f=>f.id===screenId)+1)/Math.max(config.fields.length+1,1))}%`}}/></div>;
      case 'question':return currentField?.type==='choice'?<div className={`mlf-dv-options mlf-dv-options-${design.choices}`}>{currentField.options.map((option,i)=><div key={`${option}-${i}`}>{currentField.optionImages?.[option]?<img src={currentField.optionImages[option]} alt=""/>:<span>{String(i+1).padStart(2,'0')}</span>}{option}</div>)}</div>:<div className="mlf-dv-input">{currentField?.label} — اكتب الإجابة</div>;
      case 'contact':return <div className="mlf-dv-contact"><div>الاسم الكامل</div><div>رقم الجوال</div><small>☐ أوافق على سياسة الخصوصية</small></div>;
      case 'actions':return <div className="mlf-dv-actions"><span>السابق</span><strong>{screenId==='contact'?config.style.actionLabel:'التالي'}</strong></div>;
      case 'trust':return <small className="mlf-dv-trust">بياناتك محفوظة وتستخدم للتواصل بخصوص طلبك</small>;
      case 'success':return <div className="mlf-dv-success"><Check size={38}/><strong>{config.style.successTitle}</strong><p>{config.style.successMessage}</p></div>;
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
    <div className="mlf-designer-screenbar"><label>الشاشة التي تصممها<select value={screenId} onChange={e=>{setScreen(e.target.value);setSelected('');}}>{config.fields.map((f,i)=><option key={f.id} value={f.id}>السؤال {i+1} — {f.label}</option>)}<option value="contact">بيانات التواصل</option><option value="success">نجاح التسجيل</option></select></label><div className="mlf-designer-step-actions"><button type="button" className="secondary" disabled={!currentField||config.fields.indexOf(currentField)===0} onClick={()=>reorderStep(-1)} title="تقديم السؤال"><ArrowUp size={16}/></button><button type="button" className="secondary" disabled={!currentField||config.fields.indexOf(currentField)===config.fields.length-1} onClick={()=>reorderStep(1)} title="تأخير السؤال"><ArrowDown size={16}/></button><button type="button" className="primary" disabled={config.fields.length>=14} onClick={addQuestion}><Plus size={16}/> إضافة سؤال</button></div><span>{blocks.length} عناصر</span></div>
    <div className="mlf-designer-layout">
      <aside className="mlf-designer-toolbox"><h3>العناصر</h3><div className="mlf-designer-tools">{palette.map(kind=><button type="button" key={kind} className="mlf-tool" disabled={!allows(kind,screenId,blocks)} title="اسحب للمساحة أو اضغط للإضافة" style={{touchAction:'none'}}
        onPointerDown={e=>pointerDown(e,{source:'palette',kind})} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={()=>{currentDrag.current=null;setDrag(null);}}>
        <Plus size={15}/><span>{DESIGN_BLOCK_LABELS[kind]}</span><DotsSixVertical size={14}/></button>)}</div></aside>
      <div className="mlf-designer-workspace"><div className={`mlf-designer-surface mlf-designer-surface-${viewport}`} style={colors}>
        <div className={`mlf-designer-form mlf-dv-surface-${design.surface}`}>
          {blocks.map((b,index)=><div key={b.id} className={`mlf-designer-slot-group ${b.width==='half'?'half':''}`}>
            <div data-mlf-drop-index={index} data-mlf-screen={screenId} className={`mlf-designer-drop ${drag?.active&&drag.over===index?'target':''}`}/>
            <div data-mlf-block-index={index} data-mlf-screen={screenId} className={`mlf-designer-block ${selected===b.id?'selected':''} mlf-dv-width-${b.width||'full'} mlf-dv-size-${b.size||'md'}`} onClick={()=>setSelected(b.id)}>
              <div className="mlf-designer-block-toolbar"><button type="button" className="mlf-designer-handle" title="اسحب لترتيب العنصر" aria-label={`سحب ${DESIGN_BLOCK_LABELS[b.kind]}`} style={{touchAction:'none'}}
                onPointerDown={e=>pointerDown(e,{source:'canvas',blockId:b.id})} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={()=>{currentDrag.current=null;setDrag(null);}}><DotsSixVertical size={17}/></button>
                <span>{DESIGN_BLOCK_LABELS[b.kind]}</span><button type="button" title="تحريك لأعلى" disabled={index===0} onClick={e=>{e.stopPropagation();move(b.id,index-1);}}><ArrowUp size={14}/></button><button type="button" title="تحريك لأسفل" disabled={index===blocks.length-1} onClick={e=>{e.stopPropagation();move(b.id,index+2);}}><ArrowDown size={14}/></button>
              </div>
              <div className={`mlf-designer-block-preview mlf-align-${b.align||'right'}`}>{previewBlock(b)}</div>
            </div>
          </div>)}
          <div data-mlf-drop-index={blocks.length} data-mlf-screen={screenId} className={`mlf-designer-drop end ${drag?.active&&drag.over===blocks.length?'target':''}`}>اسحب عنصرًا هنا</div>
        </div>
      </div></div>
      <aside className="mlf-designer-inspector"><h3>خصائص التصميم</h3>
        {active?<div className="mlf-inspector-fields"><strong>{DESIGN_BLOCK_LABELS[active.kind]}</strong>
          {['text','badge','heading'].includes(active.kind)&&<label>المحتوى<textarea rows={3} value={active.text||''} onChange={e=>updateBlock({text:e.target.value})} placeholder={active.kind==='heading'?'اتركه فارغًا لاستخدام سؤال الفورم':'اكتب النص'}/></label>}
          {(active.kind==='image'||active.kind==='cover')&&<><label>رابط الصورة (HTTPS)<input dir="ltr" value={active.kind==='cover'?config.style.coverUrl:active.imageUrl||''} onChange={e=>active.kind==='cover'?commit({...config,style:{...config.style,coverUrl:e.target.value}}):updateBlock({imageUrl:e.target.value})} placeholder="https://..."/></label><label>أو ارفع صورة من جهازك<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const url=await optimizeImage(file);if(active.kind==='cover')commit({...config,style:{...config.style,coverUrl:url}});else updateBlock({imageUrl:url});}catch(err){window.alert(err instanceof Error?err.message:'تعذر قراءة الصورة');}e.target.value='';}}/></label></>}
          {active.kind==='brand'&&<><label>رابط الشعار<input dir="ltr" value={config.style.logoUrl} onChange={e=>commit({...config,style:{...config.style,logoUrl:e.target.value}})}/></label><label>أو ارفع الشعار<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const logoUrl=await optimizeImage(file);commit({...config,style:{...config.style,logoUrl}});}catch(err){window.alert(err instanceof Error?err.message:'تعذر قراءة الشعار');}e.target.value='';}}/></label></>}
          {active.kind==='question'&&currentField&&<>
            <label>نص السؤال<input value={currentField.label} onChange={e=>updateField({label:e.target.value})}/></label>
            <label>وصف السؤال<input value={currentField.description||''} onChange={e=>updateField({description:e.target.value})}/></label>
            {currentField.type==='choice'&&<><label>الاختيارات<textarea rows={4} value={currentField.options.join('\n')} onChange={e=>{const options=e.target.value.split('\n').slice(0,12);updateField({options});}}/></label><details><summary>صور الاختيارات</summary>{currentField.options.filter(Boolean).map(option=><div key={option} className="mlf-designer-option-image"><label>{option}<input dir="ltr" placeholder="رابط صورة HTTPS" value={currentField.optionImages?.[option]||''} onChange={e=>updateField({optionImages:{...currentField.optionImages,[option]:e.target.value}})}/></label><label>رفع صورة للاختيار<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const image=await optimizeImage(file);updateField({optionImages:{...currentField.optionImages,[option]:image}});}catch(err){window.alert(err instanceof Error?err.message:'تعذر قراءة الصورة');}e.target.value='';}}/></label></div>)}</details></>}
          </>}
          {active.kind==='spacer'&&<label>المسافة (بالبكسل)<input type="number" min={8} max={280} value={active.height||24} onChange={e=>updateBlock({height:Number(e.target.value)})}/></label>}
          <label>المحاذاة<select value={active.align||'right'} onChange={e=>updateBlock({align:e.target.value as DesignBlock['align']})}><option value="right">يمين</option><option value="center">وسط</option><option value="left">يسار</option></select></label>
          <label>عرض العنصر<select value={active.width||'full'} onChange={e=>updateBlock({width:e.target.value as DesignBlock['width']})}><option value="full">كامل العرض</option><option value="half">نصف العرض</option></select></label>
          <label>الحجم<select value={active.size||'md'} onChange={e=>updateBlock({size:e.target.value as DesignBlock['size']})}><option value="sm">صغير</option><option value="md">متوسط</option><option value="lg">كبير</option></select></label>
          {!REQUIRED_DESIGN_BLOCKS.includes(active.kind)&&<button type="button" className="danger" onClick={remove}><Trash size={16}/> حذف العنصر</button>}
        </div>:<p className="mlf-designer-empty">اضغط على أي عنصر في مساحة التصميم لتعديل خصائصه.</p>}
        <div className="mlf-designer-global"><h3>تنسيق الفورم</h3>
          <label>الحركة بين الخطوات<select value={design.animation} onChange={e=>updateDesign({...design,animation:e.target.value as FormDesign['animation']})}><option value="slide">انزلاق</option><option value="fade">تلاشي</option><option value="zoom">تكبير سلس</option><option value="none">بدون حركة</option></select></label>
          <label>شكل الاختيارات<select value={design.choices} onChange={e=>updateDesign({...design,choices:e.target.value as FormDesign['choices']})}><option value="list">قائمة</option><option value="cards">بطاقات مصورة</option><option value="tiles">مربعات</option><option value="pills">اختيارات دائرية</option></select></label>
          <label>الخلفية<select value={design.surface} onChange={e=>updateDesign({...design,surface:e.target.value as FormDesign['surface']})}><option value="paper">كريمي</option><option value="soft">خلفية ناعمة</option><option value="dark">بني غامق</option><option value="borderless">بدون حدود</option></select></label>
          <label>شكل الأزرار<select value={design.buttonShape} onChange={e=>updateDesign({...design,buttonShape:e.target.value as FormDesign['buttonShape']})}><option value="rounded">مستديرة</option><option value="pill">دائرية كاملة</option><option value="square">زوايا بسيطة</option></select></label>
          <label>عرض الفورم على الويب <span>{design.maxWidth}px</span><input type="range" min={360} max={860} step={20} value={design.maxWidth} onChange={e=>updateDesign({...design,maxWidth:Number(e.target.value)})}/></label>
        </div>
      </aside>
    </div>
    {drag?.active&&<div className="mlf-designer-drag-label" aria-live="polite">{drag.source==='palette'?DESIGN_BLOCK_LABELS[drag.kind!]:'إعادة ترتيب العنصر'} <CaretDown size={13}/></div>}
  </section>;
}
