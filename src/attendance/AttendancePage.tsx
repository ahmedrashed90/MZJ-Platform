import { useEffect, useMemo, useState } from "react";
import { CaretDown, Export, FilePdf, WarningCircle } from "@phosphor-icons/react";
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

type ReportPermission = {
  id: string;
  fromAt: string;
  toAt: string;
  fromText: string;
  toText: string;
  authorizedAt: string;
  permissionType: 'departure' | 'vacation' | 'exceptional';
  reason: string;
  periodId: string;
  periodName: string;
};

type ReportPeriod = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  checkIn: string | null;
  checkOut: string | null;
  checkInText: string;
  checkOutText: string;
  checkoutSource: string | null;
  earlyDepartureFrom: string | null;
  earlyDepartureTo: string | null;
  earlyDepartureFromText: string;
  earlyDepartureToText: string;
  result: string;
  delayMinutes: number;
  workMinutes: number;
  creditedMinutes?: number;
  permission?: Pick<ReportPermission, 'id' | 'permissionType' | 'reason'> | null;
};

type ReportRow = {
  date: string;
  branch: string;
  userId: string;
  employeeNo: string | null;
  name: string;
  scheduleName: string | null;
  isDayOff: boolean;
  earlyDeparturePermission: ReportPermission | null;
  earlyDeparturePermissions: ReportPermission[];
  periods: Array<ReportPeriod | null>;
};

type PermissionShift = { periodId: string; name: string; startTime: string; endTime: string };
type PermissionEntry = { periodId: string; fromTime: string; toTime: string; permissionType: "departure" | "vacation" | "exceptional" | ""; reason: string };

type ReportPayload = {
  ok: true;
  from: string;
  to: string;
  today: string;
  officialDayEnd: string;
  rows: ReportRow[];
  periodHeaders: string[];
};

function missingResultLabel(result: string | null | undefined) {
  const value = String(result || "");
  if (value.includes("إجازة")) return "إجازة";
  if (value.includes("إذن استثنائي")) return "إذن استثنائي";
  if (value.includes("إذن انصراف")) return "إذن انصراف";
  if (value.includes("غائب")) return "غائب";
  if (value.includes("لم يسجل")) return "لم يسجل";
  return "—";
}

function formatDurationMinutes(value: unknown) {
  const minutes = Math.max(0, Math.round(Number(value || 0)));
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} ساعة و ${remainder} دقيقة` : `${hours} ساعة`;
}

function riyadhTimeNow() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
}

function riyadhDateToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function clockMinutes(value: string) {
  const [hour, minute] = String(value || "").split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : -1;
}

function permissionTypeLabel(type: ReportPermission['permissionType']) {
  if (type === 'vacation') return 'إجازة';
  if (type === 'exceptional') return 'إذن استثنائي';
  return 'إذن انصراف';
}

function reportPermissions(row: ReportRow): ReportPermission[] {
  return row.earlyDeparturePermissions?.length
    ? row.earlyDeparturePermissions
    : row.earlyDeparturePermission ? [row.earlyDeparturePermission] : [];
}

function EarlyPermissionCell({ row, saving, onDelete }: {
  row: ReportRow; saving: boolean; onDelete: (id: string) => void;
}) {
  const permissions = reportPermissions(row);
  if (!permissions.length) return <td className="attendance-early-departure-cell"><span className="attendance-early-departure-empty">{row.periods.some(period => period?.checkoutSource === 'authorized') ? 'إذن انصراف' : '—'}</span></td>;
  return <td className="attendance-early-departure-cell"><div className="attendance-permission-items">
    {permissions.map(permission => <div className="attendance-permission-item" key={permission.id}>
      <span className="attendance-early-departure-done" title={permission.reason}>{permissionTypeLabel(permission.permissionType)} <small>({permission.periodName || 'الدوام'})</small></span>
      <button type="button" className="attendance-permission-delete" title={`حذف ${permissionTypeLabel(permission.permissionType)} - ${permission.periodName || 'الدوام'}`} disabled={saving} onClick={() => onDelete(permission.id)}>حذف</button>
    </div>)}
  </div></td>;
}

function periodResultLabel(period: ReportPeriod | null, delay: number) {
  if (!period) return '—';
  if (period.permission?.permissionType === 'vacation') return 'إجازة';
  if (period.permission?.permissionType === 'exceptional') return period.checkIn ? `${formatDurationMinutes(delay)} • إذن استثنائي` : 'إذن استثنائي';
  if (period.checkoutSource === 'authorized' || (!period.checkIn && period.permission?.permissionType === 'departure')) return 'إذن انصراف';
  return period.checkIn ? formatDurationMinutes(delay) : missingResultLabel(period.result);
}

function scheduledMinutes(period: ReportPeriod | null) {
  if (!period?.startTime || !period?.endTime) return 0;
  const from = clockMinutes(period.startTime), to = clockMinutes(period.endTime);
  return from >= 0 && to >= 0 ? (to >= from ? to - from : 24 * 60 - from + to) : 0;
}

// Attendance hours are credited by the server for each scheduled period.
// That calculation already accounts for per-period grace, early exits and
// the exact approved authorization interval without double counting.
// Approved vacation and exceptional hours are credited; weekly rest stays excluded.
function attendanceHourTotals(rows: ReportRow[]) {
  return rows.reduce((total, row) => {
    if (row.isDayOff) return total;
    const periods = row.periods.filter((period): period is ReportPeriod => Boolean(period));
    for (const period of periods) {
      total.expected += scheduledMinutes(period);
      total.actual += Math.max(0, Math.round(Number(period.creditedMinutes ?? period.workMinutes ?? 0)));
    }
    return total;
  }, { expected: 0, actual: 0 });
}

function wholeHoursText(minutes: number) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  return value ? formatDurationMinutes(value) : '—';
}

// Required duration minus credited attendance and authorized shift minutes.
function hoursDifferenceText(expectedMinutes: number, actualMinutes: number) {
  const delta = Math.round(Number(expectedMinutes || 0) - Number(actualMinutes || 0));
  if (!delta) return '—';
  return `${delta > 0 ? '+' : '−'}${formatDurationMinutes(Math.abs(delta))}`;
}

function groupReportRows(rows: ReportRow[]) {
  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    if (!groups.has(row.date)) groups.set(row.date, []);
    groups.get(row.date)!.push(row);
  }
  return Array.from(groups.entries()).map(([date, grouped]) => ({ date, rows: grouped }));
}

function groupReportRowsByEmployee(rows: ReportRow[]) {
  const groups = new Map<string, { userId: string; name: string; branch: string; rows: ReportRow[] }>();
  for (const row of rows) {
    const current = groups.get(row.userId) || { userId: row.userId, name: row.name, branch: row.branch, rows: [] };
    current.name = row.name;
    current.branch = row.branch;
    current.rows.push(row);
    groups.set(row.userId, current);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, rows: group.rows.slice().sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

function excelXmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function htmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function exportPeriods(row: ReportRow) {
  return row.periods.filter((period): period is ReportPeriod => Boolean(period)).slice(0, 2);
}

function exportCheckIn(period: ReportPeriod | undefined) {
  if (!period?.checkIn) return "—";
  return period.checkInText || formatAttendanceTime(period.checkIn);
}

function exportCheckOut(period: ReportPeriod | undefined) {
  if (!period?.checkOut) return "—";
  const time = period.checkOutText || formatAttendanceTime(period.checkOut);
  if (period.checkoutSource === "authorized") return `${time} - إذن مبكر`;
  return period.checkoutSource === "auto" ? `${time} - تلقائي` : time;
}

function exportRowsByEmployee(payload: ReportPayload) {
  const map = new Map<string, { userId: string; name: string; employeeNo: string | null; branch: string; rows: ReportRow[] }>();
  for (const row of payload.rows) {
    const current = map.get(row.userId) || { userId: row.userId, name: row.name, employeeNo: row.employeeNo, branch: row.branch, rows: [] };
    current.name = row.name;
    current.employeeNo = row.employeeNo;
    current.branch = row.branch;
    current.rows.push(row);
    map.set(row.userId, current);
  }
  return [...map.values()]
    .map((item) => ({ ...item, rows: [...item.rows].sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

function exportDelay(period: ReportPeriod | undefined) {
  if (!period?.checkIn) return "—";
  return formatDurationMinutes(period.delayMinutes);
}

function exportAbsence(period: ReportPeriod | undefined) {
  if (!period) return "—";
  return missingResultLabel(period.result) === "غائب" ? "غائب" : "—";
}

function exportResult(period: ReportPeriod | undefined) {
  if (!period) return "—";
  if (period.permission?.permissionType === 'vacation') return 'إجازة';
  if (period.permission?.permissionType === 'exceptional') return 'إذن استثنائي';
  if (period.checkoutSource === "authorized" || period.permission?.permissionType === 'departure') return 'إذن انصراف';
  if (period.checkIn) return exportDelay(period);
  return missingResultLabel(period.result);
}

function exportFlatRows(payload: ReportPayload) {
  return exportRowsByEmployee(payload).flatMap((employee) => employee.rows.map((row) => ({ employee, row })));
}

const ATTENDANCE_SUMMARY_HEADERS = [
  "م",
  "الفرع",
  "الموظف",
  "اليوم",
  "التاريخ",
  "حضور الفترة الأولى",
  "انصراف الفترة الأولى",
  "تأخير الفترة الأولى",
  "غياب الفترة الأولى",
  "حضور الفترة الثانية",
  "انصراف الفترة الثانية",
  "تأخير الفترة الثانية",
  "غياب الفترة الثانية",
  "ساعات الدوام المفترضة", "ساعات العمل الفعلية", "الفرق (مفترض − فعلي)",
] as const;

const ATTENDANCE_DETAILS_HEADERS = [
  "م",
  "الفرع",
  "الموظف",
  "اليوم",
  "التاريخ",
  "حضور الفترة الأولى",
  "انصراف الفترة الأولى",
  "تأخير الفترة الأولى",
  "غياب الفترة الأولى",
  "نتيجة الفترة الأولى",
  "حضور الفترة الثانية",
  "انصراف الفترة الثانية",
  "تأخير الفترة الثانية",
  "غياب الفترة الثانية",
  "نتيجة الفترة الثانية",
  "ساعات الدوام المفترضة", "ساعات العمل الفعلية", "الفرق (مفترض − فعلي)",
] as const;

function buildAttendancePdf(payload: ReportPayload) {
  const flatRows = exportFlatRows(payload);
  const summaryRows = flatRows.map(({ employee, row }, index) => {
    const [first, second] = exportPeriods(row);
    const hours = attendanceHourTotals([row]);
    return `<tr><td>${index + 1}</td><td>${htmlEscape(employee.branch || "—")}</td><td>${htmlEscape(employee.name)}</td><td>${htmlEscape(formatAttendanceDay(row.date))}</td><td>${htmlEscape(formatAttendanceDate(row.date))}</td><td>${htmlEscape(exportCheckIn(first))}</td><td>${htmlEscape(exportCheckOut(first))}</td><td>${htmlEscape(exportDelay(first))}</td><td>${htmlEscape(exportAbsence(first))}</td><td>${htmlEscape(exportCheckIn(second))}</td><td>${htmlEscape(exportCheckOut(second))}</td><td>${htmlEscape(exportDelay(second))}</td><td>${htmlEscape(exportAbsence(second))}</td><td>${htmlEscape(wholeHoursText(hours.expected))}</td><td>${htmlEscape(wholeHoursText(hours.actual))}</td><td>${htmlEscape(hoursDifferenceText(hours.expected, hours.actual))}</td></tr>`;
  }).join("");
  const detailRows = flatRows.map(({ employee, row }, index) => {
    const [first, second] = exportPeriods(row);
    const hours = attendanceHourTotals([row]);
    return `<tr><td>${index + 1}</td><td>${htmlEscape(employee.branch || "—")}</td><td>${htmlEscape(employee.name)}</td><td>${htmlEscape(formatAttendanceDay(row.date))}</td><td>${htmlEscape(formatAttendanceDate(row.date))}</td><td>${htmlEscape(exportCheckIn(first))}</td><td>${htmlEscape(exportCheckOut(first))}</td><td>${htmlEscape(exportDelay(first))}</td><td>${htmlEscape(exportAbsence(first))}</td><td>${htmlEscape(exportResult(first))}</td><td>${htmlEscape(exportCheckIn(second))}</td><td>${htmlEscape(exportCheckOut(second))}</td><td>${htmlEscape(exportDelay(second))}</td><td>${htmlEscape(exportAbsence(second))}</td><td>${htmlEscape(exportResult(second))}</td><td>${htmlEscape(wholeHoursText(hours.expected))}</td><td>${htmlEscape(wholeHoursText(hours.actual))}</td><td>${htmlEscape(hoursDifferenceText(hours.expected, hours.actual))}</td></tr>`;
  }).join("");
  const periodLabel = `من ${htmlEscape(formatAttendanceDate(payload.from))} إلى ${htmlEscape(formatAttendanceDate(payload.to))}`;
  const table = (headers: readonly string[], rows: string) => `<table><thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}">لا توجد بيانات</td></tr>`}</tbody></table>`;

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير الحضور والانصراف</title><style>
@page{size:A4 landscape;margin:9mm}
*{box-sizing:border-box}body{margin:0;color:#38231d;background:#fff;font-family:Tajawal,Arial,sans-serif;font-size:9px;line-height:1.45}
.report-section{page-break-after:always;break-after:page}.report-section:last-child{page-break-after:auto;break-after:auto}
.head{padding:11px 14px;border-radius:10px;background:#6d3427;color:#fff;margin-bottom:9px}.head h1{margin:0 0 3px;font-size:17px}.head p{margin:0;opacity:.9}
table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{page-break-inside:avoid}th,td{border:1px solid #dfd0c8;padding:5px 4px;text-align:center;vertical-align:middle;overflow-wrap:anywhere}th{background:#f4e8e1;font-weight:900}tbody tr:nth-child(even) td{background:#fdf9f7}
@media print{.head,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<section class="report-section"><div class="head"><h1>تقرير الحضور والانصراف - ملخص الفترة</h1><p>${periodLabel}</p></div>${table(ATTENDANCE_SUMMARY_HEADERS, summaryRows)}</section>
<section class="report-section"><div class="head"><h1>تقرير الحضور والانصراف - تقرير تفصيلي</h1><p>${periodLabel}</p></div>${table(ATTENDANCE_DETAILS_HEADERS, detailRows)}</section>
<script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`;
}

function buildExcelDocument(payload: ReportPayload) {
  const flatRows = exportFlatRows(payload);
  const cell = (value: unknown, style = "Cell") => `<Cell ss:StyleID="${style}"><Data ss:Type="String">${excelXmlEscape(value)}</Data></Cell>`;
  const merged = (value: string, style: string, columns: number) => `<Row ss:Height="28"><Cell ss:StyleID="${style}" ss:MergeAcross="${Math.max(0, columns - 1)}"><Data ss:Type="String">${excelXmlEscape(value)}</Data></Cell></Row>`;
  const worksheet = (name: string, headers: readonly string[], rows: string) => `
 <Worksheet ss:Name="${excelXmlEscape(name)}"><Table>
  ${Array.from({ length: headers.length }, (_, index) => `<Column ss:Width="${index === 2 ? 145 : index === 1 ? 105 : 95}"/>`).join("")}
  ${merged(`تقرير الحضور والانصراف - ${name}`, "Title", headers.length)}
  ${merged(`من ${formatAttendanceDate(payload.from)} إلى ${formatAttendanceDate(payload.to)}`, "SubTitle", headers.length)}
  <Row ss:Height="26">${headers.map((header) => cell(header, "Header")).join("")}</Row>
  ${rows || `<Row>${cell("لا توجد بيانات")}</Row>`}
 </Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions></Worksheet>`;

  const summaryRows = flatRows.map(({ employee, row }, index) => {
    const [first, second] = exportPeriods(row);
    const hours = attendanceHourTotals([row]);
    return `<Row>${[
      cell(index + 1),
      cell(employee.branch || "—"),
      cell(employee.name),
      cell(formatAttendanceDay(row.date)),
      cell(formatAttendanceDate(row.date)),
      cell(exportCheckIn(first)),
      cell(exportCheckOut(first)),
      cell(exportDelay(first)),
      cell(exportAbsence(first)),
      cell(exportCheckIn(second)),
      cell(exportCheckOut(second)),
      cell(exportDelay(second)),
      cell(exportAbsence(second)),
      cell(wholeHoursText(hours.expected)), cell(wholeHoursText(hours.actual)),
      cell(hoursDifferenceText(hours.expected, hours.actual)),
    ].join("")}</Row>`;
  }).join("");

  const detailRows = flatRows.map(({ employee, row }, index) => {
    const [first, second] = exportPeriods(row);
    const hours = attendanceHourTotals([row]);
    return `<Row>${[
      cell(index + 1),
      cell(employee.branch || "—"),
      cell(employee.name),
      cell(formatAttendanceDay(row.date)),
      cell(formatAttendanceDate(row.date)),
      cell(exportCheckIn(first)),
      cell(exportCheckOut(first)),
      cell(exportDelay(first)),
      cell(exportAbsence(first)),
      cell(exportResult(first)),
      cell(exportCheckIn(second)),
      cell(exportCheckOut(second)),
      cell(exportDelay(second)),
      cell(exportAbsence(second)),
      cell(exportResult(second)),
      cell(wholeHoursText(hours.expected)), cell(wholeHoursText(hours.actual)),
      cell(hoursDifferenceText(hours.expected, hours.actual)),
    ].join("")}</Row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center" ss:Horizontal="Center"/><Font ss:FontName="Arial" ss:Size="10"/></Style>
  <Style ss:ID="Cell" ss:Parent="Default"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4D6CE"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4D6CE"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4D6CE"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4D6CE"/></Borders></Style>
  <Style ss:ID="Title" ss:Parent="Default"><Font ss:FontName="Arial" ss:Size="16" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#6D3427" ss:Pattern="Solid"/></Style>
  <Style ss:ID="SubTitle" ss:Parent="Default"><Font ss:FontName="Arial" ss:Size="11" ss:Bold="1" ss:Color="#6D3427"/><Interior ss:Color="#F7EEE9" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Header" ss:Parent="Cell"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#4A2B22"/><Interior ss:Color="#EAD8CC" ss:Pattern="Solid"/></Style>
 </Styles>
 ${worksheet("ملخص الفترة", ATTENDANCE_SUMMARY_HEADERS, summaryRows)}
 ${worksheet("تقرير تفصيلي", ATTENDANCE_DETAILS_HEADERS, detailRows)}
 
</Workbook>`;
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
  const [earlyDepartureSaving, setEarlyDepartureSaving] = useState(false);
  const [permissionShifts, setPermissionShifts] = useState<Record<string, PermissionShift[]>>({});
  const [permissionShiftsLoading, setPermissionShiftsLoading] = useState(false);
  const [permissionShiftsError, setPermissionShiftsError] = useState("");
  const [earlyDepartureDialog, setEarlyDepartureDialog] = useState<{
    workDate: string;
    userSearch: string;
    entries: Record<string, PermissionEntry>;
  } | null>(null);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const filteredEmployees = useMemo(() => {
    const search = employeeSearch.trim().toLocaleLowerCase("ar-SA");
    if (!search) return adminUsers;
    return adminUsers.filter((employee) => [employee.full_name, employee.employee_no, employee.branch_name]
      .some((value) => String(value || "").toLocaleLowerCase("ar-SA").includes(search)));
  }, [adminUsers, employeeSearch]);

  const groupedRows = useMemo(() => groupReportRows(report?.rows || []), [report?.rows]);
  const employeeGroups = useMemo(() => groupReportRowsByEmployee(report?.rows || []), [report?.rows]);
  const showEmployeeBlocks = employeeIds.length > 0 || Boolean(branchId);

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

  const permissionSelectedIds = earlyDepartureDialog ? Object.keys(earlyDepartureDialog.entries).sort().join(",") : "";
  const permissionDate = earlyDepartureDialog?.workDate || "";
  useEffect(() => {
    if (!permissionDate || !permissionSelectedIds) {
      setPermissionShifts({});
      setPermissionShiftsError("");
      setPermissionShiftsLoading(false);
      return;
    }
    let cancelled = false;
    setPermissionShiftsLoading(true);
    setPermissionShiftsError("");
    setPermissionShifts({});
    const timer = window.setTimeout(() => {
      void attendanceFetch<ReportPayload>(`/api/attendance?${new URLSearchParams({
        view: "report", from: permissionDate, to: permissionDate, employeeIds: permissionSelectedIds,
      }).toString()}`).then((payload) => {
        if (cancelled) return;
        const friday = new Date(`${permissionDate}T00:00:00Z`).getUTCDay() === 5;
        const shifts: Record<string, PermissionShift[]> = {};
        for (const userId of permissionSelectedIds.split(",")) {
          const row = payload.rows.find((item) => item.userId === userId && item.date === permissionDate);
          // Only real assigned schedule periods are selectable. Historical orphan
          // attendance records must not create an artificial permission shift.
          shifts[userId] = (row?.scheduleName ? row.periods : []).filter((period): period is ReportPeriod => Boolean(period))
            .filter((period) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(period.id)
              && clockMinutes(period.startTime) >= 0 && clockMinutes(period.endTime) > clockMinutes(period.startTime))
            .map((period) => ({
              periodId: friday && period.name === "الفترة المسائية" ? "friday" : period.id,
              name: period.name, startTime: period.startTime, endTime: period.endTime,
            }));
        }
        setPermissionShifts(shifts);
      }).catch((failure) => {
        if (!cancelled) setPermissionShiftsError(failure instanceof Error ? failure.message : "تعذر تحميل فترات الدوام");
      }).finally(() => { if (!cancelled) setPermissionShiftsLoading(false); });
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [permissionDate, permissionSelectedIds]);

  function openEarlyDepartureDialog() {
    if (!isAdmin || earlyDepartureSaving) return;
    setError("");
    setMessage("");
    setEarlyDepartureDialog({ workDate: report?.today || riyadhDateToday(), userSearch: "", entries: {} });
  }

  function toggleEarlyDepartureUser(userId: string) {
    setEarlyDepartureDialog((current) => {
      if (!current) return current;
      const entries = { ...current.entries };
      if (entries[userId]) delete entries[userId];
      else entries[userId] = { periodId: "", fromTime: "", toTime: "", permissionType: "", reason: "" };
      return { ...current, entries };
    });
  }

  function selectEarlyDeparturePeriod(userId: string, periodId: string) {
    const shift = (permissionShifts[userId] || []).find((item) => item.periodId === periodId);
    const now = riyadhTimeNow();
    const today = riyadhDateToday();
    const fromTime = shift && today === permissionDate
      && clockMinutes(now) >= clockMinutes(shift.startTime)
      && clockMinutes(now) < clockMinutes(shift.endTime) ? now : shift?.startTime || "";
    setEarlyDepartureDialog((current) => {
      if (!current?.entries[userId]) return current;
      return {
        ...current,
        entries: {
          ...current.entries,
          [userId]: {
            ...current.entries[userId],
            periodId,
            fromTime: current.entries[userId].permissionType === 'vacation' ? shift?.startTime || '' : fromTime,
            toTime: shift?.endTime || "",
          },
        },
      };
    });
  }

  function updateEarlyDepartureEntry(userId: string, field: "fromTime" | "toTime" | "permissionType" | "reason", value: string) {
    setEarlyDepartureDialog((current) => {
      if (!current?.entries[userId]) return current;
      const entry = { ...current.entries[userId], [field]: value };
      if (field === 'permissionType' && value === 'vacation') {
        const shift = (permissionShifts[userId] || []).find(item => item.periodId === entry.periodId);
        if (shift) { entry.fromTime = shift.startTime; entry.toTime = shift.endTime; }
      }
      return { ...current, entries: { ...current.entries, [userId]: entry } };
    });
  }

  async function authorizeEarlyDeparture() {
    if (!isAdmin || earlyDepartureSaving || !earlyDepartureDialog) return;
    const items = (Object.entries(earlyDepartureDialog.entries) as Array<[string, PermissionEntry]>).map(([userId, value]) => ({ userId, ...value }));
    if (!items.length) {
      setError("اختر مستخدمًا واحدًا على الأقل لتسجيل الإذن");
      return;
    }
    if (permissionShiftsLoading || permissionShiftsError || items.some((item) => !(permissionShifts[item.userId] || []).some((shift) => shift.periodId === item.periodId))) {
      setError("اختر فترة الدوام الصحيحة لكل موظف بعد تحميل فترات اليوم");
      return;
    }
    if (items.some(item => !item.permissionType || !item.reason.trim())) {
      setError('حدد نوع الإذن واكتب السبب لكل موظف'); return;
    }
    if (items.some((item) => {
      const shift = (permissionShifts[item.userId] || []).find((option) => option.periodId === item.periodId);
      return !shift || !item.fromTime || !item.toTime || clockMinutes(item.toTime) <= clockMinutes(item.fromTime)
        || clockMinutes(item.fromTime) < clockMinutes(shift.startTime)
        || clockMinutes(item.toTime) > clockMinutes(shift.endTime);
    })) {
      setError("راجع أوقات الإذن: لازم تكون داخل الفترة التي اخترتها لكل موظف");
      return;
    }
    setEarlyDepartureSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await attendanceFetch<{ ok: true; message: string }>("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ action: "authorize_early_departure", workDate: earlyDepartureDialog.workDate, items }),
      });
      setMessage(result.message || "تم حفظ الإذن");
      setEarlyDepartureDialog(null);
      await loadReport();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تسجيل الإذن");
    } finally {
      setEarlyDepartureSaving(false);
    }
  }

  async function deletePermission(permissionId: string) {
    if (!isAdmin || earlyDepartureSaving || !window.confirm('حذف الإذن المسجل؟ سيتم إلغاء أي انصراف تلقائي مرتبط بهذا الإذن فقط.')) return;
    setEarlyDepartureSaving(true); setError(''); setMessage('');
    try {
      const result = await attendanceFetch<{ ok: true; message: string }>('/api/attendance', {
        method: 'POST',body: JSON.stringify({ action: 'delete_early_departure_permission', permissionId }),
      });
      setMessage(result.message || 'تم حذف الإذن');
      await loadReport();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر حذف الإذن'); }
    finally { setEarlyDepartureSaving(false); }
  }

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

  async function exportPdf() {
    if (!isAdmin || reportExporting) return;
    setReportExporting(true);
    setError("");
    try {
      const payload = await fetchReportPayload(from, to, employeeIds, branchId);
      setReport(payload);
      if (!payload.rows.length) {
        setError("لا توجد نتائج مطابقة للفلاتر.");
        return;
      }
      const win = window.open("", "_blank", "width=1400,height=900");
      if (!win) {
        setError("تعذر فتح نافذة تصدير PDF. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.");
        return;
      }
      win.document.open();
      win.document.write(buildAttendancePdf(payload));
      win.document.close();
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "تعذر تصدير التقرير PDF");
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
      {message ? <div className="attendance-alert success"><span>{message}</span></div> : null}

      <section className="panel attendance-report-card attendance-report-card-v91">
        <div className="attendance-report-toolbar">
          <button className="secondary-button" type="button" onClick={() => void exportExcel()} disabled={reportExporting || reportLoading}>
            <Export size={18} /> {reportExporting ? "جاري التصدير..." : "تصدير Excel"}
          </button>
          <button className="secondary-button" type="button" onClick={() => void exportPdf()} disabled={reportExporting || reportLoading}>
            <FilePdf size={18} /> {reportExporting ? "جاري التجهيز..." : "تصدير PDF"}
          </button>
          <button className="secondary-button attendance-early-departure-toolbar-button" type="button" onClick={openEarlyDepartureDialog} disabled={earlyDepartureSaving || reportLoading}>
            إذن مبكر
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
          {showEmployeeBlocks ? employeeGroups.map((employee, groupIndex) => (
            <section className={`attendance-day-block attendance-employee-block day-tone-${groupIndex % 8}`} key={employee.userId}>
              <header className="attendance-day-title attendance-employee-title">
                <div>
                  <strong>{employee.name}</strong>
                  <small>{employee.branch || "—"} • {employee.rows.length} يوم</small>
                </div>
              </header>
              <div className="attendance-day-table-wrap">
                <table className={`attendance-report-table attendance-report-table-compact attendance-day-table periods-${Math.min(periodHeaders.length, 4)}`}>
                  <colgroup>
                    <col className="attendance-col-index" />
                    <col className="attendance-col-day" />
                    <col className="attendance-col-date" />
                    <col className="attendance-col-action" />
                    {periodHeaders.flatMap((header) => [
                      <col key={`${employee.userId}-${header}-col-in`} className="attendance-col-period-time" />,
                      <col key={`${employee.userId}-${header}-col-out`} className="attendance-col-period-time" />,
                      <col key={`${employee.userId}-${header}-col-result`} className="attendance-col-period-result" />,
                    ])}
                    <col className="attendance-col-period-result" /><col className="attendance-col-period-result" /><col className="attendance-col-period-result" />
                  </colgroup>
                  <thead>
                    <tr className="attendance-main-head-row">
                      <th rowSpan={2}>م</th>
                      <th rowSpan={2}>اليوم</th>
                      <th rowSpan={2}>التاريخ</th>
                      <th rowSpan={2}>إذن الانصراف</th>
                      {periodHeaders.map((header) => <th key={`${employee.userId}-${header}-group`} colSpan={3}>{header}</th>)}
                      <th rowSpan={2}>ساعات الدوام المفترضة</th>
                      <th rowSpan={2}>ساعات العمل الفعلية</th>
                      <th rowSpan={2}>الفرق (مفترض − فعلي)</th>
                    </tr>
                    <tr className="attendance-sub-head-row">
                      {periodHeaders.flatMap((header) => [
                        <th key={`${employee.userId}-${header}-in`}>الحضور</th>,
                        <th key={`${employee.userId}-${header}-out`}>الانصراف</th>,
                        <th key={`${employee.userId}-${header}-result`}>النتيجة</th>,
                      ])}
                    </tr>
                  </thead>
                  <tbody>
                    {employee.rows.map((row, index) => (
                      <tr key={`${row.userId}:${row.date}`}>
                        <td>{index + 1}</td>
                        <td>{formatAttendanceDay(row.date)}</td>
                        <td>{formatAttendanceDate(row.date)}</td>
                        <EarlyPermissionCell row={row} saving={earlyDepartureSaving} onDelete={(id) => void deletePermission(id)} />
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
                              {period?.checkoutSource === "authorized" ? <small>إذن مبكر</small> : period?.checkoutSource === "auto" ? <small>تلقائي</small> : null}
                            </td>,
                            <td key={`${row.userId}:${row.date}:${periodIndex}:result`} className={`attendance-delay-result ${hasCheckIn ? (delay > 0 ? "late" : "on-time") : "status"}`}>
                              <strong>{periodResultLabel(period, delay)}</strong>
                            </td>,
                          ];
                        })}
                        {(() => { const hours = attendanceHourTotals([row]); return <><td>{wholeHoursText(hours.expected)}</td><td>{wholeHoursText(hours.actual)}</td><td>{hoursDifferenceText(hours.expected, hours.actual)}</td></>; })()}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="attendance-hours-summary-total"><th colSpan={4 + periodHeaders.length * 3}>إجمالي ساعات الموظف (يشمل الإجازات والأذونات المحتسبة؛ باستثناء الراحة الأسبوعية)</th><th>{wholeHoursText(attendanceHourTotals(employee.rows).expected)}</th><th>{wholeHoursText(attendanceHourTotals(employee.rows).actual)}</th><th>{hoursDifferenceText(attendanceHourTotals(employee.rows).expected, attendanceHourTotals(employee.rows).actual)}</th></tr></tfoot>
                </table>
              </div>
            </section>
          )) : groupedRows.map((group, groupIndex) => {
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
                        <col className="attendance-col-action" />
                        {periodHeaders.flatMap((header) => [
                          <col key={`${group.date}-${header}-col-in`} className="attendance-col-period-time" />,
                          <col key={`${group.date}-${header}-col-out`} className="attendance-col-period-time" />,
                          <col key={`${group.date}-${header}-col-result`} className="attendance-col-period-result" />,
                        ])}
                        <col className="attendance-col-period-result" /><col className="attendance-col-period-result" /><col className="attendance-col-period-result" />
                      </colgroup>
                      <thead>
                        <tr className="attendance-main-head-row">
                          <th rowSpan={2}>م</th>
                          <th rowSpan={2}>الفرع</th>
                          <th rowSpan={2}>الاسم</th>
                          <th rowSpan={2}>إذن الانصراف</th>
                          {periodHeaders.map((header) => <th key={`${group.date}-${header}-group`} colSpan={3}>{header}</th>)}
                          <th rowSpan={2}>ساعات الدوام المفترضة</th>
                          <th rowSpan={2}>ساعات العمل الفعلية</th>
                          <th rowSpan={2}>الفرق (مفترض − فعلي)</th>
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
                            <td className="attendance-name-cell"><strong>{row.name}</strong></td>
                            <EarlyPermissionCell row={row} saving={earlyDepartureSaving} onDelete={(id) => void deletePermission(id)} />
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
                                  {period?.checkoutSource === "authorized" ? <small>إذن مبكر</small> : period?.checkoutSource === "auto" ? <small>تلقائي</small> : null}
                                </td>,
                                <td key={`${row.userId}:${row.date}:${periodIndex}:result`} className={`attendance-delay-result ${hasCheckIn ? (delay > 0 ? "late" : "on-time") : "status"}`}>
                                  <strong>{periodResultLabel(period, delay)}</strong>
                                </td>,
                              ];
                            })}
                            {(() => { const hours = attendanceHourTotals([row]); return <><td>{wholeHoursText(hours.expected)}</td><td>{wholeHoursText(hours.actual)}</td><td>{hoursDifferenceText(hours.expected, hours.actual)}</td></>; })()}
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

      {earlyDepartureDialog ? (
        <div className="attendance-permission-backdrop" onMouseDown={() => !earlyDepartureSaving && setEarlyDepartureDialog(null)}>
          <div className="attendance-permission-dialog attendance-permission-dialog-wide" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><h2>أذونات الحضور والانصراف والإجازات</h2><p>حدد نوع الإذن والسبب وفترة دوام الموظف. الإجازة تحتسب كامل الفترة، والإذن الاستثنائي يحتسب الوقت المحدد.</p></div>
              <button type="button" onClick={() => setEarlyDepartureDialog(null)} disabled={earlyDepartureSaving}>×</button>
            </header>
            <div className="attendance-permission-date-row">
              <label><span>تاريخ الإذن</span><input type="date" value={earlyDepartureDialog.workDate} onChange={(event) => setEarlyDepartureDialog((current) => current ? { ...current, workDate: event.target.value, entries: {} } : current)} /></label>
              <label><span>بحث عن يوزر</span><input type="search" value={earlyDepartureDialog.userSearch} placeholder="الاسم أو رقم الموظف أو الفرع" onChange={(event) => setEarlyDepartureDialog((current) => current ? { ...current, userSearch: event.target.value } : current)} /></label>
            </div>
            <div className="attendance-permission-user-picker">
              {adminUsers.filter((employee) => {
                const search = earlyDepartureDialog.userSearch.trim().toLocaleLowerCase("ar-SA");
                return !search || [employee.full_name, employee.employee_no, employee.branch_name].some((value) => String(value || "").toLocaleLowerCase("ar-SA").includes(search));
              }).map((employee) => (
                <label key={employee.id}>
                  <input type="checkbox" checked={Boolean(earlyDepartureDialog.entries[employee.id])} onChange={() => toggleEarlyDepartureUser(employee.id)} />
                  <span><strong>{employee.full_name}</strong><small>{employee.branch_name || "—"}</small></span>
                </label>
              ))}
            </div>
            {permissionShiftsError ? <div className="attendance-alert error"><WarningCircle size={17}/><span>{permissionShiftsError}</span></div> : null}
            <div className="attendance-permission-user-blocks">
              {(Object.entries(earlyDepartureDialog.entries) as Array<[string, PermissionEntry]>).map(([userId, entry]) => {
                const employee = adminUsers.find((item) => item.id === userId);
                const shifts = permissionShifts[userId] || [];
                const chosen = shifts.find((shift) => shift.periodId === entry.periodId);
                return (
                  <section className="attendance-permission-user-block" key={userId}>
                    <header><div><strong>{employee?.full_name || "المستخدم"}</strong><small>{employee?.branch_name || "—"}</small></div><button type="button" onClick={() => toggleEarlyDepartureUser(userId)} disabled={earlyDepartureSaving}>إزالة</button></header>
                    <div className="attendance-permission-times attendance-permission-shift-times">
                      <label><span>نوع الإذن</span><select aria-label={`نوع الإذن ${employee?.full_name || 'الموظف'}`} required value={entry.permissionType} disabled={earlyDepartureSaving} onChange={(event) => updateEarlyDepartureEntry(userId, 'permissionType', event.target.value)}>
                        <option value="">حدد نوع الإذن</option><option value="departure">إذن انصراف</option><option value="vacation">إجازة</option><option value="exceptional">إذن استثنائي</option>
                      </select></label>
                      <label><span>فترة الدوام</span><select aria-label={`فترة دوام ${employee?.full_name || "الموظف"}`} value={entry.periodId} onChange={(event) => selectEarlyDeparturePeriod(userId, event.target.value)} disabled={permissionShiftsLoading || earlyDepartureSaving || !shifts.length}>
                        <option value="">{permissionShiftsLoading ? "جاري تحميل الفترات..." : "اختر الفترة"}</option>
                        {shifts.map((shift) => <option key={shift.periodId} value={shift.periodId}>{shift.name} ({shift.startTime} - {shift.endTime})</option>)}
                      </select></label>
                      <label><span>من الساعة</span><input type="time" value={entry.fromTime} min={chosen?.startTime} max={chosen?.endTime} disabled={!chosen || earlyDepartureSaving || entry.permissionType === 'vacation'} onChange={(event) => updateEarlyDepartureEntry(userId, "fromTime", event.target.value)} /></label>
                      <label><span>إلى الساعة</span><input type="time" value={entry.toTime} min={chosen?.startTime} max={chosen?.endTime} disabled={!chosen || earlyDepartureSaving || entry.permissionType === 'vacation'} onChange={(event) => updateEarlyDepartureEntry(userId, "toTime", event.target.value)} /></label>
                    </div>
                    <label className="attendance-permission-reason"><span>سبب الإذن</span><textarea rows={2} maxLength={1000} required value={entry.reason} disabled={earlyDepartureSaving} placeholder="اكتب سبب الإذن أو الإجازة" onChange={(event) => updateEarlyDepartureEntry(userId, 'reason', event.target.value)} /></label>
                    {chosen ? <small className="attendance-permission-shift-description">الفترة المحددة: {chosen.name} — من {chosen.startTime} إلى {chosen.endTime}</small>
                      : !permissionShiftsLoading && !shifts.length && !permissionShiftsError ? <small className="attendance-permission-shift-warning">لا توجد فترة دوام معيّنة لهذا الموظف في التاريخ المختار</small> : null}
                  </section>
                );
              })}
              {!Object.keys(earlyDepartureDialog.entries).length ? <p className="attendance-permission-empty">اختر يوزر واحدًا أو أكثر من القائمة بالأعلى.</p> : null}
            </div>
            <p className="attendance-permission-note">كل إذن يُحفظ على فترة الدوام المختارة دون استبدال إذن فترة أخرى. إذن الانصراف فقط ينهي البصمة المفتوحة عند بدايته؛ الإجازة تحتسب كامل الفترة، والإذن الاستثنائي يحتسب مدته المحددة دون إنشاء حضور وهمي.</p>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setEarlyDepartureDialog(null)} disabled={earlyDepartureSaving}>إلغاء</button>
              <button type="button" className="attendance-view-button" onClick={() => void authorizeEarlyDeparture()} disabled={earlyDepartureSaving || permissionShiftsLoading || Boolean(permissionShiftsError) || !Object.keys(earlyDepartureDialog.entries).length || Object.entries(earlyDepartureDialog.entries).some(([userId, entry]) => !(permissionShifts[userId] || []).some((shift) => shift.periodId === entry.periodId))}>
                {earlyDepartureSaving ? "جاري الحفظ..." : `حفظ الإذن (${Object.keys(earlyDepartureDialog.entries).length})`}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
