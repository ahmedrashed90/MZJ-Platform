import { useEffect, useState } from "react";
import { marketingFetch, marketingQuery } from "../api";
import { MonthCalendar } from "../components/MonthCalendar";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";

export function ReceiptCalendarPage() {
  const [month, setMonth] = useState(new Date());
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    marketingFetch<{ rows: any[] }>(`/api/marketing${marketingQuery({ resource: "receipt_calendar" })}`)
      .then((payload) => setRows(payload.rows.map((item) => ({ ...item, date: item.received_at }))))
      .catch((failure) => setError(failure instanceof Error ? failure.message : "تعذر تحميل تقويم الاستلام"));
  }, []);

  return (
    <MarketingPage title="تقويم الاستلام" description="يعرض وقت ضغط اليوزر على تم الاستلام للحملات والأجندات.">
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        events={rows}
        renderEvent={(event) => (
          <article key={event.id} className="marketing-calendar-event receipt" style={{ borderInlineStartColor: event.user_color || undefined }}>
            <div className="marketing-calendar-event-head">
              <span>{event.source_type === "agenda" ? "أجندة" : "حملة"}</span>
              <time>{new Date(event.received_at).toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" })}</time>
            </div>
            <strong>{event.source_name || "—"}</strong>
            <p>{event.creative_name || "كرييتيف غير محدد"}</p>
            <small>اليوزر: {event.full_name || "—"}</small>
            <footer>{event.title || event.department_name || "تاسك"}</footer>
          </article>
        )}
      />
    </MarketingPage>
  );
}
