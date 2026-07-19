import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, type SessionUser } from "./_auth.js";

export const OPERATIONS_PERMISSIONS = {
  view: "operations.view",
  vehiclesView: "operations.vehicles.view",
  vehiclesCreate: "operations.vehicles.create",
  vehiclesUpdate: "operations.vehicles.update",
  vehiclesImport: "operations.vehicles.import",
  vehiclesExport: "operations.vehicles.export",
  vehiclesArchive: "operations.vehicles.archive",
  movementsView: "operations.movements.view",
  movementsCreate: "operations.movements.create",
  requestsView: "operations.requests.view",
  requestsCreate: "operations.requests.create",
  requestsReceive: "operations.requests.receive",
  requestsDispatch: "operations.requests.dispatch",
  requestsConfirmReceipt: "operations.requests.confirm_receipt",
  requestsComplete: "operations.requests.complete",
  requestsDelete: "operations.requests.delete_before_receipt",
  financialApproval: "operations.approvals.financial",
  administrativeApproval: "operations.approvals.administrative",
  reportsAllCars: "operations.reports.all_cars",
  logsView: "operations.logs.view",
  logsExport: "operations.logs.export",
  settingsManage: "operations.settings.manage",
} as const;

export function canAccessOperations(user: SessionUser) {
  return user.roleCodes.some((code) => ["admin", "operations_user", "sales_manager", "branch_manager"].includes(code))
    || user.departmentCodes.includes("operations")
    || user.permissionCodes.some((code) => code.startsWith("operations."));
}

export function hasOperationsPermission(user: SessionUser, permission: string) {
  if (user.roleCodes.includes("admin")) return true;
  return user.permissionCodes.includes(permission);
}

export async function requireOperationsUser(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request, response);
  if (!user) return null;
  if (!canAccessOperations(user)) {
    response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية للدخول إلى نظام العمليات" });
    return null;
  }
  return user;
}

export function requireOperationsPermission(user: SessionUser, response: VercelResponse, permission: string) {
  if (hasOperationsPermission(user, permission)) return true;
  response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية لتنفيذ هذا الإجراء" });
  return false;
}
