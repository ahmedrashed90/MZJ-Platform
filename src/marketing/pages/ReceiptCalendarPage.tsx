import { useEffect, useState } from "react";
import { marketingDate, marketingFetch, marketingQuery } from "../api";
import { MonthCalendar } from "../components/MonthCalendar";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";

function sourceLabel(sourceType: string) {
  return sourceType === "agenda" ? "أجندة" : "حملة";
}

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
    <MarketingPage title="تقويم الاستلام" description="الحملات والأجندات وفق تاريخ ضغط اليوزر على تم الاستلام.">
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        events={rows}
        renderEvent={(event) => (
          <article key={event.id} className="marketing-calendar-event receipt" style={{ borderInlineStartColor: event.user_color || undefined }}>
            <strong>{sourceLabel(event.source_type)} · {event.source_name || "—"}</strong>
            <span>{event.full_name || "—"} · {event.creative_name || "—"}</span>
            <small>{event.task_title || event.department_name || "—"}</small>
            <time>{marketingDate(event.received_at, true)}</time>
          </article>
        )}
      />
    </MarketingPage>
  );
}
