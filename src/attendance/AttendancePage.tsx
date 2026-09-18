import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  Clock,
  Export,
  MapPin,
  SignOut,
  UserCheck,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../systemAccess";
import { attendanceFetch, formatAttendanceDate, formatAttendanceDay, formatAttendanceTime } from "./api";

type SelfPayload = {
  ok: true;
  assigned: boolean;
  isDayOff?: boolean;
  weeklyOffDay?: number | null;
  activePeriod: null | {
    schedule_name: string;
    period_name: string;
    start_time: string;
    end_time: string;
    grace_minutes: number;
    location_name: string | null;
    scheduled_end_at: string;
  };
  currentRecord: null | {
    id: string;
    check_in: string | null;
    check_out: string | null;
    delay_minutes: number;
    work_minutes: number;
    status: string;
    location_result: string;
    required_location_name?: string | null;
  };
  recent: Array<{
    id: string;
    work_date: string;
    period_name: string | null;
    check_in: string | null;
    check_out: string | null;
    checkout_source: string | null;
    delay_minutes: number;
    work_minutes: number;
    status: string;
    required_location_name: string | null;
    check_in_distance_m: number | null;
    location_result: string;
  }>;
};

type AdminUser = { id: string; full_name: string; employee_no?: string | null; branch_name?: string | null };
type AdminPayload = { ok: true; users: AdminUser[] };

type ReportPeriod = {
  name: string;
  startTime: string;
  endTime: string;
  checkIn: string | null;
  checkOut: string | null;
  checkoutSource: string | null;
  result: string;
  delayMinutes: number;
  workMinutes: number;
};

type ReportRow = {
  date: string;
  branch: string;
  userId: string;
  employeeNo: string | null;
  name: string;
  location: { actual: string; required: string; result: string };
  scheduleName: string | null;
  periods: ReportPeriod[];
};

type ReportPayload = {
  ok: true;
  from: string;
  to: string;
  rows: ReportRow[];
  periodHeaders: string[];
};

function statusLabel(record: SelfPayload["currentRecord"] | undefined, isDayOff = false) {
  if (isDayOff) return "عطلة";
  if (!record?.check_in) return "لم يسجل";
  if (record.check_out) return "تم الانصراف";
  return Number(record.delay_minutes || 0) > 0 ? "حاضر - متأخر" : "حاضر";
}

function locationLabel(value: string | null | undefined) {
  if (value === "matched") return "مطابق";
  if (value === "mismatched") return "غير مطابق";
  if (value === "not_required") return "غير مطلوب";
  return "—";
}

function minutesText(value: number) {
  const minutes = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} د`;
  return rest ? `${hours} س ${rest} د` : `${hours} س`;
}

export function AttendancePage() {
  const { user, logout } = useAuth();
  const isAdmin = hasPermission(user, "platform.superadmin");
  const [tab, setTab] = useState<"today" | "report">("today");
  const [self, setSelf] = useState<SelfPayload | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadSelf() {
    setLoading(true);
    setError("");
    try {
      setSelf(await attendanceFetch<SelfPayload>("/api/attendance?view=self"));
    } catch (loadError) {
      const status = (loadError as Error & { status?: number }).status;
      if (status === 401) {
        await logout();
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل الحضور");
    } finally {
      setLoading(false);
    }
  }

  async function loadAdminUsers() {
    if (!isAdmin) return;
    try {
      const payload = await attendanceFetch<AdminPayload>("/api/attendance?view=admin");
      setAdminUsers(payload.users || []);
    } catch {
      setAdminUsers([]);
    }
  }

  async function loadReport(nextFrom = from, nextTo = to, nextEmployee = employeeId) {
    if (!isAdmin) return;
    setReportLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ view: "report" });
      if (nextFrom) params.set("from", nextFrom);
      if (nextTo) params.set("to", nextTo);
      if (nextEmployee) params.set("employeeId", nextEmployee);
      setReport(await attendanceFetch<ReportPayload>(`/api/attendance?${params.toString()}`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل التقرير");
    } finally {
      setReportLoading(false);
    }
  }

  useEffect(() => {
    void loadSelf();
    if (isAdmin) {
      void loadAdminUsers();
      void loadReport("", "", "");
    }
  }, [isAdmin]);

  async function checkout() {
    setMessage("");
    setError("");
    try {
      await attendanceFetch<{ ok: true }>("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ action: "check_out" }),
      });
      setMessage("تم تسجيل الانصراف وإنهاء جلسة المنصة");
      await logout();
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "تعذر تسجيل الانصراف");
    }
  }

  function exportExcel() {
    const table = document.getElementById("attendance-report-table") as HTMLTableElement | null;
    if (!table) return;
    const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"></head><body>${table.outerHTML}</body></html>`;
    const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `attendance-report-${report?.from || "all"}-${report?.to || "all"}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  const current = self?.currentRecord;
  const active = self?.activePeriod;
  const currentCards = useMemo(() => [
    { label: "جدول العمل", value: active?.schedule_name || (self?.assigned ? "لا توجد فترة فعالة الآن" : "غير محدد") },
    { label: "الفترة الحالية", value: active ? `${active.period_name} • ${active.start_time} - ${active.end_time}` : "—" },
    { label: "الحضور", value: formatAttendanceTime(current?.check_in) },
    { label: "التأخير", value: current?.check_in ? (Number(current.delay_minutes || 0) ? `${current.delay_minutes} دقيقة` : "بدون تأخير") : "—" },
    { label: "المكان المطلوب", value: active?.location_name || current?.required_location_name || "غير مطلوب" },
    { label: "نتيجة اللوكيشن", value: current ? locationLabel(current.location_result) : "—" },
  ], [active, current, self?.assigned]);

  return (
    <div className="module-page attendance-page">
      <div className="module-page-head attendance-page-head">
        <div>
          <h1>الحضور والانصراف</h1>
          <p>نظام الحضور المركزي لكل مستخدمي المنصة حسب جدول وفترات العمل المحددة لكل موظف.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void loadSelf()} disabled={loading}>
          <ArrowClockwise size={18} /> تحديث
        </button>
      </div>

      {isAdmin ? (
        <div className="attendance-tabs">
          <button type="button" className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}><UserCheck size={18} /> الحضور الحالي</button>
          <button type="button" className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}><UsersThree size={18} /> تقارير الحضور والانصراف</button>
        </div>
      ) : null}

      {error ? <div className="attendance-alert error"><WarningCircle size={19} /><span>{error}</span></div> : null}
      {message ? <div className="attendance-alert success"><UserCheck size={19} /><span>{message}</span></div> : null}

      {tab === "today" ? (
        <>
          <section className="attendance-status-card panel">
            <header>
              <div>
                <span className="attendance-kicker">حالتك الآن</span>
                <h2>{loading ? "جاري التحقق..." : statusLabel(current, Boolean(self?.isDayOff))}</h2>
                <p>{active ? `تنتهي الفترة ${formatAttendanceTime(active.scheduled_end_at)}` : self?.isDayOff ? "اليوم هو يوم العطلة الأسبوعية المحدد لك." : self?.assigned ? "لا توجد فترة عمل فعالة في الوقت الحالي." : "لم يتم تعيين جدول حضور لهذا المستخدم."}</p>
              </div>
              <div className={`attendance-state-orb ${current?.check_in && !current?.check_out ? "online" : ""}`}><Clock size={31} weight="duotone" /></div>
            </header>
            <div className="attendance-current-grid">
              {currentCards.map((card) => <article key={card.label}><span>{card.label}</span><strong>{card.value}</strong></article>)}
            </div>
            {current?.check_in && !current?.check_out ? (
              <footer>
                <button className="attendance-checkout-button" type="button" onClick={() => void checkout()}>
                  <SignOut size={19} /> تسجيل انصراف
                </button>
                <span>بعد تسجيل الانصراف سيتم تسجيل خروجك من المنصة تلقائيًا.</span>
              </footer>
            ) : null}
          </section>

          <section className="panel attendance-recent-card">
            <header><div><h2>آخر سجلات الحضور</h2><p>كل فترة تظهر كسجل مستقل.</p></div></header>
            <div className="unified-table-wrap">
              <table>
                <thead><tr><th>التاريخ</th><th>الفترة</th><th>الحضور</th><th>الانصراف</th><th>ساعات العمل</th><th>التأخير</th><th>المكان المطلوب</th><th>النتيجة</th></tr></thead>
                <tbody>
                  {(self?.recent || []).map((row) => (
                    <tr key={row.id}>
                      <td>{formatAttendanceDate(row.work_date)}</td>
                      <td>{row.period_name || "—"}</td>
                      <td>{formatAttendanceTime(row.check_in)}</td>
                      <td>{formatAttendanceTime(row.check_out)}{row.checkout_source === "auto" ? <small className="attendance-auto-tag"> تلقائي</small> : null}</td>
                      <td>{row.check_out ? minutesText(row.work_minutes) : "—"}</td>
                      <td>{row.delay_minutes ? `${row.delay_minutes} د` : row.check_in ? "0" : "—"}</td>
                      <td>{row.required_location_name || "غير مطلوب"}</td>
                      <td><span className={`attendance-location-result ${row.location_result}`}>{locationLabel(row.location_result)}</span></td>
                    </tr>
                  ))}
                  {!self?.recent?.length ? <tr><td colSpan={8}><div className="unified-empty-row">لا توجد سجلات حضور حتى الآن.</div></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {tab === "report" && isAdmin ? (
        <section className="panel attendance-report-card">
          <header className="attendance-report-head">
            <div><h2>تقارير الحضور والانصراف</h2><p>الفترات تظهر تلقائيًا حسب الفترات المحددة في السيستم لكل موظف.</p></div>
            <button className="secondary-button" type="button" onClick={exportExcel} disabled={!report?.rows?.length}><Export size={18} /> تصدير Excel</button>
          </header>

          <form className="attendance-report-filters" onSubmit={(event) => { event.preventDefault(); void loadReport(); }}>
            <label><span>من تاريخ</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label><span>إلى تاريخ</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
            <label><span>الموظف</span><select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">كل اليوزرات</option>{adminUsers.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}{employee.employee_no ? ` - ${employee.employee_no}` : ""}</option>)}</select></label>
            <button className="attendance-view-button" type="submit" disabled={reportLoading}>{reportLoading ? "جاري العرض..." : "عرض"}</button>
          </form>

          <div className="attendance-report-hint">
            <MapPin size={17} />
            <span>لو لم تحدد تاريخًا يظهر كل اليوزرات لليوم الحالي. اللوكيشن يظهر مطابق أو غير مطابق، ولو لا يوجد مكان مطلوب يظهر غير مطلوب، ويوم العطلة يظهر في نتيجة الفترة باسم عطلة.</span>
          </div>

          <div className="unified-table-wrap attendance-report-table-wrap">
            <table id="attendance-report-table" className="attendance-report-table">
              <thead>
                <tr>
                  <th rowSpan={2}>م</th>
                  <th rowSpan={2}>التاريخ</th>
                  <th rowSpan={2}>اليوم</th>
                  <th rowSpan={2}>الفرع</th>
                  <th rowSpan={2}>الاسم</th>
                  <th colSpan={3}>اللوكيشن</th>
                  {(report?.periodHeaders || []).map((header) => <th key={header} colSpan={3}>{header}</th>)}
                </tr>
                <tr>
                  <th>مكان الحضور</th>
                  <th>المكان المطلوب</th>
                  <th>النتيجة</th>
                  {(report?.periodHeaders || []).flatMap((header) => [
                    <th key={`${header}-in`}>الحضور</th>,
                    <th key={`${header}-out`}>الانصراف</th>,
                    <th key={`${header}-result`}>النتيجة</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {(report?.rows || []).map((row, index) => (
                  <tr key={`${row.userId}:${row.date}`}>
                    <td>{index + 1}</td>
                    <td>{formatAttendanceDate(row.date)}</td>
                    <td>{formatAttendanceDay(row.date)}</td>
                    <td>{row.branch}</td>
                    <td><strong>{row.name}</strong></td>
                    <td className="attendance-location-cell">{row.location.actual}</td>
                    <td>{row.location.required}</td>
                    <td><span className={`attendance-report-location ${row.location.result === "مطابق" ? "matched" : row.location.result === "غير مطابق" ? "mismatched" : "neutral"}`}>{row.location.result}</span></td>
                    {(report?.periodHeaders || []).flatMap((_, periodIndex) => {
                      const period = row.periods[periodIndex];
                      return [
                        <td key={`${row.userId}:${row.date}:${periodIndex}:in`}>{period ? formatAttendanceTime(period.checkIn) : "—"}</td>,
                        <td key={`${row.userId}:${row.date}:${periodIndex}:out`}>{period ? formatAttendanceTime(period.checkOut) : "—"}{period?.checkoutSource === "auto" ? <small className="attendance-auto-tag"> تلقائي</small> : null}</td>,
                        <td key={`${row.userId}:${row.date}:${periodIndex}:result`} className="attendance-result-cell">{period?.result || "—"}</td>,
                      ];
                    })}
                  </tr>
                ))}
                {!reportLoading && !report?.rows?.length ? <tr><td colSpan={7 + (report?.periodHeaders?.length || 0) * 3}><div className="unified-empty-row">لا توجد نتائج مطابقة للفلاتر.</div></td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
