import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, type SessionUser } from "./_auth.js";

export function canAccessTracking(user: SessionUser) {
  return user.roleCodes.some((code) => ["admin", "tracking_user", "sales_manager", "branch_manager", "operations_user"].includes(code))
    || (user.departmentCodes.includes("tracking") || user.departmentCodes.includes("operations"));
}

export async function requireTrackingUser(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request, response);
  if (!user) return null;
  if (!canAccessTracking(user)) {
    response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية للدخول إلى نظام التتبع" });
    return null;
  }
  return user;
}
