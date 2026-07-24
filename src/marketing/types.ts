export type MarketingUser = { id: string; full_name?: string; fullName?: string; email?: string | null };
export type MarketingDepartment = { id: string; name: string; is_content: boolean; users: MarketingUser[] };
export type AssignmentAction = { id: string; department_id: string; department_name: string; name: string; percentage: number; admin_only: boolean; sort_order: number };
export type CreativeType = { id: string; name: string; short_code: string; primary_department_id: string; primary_department_name: string };
export type CampaignType = { id: string; name: string; short_code: string; code_prefix: string; sequence_value: number };
export type MarketingPlatform = { id: string; code: string; name: string };
export type PlatformPostType = { id: string; platform_id: string; name: string; width?: number | null; height?: number | null };
export type Funnel = { id: string; name: string };
export type StockCar = { id: string; vin: string; car_name: string | null; statement: string | null; model_year: string | null; exterior_color: string | null; interior_color: string | null; location_name: string | null; photographed?: boolean; content_usage?: any[] };
export type MarketingMeta = {
  ok: boolean;
  users: MarketingUser[];
  departments: MarketingDepartment[];
  actions: AssignmentAction[];
  creativeTypes: CreativeType[];
  campaignTypes: CampaignType[];
  platforms: MarketingPlatform[];
  postTypes: PlatformPostType[];
  funnels: Funnel[];
  cars: StockCar[];
  connections: any[];
  permissions: { isAdmin: boolean; canManage: boolean };
};

export type ContentAssignment = { userId: string; dueOn: string; note: string };
export type ExecutionAssignment = { userId: string; contentUserIds: string[]; dueOn: string; note: string };
export type OptionalDepartmentAssignment = { departmentId: string; assignments: ExecutionAssignment[] };
export type PlatformAssignment = { platformId: string; postTypeIds: string[] };
export type CreativeDraft = {
  tempId: string;
  creativeTypeId: string;
  quantity: number;
  cars: StockCar[];
  contentAssignments: ContentAssignment[];
  primaryAssignments: ExecutionAssignment[];
  optionalAssignments: OptionalDepartmentAssignment[];
  platforms: PlatformAssignment[];
  notes?: Record<string, string>;
};
