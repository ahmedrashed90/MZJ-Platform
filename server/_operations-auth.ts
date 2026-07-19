import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, type SessionUser } from "./_auth.js";

export type OperationsUser = SessionUser & { isSystemAdmin: boolean };

export function hasOperationsPermission(user: SessionUser, permission: string) {
  if (canAccessAllOperationsBranches(user)) return true;
  return user.permissions.includes(permission);
}

export async function requireOperationsUser(
  request: VercelRequest,
  response: VercelResponse,
  permission = "operations.view",
) {
  const user = await requireUser(request, response);
  if (!user) return null;
  const belongsToOperations = user.departmentCodes.includes("operations") || user.roleCodes.some((code) => [
    "operations_user", "operations_admin", "operations_branch_admin", "branch_manager", "sales_manager",
  ].includes(code));
  if (!user.isSystemAdmin && !belongsToOperations && !hasOperationsPermission(user, permission)) {
    response.status(403).json({ ok: false, error: "ليس لديك صلاحية دخول نظام العمليات" });
    return null;
  }
  if (!hasOperationsPermission(user, permission) && permission !== "operations.view") {
    response.status(403).json({ ok: false, error: "ليس لديك صلاحية تنفيذ هذا الإجراء" });
    return null;
  }
  return user as OperationsUser;
}

export function canAccessAllOperationsBranches(user: SessionUser) {
  return user.isSystemAdmin || user.roleCodes.some((code) => ["operations_admin"].includes(code));
}

export function visibleBranchCodes(user: SessionUser) {
  return canAccessAllOperationsBranches(user) ? null : user.branchCodes;
}

export function canAccessBranch(user: SessionUser, branchCode: string | null | undefined) {
  if (canAccessAllOperationsBranches(user)) return true;
  if (!branchCode) return user.branchCodes.length === 0;
  return user.branchCodes.includes(branchCode);
}
