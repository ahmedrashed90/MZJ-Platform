import { CaretLeft, CaretRight } from "@phosphor-icons/react";

function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function MonthCalendar({ month, onMonthChange, events, renderEvent }: { month: Date; onMonthChange: (date: Date) => void; events: any[]; renderEvent: (event: any) => React.ReactNode }) {
  const year = month.getFullYear(), monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1); const startOffset = (first.getDay() + 1) % 7;
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<Date | null> = [...Array(startOffset).fill(null), ...Array.from({ length: days }, (_, index) => new Date(year, monthIndex, index + 1))];
  while (cells.length % 7) cells.push(null);
  return <div className="marketing-calendar"><header><button type="button" onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))}><CaretRight size={18} />السابق</button><h2>{month.toLocaleDateString("ar-SA", { month: "long", year: "numeric" })}</h2><div><button type="button" onClick={() => onMonthChange(new Date())}>اليوم</button><button type="button" onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))}>التالي<CaretLeft size={18} /></button></div></header><div className="marketing-calendar-weekdays">{["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"].map((day) => <strong key={day}>{day}</strong>)}</div><div className="marketing-calendar-grid">{cells.map((date, index) => { const key = date ? dateKey(date) : `empty-${index}`; const dayEvents = date ? events.filter((event) => String(event.date || event.publish_date || event.received_at || "").slice(0, 10) === key) : []; const today = date && dateKey(date) === dateKey(new Date()); return <div className={`marketing-calendar-day ${today ? "today" : ""} ${date ? "" : "empty"}`} key={key}>{date ? <><span>{date.getDate()}</span><div>{dayEvents.map((event) => renderEvent(event))}</div></> : null}</div>; })}</div></div>;
}
