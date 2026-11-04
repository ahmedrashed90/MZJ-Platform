/** MZJ published lead forms only. Browser Pixels; NO Conversions API, Events API,
 * access tokens, server-side advertising requests or changes to CRM logic.
 * Third-party scripts are loaded only after an optional, explicit tracking opt-in.
 */
import type { LeadFormPixelPlatform, LeadFormPixelSettings } from '../../../shared/lead-form-pixels';

export type TrackingChoice = 'allow' | 'deny' | null;
const CHOICE_STORAGE_KEY = 'mzj-lead-forms-pixel-consent-v1';
const viewed = new Set<string>();
const converted = new Set<string>();
const inited = new Set<string>();

type PixelFunction = ((...args: unknown[]) => void) & {
  queue?: unknown[][];
  handleRequest?: (...args: unknown[]) => void;
  callMethod?: (...args: unknown[]) => void;
  loaded?: boolean;
  version?: string;
};
type BrowserWithPixels = Window & {
  fbq?: PixelFunction; _fbq?: PixelFunction;
  snaptr?: PixelFunction;
  ttq?: any; // TikTok's own pixel stub adds dynamic methods at runtime.
  TiktokAnalyticsObject?: string;
};

export function readPixelConsent(): TrackingChoice {
  try {
    const choice = window.localStorage.getItem(CHOICE_STORAGE_KEY);
    return choice === 'allow' || choice === 'deny' ? choice : null;
  } catch { return null; }
}
export function savePixelConsent(choice: Exclude<TrackingChoice, null>) {
  try { window.localStorage.setItem(CHOICE_STORAGE_KEY, choice); } catch { /* private mode */ }
}

/** UTM is set by the existing Lead Forms campaign-link builder.
 * Click IDs/referrer are fallbacks only; no tracking on direct/unknown visits.
 */
export function detectFormAdPlatform(search: string, referrer: string): LeadFormPixelPlatform | null {
  const query = new URLSearchParams(search);
  const source = String(query.get('utm_source') || query.get('source') || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (['meta','facebook','fb','instagram','ig','facebook_ads','instagram_ads'].includes(source)) return 'meta';
  if (['snapchat','snap','snap_ads'].includes(source)) return 'snapchat';
  if (['tiktok','tik_tok','tiktok_ads'].includes(source)) return 'tiktok';
  // A present, unrecognized source must not be overridden by a different referrer.
  if (source) return null;
  const keys = new Set([...query.keys()].map(k => k.toLowerCase()));
  if (keys.has('fbclid')) return 'meta';
  if (keys.has('sccid') || keys.has('sc_click_id')) return 'snapchat';
  if (keys.has('ttclid')) return 'tiktok';
  try {
    const domain = new URL(referrer).hostname.toLowerCase();
    if (domain === 'facebook.com' || domain.endsWith('.facebook.com') || domain === 'instagram.com' || domain.endsWith('.instagram.com') || domain === 'fb.com') return 'meta';
    if (domain === 'snapchat.com' || domain.endsWith('.snapchat.com')) return 'snapchat';
    if (domain === 'tiktok.com' || domain.endsWith('.tiktok.com')) return 'tiktok';
  } catch { /* The referrer is optional. */ }
  return null;
}

/** Avoid document.write and never pass form fields, telephone, name or answers. */
function appendPixelScript(src: string) {
  const tag = document.createElement('script');
  tag.async = true;
  tag.src = src;
  tag.referrerPolicy = 'strict-origin-when-cross-origin';
  document.head.appendChild(tag);
}
function bootMeta(pixelId: string) {
  const w = window as BrowserWithPixels;
  if (!w.fbq) {
    const fn: PixelFunction = (...args: unknown[]) => {
      if (fn.callMethod) fn.callMethod(...args);
      else fn.queue?.push(args);
    };
    fn.queue = [];
    fn.loaded = true;
    fn.version = '2.0';
    w.fbq = fn;
    w._fbq = fn;
    appendPixelScript('https://connect.facebook.net/en_US/fbevents.js');
  }
  if (!inited.has(`meta:${pixelId}`)) {
    w.fbq?.('set', 'autoConfig', false, pixelId);
    w.fbq?.('init', pixelId);
    inited.add(`meta:${pixelId}`);
  }
}
function bootSnap(pixelId: string) {
  const w = window as BrowserWithPixels;
  if (!w.snaptr) {
    const fn: PixelFunction = (...args: unknown[]) => {
      if (fn.handleRequest) fn.handleRequest(...args);
      else fn.queue?.push(args);
    };
    fn.queue = [];
    w.snaptr = fn;
    appendPixelScript('https://sc-static.net/scevent.min.js');
  }
  if (!inited.has(`snapchat:${pixelId}`)) {
    // No user_email/user_phone or other advanced-matching information.
    w.snaptr?.('init', pixelId);
    inited.add(`snapchat:${pixelId}`);
  }
}
function bootTikTok(pixelId: string) {
  const w = window as BrowserWithPixels;
  if (!w.ttq) {
    // TikTok's official queued pixel loader, restricted to the public form route.
    const q: any = [];
    w.TiktokAnalyticsObject = 'ttq';
    w.ttq = q;
    q.methods = ['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie','holdConsent','revokeConsent','grantConsent'];
    q.setAndDefer = (target: any, method: string) => {
      target[method] = (...args: unknown[]) => target.push([method, ...args]);
    };
    for (const method of q.methods) q.setAndDefer(q, method);
    q.instance = (id: string) => {
      const target = q._i[id] || [];
      for (const method of q.methods) q.setAndDefer(target, method);
      return target;
    };
    q.load = (id: string) => {
      q._i = q._i || {};
      q._i[id] = [];
      q._i[id]._u = 'https://analytics.tiktok.com/i18n/pixel/events.js';
      q._t = q._t || {};
      q._t[id] = +new Date();
      q._o = q._o || {};
      q._o[id] = {};
      appendPixelScript(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(id)}&lib=ttq`);
    };
  }
  if (!inited.has(`tiktok:${pixelId}`)) {
    w.ttq.load(pixelId);
    inited.add(`tiktok:${pixelId}`);
  }
}

/** Execute at most one platform's pixels; the form must have a recognized ad source. */
export function startFormAdPixel(
  platform: LeadFormPixelPlatform | null,
  settings: LeadFormPixelSettings | null,
  slug: string,
  consent: TrackingChoice,
) {
  if (consent !== 'allow' || !platform || !settings || !slug) return;
  const entry = settings[platform];
  if (!entry?.enabled || !entry.id) return;
  const { id } = entry;
  const viewKey = `${platform}:${id}:${slug}`;
  try {
    if (platform === 'meta') bootMeta(id);
    if (platform === 'snapchat') bootSnap(id);
    if (platform === 'tiktok') bootTikTok(id);
    // StrictMode / React remounts must not send duplicate PageViews.
    if (viewed.has(viewKey)) return;
    viewed.add(viewKey);
    const w = window as BrowserWithPixels;
    if (platform === 'meta') w.fbq?.('trackSingle', id, 'PageView');
    else if (platform === 'snapchat') w.snaptr?.('track', 'PAGE_VIEW');
    else w.ttq?.page();
  } catch (error) {
    // Tracking can fail or be blocked without affecting the form or CRM.
    console.warn('Lead form pixel initialization unavailable', error);
  }
}

export function trackStoredFormLead(
  platform: LeadFormPixelPlatform | null,
  settings: LeadFormPixelSettings | null,
  consent: TrackingChoice,
  lead: {id: string; created: boolean; crmStatus: string | null},
) {
  // A replayed submission or a phone already in CRM is not a new acquisition.
  if (consent !== 'allow' || !platform || !settings || !lead.created || lead.crmStatus === 'existing') return;
  const entry = settings[platform];
  if (!entry?.enabled || !entry.id || !lead.id) return;
  const key = `${platform}:${entry.id}:${lead.id}`;
  if (converted.has(key)) return;
  try {
    if (platform === 'meta') bootMeta(entry.id);
    if (platform === 'snapchat') bootSnap(entry.id);
    if (platform === 'tiktok') bootTikTok(entry.id);
    const w = window as BrowserWithPixels;
    if (platform === 'meta') w.fbq?.('trackSingle', entry.id, 'Lead');
    else if (platform === 'snapchat') w.snaptr?.('track', 'SIGN_UP');
    else w.ttq?.track('Lead'); // TikTok's current standard name for a submitted form.
    converted.add(key);
  } catch (error) {
    console.warn('Lead form conversion pixel unavailable', error);
  }
}
