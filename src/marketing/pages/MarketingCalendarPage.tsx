import { useEffect, useState } from "react";
import { marketingFetch, marketingQuery } from "../api";
import { MonthCalendar } from "../components/MonthCalendar";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";

function sourceLabel(sourceType: string) {
  return sourceType === "agenda" ? "أجندة" : "حملة";
}

export function MarketingCalendarPage() {
  const [month, setMonth] = useState(new Date());
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    marketingFetch<{ rows: any[] }>(`/api/marketing${marketingQuery({ resource: "calendar" })}`)
      .then((payload) => setRows(payload.rows))
      .catch((failure) => setError(failure instanceof Error ? failure.message : "تعذر تحميل التقويم"));
  }, []);

  return (
    <MarketingPage title="التقويم" description="التاسكات التنفيذية مرتبة حسب موعد النشر والمنصة.">
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        events={rows}
        renderEvent={(event) => (
          <article key={event.id} className="marketing-calendar-event" style={{ borderInlineStartColor: event.user_color || undefined }}>
            <strong>{event.task_title || event.creative_name || "تاسك تنفيذي"}</strong>
            <span>{sourceLabel(event.source_type)} · {event.source_name || "—"}</span>
            <small>{event.platform_name || "—"} · {event.post_type_name || "—"}</small>
          </article>
        )}
      />
    </MarketingPage>
  );
}
