import { useEffect, useState } from "react";
import { Export, MapPin, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../systemAccess";
import {
  attendanceFetch,
  formatAttendanceDate,
  formatAttendanceDay,
  formatAttendanceMinutes,
  formatAttendanceTime,
} from "./api";

type AdminUser = {
  id: string;
  full_name: string;
  employee_no?: string | null;
  branch_name?: string | null;
};

type AdminPayload = { ok: true; users: AdminUser[] };

type ReportPeriod = {
  name: string;
  startTime: string;
  endTime: string;
  checkIn: string | null;
  checkOut: string | null;
  checkInText: string;
  checkOutText: string;
  checkoutSource: string | null;
  result: string;
  delayMinutes: number;
  workMinutes: number;
};

type ReportLocation = {
  actual: string;
  required: string;
  result: string;
  latitude: number | null;
  longitude: number | null;
  distanceM: number | null;
  accuracyM: number | null;
  captures: number;
  missingRequiredCapture: boolean;
};

type ReportRow = {
  date: string;
  branch: string;
  userId: string;
  employeeNo: string | null;
  name: string;
  location: ReportLocation;
  scheduleName: string | null;
  periods: Array<ReportPeriod | null>;
};

type ReportPayload = {
  ok: true;
  from: string;
  to: string;
  rows: ReportRow[];
  periodHeaders: string[];
};

function resultTone(result: string | null | undefined) {
  const value = String(result || "");
  if (value.includes("إجازة")) return "leave";
  if (value.includes("غائب") || value.includes("لم يسجل")) return "missing";
  if (value.includes("متأخر")) return "late";
  if (value.includes("حاضر")) return "present";
  return "neutral";
}

function resultLabel(result: string | null | undefined) {
  const value = String(result || "");
  if (value.includes("إجازة")) return "إجازة";
  if (value.includes("غائب")) return "غائب";
  if (value.includes("لم يسجل")) return "لم يسجل";
  if (value.includes("متأخر")) return "متأخر";
  if (value.includes("حاضر")) return "حاضر";
  return value || "—";
}

function locationHref(location: ReportLocation) {
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return "";
  return `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
}

export function AttendancePage() {
  const { user } = useAuth();
  const isAdmin = hasPermission(user, "platform.superadmin");
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState("");

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
    if (!isAdmin) return;
    void loadAdminUsers();
    void loadReport("", "", "");
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const interval = window.setInterval(() => {
      void loadReport(from, to, employeeId);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [isAdmin, from, to, employeeId]);

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

  if (!isAdmin) return <Navigate to="/" replace />;

  const periodHeaders = report?.periodHeaders || [];
  const totalColumns = 8 + periodHeaders.length * 3;

  return (
    <div className="module-page attendance-page attendance-report-only">
      <div className="module-page-head attendance-page-head attendance-report-only-head">
        <div>
          <h1>تقارير الحضور والانصراف</h1>
          <p>تقرير مركزي للحضور والانصراف حسب الفترات الفعلية المحددة لكل موظف.</p>
        </div>
      </div>

      {error ? <div className="attendance-alert error"><WarningCircle size={19} /><span>{error}</span></div> : null}

      <section className="panel attendance-report-card attendance-report-card-v3">
        <header className="attendance-report-head attendance-report-head-centered">
          <div>
            <UsersThree size={21} weight="duotone" />
            <span>
              <h2>تقارير الحضور والانصراف</h2>
              <p>أسماء الفترات تظهر تلقائيًا من إعدادات الحضور والانصراف.</p>
            </span>
          </div>
          <button className="secondary-button" type="button" onClick={exportExcel} disabled={!report?.rows?.length}>
            <Export size={18} /> تصدير Excel
          </button>
        </header>

        <form className="attendance-report-filters attendance-report-filters-v3" onSubmit={(event) => { event.preventDefault(); void loadReport(); }}>
          <label>
            <span>من تاريخ</span>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            <span>إلى تاريخ</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label>
            <span>الموظف</span>
            <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
              <option value="">كل اليوزرات</option>
              {adminUsers.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.full_name}{employee.employee_no ? ` - ${employee.employee_no}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button className="attendance-view-button" type="submit" disabled={reportLoading}>
            {reportLoading ? "جاري العرض..." : "عرض"}
          </button>
        </form>

        <div className="attendance-report-hint">
          <MapPin size={17} />
          <span>مكان الحضور يُحفظ من GPS وقت تسجيل الحضور. اضغط «عرض الموقع» لفتح نقطة الحضور على الخريطة.</span>
        </div>

        <div className="attendance-report-table-wrap attendance-report-table-wrap-v3">
          <table id="attendance-report-table" className="attendance-report-table attendance-report-table-v3">
            <colgroup>
              <col className="attendance-col-seq" />
              <col className="attendance-col-date" />
              <col className="attendance-col-day" />
              <col className="attendance-col-branch" />
              <col className="attendance-col-name" />
              <col className="attendance-col-location" />
              <col className="attendance-col-required" />
              <col className="attendance-col-location-result" />
              {periodHeaders.flatMap((header) => [
                <col key={`${header}-col-in`} className="attendance-col-time" />,
                <col key={`${header}-col-out`} className="attendance-col-time" />,
                <col key={`${header}-col-result`} className="attendance-col-period-result" />,
              ])}
            </colgroup>
            <thead>
              <tr className="attendance-table-groups">
                <th rowSpan={2} className="attendance-base-head">م</th>
                <th rowSpan={2} className="attendance-base-head">التاريخ</th>
                <th rowSpan={2} className="attendance-base-head">اليوم</th>
                <th rowSpan={2} className="attendance-base-head">الفرع</th>
                <th rowSpan={2} className="attendance-base-head">الاسم</th>
                <th colSpan={3} className="attendance-location-group">اللوكيشن</th>
                {periodHeaders.map((header) => (
                  <th key={header} colSpan={3} className="attendance-period-group">{header}</th>
                ))}
              </tr>
              <tr className="attendance-table-subheads">
                <th className="attendance-location-subhead">مكان الحضور</th>
                <th className="attendance-location-subhead">المكان المطلوب</th>
                <th className="attendance-location-subhead">النتيجة</th>
                {periodHeaders.flatMap((header) => [
                  <th key={`${header}-in`} className="attendance-period-subhead">الحضور</th>,
                  <th key={`${header}-out`} className="attendance-period-subhead">الانصراف</th>,
                  <th key={`${header}-result`} className="attendance-period-subhead">النتيجة</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {(report?.rows || []).map((row, index) => {
                const mapHref = locationHref(row.location);
                return (
                  <tr key={`${row.userId}:${row.date}`}>
                    <td className="attendance-seq-cell">{index + 1}</td>
                    <td className="attendance-date-cell">{formatAttendanceDate(row.date)}</td>
                    <td className="attendance-day-cell">{formatAttendanceDay(row.date)}</td>
                    <td className="attendance-branch-cell">{row.branch}</td>
                    <td className="attendance-name-cell">
                      <strong>{row.name}</strong>
                      {row.employeeNo ? <small>{row.employeeNo}</small> : null}
                    </td>
                    <td className="attendance-location-cell">
                      {mapHref ? (
                        <div className="attendance-location-reading">
                          <a href={mapHref} target="_blank" rel="noreferrer" className="attendance-location-link">
                            <MapPin size={14} weight="fill" />
                            <span>فتح اللوكيشن</span>
                          </a>
                          <strong className="attendance-location-coordinates">{Number(row.location.latitude).toFixed(6)}, {Number(row.location.longitude).toFixed(6)}</strong>
                          <small>{row.location.distanceM !== null ? `المسافة ${Math.round(row.location.distanceM)} م` : "GPS محفوظ"}</small>
                        </div>
                      ) : row.location.missingRequiredCapture ? (
                        <span className="attendance-location-missing">لم يتم حفظ اللوكيشن</span>
                      ) : <span className="attendance-empty-value">—</span>}
                    </td>
                    <td className="attendance-required-location-cell">{row.location.required}</td>
                    <td className="attendance-location-result-cell">
                      <span className={`attendance-report-location ${row.location.result === "مطابق" ? "matched" : row.location.result === "غير مطابق" ? "mismatched" : "neutral"}`}>
                        {row.location.result}
                      </span>
                    </td>
                    {periodHeaders.flatMap((_, periodIndex) => {
                      const period = row.periods[periodIndex];
                      const label = resultLabel(period?.result);
                      const tone = resultTone(period?.result);
                      return [
                        <td key={`${row.userId}:${row.date}:${periodIndex}:in`} className="attendance-time-cell">
                          <div className={`attendance-time-stamp ${period?.checkIn ? "recorded" : "empty"}`}>
                            <small>وقت الحضور</small>
                            <strong>{period ? (period.checkInText || formatAttendanceTime(period.checkIn)) : "—"}</strong>
                          </div>
                        </td>,
                        <td key={`${row.userId}:${row.date}:${periodIndex}:out`} className="attendance-time-cell">
                          <div className={`attendance-time-stamp ${period?.checkOut ? "recorded" : "empty"}`}>
                            <small>وقت الانصراف</small>
                            <strong>{period ? (period.checkOutText || formatAttendanceTime(period.checkOut)) : "—"}</strong>
                            {period?.checkoutSource === "auto" ? <em className="attendance-auto-tag">تلقائي</em> : null}
                          </div>
                        </td>,
                        <td key={`${row.userId}:${row.date}:${periodIndex}:result`} className="attendance-result-cell">
                          <span className={`attendance-period-status ${tone}`}>{label}</span>
                          {period?.checkIn ? (
                            <div className="attendance-period-metrics">
                              <small>{period.checkOut ? `العمل ${formatAttendanceMinutes(period.workMinutes)}` : "الفترة مفتوحة"}</small>
                              <small>{period.delayMinutes > 0 ? `تأخير ${period.delayMinutes} د` : "بدون تأخير"}</small>
                            </div>
                          ) : null}
                        </td>,
                      ];
                    })}
                  </tr>
                );
              })}
              {!reportLoading && !report?.rows?.length ? (
                <tr>
                  <td colSpan={totalColumns}>
                    <div className="unified-empty-row attendance-empty-report">لا توجد نتائج مطابقة للفلاتر.</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
