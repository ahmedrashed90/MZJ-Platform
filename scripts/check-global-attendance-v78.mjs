import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const service = read("server/_attendance.ts");
const loginServer = read("server/auth/login.ts");
const logoutServer = read("server/auth/logout.ts");
const loginPage = read("src/pages/LoginPage.tsx");
const sidebar = read("src/components/Sidebar.tsx");
const report = read("src/attendance/AttendancePage.tsx");
const reportApi = read("server/attendance.ts");
const styles = read("src/styles.css");

check("login explicitly requests attendance check-in", loginPage.includes('attendanceCheckIn: true'));
check("safe mode still records explicit attendance when an active period exists", service.includes("if (options.confirmCheckIn)") && service.indexOf("if (options.confirmCheckIn)") < service.indexOf("if (enforcementEnabled)"));
check("safe mode allows platform access outside a period", service.includes("if (!enforcementEnabled) return { enforced: false, checkedIn: false, state }"));
check("required GPS is requested before attendance record creation", service.includes('"ATTENDANCE_LOCATION_REQUIRED"') && service.indexOf('"ATTENDANCE_LOCATION_REQUIRED"') < service.indexOf("registerAttendanceCheckIn"));
check("attendance records persist GPS coordinates", service.includes("check_in_latitude") && service.includes("check_in_longitude") && service.includes("check_in_accuracy_m"));
check("report reads persisted GPS coordinates", reportApi.includes("check_in_latitude::float8") && reportApi.includes("actualLocations"));
check("report shows actual and required location labels", report.includes("مكان الحضور") && report.includes("المكان المطلوب") && report.includes("النتيجة"));
check("report shows check-in and check-out times", report.includes("formatAttendanceTime(period.checkIn)") && report.includes("formatAttendanceTime(period.checkOut)"));
check("report uses configured period names", reportApi.includes("periodHeaders = orderedHeaders.map((header) => header.label)"));
check("manual logout closes open attendance first", logoutServer.includes("checkoutCurrentAttendance") && logoutServer.indexOf("await checkoutCurrentAttendance") < logoutServer.indexOf("await clearSession"));
check("manual logout tolerates users without open attendance", logoutServer.includes("allowMissing: true"));
check("sidebar exposes attendance checkout with logout", sidebar.includes("تسجيل انصراف وتسجيل خروج") && sidebar.includes("attendance-logout-button"));
check("report table uses grouped professional layout", report.includes("attendance-table-groups") && report.includes("attendance-period-group") && styles.includes("attendance-report-table-v2"));
check("personal current-attendance page stays removed", !report.includes("الحضور الحالي") && !report.includes("حالتك الآن"));
check("login attendance validation runs before session creation", loginServer.indexOf("requireAttendanceForLogin") < loginServer.indexOf("createSession(request, response"));
check("no release patch markers were added", !styles.includes("PATCH") && !styles.includes("HOTFIX") && !report.includes("PATCH") && !service.includes("PATCH"));

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`PASS: ${item.name}`);
  else { failed += 1; console.error(`FAIL: ${item.name}`); }
}
console.log(`\nGlobal attendance v78 checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
