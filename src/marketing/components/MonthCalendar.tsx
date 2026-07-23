import { useMemo } from "react";
import { CalendarBlank } from "@phosphor-icons/react";
import { MarketingEmpty } from "./Ui";

export type CalendarEntry = { id: string; date: string; title: string; subtitle?: string; status?: string; detail?: string; platform?: string; department?: string; raw: unknown };
const weekdays = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function isoDate(date: Date) { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0"); const day = String(date.getDate()).padStart(2, "0"); return `${year}-${month}-${day}`; }

export function MonthCalendar({ month, entries, onEntry }: { month: string; entries: CalendarEntry[]; onEntry: (entry: CalendarEntry) => void }) {
  const days = useMemo(() => {
    const [year, monthNo] = month.split("-").map(Number);
    if (!year || !monthNo) return [];
    const first = new Date(year, monthNo - 1, 1);
    const gridStart = new Date(year, monthNo - 1, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => { const date = new Date(gridStart); date.setDate(gridStart.getDate() + index); const key = isoDate(date); return { key, date, outside: date.getMonth() !== monthNo - 1, today: key === isoDate(new Date()), rows: entries.filter((entry) => String(entry.date).slice(0, 10) === key) }; });
  }, [month, entries]);
  if (!days.length) return <MarketingEmpty title="الشهر غير صحيح" icon={<CalendarBlank size={40} />} />;
  return <div className="marketing-calendar-board">{weekdays.map((day) => <div className="marketing-calendar-weekday" key={day}>{day}</div>)}{days.map((day) => <div className={`marketing-calendar-day ${day.outside ? "outside" : ""} ${day.today ? "today" : ""}`} key={day.key}><div className="date"><span>{day.date.getDate().toLocaleString("ar-SA")}</span><small>{day.rows.length || ""}</small></div>{day.rows.slice(0, 6).map((entry) => <button type="button" className="marketing-calendar-event" key={entry.id} onClick={() => onEntry(entry)}><b>{entry.title}</b><span>{entry.subtitle || entry.detail || ""}</span></button>)}{day.rows.length > 6 ? <small>+ {day.rows.length - 6} عناصر أخرى</small> : null}</div>)}</div>;
}
