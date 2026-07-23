import { getSql } from "../../_db.js";
import { MarketingError, clean } from "../common.js";
import { decryptPlatformSecret } from "./security.js";
import { isVideoFile, normalizeSaudiPhone, providerJson } from "./shared.js";
import type { PlatformConnection, PublishResult, PublishTargetContext } from "./types.js";

type MersalSettings = { apiEndpoint: string; token: string; imageTemplate: string; videoTemplate: string; templateLanguage: string };

function endpoint(value: unknown) { return (clean(value) || "https://w-mersal.com").replace(/\/+$/, ""); }

export async function mersalSettings(): Promise<MersalSettings> {
  const sql = getSql();
  const [row] = await sql<any[]>`select value from marketing.settings where key='mersal'`;
  const value = row?.value && typeof row.value === "object" ? row.value : {};
  const encrypted = clean(value.tokenEncrypted);
  const token = encrypted ? decryptPlatformSecret(encrypted) : clean(process.env.MERSAL_TOKEN);
  return {
    apiEndpoint: endpoint(value.apiEndpoint || value.endpoint || process.env.MERSAL_API_ENDPOINT),
    token,
    imageTemplate: clean(value.imageTemplate) || "mzj_image_caption_v4",
    videoTemplate: clean(value.videoTemplate) || "mzj_video_campaign",
    templateLanguage: clean(value.templateLanguage || value.language) || "ar",
  };
}

export async function validateMersal() {
  const settings = await mersalSettings();
  if (!settings.token) throw new MarketingError(409, "توكن مرسال غير محفوظ في إعدادات التسويق", "MERSAL_TOKEN_MISSING");
  const url = `${settings.apiEndpoint}/api/wpbox/getTemplates?token=${encodeURIComponent(settings.token)}`;
  const payload = await providerJson<any>(url, {}, "Mersal");
  return { templates: Array.isArray(payload.templates) ? payload.templates.length : 0 };
}

export async function publishMersal(connection: PlatformConnection, context: PublishTargetContext): Promise<PublishResult> {
  if (connection.status !== "connected") return { status: "blocked", errorMessage: "WhatsApp / مرسال غير متصلة" };
  const settings = await mersalSettings();
  if (!settings.token) return { status: "blocked", errorMessage: "توكن مرسال غير محفوظ" };
  const phones = [...new Set(context.recipients.map(normalizeSaudiPhone).filter(Boolean))];
  if (!phones.length) return { status: "failed", errorMessage: "لم يتم تحديد أرقام واتساب صالحة" };
  if (context.mediaUrl && isVideoFile(context.mediaUrl, context.mimeType, context.postTypeCode)) {
    return { status: "blocked", errorMessage: "نشر فيديو واتساب غير مفعل لأن مسار Mersal Video غير مؤكد" };
  }
  const sent: Array<{ phone: string; id: string }> = [];
  if (context.mediaUrl) {
    const url = `${settings.apiEndpoint}/api/wpbox/sendtemplatemessage`;
    for (const phone of phones) {
      const payload = {
        token: settings.token,
        phone,
        template_name: settings.imageTemplate,
        template_language: settings.templateLanguage,
        components: [
          { type: "header", parameters: [{ type: "image", image: { link: context.mediaUrl } }] },
          { type: "body", parameters: [{ type: "text", text: clean(context.caption) || context.message || "MZJ" }, { type: "text", text: clean(context.hashtags) || " " }] },
        ],
      };
      const result = await providerJson<any>(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) }, "Mersal");
      sent.push({ phone, id: clean(result.message_wamid || result.message_id) });
    }
  } else {
    const url = `${settings.apiEndpoint}/api/wpbox/sendmessage`;
    for (const phone of phones) {
      const form = new FormData();
      form.append("token", settings.token); form.append("phone", phone); form.append("message", context.message || "MZJ");
      const result = await providerJson<any>(url, { method: "POST", body: form }, "Mersal");
      sent.push({ phone, id: clean(result.message_wamid || result.message_id) });
    }
  }
  return { status: "published", externalId: sent[0]?.id || null, responseSummary: { recipients: sent.length, messageIds: sent.map((item) => item.id).filter(Boolean) } };
}
