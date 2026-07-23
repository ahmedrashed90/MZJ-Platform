export type MarketingPermissionFlags = {
  admin: boolean;
  manageCampaigns: boolean;
  executeTasks: boolean;
  reviewTemplates: boolean;
  manageSettings: boolean;
  managePackages: boolean;
  manageRequests: boolean;
  viewReports: boolean;
};

export type MarketingUserOption = {
  id: string;
  full_name: string;
  email: string | null;
  role_names: string;
  department_names: string;
  can_receive_tasks: boolean;
};

export type MarketingAction = {
  id: string;
  department_id: string;
  name: string;
  code: string;
  progress_weight: number;
  admin_only: boolean;
  is_active: boolean;
  sort_order: number;
  completed?: boolean;
  completed_at?: string | null;
  notes?: string | null;
};

export type MarketingDepartment = {
  id: string;
  code: string;
  name: string;
  is_content: boolean;
  is_active: boolean;
  sort_order: number;
  users: Array<{ department_id: string; user_id: string; full_name: string }>;
  actions: MarketingAction[];
};

export type MarketingCreative = {
  id: string;
  name: string;
  short_code: string;
  primary_department_id: string;
  department_name: string;
  is_active: boolean;
  sort_order: number;
};

export type MarketingCampaignType = {
  id: string;
  name: string;
  code: string;
  prefix: string;
  is_active: boolean;
  sort_order: number;
};

export type MarketingPublishType = {
  id: string;
  platform_id: string;
  name: string;
  dimensions: string | null;
  is_active: boolean;
  sort_order: number;
};

export type MarketingPlatform = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  sort_order: number;
  publishTypes: MarketingPublishType[];
};

export type MarketingPackageCategory = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  sort_order: number;
};

export type MarketingRequestStatus = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
};

export type MarketingMeta = {
  ok: true;
  departments: MarketingDepartment[];
  creatives: MarketingCreative[];
  campaignTypes: MarketingCampaignType[];
  platforms: MarketingPlatform[];
  packageCategories: MarketingPackageCategory[];
  requestStatuses: MarketingRequestStatus[];
  users: MarketingUserOption[];
  permissions: MarketingPermissionFlags;
  currentUserId: string;
};

export type MarketingTask = {
  id: string;
  campaign_id: string;
  creative_instance_id: string;
  template_task_id: string | null;
  task_no: string;
  task_kind: "template" | "execution";
  status: string;
  status_label: string;
  progress: number;
  due_date: string | null;
  received_at: string | null;
  completed_at: string | null;
  final_file_id: string | null;
  admin_notes: string | null;
  campaign_name: string;
  campaign_code: string;
  source_kind: "campaign" | "agenda";
  creative_name: string;
  creative_short_code: string;
  instance_code: string;
  department_id: string;
  department_name: string;
  assigned_to: string;
  assigned_name: string;
  content_writer_id: string;
  content_writer_name: string;
  template_status: string | null;
};

export type CampaignSummary = {
  id: string;
  source_kind: "campaign" | "agenda";
  campaign_code: string;
  name: string;
  campaign_type: string | null;
  objective: string | null;
  content_request: string | null;
  campaign_date: string | null;
  publish_start: string;
  publish_end: string;
  agenda_month: string | null;
  status: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  progress: number;
  departments_count: number;
  tasks_count: number;
  received_count: number;
  completed_count: number;
};

export type MarketingDashboard = {
  ok: true;
  pendingGroups: Array<{ departmentName: string; tasks: MarketingTask[] }>;
  reviewTasks: MarketingTask[];
  activeTasks: MarketingTask[];
  readiness: CampaignSummary[];
  publishing: CampaignSummary[];
};

export type MarketingCampaignList = { ok: true; rows: CampaignSummary[] };

export type CampaignDetailResponse = {
  ok: true;
  campaign: CampaignSummary;
  instances: Array<Record<string, unknown>>;
  contentUsers: Array<Record<string, unknown>>;
  sections: Array<Record<string, unknown>>;
  sectionUsers: Array<Record<string, unknown>>;
  writerLinks: Array<Record<string, unknown>>;
  vehicles: Array<Record<string, unknown>>;
  instancePlatforms: Array<Record<string, unknown>>;
  instancePublishTypes: Array<Record<string, unknown>>;
  budgets: Array<Record<string, unknown>>;
  budgetPlatforms: Array<Record<string, unknown>>;
  schedule: Array<Record<string, unknown>>;
  schedulePlatforms: Array<Record<string, unknown>>;
  tasks: MarketingTask[];
  actions: Array<Record<string, unknown>>;
  submissions: Array<Record<string, unknown>>;
  files: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  days: Array<Record<string, unknown>>;
};

export type TaskDetailResponse = {
  ok: true;
  task: MarketingTask;
  campaign: Record<string, unknown>;
  instance: Record<string, unknown>;
  vehicles: Array<Record<string, unknown>>;
  actions: MarketingAction[];
  submissions: Array<Record<string, unknown>>;
  approvedTemplate: Record<string, unknown> | null;
  files: Array<Record<string, unknown>>;
};

export type StockVehicle = {
  id: string;
  vin: string;
  car_name: string | null;
  statement: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  model_year: string | null;
  location_name: string | null;
  status_code: string;
  active_photo_requests: number;
  content_uses: number;
};

export type StockResponse = { ok: true; rows: StockVehicle[] };

export type PhotoRequest = {
  id: string;
  request_no: string | null;
  status: string;
  requested_by_name: string | null;
  requested_at: string;
  photography_date: string | null;
  note: string | null;
  completed_at: string | null;
  vehicles: Array<{ id: string; vin: string; car_name: string | null; statement: string | null; location_name: string | null }>;
};

export type PhotoRequestsResponse = { ok: true; rows: PhotoRequest[] };

export type MarketingPackage = {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  category_code: string;
  price: number;
  cash_discount: number;
  registration_fee: boolean;
  insurance: boolean;
  issuance_fee: boolean;
  car_care_lines: string[];
  delivery_mode: "home" | "region";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PackagesResponse = { ok: true; rows: MarketingPackage[] };

export type GenericRowsResponse = { ok: true; rows: Array<Record<string, unknown>>; month?: string };

export type ContentUserDraft = {
  userId: string;
  dueDate: string;
  notes: string;
};

export type WriterLinkDraft = {
  userId: string;
  dueDate: string;
};

export type SectionUserDraft = {
  userId: string;
  dueDate: string;
  writers: WriterLinkDraft[];
};

export type InstanceSectionDraft = {
  localId: string;
  departmentId: string;
  kind: "primary" | "optional";
  receivedDate: string;
  notes: string;
  users: SectionUserDraft[];
};

export type InstancePlatformDraft = {
  platformId: string;
  publishTypeIds: string[];
};

export type CreativeInstanceDraft = {
  clientKey: string;
  creativeId: string;
  agendaDate?: string;
  contentReceivedDate: string;
  contentNotes: string;
  primaryReceivedDate: string;
  primaryNotes: string;
  contentUsers: ContentUserDraft[];
  sections: InstanceSectionDraft[];
  vehicleIds: string[];
  platformSelections: InstancePlatformDraft[];
};

export type BudgetDraft = {
  localId: string;
  clientInstanceKey: string;
  funnel: string;
  adsCount: number;
  contentGoal: string;
  expectedGoal: string;
  platformAmounts: Array<{ platformId: string; amount: number }>;
};

export type ScheduleDraft = {
  localId: string;
  clientInstanceKey: string;
  publishDate: string;
  selections: InstancePlatformDraft[];
};

export type CampaignWizardDraft = {
  idempotencyKey: string;
  name: string;
  campaignTypeId: string;
  objective: string;
  contentRequest: string;
  campaignDate: string;
  publishStart: string;
  publishEnd: string;
  agendaMonth: string;
  instances: CreativeInstanceDraft[];
  budgets: BudgetDraft[];
  schedule: ScheduleDraft[];
};
