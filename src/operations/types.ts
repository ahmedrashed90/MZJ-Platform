export type OperationsLocation = { id: string; code: string; name: string; branch_code: string | null; sort_order: number };
export type OperationsStatus = { code: string; name: string; sort_order: number; counts_as_active_inventory: boolean; is_final: boolean; requires_status_note: boolean };
export type ChecklistItem = { code: string; name: string; sort_order: number; is_present?: boolean; note?: string | null; updated_at?: string | null; updated_by_name?: string | null };
export type OperationsMeta = { locations: OperationsLocation[]; statuses: OperationsStatus[]; checklist: ChecklistItem[] };

export type VehicleRow = {
  id: string; vin: string; car_name: string | null; statement: string | null; agent_name: string | null;
  interior_color: string | null; exterior_color: string | null; model_year: string | null; plate_no: string | null; batch_no: string | null;
  branch_code: string | null; status_code: string; status_name: string | null; has_notes: boolean; notes: string | null; status_notes: string | null;
  missing_reservation_location: string | null; version: number; is_archived: boolean; archived_at: string | null; archive_reason: string | null;
  created_at: string; updated_at: string; location_id: string | null; location_code: string | null; location_name: string | null; location_branch_code: string | null;
  financial_approved: boolean; administrative_approved: boolean; financial_note: string | null; administrative_note: string | null; cycle_no: number | null;
  tracking_order_id: string | null; tracking_request_no: string | null; tracking_status: string | null; tracking_progress: number | null; tracking_updated_at: string | null; tracking_is_archived: boolean | null;
  last_movement_at: string | null; last_from_location: string | null; last_to_location: string | null; last_old_status: string | null; last_new_status: string | null;
};
export type VehicleDetail = {
  vehicle: VehicleRow & Record<string, unknown>;
  checklist: ChecklistItem[];
  approval: Record<string, unknown> | null;
  approvalEvents: Array<Record<string, unknown>>;
  movements: Array<Record<string, unknown>>;
  requests: Array<Record<string, unknown>>;
  trackingOrders: Array<Record<string, unknown>>;
  statusNotes: Array<Record<string, unknown>>;
};
export type OperationsRequest = {
  id: string; request_no: string; request_type: "transfer" | "photo"; source_location_id: string | null; destination_location_id: string | null;
  source_location_name: string | null; destination_location_name: string | null; source_branch_code: string | null; destination_branch_code: string | null;
  status: string; current_stage: number; reason: string | null; priority: string | null; photography_type: string | null; photography_date: string | null;
  notes: string | null; requested_by_name: string | null; requested_by_branch: string | null; requested_at: string; completed_at: string | null;
  cancellation_reason: string | null; vehicles_count: number; vins: string; vehicles: VehicleRow[]; events?: Array<Record<string, unknown>>; movements?: Array<Record<string, unknown>>;
};
export type ApprovalRow = {
  id: string; vehicle_id: string; vin: string; car_name: string | null; statement: string | null; model_year: string | null;
  interior_color: string | null; exterior_color: string | null; status_code: string; status_name: string | null; location_name: string | null; branch_code: string | null;
  financial_approved: boolean; administrative_approved: boolean; financial_note: string | null; administrative_note: string | null;
  financial_approved_by_name: string | null; administrative_approved_by_name: string | null; financial_approved_at: string | null; administrative_approved_at: string | null;
};
export type ShortageRow = { branch_code: string; branch_name: string; car_name: string; statement: string; model_year: string; exterior_color: string; interior_color: string; branch_count: number; existing_locations: string[]; total_count: number; combination_key: string };
export type OperationsDashboard = {
  inventory: { actualTotal: number; agency: number; availableForSale: number; underDelivery: number; hasNotes: number };
  locations: Array<{ key: string; name: string; actualTotal: number; underDelivery: number; availableForSale: number; reserved: number; delivered: number; hasNotes: number }>;
  approvals: { total: number; missingFinancial: number; missingAdministrative: number; completed: number };
  shortages: { total: number; multaqa: number; hall: number; qadisiyah: number };
  transfers: { total: number; requestReceived: number; vehicleSent: number; vehicleReceived: number; completed: number };
  requests?: OperationsRequest[];
};
