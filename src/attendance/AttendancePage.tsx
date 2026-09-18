import { useEffect, useMemo, useState } from "react";
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
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedEmployeeKey = employeeIds.join(",");
  const filteredEmployees = useMemo(() => {
    const search = employeeSearch.trim().toLocaleLowerCase("ar-SA");
    if (!search) return adminUsers;
    return adminUsers.filter((employee) => [employee.full_name, employee.employee_no, employee.branch_name]
      .some((value) => String(value || "").toLocaleLowerCase("ar-SA").includes(search)));
  }, [adminUsers, employeeSearch]);

  async function loadAdminUsers() {
    if (!isAdmin) return;
    try {
      const payload = await attendanceFetch<AdminPayload>("/api/attendance?view=admin");
      setAdminUsers(payload.users || []);
    } catch {
      setAdminUsers([]);
    }
  }

  async function loadReport(nextFrom = from, nextTo = to, nextEmployees = employeeIds) {
    if (!isAdmin) return;
    setReportLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ view: "report" });
      if (nextFrom) params.set("from", nextFrom);
      if (nextTo) params.set("to", nextTo);
      if (nextEmployees.length) params.set("employeeIds", nextEmployees.join(","));
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
    void loadReport("", "", []);
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const interval = window.setInterval(() => {
      void loadReport(from, to, employeeIds);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [isAdmin, from, to, selectedEmployeeKey]);

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

  function toggleEmployee(employeeId: string) {
    setEmployeeIds((current) => current.includes(employeeId)
      ? current.filter((id) => id !== employeeId)
      : [...current, employeeId]);
  }

  if (!isAdmin) return <Navigate to="/" replace />;

  const periodHeaders = report?.periodHeaders || [];
  const totalColumns = 8 + periodHeaders.length * 3;
  const employeeSummary = employeeIds.length
    ? employeeIds.length === 1
      ? adminUsers.find((employee) => employee.id === employeeIds[0])?.full_name || "موظف واحد"
      : `${employeeIds.length} موظفين`
    : "كل اليوزرات";

  return (
    <div className="module-page attendance-page attendance-report-only">
      <div className="module-page-head attendance-page-head attendance-report-only-head">
        <div>
          <h1>تقارير الحضور والانصراف</h1>
          <p>تقرير مركزي للحضور والانصراف حسب الفترات الفعلية المحددة لكل موظف.</p>
        </div>
      </div>

      {error ? <div className="attendance-alert error"><WarningCircle size={19} /><span>{error}</span></div> : null}

      <section className="panel attendance-report-card">
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

        <form className="attendance-report-filters" onSubmit={(event) => { event.preventDefault(); void loadReport(); }}>
          <label>
            <span>من تاريخ</span>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            <span>إلى تاريخ</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label className="attendance-employee-multifilter">
            <span>الموظف</span>
            <details>
              <summary>{employeeSummary}</summary>
              <div className="attendance-employee-dropdown">
                <input
                  type="search"
                  placeholder="ابحث باسم الموظف أو رقم الموظف أو الفرع"
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.target.value)}
                />
                <div className="attendance-employee-filter-actions">
                  <button type="button" onClick={() => setEmployeeIds([])}>كل اليوزرات</button>
                  <button type="button" onClick={() => setEmployeeIds(filteredEmployees.map((employee) => employee.id))}>تحديد الظاهر</button>
                </div>
                <div className="attendance-employee-options">
                  {filteredEmployees.map((employee) => (
                    <label key={employee.id}>
                      <input
                        type="checkbox"
                        checked={employeeIds.includes(employee.id)}
                        onChange={() => toggleEmployee(employee.id)}
                      />
                      <span>
                        <strong>{employee.full_name}</strong>
                        <small>{[employee.employee_no, employee.branch_name].filter(Boolean).join(" • ")}</small>
                      </span>
                    </label>
                  ))}
                  {!filteredEmployees.length ? <p>لا يوجد موظفون مطابقون للبحث.</p> : null}
                </div>
              </div>
            </details>
          </label>
          <button className="attendance-view-button" type="submit" disabled={reportLoading}>
            {reportLoading ? "جاري العرض..." : "عرض"}
          </button>
        </form>

        <div className="attendance-report-hint">
          <MapPin size={17} />
          <span>مكان الحضور هو الإحداثيات المحفوظة فعليًا وقت تسجيل الحضور. اضغط الإحداثيات لفتحها على الخريطة.</span>
        </div>

        <div className="attendance-report-table-wrap attendance-report-table-fit">
          <table id="attendance-report-table" className={`attendance-report-table attendance-report-table-compact periods-${Math.min(periodHeaders.length, 4)}`}>
            <colgroup>
              <col className="attendance-col-index" />
              <col className="attendance-col-date" />
              <col className="attendance-col-day" />
              <col className="attendance-col-branch" />
              <col className="attendance-col-name" />
              <col className="attendance-col-location" />
              <col className="attendance-col-required" />
              <col className="attendance-col-location-result" />
              {periodHeaders.flatMap((header) => [
                <col key={`${header}-col-in`} className="attendance-col-period-time" />,
                <col key={`${header}-col-out`} className="attendance-col-period-time" />,
                <col key={`${header}-col-result`} className="attendance-col-period-result" />,
              ])}
            </colgroup>
            <thead>
              <tr className="attendance-main-head-row">
                <th rowSpan={2}>م</th>
                <th rowSpan={2}>التاريخ</th>
                <th rowSpan={2}>اليوم</th>
                <th rowSpan={2}>الفرع</th>
                <th rowSpan={2}>الاسم</th>
                <th colSpan={3}>اللوكيشن</th>
                {periodHeaders.map((header) => <th key={`${header}-group`} colSpan={3}>{header}</th>)}
              </tr>
              <tr className="attendance-sub-head-row">
                <th>مكان الحضور</th>
                <th>المكان المطلوب</th>
                <th>النتيجة</th>
                {periodHeaders.flatMap((header) => [
                  <th key={`${header}-in`}>الحضور</th>,
                  <th key={`${header}-out`}>الانصراف</th>,
                  <th key={`${header}-result`}>النتيجة</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {(report?.rows || []).map((row, index) => {
                const mapHref = locationHref(row.location);
                return (
                  <tr key={`${row.userId}:${row.date}`}>
                    <td>{index + 1}</td>
                    <td className="attendance-date-cell"><bdi dir="ltr">{formatAttendanceDate(row.date)}</bdi></td>
                    <td>{formatAttendanceDay(row.date)}</td>
                    <td>{row.branch}</td>
                    <td className="attendance-name-cell">
                      <strong>{row.name}</strong>
                      {row.employeeNo ? <small>{row.employeeNo}</small> : null}
                    </td>
                    <td className="attendance-location-cell">
                      {mapHref ? (
                        <>
                          <a href={mapHref} target="_blank" rel="noreferrer" className="attendance-plain-location-link" title={`${Number(row.location.latitude).toFixed(6)}, ${Number(row.location.longitude).toFixed(6)}`}>
                            <bdi dir="ltr">{Number(row.location.latitude).toFixed(5)}</bdi>
                            <bdi dir="ltr">{Number(row.location.longitude).toFixed(5)}</bdi>
                          </a>
                          {row.location.distanceM !== null ? <small>{Math.round(row.location.distanceM)} م</small> : null}
                        </>
                      ) : row.location.missingRequiredCapture ? (
                        <span className="attendance-location-missing-text">لم يتم حفظ اللوكيشن</span>
                      ) : "—"}
                    </td>
                    <td>{row.location.required}</td>
                    <td className={`attendance-text-result ${row.location.result === "مطابق" ? "present" : row.location.result === "غير مطابق" ? "missing" : "neutral"}`}>
                      {row.location.result}
                    </td>
                    {periodHeaders.flatMap((_, periodIndex) => {
                      const period = row.periods[periodIndex];
                      const tone = resultTone(period?.result);
                      const label = resultLabel(period?.result);
                      return [
                        <td key={`${row.userId}:${row.date}:${periodIndex}:in`} className="attendance-time-cell-plain">
                          {period?.checkIn ? (period.checkInText || formatAttendanceTime(period.checkIn)) : "—"}
                        </td>,
                        <td key={`${row.userId}:${row.date}:${periodIndex}:out`} className="attendance-time-cell-plain">
                          {period?.checkOut ? (period.checkOutText || formatAttendanceTime(period.checkOut)) : "—"}
                          {period?.checkoutSource === "auto" ? <small>تلقائي</small> : null}
                        </td>,
                        <td key={`${row.userId}:${row.date}:${periodIndex}:result`} className={`attendance-text-result ${tone}`}>
                          <strong>{label}</strong>
                          {period?.checkIn ? <small>{period.checkOut ? `العمل ${formatAttendanceMinutes(period.workMinutes)}` : "الفترة مفتوحة"}{period.delayMinutes > 0 ? ` • تأخير ${period.delayMinutes} د` : " • بدون تأخير"}</small> : null}
                        </td>,
                      ];
                    })}
                  </tr>
                );
              })}
              {!reportLoading && !report?.rows?.length ? (
                <tr>
                  <td colSpan={totalColumns} className="attendance-empty-table-cell">لا توجد نتائج مطابقة للفلاتر.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
