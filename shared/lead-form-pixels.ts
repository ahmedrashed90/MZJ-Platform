/** Browser-only conversion tracking for the Marketing Lead Forms module.
 * Pixel IDs are public identifiers, never API tokens or customer information.
 * Tracking starts disabled until enabled by a Marketing Lead Forms editor.
 */
export type LeadFormPixelPlatform = 'meta' | 'snapchat' | 'tiktok';
export type LeadFormPixelEntry = { id: string; enabled: boolean };
export type LeadFormPixelSettings = Record<LeadFormPixelPlatform, LeadFormPixelEntry>;

// IDs are the separate MZJ Lead Forms pixels. Disabled by default on a new installation.
export const DEFAULT_LEAD_FORM_PIXELS: LeadFormPixelSettings = {
  meta: { id: '1635122171397100', enabled: false },
  snapchat: { id: '0013dd43-0c92-4403-bb53-1793e1f5d077', enabled: false },
  tiktok: { id: 'DBLL5EBC77UASCMH46OG', enabled: false },
};

const VALID_PIXEL_ID: Record<LeadFormPixelPlatform, RegExp> = {
  meta: /^\d{12,20}$/,
  snapchat: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  tiktok: /^[A-Z0-9]{12,32}$/i,
};

export function validateLeadFormPixels(input: unknown): LeadFormPixelSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('إعدادات Pixels غير صحيحة');
  const source = input as Record<string, unknown>;
  const output = {} as LeadFormPixelSettings;
  for (const platform of ['meta', 'snapchat', 'tiktok'] as const) {
    const raw = source[platform];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('إعداد Pixel غير صحيح');
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.enabled !== 'boolean') throw new Error('معرف أو حالة Pixel غير صحيحة');
    const id = item.id.trim();
    if (id && !VALID_PIXEL_ID[platform].test(id)) throw new Error(`معرف ${platform} غير صالح`);
    if (item.enabled && !id) throw new Error(`اكتب معرف ${platform} قبل التفعيل`);
    output[platform] = { id, enabled: item.enabled };
  }
  return output;
}

export function getPublicLeadFormPixels(settings: LeadFormPixelSettings): LeadFormPixelSettings {
  // An unpublished/disabled ID must never load a script, including on form previews.
  return {
    meta: settings.meta.enabled ? { ...settings.meta } : { id: '', enabled: false },
    snapchat: settings.snapchat.enabled ? { ...settings.snapchat } : { id: '', enabled: false },
    tiktok: settings.tiktok.enabled ? { ...settings.tiktok } : { id: '', enabled: false },
  };
}
