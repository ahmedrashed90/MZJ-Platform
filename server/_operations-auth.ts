import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, type SessionUser } from "./_auth.js";
import { OperationsError } from "./_operations-errors.js";

export function isSystemAdmin(user: SessionUser) {
  return user.roleCodes.some((code) => code === "admin" || code === "system_admin");
}

export function hasPermission(user: SessionUser, permission: string) {
  return isSystemAdmin(user) || user.permissionCodes.includes(permission);
}

export async function requireOperationsUser(request: VercelRequest, response: VercelResponse, permission = "operations.view") {
  const user = await requireUser(request, response);
  if (!user) return null;
  if (!hasPermission(user, permission)) {
    throw new OperationsError(403, "FORBIDDEN", "ليس لديك صلاحية لتنفيذ هذا الإجراء");
  }
  return user;
}

export function assertPermission(user: SessionUser, permission: string) {
  if (!hasPermission(user, permission)) {
    throw new OperationsError(403, "FORBIDDEN", "ليس لديك صلاحية لتنفيذ هذا الإجراء");
  }
}
