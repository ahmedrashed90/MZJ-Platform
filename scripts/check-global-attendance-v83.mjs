import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const service = read("server/_attendance.ts");
const endpoint = read("server/attendance.ts");
const logoutServer = read("server/auth/logout.ts");
const authContext = read("src/auth/AuthContext.tsx");
const loginPage = read("src/pages/LoginPage.tsx");
const sidebar = read("src/components/Sidebar.tsx");
const report = read("src/attendance/AttendancePage.tsx");
const locationHelper = read("src/attendance/location.ts");
const styles = read("src/styles.css");
const vercel = read("vercel.json");

check("regular users can read their own attendance state", endpoint.includes('view === "self"') && endpoint.includes("getSelfAttendanceState(user.id)"));
check("regular users can explicitly check in", endpoint.includes('action === "self_check_in"') && endpoint.indexOf('action === "self_check_in"') < endpoint.lastIndexOf("const admin = await requireAdmin(request, response)"));
check("browser GPS uses standard high-accuracy and watch providers", locationHelper.includes("enableHighAccuracy: false") && locationHelper.includes("enableHighAccuracy: true") && locationHelper.includes("watchPosition"));
check("browser GPS has a finite hard timeout", locationHelper.includes("16000") && locationHelper.includes("hardTimeout"));
check("browser GPS clears the watch after success or timeout", locationHelper.includes("clearWatch") && locationHelper.includes("cleanup"));
check("login reports when GPS coordinates were captured", loginPage.includes("تم تحديد اللوكيشن") && loginPage.includes("location.accuracy"));
check("required GPS is persisted in attendance records", service.includes("check_in_latitude,check_in_longitude,check_in_accuracy_m") && service.includes("ATTENDANCE_LOCATION_NOT_SAVED"));
check("report queries attendance by work date and actual timestamps", endpoint.includes("work_date between ${from}::date and ${to}::date") && endpoint.includes("check_in at time zone ${ATTENDANCE_TIME_ZONE}") && endpoint.includes("check_out at time zone ${ATTENDANCE_TIME_ZONE}"));
check("report maps timestamp date fallback to requested day", endpoint.includes("reportDateFromTimestamp") && endpoint.includes("reportDays.has(checkInDate)"));
check("report accepts multiple employee ids", endpoint.includes("employeeIds") && endpoint.includes('String(value ?? "").split(",")'));
check("report employee filter is multi select", report.includes('type="checkbox"') && report.includes("toggleEmployee"));
check("report uses grouped compact table headings", report.includes("attendance-main-head-row") && report.includes('colSpan={3}>اللوكيشن') && report.includes("attendance-sub-head-row"));
check("report table is fixed width with no horizontal scrolling", styles.includes(".attendance-report-table-compact") && styles.includes("table-layout: fixed") && styles.includes("overflow-x: hidden") && !styles.includes(".attendance-report-table-compact {\n  width: max-content"));
check("report shows saved GPS coordinates", report.includes("attendance-plain-location-link") && report.includes("row.location.latitude") && report.includes("row.location.longitude"));
check("report shows check-in and checkout values", report.includes("checkInText") && report.includes("checkOutText") && report.includes("attendance-time-cell-plain"));
check("legacy marketing migration is excluded from report period headers", endpoint.includes("legacy_source_key") && endpoint.includes("legacySourceKey.startsWith(\"marketing:\")") && endpoint.includes("periodName !== \"سجل التسويق السابق\""));
check("manual logout checks out before clearing the session", logoutServer.indexOf("attendanceRecord = await checkoutCurrentAttendance") < logoutServer.indexOf("await clearSession(request, response)"));
const logoutClient = authContext.slice(authContext.indexOf("const logout = useCallback"), authContext.indexOf("const value = useMemo"));
check("client keeps session when checkout/logout backend fails", logoutClient.includes("if (!response.ok || payload?.ok === false)") && logoutClient.indexOf("if (!response.ok || payload?.ok === false)") < logoutClient.indexOf("setUser(null)"));
check("auto checkout still closes forgotten open attendance", service.includes("check_out=scheduled_end_at") && service.includes("checkout_source='auto'"));
check("cron remains scheduled each minute", vercel.includes("internal/attendance-tick") && vercel.includes("* * * * *"));
check("attendance page remains superadmin only", report.includes('hasPermission(user, "platform.superadmin")'));
check("admin bootstrap has no duplicate where clause", !endpoint.includes("where ax.user_id=u.id\n        where ax.user_id=u.id"));
check("no release patch markers were added", !styles.includes("PATCH") && !report.includes("PATCH") && !service.includes("PATCH") && !sidebar.includes("PATCH"));

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`PASS: ${item.name}`);
  else { failed += 1; console.error(`FAIL: ${item.name}`); }
}
console.log(`\nGlobal attendance v83 checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
