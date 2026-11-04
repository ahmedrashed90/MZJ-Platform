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
// Snapchat must not consider an event sent while its SDK is still loading.
const snapPendingViews = new Set<string>();
const snapPendingConversions = new Set<string>();
let snapSdkPromise: Promise<void> | null = null;

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

  // The Lead Forms campaign-link builder owns this stable key. Some link previewers
  // (including ChatGPT) replace utm_source with their own referral source while
  // preserving custom parameters. Do not lose the declared ad Pixel in that case.
  const declared = String(query.get('mzj_pixel_source') || '').trim().toLowerCase();
  const previewSource = !source || ['chatgptcom','chatgpt','openaicom'].includes(source);
  if (previewSource && (declared === 'meta' || declared === 'snapchat' || declared === 'tiktok')) return declared;

  const keys = new Set([...query.keys()].map(k => k.toLowerCase()));
  if (previewSource) {
    // Test-mode links are supplied by TikTok/Snapchat and are unambiguous even
    // when a link previewer overwrites utm_source. They do not authorize direct
    // visitors without a recognized ad or test marker to be tracked.
    if (keys.has('sctestmodeid') || keys.has('sccid') || keys.has('sc_click_id')) return 'snapchat';
    if (keys.has('tt_test_id') || keys.has('ttclid')) return 'tiktok';
    if (source) {
      // Compatibility for the existing MZJ test links shared before the stable
      // marker was added. Never infer a real campaign platform from its title.
      const campaign = String(query.get('utm_campaign') || '').toUpperCase();
      if (campaign.startsWith('MZJ_SNAP_PIXEL_TEST_')) return 'snapchat';
      if (campaign.startsWith('MZJ_TIKTOK_PIXEL_TEST_')) return 'tiktok';
    }
  }
  // An unrelated source must not be overridden by a different referrer.
  if (source) return null;
  if (keys.has('fbclid')) return 'meta';
  try {
    const domain = new URL(referrer).hostname.toLowerCase();
    if (domain === 'facebook.com' || domain.endsWith('.facebook.com') || domain === 'instagram.com' || domain.endsWith('.instagram.com') || domain === 'fb.com') return 'meta';
    if (domain === 'snapchat.com' || domain.endsWith('.snapchat.com')) return 'snapchat';
    if (domain === 'tiktok.com' || domain.endsWith('.tiktok.com')) return 'tiktok';
  } catch { /* The referrer is optional. */ }
  return null;
}

/** The CRM attribution and the browser Pixel must agree on the same ad source.
 * Keep the original Facebook/Instagram labels, but restore TikTok/Snapchat when
 * ad link previews replace utm_source or their official click/test markers exist.
 * Do not turn unknown campaign visits into advertising leads.
 */
export function formLeadAttribution(search: string, referrer: string) {
  const query = new URLSearchParams(search);
  const rawSource = String(query.get('utm_source') || query.get('source') || '').trim();
  const platform = detectFormAdPlatform(search, referrer);
  const source = platform === 'tiktok' || platform === 'snapchat'
    ? platform
    : platform === 'meta' && !['meta', 'facebook', 'fb', 'instagram', 'ig', 'facebook_ads', 'instagram_ads'].includes(rawSource.toLowerCase())
      ? 'meta'
      : rawSource || 'direct';
  return {
    source: source.slice(0, 100),
    campaign: String(query.get('utm_campaign') || '').slice(0, 160),
    medium: String(query.get('utm_medium') || '').slice(0, 120),
    adId: String(query.get('ad_id') || query.get('utm_content') || '').slice(0, 140),
  };
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
/** Respect the test marker supplied by Snapchat Events Manager. Their Pixel SDK
 * uses _scTestEvent to keep its test context after consent-gated loading.
 * Never generate a test ID locally or substitute our Pixel ID for the URL value.
 */
function prepareSnapTestMode() {
  try {
    const testId = [...new URLSearchParams(window.location.search).entries()]
      .find(([key]) => key.toLowerCase() === 'sctestmodeid')?.[1]?.trim();
    const key = '_scTestEvent';
    if (testId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(testId)) {
      window.localStorage.setItem(key, `${testId}|${Date.now()}`);
    } else if (!testId) {
      // Real campaign visits must not inherit an earlier test session.
      window.localStorage.removeItem(key);
    }
  } catch { /* Storage may be unavailable in private browsing. */ }
}

/** An SDK request can return 200 for metadata without ever sending an event.
 * Wait for the real SDK's handleRequest before dispatching PAGE_VIEW/SIGN_UP,
 * rather than treating a call to its temporary queue as successful delivery.
 * If a script load fails, permit the next attempt to load a fresh script.
 */
function ensureSnapSdk(): Promise<void> {
  const w = window as BrowserWithPixels;
  if (typeof w.snaptr?.handleRequest === 'function') return Promise.resolve();
  if (!w.snaptr) {
    const fn: PixelFunction = (...args: unknown[]) => {
      if (fn.handleRequest) fn.handleRequest(...args);
      else fn.queue?.push(args);
    };
    fn.queue = [];
    w.snaptr = fn;
  }
  if (!snapSdkPromise) {
    let pendingTag: HTMLScriptElement | null = null;
    snapSdkPromise = new Promise<void>((resolve, reject) => {
      const tag = document.createElement('script');
      pendingTag = tag;
      tag.async = true;
      tag.src = 'https://sc-static.net/scevent.min.js';
      tag.referrerPolicy = 'strict-origin-when-cross-origin';
      tag.onload = () => {
        if (typeof w.snaptr?.handleRequest === 'function') resolve();
        else reject(new Error('Snapchat Pixel SDK loaded without an event handler'));
      };
      tag.onerror = () => reject(new Error('Snapchat Pixel SDK failed to load'));
      try { document.head.appendChild(tag); }
      catch (error) { reject(error); }
    }).catch(error => {
      // Never cache a failed SDK load or mark an event as already dispatched.
      pendingTag?.remove();
      snapSdkPromise = null;
      throw error;
    });
  }
  return snapSdkPromise;
}

async function sendSnapEvent(pixelId: string, eventName: 'PAGE_VIEW' | 'SIGN_UP', expectedUrl?: string): Promise<boolean> {
  prepareSnapTestMode();
  // One bounded retry protects against transient SDK loading failures.
  try { await ensureSnapSdk(); }
  catch { await ensureSnapSdk(); }
  // Someone may have revoked consent while the async library was loading.
  if (readPixelConsent() === 'deny') return false;
  if (expectedUrl && expectedUrl !== `${window.location.pathname}${window.location.search}`) return false;
  const w = window as BrowserWithPixels;
  if (typeof w.snaptr?.handleRequest !== 'function') throw new Error('Snapchat Pixel SDK is not ready');
  const initKey = `snapchat:${pixelId}`;
  if (!inited.has(initKey)) {
    w.snaptr('init', pixelId, {});
    inited.add(initKey);
  }
  w.snaptr('track', eventName);
  return true;
}

function trackSnapPageView(pixelId: string, slug: string) {
  // React StrictMode must not duplicate events. A separate test URL or ad link
  // must still get a new PAGE_VIEW even if it renders the same form slug.
  const pageUrl = `${window.location.pathname}${window.location.search}`;
  const viewKey = `snapchat:${pixelId}:${slug}:${pageUrl}`;
  if (viewed.has(viewKey) || snapPendingViews.has(viewKey)) return;
  snapPendingViews.add(viewKey);
  void sendSnapEvent(pixelId, 'PAGE_VIEW', pageUrl).then(sent => {
    if (sent) viewed.add(viewKey);
  }).catch(error => console.warn('Snapchat PAGE_VIEW was not dispatched', error))
    .finally(() => snapPendingViews.delete(viewKey));
}

function trackSnapConversion(pixelId: string, leadId: string) {
  const key = `snapchat:${pixelId}:${leadId}`;
  if (converted.has(key) || snapPendingConversions.has(key)) return;
  snapPendingConversions.add(key);
  void sendSnapEvent(pixelId, 'SIGN_UP').then(sent => {
    if (sent) converted.add(key);
  }).catch(error => console.warn('Snapchat SIGN_UP was not dispatched', error))
    .finally(() => snapPendingConversions.delete(key));
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
  if (platform === 'snapchat') {
    trackSnapPageView(id, slug);
    return;
  }
  const viewKey = `${platform}:${id}:${slug}`;
  try {
    if (platform === 'meta') bootMeta(id);
    if (platform === 'tiktok') bootTikTok(id);
    // StrictMode / React remounts must not send duplicate PageViews.
    if (viewed.has(viewKey)) return;
    viewed.add(viewKey);
    const w = window as BrowserWithPixels;
    if (platform === 'meta') w.fbq?.('trackSingle', id, 'PageView');
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
  if (platform === 'snapchat') {
    trackSnapConversion(entry.id, lead.id);
    return;
  }
  const key = `${platform}:${entry.id}:${lead.id}`;
  if (converted.has(key)) return;
  try {
    if (platform === 'meta') bootMeta(entry.id);
    if (platform === 'tiktok') bootTikTok(entry.id);
    const w = window as BrowserWithPixels;
    if (platform === 'meta') w.fbq?.('trackSingle', entry.id, 'Lead');
    else w.ttq?.track('Lead'); // TikTok's current standard name for a submitted form.
    converted.add(key);
  } catch (error) {
    console.warn('Lead form conversion pixel unavailable', error);
  }
}
