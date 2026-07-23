import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, type SessionUser } from "./_auth.js";

export function isMarketingAdmin(user: SessionUser) {
  return user.roleCodes.some((code) => ["admin", "system_admin"].includes(code));
}

export function hasMarketingPermission(user: SessionUser, permission: string) {
  return isMarketingAdmin(user) || user.permissions.includes(permission);
}

export async function requireMarketingUser(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request, response);
  if (!user) return null;
  const allowed = isMarketingAdmin(user)
    || user.departmentCodes.includes("marketing")
    || user.roleCodes.includes("marketing_user")
    || user.permissions.some((permission) => permission.startsWith("marketing."));
  if (!allowed) {
    response.status(403).json({ ok: false, error: "لا تملك صلاحية الدخول إلى نظام التسويق" });
    return null;
  }
  return user;
}
