import { useState } from 'react';
import { FloppyDisk, Plus, PencilSimple, Trash, WarningCircle } from '@phosphor-icons/react';
import { useWorkQuery, workPost } from '../workflow/api';
import type { CampaignGoalOption } from '../../../shared/marketing-campaign-goals';

/** The sole settings manager for campaign goal options; no duplicate catalog. */
export function CampaignGoalSettings({ readOnly }: { readOnly: boolean }) {
  const query = useWorkQuery<{ goals: CampaignGoalOption[]; migrationRequired: boolean }>('campaign_goal_settings');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  function clear() { setId(''); setName(''); setSortOrder(0); }
  async function save() {
    if (busy) return;
    if (!name.trim()) { setError('اكتب اسم الهدف أولًا.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await workPost<{ message: string }>('save_campaign_goal',{ id: id || undefined, name:name.trim(), sortOrder });
      clear(); setMessage(result.message); await query.reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر حفظ الهدف'); }
    finally { setBusy(false); }
  }
  async function remove(goal: CampaignGoalOption) {
    if (busy || !window.confirm(`حذف «${goal.name}» من الأهداف المتاحة للحملات الجديدة؟ ستبقى محفوظة في الحملات السابقة.`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await workPost<{ message:string }>('delete_campaign_goal',{id:goal.id});
      if (id===goal.id) clear(); setMessage(result.message); await query.reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر حذف الهدف'); }
    finally { setBusy(false); }
  }
  return <section className="panel marketing-settings-panel mkw-campaign-goals-settings">
    <header className="mkw-campaign-settings-heading"><div><h3>الهدف من الحملة</h3><p>أضف أهداف الحملات وعدّلها أو احذفها. عند إنشاء حملة تقدر تختار أكثر من هدف لكل منصة، والأهداف المحفوظة في الحملات السابقة لا تتغير لو عدّلت القائمة.</p></div><strong>{query.data?.goals.length || 0} هدف</strong></header>
    {query.error || error ? <div className="connection-banner"><WarningCircle size={17}/>{query.error || error}</div> : null}
    {message && <div className="success-banner">{message}</div>}
    {query.data?.migrationRequired ? <div className="connection-banner">يحتاج جدول أهداف الحملات إلى تحديث قاعدة بيانات التسويق من الداش بورد بواسطة مدير النظام.</div> : null}
    <div className="mkw-campaign-goal-settings-form">
      <label>اسم الهدف<input type="text" maxLength={120} disabled={readOnly || busy || query.data?.migrationRequired} value={name} onChange={event=>setName(event.target.value)} placeholder="مثال: طلبات التمويل، الوعي بالعلامة التجارية"/></label>
      <label>الترتيب<input type="number" min={0} max={100000} disabled={readOnly || busy || query.data?.migrationRequired} value={sortOrder} onChange={event=>setSortOrder(Number(event.target.value)||0)}/></label>
      <button type="button" className="primary" disabled={readOnly || busy || query.data?.migrationRequired || !name.trim()} onClick={()=>void save()}>{id ? <FloppyDisk size={17}/> : <Plus size={17}/>} {id ? 'حفظ التعديل' : 'إضافة الهدف'}</button>
      {id && <button type="button" className="secondary" disabled={busy} onClick={clear}>إلغاء</button>}
    </div>
    <div className="mkw-campaign-goal-settings-list">{query.data?.goals.map(goal=><article key={goal.id}>
      <div><strong>{goal.name}</strong><small>الترتيب: {goal.sort_order}</small></div>
      <div className="mkw-campaign-goal-actions"><button type="button" className="secondary" disabled={readOnly || busy} onClick={()=>{setId(goal.id);setName(goal.name);setSortOrder(goal.sort_order);}}><PencilSimple size={16}/>تعديل</button>
      <button type="button" className="secondary" disabled={readOnly || busy} onClick={()=>void remove(goal)}><Trash size={16}/>حذف</button></div>
    </article>)}
      {query.data && !query.data.goals.length && !query.data.migrationRequired && <p className="mkw-muted">لا توجد أهداف حاليًا. أضف أول هدف من الحقل أعلاه.</p>}
    </div>
  </section>;
}
