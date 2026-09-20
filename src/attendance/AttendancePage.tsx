import { useEffect, useMemo, useState } from "react";
import { CaretDown, Export, WarningCircle } from "@phosphor-icons/react";
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

type AdminBranch = { id: string; code?: string | null; name: string };

type AdminPayload = { ok: true; users: AdminUser[]; branches: AdminBranch[] };

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

function groupReportRows(rows: ReportRow[]) {
  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    if (!groups.has(row.date)) groups.set(row.date, []);
    groups.get(row.date)!.push(row);
  }
  return Array.from(groups.entries()).map(([date, grouped]) => ({ date, rows: grouped }));
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildExcelDocument(payload: ReportPayload) {
  const groups = groupReportRows(payload.rows);
  const headers = payload.periodHeaders || [];
  const dayTables = groups.map((group) => {
    const topHeaders = headers.map((header) => `<th colspan="3">${escapeHtml(header)}</th>`).join("");
    const subHeaders = headers.map(() => "<th>الحضور</th><th>الانصراف</th><th>النتيجة</th>").join("");
    const rows = group.rows.map((row, rowIndex) => {
      const periodCells = headers.map((_, periodIndex) => {
        const period = row.periods[periodIndex];
        const delay = Math.max(0, Number(period?.delayMinutes || 0));
        const hasCheckIn = Boolean(period?.checkIn);
        const result = hasCheckIn ? `${delay} دقيقة` : missingResultLabel(period?.result);
        const resultClass = hasCheckIn ? (delay > 0 ? "late" : "ontime") : "status";
        const checkIn = period?.checkIn ? (period.checkInText || formatAttendanceTime(period.checkIn)) : "—";
        const checkOut = period?.checkOut ? (period.checkOutText || formatAttendanceTime(period.checkOut)) : "—";
        return `<td>${escapeHtml(checkIn)}</td><td>${escapeHtml(checkOut)}</td><td class="${resultClass}">${escapeHtml(result)}</td>`;
      }).join("");
      return `<tr><td>${rowIndex + 1}</td><td>${escapeHtml(row.branch)}</td><td>${escapeHtml(row.name)}</td>${periodCells}</tr>`;
    }).join("");

    return `<section class="day"><h3>${escapeHtml(formatAttendanceDay(group.date))} ${escapeHtml(formatAttendanceDate(group.date))}</h3><table><thead><tr><th rowspan="2">م</th><th rowspan="2">الفرع</th><th rowspan="2">الاسم</th>${topHeaders}</tr><tr>${subHeaders}</tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join("");

  return `<!doctype html>
<html dir="rtl">
<head>
<meta charset="utf-8">
<style>
body{font-family:Arial,sans-serif;direction:rtl;color:#3e2c26}
.day{margin:0 0 18px}
h3{margin:0 0 8px;font-size:15px}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
th,td{border:1px solid #d9cbc4;padding:7px;text-align:center;font-size:11px}
th{background:#f3e8e2;font-weight:700}
.late{background:#fff0ed;color:#b22d22;font-weight:700}
.ontime{background:#eff8f0;color:#2f7540;font-weight:700}
.status{background:#f8f5f3;color:#7b675f;font-weight:700}
</style>
</head>
<body>${dayTables}</body>
</html>`;
}

export function AttendancePage() {
  const { user } = useAuth();
  const isAdmin = hasPermission(user, "platform.superadmin");
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminBranches, setAdminBranches] = useState<AdminBranch[]>([]);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [branchId, setBranchId] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportExporting, setReportExporting] = useState(false);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");

  const filteredEmployees = useMemo(() => {
    const search = employeeSearch.trim().toLocaleLowerCase("ar-SA");
    if (!search) return adminUsers;
    return adminUsers.filter((employee) => [employee.full_name, employee.employee_no, employee.branch_name]
      .some((value) => String(value || "").toLocaleLowerCase("ar-SA").includes(search)));
  }, [adminUsers, employeeSearch]);

  const groupedRows = useMemo(() => groupReportRows(report?.rows || []), [report?.rows]);

  async function loadAdminUsers() {
    if (!isAdmin) return;
    try {
      const payload = await attendanceFetch<AdminPayload>("/api/attendance?view=admin");
      setAdminUsers(payload.users || []);
      setAdminBranches(payload.branches || []);
    } catch {
      setAdminUsers([]);
      setAdminBranches([]);
    }
  }

  async function fetchReportPayload(nextFrom = from, nextTo = to, nextEmployees = employeeIds, nextBranchId = branchId) {
    const params = new URLSearchParams({ view: "report" });
    if (nextFrom) params.set("from", nextFrom);
    if (nextTo) params.set("to", nextTo);
    if (nextEmployees.length) params.set("employeeIds", nextEmployees.join(","));
    if (nextBranchId) params.set("branchId", nextBranchId);
    return attendanceFetch<ReportPayload>(`/api/attendance?${params.toString()}`);
  }

  async function loadReport(nextFrom = from, nextTo = to, nextEmployees = employeeIds, nextBranchId = branchId) {
    if (!isAdmin) return;
    setReportLoading(true);
    setError("");
    try {
      const payload = await fetchReportPayload(nextFrom, nextTo, nextEmployees, nextBranchId);
      setReport(payload);
      setCollapsedDays(new Set());
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

  async function exportExcel() {
    if (!isAdmin || reportExporting) return;
    setReportExporting(true);
    setError("");
    try {
      const payload = await fetchReportPayload(from, to, employeeIds, branchId);
      setReport(payload);
      setCollapsedDays(new Set());

      if (!payload.rows.length) {
        setError("لا توجد نتائج مطابقة للفلاتر.");
        return;
      }

      const html = buildExcelDocument(payload);
      const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `attendance-report-${payload.from || "all"}-${payload.to || "all"}.xls`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "تعذر تصدير التقرير");
    } finally {
      setReportExporting(false);
    }
  }

  function toggleEmployee(employeeId: string) {
    setEmployeeIds((current) => current.includes(employeeId)
      ? current.filter((id) => id !== employeeId)
      : [...current, employeeId]);
  }

  function toggleDay(date: string) {
    setCollapsedDays((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
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
        </div>
      </div>

      {error ? <div className="attendance-alert error"><WarningCircle size={19} /><span>{error}</span></div> : null}

      <section className="panel attendance-report-card attendance-report-card-v91">
        <div className="attendance-report-toolbar">
          <button className="secondary-button" type="button" onClick={() => void exportExcel()} disabled={reportExporting || reportLoading}>
            <Export size={18} /> {reportExporting ? "جاري التصدير..." : "تصدير Excel"}
          </button>
        </div>

        <form className="attendance-report-filters" onSubmit={(event) => { event.preventDefault(); void loadReport(); }}>
          <label>
            <span>من تاريخ</span>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            <span>إلى تاريخ</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label>
            <span>الفرع</span>
            <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">كل الفروع</option>
              {adminBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
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
                        <small>{employee.branch_name || ""}</small>
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

        <div className="attendance-day-groups">
          {groupedRows.map((group, groupIndex) => {
            const isCollapsed = collapsedDays.has(group.date);
            return (
              <section className={`attendance-day-block day-tone-${groupIndex % 8}${isCollapsed ? " is-collapsed" : ""}`} key={group.date}>
                <header className="attendance-day-title">
                  <button
                    type="button"
                    className="attendance-day-toggle"
                    onClick={() => toggleDay(group.date)}
                    aria-expanded={!isCollapsed}
                  >
                    <strong>{formatAttendanceDay(group.date)} {formatAttendanceDate(group.date)}</strong>
                    <CaretDown size={18} weight="bold" />
                  </button>
                </header>
                {!isCollapsed ? (
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
                ) : null}
              </section>
            );
          })}
          {!reportLoading && !report?.rows?.length ? (
            <div className="attendance-empty-report" style={{ gridColumn: "1 / -1" }}>لا توجد نتائج مطابقة للفلاتر.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
