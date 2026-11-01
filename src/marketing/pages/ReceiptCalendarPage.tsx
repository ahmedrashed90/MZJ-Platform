import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { W, Empty, MediaLabel, Readiness, Status, WorkAlert, WorkHeader } from '../workflow/components';
import { localDay, showDate, useWorkQuery } from '../workflow/api';
import { TaskDetail } from '../workflow/TaskDetail';

type Delivery = { id: string; task_id: string; task_no: string; task_name: string; due_on: string; media_kind: 'image' | 'video'; idea_name: string; status: string; assignee_name?: string; item_readiness: number };
type RatingEntry = { id: string; idea_name: string; assignee_name: string; status: string; rated: boolean };
type TaskRatingSummary = { total: number; rated: number; missing: number; items: RatingEntry[] };
export function ReceiptCalendarPage() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(localDay()), [opened, setOpened] = useState<{ id: string; items: string[] } | null>(null);
  const from = localDay(month), to = localDay(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const query = useWorkQuery<{ rows: Delivery[]; ratingSummaries: Record<string, TaskRatingSummary> }>('calendar', { from, to });
  const rows = query.data?.rows || [], selected = rows.filter(row => row.due_on === selectedDay);
  const ratingSummaries = query.data?.ratingSummaries || {};
  const selectedGroups = selected.reduce<Array<{ taskId: string; items: Delivery[] }>>((groups, row) => {
    const group = groups.find(entry => entry.taskId === row.task_id);
    if (group) group.items.push(row);
    else groups.push({ taskId: row.task_id, items: [row] });
    return groups;
  }, []);

  const days = useMemo(() => {
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array.from({ length: month.getDay() }, () => null), ...Array.from({ length: count }, (_, index) => localDay(new Date(month.getFullYear(), month.getMonth(), index + 1)))];
  }, [month]);
  const weekdays = Array.from({ length: 7 }, (_, day) => new Date(2026, 9, 4 + day).toLocaleDateString('ar-SA', { weekday: 'short' }));
  function moveMonth(delta: number) { const next = new Date(month.getFullYear(), month.getMonth() + delta, 1); setMonth(next); setSelectedDay(localDay(next)); }
  function today() { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectedDay(localDay(now)); }
  return <div className="mkw"><WorkHeader title={W.calendar} onRefresh={() => void query.reload()} loading={query.loading} /><WorkAlert>{query.error}</WorkAlert><div className="mkw-calendar-layout">
    <section className="mkw-panel"><header className="mkw-section-title"><h2>{month.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' })}</h2><div className="mkw-actions"><button type="button" className="icon-button" aria-label={W.previous} onClick={() => moveMonth(-1)}><CaretRight size={18} /></button><button type="button" className="secondary" onClick={today}>{W.today}</button><button type="button" className="icon-button" aria-label={W.next} onClick={() => moveMonth(1)}><CaretLeft size={18} /></button></div></header>
      <div className="mkw-calendar-grid">{weekdays.map((name, index) => <div className="mkw-calendar-weekday" key={index}>{name}</div>)}{days.map((day, index) => day ? <button type="button" key={day} className={`mkw-calendar-day ${day === selectedDay ? 'selected' : ''} ${day === localDay() ? 'today' : ''}`} onClick={() => setSelectedDay(day)} aria-label={showDate(day)} aria-pressed={day === selectedDay}><strong>{Number(day.slice(-2))}</strong>{rows.some(row => row.due_on === day) && <small>{rows.filter(row => row.due_on === day).length}</small>}</button> : <span key={`blank-${index}`} />)}</div>
    </section>
    <section className="mkw-panel"><header className="mkw-section-title"><h2>{W.required} - {showDate(selectedDay)}</h2><span className="mkw-status">{selected.length}</span></header>
      {!selected.length && <Empty>{query.loading ? W.loading : W.noData}</Empty>}
      {selectedGroups.map(group => {
        const first = group.items[0], rating = ratingSummaries[group.taskId];
        return <section className="mkw-calendar-task-group" key={group.taskId}>
          {rating && <div className="mkw-calendar-rating-summary">
            <div className="mkw-calendar-rating-counts"><strong>تقييمات التاسك · {first.task_no}</strong>
              <span>تم تقييم <b>{rating.rated}</b> من <b>{rating.total}</b> مطلوب</span>
              <span className={rating.missing ? 'mkw-rating-pending-count' : 'mkw-rating-completed-count'}>المتبقي: {rating.missing}</span>
            </div>
            <details open><summary>المطلوبات المُقيّمة والتي لم تُقيّم</summary>
              <div className="mkw-calendar-rating-list">{rating.items.map(entry =>
                <div className="mkw-calendar-rating-entry" key={entry.id}>
                  <span><strong>{entry.idea_name || 'مطلوب بدون اسم'}</strong><small>المنفذ: {entry.assignee_name || '—'}</small></span>
                  <span className={`mkw-calendar-rating-status ${entry.rated ? 'is-rated' : 'is-missing'}`}>
                    {entry.rated ? 'تم التقييم' : ['approved','rejected'].includes(entry.status) ? 'بانتظار التقييم' : 'لم يُقيّم بعد'}
                  </span>
                </div>
              )}</div>
            </details>
          </div>}
          {group.items.map(item => <article className="mkw-task-card" key={item.id}>
            <div className="mkw-section-title"><span className="mkw-code">{item.task_no}</span><Status value={item.status} /></div>
            <h3>{item.task_name}</h3><strong>{item.idea_name}</strong>
            {item.assignee_name && <small className="mkw-muted">المنفذ: {item.assignee_name}</small>}
            {rating && <span className={`mkw-calendar-item-rated ${rating.items.find(entry => entry.id === item.id)?.rated ? 'is-rated' : ''}`}>
              {rating.items.find(entry => entry.id === item.id)?.rated ? 'تم تقييم هذا المطلوب' : 'لم يتم تقييم هذا المطلوب'}
            </span>}
            <Readiness value={item.item_readiness} />
            <div className="mkw-section-title"><MediaLabel kind={item.media_kind} />
              <button type="button" className="secondary" onClick={() => setOpened({ id: item.task_id, items: group.items.map(row => row.id) })}>{W.open}</button>
            </div>
          </article>)}
        </section>;
      })}
    </section>
  </div>{opened && <TaskDetail id={opened.id} onlyItems={opened.items} onClose={() => setOpened(null)} onChanged={() => void query.reload()} />}</div>;
}
