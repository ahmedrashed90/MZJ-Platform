export type OperationsLocation = {
  id: string;
  code: string;
  name: string;
  location_type: string;
  branch_id?: string | null;
  branch_code?: string | null;
  branch_name?: string | null;
  sort_order: number;
};

export type OperationsStatus = {
  code: string;
  name: string;
  sort_order: number;
  counts_in_actual_inventory: boolean;
  requires_approvals: boolean;
  allows_archive: boolean;
};

export type ContentDefinition = { key: string; label: string };
export type VehicleContents = Record<string, boolean>;

export type OperationsMeta = {
  ok: boolean;
  locations: OperationsLocation[];
  statuses: OperationsStatus[];
  permissions: string[];
  roles: string[];
  branches: string[];
  contents: ContentDefinition[];
};

export type OperationsVehicle = {
  id: string;
  legacy_id?: string | null;
  vin: string;
  car_name: string | null;
  statement: string | null;
  agent_name: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  model_year: string | null;
  plate_no: string | null;
  batch_no: string | null;
  location_id: string | null;
  location_code: string | null;
  location_name: string | null;
  status_code: string;
  status_name: string | null;
  source_type?: string | null;
  location_note: string | null;
  shortage_note: string | null;
  notes: string | null;
  contents: VehicleContents | null;
  has_notes: boolean;
  is_archived: boolean;
  archived_at?: string | null;
  archive_note?: string | null;
  archived_by_name?: string | null;
  created_at: string;
  updated_at: string;
  financial_approved: boolean;
  administrative_approved: boolean;
  financial_note?: string | null;
  administrative_note?: string | null;
  financial_approved_at?: string | null;
  administrative_approved_at?: string | null;
  financial_approved_by_name?: string | null;
  administrative_approved_by_name?: string | null;
  movements_count: number;
  last_movement_at?: string | null;
  tracking_completed: boolean;
  shortages_count?: number;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  movements?: OperationsMovement[];
  shortages?: Array<{
    id: string;
    shortage_type: string;
    note: string | null;
    is_resolved: boolean;
    created_at: string;
    resolved_at: string | null;
    created_by_name?: string | null;
    resolved_by_name?: string | null;
  }>;
  requests?: Array<{
    id: string;
    request_no: string;
    transfer_type: string;
    status: string;
    current_stage: number;
    requested_at: string;
    completed_at: string | null;
    destination_name: string | null;
  }>;
};

export type VehicleCounts = {
  active: number;
  actual_inventory: number;
  available_for_sale: number;
  under_delivery: number;
  has_notes: number;
  archived: number;
};

export type OperationsMovement = {
  id: string;
  movement_type: string;
  old_status: string | null;
  new_status: string | null;
  old_status_name?: string | null;
  new_status_name?: string | null;
  note: string | null;
  performed_by_name: string | null;
  created_at: string;
  vehicle_id?: string;
  vin?: string;
  car_name?: string | null;
  statement?: string | null;
  model_year?: string | null;
  exterior_color?: string | null;
  interior_color?: string | null;
  from_location_id?: string | null;
  from_location_code?: string | null;
  from_location_name: string | null;
  to_location_id?: string | null;
  to_location_code?: string | null;
  to_location_name: string | null;
  batch_id?: string | null;
  batch_no?: string | null;
  request_id?: string | null;
  request_no?: string | null;
};

export type RequestVehicle = {
  id: string;
  vin: string;
  car_name: string | null;
  statement: string | null;
  model_year: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  status_code: string;
  status_name: string | null;
  current_location_name: string | null;
  source_location_id: string | null;
  source_location_name: string | null;
  destination_location_id: string | null;
  destination_location_name: string | null;
  target_status_code: string | null;
  target_status_name: string | null;
  note: string | null;
};

export type OperationsRequest = {
  id: string;
  request_no: string;
  department_code?: string | null;
  transfer_type: "transfer" | "photo";
  source_location_id?: string | null;
  source_location_name?: string | null;
  destination_location_id?: string | null;
  destination_location_name?: string | null;
  target_status_code?: string | null;
  target_status_name?: string | null;
  status: string;
  current_stage: number;
  photo_date?: string | null;
  notes?: string | null;
  requested_by?: string | null;
  requested_by_name: string | null;
  requested_at: string;
  completed_by?: string | null;
  completed_by_name?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at: string;
  vehicles_count?: number;
  vins?: string | null;
  vehicles?: RequestVehicle[];
  events?: Array<{
    id: string;
    stage_no: number;
    action: string;
    actor_id: string | null;
    actor_name: string | null;
    note: string | null;
    created_at: string;
  }>;
};

export type RequestCounts = {
  active: number;
  not_started: number;
  request_received: number;
  vehicle_sent: number;
  vehicle_received: number;
  completed: number;
};

export type AllCarsRow = {
  car_name: string;
  statement: string;
  model_year: string;
  total: number;
  available_for_sale: number;
  reserved: number;
  has_notes: number;
  warehouse: number;
  agency: number;
  hall: number;
  qadisiyah: number;
  multaqa: number;
  last_update: string;
};
