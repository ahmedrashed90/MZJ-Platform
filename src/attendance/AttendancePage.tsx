import { useEffect, useState } from "react";
import { Export, MapPin, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../systemAccess";
import { attendanceFetch, formatAttendanceDate, formatAttendanceDay, formatAttendanceTime } from "./api";

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
  periods: Array<ReportPeriod | null>;
};

type ReportPayload = {
  ok: true;
  from: string;
  to: string;
  rows: ReportRow[];
  periodHeaders: string[];
};

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

  return (
    <div className="module-page attendance-page attendance-report-only">
      <div className="module-page-head attendance-page-head attendance-report-only-head">
        <div>
          <h1>تقارير الحضور والانصراف</h1>
          <p>تقارير الحضور المركزي لكل مستخدمي المنصة حسب جدول وفترات العمل المحددة لكل موظف.</p>
        </div>
      </div>

      {error ? <div className="attendance-alert error"><WarningCircle size={19} /><span>{error}</span></div> : null}

      <section className="panel attendance-report-card">
        <header className="attendance-report-head attendance-report-head-centered">
          <div><UsersThree size={20} weight="duotone" /><span><h2>تقارير الحضور والانصراف</h2><p>أسماء الفترات تظهر تلقائيًا من الفترات التي تم إنشاؤها في إعدادات الحضور والانصراف.</p></span></div>
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
          <span>لو لم تحدد تاريخًا يظهر كل اليوزرات لليوم الحالي. اللوكيشن يظهر مطابق أو غير مطابق، ولو لا يوجد مكان مطلوب يظهر غير مطلوب، ويوم الإجازة يظهر في نتيجة الفترة باسم إجازة.</span>
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
              {!reportLoading && !report?.rows?.length ? <tr><td colSpan={8 + (report?.periodHeaders?.length || 0) * 3}><div className="unified-empty-row">لا توجد نتائج مطابقة للفلاتر.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
