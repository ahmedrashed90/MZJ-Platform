import { useEffect, useState } from "react";
import { marketingFetch, marketingQuery } from "../api";
import { MonthCalendar } from "../components/MonthCalendar";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";

export function ReceiptCalendarPage() {
  const [month, setMonth] = useState(new Date()); const [rows, setRows] = useState<any[]>([]); const [error, setError] = useState("");
  useEffect(() => { marketingFetch<{ rows: any[] }>(`/api/marketing${marketingQuery({ resource: "receipt_calendar" })}`).then((payload) => setRows(payload.rows.map((item) => ({ ...item, date: item.received_at })))) .catch((failure) => setError(failure instanceof Error ? failure.message : "تعذر تحميل تقويم الاستلام")); }, []);
  return <MarketingPage title="تقويم الاستلام" description="تاريخ ووقت ضغط اليوزر على تم الاستلام لكل تاسك.">{error ? <MarketingAlert>{error}</MarketingAlert> : null}<MonthCalendar month={month} onMonthChange={setMonth} events={rows} renderEvent={(event) => <article key={event.id} className="marketing-calendar-event receipt" style={{ borderInlineStartColor: event.user_color || undefined }}><strong>{event.source_name}</strong><span>{event.creative_name || "—"}</span><small>{event.full_name || "—"} · {event.department_name || "قسم المحتوى"}</small><time>{new Date(event.received_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}</time></article>} /></MarketingPage>;
}
