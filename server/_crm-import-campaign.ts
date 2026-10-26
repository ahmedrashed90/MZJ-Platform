/** Attribution for sheet imports. Never infer a Facebook/Instagram campaign for other platforms. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function first(...values: unknown[]): string {
  for (const value of values) {
    const item = text(value);
    if (item) return item;
  }
  return "";
}

export function resolveSheetImportCampaign(payload: Record<string, unknown>, sourceCode: string) {
  const campaignName = first(payload.campaignName, payload.campaign_name).slice(0, 200);
  const sheetCampaignName = first(payload.sheetCampaignName, payload.sheet_campaign_name).slice(0, 200);
  const marker = first(payload.metaPlatform, payload.meta_platform).toLowerCase();
  const isSheetImport = first(payload.provider, payload.providerName, payload.provider_name) === "tsv_sheet";
  // Separate Facebook/Instagram source registrations without Platform mapping
  // keep their own campaign columns. Legacy Meta splitter sends the marker.
  const isMetaSheet = isSheetImport && (sourceCode === "meta_lead"
    || (["facebook_lead", "instagram_lead"].includes(sourceCode) && ["fb", "ig"].includes(marker)));
  if (isMetaSheet) {
    // For Meta, CRM campaign_name intentionally stores the platform label,
    // while the original advertising campaign name stays in extra_data.
    const metaPlatform = marker === "fb" || marker === "ig" ? marker
      : sourceCode === "facebook_lead" ? "fb" : sourceCode === "instagram_lead" ? "ig" : "";
    return {
      campaignName: metaPlatform === "fb" ? "فيسبوك" : metaPlatform === "ig" ? "انستجرام" : "",
      sheetCampaignName,
      metaPlatform,
    };
  }
  return { campaignName, sheetCampaignName, metaPlatform: "" };
}
