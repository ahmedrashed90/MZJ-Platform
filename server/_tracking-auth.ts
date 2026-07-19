import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isSystemAdmin, requireUser, type SessionUser } from "./_auth.js";

export function canAccessTracking(user: SessionUser) {
  return isSystemAdmin(user) || user.permissionCodes.includes("tracking.view")
    || user.roleCodes.some((code) => ["tracking_user", "sales_manager", "branch_manager", "operations_user"].includes(code))
    || user.departmentCodes.includes("tracking");
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
