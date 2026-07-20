export type OperationsLocation = { id: string; code: string; name: string; sort_order: number; is_active: boolean };
export type OperationsStatus = { code: string; label: string; sort_order: number; is_active: boolean };
export type InteriorColor = { id: string; name: string; sort_order: number; is_active: boolean };
export type ChecklistItem = { key: string; label: string };

export type OperationsPermissions = {
  canReadVehicles: boolean;
  canCreateVehicles: boolean;
  canUpdateVehicles: boolean;
  canImportVehicles: boolean;
  canExportVehicles: boolean;
  canArchiveVehicles: boolean;
  canReadMovements: boolean;
  canExecuteMovements: boolean;
  canReadRequests: boolean;
  canCreateRequests: boolean;
  canDeleteRequests: boolean;
  canAdvanceRequests: boolean;
  canManageApprovals: boolean;
  canManageSettings: boolean;
};

export type OperationsMeta = {
  locations: OperationsLocation[];
  statuses: OperationsStatus[];
  interiorColors: InteriorColor[];
  checklistItems: ChecklistItem[];
  permissions: OperationsPermissions;
};

export type Vehicle = {
  id: string;
  vin: string;
  car_name: string | null;
  statement: string | null;
  agent_name: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  model_year: string | null;
  plate_no: string | null;
  batch_no: string | null;
  status_code: string;
  status_label: string | null;
  source_type: string | null;
  has_notes: boolean;
  notes: string | null;
  location_note: string | null;
  shortage_note: string | null;
  car_note: string | null;
  tracking_url: string | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  location_id: string | null;
  location_code: string | null;
  location_name: string | null;
  financial_approved: boolean;
  administrative_approved: boolean;
  financial_note?: string | null;
  administrative_note?: string | null;
  financial_approved_at?: string | null;
  administrative_approved_at?: string | null;
  financial_approved_by_name?: string | null;
  administrative_approved_by_name?: string | null;
  movements_count: number;
  has_tracking: boolean;
  checklist?: Record<string, boolean>;
  movements?: Movement[];
  shortages?: Array<{ id: string; shortage_type: string; note: string | null; is_resolved: boolean; resolved_at: string | null; created_at: string }>;
};

export type Movement = {
  id: string;
  vehicle_id: string;
  vin: string;
  car_name: string | null;
  model_year: string | null;
  old_status: string | null;
  new_status: string | null;
  note: string | null;
  movement_type: string;
  created_at: string;
  from_location_code: string | null;
  from_location_name: string | null;
  to_location_code: string | null;
  to_location_name: string | null;
  performed_by_name: string | null;
  request_no: string | null;
};

export type TransferVehicle = { vehicleId: string; vin: string; carName: string | null; note: string | null };
export type RequestEvent = { stageCode: string; stageLabel: string; note: string | null; performedBy: string | null; createdAt: string };
export type TransferRequest = {
  id: string;
  request_no: string;
  department_code: string | null;
  transfer_type: "transfer" | "photo";
  status: "request_received" | "vehicle_sent" | "vehicle_received" | "completed";
  photo_date: string | null;
  target_status_code: string | null;
  notes: string | null;
  requested_at: string;
  completed_at: string | null;
  updated_at: string;
  source_location_name: string | null;
  destination_location_name: string | null;
  source_location_code: string | null;
  destination_location_code: string | null;
  requested_by_name: string | null;
  vehicles: TransferVehicle[];
  events: RequestEvent[];
};

export type AvailabilityRow = {
  car_name: string | null;
  statement: string | null;
  model_year: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  quantity: number;
  location_counts: Record<string, number>;
};
