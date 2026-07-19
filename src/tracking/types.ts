export type TrackingStatus = "not_started" | "in_progress" | "completed";

export type TrackingStage = {
  stage_id: string;
  vehicle_stage_id?: string | null;
  code: string;
  name: string;
  description?: string | null;
  owner_type: string;
  sort_order: number;
  sms_enabled: boolean;
  is_active: boolean;
  status: "pending" | "completed";
  completed_at?: string | null;
  reverted_at?: string | null;
  completed_by_name?: string | null;
  reverted_by_name?: string | null;
};

export type TrackingVehicle = {
  id: string;
  vin: string;
  item_no?: string | null;
  car_name?: string | null;
  item_type?: string | null;
  item_category?: string | null;
  item_model?: string | null;
  interior_color?: string | null;
  exterior_color?: string | null;
  dealer?: string | null;
  qty?: number | string | null;
  unit_price?: number | string | null;
  item_value?: number | string | null;
  subtotal_excl_vat?: number | string | null;
  tax_value?: number | string | null;
  total_incl_vat?: number | string | null;
  registration_fee?: number | string | null;
  stages: TrackingStage[];
};

export type TrackingOrderRow = {
  id: string;
  sales_order_no: string;
  customer_name?: string | null;
  customer_mobile?: string | null;
  branch?: string | null;
  order_date?: string | null;
  delivery_date?: string | null;
  sales_person?: string | null;
  status: TrackingStatus;
  tracking_token?: string | null;
  is_archived?: boolean;
  archived_at?: string | null;
  archived_by_name?: string | null;
  archive_reason?: string | null;
  subtotal_before_tax?: number | string | null;
  tax_value?: number | string | null;
  total_incl_vat?: number | string | null;
  registration_fee?: number | string | null;
  vehicles_count: number;
  completed_stages: number;
  total_stages: number;
  vins?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TrackingOrderDetail = TrackingOrderRow & {
  customer_vat?: string | null;
  vehicles: TrackingVehicle[];
  events: Array<{
    id: string;
    action: "completed" | "reverted";
    actor_name?: string | null;
    note?: string | null;
    created_at: string;
    stage_name: string;
    sort_order: number;
    vin?: string | null;
    item_no?: string | null;
  }>;
  smsMessages: Array<{
    id: string;
    phone: string;
    message: string;
    status: string;
    firestore_document_id?: string | null;
    queued_by_name?: string | null;
    queued_at: string;
    sent_at?: string | null;
    stage_name?: string | null;
    sort_order?: number | null;
    vin?: string | null;
  }>;
};

export type TrackingCounts = {
  total: number;
  not_started: number;
  in_progress: number;
  completed: number;
  archived: number;
};

export type PublicTrackingOrder = {
  id: string;
  sales_order_no: string;
  customer_name?: string | null;
  branch?: string | null;
  order_date?: string | null;
  delivery_date?: string | null;
  subtotal_before_tax?: number | string | null;
  tax_value?: number | string | null;
  total_incl_vat?: number | string | null;
  registration_fee?: number | string | null;
  status: TrackingStatus;
  is_archived?: boolean;
  updated_at?: string | null;
  vehicles: TrackingVehicle[];
};
