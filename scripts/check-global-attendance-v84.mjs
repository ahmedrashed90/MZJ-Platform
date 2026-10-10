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
check("browser GPS uses high accuracy only", locationHelper.includes("enableHighAccuracy: true") && !locationHelper.includes("enableHighAccuracy: false"));
check("browser GPS never accepts cached coordinates", locationHelper.includes("maximumAge: 0") && !locationHelper.includes("maximumAge: 30000"));
check("browser GPS targets ten meters and caps accuracy at fifteen meters", locationHelper.includes("TARGET_ATTENDANCE_ACCURACY_M = 10") && locationHelper.includes("MAX_ATTENDANCE_ACCURACY_M = 15"));
check("browser GPS samples multiple fresh readings", locationHelper.includes("getCurrentPosition") && locationHelper.includes("watchPosition") && locationHelper.includes("bestLocation"));
check("browser GPS rejects readings worse than fifteen meters", locationHelper.includes("bestLocation.accuracy <= MAX_ATTENDANCE_ACCURACY_M") && locationHelper.includes("المطلوب دقة 15م أو أفضل"));
check("server independently rejects low accuracy location", service.includes("MAX_ATTENDANCE_ACCURACY_M = 15") && service.includes("ATTENDANCE_LOCATION_ACCURACY_LOW") && service.includes("accuracy > MAX_ATTENDANCE_ACCURACY_M"));
check("configured branch radius remains the match rule", service.includes("distance <= period.required_radius_m ? \"matched\" : \"mismatched\""));
check("login reports captured GPS accuracy", loginPage.includes("تم تحديد اللوكيشن") && loginPage.includes("location.accuracy"));
check("required GPS is persisted in attendance records", service.includes("check_in_latitude,check_in_longitude,check_in_accuracy_m") && service.includes("ATTENDANCE_LOCATION_NOT_SAVED"));
check("report accepts multiple employee ids", endpoint.includes("employeeIds") && endpoint.includes('String(value ?? "").split(",")'));
check("report employee filter is multi select", report.includes('type="checkbox"') && report.includes("toggleEmployee"));
check("report table remains fixed width with no horizontal scrolling", styles.includes(".attendance-report-table-compact") && styles.includes("table-layout: fixed") && styles.includes("overflow-x: hidden"));
check("legacy marketing migration remains excluded from report period headers", endpoint.includes("legacy_source_key") && endpoint.includes('legacySourceKey.startsWith("marketing:")') && endpoint.includes('periodName !== "سجل التسويق السابق"'));
check("manual logout checks out before clearing the session", logoutServer.indexOf("attendanceRecord = await checkoutCurrentAttendance") < logoutServer.indexOf("await clearSession(request, response)"));
const logoutClient = authContext.slice(authContext.indexOf("const logout = useCallback"), authContext.indexOf("const value = useMemo"));
check("client keeps session when checkout/logout backend fails", logoutClient.includes("if (!response.ok || payload?.ok === false)") && logoutClient.indexOf("if (!response.ok || payload?.ok === false)") < logoutClient.indexOf("setUser(null)"));
check("auto checkout still closes forgotten open attendance", service.includes("check_out=scheduled_end_at") && service.includes("checkout_source='auto'"));
check("cron remains scheduled each minute", vercel.includes("internal/attendance-tick") && vercel.includes("* * * * *"));
check("attendance page remains superadmin only", report.includes('hasPermission(user, "platform.superadmin")'));
check("no release patch markers were added", !styles.includes("PATCH") && !report.includes("PATCH") && !service.includes("PATCH") && !sidebar.includes("PATCH"));

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`PASS: ${item.name}`);
  else { failed += 1; console.error(`FAIL: ${item.name}`); }
}
console.log(`\nGlobal attendance v84 checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
