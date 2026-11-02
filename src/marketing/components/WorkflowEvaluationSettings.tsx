import { useState } from 'react';
import { FloppyDisk, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useWorkQuery, workPost } from '../workflow/api';
import type { WorkEvaluationSetting, WorkEvaluationSettings } from '../../../shared/marketing-workflow';
import '../marketing.css';

function SettingList({ kind, title, rows, readOnly, reload }: {
  kind: 'category' | 'criterion'; title: string; rows: WorkEvaluationSetting[];
  readOnly: boolean; reload: () => Promise<unknown>;
}) {
  const [form, setForm] = useState({ id: '', name: '', sortOrder: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!form.name.trim() || busy) return;
    setBusy(true);setError('');
    try {
      await workPost('save_evaluation_setting', { kind, ...form });
      setForm({ id: '', name: '', sortOrder: 0 });
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر الحفظ'); }
    finally { setBusy(false); }
  }
  async function remove(row: WorkEvaluationSetting) {
    if (!window.confirm(`حذف ${row.name} من الاختيارات؟`) || busy) return;
    setBusy(true);setError('');
    try { await workPost('save_evaluation_setting', { kind, id: row.id, remove: true }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر الحذف'); }
    finally { setBusy(false); }
  }
  return <section className="panel mkw-evaluation-settings-card">
    <header><h3>{title}</h3></header>
    {error && <div className="mkw-alert" role="alert">{error}</div>}
    <div className="mkw-evaluation-settings-inputs">
      <label><span>اسم البند</span><input value={form.name} disabled={readOnly || busy} maxLength={160} onChange={event => setForm({ ...form, name: event.target.value })}/></label>
      <label><span>الترتيب</span><input type="number" value={form.sortOrder} disabled={readOnly || busy} onChange={event => setForm({ ...form, sortOrder: Number(event.target.value) || 0 })}/></label>
      <button type="button" className="primary-button" disabled={readOnly || busy || !form.name.trim()} onClick={() => void save()}>{form.id ? <FloppyDisk size={17}/> : <Plus size={17}/>} {form.id ? 'حفظ التعديل' : 'إضافة'}</button>
      {form.id && <button type="button" className="secondary-button" onClick={() => setForm({ id: '', name: '', sortOrder: 0 })}>إلغاء</button>}
    </div>
    <div className="mkw-evaluation-settings-list">
      {rows.map(row => <article key={row.id}><strong>{row.name}</strong><div className="mkw-actions"><button type="button" className="secondary-button small" disabled={readOnly || busy} onClick={() => setForm({ id: row.id, name: row.name, sortOrder: row.sort_order })}><PencilSimple size={16}/> تعديل</button><button type="button" className="secondary-button small" disabled={readOnly || busy} onClick={() => void remove(row)}><Trash size={16}/> حذف</button></div></article>)}
    </div>
  </section>;
}

export function WorkflowEvaluationSettings({ readOnly = false }: { readOnly?: boolean }) {
  const query = useWorkQuery<WorkEvaluationSettings>('evaluation_settings');
  const onReload = async () => { await query.reload(); };
  return <div className="mkw-evaluation-settings-grid">
    {query.error && <div className="mkw-alert" role="alert">{query.error}</div>}
    <PlanReviewersSettings readOnly={readOnly}/>
    <RatingReviewersSettings data={query.data} readOnly={readOnly || !query.data?.canManage} reload={onReload}/>
    <SettingList title="أنواع ملاحظات المراجعة" kind="category" rows={query.data?.categories || []} readOnly={readOnly || !query.data?.canManage} reload={onReload}/>
    <SettingList title="بنود تقييم المنفذين" kind="criterion" rows={query.data?.criteria || []} readOnly={readOnly || !query.data?.canManage} reload={onReload}/>
  </div>;
}

/** Only the two selected Marketing users may grade; UI is a convenient
 * configuration surface, not the permission boundary (the API enforces it). */
function RatingReviewersSettings({data,readOnly,reload}:{data:WorkEvaluationSettings|null;readOnly:boolean;reload:()=>Promise<unknown>}) {
  const [slots,setSlots] = useState<[string,string]>(['','']);
  const [dirty,setDirty] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('');
  const current:[string,string] = [data?.reviewers.find(r=>r.slot===1)?.user_id||'',data?.reviewers.find(r=>r.slot===2)?.user_id||''];
  const selected = dirty ? slots : current;
  async function save(){
    if (busy || !selected[0] || !selected[1] || selected[0]===selected[1]) {
      setError('اختار مستخدمين مختلفين من نظام التسويق'); return;
    }
    setBusy(true);setError('');setMessage('');
    try {await workPost('save_evaluation_setting',{kind:'raters',userIds:selected});await reload();setDirty(false);setMessage('تم تحديد المقيّمين الاثنين وحفظ الصلاحيات');}
    catch(e){setError(e instanceof Error?e.message:'تعذر حفظ المقيّمين');}
    finally{setBusy(false);}
  }
  return <section className="panel mkw-evaluation-settings-card">
    <header><h3>صلاحية تقييم المنفذين — مستخدمان فقط</h3></header>
    <p className="mkw-muted">يستطيع المستخدمان المختاران فقط حفظ تقييمات المنفذين أو تعديلها، حتى لو كان المستخدم الآخر أدمنًا. إدارة هذه القائمة من إعدادات التسويق.</p>
    {error && <div className="mkw-alert" role="alert">{error}</div>}
    {message && <p role="status">{message}</p>}
    <div className="mkw-evaluation-settings-inputs">
      {([0,1] as const).map(slot=><label key={slot}><span>المقيّم {slot+1}</span>
        <select value={selected[slot]} disabled={readOnly||busy} onChange={e=>{const updated:[string,string]=[selected[0],selected[1]];updated[slot]=e.target.value;setSlots(updated);setDirty(true);setMessage('');}}>
          <option value="">اختر المستخدم</option>
          {(data?.reviewerOptions || []).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>)}
      <button type="button" className="primary-button" disabled={readOnly||busy||!selected[0]||!selected[1]||selected[0]===selected[1]}
        onClick={()=>void save()}><FloppyDisk size={17}/> حفظ المقيّمين</button>
    </div>
    {data?.reviewers.length!==2 && <small className="mkw-muted">التقييم متوقف حتى يتم اختيار وحفظ اثنين من المستخدمين النشطين.</small>}
  </section>;
}


type PlanReviewersConfig = { ok:boolean; canManage:boolean; migrationRequired:boolean;
  reviewers:Array<{slot:number;user_id:string;name:string;email:string}>;
  options:Array<{id:string;name:string;email:string}> };
function PlanReviewersSettings({ readOnly }: { readOnly: boolean }) {
  const query = useWorkQuery<PlanReviewersConfig>('plan_reviewers');
  const [slots,setSlots] = useState<[string,string]>(['','']);
  const [dirty,setDirty] = useState(false),[busy,setBusy] = useState(false);
  const [error,setError] = useState(''),[message,setMessage] = useState('');
  const saved:[string,string] = [query.data?.reviewers.find(r=>r.slot===1)?.user_id||'',query.data?.reviewers.find(r=>r.slot===2)?.user_id||''];
  const chosen=dirty?slots:saved;
  async function save(){
    if (busy||!chosen[0]||!chosen[1]||chosen[0]===chosen[1]) {
      setError('\u0627\u062e\u062a\u0627\u0631 \u0645\u0633\u062a\u062e\u062f\u0645\u064a\u0646 \u0645\u062e\u062a\u0644\u0641\u064a\u0646 \u0645\u0646 \u0646\u0638\u0627\u0645 \u0627\u0644\u062a\u0633\u0648\u064a\u0642');return;
    }
    setBusy(true);setError('');setMessage('');
    try {
      await workPost('save_plan_reviewers',{userIds:chosen});
      await query.reload();setDirty(false);
      setMessage('\u062a\u0645 \u062d\u0641\u0638 \u0645\u0633\u0624\u0648\u0644\u064a \u0645\u0631\u0627\u062c\u0639\u0629 \u0627\u0644\u062d\u0645\u0644\u0627\u062a \u0648\u0627\u0644\u0623\u062c\u0646\u062f\u0627\u062a');
    }catch(e){setError(e instanceof Error?e.message:'\u062a\u0639\u0630\u0631 \u0627\u0644\u062d\u0641\u0638');}
    finally{setBusy(false);}
  }
  return <section className="panel mkw-evaluation-settings-card" aria-label="plan-reviewers-settings">
    <header><h3>{'\u0645\u0631\u0627\u062c\u0639\u0629 \u0648\u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u062d\u0645\u0644\u0627\u062a \u0648\u0627\u0644\u0623\u062c\u0646\u062f\u0627\u062a \u2014 \u0645\u0633\u062a\u062e\u062f\u0645\u0627\u0646 \u0641\u0642\u0637'}</h3></header>
    <p className="mkw-muted">{'\u064a\u062a\u0648\u0644\u0649 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645\u0627\u0646 \u0627\u0644\u0645\u062d\u062f\u062f\u0627\u0646 \u0645\u0631\u0627\u062c\u0639\u0629 \u0648\u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u062d\u0645\u0644\u0627\u062a \u0648\u0627\u0644\u0623\u062c\u0646\u062f\u0627\u062a \u0641\u0642\u0637. \u0645\u0646\u0634\u0626 \u0627\u0644\u062d\u0645\u0644\u0629 \u0623\u0648 \u0627\u0644\u0623\u062c\u0646\u062f\u0629 \u0647\u0648 \u0627\u0644\u0645\u0633\u0624\u0648\u0644 \u0639\u0646 \u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0648\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u062a\u0648\u0627\u0631\u064a\u062e \u0648\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0625\u0631\u0633\u0627\u0644.'}</p>
    {query.error&&<p className="mkw-alert" role="alert">{query.error}</p>}
    {error&&<p className="mkw-alert" role="alert">{error}</p>}
    {message&&<p role="status">{message}</p>}
    {query.data?.migrationRequired && <p className="mkw-alert" role="alert">{'\u0625\u0639\u062f\u0627\u062f \u0627\u0644\u0645\u0631\u0627\u062c\u0639\u064a\u0646 \u063a\u064a\u0631 \u0645\u062a\u0627\u062d \u0642\u0628\u0644 \u062a\u062d\u062f\u064a\u062b \u0642\u0627\u0639\u062f\u0629 \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u062a\u0633\u0648\u064a\u0642.'}</p>}
    <div className="mkw-evaluation-settings-inputs">
      {([0,1] as const).map(slot=><label key={slot}><span>{'\u0627\u0644\u0645\u0631\u0627\u062c\u0639'} {slot+1}</span>
        <select value={chosen[slot]} disabled={readOnly||busy||!query.data?.canManage||query.data?.migrationRequired} onChange={e=>{
          const next:[string,string]=[chosen[0],chosen[1]];next[slot]=e.target.value;setSlots(next);setDirty(true);setMessage('');
        }}><option value="">{'\u0627\u062e\u062a\u0631 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645'}</option>
          {(query.data?.options||[]).map(u=><option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}</select>
      </label>)}
      <button type="button" className="primary-button" disabled={readOnly||busy||!query.data?.canManage||query.data?.migrationRequired||!chosen[0]||!chosen[1]||chosen[0]===chosen[1]||!dirty}
        onClick={()=>void save()}><FloppyDisk size={17}/>{'\u062d\u0641\u0638 \u0645\u0633\u0624\u0648\u0644\u064a \u0627\u0644\u0645\u0631\u0627\u062c\u0639\u0629'}</button>
    </div>
  </section>;
}
