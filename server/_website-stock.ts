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

type BridgePage = {
  ok?: boolean;
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
  items?: JsonRecord[];
};

const CACHE_MS = 120_000;
const DEFAULT_BRIDGE_URL = "https://mzjcars.com/wp-json/mzj-platform/v2/cars";
let cached: { expiresAt: number; value: WebsiteStockResult } | null = null;

function bridgeUrl() {
  return String(process.env.MZJ_CARS_BRIDGE_URL || DEFAULT_BRIDGE_URL).trim().replace(/\/+$/, "");
}

function bridgeSecret() {
  return String(process.env.MZJ_CARS_BRIDGE_SECRET || "").trim();
}

function siteBaseFromBridge(endpoint: string) {
  try {
    return new URL(endpoint).origin;
  } catch {
    return "https://mzjcars.com";
  }
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableStock(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.trunc(parsed));
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

async function fetchBridgePage(endpoint: string, secret: string, page: number) {
  const url = new URL(endpoint);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", "500");
  url.searchParams.set("issues_first", "1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: {
        "X-MZJ-Bridge-Key": secret,
        "user-agent": "MZJ-Platform/1.0 (+cars-bridge)",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null) as BridgePage | null;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("MZJ_CARS_BRIDGE_AUTH_FAILED");
      throw new Error(`MZJ_CARS_BRIDGE_HTTP_${response.status}`);
    }
    if (!payload || payload.ok !== true || !Array.isArray(payload.items)) {
      throw new Error("MZJ_CARS_BRIDGE_INVALID_RESPONSE");
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("MZJ_CARS_BRIDGE_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllBridgeCars(endpoint: string, secret: string) {
  const first = await fetchBridgePage(endpoint, secret, 1);
  const rows = [...(first.items || [])];
  const totalPages = Math.max(1, Math.min(100, Math.trunc(numberValue(first.total_pages, 1))));
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchBridgePage(endpoint, secret, page);
    rows.push(...(next.items || []));
  }
  return rows;
}

function mapBridgeCar(item: JsonRecord): WebsiteStockCar | null {
  const postId = Math.max(0, Math.trunc(numberValue(item.post_id)));
  const vehicleId = text(item.vehicle_id).toUpperCase();
  const title = text(item.title);
  if (!postId || !title) return null;

  const price = Math.max(0, numberValue(item.price));
  const priceBeforeTax = Math.max(0, numberValue(item.price_before_tax));
  const compareKey = text(item.compare_key) || null;
  const permalink = text(item.permalink);

  return {
    postId,
    vehicleId: vehicleId || `WP-${postId}`,
    title,
    price,
    priceBeforeTax,
    stock: nullableStock(item.stock),
    hasImages: item.has_images === true,
    hasCompareKey: item.has_compare_key === true || Boolean(compareKey),
    compareKey,
    imageUrl: null,
    url: permalink,
  };
}

function problemCount(car: WebsiteStockCar) {
  return (car.hasImages ? 0 : 1) + (car.hasCompareKey ? 0 : 1);
}

async function buildStock(): Promise<WebsiteStockResult> {
  const endpoint = bridgeUrl();
  const secret = bridgeSecret();
  if (!secret) throw new Error("MZJ_CARS_BRIDGE_SECRET_NOT_CONFIGURED");

  const records = await fetchAllBridgeCars(endpoint, secret);
  const cars = records.map(mapBridgeCar).filter((car): car is WebsiteStockCar => Boolean(car));

  cars.sort((left, right) => {
    const problemDelta = problemCount(right) - problemCount(left);
    if (problemDelta) return problemDelta;
    const vehicleDelta = left.vehicleId.localeCompare(right.vehicleId, "en", { numeric: true });
    if (vehicleDelta) return vehicleDelta;
    return left.title.localeCompare(right.title, "ar");
  });

  return {
    cars,
    updatedAt: new Date().toISOString(),
    baseUrl: siteBaseFromBridge(endpoint),
  };
}

export async function getWebsiteStock(options: { refresh?: boolean } = {}) {
  if (!options.refresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await buildStock();
  cached = { expiresAt: Date.now() + CACHE_MS, value };
  return value;
}
