export type MarketingAccess = {
  isAdmin: boolean;
  canManageCampaigns: boolean;
  canApproveStructure: boolean;
  canApproveTemplates: boolean;
  canApproveTasks: boolean;
  canManagePublishing: boolean;
  canManageSettings: boolean;
};

export type MarketingUser = {
  id: string;
  full_name: string;
  email: string | null;
  can_receive_tasks: boolean;
  role_codes: string[];
  department_codes: string[];
  departments: string[];
};

export type CreativeTypeSetting = {
  code: string;
  name: string;
  department_codes: string[];
  is_active: boolean;
  sort_order: number;
};

export type PlatformSetting = {
  code: string;
  name: string;
  post_types: string[];
  is_active: boolean;
  connection_status: string;
  sort_order: number;
  metadata?: Record<string, unknown>;
};

export type MarketingMeta = {
  ok: true;
  creativeTypes: CreativeTypeSetting[];
  platforms: PlatformSetting[];
  users: MarketingUser[];
  campaignStatuses: string[];
  departmentLabels: Record<string, string>;
  access: MarketingAccess;
};

export type MarketingCampaignRow = {
  id: string;
  campaign_code: string;
  name: string;
  campaign_type: string | null;
  objective: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  due_at: string | null;
  budget_total: number;
  raw_root_path: string | null;
  structure_approved_at?: string | null;
  publish_ready_at?: string | null;
  created_by_name?: string | null;
  creatives: number;
  tasks: number;
  done_tasks: number;
  progress: number;
  created_at: string;
  updated_at: string;
};

export type CampaignCreative = {
  id: string;
  campaign_id: string;
  instance_key: string;
  creative_type: string;
  name: string;
  description: string | null;
  quantity: number;
  status: string;
  cars: Array<{ uniqueSpecKey: string; name: string; exteriorColor: string; interiorColor: string }>;
  departments: Array<{ code: string; assignedUserId: string | null; pairedContentUserId?: string | null; dueAt: string | null; notes: string }>;
  budget: number;
  sort_order: number;
  raw_path: string | null;
  output_path: string | null;
  metadata: Record<string, unknown>;
};

export type MarketingTask = {
  id: string;
  campaign_id: string;
  creative_id: string | null;
  task_key: string;
  task_type: "task_template" | "execution";
  title: string;
  department_code: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  paired_content_user_id: string | null;
  paired_content_user_name: string | null;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  notes: string | null;
  template_data: {
    proposedName?: string;
    keyMessage?: string;
    baseScript?: string;
    hook?: string;
    cta?: string;
  };
  action_data: Array<{ text: string; at: string; userId: string; userName: string }>;
  final_file_path: string | null;
  final_file_name: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  creative_name: string | null;
  instance_key?: string;
  campaign_name?: string;
  campaign_code?: string;
  campaign_status?: string;
  raw_path?: string | null;
  output_path?: string | null;
  updated_at: string;
};

export type PublishingItem = {
  id: string;
  campaign_id: string;
  creative_id: string;
  campaign_name?: string;
  campaign_code?: string;
  campaign_status?: string;
  creative_name: string;
  output_path?: string | null;
  platform_code: string;
  platform_name: string | null;
  post_type: string;
  scheduled_at: string | null;
  caption: string | null;
  hashtags: string | null;
  media_path: string | null;
  status: string;
  published_at: string | null;
  external_post_id: string | null;
  connection_status?: string | null;
};

export type MarketingAgendaItem = {
  id: string;
  title: string;
  item_type: string;
  starts_at: string;
  ends_at: string | null;
  owner_id: string | null;
  owner_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  status: string;
  notes: string | null;
};

export type CampaignDetailResponse = {
  ok: true;
  campaign: MarketingCampaignRow & {
    brief: string | null;
    folder_created_at: string | null;
    structure_approved_by_name: string | null;
    metadata: Record<string, unknown>;
  };
  creatives: CampaignCreative[];
  tasks: MarketingTask[];
  publishing: PublishingItem[];
  activity: Array<{ id: number; action: string; user_name: string | null; created_at: string; after_data?: Record<string, unknown> }>;
};
