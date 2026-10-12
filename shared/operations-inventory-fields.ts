// Columns with individual visibility controls; VIN remains visible so a vehicle can always be identified.
export const OPERATIONS_INVENTORY_FIELDS = [
  { key: "car", label: "السيارة", permission: "operations.inventory.column.car" },
  { key: "statement", label: "البيان", permission: "operations.inventory.column.statement" },
  { key: "agent", label: "الوكيل", permission: "operations.inventory.column.agent" },
  { key: "interior", label: "اللون الداخلي", permission: "operations.inventory.column.interior" },
  { key: "exterior", label: "اللون الخارجي", permission: "operations.inventory.column.exterior" },
  { key: "model", label: "الموديل", permission: "operations.inventory.column.model" },
  { key: "plate", label: "اللوحة", permission: "operations.inventory.column.plate" },
  { key: "batch", label: "اسم الدفعة", permission: "operations.inventory.column.batch" },
  { key: "location", label: "المكان", permission: "operations.inventory.column.location" },
  { key: "status", label: "الحالة", permission: "operations.inventory.column.status" },
  { key: "tajyeer", label: "التجيير", permission: "operations.inventory.column.tajyeer" },
  { key: "checks", label: "التشييك", permission: "operations.inventory.column.checks" },
  { key: "financialApproval", label: "الموافقة المالية", permission: "operations.inventory.column.financialApproval" },
  { key: "administrativeApproval", label: "الموافقة الإدارية", permission: "operations.inventory.column.administrativeApproval" },
  { key: "tracking", label: "التراكينج", permission: "operations.inventory.column.tracking" },
] as const;

// Existing inventory access keeps its columns unless an explicit per-user field denial is saved.
export function canViewOperationsInventoryField(access: { permissions: string[]; deniedPermissions?: string[] }, fieldPermission: string) {
  if (access.deniedPermissions?.includes(fieldPermission)) return false;
  return access.permissions.includes("platform.superadmin") || access.permissions.includes(fieldPermission) || access.permissions.includes("operations.inventory.view");
}
