import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const schema = read("server/_attendance-schema.ts");
const service = read("server/_attendance.ts");
const endpoint = read("server/attendance.ts");
const loginServer = read("server/auth/login.ts");
const authContext = read("src/auth/AuthContext.tsx");
const loginPage = read("src/pages/LoginPage.tsx");
const sidebar = read("src/components/Sidebar.tsx");
const locationHelper = read("src/attendance/location.ts");
const settings = read("src/attendance/AttendanceSettingsPanel.tsx");
const report = read("src/attendance/AttendancePage.tsx");
const styles = read("src/styles.css");

check("attendance locations support branch public IPs", schema.includes("allowed_public_ips text[]") && endpoint.includes("allowed_public_ips=${allowedPublicIps}::text[]"));
check("attendance records store IP and verification method", schema.includes("check_in_ip text") && schema.includes("location_verification_method") && service.includes("check_in_ip=${snapshot.checkInIp}"));
check("existing GPS records are normalized to GPS verification", schema.includes("set location_verification_method='gps'") && schema.includes("check_in_latitude is not null"));
check("active periods load configured branch network IPs", service.includes("coalesce(l.allowed_public_ips,'{}'::text[]) as allowed_public_ips") && service.includes("allowed_public_ips: textArray(row.allowed_public_ips)"));
check("server compares exact normalized request IP to configured branch network", service.includes("matchingAttendanceNetworkIp") && service.includes("expected.includes(actualIp)"));
check("network fallback is opt-in per attendance attempt", service.includes("allowNetworkFallback?: boolean") && service.includes("options.allowNetworkFallback ? matchingAttendanceNetworkIp"));
check("browser GPS still uses fresh readings", locationHelper.includes("maximumAge: 0") && locationHelper.includes("watchPosition") && locationHelper.includes("bestLocation"));
check("desktop location uses both high accuracy and network-friendly provider", locationHelper.includes("enableHighAccuracy: true") && locationHelper.includes("enableHighAccuracy: false"));
check("browser returns best available reading instead of blocking on 75 meters", locationHelper.includes("if (bestLocation)") && !locationHelper.includes("bestLocation.accuracy <= MAX_DESKTOP_ATTENDANCE_ACCURACY_M"));
check("login retries with branch network when desktop GPS fails", loginPage.includes("جاري التحقق من شبكة الفرع") && loginPage.includes("allowNetworkFallback: Boolean(requirement.locationRequired && requirement.networkFallbackConfigured)"));
check("login server verifies request IP", loginServer.includes("requestIp: requestIp(request)") && loginServer.includes("allowNetworkFallback: body.allowNetworkFallback === true"));
check("sidebar check-in uses branch network fallback", sidebar.includes("if (!attendanceState.networkFallbackConfigured) throw locationError") && sidebar.includes("allowNetworkFallback: Boolean(attendanceState?.networkFallbackConfigured)"));
check("self check-in server verifies request IP", endpoint.includes("requestIp: requestIp(request)") && endpoint.includes("allowNetworkFallback: body.allowNetworkFallback === true"));
check("GPS remains preferred when reliable", service.includes("const gpsReliable") && service.includes('locationResult = gpsResult') && service.includes('verificationMethod = gpsResult === "matched" && matchedNetworkIp ? "gps_and_network" : "gps"'));
check("configured branch radius remains the GPS match rule", service.includes('distance <= Number(period.required_radius_m) ? "matched" : "mismatched"'));
check("branch network can verify attendance without GPS coordinates", service.includes('verificationMethod = "network"') && service.includes('locationResult = "matched"'));
check("settings expose branch public IP configuration", settings.includes("Public IP لشبكة الفرع") && settings.includes("استخدم IP الحالي") && settings.includes("currentPublicIp"));
check("admin endpoint returns the current public IP", endpoint.includes("currentPublicIp: normalizeIpValue(requestIp(request))"));
check("report identifies network-verified attendance", report.includes('row.location.verificationMethod === "network"') && report.includes("شبكة الفرع") && endpoint.includes("networkVerifiedRecords"));
check("report does not present unreliable network-fallback GPS as the attendance point", endpoint.includes("gpsVerifiedRecords") && endpoint.includes('method === "gps" || method === "gps_and_network"'));
check("location settings textarea is integrated in existing styles", styles.includes(".attendance-location-network-field") && styles.includes(".attendance-current-ip"));
check("no release hotfix markers were introduced", !service.includes("HOTFIX") && !endpoint.includes("HOTFIX") && !settings.includes("HOTFIX"));

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`PASS: ${item.name}`);
  else { failed += 1; console.error(`FAIL: ${item.name}`); }
}
console.log(`\nGlobal attendance v87 checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
