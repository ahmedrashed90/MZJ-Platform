import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const exists = (file) => fs.existsSync(file);
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const attendanceSchema = read("server/_attendance-schema.ts");
const deviceSchema = read("server/_device-agent-schema.ts");
const deviceService = read("server/_device-agent.ts");
const deviceEndpoint = read("server/device-agent.ts");
const attendanceEndpoint = read("server/attendance.ts");
const loginServer = read("server/auth/login.ts");
const authContext = read("src/auth/AuthContext.tsx");
const loginPage = read("src/pages/LoginPage.tsx");
const settings = read("src/attendance/AttendanceSettingsPanel.tsx");
const report = read("src/attendance/AttendancePage.tsx");
const router = read("api/index.ts");
const styles = read("src/styles.css");
const agent = read("device-agent/windows/main.go");

const attendanceRuntime = [attendanceSchema, attendanceEndpoint, loginServer, authContext, loginPage, settings, report].join("\n");

check("location remains removed from attendance runtime", !attendanceRuntime.includes("navigator.geolocation") && !attendanceRuntime.includes("ATTENDANCE_LOCATION_") && !attendanceSchema.includes("attendance_locations"));
check("device policy schema exists", deviceSchema.includes("core.user_device_policies") && deviceSchema.includes("verification_required"));
check("trusted devices schema exists", deviceSchema.includes("core.user_devices") && deviceSchema.includes("public_key_pem") && deviceSchema.includes("fingerprint_hash"));
check("login challenge schema is short lived and one time", deviceSchema.includes("core.device_login_challenges") && deviceSchema.includes("expires_at") && deviceSchema.includes("consumed_at"));
check("sessions can record verified device", deviceSchema.includes("verified_device_id") && read("server/_auth.ts").includes("verifiedDeviceId"));
check("login requires agent only for required users", loginServer.includes("isDeviceVerificationRequired") && loginServer.includes("DEVICE_AGENT_REQUIRED") && loginServer.includes("complete_device"));
check("unknown devices are pending approval", deviceService.includes("status='pending'") || deviceService.includes("'pending'"));
check("approved device proof is cryptographically verified", deviceService.includes('createVerify("SHA256")') && deviceService.includes("verifier.verify") && deviceService.includes("deviceSignaturePayload"));
check("device id is derived from the public key", deviceService.includes("derivedDeviceId") && deviceService.includes("DEVICE_ID_KEY_MISMATCH"));
check("challenge polling is implemented", deviceEndpoint.includes('view !== "challenge"') && authContext.includes("pollDeviceChallenge"));
check("agent custom protocol is launched from login", authContext.includes("launchDeviceAgent") && deviceService.includes("mzjagent://verify") && loginServer.includes("createDeviceLoginChallenge"));
check("agent installer link is available", loginPage.includes("MZJ Device Agent") && exists("public/downloads/MZJ-Device-Agent-Setup.exe"));
check("windows agent generates ECDSA key", agent.includes("ecdsa.GenerateKey") && agent.includes("elliptic.P256"));
check("windows agent protects private key with DPAPI", agent.includes("CryptProtectData") && agent.includes("CryptUnprotectData"));
check("windows agent registers custom protocol", agent.includes("HKCU\\Software\\Classes\\mzjagent") && agent.includes("URL Protocol"));
check("windows agent sends only hashed hardware fingerprint", agent.includes("hardwareFingerprint") && agent.includes("sha256.Sum256") && !agent.includes('json:"machineGuid"'));
check("device agent API is routed", router.includes('import deviceAgentHandler') && router.includes('["device-agent", deviceAgentHandler]'));
check("attendance admin can mark user required or exempt", settings.includes('option value="required"') && settings.includes('option value="exempt"') && attendanceEndpoint.includes('set_device_policy'));
check("attendance admin can approve and revoke devices", settings.includes("approveDevice") && settings.includes("revokeDevice") && attendanceEndpoint.includes('approve_device') && attendanceEndpoint.includes('revoke_device'));
check("only one approved work device is active per required user", deviceSchema.includes("user_devices_one_approved_per_user_idx") && deviceService.includes("id<>${deviceRecordId}::uuid") && deviceService.includes("delete from core.sessions where user_id=${target.user_id}::uuid"));

check("attendance report has no automatic interval refresh", !report.includes("setInterval") && !report.includes("clearInterval") && !report.includes("10000"));
check("attendance report has one visible title only", (report.match(/<h1>تقارير الحضور والانصراف<\/h1>/g) || []).length === 1 && !report.includes("<h2>تقارير الحضور والانصراف</h2>"));
check("attendance report description note was removed", !report.includes("تقرير مركزي للحضور والانصراف حسب الفترات الفعلية المحددة لكل موظف"));
check("attendance report is grouped by day blocks", report.includes("groupedRows") && report.includes("attendance-day-block") && report.includes("attendance-day-title"));
check("day blocks are individually collapsible", report.includes("collapsedDays") && report.includes("toggleDay(group.date)") && report.includes("aria-expanded={!isCollapsed}") && report.includes("!isCollapsed ? ("));
check("day title contains only day and date expression", report.includes("formatAttendanceDay(group.date)} {formatAttendanceDate(group.date)") && !report.includes("موظف</strong>") && !report.includes("موظفين</strong>"));
check("day blocks rotate through eight visual tones", report.includes("groupIndex % 8") && Array.from({ length: 8 }, (_, index) => styles.includes(`.attendance-day-block.day-tone-${index}`)).every(Boolean));
check("report result renders delay minutes", report.includes("attendance-delay-result") && report.includes("{delay} دقيقة"));
check("late delay styling is red", styles.includes(".attendance-delay-result.late strong") && styles.includes("#b22d22"));
check("on-time styling is green", styles.includes(".attendance-delay-result.on-time strong") && styles.includes("#2f7540"));
check("excel export refetches current filters", report.includes("fetchReportPayload(from, to, employeeIds, branchId)") && report.includes("buildExcelDocument(payload)") && !report.includes("content.outerHTML"));
check("excel export includes grouped day data", report.includes("const groups = groupReportRows(payload.rows)") && report.includes("payload.periodHeaders") && report.includes("attendance-report-${payload.from || \"all\"}-${payload.to || \"all\"}.xls"));
check("no location columns were reintroduced", !report.includes("اللوكيشن") && !report.includes("مكان الحضور") && !report.includes("locationResult"));

check("attendance report has branch filter", report.includes("branchId") && report.includes("كل الفروع") && attendanceEndpoint.includes('request.query.branchId') && attendanceEndpoint.includes('effectiveBranchId'));
check("excel export includes branch filter", report.includes("fetchReportPayload(from, to, employeeIds, branchId)"));
check("normal logout does not close attendance", !read("server/auth/logout.ts").includes("checkoutCurrentAttendance") && read("server/auth/logout.ts").includes("attendanceCheckedOut: false"));
check("manual attendance checkout is separate", attendanceEndpoint.includes('action === "self_check_out"') && read("src/components/Sidebar.tsx").includes("handleCheckOut") && read("src/components/Sidebar.tsx").includes("تسجيل خروج بدون إنهاء فترة الحضور"));
check("device agent compatible build version is v1.1.0", agent.includes('agentVersion = "1.1.0"'));
check("employee number is hidden from attendance report rows", !report.includes("{row.employeeNo ? <small>{row.employeeNo}</small> : null}"));
check("employee number is hidden from employee filter labels", !report.includes("[employee.employee_no, employee.branch_name].filter(Boolean).join"));
check("no patch or hotfix markers were introduced", ![deviceSchema, deviceService, deviceEndpoint, attendanceEndpoint, loginServer, settings, report].some((text) => /HOTFIX|PATCH[-_ ]?ON[-_ ]?PATCH/i.test(text)));

let failed = 0;
for (const item of checks) {
  if (item.ok) console.log(`PASS: ${item.name}`);
  else { failed += 1; console.error(`FAIL: ${item.name}`); }
}
console.log(`\nGlobal attendance + Device Agent + report v98 checks: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
