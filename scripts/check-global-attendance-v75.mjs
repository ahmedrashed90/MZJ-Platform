import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const schema = read("server/_attendance-schema.ts");
const service = read("server/_attendance.ts");
const api = read("server/attendance.ts");
const login = read("server/auth/login.ts");
const auth = read("server/_auth.ts");
const app = read("src/App.tsx");
const sidebar = read("src/components/Sidebar.tsx");
const settings = read("src/pages/SettingsPage.tsx");
const report = read("src/attendance/AttendancePage.tsx");
const attendanceSettings = read("src/attendance/AttendanceSettingsPanel.tsx");
const marketingLayout = read("src/marketing/MarketingLayout.tsx");
const marketingApi = read("server/marketing/index.ts");
const cron = read("server/internal/attendance-tick.ts");
const vercel = read("vercel.json");

check("core attendance location table", schema.includes("core.attendance_locations"));
check("core attendance schedule table", schema.includes("core.attendance_schedules"));
check("core attendance period table", schema.includes("core.attendance_periods"));
check("per-user schedule assignment table", schema.includes("core.attendance_user_schedules"));
check("attendance records preserve schedule and geofence snapshots", schema.includes("scheduled_end_at") && schema.includes("required_location_name") && schema.includes("location_result"));
check("legacy marketing attendance migration exists", schema.includes("marketing.attendance_records") && schema.includes("legacy_source_key"));
check("login requires attendance before session", login.indexOf("requireAttendanceForLogin") < login.indexOf("createSession(request, response"));
check("session requests enforce active attendance", auth.includes("isAttendanceSessionAllowed"));
check("cross-midnight work-date logic exists", service.includes("p.end_time <= p.start_time") && service.includes("c.local_date - 1"));
check("grace minutes determine delay", service.includes("period.grace_minutes * 60000"));
check("manual checkout ends all user sessions", service.includes("checkout_source='manual'") && service.includes("delete from core.sessions where user_id"));
check("auto checkout closes at scheduled period end", service.includes("check_out=scheduled_end_at") && service.includes("checkout_source='auto'"));
check("cron runs attendance tick", cron.includes("runAttendanceTick") && vercel.includes("internal/attendance-tick") && vercel.includes("* * * * *"));
check("admin settings are superadmin-only", settings.includes('permissions: ["platform.superadmin"]') && api.includes("requireAdmin"));
check("user assignments include optional required location", attendanceSettings.includes("assignmentLocationId") && attendanceSettings.includes("locationId"));
check("location is optional for remote users", attendanceSettings.includes("\u063a\u064a\u0631 \u0645\u062d\u062f\u062f") && service.includes("locationRequired"));
check("per-user weekly day off stored in assignment", schema.includes("weekly_off_day") && attendanceSettings.includes("assignmentWeeklyOffDay") && api.includes("weeklyOffDay"));
check("weekly day off excludes work periods", service.includes("extract(dow from work_date)") && service.includes("WEEKLY_DAY_OFF"));
check("report marks weekly day off as holiday", api.includes('result = "عطلة"'));
check("attendance page accepts undefined current record", report.includes('SelfPayload["currentRecord"] | undefined'));
check("report has requested filters", report.includes("\u0645\u0646 \u062a\u0627\u0631\u064a\u062e") && report.includes("\u0625\u0644\u0649 \u062a\u0627\u0631\u064a\u062e") && report.includes("\u0627\u0644\u0645\u0648\u0638\u0641"));
check("report has requested grouped labels", report.includes("\u0627\u0644\u0644\u0648\u0643\u064a\u0634\u0646") && report.includes("\u0645\u0643\u0627\u0646 \u0627\u0644\u062d\u0636\u0648\u0631") && report.includes("\u0627\u0644\u0645\u0643\u0627\u0646 \u0627\u0644\u0645\u0637\u0644\u0648\u0628"));
check("report periods are dynamic", report.includes("periodHeaders") && api.includes("maxPeriods") && api.includes("slotTimes"));
check("global attendance route exists", app.includes('path="/attendance"') && sidebar.includes('href: "/attendance"'));
check("old marketing attendance page is redirected", app.includes('path="attendance" element={<Navigate to="/attendance" replace />}'));
check("marketing attendance runtime was removed", !marketingApi.includes("async function attendanceData") && !marketingLayout.includes('href: "/marketing/attendance"'));

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`PASS: ${item.name}`);
  else { failed += 1; console.error(`FAIL: ${item.name}`); }
}
console.log(`\nGlobal attendance checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
