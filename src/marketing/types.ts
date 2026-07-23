export type MarketingUser = {
  id: string;
  full_name: string;
  email?: string | null;
  can_receive_tasks?: boolean;
  department_codes: string[];
  departments: string[];
};

export type CatalogItem = { id: string; code: string; name: string; sort_order?: number };
export type CreativeCatalog = CatalogItem & { primary_department_code: string; requires_final_file: boolean };
export type PlatformCatalog = CatalogItem & { capabilities?: Record<string, unknown> };
export type PostTypeCatalog = CatalogItem & { platform_id: string; dimensions?: string | null };
export type WorkflowAction = CatalogItem & { department_code: string; weight: number; is_admin_only: boolean; is_required: boolean };

export type MarketingMeta = {
  ok: boolean;
  users: MarketingUser[];
  departments: CatalogItem[];
  campaignTypes: Array<CatalogItem & { prefix: string }>;
  creatives: CreativeCatalog[];
  platforms: PlatformCatalog[];
  postTypes: PostTypeCatalog[];
  funnels: CatalogItem[];
  workflowActions: WorkflowAction[];
  attendanceSettings?: Record<string, unknown> | null;
  access: {
    admin: boolean;
    manageCampaigns: boolean;
    reviewTasks: boolean;
    manageSettings: boolean;
    manageAttendance: boolean;
  };
};

export type CampaignSummary = {
  id: string;
  campaign_code: string;
  name: string;
  source_type: "campaign" | "agenda";
  campaign_type?: string | null;
  objective?: string | null;
  status: string;
  starts_at?: string | null;
  ends_at?: string | null;
  due_at?: string | null;
  creative_count: number;
  task_count: number;
  completed_task_count: number;
  progress_percent: number;
  created_by_name?: string | null;
  updated_at: string;
};

export type MarketingTask = {
  id: string;
  campaign_id: string;
  creative_id?: string | null;
  task_type: "content_template" | "execution";
  pair_key?: string | null;
  department_code: string;
  assigned_to?: string | null;
  paired_content_user_id?: string | null;
  depends_on_task_id?: string | null;
  status: string;
  due_at?: string | null;
  requires_final_file: boolean;
  campaign_name: string;
  campaign_code: string;
  source_type?: string;
  creative_type?: string | null;
  instance_code?: string | null;
  assigned_to_name?: string | null;
  content_user_name?: string | null;
  progress_percent: number;
  actions?: TaskAction[];
  files?: TaskFile[];
  template?: Record<string, unknown> | null;
  versions?: Array<Record<string, any>>;
  reviews?: Array<Record<string, any>>;
};

export type TaskAction = {
  id: string;
  action_code: string;
  name: string;
  sort_order: number;
  weight: number;
  is_admin_only: boolean;
  is_required: boolean;
  status: string;
};

export type TaskFile = {
  id: string;
  file_role: string;
  original_name: string;
  mime_type?: string | null;
  file_size?: number | null;
  created_at: string;
};

export type DashboardResponse = {
  ok: boolean;
  campaignStats: { total: number; ready: number; completed: number; delayed: number };
  taskStats: { total: number; new_count: number; active_count: number; changes_count: number; review_count: number; completed_count: number };
  campaigns: CampaignSummary[];
  tasks: MarketingTask[];
  lateTasks: MarketingTask[];
};

export type CreativeDraft = {
  clientKey: string;
  catalogCreativeId: string;
  creativeType: string;
  primaryDepartmentCode: string;
  quantity: number;
  contentUsers: Array<{ userId: string; dueAt: string; notes: string }>;
  executionAssignments: Array<{
    departmentCode: string;
    userId: string;
    dueAt: string;
    notes: string;
    writerLinks: Array<{ contentUserId: string; dueAt: string; notes: string }>;
  }>;
  vehicles: Array<Record<string, unknown>>;
};

export type CampaignDraft = {
  sourceType: "campaign" | "agenda";
  campaignType: string;
  name: string;
  objective: string;
  contentBrief: string;
  requestDate: string;
  startsAt: string;
  endsAt: string;
  monthKey?: string;
  creatives: CreativeDraft[];
  budgetItems: Array<{
    creativeClientKey: string;
    funnelId: string;
    adsCount: number;
    contentGoal: string;
    expectedTarget: string;
    rowTotal: number;
    platforms: Array<{ platformId: string; amount: number }>;
  }>;
  scheduleItems: Array<{
    creativeClientKey: string;
    publishAt: string;
    notes: string;
    targets: Array<{ platformId: string; postTypeId: string; dimensions?: string | null }>;
  }>;
};
