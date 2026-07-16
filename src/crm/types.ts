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

export type CrmMeta = {
  ok: boolean;
  statuses: CrmStatus[];
  branches: Array<{ code: string; name: string; sort_order: number }>;
  users: CrmUserOption[];
  sources: Array<{ code: string; name: string }>;
  templates: Array<{ id: string; display_name: string; content: string; template_type: string; provider?: string | null; departments: string[] }>;
  mappings: Array<{ id: string; department_code: string; status_value: string; status_label: string; template_id: string; message_type: string }>;
  quality: Record<string, unknown> | null;
  endpoints: Array<Record<string, unknown>>;
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
  color?: string | null;
  finance_type?: string | null;
  follow_up_at?: string | null;
  campaign_name?: string | null;
  campaign_date?: string | null;
  notes?: string | null;
  status_note?: string | null;
  completion_percent?: number | null;
  assigned_to?: string | null;
  assigned_name?: string | null;
  call_center_assigned_to?: string | null;
  call_center_name?: string | null;
  conversation_id?: string | null;
  channel_code?: string | null;
  delivery_channel?: string | null;
  message_policy?: "free_text_and_templates" | "templates_only" | null;
  preview_text?: string | null;
  unread_count?: number | null;
  last_message_at?: string | null;
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
  file_name?: string | null;
  provider_status?: string | null;
  sent_by_name?: string | null;
  created_at: string;
};
