import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, type SessionUser } from "./_auth.js";
import { canAccessSystem } from "../shared/system-access.js";

export function canAccessTracking(user: SessionUser) {
  return canAccessSystem(user, "tracking");
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
