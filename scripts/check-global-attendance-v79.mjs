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
check("self check-in persists through core attendance service", endpoint.includes("checkInCurrentAttendance(user.id") && service.includes("registerAttendanceCheckIn"));
check("browser GPS helper uses fresh high-accuracy location", locationHelper.includes("enableHighAccuracy: true") && locationHelper.includes("maximumAge: 0"));
check("login uses the shared GPS helper", loginPage.includes("getBrowserAttendanceLocation"));
check("sidebar exposes a real check-in action", sidebar.includes("تسجيل حضور") && sidebar.includes("self_check_in") && sidebar.includes("getBrowserAttendanceLocation"));
check("sidebar checkout action is conditional on open attendance", sidebar.includes("hasOpenAttendance") && sidebar.includes("تسجيل انصراف وتسجيل خروج"));
check("manual logout must finish attendance checkout before clearing session", logoutServer.indexOf("attendanceRecord = await checkoutCurrentAttendance") < logoutServer.indexOf("await clearSession(request, response)"));
check("manual logout does not silently swallow checkout failure", !logoutServer.includes("checkoutCurrentAttendance(user.id, { allowMissing: true, revokeSessions: false }).catch"));
const logoutClient = authContext.slice(authContext.indexOf("const logout = useCallback"), authContext.indexOf("const value = useMemo"));
check("client keeps session when logout backend fails", logoutClient.includes("if (!response.ok || payload?.ok === false)") && logoutClient.indexOf("if (!response.ok || payload?.ok === false)") < logoutClient.indexOf("setUser(null)"));
check("auto checkout runs even while login enforcement is in safe mode", service.includes("const enforcementEnabled = await isAttendanceEnforcementEnabled()") && !service.includes("return { ok: true, enforcementEnabled: false, closedRecords: 0"));
check("forced logout remains tied to enforcement", service.includes("if (enforcementEnabled && closedUserIds.length)"));
check("report receives map-friendly GPS fields", endpoint.includes("latitude: primaryLocatedRecord") && endpoint.includes("distanceM:"));
check("report exposes clickable captured location", report.includes("عرض الموقع") && report.includes("google.com/maps"));
check("report keeps requested grouped labels", report.includes("اللوكيشن") && report.includes("مكان الحضور") && report.includes("المكان المطلوب") && report.includes("الحضور") && report.includes("الانصراف") && report.includes("النتيجة"));
check("report periods remain dynamic from configured names", endpoint.includes("periodHeaders = orderedHeaders.map((header) => header.label)"));
check("period name normalization removes invisible duplicate labels", endpoint.includes("normalize(\"NFKC\")") && endpoint.includes("\\u200B-\\u200F"));
check("report uses integrated v3 table layout", report.includes("attendance-report-table-v3") && styles.includes(".attendance-report-table-v3") && !report.includes("attendance-report-table-v2"));
check("report base headers align with the eight base columns", (report.match(/attendance-base-head/g) || []).length === 5 && report.includes("<th colSpan={3} className=\"attendance-location-group\">"));
check("report table keeps employee identity visible during horizontal scroll", styles.includes("Keep the employee identity visible"));
check("cron is still scheduled every minute", vercel.includes("internal/attendance-tick") && vercel.includes("* * * * *"));
check("attendance page remains admin-only", report.includes('hasPermission(user, "platform.superadmin")'));
check("no release patch markers were added", !styles.includes("PATCH") && !report.includes("PATCH") && !service.includes("PATCH") && !sidebar.includes("PATCH"));

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`PASS: ${item.name}`);
  else { failed += 1; console.error(`FAIL: ${item.name}`); }
}
console.log(`\nGlobal attendance v79 checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
