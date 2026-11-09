import { useEffect, useMemo, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function eventDateKey(event: any) { return String(event.date || event.publish_date || event.received_at || "").slice(0, 10); }

export function MonthCalendar({ month, onMonthChange, events, renderEvent }: { month: Date; onMonthChange: (date: Date) => void; events: any[]; renderEvent: (event: any) => React.ReactNode }) {
  const year = month.getFullYear(), monthIndex = month.getMonth();
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const first = new Date(year, monthIndex, 1); const startOffset = (first.getDay() + 1) % 7;
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<Date | null> = [...Array(startOffset).fill(null), ...Array.from({ length: days }, (_, index) => new Date(year, monthIndex, index + 1))];
  while (cells.length % 7) cells.push(null);

  useEffect(() => {
    const selected = new Date(`${selectedDate}T12:00:00`);
    if (selected.getFullYear() !== year || selected.getMonth() !== monthIndex) {
      setSelectedDate(dateKey(new Date(year, monthIndex, 1)));
    }
  }, [year, monthIndex, selectedDate]);

  const selectedEvents = useMemo(() => events.filter((event) => eventDateKey(event) === selectedDate), [events, selectedDate]);
  const selectedLabel = new Date(`${selectedDate}T12:00:00`).toLocaleDateString("ar-SA-u-nu-latn", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return <div className="marketing-calendar"><header><button type="button" onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))}><CaretRight size={18} />السابق</button><h2>{month.toLocaleDateString("ar-SA-u-nu-latn", { month: "long", year: "numeric" })}</h2><div><button type="button" onClick={() => { const today = new Date(); onMonthChange(today); setSelectedDate(dateKey(today)); }}>اليوم</button><button type="button" onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))}>التالي<CaretLeft size={18} /></button></div></header><div className="marketing-calendar-weekdays">{["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"].map((day) => <strong key={day}>{day}</strong>)}</div><div className="marketing-calendar-grid">{cells.map((date, index) => { const key = date ? dateKey(date) : `empty-${index}`; const dayEvents = date ? events.filter((event) => eventDateKey(event) === key) : []; const today = date && key === dateKey(new Date()); const selected = date && key === selectedDate; return <div className={`marketing-calendar-day ${today ? "today" : ""} ${selected ? "selected" : ""} ${date ? "" : "empty"}`} key={key} role={date ? "button" : undefined} tabIndex={date ? 0 : undefined} onClick={() => date && setSelectedDate(key)} onKeyDown={(event) => { if (date && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelectedDate(key); } }}>{date ? <><span>{date.getDate()}</span><div>{dayEvents.map((event) => renderEvent(event))}</div></> : null}</div>; })}</div><section className="marketing-calendar-selected"><header><div><span>التاريخ المحدد</span><strong>{selectedLabel}</strong></div><b>{selectedEvents.length} تاسك</b></header>{selectedEvents.length ? <div className="marketing-calendar-selected-list">{selectedEvents.map((event) => renderEvent(event))}</div> : <p>لا توجد تاسكات في التاريخ المحدد.</p>}</section></div>;
}
