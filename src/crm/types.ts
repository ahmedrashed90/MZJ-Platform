
export type CrmCustomerFieldOption = {
  value: string;
  label: string;
};

export type CrmCustomerField = {
  id: string;
  field_key: string;
  label: string;
  field_type: "text" | "phone" | "number" | "date" | "textarea" | "select" | "status" | "source" | "department" | "transfer";
  sort_order: number;
  department_keys: string[];
  is_active: boolean;
  is_required: boolean;
  include_in_completion: boolean;
  options: CrmCustomerFieldOption[];
  is_system: boolean;
  is_locked: boolean;
};
export type CrmStatus = {
  id: string;
  department_code: string;
  label: string;
  value: string;
  sort_order: number;
  is_active?: boolean;
  count?: number;
};

export type CrmUserOption = {
  id: string;
  full_name: string;
  employee_no?: string | null;
  department_codes: string[];
  departments: string[];
  branch_codes: string[];
  branches: string[];
  role_codes: string[];
  can_receive_leads?: boolean;
};

export type CrmMessageTemplate = {
  id: string;
  name: string;
  display_name: string;
  content: string;
  template_type: string;
  provider?: string | null;
  external_id?: string | null;
  language_code?: string | null;
  departments: string[];
};

export type CrmMeta = {
  ok: boolean;
  statuses: CrmStatus[];
  branches: Array<{ code: string; name: string; sort_order: number }>;
  users: CrmUserOption[];
  sources: Array<{ code: string; name: string; sort_order?: number; system_codes?: string[]; delivery_route?: "whatsapp" | "facebook" | "instagram" | "tiktok"; allow_free_text?: boolean }>;
  templates: CrmMessageTemplate[];
  mappings: Array<{ id: string; department_code: string; status_value: string; status_label: string; template_id: string; message_type: string }>;
  quality: Record<string, unknown> | null;
  endpoints: Array<Record<string, unknown>>;
  customerFields: CrmCustomerField[];
};

export type CrmLead = {
  id: string;
  legacy_id?: string | null;
  customer_name?: string | null;
  phone?: string | null;
  phone_normalized?: string | null;
  source_code?: string | null;
  source_name?: string | null;
  platform_code?: string | null;
  service_key?: string | null;
  department_code?: string | null;
  branch_code?: string | null;
  branch_name?: string | null;
  status_code?: string | null;
  status_label?: string | null;
  payment_type?: string | null;
  car_name?: string | null;
  location?: string | null;
  age?: number | null;
  salary?: number | string | null;
  obligation?: number | string | null;
  salary_bank?: string | null;
  car_model?: string | null;
  car_type?: string | null;
  car_category?: string | null;
  color?: string | null;
  finance_type?: string | null;
  follow_up_at?: string | null;
  campaign_name?: string | null;
  campaign_date?: string | null;
  notes?: string | null;
  status_note?: string | null;
  extra_data?: Record<string, unknown> | null;
  completion_percent?: number | null;
  credit_limit?: number | string | null;
  credit_qualified?: boolean | null;
  assigned_to?: string | null;
  assigned_name?: string | null;
  call_center_assigned_to?: string | null;
  call_center_name?: string | null;
  conversation_id?: string | null;
  conversation_legacy_id?: string | null;
  channel_code?: string | null;
  delivery_channel?: string | null;
  message_policy?: "free_text_and_templates" | "templates_only" | null;
  preview_text?: string | null;
  unread_count?: number | null;
  dashboard_unread?: boolean | null;
  has_unread_message?: boolean | null;
  has_unread_messages?: boolean | null;
  message_unread?: boolean | null;
  is_unread?: boolean | null;
  last_message_direction?: string | null;
  last_incoming_message_at?: string | null;
  last_message_at?: string | null;
  dashboard_message_read_at?: string | null;
  registered_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CrmConversation = {
  id: string;
  lead_id?: string | null;
  legacy_id?: string | null;
  channel_code: string;
  source_code?: string | null;
  source_name?: string | null;
  platform_code?: string | null;
  customer_name?: string | null;
  preview_text?: string | null;
  unread_count?: number;
  last_message_at?: string | null;
};

export type CrmMessage = {
  id: string;
  direction: "in" | "out";
  message_type: string;
  body?: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  storage_key?: string | null;
  media_asset_id?: string | null;
  media_status?: string | null;
  is_sensitive?: boolean | null;
  caption?: string | null;
  sender_type?: "customer" | "human" | "bot" | "system" | null;
  file_name?: string | null;
  provider_status?: string | null;
  sent_by_name?: string | null;
  created_at: string;
};
