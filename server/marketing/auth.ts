import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, type SessionUser } from "../_auth.js";

const ADMIN_ROLES = new Set(["admin", "system_admin"]);

export function isMarketingAdmin(user: SessionUser) {
  return user.roleCodes.some((code) => ADMIN_ROLES.has(code));
}

export function canAccessMarketing(user: SessionUser) {
  return isMarketingAdmin(user)
    || user.permissions.includes("marketing.view")
    || user.departmentCodes.includes("marketing")
    || user.departmentCodes.some((code) => ["content", "design", "montage", "photography"].includes(code))
    || user.roleCodes.includes("marketing_user");
}

export function hasMarketingPermission(user: SessionUser, permission: string) {
  return isMarketingAdmin(user) || user.permissions.includes(permission);
}

export async function requireMarketingUser(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request, response);
  if (!user) return null;
  if (!canAccessMarketing(user)) {
    response.status(403).json({ ok: false, error: "لا تملك صلاحية دخول نظام التسويق" });
    return null;
  }
  return user;
}

export function requirePermission(response: VercelResponse, user: SessionUser, permission: string) {
  if (hasMarketingPermission(user, permission)) return true;
  response.status(403).json({ ok: false, error: "لا تملك الصلاحية المطلوبة لتنفيذ هذا الإجراء" });
  return false;
}
