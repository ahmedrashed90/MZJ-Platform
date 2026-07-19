import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, type SessionUser } from "./_auth.js";

const fullAccessRoles = new Set(["system_admin"]);

export function isSystemAdmin(user: SessionUser) {
  return user.roleCodes.some((code) => fullAccessRoles.has(code));
}

export function canDeleteVehicle(user: SessionUser) {
  return isSystemAdmin(user) || user.permissions.includes("operations.vehicle.delete");
}

export function canReplaceInventory(user: SessionUser) {
  return isSystemAdmin(user) || user.permissions.includes("operations.vehicles.replace");
}

export function hasOperationsAccess(user: SessionUser) {
  return isSystemAdmin(user)
    || user.departmentCodes.includes("operations")
    || user.roleCodes.some((code) => ["operations_manager", "operations_user", "accounting_manager", "branch_manager"].includes(code))
    || user.permissions.some((code) => code === "operations.view" || code.startsWith("operations."));
}

export function can(user: SessionUser, permission: string) {
  if (isSystemAdmin(user)) return true;
  if (user.permissions.includes(permission)) return true;
  if (user.roleCodes.includes("operations_manager") && permission.startsWith("operations.")) return true;
  if (user.roleCodes.includes("accounting_manager")) {
    return ["operations.view", "operations.vehicles.view", "operations.vehicles.export", "operations.requests.view", "operations.approvals.view", "operations.approvals.financial"].includes(permission);
  }
  if (user.roleCodes.includes("operations_user") || user.departmentCodes.includes("operations")) {
    return [
      "operations.view",
      "operations.vehicles.view",
      "operations.movements.create",
      "operations.requests.view",
      "operations.requests.create",
      "operations.requests.progress",
      "operations.tracking.view",
    ].includes(permission);
  }
  if (user.roleCodes.includes("branch_manager")) {
    return [
      "operations.view",
      "operations.vehicles.view",
      "operations.vehicles.export",
      "operations.requests.view",
      "operations.requests.create",
      "operations.requests.progress",
    ].includes(permission);
  }
  return false;
}

export async function requireOperationsUser(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request, response);
  if (!user) return null;
  if (!hasOperationsAccess(user)) {
    response.status(403).json({ ok: false, code: "FORBIDDEN", error: "ليس لديك صلاحية الدخول إلى نظام العمليات" });
    return null;
  }
  return user;
}

export function requirePermission(response: VercelResponse, user: SessionUser, permission: string) {
  if (can(user, permission)) return true;
  response.status(403).json({ ok: false, code: "FORBIDDEN", error: "ليس لديك صلاحية تنفيذ هذا الإجراء" });
  return false;
}

export function userBranchScope(user: SessionUser): string[] | null {
  if (isSystemAdmin(user) || user.roleCodes.some((code) => ["operations_manager", "accounting_manager"].includes(code))) return null;
  return user.branchCodes.length ? user.branchCodes : [];
}

export function actorRole(user: SessionUser) {
  return user.roleCodes[0] || "user";
}

export function actorBranch(user: SessionUser) {
  return user.branchCodes[0] || null;
}
