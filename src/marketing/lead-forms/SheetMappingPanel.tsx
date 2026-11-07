import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, FloppyDisk, ShieldCheck, WarningCircle } from '@phosphor-icons/react';
import { AVAILABLE_SHEET_COLUMNS, type LeadForm, type SheetColumnMapping } from '../../../shared/lead-forms';
import { mapSavedColumns } from '../../../shared/lead-forms-sheet-mapping';
import { formsApi } from './api';

type SheetTab = { title: string; hidden: boolean };
type Props = {
  forms: LeadForm[];
  serviceEmail: string;
  configured: boolean;
  saving: boolean;
  perform: (action: string, payload: Record<string, unknown>, message?: string) => Promise<{ok:true;id?:string;message?:string}|null>;
};
const idFromUrl = (value: string) => value.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] || value.trim();

export function SheetMappingPanel({forms,serviceEmail,configured,saving,perform}:Props) {
  const [formId,setFormId]=useState('');
  const [sheetUrl,setSheetUrl]=useState('');
  const [sheetTab,setSheetTab]=useState('');
  const [tabs,setTabs]=useState<SheetTab[]>([]);
  const [headers,setHeaders]=useState<string[]>([]);
  const [mapping,setMapping]=useState<SheetColumnMapping[]>([]);
  const [busy,setBusy]=useState<'tabs'|'headers'|''>('');
  const [localError,setLocalError]=useState('');
  const requestNumber=useRef(0);
  const form=forms.find(f=>f.id===formId);
  const fields=form?.config?.fields||[];
  const sources=[...AVAILABLE_SHEET_COLUMNS,...fields.map(f=>({code:`answers.${f.id}`,label:`إجابة: ${f.label}`}))];
  const resetDiscovery=()=>{requestNumber.current++;setTabs([]);setHeaders([]);setMapping([]);setBusy('');setLocalError('');};
  const chooseForm=(id:string)=>{
    resetDiscovery();setFormId(id);
    const selected=forms.find(f=>f.id===id);
    setSheetUrl(selected?.sheet_id||'');setSheetTab(selected?.sheet_tab||'');
  };
  useEffect(()=>{
    if (forms.length && (!formId || !forms.some(f=>f.id===formId))) chooseForm(forms[0].id);
  },[forms,formId]);
  const fetchHeaders=async(tab:string, sheet:string, selected:LeadForm|undefined)=>{
    const ticket=++requestNumber.current;
    setSheetTab(tab);setHeaders([]);setMapping([]);setLocalError('');setBusy('headers');
    try {
      const response=await formsApi<{ok:true;headers:string[]}>('sheet_headers',{sheetId:sheet,sheetTab:tab});
      if (ticket!==requestNumber.current) return;
      const sameSheet=selected?.sheet_id===idFromUrl(sheet) && selected?.sheet_tab===tab;
      setHeaders(response.headers);
      setMapping(mapSavedColumns(response.headers,sameSheet?(selected?.sheet_columns||[]):[],selected?.config.fields||[]));
    } catch(e) {
      if (ticket===requestNumber.current) setLocalError(e instanceof Error?e.message:'تعذر قراءة أعمدة الورقة');
    } finally {if (ticket===requestNumber.current)setBusy('');}
  };
  const fetchTabs=async()=>{
    if (!formId || !sheetUrl.trim() || !configured) return;
    const ticket=++requestNumber.current;
    setLocalError('');setHeaders([]);setMapping([]);setBusy('tabs');
    try {
      const response=await formsApi<{ok:true;tabs:SheetTab[]}>('sheet_tabs',{sheetId:sheetUrl});
      if (ticket!==requestNumber.current)return;
      if (!response.tabs.length) {setLocalError('ملف Google Sheets لا يحتوي على أوراق عمل قابلة للقراءة');setTabs([]);return;}
      setTabs(response.tabs);
      const chosen=response.tabs.some(t=>t.title===sheetTab)?sheetTab:(response.tabs.find(t=>!t.hidden)?.title||response.tabs[0].title);
      await fetchHeaders(chosen,sheetUrl,form);
    } catch(e) {
      if (ticket===requestNumber.current)setLocalError(e instanceof Error?e.message:'تعذر جلب أوراق العمل');
    } finally {if (ticket===requestNumber.current)setBusy('');}
  };
  const update=(index:number,changes:Partial<SheetColumnMapping>)=>setMapping(rows=>rows.map((row,i)=>i===index?{...row,...changes}:row));
  const ready=Boolean(configured && formId && headers.length && mapping.length===headers.length && mapping.some(c=>c.source==='phone') && busy==='' && !saving);
  const save=async()=>{
    if (!ready)return;
    const done=await perform('sheets',{id:formId,sheetId:sheetUrl,sheetTab,columns:mapping},'تم حفظ ربط الأعمدة بنفس ترتيب الشيت');
    if (done) setLocalError('');
  };
  const retry=async()=>{if (!formId)return;await perform('retry_sheet',{id:formId},'تمت محاولة إعادة إرسال ليد معلق');};
  const unlink=async()=>{
    if (!form?.sheet_id || !window.confirm('فصل Google Sheets عن هذا الفورم؟ لن يتم حذف أي بيانات من الشيت.')) return;
    const result=await perform('sheets',{id:formId,sheetId:'',sheetTab:form.sheet_tab||'Sheet1',columns:[]},'تم فصل الشيت عن هذا الفورم بدون تغيير بيانات الشيت');
    if (result) {resetDiscovery();setSheetUrl('');setSheetTab('');}
  };
  return <>
    <section className="marketing-card mlf-sheet-settings">
      <h2>إعدادات Google Sheets</h2>
      <p>اربط كل فورم بورقة العمل الموجودة عندك، مهما اختلف ترتيب أعمدتها. لا نغير عناوين الشيت أو بياناته القديمة أو الووركر أو CRM.</p>
      <div className={`marketing-alert ${configured?'success':'info'}`}><ShieldCheck size={18}/>{configured?`خدمة Google Sheets مُهيأة على السيرفر (${serviceEmail})`:'خدمة Google Sheets غير مُهيأة على السيرفر. يمكن حفظ الليدات بدون شيت.'}</div>
      <div className="mlf-form-grid">
        <label className="wide">اختر الفورم
          <select value={formId} onChange={e=>chooseForm(e.target.value)}><option value="">اختر فورمًا</option>{forms.map(f=><option value={f.id} key={f.id}>{f.title}</option>)}</select>
        </label>
        <label className="wide">رابط ملف Google Sheets الحالي
          <input value={sheetUrl} dir="ltr" placeholder="https://docs.google.com/spreadsheets/d/..." onChange={e=>{resetDiscovery();setSheetUrl(e.target.value);}}/>
        </label>
        <div className="mlf-sheet-read">
          <button type="button" className="secondary" disabled={!formId||!sheetUrl.trim()||!configured||busy!==''} onClick={()=>void fetchTabs()}><ArrowClockwise size={17}/>{busy==='tabs'?'جاري قراءة الملف...':'جلب أوراق العمل من الشيت'}</button>
          <span>الملف ممكن يحتوي على Meta وSnap وTikTok وOpenSouq وغيرها؛ اختر الورقة التي تخص الفورم.</span>
        </div>
        {tabs.length>0&&<label className="wide">اختر ورقة العمل من الملف
          <select value={sheetTab} disabled={busy!==''} onChange={e=>void fetchHeaders(e.target.value,sheetUrl,form)}>
            {tabs.map(tab=><option value={tab.title} key={tab.title}>{tab.title}{tab.hidden?' (مخفية)':''}</option>)}
          </select>
        </label>}
      </div>
      {localError&&<div className="marketing-alert error" role="alert"><WarningCircle size={18}/>{localError}</div>}
      {busy==='headers'&&<p className="mlf-hint">جاري قراءة الصف الأول وأسماء الأعمدة من «{sheetTab}»...</p>}
      {headers.length>0&&<>
        <div className="mlf-sheet-headline"><div><h3>ربط أعمدة «{sheetTab}» بحقول الفورم</h3><p>قراءة مباشرة من الصف الأول — {headers.length} عمودًا. الاختيارات المقترحة قابلة للتعديل.</p></div><span>لن يتغير ترتيب أعمدة الشيت</span></div>
        <div className="mlf-sheet-mapping">
          {mapping.map((col,i)=><div key={`${i}:${headers[i]}`} className="mlf-sheet-mapping-row">
            <div className="mlf-sheet-header"><span className="mlf-sheet-letter">{i+1}</span><strong>{headers[i]||'عمود بلا عنوان'}</strong><small>العمود رقم {i+1} في الورقة</small></div>
            <label>البيانات التي تُكتب في هذا العمود
              <select value={col.source} onChange={e=>update(i,{source:e.target.value,value:e.target.value==='fixed'?col.value||'':''})}>
                <option value="">اترك العمود فارغًا</option>
                {sources.map(option=><option key={option.code} value={option.code}>{option.label}</option>)}
                <option value="fixed">قيمة ثابتة أختارها بنفسي</option>
              </select>
            </label>
            {col.source==='fixed'&&<label>النص الثابت<input value={col.value||''} maxLength={160} onChange={e=>update(i,{value:e.target.value})} placeholder="مثال: تم الحفظ"/></label>}
          </div>)}
        </div>
        <p className="mlf-hint">أي عمود تختار له «اترك العمود فارغًا» هيتسجل فاضي في نفس مكانه، بدون تحريك باقي الأعمدة. لازم تربط رقم الجوال عشان الليد يوصل بالشكل المطلوب.</p>
        {!mapping.some(c=>c.source==='phone')&&<div className="marketing-alert info"><WarningCircle size={18}/>لم يتم ربط أي عمود برقم الجوال بعد.</div>}
      </>}
      <div className="mlf-card-actions mlf-sheet-actions">
        <button type="button" className="primary" disabled={!ready} onClick={()=>void save()}><FloppyDisk size={18}/>{saving?'جاري الحفظ...':'حفظ ربط الشيت'}</button>
        <button type="button" className="secondary" disabled={!form?.sheet_id||!configured||saving||busy!==''} onClick={()=>void retry()}><ArrowClockwise size={17}/> إعادة محاولة إرسال ليد معلق</button>
        {form?.sheet_id&&<button type="button" className="secondary" disabled={saving||busy!==''} onClick={()=>void unlink()}>فصل الشيت عن الفورم</button>}
      </div>
      {!headers.length&&<p className="mlf-hint">بعد إدخال رابط الشيت اضغط «جلب أوراق العمل»، واختر التبويب المطلوب؛ أسماء الأعمدة هتظهر تلقائيًا.</p>}
    </section>
    <section className="marketing-card"><h3>تفعيل إرسال Google Sheets</h3><p>شارك ملف Google Sheets مع حساب الخدمة الظاهر أعلاه بصلاحية محرر. مفتاح الحساب موجود على Vercel داخل متغير <code>MZJ_GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON</code>، ولا ينبغي وضعه في السورس أو داخل الفورم.</p></section>
  </>;
}
