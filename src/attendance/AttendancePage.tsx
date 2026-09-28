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
  today: string;
  officialDayEnd: string;
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

function excelXmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function minutesBetweenTimes(startTime: string, endTime: string) {
  const parse = (value: string) => {
    const [hours, minutes] = String(value || "").slice(0, 5).split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 0;
  };
  const start = parse(startTime);
  const end = parse(endTime);
  return Math.max(0, end - start);
}

function minutesAsHours(minutes: number) {
  const safe = Math.max(0, Math.floor(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${hours}:${String(rest).padStart(2, "0")}`;
}

function attendanceSummary(payload: ReportPayload) {
  const map = new Map<string, {
    userId: string; name: string; branch: string; requiredDays: number; attendanceDays: number;
    absenceDays: number; partialDays: number; offDays: number; requiredPeriods: number;
    attendedPeriods: number; missedPeriods: number; requiredMinutes: number; workMinutes: number; delayMinutes: number;
  }>();

  for (const row of payload.rows) {
    if (row.date > payload.today || !row.scheduleName) continue;
    const periods = row.periods.filter((period): period is ReportPeriod => Boolean(period));
    if (!periods.length) continue;
    const current = map.get(row.userId) || {
      userId: row.userId, name: row.name, branch: row.branch, requiredDays: 0, attendanceDays: 0,
      absenceDays: 0, partialDays: 0, offDays: 0, requiredPeriods: 0, attendedPeriods: 0,
      missedPeriods: 0, requiredMinutes: 0, workMinutes: 0, delayMinutes: 0,
    };
    current.name = row.name;
    current.branch = row.branch;

    const offPeriods = periods.filter((period) => String(period.result || "").includes("إجازة"));
    if (offPeriods.length === periods.length) {
      current.offDays += 1;
      map.set(row.userId, current);
      continue;
    }

    const required = periods.filter((period) => !String(period.result || "").includes("إجازة"));
    const present = required.filter((period) => Boolean(period.checkIn));
    const missed = required.filter((period) => !period.checkIn && String(period.result || "").includes("غائب"));
    current.requiredDays += 1;
    current.requiredPeriods += required.length;
    current.attendedPeriods += present.length;
    current.missedPeriods += missed.length;
    current.requiredMinutes += required.reduce((sum, period) => sum + minutesBetweenTimes(period.startTime, period.endTime), 0);
    current.workMinutes += required.reduce((sum, period) => sum + Math.max(0, Number(period.workMinutes || 0)), 0);
    current.delayMinutes += present.reduce((sum, period) => sum + Math.max(0, Number(period.delayMinutes || 0)), 0);
    if (present.length) current.attendanceDays += 1;
    if (!present.length && missed.length === required.length && required.length) current.absenceDays += 1;
    if (present.length && missed.length) current.partialDays += 1;
    map.set(row.userId, current);
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

function buildExcelDocument(payload: ReportPayload) {
  const summary = attendanceSummary(payload);
  const totalColumns = 15;
  const cell = (value: unknown, style = "Cell", type: "String" | "Number" = "String") =>
    `<Cell ss:StyleID="${style}"><Data ss:Type="${type}">${excelXmlEscape(value)}</Data></Cell>`;
  const blank = (style = "Cell") => cell("", style);
  const mergeTitle = (value: string, style: string) =>
    `<Row ss:Height="30"><Cell ss:StyleID="${style}" ss:MergeAcross="${totalColumns - 1}"><Data ss:Type="String">${excelXmlEscape(value)}</Data></Cell></Row>`;

  const summaryHeaders = [
    "م", "اسم الموظف", "الفرع", "أيام الدوام", "أيام الحضور", "أيام الغياب", "أيام الحضور الجزئي",
    "أيام الإجازة", "الفترات المطلوبة", "الفترات المسجلة", "الفترات الغائبة", "الساعات المطلوبة",
    "ساعات العمل الفعلية", "دقائق التأخير", "نسبة الحضور",
  ];
  const summaryRows = summary.map((row, index) => {
    const rate = row.requiredPeriods ? Math.round((row.attendedPeriods / row.requiredPeriods) * 1000) / 10 : 0;
    const statusStyle = row.absenceDays > 0 ? "Absent" : row.delayMinutes > 0 || row.partialDays > 0 ? "Warning" : "Present";
    return `<Row>${[
      cell(index + 1, "Cell", "Number"), cell(row.name), cell(row.branch),
      cell(row.requiredDays, "Cell", "Number"), cell(row.attendanceDays, "Present", "Number"),
      cell(row.absenceDays, row.absenceDays ? "Absent" : "Cell", "Number"),
      cell(row.partialDays, row.partialDays ? "Warning" : "Cell", "Number"), cell(row.offDays, "Off", "Number"),
      cell(row.requiredPeriods, "Cell", "Number"), cell(row.attendedPeriods, "Present", "Number"),
      cell(row.missedPeriods, row.missedPeriods ? "Absent" : "Cell", "Number"), cell(minutesAsHours(row.requiredMinutes)),
      cell(minutesAsHours(row.workMinutes), statusStyle), cell(row.delayMinutes, row.delayMinutes ? "Late" : "Present", "Number"),
      cell(`${rate}%`, statusStyle),
    ].join("")}</Row>`;
  }).join("");
  const totals = summary.reduce((acc, row) => ({
    requiredDays: acc.requiredDays + row.requiredDays, attendanceDays: acc.attendanceDays + row.attendanceDays,
    absenceDays: acc.absenceDays + row.absenceDays, partialDays: acc.partialDays + row.partialDays, offDays: acc.offDays + row.offDays,
    requiredPeriods: acc.requiredPeriods + row.requiredPeriods, attendedPeriods: acc.attendedPeriods + row.attendedPeriods,
    missedPeriods: acc.missedPeriods + row.missedPeriods, requiredMinutes: acc.requiredMinutes + row.requiredMinutes,
    workMinutes: acc.workMinutes + row.workMinutes, delayMinutes: acc.delayMinutes + row.delayMinutes,
  }), { requiredDays: 0, attendanceDays: 0, absenceDays: 0, partialDays: 0, offDays: 0, requiredPeriods: 0, attendedPeriods: 0, missedPeriods: 0, requiredMinutes: 0, workMinutes: 0, delayMinutes: 0 });
  const totalRate = totals.requiredPeriods ? Math.round((totals.attendedPeriods / totals.requiredPeriods) * 1000) / 10 : 0;
  const totalRow = `<Row>${[
    blank("Total"), cell("الإجمالي", "Total"), blank("Total"), cell(totals.requiredDays, "Total", "Number"),
    cell(totals.attendanceDays, "Total", "Number"), cell(totals.absenceDays, "Total", "Number"),
    cell(totals.partialDays, "Total", "Number"), cell(totals.offDays, "Total", "Number"),
    cell(totals.requiredPeriods, "Total", "Number"), cell(totals.attendedPeriods, "Total", "Number"),
    cell(totals.missedPeriods, "Total", "Number"), cell(minutesAsHours(totals.requiredMinutes), "Total"),
    cell(minutesAsHours(totals.workMinutes), "Total"), cell(totals.delayMinutes, "Total", "Number"), cell(`${totalRate}%`, "Total"),
  ].join("")}</Row>`;

  const detailHeaders = ["التاريخ", "اليوم", "الفرع", "اسم الموظف", "الفترة", "من", "إلى", "الحضور", "الانصراف", "ساعات العمل", "دقائق التأخير", "الحالة"];
  const detailRows = payload.rows.flatMap((row) => row.periods.filter((period): period is ReportPeriod => Boolean(period)).map((period) => {
    const delay = Math.max(0, Number(period.delayMinutes || 0));
    const hasCheckIn = Boolean(period.checkIn);
    const status = hasCheckIn ? (delay > 0 ? "متأخر" : "حاضر") : missingResultLabel(period.result);
    const statusStyle = status === "حاضر" ? "Present" : status === "متأخر" ? "Late" : status === "غائب" ? "Absent" : status === "إجازة" ? "Off" : "Cell";
    return `<Row>${[
      cell(formatAttendanceDate(row.date)), cell(formatAttendanceDay(row.date)), cell(row.branch), cell(row.name), cell(period.name),
      cell(period.startTime), cell(period.endTime), cell(period.checkIn ? (period.checkInText || formatAttendanceTime(period.checkIn)) : "—"),
      cell(period.checkOut ? (period.checkOutText || formatAttendanceTime(period.checkOut)) : "—"), cell(minutesAsHours(period.workMinutes)),
      cell(delay, delay > 0 ? "Late" : "Cell", "Number"), cell(status, statusStyle),
    ].join("")}</Row>`;
  })).join("");

  const summaryCols = [45, 180, 130, 80, 85, 80, 105, 80, 95, 95, 90, 100, 115, 90, 90]
    .map((width) => `<Column ss:Width="${width}"/>`).join("");
  const detailCols = [95, 90, 130, 180, 120, 70, 70, 90, 90, 95, 90, 90]
    .map((width) => `<Column ss:Width="${width}"/>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center" ss:Horizontal="Center"/><Font ss:FontName="Arial" ss:Size="10"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4D6CE"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4D6CE"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4D6CE"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E4D6CE"/></Borders></Style>
  <Style ss:ID="Cell" ss:Parent="Default"><Interior ss:Color="#FFFDFC" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Title" ss:Parent="Default"><Font ss:FontName="Arial" ss:Size="17" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#6D3427" ss:Pattern="Solid"/></Style>
  <Style ss:ID="SubTitle" ss:Parent="Default"><Font ss:FontName="Arial" ss:Size="11" ss:Bold="1" ss:Color="#6D3427"/><Interior ss:Color="#F7EEE9" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Header" ss:Parent="Default"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#4A2B22"/><Interior ss:Color="#EAD8CC" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Present" ss:Parent="Default"><Font ss:Bold="1" ss:Color="#24663A"/><Interior ss:Color="#EAF6ED" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Late" ss:Parent="Default"><Font ss:Bold="1" ss:Color="#A83227"/><Interior ss:Color="#FDECEA" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Absent" ss:Parent="Default"><Font ss:Bold="1" ss:Color="#A83227"/><Interior ss:Color="#F9D9D5" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Warning" ss:Parent="Default"><Font ss:Bold="1" ss:Color="#8A5A12"/><Interior ss:Color="#FFF1CF" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Off" ss:Parent="Default"><Font ss:Bold="1" ss:Color="#56606B"/><Interior ss:Color="#ECEFF2" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Total" ss:Parent="Default"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#6D3427" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="ملخص الفترة">
  <Table>${summaryCols}
   ${mergeTitle("تقرير الحضور والانصراف", "Title")}
   ${mergeTitle(`من ${formatAttendanceDate(payload.from)} إلى ${formatAttendanceDate(payload.to)}`, "SubTitle")}
   <Row ss:Height="26">${summaryHeaders.map((header) => cell(header, "Header")).join("")}</Row>
   ${summaryRows}${totalRow}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions>
 </Worksheet>
 <Worksheet ss:Name="التفاصيل اليومية">
  <Table>${detailCols}
   <Row ss:Height="30"><Cell ss:StyleID="Title" ss:MergeAcross="11"><Data ss:Type="String">التفاصيل اليومية للحضور والانصراف</Data></Cell></Row>
   <Row ss:Height="26">${detailHeaders.map((header) => cell(header, "Header")).join("")}</Row>
   ${detailRows}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>2</SplitHorizontal><TopRowBottomPane>2</TopRowBottomPane><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

function printHtmlEscape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildAttendancePdfDocument(payload: ReportPayload) {
  const summary = attendanceSummary(payload);
  const totals = summary.reduce((acc, row) => ({
    requiredDays: acc.requiredDays + row.requiredDays,
    attendanceDays: acc.attendanceDays + row.attendanceDays,
    absenceDays: acc.absenceDays + row.absenceDays,
    partialDays: acc.partialDays + row.partialDays,
    offDays: acc.offDays + row.offDays,
    requiredPeriods: acc.requiredPeriods + row.requiredPeriods,
    attendedPeriods: acc.attendedPeriods + row.attendedPeriods,
    missedPeriods: acc.missedPeriods + row.missedPeriods,
    requiredMinutes: acc.requiredMinutes + row.requiredMinutes,
    workMinutes: acc.workMinutes + row.workMinutes,
    delayMinutes: acc.delayMinutes + row.delayMinutes,
  }), { requiredDays: 0, attendanceDays: 0, absenceDays: 0, partialDays: 0, offDays: 0, requiredPeriods: 0, attendedPeriods: 0, missedPeriods: 0, requiredMinutes: 0, workMinutes: 0, delayMinutes: 0 });
  const totalRate = totals.requiredPeriods ? Math.round((totals.attendedPeriods / totals.requiredPeriods) * 1000) / 10 : 0;
  const card = (label: string, value: string | number) => `<div class="summary-card"><small>${printHtmlEscape(label)}</small><strong>${printHtmlEscape(value)}</strong></div>`;
  const summaryRows = summary.map((row, index) => {
    const rate = row.requiredPeriods ? Math.round((row.attendedPeriods / row.requiredPeriods) * 1000) / 10 : 0;
    return `<tr><td>${index + 1}</td><td>${printHtmlEscape(row.name)}</td><td>${printHtmlEscape(row.branch)}</td><td>${row.requiredDays}</td><td>${row.attendanceDays}</td><td>${row.absenceDays}</td><td>${row.partialDays}</td><td>${row.offDays}</td><td>${row.requiredPeriods}</td><td>${row.attendedPeriods}</td><td>${row.missedPeriods}</td><td>${printHtmlEscape(minutesAsHours(row.requiredMinutes))}</td><td>${printHtmlEscape(minutesAsHours(row.workMinutes))}</td><td>${row.delayMinutes}</td><td>${rate}%</td></tr>`;
  }).join("");
  const detailRows = payload.rows.flatMap((row) => row.periods.filter((period): period is ReportPeriod => Boolean(period)).map((period) => {
    const delay = Math.max(0, Number(period.delayMinutes || 0));
    const status = period.checkIn ? (delay > 0 ? "متأخر" : "حاضر") : missingResultLabel(period.result);
    const statusClass = status === "حاضر" ? "present" : status === "متأخر" ? "late" : status === "غائب" ? "absent" : "other";
    return `<tr><td>${printHtmlEscape(formatAttendanceDate(row.date))}</td><td>${printHtmlEscape(formatAttendanceDay(row.date))}</td><td>${printHtmlEscape(row.branch)}</td><td>${printHtmlEscape(row.name)}</td><td>${printHtmlEscape(period.name)}</td><td>${printHtmlEscape(period.startTime || "—")}</td><td>${printHtmlEscape(period.endTime || "—")}</td><td>${printHtmlEscape(period.checkInText || (period.checkIn ? formatAttendanceTime(period.checkIn) : "—"))}</td><td>${printHtmlEscape(period.checkOutText || (period.checkOut ? formatAttendanceTime(period.checkOut) : "—"))}</td><td>${printHtmlEscape(minutesAsHours(period.workMinutes))}</td><td>${delay}</td><td class="status-${statusClass}">${printHtmlEscape(status)}</td></tr>`;
  })).join("");

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير الحضور والانصراف</title><style>
@page{size:A4 landscape;margin:8mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{font-family:Tajawal,Arial,sans-serif;color:#2d2724;font-size:9px;line-height:1.45}
h1{margin:0;font-size:18px}.title{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;margin-bottom:12px}.muted{color:#796e68}.summary-cards{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin-bottom:10px}.summary-card{border:1px solid #e7ddd7;border-radius:9px;padding:7px;background:#fffaf7;min-height:50px}.summary-card small{display:block;color:#7b6d65;font-size:8px}.summary-card strong{display:block;font-size:14px;margin-top:3px}.section{margin-top:10px}.section h2{font-size:12px;margin:0 0 6px}.page-break{break-before:page;page-break-before:always}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #ddd3cd;padding:4px;text-align:center;vertical-align:middle;word-break:break-word}th{background:#efe5df;font-weight:700}tbody tr:nth-child(even){background:#fbf8f6}.status-present,.status-late,.status-absent,.status-other{font-weight:700}.totals td{font-weight:700;background:#eadfd8}.meta{display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;font-size:9px}</style></head><body>
<div class="title"><div><h1>تقرير الحضور والانصراف</h1><div class="muted">الفترة: ${printHtmlEscape(formatAttendanceDate(payload.from))} إلى ${printHtmlEscape(formatAttendanceDate(payload.to))}</div></div><div class="muted">نهاية الدوام الرسمية: ${printHtmlEscape(payload.officialDayEnd)}</div></div>
<div class="summary-cards">${card("الموظفون", summary.length)}${card("أيام الدوام", totals.requiredDays)}${card("أيام الحضور", totals.attendanceDays)}${card("أيام الغياب", totals.absenceDays)}${card("حضور جزئي", totals.partialDays)}${card("دقائق التأخير", totals.delayMinutes)}${card("نسبة التسجيل", `${totalRate}%`)}</div>
<section class="section"><h2>ملخص الفترة</h2><table><thead><tr><th>م</th><th>الموظف</th><th>الفرع</th><th>أيام الدوام</th><th>الحضور</th><th>الغياب</th><th>جزئي</th><th>إجازة</th><th>الفترات المطلوبة</th><th>المسجلة</th><th>الغائبة</th><th>الساعات المطلوبة</th><th>ساعات العمل</th><th>التأخير/د</th><th>النسبة</th></tr></thead><tbody>${summaryRows || `<tr><td colspan="15">لا توجد بيانات</td></tr>`}</tbody><tfoot><tr class="totals"><td colspan="3">الإجمالي</td><td>${totals.requiredDays}</td><td>${totals.attendanceDays}</td><td>${totals.absenceDays}</td><td>${totals.partialDays}</td><td>${totals.offDays}</td><td>${totals.requiredPeriods}</td><td>${totals.attendedPeriods}</td><td>${totals.missedPeriods}</td><td>${printHtmlEscape(minutesAsHours(totals.requiredMinutes))}</td><td>${printHtmlEscape(minutesAsHours(totals.workMinutes))}</td><td>${totals.delayMinutes}</td><td>${totalRate}%</td></tr></tfoot></table></section>
<section class="section page-break"><div class="meta"><strong>التفاصيل اليومية</strong><span>الحضور والانصراف لكل فترة عمل</span></div><table><thead><tr><th>التاريخ</th><th>اليوم</th><th>الفرع</th><th>الموظف</th><th>الفترة</th><th>من</th><th>إلى</th><th>الحضور</th><th>الانصراف</th><th>ساعات العمل</th><th>التأخير/د</th><th>الحالة</th></tr></thead><tbody>${detailRows || `<tr><td colspan="12">لا توجد تفاصيل يومية</td></tr>`}</tbody></table></section>
</body></html>`;
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
  const [reportPdfExporting, setReportPdfExporting] = useState(false);
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

  async function exportPdf() {
    if (!isAdmin || reportPdfExporting) return;
    setReportPdfExporting(true);
    setError("");
    try {
      const payload = await fetchReportPayload(from, to, employeeIds, branchId);
      setReport(payload);
      setCollapsedDays(new Set());
      if (!payload.rows.length) {
        setError("لا توجد نتائج مطابقة للفلاتر.");
        return;
      }
      const win = window.open("", "_blank", "width=1400,height=900");
      if (!win) {
        setError("تعذر فتح صفحة PDF. اسمح بالنوافذ المنبثقة للموقع.");
        return;
      }
      win.document.open();
      win.document.write(buildAttendancePdfDocument(payload));
      win.document.close();
      let printed = false;
      const printOnce = () => {
        if (printed) return;
        printed = true;
        win.focus();
        win.print();
      };
      win.onload = () => window.setTimeout(printOnce, 150);
      window.setTimeout(printOnce, 800);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "تعذر تصدير PDF");
    } finally {
      setReportPdfExporting(false);
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
          <button className="secondary-button" type="button" onClick={() => void exportPdf()} disabled={reportPdfExporting || reportExporting || reportLoading}>
            <FilePdf size={18} /> {reportPdfExporting ? "جاري تجهيز PDF..." : "تصدير PDF"}
          </button>
          <button className="secondary-button" type="button" onClick={() => void exportExcel()} disabled={reportExporting || reportPdfExporting || reportLoading}>
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
