export type OperationsMeta = {
  locations: Array<{ id:string; code:string; name:string; sort_order:number }>;
  statuses: Array<{ code:string; name:string; requires_note:boolean; counts_in_actual_inventory:boolean; is_terminal:boolean; sort_order:number }>;
  branches: Array<{ id:string; code:string; name:string }>;
  checkItems: Array<{ code:string; name:string }>;
  permissions: string[];
  systemAdmin: boolean;
};

export type VehicleRow = {
  id:string; vin:string; car_name?:string|null; statement?:string|null; agent_name?:string|null;
  interior_color?:string|null; exterior_color?:string|null; model_year?:string|null; plate_no?:string|null; batch_no?:string|null;
  location_id?:string|null; location_code?:string|null; location_name?:string|null; branch_id?:string|null; branch_code?:string|null; branch_name?:string|null;
  status_code:string; status_name?:string|null; status_note?:string|null; shortage_location_note?:string|null; notes?:string|null; has_notes?:boolean;
  archived_at?:string|null; archive_reason?:string|null; financial_approved?:boolean|null; administrative_approved?:boolean|null;
  tracking_order_id?:string|null; tracking_order_no?:string|null; tracking_status?:string|null; tracking_progress?:number|null; tracking_archived?:boolean|null;
};

export type TransferRow = {
  id:string; request_no:string; request_type:string; current_stage:string; status:string; requested_by_name?:string|null; requested_at:string;
  source_location_name?:string|null; destination_location_name?:string|null; notes?:string|null; vehicles_count:number; vins?:string|null;
  cancelled_at?:string|null; cancel_reason?:string|null;
};

export type MovementRow = {
  id:string; vin:string; car_name?:string|null; statement?:string|null; model_year?:string|null;
  from_location_name?:string|null; to_location_name?:string|null; old_status?:string|null; new_status?:string|null;
  performed_by_name?:string|null; branch_name?:string|null; note?:string|null; status_note?:string|null; shortage_location_note?:string|null;
  batch_id?:string|null; request_id?:string|null; created_at:string;
};

export type ApprovalRow = {
  vehicle_id:string; vin:string; car_name?:string|null; statement?:string|null; model_year?:string|null; location_name?:string|null; branch_name?:string|null;
  approval_id:string; cycle_no:number; financial_approved:boolean; administrative_approved:boolean; financial_note?:string|null; administrative_note?:string|null;
  financial_approved_at?:string|null; administrative_approved_at?:string|null; financial_approved_by_name?:string|null; administrative_approved_by_name?:string|null;
};
