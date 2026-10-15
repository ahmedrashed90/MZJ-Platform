/** Source attribution for manually imported CRM leads; never implies a connected social DM. */
export type SheetLeadSource = { code: string; name: string; reportGroup: "digital" | "direct" | "other" };

type SheetSourceOption = SheetLeadSource & { aliases: readonly string[] };

export const DEFAULT_SHEET_LEAD_SOURCE: SheetLeadSource = {
  code: "sheet_lead",
  name: "\u0644\u064a\u062f - \u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0634\u064a\u062a",
  reportGroup: "digital",
};

export const SHEET_LEAD_SOURCES: readonly SheetSourceOption[] = [
  { code: "facebook_lead", name: "\u0641\u064a\u0633\u0628\u0648\u0643 \u0644\u064a\u062f", reportGroup: "digital", aliases: ["facebook", "fb", "facebookads", "facebooklead", "facebookleads", "fbleads"] },
  { code: "instagram_lead", name: "\u0625\u0646\u0633\u062a\u062c\u0631\u0627\u0645 \u0644\u064a\u062f", reportGroup: "digital", aliases: ["instagram", "instagramads", "instagramlead", "instagramleads", "insta", "ig"] },
  { code: "tiktok_lead", name: "\u062a\u064a\u0643 \u062a\u0648\u0643 \u0644\u064a\u062f", reportGroup: "digital", aliases: ["tiktok", "tiktokads", "tiktoklead", "tiktokleads", "tt"] },
  { code: "snapchat_lead", name: "\u0633\u0646\u0627\u0628 \u0634\u0627\u062a \u0644\u064a\u062f", reportGroup: "digital", aliases: ["snapchat", "snapchatads", "snapchatlead", "snap", "snapads"] },
  { code: "meta_lead", name: "\u0645\u064a\u062a\u0627 \u0644\u064a\u062f", reportGroup: "digital", aliases: ["meta", "metalead", "metaleads"] },
  { code: "google_ads", name: "\u0625\u0639\u0644\u0627\u0646\u0627\u062a \u062c\u0648\u062c\u0644", reportGroup: "digital", aliases: ["google", "googleads", "googleadwords", "googlelead", "googleleads"] },
  { code: "whatsapp", name: "\u0648\u0627\u062a\u0633\u0627\u0628", reportGroup: "digital", aliases: ["whatsapp", "wa", "whatsappbusiness"] },
  { code: "website", name: "\u0627\u0644\u0645\u0648\u0642\u0639 \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a", reportGroup: "digital", aliases: ["website", "web", "site", "websitelead", "landingpage"] },
  { code: "open_market", name: "السوق المفتوح", reportGroup: "direct", aliases: ["opensooq", "openmarket", "open souq", "السوق المفتوح"] },
  { code: "haraj", name: "\u0645\u0648\u0642\u0639 \u062d\u0631\u0627\u062c", reportGroup: "direct", aliases: ["haraj"] },
  { code: "sheet_other", name: "\u0645\u0635\u062f\u0631 \u0622\u062e\u0631", reportGroup: "other", aliases: ["other", "others", "otherlead", "misc"] },
];

function sourceKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u200b-\u200d]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/[^a-z0-9\u0621-\u064a]+/g, "");
}

export function resolveSheetLeadSource(value: unknown): SheetLeadSource | null {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_SHEET_LEAD_SOURCE;
  const key = sourceKey(raw);
  const option = SHEET_LEAD_SOURCES.find((item) => {
    if (key === sourceKey(item.code) || key === sourceKey(item.name)) return true;
    const shortLabel = item.name.replace(/\s*\u0644\u064a\u062f$/, "");
    if (key === sourceKey(shortLabel)) return true;
    return item.aliases.some((alias) => key === sourceKey(alias));
  });
  return option ? { code: option.code, name: option.name, reportGroup: option.reportGroup } : null;
}
