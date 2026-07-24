import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, type SessionUser } from "./_auth.js";
import { canAccessSystem, isPlatformAdmin } from "../shared/system-access.js";

export function isSystemAdmin(user: SessionUser) {
  return isPlatformAdmin(user);
}

export function hasPermission(user: SessionUser, permission: string) {
  return isSystemAdmin(user) || user.permissions.includes(permission);
}

export function canAccessOperations(user: SessionUser) {
  return canAccessSystem(user, "operations");
}

export async function requireOperationsUser(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request, response);
  if (!user) return null;
  if (!canAccessOperations(user)) {
    response.status(403).json({ ok: false, code: "FORBIDDEN", error: "لا توجد لديك صلاحية للدخول إلى نظام العمليات" });
    return null;
  }
  return user;
}

export function requireOperationsPermission(user: SessionUser, permission: string, response: VercelResponse) {
  if (hasPermission(user, permission)) return true;
  response.status(403).json({ ok: false, code: "FORBIDDEN", error: "لا توجد لديك صلاحية لتنفيذ هذا الإجراء" });
  return false;
}

export function primaryRole(user: SessionUser) {
  return user.roles[0] || user.roleCodes[0] || "مستخدم المنصة";
}

export function primaryBranch(user: SessionUser) {
  return user.branches[0] || user.branchCodes[0] || "";
}
