import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, type SessionUser } from "./_auth.js";

const readRoles = new Set(["admin", "operations_user", "sales_manager", "branch_manager"]);

export function canUseOperations(user: SessionUser) {
  return user.roleCodes.some((code) => readRoles.has(code)) || user.departmentCodes.includes("operations") || user.permissions.includes("operations.view");
}

export function hasOperationsPermission(user: SessionUser, permission: string) {
  if (user.roleCodes.includes("admin")) return true;
  if (user.permissions.includes(permission)) return true;
  if (user.roleCodes.includes("operations_user")) return true;
  if (["operations.view", "operations.vehicles.read", "operations.movements.read", "operations.requests.read", "operations.vehicles.export"].includes(permission)) {
    return canUseOperations(user);
  }
  return false;
}

export async function requireOperationsPermission(request: VercelRequest, response: VercelResponse, permission: string) {
  const user = await requireUser(request, response);
  if (!user) return null;
  if (!canUseOperations(user) || !hasOperationsPermission(user, permission)) {
    response.status(403).json({ ok: false, error: "ليست لديك صلاحية تنفيذ هذا الإجراء في نظام العمليات" });
    return null;
  }
  return user;
}
