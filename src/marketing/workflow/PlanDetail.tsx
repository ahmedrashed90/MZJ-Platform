import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { W, Empty, WorkAlert } from './components';
import { parseReviewNote } from '../../../shared/marketing-review-note-format';
import { showDate, useWorkQuery, workPost, type WorkMeta } from './api';
import { availablePlanPostTypes } from './planComposer';
import type { WorkPlanLine, WorkProduct } from '../../../shared/marketing-workflow';

type PlanState = 'in_progress' | 'revision' | 'submitted' | 'publishing' | 'published';
type Plan = { id: string; plan_no: string; name: string; kind: 'agenda' | 'campaign'; created_by: string;
  review_status: PlanState; review_note: string; review_note_category_id?: string | null; review_revision: number; status: PlanState;
  readiness: number; canReview: boolean; canEdit: boolean; canSaveLinks: boolean; activated_at?: string | null };
type PlanData = { plan: Plan; lines: WorkPlanLine[]; history: Array<{ action: string; note: string; actor_name: string; created_at: string; category_name: string }> };
type EditableLine = { id: string; date: string; productId: string; postTypeId: string; budget: string };
const statusNames: Record<PlanState,string> = {
  in_progress:'قيد التنفيذ', revision:'مطلوب تعديل', submitted:'قيد المراجعة', publishing:'جاري النشر', published:'تم النشر',
};
export function planStatusName(status: string) { return statusNames[status as PlanState] || status; }
function LinkEditor({ line, save, disabled }: { line: WorkPlanLine; save: (lineId:string,url:string)=>Promise<void>; disabled:boolean }) {
  const [url, setUrl] = useState(line.manual_post_url || line.effective_post_url || '');
  useEffect(() => setUrl(line.manual_post_url || line.effective_post_url || ''), [line.id, line.manual_post_url, line.effective_post_url]);
  return <div className="mkw-post-url-field"><input aria-label={`رابط نشر ${line.idea_name} — ${line.platform_name}`} type="url" placeholder="https://... رابط البوست" value={url} disabled={disabled} onChange={event=>setUrl(event.target.value)} />
    <button className="secondary" type="button" disabled={disabled || url === (line.manual_post_url || '')} onClick={()=>void save(line.id,url)}>حفظ الرابط</button>
    {!!line.effective_post_url && <a href={line.effective_post_url} target="_blank" rel="noopener noreferrer">فتح المنشور</a>}
  </div>;
}
export function PlanDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: () => void }) {
  const query = useWorkQuery<PlanData>('plan', { id });
  const plan = query.data?.plan;
  const settings = useWorkQuery<{ categories: Array<{ id: string; name: string; is_active: boolean }> }>('evaluation_settings', {}, !!plan?.canReview);
  const productsQuery = useWorkQuery<{ rows: WorkProduct[] }>('products', {}, !!plan?.canEdit);
  const metaQuery = useWorkQuery<WorkMeta>('meta', {}, !!plan?.canEdit);
  const [editing, setEditing] = useState(false), [rows, setRows] = useState<EditableLine[]>([]);
  const [note, setNote] = useState(''), [noteType, setNoteType] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => {
    if (query.data && !editing) setRows(query.data.lines.map(line => ({ id:line.id,date:String(line.scheduled_on).slice(0,10),productId:line.product_id,
      postTypeId:line.post_type_id || '',budget:String(line.budget_amount || 0) })));
  }, [query.data, editing]);
  async function run(action: string, payload: Record<string,unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError(''); setMessage('');
    try { await workPost(action, payload); await query.reload(); onChanged?.(); setMessage('تم الحفظ بنجاح'); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : W.invalid); return false; }
    finally { setBusy(false); }
  }
  async function saveLink(lineId: string, url: string) { await run('save_plan_post_url', { lineId, url }); }
  async function review(decision: 'revision' | 'submitted' | 'approved') {
    if (decision === 'revision' && !note.trim()) { setError('اكتب ملاحظة التعديل أولًا'); return; }
    const ok = await run('plan_review', { planId:id, decision, note:decision === 'revision' ? note.trim() : '', categoryId:decision === 'revision' ? noteType || undefined : undefined });
    if (ok) { setNote(''); setNoteType(''); }
  }
  const products = productsQuery.data?.rows || [], meta = metaQuery.data;
  function changeRow(index: number, patch: Partial<EditableLine>) { setRows(old => old.map((row,i)=>i === index ? {...row,...patch} : row)); }
  function addRow() { setRows(old=>[...old,{id:'',date:'',productId:'',postTypeId:'',budget:'0'}]); }
  return <Modal open title={plan?.name || W.view} onClose={onClose} className="mkw-modal"><div className="mkw mkw-plan-review">
    <WorkAlert>{query.error || error}</WorkAlert><WorkAlert success>{message}</WorkAlert>
    {!query.data ? <Empty>{query.loading ? W.loading : W.noData}</Empty> : <>
      <div className="mkw-section-title"><strong>{plan!.plan_no} · {plan!.kind === 'agenda' ? 'أجندة' : 'حملة'}</strong><span className="mkw-plan-state">{planStatusName(plan!.status)}</span></div>
      <div className="mkw-plan-progress"><span>جاهزية النشر: {plan!.readiness}% · {query.data.lines.filter(line=>line.published_ready).length} من {query.data.lines.length} روابط نشر</span><progress max={100} value={plan!.readiness}/></div>
      {plan!.review_status === 'revision' && <section className="mkw-plan-review-note"><strong>مطلوب تعديل</strong><p>{plan!.review_note}</p></section>}
      {plan!.canReview && ['in_progress','submitted'].includes(plan!.review_status) && <section className="mkw-plan-review-actions"><label>نوع الملاحظة<select value={noteType} onChange={e=>setNoteType(e.target.value)}><option value="">اختر نوع الملاحظة (اختياري)</option>{(settings.data?.categories || []).filter(category=>category.is_active).map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>ملاحظة التعديل<div className="mkw-actions"><button type="button" className="secondary" onClick={()=>setNote(old=>`${old}**نص مهم**`)}>غامق</button><button type="button" className="secondary" onClick={()=>setNote(old=>`${old}\n• نقطة تعديل`)}>نقطة</button></div><textarea value={note} maxLength={10000} onChange={e=>setNote(e.target.value)} placeholder="اكتب المطلوب تعديله في المنتجات أو الجدول"/></label><div className="mkw-actions">
        <button type="button" className="secondary" disabled={busy || !note.trim()} onClick={()=>void review('revision')}>طلب تعديل</button>
        <button type="button" className="primary" disabled={busy} onClick={()=>void review('approved')}>اعتماد — جاري النشر</button>
      </div></section>}
      {plan!.created_by && plan!.canEdit && <div className="mkw-actions">
        <button type="button" className="secondary" disabled={busy} onClick={()=>setEditing(current=>!current)}>{editing ? 'إلغاء تعديل المنتجات' : 'تعديل المنتجات والجدول'}</button>
        <button type="button" className="primary" disabled={busy || editing} onClick={()=>void review('submitted')}>إرسال للمراجعة</button>
      </div>}
      {editing && plan!.canEdit ? <section className="mkw-plan-edit-lines"><div className="mkw-table-wrap"><table><thead><tr><th>التاريخ</th><th>المنتج</th><th>المنصة ونوع النشر</th>{plan!.kind==='campaign' && <th>الميزانية</th>}<th>حذف</th></tr></thead><tbody>
        {rows.map((row,index)=>{ const product=products.find(item=>item.id===row.productId);const types=meta?.postTypes.filter(type=>product && availablePlanPostTypes(meta.postTypes,product.media_kind,type.platform_id).some(format=>format.id===type.id)) || [];
          return <tr key={row.id || `new-${index}`}><td><input type="date" value={row.date} onChange={e=>changeRow(index,{date:e.target.value})}/></td>
          <td><select value={row.productId} onChange={e=>changeRow(index,{productId:e.target.value,postTypeId:''})}><option value="">اختر المنتج</option>{products.map(item=><option key={item.id} value={item.id}>{item.task_no} — {item.idea_name}</option>)}</select></td>
          <td><select value={row.postTypeId} onChange={e=>changeRow(index,{postTypeId:e.target.value})}><option value="">اختر نوع النشر</option>{types.map(type=><option key={type.id} value={type.id}>{meta?.platforms.find(p=>p.id===type.platform_id)?.name} — {type.name}</option>)}</select></td>
          {plan!.kind==='campaign' && <td><input type="number" min="0" step="0.01" value={row.budget} onChange={e=>changeRow(index,{budget:e.target.value})}/></td>}
          <td><button type="button" className="secondary" disabled={rows.length===1} onClick={()=>setRows(old=>old.filter((_,i)=>i!==index))}>حذف</button></td></tr>;
        })}</tbody></table></div><div className="mkw-actions"><button type="button" className="secondary" disabled={rows.length>=500} onClick={addRow}>إضافة منتج</button><button type="button" className="primary" disabled={busy || !rows.length || rows.some(row=>!row.date || !row.productId || !row.postTypeId)} onClick={()=>void run('update_plan',{planId:id,entries:rows.map(row=>({...row,budget:Number(row.budget)}))}).then(ok=>{if(ok)setEditing(false);})}>حفظ التعديلات</button></div></section> : null}
      <div className="mkw-table-wrap"><table><thead><tr><th>{plan!.kind==='agenda' ? W.publishDate : W.fundingDate}</th><th>المنتج</th><th>المنصة</th><th>نوع النشر</th><th>الحالة</th><th>رابط المنشور</th></tr></thead><tbody>{query.data.lines.map(line=><tr key={line.id}>
        <td>{showDate(line.scheduled_on)}</td><td>{line.idea_name}<small className="mkw-muted">{line.task_no}</small></td><td>{line.platform_name || '—'}</td><td>{line.post_type_name || '—'}</td><td>{line.published_ready ? 'تم النشر' : planStatusName(plan!.status)}</td>
        <td>{plan!.canSaveLinks ? <LinkEditor line={line} save={saveLink} disabled={busy}/> : line.effective_post_url ? <a href={line.effective_post_url} target="_blank" rel="noopener noreferrer">فتح المنشور</a> : 'بانتظار الاعتماد والنشر'}</td>
      </tr>)}</tbody></table></div>
      {!!query.data.history.length && <details className="mkw-plan-history"><summary>سجل المراجعات والملاحظات ({query.data.history.length})</summary>{query.data.history.map((entry,index)=><article key={index}><strong>{planStatusName(entry.action === 'approved' ? 'publishing' : entry.action === 'revision' ? 'revision' : 'submitted')} — {entry.actor_name}</strong><small>{showDate(entry.created_at,true)}</small>{entry.category_name && <small>نوع الملاحظة: {entry.category_name}</small>}{entry.note && <div className="mkw-review-document">{parseReviewNote(entry.note).map((block,i)=><p key={i}>{block.text}</p>)}</div>}</article>)}</details>}
    </>}
  </div></Modal>;
}
