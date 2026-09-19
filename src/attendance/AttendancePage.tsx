import { useEffect, useMemo, useState } from "react";
import { Export, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../systemAccess";
import {
  attendanceFetch,
  formatAttendanceDate,
  formatAttendanceDay,
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

type ReportRow = {
  date: string;
  branch: string;
  userId: string;
  employeeNo: string | null;
  name: string;
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

function missingResultLabel(result: string | null | undefined) {
  const value = String(result || "");
  if (value.includes("إجازة")) return "إجازة";
  if (value.includes("غائب")) return "غائب";
  if (value.includes("لم يسجل")) return "لم يسجل";
  return "—";
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

  const filteredEmployees = useMemo(() => {
    const search = employeeSearch.trim().toLocaleLowerCase("ar-SA");
    if (!search) return adminUsers;
    return adminUsers.filter((employee) => [employee.full_name, employee.employee_no, employee.branch_name]
      .some((value) => String(value || "").toLocaleLowerCase("ar-SA").includes(search)));
  }, [adminUsers, employeeSearch]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, ReportRow[]>();
    for (const row of report?.rows || []) {
      if (!groups.has(row.date)) groups.set(row.date, []);
      groups.get(row.date)!.push(row);
    }
    return Array.from(groups.entries()).map(([date, rows]) => ({ date, rows }));
  }, [report?.rows]);

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

  function exportExcel() {
    const content = document.getElementById("attendance-report-export");
    if (!content) return;
    const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"></head><body>${content.outerHTML}</body></html>`;
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

      <section className="panel attendance-report-card attendance-report-card-v90">
        <header className="attendance-report-head attendance-report-head-centered">
          <div>
            <UsersThree size={21} weight="duotone" />
            <span><h2>تقارير الحضور والانصراف</h2></span>
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
          <button className="attendance-view-button" type="submit" disabled={reportLoading}>عرض</button>
        </form>

        <div id="attendance-report-export" className="attendance-day-groups">
          {groupedRows.map((group, groupIndex) => (
            <section className={`attendance-day-block day-tone-${groupIndex % 2}`} key={group.date}>
              <header className="attendance-day-title">
                <strong>{formatAttendanceDay(group.date)} {formatAttendanceDate(group.date)}</strong>
              </header>
              <div className="attendance-day-table-wrap">
                <table className={`attendance-report-table attendance-report-table-compact attendance-day-table periods-${Math.min(periodHeaders.length, 4)}`}>
                  <colgroup>
                    <col className="attendance-col-index" />
                    <col className="attendance-col-branch" />
                    <col className="attendance-col-name" />
                    {periodHeaders.flatMap((header) => [
                      <col key={`${group.date}-${header}-col-in`} className="attendance-col-period-time" />,
                      <col key={`${group.date}-${header}-col-out`} className="attendance-col-period-time" />,
                      <col key={`${group.date}-${header}-col-result`} className="attendance-col-period-result" />,
                    ])}
                  </colgroup>
                  <thead>
                    <tr className="attendance-main-head-row">
                      <th rowSpan={2}>م</th>
                      <th rowSpan={2}>الفرع</th>
                      <th rowSpan={2}>الاسم</th>
                      {periodHeaders.map((header) => <th key={`${group.date}-${header}-group`} colSpan={3}>{header}</th>)}
                    </tr>
                    <tr className="attendance-sub-head-row">
                      {periodHeaders.flatMap((header) => [
                        <th key={`${group.date}-${header}-in`}>الحضور</th>,
                        <th key={`${group.date}-${header}-out`}>الانصراف</th>,
                        <th key={`${group.date}-${header}-result`}>النتيجة</th>,
                      ])}
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row, index) => (
                      <tr key={`${row.userId}:${row.date}`}>
                        <td>{index + 1}</td>
                        <td>{row.branch}</td>
                        <td className="attendance-name-cell">
                          <strong>{row.name}</strong>
                          {row.employeeNo ? <small>{row.employeeNo}</small> : null}
                        </td>
                        {periodHeaders.flatMap((_, periodIndex) => {
                          const period = row.periods[periodIndex];
                          const delay = Math.max(0, Number(period?.delayMinutes || 0));
                          const hasCheckIn = Boolean(period?.checkIn);
                          return [
                            <td key={`${row.userId}:${row.date}:${periodIndex}:in`} className="attendance-time-cell-plain">
                              {period?.checkIn ? (period.checkInText || formatAttendanceTime(period.checkIn)) : "—"}
                            </td>,
                            <td key={`${row.userId}:${row.date}:${periodIndex}:out`} className="attendance-time-cell-plain">
                              {period?.checkOut ? (period.checkOutText || formatAttendanceTime(period.checkOut)) : "—"}
                              {period?.checkoutSource === "auto" ? <small>تلقائي</small> : null}
                            </td>,
                            <td key={`${row.userId}:${row.date}:${periodIndex}:result`} className={`attendance-delay-result ${hasCheckIn ? (delay > 0 ? "late" : "on-time") : "status"}`}>
                              {hasCheckIn ? <strong>{delay} دقيقة</strong> : <strong>{missingResultLabel(period?.result)}</strong>}
                            </td>,
                          ];
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {!reportLoading && !report?.rows?.length ? (
            <div className="attendance-empty-report" style={{ gridColumn: "1 / -1" }}>لا توجد نتائج مطابقة للفلاتر.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
