import type { CrmLead, CrmMessageTemplate } from "./types";

export const MERSAL_SEND_URL = "https://mersal-crm.next-erp-mzj.workers.dev/send/mersal";

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeWhatsappPhone(value: unknown) {
  let digits = text(value).replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabic = "٠١٢٣٤٥٦٧٨٩";
    const persian = "۰۱۲۳۴۵۶۷۸۹";
    const index = arabic.indexOf(digit);
    return String(index >= 0 ? index : persian.indexOf(digit));
  }).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^05\d{8}$/.test(digits)) digits = `966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) digits = `966${digits}`;
  return /^\d{8,15}$/.test(digits) ? digits : "";
}

function escapeTemplateLiteral(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function templateExpression(content: string) {
  const matches = [...content.matchAll(/{{\s*(\d+)\s*}}/g)];
  let expression = "";
  let cursor = 0;
  const indexes: number[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    expression += `${escapeTemplateLiteral(content.slice(cursor, match.index))}([\\s\\S]*?)`;
    indexes.push(Math.max(0, Number(match[1] || index + 1) - 1));
    cursor = Number(match.index || 0) + match[0].length;
  }
  expression += escapeTemplateLiteral(content.slice(cursor));
  return { regex: new RegExp(`^\\s*${expression}\\s*$`, "u"), indexes, count: matches.length };
}

export function extractTemplateParams(renderedText: string, template: CrmMessageTemplate) {
  const body = text(template.content).replace(/\r/g, "");
  const rendered = text(renderedText).replace(/\r/g, "");
  if (!body || !rendered) return [] as string[];
  const expression = templateExpression(body);
  if (!expression.count) return [] as string[];
  const match = rendered.match(expression.regex);
  if (!match) return [] as string[];
  const params: string[] = [];
  expression.indexes.forEach((targetIndex, captureIndex) => {
    params[targetIndex] = text(match[captureIndex + 1]).replace(/{{\s*\d+\s*}}/g, "").trim();
  });
  return params.filter((value) => value !== "");
}

export function textMatchesTemplate(renderedText: string, template?: CrmMessageTemplate | null) {
  if (!template) return false;
  const body = text(template.content).replace(/\r/g, "");
  const rendered = text(renderedText).replace(/\r/g, "");
  if (!body || !rendered) return false;
  const expression = templateExpression(body);
  return expression.count ? expression.regex.test(rendered) : rendered === body;
}

export function templateForOutgoingText(
  templates: CrmMessageTemplate[],
  selectedTemplateId: string,
  renderedText: string,
) {
  const selected = templates.find((template) => template.id === selectedTemplateId) || null;
  if (selected && textMatchesTemplate(renderedText, selected)) return selected;
  return templates.find((template) => textMatchesTemplate(renderedText, template)) || null;
}

export function buildMersalPayload(input: {
  lead: CrmLead;
  conversationId: string;
  messageText: string;
  template?: CrmMessageTemplate | null;
}) {
  const phone = normalizeWhatsappPhone(input.lead.phone_normalized || input.lead.phone);
  if (!phone) throw new Error("رقم واتساب غير موجود أو غير صالح لهذا العميل");
  const conversationRef = phone;
  if (input.template) {
    const templateName = text(input.template.name);
    if (!templateName) throw new Error("اسم قالب مرسال غير موجود");
    return {
      phone,
      waId: phone,
      conversationId: conversationRef,
      convId: conversationRef,
      leadId: input.lead.id,
      template_name: templateName,
      template_language: text(input.template.language_code) || "ar",
      params: extractTemplateParams(input.messageText, input.template),
    };
  }
  const message = text(input.messageText);
  if (!message) throw new Error("اكتب الرسالة أولًا");
  return {
    phone,
    waId: phone,
    conversationId: conversationRef,
    convId: conversationRef,
    leadId: input.lead.id,
    message,
    text: message,
  };
}

function providerError(data: any) {
  const values = [data?.error, data?.message, data?.raw?.message, data?.raw?.error, data?.raw];
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return "فشل إرسال الرسالة من مرسال";
}

export async function sendMersalDirect(payload: Record<string, unknown>) {
  let response: Response;
  try {
    response = await fetch(MERSAL_SEND_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`تعذر الاتصال بمرسال: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rawText = await response.text();
  let data: any = null;
  try { data = rawText ? JSON.parse(rawText) : null; } catch { data = { raw: rawText }; }
  const status = text(data?.status || data?.raw?.status).toLowerCase();
  if (!response.ok || data?.ok === false || status === "error") throw new Error(providerError(data));
  return data || { ok: true };
}

export function providerMessageId(response: any) {
  return text(
    response?.message_wamid
      || response?.wamid
      || response?.message_id
      || response?.raw?.message_wamid
      || response?.raw?.wamid
      || response?.raw?.message_id,
  );
}
