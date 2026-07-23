import { parseExcelFile } from "../operations/excel";

export async function marketingFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok || (typeof payload === "object" && payload !== null && "ok" in payload && payload.ok === false)) {
    const message = typeof payload === "object" && payload !== null && "error" in payload ? String(payload.error) : "تعذر تنفيذ العملية";
    throw new Error(message);
  }
  return payload as T;
}

export function marketingQuery(values: Record<string, unknown>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function marketingPost<T>(body: Record<string, unknown>) {
  return marketingFetch<T>("/api/marketing", { method: "POST", body: JSON.stringify(body) });
}

export async function uploadMarketingFile(ownerType: "task" | "campaign", ownerId: string, file: File, metadata: Record<string, unknown> = {}) {
  const prepared = await marketingPost<{ ok: true; fileId: string; uploadUrl: string }>({
    action: "prepare_upload",
    ownerType,
    ownerId,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    fileSize: file.size,
    metadata,
  });
  const upload = await fetch(prepared.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream" } });
  if (!upload.ok) throw new Error("تعذر رفع الملف إلى التخزين");
  await marketingPost({ action: "finish_upload", fileId: prepared.fileId });
  return prepared.fileId;
}

export async function openMarketingFile(fileId: string) {
  const payload = await marketingFetch<{ ok: true; url: string; fileName: string }>(`/api/marketing${marketingQuery({ action: "file_url", fileId })}`);
  window.open(payload.url, "_blank", "noopener,noreferrer");
}

export async function parseTaskTemplateFile(file: File) {
  const rows = await parseExcelFile(file);
  const normalized = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), String(value ?? "").trim()])));
  const first = normalized[0] || {};
  const field = (...keys: string[]) => {
    for (const key of keys) {
      const direct = first[key];
      if (direct) return direct;
      const found = Object.entries(first).find(([name]) => keys.some((candidate) => name.includes(candidate)));
      if (found?.[1]) return found[1];
    }
    return "";
  };
  const scenes = normalized
    .filter((row) => Object.values(row).some(Boolean))
    .map((row, index) => ({
      number: row["رقم المشهد"] || row["المشهد"] || String(index + 1),
      title: row["عنوان المشهد"] || row["العنوان"] || row["Hook"] || "",
      description: row["شرح المشهد"] || row["التفاصيل"] || row["السكريبت"] || "",
      voiceOver: row["الفويس أوفر"] || row["الصوت"] || "",
      text: row["التكست"] || row["النص"] || "",
    }));
  return {
    proposedName: field("الاسم المقترح للكرييتيف", "الاسم المقترح"),
    objective: field("الهدف"),
    mainMessage: field("الرسالة الأساسية", "الرسالة"),
    sound: field("الصوت"),
    cta: field("CTA"),
    script: field("السكريبت", "السكريبت الأساسي"),
    hook: field("Hook", "الهوك"),
    caption: field("الكابشن"),
    hashtags: field("الهاشتاج"),
    scenes,
    rawRows: normalized,
  };
}

export function formatMarketingDate(value: unknown, withTime = false) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("ar-SA", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}
