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
check("browser GPS uses parallel standard and high accuracy requests", locationHelper.includes("enableHighAccuracy: false") && locationHelper.includes("enableHighAccuracy: true"));
check("browser GPS has a hard timeout and never spins forever", locationHelper.includes("12000") && locationHelper.includes("hardTimeout"));
check("browser GPS checks permission without depending on it for coordinates", locationHelper.includes("navigator.permissions") && locationHelper.includes('permission === "granted"'));
check("login reports when location coordinates were captured", loginPage.includes("تم تحديد اللوكيشن") && loginPage.includes("location.accuracy"));
check("login uses the shared GPS helper", loginPage.includes("getBrowserAttendanceLocation"));
check("required GPS is persisted in attendance records", service.includes("${locationSnapshot.latitude},${locationSnapshot.longitude},${locationSnapshot.accuracy}") && service.includes("check_in_latitude,check_in_longitude,check_in_accuracy_m"));
check("new check-in fails loudly if required GPS was not persisted", service.includes("ATTENDANCE_LOCATION_NOT_SAVED") && service.includes("!hasAttendanceCoordinates(row)"));
check("manual logout must finish attendance checkout before clearing session", logoutServer.indexOf("attendanceRecord = await checkoutCurrentAttendance") < logoutServer.indexOf("await clearSession(request, response)"));
const logoutClient = authContext.slice(authContext.indexOf("const logout = useCallback"), authContext.indexOf("const value = useMemo"));
check("client keeps session when logout backend fails", logoutClient.includes("if (!response.ok || payload?.ok === false)") && logoutClient.indexOf("if (!response.ok || payload?.ok === false)") < logoutClient.indexOf("setUser(null)"));
check("report accepts multiple employee ids", endpoint.includes("employeeIds") && endpoint.includes("String(value ?? \"\").split(\",\")") && endpoint.includes("u.id::text in ${sql(employeeIds)}"));
check("report employee filter is multi select", report.includes("employeeIds") && report.includes('type="checkbox"') && report.includes("toggleEmployee"));
check("report uses a plain one-row table header", report.includes("attendance-report-table-plain") && !report.includes("attendance-table-groups") && !report.includes("attendance-table-subheads"));
check("report shows plain check-in and checkout time values", report.includes("attendance-time-cell-plain") && report.includes("checkInText") && report.includes("checkOutText"));
check("report exposes saved GPS coordinates as a map link", report.includes("attendance-plain-location-link") && report.includes("google.com/maps"));
check("report warns when required GPS was not saved", report.includes("لم يتم حفظ اللوكيشن") && endpoint.includes("missingRequiredLocationCapture"));
check("report periods remain dynamic from configured names", endpoint.includes("periodHeaders = orderedHeaders.map((header) => header.label)"));
check("plain attendance table styling replaced card-like cells", styles.includes(".attendance-report-table-plain") && styles.includes("border-collapse: collapse") && !styles.includes(".attendance-time-stamp"));
check("auto checkout still runs for forgotten checkout", service.includes("check_out=scheduled_end_at") && service.includes("checkout_source='auto'"));
check("cron is still scheduled every minute", vercel.includes("internal/attendance-tick") && vercel.includes("* * * * *"));
check("attendance page remains admin-only", report.includes('hasPermission(user, "platform.superadmin")'));
check("no release patch markers were added", !styles.includes("PATCH") && !report.includes("PATCH") && !service.includes("PATCH") && !sidebar.includes("PATCH"));

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`PASS: ${item.name}`);
  else { failed += 1; console.error(`FAIL: ${item.name}`); }
}
console.log(`\nGlobal attendance v81 checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
