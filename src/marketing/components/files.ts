import { marketingFetch } from "../api";

export async function uploadMarketingFile(contextId: string, file: File) {
  const prepared = await marketingFetch<{ ok: true; storageKey: string; uploadUrl: string }>("/api/marketing", {
    method: "POST",
    body: JSON.stringify({ action: "media_action", mediaAction: "prepare_upload", contextId, fileName: file.name, mediaType: file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "document" }),
  });
  const response = await fetch(prepared.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream" } });
  if (!response.ok) throw new Error("تعذر رفع الملف إلى التخزين");
  return { storageKey: prepared.storageKey, fileName: file.name };
}
export async function openMarketingFile(storageKey: string) {
  const payload = await marketingFetch<{ ok: true; url: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "media_action", mediaAction: "download", storageKey }) });
  window.open(payload.url, "_blank", "noopener,noreferrer");
}
