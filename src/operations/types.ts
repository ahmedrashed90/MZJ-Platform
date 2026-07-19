export type OperationsLocation={id:string;code:string;name:string;notes?:string|null;sort_order:number;branch_id?:string|null;branch_name?:string|null;branch_code?:string|null};
export type VehicleStatus={code:string;name:string;counts_in_inventory:boolean;is_final:boolean;requires_approvals:boolean;sort_order:number};
export type CheckItem={code:string;name:string;sort_order:number};
export type OperationsMeta={locations:OperationsLocation[];statuses:VehicleStatus[];checkItems:CheckItem[];branches:Array<{id:string;code:string;name:string}>;permissionCodes:string[];isSystemAdmin:boolean};
export type Pagination={page:number;pageSize:number;total:number;pages:number};

export type TrackingState="no_request"|"not_started"|"in_progress"|"completed"|"cancelled"|"rejected"|"deleted"|"unavailable";
export type VehicleRow={
  id:string;vin:string;car_name:string|null;statement:string|null;agent_name:string|null;interior_color:string|null;exterior_color:string|null;
  model_year:string|null;plate_no:string|null;batch_no:string|null;location_id:string|null;location_name:string|null;location_code?:string|null;
  branch_name?:string|null;place_notes:string|null;notes:string|null;status_note?:string|null;booking_shortage_location_notes:string|null;
  status_code:string;status_name:string|null;source_type:string|null;has_notes:boolean;archived_at:string|null;archive_reason:string|null;
  financial_approved:boolean;administrative_approved:boolean;financial_approved_at?:string|null;administrative_approved_at?:string|null;
  check_items:Record<string,boolean>;movements_count:number;requests_count:number;shortages_count:number;version:number;
  tracking_state:TrackingState;tracking_sync_state?:"available"|"unavailable";tracking_order_id?:string|null;tracking_vehicle_id?:string|null;
  tracking_order_no?:string|null;tracking_status?:string|null;tracking_progress:number;tracking_current_stage?:string|null;tracking_updated_at?:string|null;
  created_by_name?:string|null;updated_by_name?:string|null;created_at:string;updated_at:string;
};
export type VehicleDetail=VehicleRow&{
  checks:Array<{code:string;name:string;is_present:boolean;note?:string|null;updated_at?:string|null;updated_by_name?:string|null}>;
  checkHistory:Array<{id:string;item_code:string;item_name:string;old_value:boolean|null;new_value:boolean;note?:string|null;changer_name:string;created_at:string}>;
  movements:MovementRow[];
  approvals:Array<{id:string;approval_type:string;action:string;performer_name:string;performer_role?:string|null;performer_branch?:string|null;note?:string|null;created_at:string}>;
  requests:Array<Pick<RequestRow,"id"|"request_no"|"transfer_type"|"status"|"photography_date"|"notes"|"requested_at"|"completed_at"|"cancelled_at"|"cancellation_reason">>;
  shortages:Array<{id:string;shortage_type:string;note?:string|null;is_resolved:boolean;created_at:string;resolved_at?:string|null}>;
  notes:Array<{id:string;note_type:string;note:string;creator_name:string;created_at:string}>;
  trackingHistory:Array<TrackingRequest>;
  archive?:{id:string;reason:string;archived_by_name:string;archived_at:string;tracking_order_id?:string|null}|null;
  audit?:Array<{id:string;actor_name?:string|null;actor_role?:string|null;actor_branch?:string|null;action:string;reason?:string|null;is_override:boolean;created_at:string}>;
  financial_approved_by_name?:string|null;administrative_approved_by_name?:string|null;financial_note?:string|null;administrative_note?:string|null;
};
export type MovementRow={
  id:string;created_at:string;movement_type:string;batch_id?:string|null;vehicle_id?:string;vin:string;car_name?:string|null;statement?:string|null;
  from_location_name?:string|null;to_location_name?:string|null;old_status_name?:string|null;new_status_name?:string|null;performer_name?:string|null;
  performer_role?:string|null;performer_branch?:string|null;note?:string|null;status_note?:string|null;place_note?:string|null;shortage_note?:string|null;
  request_id?:string|null;request_no?:string|null;
};
export type RequestVehicle={id:string;vin:string;carName?:string|null;statement?:string|null;modelYear?:string|null;currentLocationName?:string|null;currentLocationId?:string|null;currentStatusCode?:string|null;receivedLocationName?:string|null;receivedStatusCode?:string|null;notes?:string|null};
export type RequestEvent={id?:string;stageCode:string;action?:string;performerName:string;performerRole?:string|null;performerBranch?:string|null;note?:string|null;createdAt:string;isOverride?:boolean;overrideReason?:string|null};
export type RequestRow={
  id:string;request_no:string;transfer_type:"transfer"|"photography";status:string;photography_date?:string|null;target_status_code?:string|null;target_status_name?:string|null;
  notes?:string|null;source_location_id?:string|null;source_location_name?:string|null;destination_location_id?:string|null;destination_location_name?:string|null;
  source_branch_id?:string|null;source_branch_name?:string|null;destination_branch_id?:string|null;destination_branch_name?:string|null;
  requested_by_name?:string|null;requested_at:string;updated_at?:string;completed_at?:string|null;cancelled_at?:string|null;cancellation_reason?:string|null;
  version:number;started_at?:string|null;vehicles:RequestVehicle[];events:RequestEvent[];
};
export type TrackingRequest={tracking_order_id:string;tracking_vehicle_id:string;request_no:string;status:string;progress:number;current_stage?:string|null;created_at:string;updated_at:string;completed_at?:string|null;is_deleted:boolean;is_cancelled:boolean;is_rejected:boolean;is_archived:boolean};
export type ReportRow={car_name:string;statement:string;model_year:string;location_name:string;status_name:string;total:number};
export type ImportPreviewRow={rowNumber:number;vin:string;valid:boolean;errors:string[];action?:"insert"|"update";normalized?:Record<string,unknown>};
export type OperationsView="inventory"|"manage"|"import-export"|"movements"|"bulk-movement"|"requests"|"approvals"|"all-vehicles"|"movement-log"|"archive";
