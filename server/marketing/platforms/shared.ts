import { MarketingError, clean } from "../common.js";

export async function providerJson<T = any>(url: string, options: RequestInit = {}, provider = "Platform") {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    const message = payload?.error?.message || payload?.error_description || payload?.message || payload?.error || `${provider} API error: ${response.status}`;
    throw new MarketingError(502, clean(message) || `${provider} API error`, "PLATFORM_API_ERROR");
  }
  return payload as T;
}

export function normalizePostType(value: unknown) {
  return clean(value).toLowerCase().replace(/[\s-]+/g, "_");
}

export function isVideoFile(url: string, mimeType: string, postType: string) {
  return /video|reel|short|story_video|\.mp4|\.mov|\.m4v|\.webm/i.test(`${url} ${mimeType} ${postType}`);
}

export function messageText(caption: string, hashtags: string) {
  return [clean(caption), clean(hashtags)].filter(Boolean).join("\n\n");
}

export function normalizeSaudiPhone(value: unknown) {
  let text = clean(value).replace(/[\s\-()]/g, "").replace(/^\+/, "");
  if (/^05\d{8}$/.test(text)) text = `966${text.slice(1)}`;
  return /^\d{8,15}$/.test(text) ? text : "";
}
