import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearSession, getSessionUser, requestIp } from "../_auth.js";
import { logSecurityEvent } from "../_access-control.js";
import { checkoutCurrentAttendance } from "../_attendance.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await getSessionUser(request).catch(() => null);
  let attendanceRecord: any = null;
  if (user) {
    try {
      attendanceRecord = await checkoutCurrentAttendance(user.id, { allowMissing: true, revokeSessions: false });
    } catch (error) {
      console.error("Attendance checkout before logout failed", error);
      return response.status(500).json({
        ok: false,
        error: "تعذر تسجيل الانصراف. حاول مرة أخرى قبل تسجيل الخروج.",
      });
    }
  }

  await clearSession(request, response);
  if (user) await logSecurityEvent({ request, user, systemCode: "core", pageCode: "login", action: "logout", result: "success", ipAddress: requestIp(request) });
  return response.status(200).json({
    ok: true,
    attendanceCheckedOut: Boolean(attendanceRecord),
    periodName: attendanceRecord?.period_name || null,
    checkOut: attendanceRecord?.check_out || null,
  });
}
