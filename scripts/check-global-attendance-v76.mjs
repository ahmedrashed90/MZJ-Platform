import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const schema = read("server/_attendance-schema.ts");
const service = read("server/_attendance.ts");
const api = read("server/attendance.ts");
const login = read("server/auth/login.ts");
const logout = read("server/auth/logout.ts");
const auth = read("server/_auth.ts");
const app = read("src/App.tsx");
const sidebar = read("src/components/Sidebar.tsx");
const settingsPage = read("src/pages/SettingsPage.tsx");
const report = read("src/attendance/AttendancePage.tsx");
const attendanceSettings = read("src/attendance/AttendanceSettingsPanel.tsx");
const styles = read("src/styles.css");
const cron = read("server/internal/attendance-tick.ts");
const vercel = read("vercel.json");

check("attendance assignments store selected periods", schema.includes("period_ids uuid[]") && service.includes("p.id=any(a.period_ids)"));
check("attendance assignments store branch", schema.includes("branch_id uuid references core.branches") && api.includes("branch_id=${effectiveBranchId}::uuid"));
check("existing assignments snapshot their current periods", schema.includes("set period_ids=(") && schema.includes("where a.period_ids is null"));
check("schedule definitions allow alternative overlapping periods", !api.includes('throw new AttendanceError("OVERLAPPING_PERIODS"'));
check("overlapping periods are blocked only for the same user", api.includes("OVERLAPPING_USER_PERIODS") && api.includes("assertSelectedPeriodsDoNotOverlap"));
check("assignment UI lets admin choose exact periods", attendanceSettings.includes("assignmentPeriodIds") && attendanceSettings.includes("فترات العمل لهذا التعيين"));
check("assignment UI supports branch and per-user edit", attendanceSettings.includes("assignmentBranchId") && attendanceSettings.includes("editUserAssignment") && attendanceSettings.includes("حفظ تعديل اليوزر"));
check("delegate branch prefers CRM system branch", api.includes("core.user_system_branches") && api.includes("usb.system_code='crm'"));
check("weekly leave terminology is اجازة", attendanceSettings.includes("يوم الإجازة") && api.includes('result = "إجازة"') && !attendanceSettings.includes("عطلة"));
check("report is admin-only in navigation and route", sidebar.includes('permission: "platform.superadmin"') && app.includes('PermissionGuard permission="platform.superadmin"><AttendancePage'));
check("current personal attendance UI and API removed", !report.includes("الحضور الحالي") && !report.includes("حالتك الآن") && !report.includes('view=self') && !api.includes('view === "self"') && !api.includes('action === "check_out"') && !service.includes("getSelfAttendance"));
check("report heading is report-only", report.includes("تقارير الحضور والانصراف") && report.includes("attendance-report-only-head"));
check("attendance styling is integrated cleanly", !styles.includes("Global Attendance CLEAN v76") && !styles.includes(".attendance-tabs") && !styles.includes(".attendance-status-card") && styles.includes(".attendance-period-selector") && styles.includes(".attendance-report-only-head"));
check("report headers use configured period names", api.includes("periodHeaders = orderedHeaders.map((header) => header.label)") && !api.includes('return `الفترة ${index + 1}${suffix}`'));
check("report still has requested filters", report.includes("من تاريخ") && report.includes("إلى تاريخ") && report.includes("الموظف"));
check("manual platform logout registers checkout when open", logout.includes("checkoutCurrentAttendance") && logout.indexOf("await checkoutCurrentAttendance") < logout.indexOf("await clearSession"));
check("login requires attendance before session", login.indexOf("requireAttendanceForLogin") < login.indexOf("createSession(request, response"));
check("session requests enforce active attendance", auth.includes("isAttendanceSessionAllowed"));
check("cross-midnight work-date logic exists", service.includes("p.end_time <= p.start_time") && service.includes("c.local_date - 1"));
check("grace minutes determine delay", service.includes("period.grace_minutes * 60000"));
check("auto checkout closes at scheduled period end", service.includes("check_out=scheduled_end_at") && service.includes("checkout_source='auto'"));
check("cron runs attendance tick", cron.includes("runAttendanceTick") && vercel.includes("internal/attendance-tick") && vercel.includes("* * * * *"));
check("admin settings remain superadmin-only", settingsPage.includes('permissions: ["platform.superadmin"]') && api.includes("requireAdmin"));

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`PASS: ${item.name}`);
  else { failed += 1; console.error(`FAIL: ${item.name}`); }
}
console.log(`\nGlobal attendance v76 checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
