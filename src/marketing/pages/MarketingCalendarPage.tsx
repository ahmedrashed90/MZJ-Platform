import { useEffect, useMemo, useState } from "react";
import { CalendarDots, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { marketingFetch, marketingQuery } from "../api";
import type { GenericRowsResponse } from "../types";
import { TaskDetailModal } from "../components/TaskDetailModal";

const text = (row: Record<string, unknown>, key: string) => String(row[key] ?? "");
function monthDays(month: string) { const [year, value] = month.split("-").map(Number); const first = new Date(year, value - 1, 1); const count = new Date(year, value, 0).getDate(); const start = (first.getDay() + 6) % 7; return { count, start, year, month: value }; }
function moveMonth(month: string, amount: number) { const [year, value] = month.split("-").map(Number); const date = new Date(year, value - 1 + amount, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }

export function MarketingCalendarPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = async () => { setError(""); try { const payload = await marketingFetch<GenericRowsResponse>(`/api/marketing${marketingQuery({ action: "calendar", month })}`); setRows(payload.rows); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "تعذر تحميل التقويم"); } };
  useEffect(() => { void load(); }, [month]);
  const calendar = useMemo(() => monthDays(month), [month]);
  const cells = Array.from({ length: calendar.start + calendar.count }, (_, index) => index < calendar.start ? null : index - calendar.start + 1);
  return <div className="marketing-page"><header className="marketing-page-title"><div><h2>التقويم</h2><p>عرض التاسكات حسب تاريخ الاستلام الفعلي المسجل عند الضغط على تم الاستلام.</p></div><div className="calendar-controls"><button onClick={() => setMonth(moveMonth(month, -1))}><CaretRight /></button><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /><button onClick={() => setMonth(moveMonth(month, 1))}><CaretLeft /></button></div></header>{error ? <div className="marketing-error">{error}</div> : null}<section className="marketing-calendar panel"><div className="calendar-weekdays">{["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-month-grid">{cells.map((day, index) => { if (!day) return <div key={`blank-${index}`} className="blank" />; const date = `${month}-${String(day).padStart(2, "0")}`; const tasks = rows.filter((row) => text(row, "received_at").slice(0, 10) === date); const today = new Date().toISOString().slice(0, 10) === date; return <article key={date} className={today ? "today" : ""}><header><strong>{day}</strong>{today ? <span>اليوم</span> : null}</header><div>{tasks.map((task) => <button key={text(task, "id")} onClick={() => setSelected(text(task, "id"))}><small>{text(task, "source_kind") === "agenda" ? "أجندة" : "حملة"}</small><b>{text(task, "assigned_name")}</b><span>{text(task, "instance_code")} - {text(task, "creative_name")}</span><em>{new Date(text(task, "received_at")).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}</em></button>)}</div></article>; })}</div></section><TaskDetailModal taskId={selected} onClose={() => setSelected(null)} onChanged={() => void load()} /></div>;
}
