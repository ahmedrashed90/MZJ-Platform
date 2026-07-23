export type PlatformConnection = {
  id: string;
  platform_id: string;
  platform_code: string;
  platform_name: string;
  status: string;
  mode: string;
  account_id?: string | null;
  account_name?: string | null;
  profile_id?: string | null;
  scopes?: string[] | null;
  access_token_encrypted?: string | null;
  refresh_token_encrypted?: string | null;
  expires_at?: string | null;
  last_refreshed_at?: string | null;
  last_error?: string | null;
};

export type PlatformAccountOption = {
  id: string;
  name: string;
  category?: string | null;
  instagram?: { id: string; username?: string | null; name?: string | null } | null;
};

export type PublishTargetContext = {
  targetId: string;
  prepId: string;
  platformCode: string;
  platformName: string;
  postTypeCode: string;
  postTypeName: string;
  caption: string;
  hashtags: string;
  message: string;
  mediaUrl: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
  scheduledAt?: string | null;
  youtubePrivacy: "public" | "private" | "unlisted";
  recipients: string[];
};

export type PublishResult = {
  status: "published" | "failed" | "blocked" | "waiting_user_completion";
  externalId?: string | null;
  publishedUrl?: string | null;
  errorMessage?: string | null;
  responseSummary?: unknown;
};
