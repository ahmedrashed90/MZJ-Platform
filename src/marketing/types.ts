export type MarketingUser = {
  id: string;
  full_name: string;
  email?: string | null;
  department_codes?: string[];
  departments?: string[];
};

export type CampaignType = { id: string; name: string; prefix: string; sort_order: number };
export type CreativeCatalogItem = {
  id: string;
  name: string;
  short_code: string;
  primary_department_code: string;
  content_section_id?: string | null;
  content_section_name?: string | null;
  sort_order: number;
};
export type Funnel = { id: string; name: string; sort_order: number };
export type Department = { department_code: string; display_name: string; short_code: string; sort_order: number };
export type DepartmentMember = { department_code: string; user_id: string; full_name: string; email?: string | null };
export type WorkflowAction = {
  id: string;
  department_code: string;
  name: string;
  sort_order: number;
  weight: number;
  is_admin_only: boolean;
  is_required: boolean;
};
export type Platform = {
  id: string;
  code: string;
  name: string;
  icon?: string | null;
  status: string;
  capability_state?: string | null;
  connection_status?: string | null;
  mode?: string | null;
  account_name?: string | null;
  profile_id?: string | null;
  scopes?: string[];
  expires_at?: string | null;
  last_error?: string | null;
};
export type PostType = { id: string; platform_id: string; platform_code: string; platform_name: string; code: string; name: string; dimensions?: string | null; sort_order: number };
export type ContentSection = { id: string; code: string; name: string; sort_order: number };
export type OrderStatus = { id: string; code: string; name: string; sort_order: number };

export type MarketingMeta = {
  ok: true;
  users: MarketingUser[];
  campaignTypes: CampaignType[];
  creativeCatalog: CreativeCatalogItem[];
  funnels: Funnel[];
  platforms: Platform[];
  postTypes: PostType[];
  departments: Department[];
  departmentMembers: DepartmentMember[];
  workflowActions: WorkflowAction[];
  contentSections: ContentSection[];
  orderStatuses: OrderStatus[];
  ownerColors: Record<string, string>;
  attendanceReminder: {
    required: boolean;
    checkedInAt?: string | null;
    checkedOutAt?: string | null;
    workStart: string;
    workEnd: string;
    timezone: string;
  };
  access: {
    dashboard: boolean;
    campaignsView: boolean;
    campaignsManage: boolean;
    tasksView: boolean;
    publishPrepView: boolean;
    publishPrepManage: boolean;
    platformsManage: boolean;
    packagesManage: boolean;
    stockView: boolean;
    reportsView: boolean;
    attendanceSelf: boolean;
    attendanceManage: boolean;
    settingsManage: boolean;
  };
};

export type CampaignRow = {
  id: string;
  campaign_code: string;
  name: string;
  campaign_type: string;
  source_type: "campaign" | "agenda";
  objective?: string | null;
  content_brief?: string | null;
  campaign_date?: string | null;
  publish_start_date?: string | null;
  publish_end_date?: string | null;
  status: string;
  progress_percent: number;
  creatives_count?: number;
  creative_count?: number;
  tasks_count?: number;
  task_count?: number;
  total_budget?: number;
  completed_tasks?: number;
  departments?: Array<{ code: string; name: string; progress: number; total: number; started: number }>;
  created_at?: string;
  updated_at?: string;
  released_at?: string | null;
};

export type TaskAction = {
  id: string;
  action_code: string;
  action_name: string;
  action_order: number;
  weight: number;
  is_admin_only: boolean;
  is_required: boolean;
  is_completed: boolean;
  completed_by?: string | null;
  completed_at?: string | null;
  note?: string | null;
};

export type TaskFile = {
  id: string;
  file_kind: string;
  file_name: string;
  mime_type?: string | null;
  file_size?: number | null;
  uploaded_at: string;
  uploaded_by_name?: string | null;
};

export type TaskTemplateVersion = {
  id: string;
  version_no: number;
  status: string;
  parsed_data?: Record<string, unknown>;
  submitted_at: string;
  submitted_by_name?: string | null;
  reviewed_at?: string | null;
  reviewed_by_name?: string | null;
  review_note?: string | null;
  source_file_id?: string | null;
};

export type TaskRow = {
  id: string;
  task_code: string;
  task_type: "content_template" | "execution";
  title: string;
  status: string;
  review_status?: string | null;
  progress_percent: number;
  department_code: string;
  assigned_to: string;
  assigned_to_name: string;
  paired_content_user_id?: string | null;
  paired_content_user_name?: string | null;
  content_user_name?: string | null;
  department_name?: string | null;
  due_at?: string | null;
  received_at?: string | null;
  completed_at?: string | null;
  user_completed_at?: string | null;
  requires_final_file: boolean;
  campaign_id: string;
  campaign_code: string;
  campaign_name: string;
  campaign_type?: string | null;
  department_note?: string | null;
  content_note?: string | null;
  creative_id: string;
  creative_name: string;
  instance_code?: string | null;
  source_type?: string;
  actions?: TaskAction[];
  files?: TaskFile[];
  template_versions?: TaskTemplateVersion[];
  latest_template?: TaskTemplateVersion | null;
  can_work?: boolean;
  can_review?: boolean;
};

export type VehicleRow = {
  id: string;
  vin: string;
  car_name?: string | null;
  statement?: string | null;
  interior_color?: string | null;
  exterior_color?: string | null;
  model_year?: string | null;
  location_code?: string | null;
  location_name?: string | null;
  status_code?: string | null;
  status_name?: string | null;
  active_photography_request_id?: string | null;
  active_photography_request_no?: string | null;
  active_photography_date?: string | null;
  active_photography_status?: string | null;
};

export type PhotographyRequest = {
  id: string;
  request_no: string;
  request_kind: "photography";
  status: string;
  note?: string | null;
  photography_date?: string | null;
  photography_location?: string | null;
  requested_by_name?: string | null;
  requested_by_role?: string | null;
  requested_at: string;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  vehicles: VehicleRow[];
  events: Array<{ id: string; stage: string; action: string; note?: string | null; actor_name?: string | null; created_at: string }>;
};

export type PublishTarget = {
  id: string;
  platform_id: string;
  platform_name: string;
  platform_code: string;
  post_type_id?: string | null;
  post_type_code?: string | null;
  post_type_name?: string | null;
  dimensions?: string | null;
  scheduled_at?: string | null;
  status: string;
  published_url?: string | null;
  external_id?: string | null;
  error_message?: string | null;
};

export type PublishPrepItem = {
  id: string;
  campaign_id: string;
  campaign_code: string;
  campaign_name: string;
  campaign_type?: string | null;
  department_note?: string | null;
  content_note?: string | null;
  creative_id: string;
  creative_name: string;
  instance_code?: string | null;
  source_task_id: string;
  status: string;
  caption?: string | null;
  hashtags?: string | null;
  recipients?: string[];
  final_file_id?: string | null;
  final_file_name?: string | null;
  template_data?: Record<string, unknown>;
  targets: PublishTarget[];
};

export const campaignStatusLabels: Record<string, string> = {
  draft: "مسودة",
  scheduled: "مجدولة",
  in_progress: "جاري العمل",
  ready_for_publish: "جاهزة للنشر",
  completed: "مكتملة",
  archived: "مؤرشفة",
  cancelled: "ملغاة",
};

export const taskStatusLabels: Record<string, string> = {
  pending_template: "في انتظار رفع Task Template",
  template_submitted: "تحت مراجعة Task Template",
  template_approved: "تم اعتماد Task Template",
  blocked_by_template: "في انتظار اعتماد Task Template",
  ready: "جاهز للاستلام",
  received: "تم الاستلام",
  in_progress: "جاري العمل",
  changes_requested: "مطلوب تعديل",
  under_review: "تحت المراجعة",
  completed: "مكتمل",
  content_done: "تم الانتهاء",
  cancelled: "ملغي",
};

export const photographyStatusLabels: Record<string, string> = {
  photography_requested: "تم استلام الطلب",
  photography_scheduled: "تم جدولة التصوير",
  photography_in_progress: "جاري التصوير",
  completed: "تم التصوير",
  cancelled: "ملغي",
};

export const departmentLabels: Record<string, string> = {
  content: "قسم المحتوى",
  montage: "قسم المونتاج",
  photography: "قسم التصوير",
  design: "قسم التصميم",
  publishing: "قسم النشر",
};

export type CampaignAssignmentDetail = {
  id: string;
  department_code: string;
  execution_user_id: string;
  execution_user_name: string;
  content_user_id: string;
  content_user_name: string;
  due_date?: string | null;
  writer_due_date?: string | null;
  department_note?: string | null;
  content_note?: string | null;
};

export type CampaignCreativeDetail = {
  id: string;
  instance_no: number;
  instance_code: string;
  creative_name: string;
  primary_department_code: string;
  notes?: string | null;
  vehicles: Array<{ vehicle_id: string; vin: string; car_name?: string; statement?: string; exterior_color?: string; interior_color?: string; model_year?: string; location?: string }>;
  assignments: CampaignAssignmentDetail[];
};

export type CampaignBudgetDetail = {
  id: string;
  creative_id: string;
  funnel_id?: string | null;
  funnel_name?: string;
  creative_name: string;
  instance_code: string;
  ads_count: number;
  content_goal?: string | null;
  expected_target?: string | null;
  platforms: Array<{ platform_id: string; platform_name: string; amount: number }>;
};

export type CampaignScheduleDetail = {
  id: string;
  creative_id: string;
  publish_date: string;
  creative_name: string;
  instance_code: string;
  caption?: string | null;
  hashtags?: string | null;
  targets: Array<{ id: string; platform_id: string; platform_name: string; post_type_id: string; post_type_name: string; publish_time?: string | null; dimensions?: string | null; status: string }>;
};

export type CampaignDetailPayload = {
  ok: true;
  campaign: CampaignRow & { version: number; structure_deadline?: string | null; content_brief?: string | null; created_at?: string; released_at?: string | null };
  creatives: CampaignCreativeDetail[];
  tasks: TaskRow[];
  budgets: CampaignBudgetDetail[];
  schedule: CampaignScheduleDetail[];
};
