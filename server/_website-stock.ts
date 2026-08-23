type JsonRecord = Record<string, unknown>;

export type WebsiteStockCar = {
  postId: number;
  vehicleId: string;
  title: string;
  price: number;
  priceBeforeTax: number;
  stock: number | null;
  hasImages: boolean;
  hasCompareKey: boolean;
  compareKey: string | null;
  imageUrl: string | null;
  url: string;
};

type WebsiteStockResult = {
  cars: WebsiteStockCar[];
  updatedAt: string;
  baseUrl: string;
  warning?: string;
};

const CACHE_MS = 120_000;
let cached: { expiresAt: number; value: WebsiteStockResult } | null = null;

const VEHICLE_ID_RE = /\bMZJ\d{6,}\b/i;
const COMPARE_KEYS = new Set([
  "_mzjpan_compare_key","_mzjpnc_compare_key","_mzjech_compare_key","_mzjalt_compare_key","_mzjsum_compare_key",
  "_mzjkey_compare_key","_mzjmdr_compare_key","_mzjnx_compare_key","_mzjhzn_compare_key","_mzjher_compare_key",
  "_mzjim_compare_key","_mzjsup_compare_key","_mzjdyn_compare_key","_mzjmon_compare_key","_mzjroy_compare_key",
  "_mzjcrest_compare_key","_mzjcrn_compare_key","_mzjsov_compare_key","_mzjoc_compare_key","_mzjcu_compare_key",
  "_mzjn_compare_key","_mzj_compare_key","compare_key","comparekey","_mzj_sheet_ref","_mzjn_sheet_ref",
  "_mzjccs_compare_key","_mzjci_compare_key","_mzjcz_compare_key","_mzjcau_compare_key",
]);
const STOCK_KEYS = new Set([
  "_mzj_vcf_last_match_qty","stock_quantity","_stock_quantity","total_vehicle_in_stock","_total_vehicle_in_stock",
  "vehicle_stock","_vehicle_stock","car_stock","_car_stock","cardealer_stock","_cardealer_stock","cd_stock","_cd_stock","_stock","stock",
]);
const PRICE_KEYS = new Set([
  "regular_price","_regular_price","price","_price","sale_price","_sale_price","car_price","_car_price",
]);

function baseUrl() {
  return String(process.env.MZJ_WEBSITE_BASE_URL || "https://mzjcars.com").trim().replace(/\/+$/, "");
}

function decodeHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/[٬,\s]/g, "").replace(/[^0-9.\-]/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function walk(value: unknown, visit: (key: string, value: unknown) => boolean | void, key = ""): boolean {
  if (visit(key.toLowerCase(), value) === true) return true;
  if (Array.isArray(value)) {
    for (const item of value) if (walk(item, visit, key)) return true;
    return false;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as JsonRecord)) {
      if (walk(childValue, visit, childKey)) return true;
    }
  }
  return false;
}

function findVehicleId(value: unknown) {
  let result = "";
  walk(value, (_key, item) => {
    if (typeof item !== "string") return false;
    const match = item.match(VEHICLE_ID_RE);
    if (!match) return false;
    result = match[0].toUpperCase();
    return true;
  });
  return result;
}

function findByKeys(value: unknown, keys: Set<string>) {
  let result: unknown = null;
  walk(value, (key, item) => {
    if (!keys.has(key)) return false;
    if (item == null || item === "") return false;
    result = item;
    return true;
  });
  return result;
}

function embeddedImage(item: any) {
  const media = item?._embedded?.["wp:featuredmedia"]?.[0];
  const direct = typeof media?.source_url === "string" ? media.source_url : "";
  if (direct) return direct;
  const sizes = media?.media_details?.sizes || {};
  for (const size of ["large", "medium_large", "medium", "thumbnail"]) {
    if (typeof sizes?.[size]?.source_url === "string") return sizes[size].source_url;
  }
  return "";
}

async function fetchText(url: string, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "MZJ-Platform/1.0 (+website-stock)" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { text: await response.text(), headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, timeoutMs = 10_000) {
  const { text, headers } = await fetchText(url, timeoutMs);
  return { json: JSON.parse(text), headers };
}

async function fetchRestCars(base: string) {
  const rows: any[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= 20; page += 1) {
    const endpoint = `${base}/wp-json/wp/v2/cars?status=publish&per_page=100&page=${page}&_embed=wp:featuredmedia`;
    const result = await fetchJson(endpoint, 12_000);
    if (!Array.isArray(result.json)) throw new Error("WORDPRESS_CARS_REST_INVALID");
    rows.push(...result.json);
    totalPages = Math.max(1, Math.min(20, Number(result.headers.get("x-wp-totalpages") || 1) || 1));
  }
  return rows;
}

async function fetchArchiveLinks(base: string) {
  const { text } = await fetchText(`${base}/cars/`, 12_000);
  const links = new Set<string>();
  const regex = /href=["']([^"']*\/cars\/[^"'#?]+\/?)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    try {
      const url = new URL(match[1], base).toString();
      if (new URL(url).origin === new URL(base).origin) links.add(url);
    } catch {
      // Ignore malformed public links.
    }
  }
  return [...links].map((url, index) => ({ id: index + 1, link: url, slug: url.split("/").filter(Boolean).pop() || "", title: { rendered: "" } }));
}

type CheckoutPageConfig = {
  ajaxUrl: string;
  stockNonce: string;
  carId: number;
  taxRate: number;
};

function checkoutPageConfig(html: string, pageUrl: string): CheckoutPageConfig | null {
  const match = html.match(/(?:var|let|const)\s+MZJ_VCF\s*=\s*(\{[\s\S]*?\});/i);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]);
    const carId = Math.trunc(Number(parsed?.carId || 0));
    const stockNonce = String(parsed?.stockNonce || "").trim();
    const ajaxRaw = String(parsed?.ajaxUrl || "").trim();
    const taxRateRaw = Number(parsed?.taxRate);
    const taxRate = Number.isFinite(taxRateRaw) && taxRateRaw >= 0 ? taxRateRaw : 15;
    if (!carId || !stockNonce || !ajaxRaw) return { ajaxUrl: "", stockNonce: "", carId, taxRate };
    return { ajaxUrl: new URL(ajaxRaw, pageUrl).toString(), stockNonce, carId, taxRate };
  } catch {
    return null;
  }
}

async function fetchLiveStockQty(config: CheckoutPageConfig | null) {
  if (!config?.ajaxUrl || !config.stockNonce || !config.carId) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const body = new URLSearchParams({
      action: "mzj_vcf_refresh_stock",
      nonce: config.stockNonce,
      car_id: String(config.carId),
    });
    const response = await fetch(config.ajaxUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "user-agent": "MZJ-Platform/1.0 (+website-stock)",
      },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as any;
    const qty = numeric(payload?.success === true ? payload?.data?.qty : null);
    return qty == null ? null : Math.max(0, Math.trunc(qty));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function htmlDetails(html: string) {
  const priceMatch = html.match(/<div[^>]*class=["'][^"']*mzjpan-price[^"']*["'][^>]*>[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i);
  const price = numeric(decodeHtml(priceMatch?.[1] || ""));
  const mainImage = html.match(/<img[^>]*data-gallery-main[^>]*src=["']([^"']+)["']/i)?.[1]
    || html.match(/<img[^>]*src=["']([^"']+)["'][^>]*data-gallery-main/i)?.[1]
    || "";
  const hasGalleryThumb = /data-gallery-thumb/i.test(html);
  const unavailable = /class=["'][^"']*mzjpan-unavailable[^"']*["']/i.test(html);
  const specValues = [...html.matchAll(/<details[^>]*class=["'][^"']*mzjpan-spec-group[^"']*["'][\s\S]*?<\/details>/gi)]
    .flatMap((detail) => [...detail[0].matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>/gi)].map((value) => decodeHtml(value[1])));
  const hasCompareKey = specValues.some((value) => value && !/^[—\-–]+$/.test(value));
  const title = decodeHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
  const vehicleId = (html.match(VEHICLE_ID_RE)?.[0] || "").toUpperCase();
  return {
    price,
    mainImage,
    hasImages: Boolean(mainImage || hasGalleryThumb),
    unavailable,
    hasCompareKey,
    title,
    vehicleId,
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  const output = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker()));
  return output;
}

function problemCount(car: WebsiteStockCar) {
  return (car.hasImages ? 0 : 1) + (car.hasCompareKey ? 0 : 1);
}

async function buildStock(): Promise<WebsiteStockResult> {
  const base = baseUrl();
  let records: any[] = [];
  let warning = "";
  try {
    records = await fetchRestCars(base);
  } catch (error) {
    warning = `تعذر قراءة WordPress REST مباشرة: ${error instanceof Error ? error.message : String(error)}`;
    records = await fetchArchiveLinks(base);
  }

  const cars = await mapWithConcurrency(records, 4, async (item): Promise<WebsiteStockCar | null> => {
    const url = String(item?.link || "").trim();
    if (!url) return null;
    let html = "";
    try {
      html = (await fetchText(url, 10_000)).text;
    } catch {
      // REST data still provides enough to keep the car visible in the platform.
    }
    const details = html ? htmlDetails(html) : null;
    const checkoutConfig = html ? checkoutPageConfig(html, url) : null;
    const title = decodeHtml(String(item?.title?.rendered || details?.title || item?.slug || "سيارة"));
    const vehicleId = findVehicleId(item) || details?.vehicleId || findVehicleId(url);
    const rawCompare = findByKeys(item, COMPARE_KEYS);
    const compareKey = String(rawCompare ?? "").trim() || null;
    const rawPrice = findByKeys(item, PRICE_KEYS);
    const price = Math.max(0, Number(numeric(rawPrice) ?? details?.price ?? 0));
    const rawStock = findByKeys(item, STOCK_KEYS);
    const parsedStock = numeric(rawStock);
    const liveStock = html ? await fetchLiveStockQty(checkoutConfig) : null;
    const stock = liveStock ?? (parsedStock == null ? (details?.unavailable ? 0 : null) : Math.max(0, Math.trunc(parsedStock)));
    const imageUrl = embeddedImage(item) || details?.mainImage || null;
    const hasImages = Boolean(imageUrl || details?.hasImages);
    const hasCompareKey = Boolean(compareKey || details?.hasCompareKey);
    const taxRate = Number.isFinite(Number(checkoutConfig?.taxRate)) ? Number(checkoutConfig?.taxRate) : 15;
    const taxDivisor = 1 + Math.max(0, taxRate) / 100;
    return {
      postId: Number(item?.id || 0),
      vehicleId: vehicleId || `WP-${Number(item?.id || 0)}`,
      title,
      price,
      priceBeforeTax: price > 0 && taxDivisor > 0 ? Math.round((price / taxDivisor) * 100) / 100 : 0,
      stock,
      hasImages,
      hasCompareKey,
      compareKey,
      imageUrl,
      url,
    };
  });

  const visibleCars = cars.filter((car): car is WebsiteStockCar => Boolean(car));
  visibleCars.sort((left, right) => {
    const problemDelta = problemCount(right) - problemCount(left);
    if (problemDelta) return problemDelta;
    const vehicleDelta = left.vehicleId.localeCompare(right.vehicleId, "en", { numeric: true });
    if (vehicleDelta) return vehicleDelta;
    return left.title.localeCompare(right.title, "ar");
  });

  return {
    cars: visibleCars,
    updatedAt: new Date().toISOString(),
    baseUrl: base,
    ...(warning ? { warning } : {}),
  };
}

export async function getWebsiteStock(options: { refresh?: boolean } = {}) {
  if (!options.refresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await buildStock();
  cached = { expiresAt: Date.now() + CACHE_MS, value };
  return value;
}
