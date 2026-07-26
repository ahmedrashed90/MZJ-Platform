import { useEffect, useState } from "react";
import { marketingFetch, marketingQuery } from "../api";
import { MonthCalendar } from "../components/MonthCalendar";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";

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
          <article key={event.id} className="marketing-calendar-event marketing-calendar-execution" style={{ borderInlineStartColor: event.user_color || undefined }}>
            <div className="marketing-calendar-event-head">
              <span>{event.source_type === "agenda" ? "أجندة" : "حملة"}</span>
              <b>{event.platform_name || "منصة غير محددة"}</b>
            </div>
            <strong>{event.task_title || event.creative_name || "تاسك تنفيذي"}</strong>
            <p>{event.source_name || "—"}</p>
            <small>{event.creative_name || "—"} · {event.post_type_name || "نوع نشر غير محدد"}</small>
            <footer>{event.assigned_name || "لم يحدد المسؤول"}</footer>
          </article>
        )}
      />
    </MarketingPage>
  );
}
