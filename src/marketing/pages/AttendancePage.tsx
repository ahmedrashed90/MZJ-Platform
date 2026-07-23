import { useEffect, useMemo, useState } from "react";
import { Clock, DownloadSimple, SignIn, SignOut, UserCheck, WarningCircle } from "@phosphor-icons/react";
import { marketingFetch, marketingPost, queryString } from "../api";
import {
  MarketingAlert,
  MarketingEmpty,
  MarketingLoading,
  MarketingPageHeader,
  Pagination,
  formatDate,
} from "../components/Ui";
import { exportRowsToExcel } from "../excel";

type AttendanceSession = {
  id: string;
  full_name: string;
  email?: string;
  work_date: string;
  checked_in_at?: string;
  checked_out_at?: string;
  late_minutes: number;
  work_minutes: number;
  presence_status?: string;
  last_seen_at?: string;
};

type AttendancePayload = {
  ok: true;
  settings: {
    work_start: string;
    work_end: string;
    grace_minutes: number;
    timezone: string;
  };
  today: AttendanceSession | null;
  rows: AttendanceSession[];
  users: Array<{ id: string; full_name: string }>;
  summary: {
    sessions?: number;
    late_count?: number;
    no_checkout?: number;
    total_work_minutes?: number;
    present_users?: number;
  };
  total: number;
  canManage: boolean;
};

export function AttendancePage() {
  const initialDate = new Date();
  const [clock, setClock] = useState(initialDate);
  const [data, setData] = useState<AttendancePayload | null>(null);
  const [from, setFrom] = useState(initialDate.toISOString().slice(0, 10));
  const [to, setTo] = useState(initialDate.toISOString().slice(0, 10));
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pageSize = 40;

  async function load() {
    setLoading(true);
    setError("");
    try {
      const payload = await marketingFetch<AttendancePayload>(
        `/api/marketing?${queryString({ resource: "attendance", from, to, userId, status, page, pageSize })}`,
      );
      setData(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل الحضور والانصراف");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [from, to, userId, status, page]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    const heartbeat = window.setInterval(() => {
      void marketingPost({ action: "attendance_heartbeat", idle: document.hidden });
    }, 60000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(heartbeat);
    };
  }, []);

  async function runAction(actionName: "attendance_check_in" | "attendance_check_out") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingPost<{ message: string }>({ action: actionName });
      setMessage(result.message);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تسجيل الحضور");
    } finally {
      setBusy(false);
    }
  }

  const workHours = useMemo(
    () => Math.round((Number(data?.summary.total_work_minutes || 0) / 60) * 10) / 10,
    [data],
  );

  async function exportAttendance() {
    if (!data?.canManage) return;
    setBusy(true);
    setError("");
    try {
      const exported: AttendanceSession[] = [];
      let exportPage = 1;
      let exportTotal = 0;
      do {
        const payload = await marketingFetch<AttendancePayload>(
          `/api/marketing?${queryString({ resource: "attendance", from, to, userId, status, page: exportPage, pageSize: 500 })}`,
        );
        exported.push(...payload.rows);
        exportTotal = Number(payload.total || 0);
        exportPage += 1;
      } while (exported.length < exportTotal);
      exportRowsToExcel(exported.map((row, index) => ({
        "م": index + 1,
        "الموظف": row.full_name,
        "التاريخ": String(row.work_date || "").slice(0, 10),
        "وقت الحضور": row.checked_in_at ? new Date(row.checked_in_at).toLocaleString("ar-SA") : "",
        "وقت الانصراف": row.checked_out_at ? new Date(row.checked_out_at).toLocaleString("ar-SA") : "",
        "التأخير بالدقائق": Number(row.late_minutes || 0),
        "ساعات العمل": Math.round((Number(row.work_minutes || 0) / 60) * 100) / 100,
        "الحالة اللحظية": row.presence_status || "offline",
        "آخر ظهور": row.last_seen_at ? new Date(row.last_seen_at).toLocaleString("ar-SA") : "",
      })), `marketing-attendance-${from}-${to}.xlsx`, "الحضور والانصراف");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تصدير الحضور");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="marketing-page">
      <MarketingPageHeader
        title="الحضور والانصراف"
        description="تسجيل حضور فريق التسويق ومتابعة Online / Idle / Offline والتأخير وساعات العمل."
        actions={data?.canManage ? <button type="button" className="marketing-button" disabled={busy} onClick={() => void exportAttendance()}><DownloadSimple />تصدير XLSX</button> : undefined}
      />
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}
      {loading && !data ? <MarketingLoading /> : null}

      {data ? (
        <>
          <section className="marketing-attendance-hero">
            <div>
              <small>الوقت الحالي — {data.settings.timezone || "Asia/Riyadh"}</small>
              <div className="marketing-attendance-clock">
                {new Intl.DateTimeFormat("ar-SA", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }).format(clock)}
              </div>
              <p>
                الدوام: {String(data.settings.work_start).slice(0, 5)} — {String(data.settings.work_end).slice(0, 5)} · السماح {data.settings.grace_minutes} دقيقة
              </p>
            </div>
            <div className="marketing-table-actions">
              {!data.today?.checked_in_at ? (
                <button className="marketing-button success" disabled={busy} onClick={() => void runAction("attendance_check_in")}>
                  <SignIn /> تسجيل حضور
                </button>
              ) : !data.today.checked_out_at ? (
                <button className="marketing-button danger" disabled={busy} onClick={() => void runAction("attendance_check_out")}>
                  <SignOut /> تسجيل انصراف
                </button>
              ) : (
                <span className="marketing-status status-completed">تم تسجيل اليوم</span>
              )}
            </div>
          </section>

          <section className="marketing-stats-grid">
            <article className="marketing-stat"><div><small>الحاضرون</small><strong>{data.summary.present_users || 0}</strong></div><UserCheck size={30} /></article>
            <article className="marketing-stat"><div><small>المتأخرون</small><strong>{data.summary.late_count || 0}</strong></div><WarningCircle size={30} /></article>
            <article className="marketing-stat"><div><small>بدون انصراف</small><strong>{data.summary.no_checkout || 0}</strong></div><Clock size={30} /></article>
            <article className="marketing-stat"><div><small>إجمالي ساعات العمل</small><strong>{workHours}</strong></div></article>
          </section>

          {data.canManage ? (
            <section className="marketing-panel">
              <div className="marketing-toolbar">
                <label className="marketing-field"><span>من</span><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
                <label className="marketing-field"><span>إلى</span><input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
                <label className="marketing-field">
                  <span>الموظف</span>
                  <select value={userId} onChange={(event) => { setUserId(event.target.value); setPage(1); }}>
                    <option value="">كل الموظفين</option>
                    {data.users.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}
                  </select>
                </label>
                <label className="marketing-field">
                  <span>الحالة</span>
                  <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                    <option value="">الكل</option>
                    <option value="present">حاضر</option>
                    <option value="late">متأخر</option>
                    <option value="no_checkout">بدون انصراف</option>
                  </select>
                </label>
              </div>
            </section>
          ) : null}

          <section className="marketing-panel">
            <div className="marketing-panel-head"><div><h2>{data.canManage ? "سجل الحضور" : "سجل اليوم"}</h2><p>{data.total} سجل</p></div></div>
            {!data.rows.length ? (
              <MarketingEmpty title="لا توجد سجلات" />
            ) : (
              <div className="marketing-table-wrap">
                <table className="marketing-table">
                  <thead><tr><th>الموظف</th><th>التاريخ</th><th>الحضور</th><th>الانصراف</th><th>التأخير</th><th>ساعات العمل</th><th>الحالة اللحظية</th><th>آخر ظهور</th></tr></thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.id}>
                        <td><b>{row.full_name}</b><small style={{ display: "block" }}>{row.email || ""}</small></td>
                        <td>{String(row.work_date).slice(0, 10)}</td>
                        <td>{formatDate(row.checked_in_at, true)}</td>
                        <td>{formatDate(row.checked_out_at, true)}</td>
                        <td>{row.late_minutes || 0} دقيقة</td>
                        <td>{Math.round((Number(row.work_minutes || 0) / 60) * 10) / 10}</td>
                        <td><span className="marketing-chip"><i className={`marketing-presence-dot ${row.presence_status || "offline"}`} />{row.presence_status || "offline"}</span></td>
                        <td>{formatDate(row.last_seen_at, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {data.canManage ? <Pagination page={page} pageSize={pageSize} total={data.total} onChange={setPage} /> : null}
        </>
      ) : null}
    </div>
  );
}
