import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const service = read("server/_attendance.ts");
const endpoint = read("server/attendance.ts");
const loginServer = read("server/auth/login.ts");
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
check("browser GPS helper uses fresh high-accuracy location", locationHelper.includes("enableHighAccuracy: true") && locationHelper.includes("maximumAge: 0"));
check("login uses the shared GPS helper", loginPage.includes("getBrowserAttendanceLocation"));
check("required GPS is persisted in attendance records", service.includes("${locationSnapshot.latitude},${locationSnapshot.longitude},${locationSnapshot.accuracy}") && service.includes("check_in_latitude,check_in_longitude,check_in_accuracy_m"));
check("new check-in fails loudly if required GPS was not persisted", service.includes("ATTENDANCE_LOCATION_NOT_SAVED") && service.includes("!hasAttendanceCoordinates(row)"));
check("open legacy attendance can recover missing GPS", service.includes("attachAttendanceLocationToRecord") && service.includes("needsLocationCapture"));
check("open attendance login requires GPS recovery when required", service.includes("يجب تحديد موقع الحضور لهذه الفترة قبل الدخول إلى المنصة"));
check("sidebar auto-recovers missing GPS for an open attendance", sidebar.includes("captureMissingAttendanceLocation") && sidebar.includes("locationRecoveryAttempt"));
check("sidebar checkout retries GPS recovery before logout", sidebar.indexOf("await captureMissingAttendanceLocation()") < sidebar.indexOf("await logout()"));
check("manual logout must finish attendance checkout before clearing session", logoutServer.indexOf("attendanceRecord = await checkoutCurrentAttendance") < logoutServer.indexOf("await clearSession(request, response)"));
const logoutClient = authContext.slice(authContext.indexOf("const logout = useCallback"), authContext.indexOf("const value = useMemo"));
check("client keeps session when logout backend fails", logoutClient.includes("if (!response.ok || payload?.ok === false)") && logoutClient.indexOf("if (!response.ok || payload?.ok === false)") < logoutClient.indexOf("setUser(null)"));
check("report returns explicit local check-in and checkout time text", endpoint.includes("checkInText: reportClock") && endpoint.includes("checkOutText: reportClock"));
check("report visibly labels check-in and checkout times", report.includes("وقت الحضور") && report.includes("وقت الانصراف") && report.includes("checkInText") && report.includes("checkOutText"));
check("report shows a clear warning when required GPS is missing", endpoint.includes("missingRequiredLocationCapture") && report.includes("لم يتم حفظ اللوكيشن"));
check("report exposes clickable captured location", report.includes("فتح اللوكيشن") && report.includes("google.com/maps"));
check("report refreshes live attendance records", report.includes("15000") && report.includes("loadReport(from, to, employeeId)"));
check("report periods remain dynamic from configured names", endpoint.includes("periodHeaders = orderedHeaders.map((header) => header.label)"));
check("attendance table styling is integrated and readable", styles.includes(".attendance-time-stamp") && styles.includes(".attendance-location-missing") && styles.includes("dynamic attendance periods scroll independently"));
check("auto checkout still runs for forgotten checkout", service.includes("check_out=scheduled_end_at") && service.includes("checkout_source='auto'"));
check("cron is still scheduled every minute", vercel.includes("internal/attendance-tick") && vercel.includes("* * * * *"));
check("attendance page remains admin-only", report.includes('hasPermission(user, "platform.superadmin")'));
check("no release patch markers were added", !styles.includes("PATCH") && !report.includes("PATCH") && !service.includes("PATCH") && !sidebar.includes("PATCH"));

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`PASS: ${item.name}`);
  else { failed += 1; console.error(`FAIL: ${item.name}`); }
}
console.log(`\nGlobal attendance v80 checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
