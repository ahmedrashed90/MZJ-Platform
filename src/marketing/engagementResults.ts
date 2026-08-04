export const MARKETING_RESULT_PLATFORMS = ["facebook", "instagram", "tiktok", "snapchat", "youtube"] as const;

export type MarketingResultPlatform = typeof MARKETING_RESULT_PLATFORMS[number];

export type EngagementMetricSummary = {
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  reach: number;
  engagements: number;
  identifiedEngagements: number;
  commentEvents: number;
  likeEvents: number;
  shareEvents: number;
  identifiedAccounts: number;
  crmLeads: number;
  soldLeads: number;
  soldQuantity: number;
  crmConversionRate: number;
  salesConversionRate: number;
  lastSyncedAt?: string | null;
};

export type EngagementPlatformResult = EngagementMetricSummary & {
  platform: MarketingResultPlatform;
  connected: boolean;
  connectionStatus: string;
  dataStatus: "available" | "pending_integration" | "waiting_posts";
  syncStatus: "synced" | "pending" | "failed" | "waiting";
};

export type EngagementPostResult = EngagementMetricSummary & {
  id: string;
  sourceType: "campaign" | "agenda";
  sourceId: string;
  platform: MarketingResultPlatform;
  providerPostId: string;
  permalink: string;
  postTypeName: string;
  creativeId: string;
  creativeName: string;
  publishedAt: string;
  lastSyncedAt?: string | null;
  syncStatus: "synced" | "pending" | "failed" | string;
  syncError?: string;
  archivedAt?: string | null;
  score: number;
};

export type EngagementCreativeResult = EngagementMetricSummary & {
  id: string;
  name: string;
};

export type EngagementResultGroup = {
  sourceType: "campaign" | "agenda";
  sourceId: string;
  name: string;
  code: string;
  publishStart?: string | null;
  publishEnd?: string | null;
  status: string;
  summary: EngagementMetricSummary;
  platforms: EngagementPlatformResult[];
  posts: EngagementPostResult[];
  creatives: EngagementCreativeResult[];
  bestPost: EngagementPostResult | null;
  bestCreative: EngagementCreativeResult | null;
};

export type EngagementResultsPayload = {
  groups: EngagementResultGroup[];
  campaigns: EngagementResultGroup[];
  agendas: EngagementResultGroup[];
  supportedPlatforms: MarketingResultPlatform[];
};

export function marketingResultPlatformLabel(platform: string) {
  if (platform === "facebook") return "Facebook";
  if (platform === "instagram") return "Instagram";
  if (platform === "tiktok") return "TikTok";
  if (platform === "snapchat") return "Snapchat";
  if (platform === "youtube") return "YouTube";
  return platform || "منصة";
}

export function marketingResultSourceLabel(platform: string) {
  if (platform === "facebook") return "بوست فيس بوك";
  if (platform === "instagram") return "بوست انستجرام";
  if (platform === "tiktok") return "بوست تيك توك";
  if (platform === "snapchat") return "بوست سناب شات";
  if (platform === "youtube") return "فيديو يوتيوب";
  return "بوست منصة اجتماعية";
}

export function marketingResultCount(value: unknown) {
  return Number(value || 0).toLocaleString("ar-SA");
}

export function marketingResultPercent(value: unknown) {
  return `${Number(value || 0).toLocaleString("ar-SA", { maximumFractionDigits: 2 })}%`;
}
