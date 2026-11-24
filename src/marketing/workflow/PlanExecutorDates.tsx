import { useMemo, useState } from 'react';
import { ArrowCounterClockwise, CalendarBlank, Trash } from '@phosphor-icons/react';
import { useWorkQuery, workPost } from './api';
import { showDate } from './api';
// API response shapes live at the UI boundary: keep server-only SQL and access
// modules out of the browser TypeScript dependency graph.
type ExecutorDateItem = { itemId: string; assigneeName: string; mediaKind: string;
  originalDueOn: string; dueOn: string | null; overridden: boolean };
type ExecutorDateIdea = { key: string; ideaName: string; ideaCode: string;
  taskNo: string; category: string; executors: ExecutorDateItem[] };

type Response = {
  ok: boolean; ready: boolean; canEdit: boolean; ideas: ExecutorDateIdea[];
};
type Edit = { itemId: string; dueOn: string | null; reset?: boolean };

/** The original task deadline is immutable here. An empty date saves a
 * plan-scoped NULL override; Reset removes the override for this executor. */
export function PlanExecutorDates({ planId, draftId, defaultOpen = false, onChanged }: {
  planId?: string; draftId?: string; defaultOpen?: boolean; onChanged?: () => void;
}) {
  const query = useWorkQuery<Response>('plan_executor_dates', planId ? { planId } : { draftId }, Boolean(planId || draftId));
  const [changes, setChanges] = useState<Record<string, Edit>>({});
  const [search, setSearch] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const data = query.data;
  const ideas = data?.ideas || [];
  const visibleIdeas = useMemo(() => {
    const searchText = search.trim().toLocaleLowerCase('ar');
    return !searchText ? ideas : ideas.filter(idea =>
      `${idea.ideaName} ${idea.ideaCode} ${idea.taskNo} ${idea.category} ${idea.executors.map(executor => executor.assigneeName).join(' ')}`
        .toLocaleLowerCase('ar').includes(searchText));
  }, [ideas, search]);
  const changed = Object.keys(changes).length;
  function currentDate(item: ExecutorDateItem): string {
    const edit = changes[item.itemId];
    return edit ? (edit.reset ? item.originalDueOn : edit.dueOn || '') : item.dueOn || '';
  }
  function setDue(item: ExecutorDateItem, dueOn: string | null) {
    setError(''); setMessage('');
    setChanges(previous => ({ ...previous, [item.itemId]: { itemId: item.itemId, dueOn } }));
  }
  function reset(item: ExecutorDateItem) {
    setError(''); setMessage('');
    setChanges(previous => {
      const next = { ...previous };
      if (!item.overridden) delete next[item.itemId];
      else next[item.itemId] = { itemId: item.itemId, dueOn: null, reset: true };
      return next;
    });
  }
  async function save() {
    if (!data?.canEdit || !data.ready || !changed || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await workPost('save_plan_executor_dates', {
        ...(planId ? { planId } : { draftId }), entries: Object.values(changes),
      });
      setChanges({}); await query.reload(); onChanged?.();
      setMessage('تم حفظ مواعيد المنفذين داخل الأجندة أو الحملة بنجاح.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر حفظ مواعيد التسليم.'); }
    finally { setBusy(false); }
  }
  return <details className="mkw-plan-executor-dates" open={defaultOpen}>
    <summary><span className="mkw-plan-executor-summary"><strong>تواريخ تسليم المنفذين حسب الفكرة</strong>
      <small>افتح الفكرة لتعديل أو مسح تاريخ تسليم كل منفذ، دون تغيير التاسك الأصلي أو تاريخ النشر.</small></span>
      <span className="mkw-plan-executor-count">{ideas.length} فكرة</span></summary>
    <div className="mkw-plan-executor-body">
      {!!(query.error || error) && <p className="mkw-plan-executor-error" role="alert">{query.error || error}</p>}
      {!!message && <p className="mkw-plan-executor-success" role="status">{message}</p>}
      {!data?.ready && <p className="mkw-plan-executor-migration">{query.loading ? 'جاري تحميل المنفذين...' : 'يلزم تحديث قاعدة بيانات التسويق من لوحة الإدارة أولًا لتفعيل حفظ التواريخ.'}</p>}
      <label className="mkw-plan-executor-search">بحث باسم الفكرة أو المنفذ
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث في أفكار الحملة أو الأجندة"/>
      </label>
      <div className="mkw-plan-executor-list">
        {visibleIdeas.map(idea => <details className="mkw-plan-executor-idea" key={idea.key}>
          <summary><strong>{idea.ideaName}</strong><small>{idea.taskNo}{idea.ideaCode ? ` · ${idea.ideaCode}` : ''}</small>
            <span>{idea.executors.length} منفذ</span></summary>
          <div className="mkw-plan-executor-people">
            {idea.executors.map(person => <div className="mkw-plan-executor-person" key={person.itemId}>
              <div className="mkw-plan-executor-name"><strong>{person.assigneeName}</strong>
                <small>{person.mediaKind === 'video' ? 'فيديو' : person.mediaKind === 'image' ? 'صورة' : 'تنفيذ'} · التاريخ الأصلي: <b dir="ltr">{showDate(person.originalDueOn)}</b></small></div>
              <label>تاريخ التسليم في {planId ? 'الأجندة / الحملة' : 'المسودة'}
                <input type="date" value={currentDate(person)} disabled={!data?.canEdit || !data?.ready || busy}
                  onChange={event => setDue(person, event.target.value || null)} aria-label={`تاريخ تسليم ${person.assigneeName} لفكرة ${idea.ideaName}`}/>
              </label>
              {data?.canEdit && <div className="mkw-plan-executor-buttons">
                <button type="button" className="secondary" disabled={!data.ready || busy || !currentDate(person)} onClick={() => setDue(person, null)} title="مسح التاريخ من هذه الأجندة أو الحملة فقط"><Trash size={16}/>مسح</button>
                <button type="button" className="secondary" disabled={!data.ready || busy || (!person.overridden && !changes[person.itemId])} onClick={() => reset(person)} title="العودة لتاريخ التكليف الأصلي"><ArrowCounterClockwise size={16}/>استعادة</button>
              </div>}
            </div>)}
          </div>
        </details>)}
        {!visibleIdeas.length && <p className="mkw-muted">{query.loading ? 'جاري تحميل الأفكار...' : 'لا توجد أفكار مطابقة للبحث.'}</p>}
      </div>
      {data?.canEdit && <div className="mkw-plan-executor-footer"><span>{changed} تاريخ بانتظار الحفظ</span>
        <button type="button" className="primary" disabled={!data.ready || busy || changed === 0} onClick={() => void save()}>
          <CalendarBlank size={17}/> {busy ? 'جاري حفظ التعديلات...' : 'حفظ تواريخ المنفذين'}
        </button></div>}
    </div>
  </details>;
}
