import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const exists = (file) => fs.existsSync(file);
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const schema = read("server/_attendance-schema.ts");
const service = read("server/_attendance.ts");
const endpoint = read("server/attendance.ts");
const loginServer = read("server/auth/login.ts");
const logoutServer = read("server/auth/logout.ts");
const authContext = read("src/auth/AuthContext.tsx");
const loginPage = read("src/pages/LoginPage.tsx");
const sidebar = read("src/components/Sidebar.tsx");
const settings = read("src/attendance/AttendanceSettingsPanel.tsx");
const report = read("src/attendance/AttendancePage.tsx");
const settingsPage = read("src/pages/SettingsPage.tsx");
const styles = read("src/styles.css");
const vercel = read("vercel.json");

const attendanceRuntime = [schema, service, endpoint, loginServer, authContext, loginPage, sidebar, settings, report, settingsPage].join("\n");

check("browser location helper is removed", !exists("src/attendance/location.ts"));
check("attendance runtime has no browser geolocation", !attendanceRuntime.includes("navigator.geolocation") && !attendanceRuntime.includes("getBrowserAttendanceLocation"));
check("attendance runtime has no GPS or location gate errors", !attendanceRuntime.includes("ATTENDANCE_LOCATION_") && !attendanceRuntime.includes("locationRequired") && !attendanceRuntime.includes("networkFallback"));
check("attendance schema no longer creates attendance locations", !schema.includes("core.attendance_locations") && !schema.includes("allowed_public_ips") && !schema.includes("required_location"));
check("new attendance records have no GPS or IP verification columns", !schema.includes("check_in_latitude") && !schema.includes("check_in_longitude") && !schema.includes("check_in_accuracy_m") && !schema.includes("check_in_ip") && !schema.includes("location_verification_method"));
check("user schedule schema has no attendance location dependency", !schema.includes("location_id"));
check("login page enters without asking for location", loginPage.includes('await login(identifier, password, { attendanceCheckIn: true })') && !loginPage.includes("MapPin") && !loginPage.includes("location"));
check("login API sends no coordinates or network fallback", loginServer.includes("confirmCheckIn: body.attendanceCheckIn === true") && !loginServer.includes("body.location") && !loginServer.includes("allowNetworkFallback"));
check("auth client sends attendance confirmation only", authContext.includes("attendanceCheckIn: options.attendanceCheckIn === true") && !authContext.includes("latitude") && !authContext.includes("longitude") && !authContext.includes("allowNetworkFallback"));
check("sidebar self check-in requires no location payload", sidebar.includes('JSON.stringify({ action: "self_check_in" })') && !sidebar.includes("locationRequired") && !sidebar.includes("needsLocationCapture"));
check("self attendance endpoint checks in without coordinates", endpoint.includes('action === "self_check_in"') && endpoint.includes("await checkInCurrentAttendance(user.id)") && !endpoint.includes("attendanceCoordinates"));
check("server check-in persists time without location", service.includes("check_in,delay_minutes,work_minutes,status") && service.includes("now(),${delayMinutes},0,${status}") && !service.includes("check_in_latitude"));
check("attendance settings have no location or public IP controls", !settings.includes("Public IP") && !settings.includes("Latitude") && !settings.includes("Longitude") && !settings.includes("مكان الحضور") && !settings.includes("locationId"));
check("admin attendance API exposes no location save actions", !endpoint.includes('save_location') && !endpoint.includes('delete_location') && !endpoint.includes("currentPublicIp"));
check("assignment keeps schedule periods branch and weekly off", endpoint.includes("branch_id") && endpoint.includes("period_ids") && endpoint.includes("weekly_off_day") && settings.includes("assignmentBranchId") && settings.includes("assignmentWeeklyOffDay"));
check("report no longer renders attendance location columns", !report.includes("اللوكيشن") && !report.includes("مكان الحضور") && !report.includes("attendance-plain-location-link") && !report.includes("row.location"));
check("report base columns are compact and location-free", report.includes("const totalColumns = 5 + periodHeaders.length * 3") && report.includes("attendance-col-index") && report.includes("attendance-col-name"));
check("report still shows check-in checkout and result", report.includes("checkInText") && report.includes("checkOutText") && report.includes("attendance-time-cell-plain") && report.includes("attendance-text-result"));
check("report still supports multiple employees", report.includes('type="checkbox"') && report.includes("toggleEmployee") && endpoint.includes("employeeIds"));
check("legacy marketing rows remain excluded from period headers", endpoint.includes('legacySourceKey.startsWith("marketing:")') && endpoint.includes('periodName !== "سجل التسويق السابق"'));
check("manual logout still checks out before clearing session", logoutServer.indexOf("attendanceRecord = await checkoutCurrentAttendance") >= 0 && logoutServer.indexOf("attendanceRecord = await checkoutCurrentAttendance") < logoutServer.indexOf("await clearSession(request, response)"));
check("auto checkout is preserved", service.includes("check_out=scheduled_end_at") && service.includes("checkout_source='auto'"));
check("schedule enforcement is preserved", service.includes("isAttendanceEnforcementEnabled") && service.includes("OUTSIDE_WORK_PERIOD") && service.includes("WEEKLY_DAY_OFF"));
check("attendance cron remains scheduled", vercel.includes("internal/attendance-tick") && vercel.includes("* * * * *"));
check("report remains full-width without horizontal scrolling", styles.includes("table-layout: fixed") && styles.includes("overflow-x: hidden") && !styles.includes("attendance-col-location"));
check("attendance settings navigation copy is location-free", settingsPage.includes("جداول الفترات ومواعيد اليوزرات وإعدادات الحضور") && !settingsPage.includes("نطاق السماح بالمتر"));
check("no patch or hotfix markers were introduced", !service.includes("HOTFIX") && !endpoint.includes("HOTFIX") && !loginPage.includes("HOTFIX") && !settings.includes("HOTFIX") && !report.includes("HOTFIX"));

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`PASS: ${item.name}`);
  else { failed += 1; console.error(`FAIL: ${item.name}`); }
}
console.log(`\nGlobal attendance v89 checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
