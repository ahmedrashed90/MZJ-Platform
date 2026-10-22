import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { W, Empty, MediaLabel, Status, WorkAlert, WorkHeader } from '../workflow/components';
import { localDay, showDate, useWorkQuery } from '../workflow/api';
import { TaskDetail } from '../workflow/TaskDetail';

type Delivery = { id: string; task_id: string; task_no: string; task_name: string; due_on: string; media_kind: 'image' | 'video'; idea_name: string; status: string; assignee_name?: string };
export function ReceiptCalendarPage() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(localDay()), [opened, setOpened] = useState<{ id: string; items: string[] } | null>(null);
  const from = localDay(month), to = localDay(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const query = useWorkQuery<{ rows: Delivery[] }>('calendar', { from, to });
  const rows = query.data?.rows || [], selected = rows.filter(row => row.due_on === selectedDay);
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
    <section className="mkw-panel"><header className="mkw-section-title"><h2>{W.required} - {showDate(selectedDay)}</h2><span className="mkw-status">{selected.length}</span></header>{!selected.length && <Empty>{query.loading ? W.loading : W.noData}</Empty>}{selected.map(item => <article className="mkw-task-card" key={item.id}><div className="mkw-section-title"><span className="mkw-code">{item.task_no}</span><Status value={item.status} /></div><h3>{item.task_name}</h3><strong>{item.idea_name}</strong>{item.assignee_name && <small className="mkw-muted">المنفذ: {item.assignee_name}</small>}<div className="mkw-section-title"><MediaLabel kind={item.media_kind} /><button type="button" className="secondary" onClick={() => setOpened({ id: item.task_id, items: selected.filter(row => row.task_id === item.task_id).map(row => row.id) })}>{W.open}</button></div></article>)}</section>
  </div>{opened && <TaskDetail id={opened.id} onlyItems={opened.items} onClose={() => setOpened(null)} onChanged={() => void query.reload()} />}</div>;
}
