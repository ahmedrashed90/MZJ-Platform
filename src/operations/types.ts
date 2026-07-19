export type OperationLocation = { id:string; code:string; name:string };
export type OperationStatus = { code:string; name:string; requires_note:boolean; requires_approvals:boolean; is_final:boolean };
export type VehicleRow = {
  id:string; vin:string; car_name?:string; statement?:string; agent_name?:string; interior_color?:string; exterior_color?:string;
  model_year?:string; plate_no?:string; batch_no?:string; location_id?:string; location_code?:string; location_name?:string; status_code:string; status_name?:string;
  notes?:string; status_note?:string; shortage_location_note?:string; archived_at?:string; archive_reason?:string;
  financial_approved?:boolean; administrative_approved?:boolean; shortages_count?:number; checks_count?:number; active_transfers?:number;
  tracking_order_id?:string; tracking_order_no?:string; tracking_status?:string; tracking_progress?:number;
};
export type TransferRow = { id:string; request_no:string; transfer_type:string; status:string; requested_by?:string; requested_by_name?:string; requested_by_branch?:string; requested_at:string; note?:string; source_location?:string; destination_location?:string; vehicle_count:number; vehicles:Array<{id:string;vin:string;carName?:string;statement?:string}> };
export type ApprovalRow = { id:string; vin:string; car_name?:string; statement?:string; model_year?:string; location_name?:string; cycle_id?:string; cycle_no?:number; financial_approved:boolean; administrative_approved:boolean; financial_note?:string; administrative_note?:string; financial_approved_by_name?:string; administrative_approved_by_name?:string; financial_approved_at?:string; administrative_approved_at?:string };
export type MovementRow = { id:string; created_at:string; vin:string; car_name?:string; from_location?:string; to_location?:string; old_status?:string; new_status?:string; note?:string; status_note?:string; shortage_location_note?:string; performed_by_name?:string; performed_branch?:string; request_no?:string; batch_no?:string };
