export type PlatformSystem = "crm" | "marketing" | "operations" | "tracking";

export type SystemAccessUser = {
  roleCodes: string[];
  departmentCodes: string[];
  permissions: string[];
};

const crmDepartments = new Set(["cash_sales", "finance_sales", "customer_service", "call_center"]);

const systemRoles: Record<PlatformSystem, Set<string>> = {
  crm: new Set(["sales_user", "call_center_agent"]),
  marketing: new Set(["marketing_user"]),
  operations: new Set(["operations_user", "operations_manager", "finance_manager"]),
  tracking: new Set(["tracking_user"]),
};

export function isPlatformAdmin(user: SystemAccessUser | null | undefined) {
  return Boolean(user?.roleCodes.some((code) => code === "admin" || code === "system_admin"));
}

function hasSystemDepartment(user: SystemAccessUser, system: PlatformSystem) {
  if (system === "crm") return user.departmentCodes.some((code) => crmDepartments.has(code));
  return user.departmentCodes.includes(system);
}

export function canAccessSystem(user: SystemAccessUser | null | undefined, system: PlatformSystem) {
  if (!user) return false;
  if (isPlatformAdmin(user)) return true;
  if (user.permissions.includes(`${system}.view`)) return true;
  if (hasSystemDepartment(user, system)) return true;
  return user.roleCodes.some((code) => systemRoles[system].has(code));
}
