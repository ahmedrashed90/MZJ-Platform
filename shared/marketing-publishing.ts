export type MarketingPublishFormat = "story" | "reel" | "short" | "photo_post" | "carousel" | "video" | "post";

function clean(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

export function normalizeMarketingPublishFormat(value: unknown): MarketingPublishFormat {
  const text = clean(value);
  if (text.includes("story") || text.includes("ستوري") || text.includes("قصة") || text.includes("قصه")) return "story";
  if (text.includes("short") || text.includes("شورت")) return "short";
  if (text.includes("reel") || text.includes("ريل")) return "reel";
  if (text.includes("carousel") || text.includes("كاروسيل")) return "carousel";
  if (text.includes("photo") || text.includes("image") || text.includes("بوست صور") || text.includes("منشور صور") || text.includes("صورة") || text.includes("صوره")) return "photo_post";
  if (text.includes("video") || text.includes("فيديو")) return "video";
  return "post";
}

export function publishFormatRequiresVideo(format: MarketingPublishFormat) {
  return format === "reel" || format === "short" || format === "video";
}

export function publishFormatRequiresImages(format: MarketingPublishFormat) {
  return format === "photo_post" || format === "carousel";
}
