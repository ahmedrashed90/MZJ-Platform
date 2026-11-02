export type YouTubePrivacyStatus = "public" | "unlisted" | "private";
export type YouTubeLicense = "youtube" | "creativeCommon";

export type YouTubePublishSettings = {
  privacyStatus: YouTubePrivacyStatus;
  madeForKids: boolean;
  categoryId: string;
  defaultLanguage: string;
  defaultPlaylistId: string;
  notifySubscribers: boolean;
  embeddable: boolean;
  license: YouTubeLicense;
  publicStatsViewable: boolean;
  defaultTags: string[];
  descriptionTemplate: string;
};

export type YouTubePublishOptions = {
  title: string;
  description: string;
  tags: string[];
  privacyStatus: YouTubePrivacyStatus;
  madeForKids: boolean;
  categoryId: string;
  defaultLanguage: string;
  playlistId: string;
  notifySubscribers: boolean;
  embeddable: boolean;
  license: YouTubeLicense;
  publicStatsViewable: boolean;
};

export type YouTubeOptionItem = { id: string; title: string };

export const YOUTUBE_PUBLISH_DEFAULTS: YouTubePublishSettings = {
  privacyStatus: "unlisted",
  madeForKids: false,
  categoryId: "2",
  defaultLanguage: "ar",
  defaultPlaylistId: "",
  notifySubscribers: true,
  embeddable: true,
  license: "youtube",
  publicStatsViewable: true,
  defaultTags: [],
  descriptionTemplate: "",
};

export const YOUTUBE_CATEGORY_FALLBACKS: YouTubeOptionItem[] = [
  { id: "1", title: "أفلام ورسوم متحركة" },
  { id: "2", title: "سيارات ومركبات" },
  { id: "10", title: "موسيقى" },
  { id: "15", title: "حيوانات أليفة" },
  { id: "17", title: "رياضة" },
  { id: "19", title: "سفر وفعاليات" },
  { id: "20", title: "ألعاب" },
  { id: "22", title: "أشخاص ومدونات" },
  { id: "23", title: "كوميديا" },
  { id: "24", title: "ترفيه" },
  { id: "25", title: "أخبار وسياسة" },
  { id: "26", title: "أسلوب حياة وإرشادات" },
  { id: "27", title: "تعليم" },
  { id: "28", title: "علوم وتقنية" },
  { id: "29", title: "مؤسسات غير ربحية ونشاط اجتماعي" },
];

function text(value: unknown) { return String(value ?? "").trim(); }
function boolean(value: unknown, fallback: boolean) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}
function tags(value: unknown) {
  const source = Array.isArray(value) ? value : text(value).split(/[،,\n]+/);
  return [...new Set(source.map((item) => text(item)).filter(Boolean))].slice(0, 60);
}
function privacy(value: unknown, fallback: YouTubePrivacyStatus): YouTubePrivacyStatus {
  const current = text(value) as YouTubePrivacyStatus;
  return ["public", "unlisted", "private"].includes(current) ? current : fallback;
}
function license(value: unknown, fallback: YouTubeLicense): YouTubeLicense {
  return text(value) === "creativeCommon" ? "creativeCommon" : fallback === "creativeCommon" ? fallback : "youtube";
}

export function normalizeYouTubePublishSettings(value: unknown): YouTubePublishSettings {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    privacyStatus: privacy(input.privacyStatus, YOUTUBE_PUBLISH_DEFAULTS.privacyStatus),
    madeForKids: boolean(input.madeForKids, YOUTUBE_PUBLISH_DEFAULTS.madeForKids),
    categoryId: text(input.categoryId) || YOUTUBE_PUBLISH_DEFAULTS.categoryId,
    defaultLanguage: text(input.defaultLanguage) || YOUTUBE_PUBLISH_DEFAULTS.defaultLanguage,
    defaultPlaylistId: text(input.defaultPlaylistId),
    notifySubscribers: boolean(input.notifySubscribers, YOUTUBE_PUBLISH_DEFAULTS.notifySubscribers),
    embeddable: boolean(input.embeddable, YOUTUBE_PUBLISH_DEFAULTS.embeddable),
    license: license(input.license, YOUTUBE_PUBLISH_DEFAULTS.license),
    publicStatsViewable: boolean(input.publicStatsViewable, YOUTUBE_PUBLISH_DEFAULTS.publicStatsViewable),
    defaultTags: tags(input.defaultTags),
    descriptionTemplate: text(input.descriptionTemplate).slice(0, 3000),
  };
}

export function normalizeYouTubePublishOptions(
  value: unknown,
  defaultsInput: unknown = YOUTUBE_PUBLISH_DEFAULTS,
  seed: { title?: unknown; description?: unknown } = {},
): YouTubePublishOptions {
  const defaults = normalizeYouTubePublishSettings(defaultsInput);
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const description = text(input.description) || text(seed.description);
  return {
    title: text(input.title) || text(seed.title),
    description: [description, !text(input.description) ? defaults.descriptionTemplate : ""].filter(Boolean).join("\n\n").slice(0, 5000),
    tags: tags(Object.prototype.hasOwnProperty.call(input, "tags") ? input.tags : defaults.defaultTags),
    privacyStatus: privacy(input.privacyStatus, defaults.privacyStatus),
    madeForKids: boolean(input.madeForKids, defaults.madeForKids),
    categoryId: text(input.categoryId) || defaults.categoryId,
    defaultLanguage: text(input.defaultLanguage) || defaults.defaultLanguage,
    playlistId: text(input.playlistId) || defaults.defaultPlaylistId,
    notifySubscribers: boolean(input.notifySubscribers, defaults.notifySubscribers),
    embeddable: boolean(input.embeddable, defaults.embeddable),
    license: license(input.license, defaults.license),
    publicStatsViewable: boolean(input.publicStatsViewable, defaults.publicStatsViewable),
  };
}
