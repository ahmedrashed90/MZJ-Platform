export type MarketingPermissionMap = Record<string, boolean>;

export type MarketingDepartment = {
  id: string;
  code: string;
  name: string;
  is_content_department: boolean;
  is_active: boolean;
  sort_order: number;
};

export type MarketingDepartmentUser = {
  department_id: string;
  user_id: string;
  full_name: string;
  email?: string | null;
  is_active: boolean;
};

export type MarketingAction = {
  id: string;
  department_id: string;
  department_code: string;
  department_name: string;
  name: string;
  percentage: number;
  audience: "user" | "admin" | "both";
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
};

export type MarketingCreativeType = {
  id: string;
  name: string;
  short_code: string;
  primary_department_id?: string | null;
  primary_department_code?: string | null;
  primary_department_name?: string | null;
  is_active: boolean;
  sort_order: number;
};

export type MarketingCampaignType = {
  id: string;
  name: string;
  short_code: string;
  code_prefix: string;
  is_active: boolean;
  sort_order: number;
  next_number: string;
};

export type MarketingPlatform = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
};

export type MarketingPostType = {
  id: string;
  platform_id: string;
  platform_code: string;
  platform_name: string;
  name: string;
  code: string;
  dimensions?: string | null;
  is_active: boolean;
  sort_order: number;
};

export type MarketingCategory = {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
};

export type MarketingRequestStatus = {
  id: string;
  code: string;
  name: string;
  is_terminal: boolean;
  is_active: boolean;
  sort_order: number;
};

export type MarketingUser = {
  id: string;
  full_name: string;
  email?: string | null;
  employee_no?: string | null;
  can_receive_tasks: boolean;
  department_codes: string[];
};

export type MarketingAttendanceSettings = {
  work_start_time: string;
  work_end_time: string;
  grace_minutes: number;
  idle_after_minutes: number;
  offline_after_minutes: number;
  updated_at?: string;
};

export type MarketingMeta = {
  ok: boolean;
  departments: MarketingDepartment[];
  departmentUsers: MarketingDepartmentUser[];
  actions: MarketingAction[];
  creativeTypes: MarketingCreativeType[];
  campaignTypes: MarketingCampaignType[];
  platforms: MarketingPlatform[];
  postTypes: MarketingPostType[];
  categories: MarketingCategory[];
  requestStatuses: MarketingRequestStatus[];
  users: MarketingUser[];
  attendanceSettings: MarketingAttendanceSettings | null;
  permissions: MarketingPermissionMap;
  currentUser: { id: string; fullName: string; roleCodes: string[]; departmentCodes: string[] };
};

export type TaskActionState = {
  id: string;
  name: string;
  percentage: number;
  completed: boolean;
  completed_at?: string | null;
  note?: string | null;
};

export type MarketingUpload = {
  id: string;
  upload_kind: string;
  file_name: string;
  external_url?: string | null;
  storage_key?: string | null;
  version_no?: number;
  uploaded_by_name?: string | null;
  created_at: string;
};

export type MarketingTask = {
  id: string;
  task_no: string;
  task_kind: "template" | "execution";
  status: string;
  review_status?: string | null;
  review_note?: string | null;
  progress: number;
  due_at?: string | null;
  received_at?: string | null;
  completed_at?: string | null;
  assigned_to?: string | null;
  assigned_name?: string | null;
  content_writer_id?: string | null;
  content_writer_name?: string | null;
  template_task_id?: string | null;
  department_id?: string | null;
  department_code?: string | null;
  department_name?: string | null;
  campaign_id: string;
  project_name: string;
  campaign_code: string;
  source_kind: "campaign" | "agenda";
  campaign_type?: string | null;
  project_starts_on?: string | null;
  project_ends_on?: string | null;
  project_objective?: string | null;
  project_content_brief?: string | null;
  project_stage?: string;
  creative_id?: string | null;
  instance_no?: string | null;
  creative_type?: string | null;
  short_code?: string | null;
  agenda_day?: string | null;
  content_due_at?: string | null;
  content_notes?: string | null;
  admin_notes?: string | null;
  assignment_notes?: string | null;
  vehicles?: Array<{ id: string; vin: string; car_name?: string | null; statement?: string | null; exterior_color?: string | null; interior_color?: string | null; model_year?: string | null; location_name?: string | null }>;
  template_data?: Record<string, unknown>;
  final_file_name?: string | null;
  final_file_url?: string | null;
  actions: TaskActionState[];
  uploads: MarketingUpload[];
};

export type MarketingProjectSummary = {
  id: string;
  name: string;
  campaign_code: string;
  source_kind: "campaign" | "agenda";
  status: string;
  stage: string;
  starts_on?: string | null;
  ends_on?: string | null;
  moved_to_publish_at?: string | null;
  created_at: string;
  task_count: number;
  department_count: number;
  progress: number;
};

export type MarketingDashboardData = {
  ok: boolean;
  counts: { projects: number; campaigns: number; agendas: number; publishing: number };
  tasks: MarketingTask[];
  projects: MarketingProjectSummary[];
  pendingReviews: number;
};

export type ProjectListRow = MarketingProjectSummary & {
  campaign_type?: string | null;
  objective?: string | null;
  content_brief?: string | null;
  campaign_date?: string | null;
  updated_at: string;
  archived_at?: string | null;
  raw_folders_created_at?: string | null;
  creative_count: number;
  created_by_name?: string | null;
};

export type ProjectCreative = {
  id: string;
  campaign_id: string;
  creative_type_id?: string | null;
  creative_type: string;
  creative_type_name?: string | null;
  instance_no: string;
  short_code?: string | null;
  agenda_day?: string | null;
  content_due_at?: string | null;
  content_notes?: string | null;
  admin_notes?: string | null;
  primary_department_name?: string | null;
  status: string;
  metadata?: Record<string, unknown>;
};

export type ProjectAssignment = {
  id: string;
  creative_id: string;
  department_id: string;
  assigned_user_id: string;
  content_writer_id?: string | null;
  assignment_role: "content" | "primary" | "optional";
  due_at?: string | null;
  notes?: string | null;
  is_optional: boolean;
  department_name: string;
  department_code: string;
  assigned_name: string;
  content_writer_name?: string | null;
};

export type ProjectVehicle = {
  creative_id: string;
  vehicle_id: string;
  vin: string;
  car_name?: string | null;
  statement?: string | null;
  exterior_color?: string | null;
  interior_color?: string | null;
  model_year?: string | null;
  location_name?: string | null;
};

export type BudgetItemRow = {
  id: string;
  creative_id?: string | null;
  platform_id?: string | null;
  funnel: string;
  ad_count: number;
  content_goal?: string | null;
  expected_goal?: string | null;
  amount: number;
  notes?: string | null;
  instance_no?: string | null;
  creative_type?: string | null;
  platform_name?: string | null;
};

export type PublishScheduleRow = {
  id: string;
  creative_id: string;
  platform_id: string;
  post_type_id: string;
  publish_date: string;
  publish_time?: string | null;
  notes?: string | null;
  status: string;
  instance_no: string;
  creative_type: string;
  platform_name: string;
  post_type_name: string;
  dimensions?: string | null;
};

export type ProjectDetail = {
  ok: boolean;
  project: ProjectListRow & Record<string, unknown>;
  creatives: ProjectCreative[];
  assignments: ProjectAssignment[];
  vehicles: ProjectVehicle[];
  tasks: MarketingTask[];
  budget: BudgetItemRow[];
  schedule: PublishScheduleRow[];
  links: Array<{ id: string; platform_id?: string | null; platform_name?: string | null; url: string; created_at: string }>;
  files: Array<{ id: string; file_kind: string; file_name: string; external_url?: string | null; storage_key?: string | null; created_at: string }>;
  activity: Array<{ id: string; actor_name?: string | null; action: string; details: Record<string, unknown>; created_at: string }>;
};

export type WizardAssignment = {
  id: string;
  departmentId: string;
  userId: string;
  contentWriterIds: string[];
  role: "primary" | "optional";
  dueAt: string;
  notes: string;
};

export type WizardInstance = {
  clientId: string;
  instanceNo: string;
  agendaDay: string;
  creativeTypeId: string;
  contentWriterIds: string[];
  contentDueAt: string;
  contentNotes: string;
  adminNotes: string;
  assignments: WizardAssignment[];
  vehicleIds: string[];
  metadata: Record<string, unknown>;
};

export type WizardBudgetItem = {
  id: string;
  instanceClientId: string;
  funnel: string;
  platformId: string;
  adCount: number;
  contentGoal: string;
  expectedGoal: string;
  amount: number;
  notes: string;
};

export type WizardScheduleItem = {
  id: string;
  instanceClientId: string;
  publishDate: string;
  publishTime: string;
  platformId: string;
  postTypeId: string;
  notes: string;
};
