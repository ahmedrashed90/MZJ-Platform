import type { CrmLead, CrmMeta } from "./types";

export type DirectMersalTemplate = {
  id: string;
  name?: string | null;
  external_id?: string | null;
  display_name?: string | null;
  content?: string | null;
  language_code?: string | null;
  provider?: string | null;
  template_type?: string | null;
};

export type DirectMersalResult = {
  ok: true;
  status: "sent";
  workerUrl: string;
  response: Record<string, unknown>;
  providerMessageId: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePhone(value: unknown) {
  let digits = text(value).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("05") && digits.length === 10) digits = `966${digits.slice(1)}`;
  if (digits.startsWith("5") && digits.length === 9) digits = `966${digits}`;
  return digits;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

export function extractMersalTemplateParams(templateBody: string, renderedText: string): string[] | null {
  const source = String(templateBody || "").replace(/\r/g, "").trim();
  const output = String(renderedText || "").replace(/\r/g, "").trim();
  const matches = [...source.matchAll(/{{\s*(\d+)\s*}}/g)];
  if (!matches.length) return source === output ? [] : null;

  let pattern = "^\\s*";
  let lastIndex = 0;
  const positions: number[] = [];
  for (const match of matches) {
    pattern += escapeRegex(source.slice(lastIndex, match.index));
    pattern += "([\\s\\S]*?)";
    positions.push(Math.max(0, Number(match[1] || positions.length + 1) - 1));
    lastIndex = Number(match.index) + match[0].length;
  }
  pattern += `${escapeRegex(source.slice(lastIndex))}\\s*$`;
  const result = new RegExp(pattern, "u").exec(output);
  if (!result) return null;

  const values: string[] = [];
  positions.forEach((position, index) => {
    values[position] = text(result[index + 1]).replace(/{{\s*\d+\s*}}/g, "").trim();
  });
  return values.filter((value) => value !== "");
}

export function templateTextMatches(templateBody: string, renderedText: string) {
  return extractMersalTemplateParams(templateBody, renderedText) !== null;
}

function providerMessageId(response: Record<string, unknown>) {
  const raw = response.raw && typeof response.raw === "object" ? response.raw as Record<string, unknown> : {};
  return text(
    response.provider_message_id
      || response.message_wamid
      || response.message_id
      || raw.provider_message_id
      || raw.message_wamid
      || raw.message_id,
  );
}

function workerError(response: Record<string, unknown>, fallback: string) {
  const raw = response.raw;
  if (raw && typeof raw === "object") {
    const rawObject = raw as Record<string, unknown>;
    const message = text(rawObject.error || rawObject.message);
    if (message) return message;
  }
  return text(response.error || response.message) || fallback;
}

export function resolveMersalWorkerUrl(meta: CrmMeta | null) {
  const rows = Array.isArray(meta?.endpoints) ? meta!.endpoints : [];
  const endpoint = rows.find((row) => {
    const source = text(row.source_code).toLowerCase();
    return row.is_active !== false && (source === "whatsapp" || source === "mersal");
  });
  const url = text(endpoint?.send_url || endpoint?.text_send_url);
  if (!url) throw new Error("مسار إرسال واتساب غير مضبوط في إعدادات المنصة");
  return url;
}

export async function sendMersalDirect(input: {
  meta: CrmMeta | null;
  lead: CrmLead;
  conversationId: string;
  text: string;
  template?: DirectMersalTemplate | null;
  renderedTemplateBody?: string;
}): Promise<DirectMersalResult> {
  const workerUrl = resolveMersalWorkerUrl(input.meta);
  const phone = normalizePhone(input.lead.phone_normalized || input.lead.phone);
  if (!phone) throw new Error("رقم واتساب غير موجود أو غير صالح لهذا العميل");

  const message = text(input.text);
  const base = {
    phone,
    waId: phone,
    conversationId: phone,
    convId: phone,
    leadId: input.lead.id || "",
  };

  let payload: Record<string, unknown>;
  if (input.template) {
    const templateName = text(input.template.name || input.template.external_id);
    if (!templateName) throw new Error("قالب واتساب غير مربوط باسم قالب مرسال");
    const templateBody = text(input.renderedTemplateBody || input.template.content);
    const params = extractMersalTemplateParams(templateBody, message);
    if (params === null) throw new Error("نص الرسالة لم يعد مطابقًا للقالب؛ امسح القالب واكتب النص الحر ثم أرسل");
    payload = {
      ...base,
      template_name: templateName,
      template_language: text(input.template.language_code) || "ar",
      params,
    };
  } else {
    if (!message) throw new Error("اكتب الرسالة قبل الإرسال");
    payload = { ...base, message, text: message };
  }

  let response: Response;
  try {
    response = await fetch(workerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`تعذر الاتصال بمرسال: ${error instanceof Error ? error.message : String(error)}`);
  }

  const rawText = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
  } catch {
    data = { raw: rawText };
  }

  const rawObject = data.raw && typeof data.raw === "object" ? data.raw as Record<string, unknown> : {};
  const status = text(data.status || rawObject.status).toLowerCase();
  if (!response.ok || data.ok === false || status === "error" || status === "failed") {
    throw new Error(workerError(data, `فشل إرسال الرسالة من مرسال (HTTP ${response.status})`));
  }

  return {
    ok: true,
    status: "sent",
    workerUrl,
    response: data,
    providerMessageId: providerMessageId(data),
  };
}
