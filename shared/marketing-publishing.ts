export type MarketingPublishFormat = "story" | "reel" | "short" | "photo_post" | "carousel" | "video" | "post";

export type MarketingPlatformPostTypePreset = {
  name: string;
  width: number;
  height: number;
  format: MarketingPublishFormat;
};

export type MarketingMediaDescriptor = {
  name?: string | null;
  mimeType?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  media_width?: number | null;
  media_height?: number | null;
  durationSeconds?: number | null;
  duration_seconds?: number | null;
};

export type MarketingPublishMediaTarget = {
  platformCode: string;
  postTypeName: string;
  format: MarketingPublishFormat;
  width?: number | null;
  height?: number | null;
};

export const MARKETING_PLATFORM_POST_TYPE_PRESETS: Record<string, MarketingPlatformPostTypePreset[]> = {
  instagram: [
    { name: "بوست صور", width: 1080, height: 1080, format: "photo_post" },
    { name: "ريل", width: 1080, height: 1920, format: "reel" },
    { name: "ستوري", width: 1080, height: 1920, format: "story" },
  ],
  tiktok: [
    { name: "ريل/فيديو", width: 1080, height: 1920, format: "video" },
    { name: "ستوري", width: 1080, height: 1920, format: "story" },
  ],
  snapchat: [
    { name: "Spotlight", width: 1080, height: 1920, format: "short" },
    { name: "Story", width: 1080, height: 1920, format: "story" },
  ],
  facebook: [
    { name: "بوست صور", width: 1080, height: 1080, format: "photo_post" },
    { name: "ريل", width: 1080, height: 1920, format: "reel" },
    { name: "ستوري", width: 1080, height: 1920, format: "story" },
  ],
  linkedin: [
    { name: "بوست", width: 1080, height: 1080, format: "photo_post" },
    { name: "فيديو", width: 1080, height: 1920, format: "video" },
  ],
  youtube: [
    { name: "Shorts", width: 1080, height: 1920, format: "short" },
    { name: "فيديو", width: 1920, height: 1080, format: "video" },
  ],
};

function clean(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function compact(value: unknown) {
  return clean(value).replace(/[\s_\-–—/\\]+/g, "");
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function normalizeMarketingPublishFormat(value: unknown): MarketingPublishFormat {
  const text = clean(value);
  if (text.includes("story") || text.includes("ستوري") || text.includes("قصة") || text.includes("قصه")) return "story";
  if (text.includes("short") || text.includes("شورت") || text.includes("spotlight")) return "short";
  if (text.includes("reel") || text.includes("ريل")) return "reel";
  if (text.includes("carousel") || text.includes("كاروسيل")) return "carousel";
  if (text.includes("photo") || text.includes("image") || text.includes("بوست صور") || text.includes("منشور صور") || text.includes("صورة") || text.includes("صوره")) return "photo_post";
  if (text.includes("video") || text.includes("فيديو")) return "video";
  return "post";
}

export function platformPostTypePreset(platformCode: unknown, postTypeName: unknown) {
  const platform = clean(platformCode);
  const target = compact(postTypeName);
  return (MARKETING_PLATFORM_POST_TYPE_PRESETS[platform] || []).find((item) => compact(item.name) === target) || null;
}

export function resolveMarketingPublishFormat(platformCode: unknown, postTypeName: unknown): MarketingPublishFormat {
  const platform = clean(platformCode);
  const preset = platformPostTypePreset(platform, postTypeName);
  if (preset) return preset.format;
  const text = clean(postTypeName);
  if (platform === "youtube") return text.includes("short") || text.includes("شورت") ? "short" : "video";
  if (platform === "tiktok") return normalizeMarketingPublishFormat(text) === "story" ? "story" : "video";
  if (platform === "snapchat") return normalizeMarketingPublishFormat(text) === "story" ? "story" : "short";
  if (platform === "linkedin") return normalizeMarketingPublishFormat(text) === "video" ? "video" : "photo_post";
  return normalizeMarketingPublishFormat(text);
}

export function publishFormatRequiresVideo(format: MarketingPublishFormat) {
  return format === "reel" || format === "short" || format === "video";
}

export function publishFormatRequiresImages(format: MarketingPublishFormat) {
  return format === "photo_post" || format === "carousel";
}

export function marketingMediaIsVideo(file: MarketingMediaDescriptor) {
  return /video|mp4|mov|m4v|webm/i.test(`${file?.mimeType || file?.mime_type || ""} ${file?.name || ""}`);
}

export function validateMarketingPublishMedia(target: MarketingPublishMediaTarget, files: MarketingMediaDescriptor[]) {
  const errors: string[] = [];
  const platform = clean(target.platformCode);
  const videos = files.filter(marketingMediaIsVideo);
  const images = files.filter((file) => !marketingMediaIsVideo(file));

  if (!files.length) return ["الملف النهائي غير موجود"];
  if (target.format === "story" && files.length !== 1) errors.push("الستوري يجب أن يحتوي على ملف واحد فقط");
  if (videos.length > 1 || (videos.length && files.length > 1)) errors.push("الفيديو أو الريل يجب أن يكون ملفًا واحدًا فقط");
  if (publishFormatRequiresVideo(target.format) && (files.length !== 1 || videos.length !== 1)) errors.push("نوع النشر المحدد يتطلب ملف فيديو واحدًا فقط");
  if (publishFormatRequiresImages(target.format) && videos.length) errors.push("نوع النشر المحدد يقبل صورًا فقط");
  if (target.format === "carousel" && images.length < 2) errors.push("Carousel يتطلب صورتين على الأقل");
  if (platform === "instagram" && target.format === "post" && videos.length) errors.push("بوست Instagram يقبل الصور فقط. اختر Reel لنشر الفيديو");
  if (platform === "youtube" && (files.length !== 1 || videos.length !== 1)) errors.push("نشر YouTube يتطلب ملف فيديو واحدًا فقط");

  const requiredWidth = positiveNumber(target.width);
  const requiredHeight = positiveNumber(target.height);
  if (requiredWidth && requiredHeight) {
    for (const file of files) {
      const width = positiveNumber(file.width ?? file.media_width);
      const height = positiveNumber(file.height ?? file.media_height);
      const fileName = String(file.name || "الملف").trim() || "الملف";
      if (!width || !height) {
        errors.push(`تعذر التحقق من أبعاد ${fileName}. أعد رفع الملف بعد تحديث النظام`);
        continue;
      }
      if (width !== requiredWidth || height !== requiredHeight) {
        errors.push(`${fileName}: المقاس ${width}×${height} لا يطابق ${target.postTypeName} المطلوب ${requiredWidth}×${requiredHeight}`);
      }
    }
  }

  if (platform === "youtube" && target.format === "short") {
    const file = files[0];
    const duration = positiveNumber(file?.durationSeconds ?? file?.duration_seconds);
    if (!duration) errors.push("تعذر التحقق من مدة فيديو Shorts. أعد رفع الملف بعد تحديث النظام");
    else if (duration > 180) errors.push("YouTube Shorts يجب ألا تتجاوز مدته 3 دقائق");
  }

  return [...new Set(errors)];
}
