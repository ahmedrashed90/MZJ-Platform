type JsonRecord = Record<string, unknown>;

export type OwnersDiscountConfig = {
  firstPurchasePercent: number;
  repeatPurchasePercent: number;
  friendGiftPercent: number;
  priceBasis: "vehicle_pre_tax";
  roundingMode: "down";
  roundingUnit: number;
  sourceVersion: string;
  warning?: string;
};

const DEFAULT_CONFIG_URL = "https://mzjcars.com/wp-json/mzj-vso/v1/club-discounts";
const CACHE_MS = 30_000;
let cached: { expiresAt: number; value: OwnersDiscountConfig } | null = null;

function configUrl() {
  const explicit = String(process.env.MZJ_CLUB_DISCOUNT_CONFIG_URL || "").trim();
  if (explicit) return explicit;

  const bridge = String(process.env.MZJ_CARS_BRIDGE_URL || "").trim();
  if (bridge) {
    try {
      return `${new URL(bridge).origin}/wp-json/mzj-vso/v1/club-discounts`;
    } catch {
      // Fall through to the canonical public site endpoint.
    }
  }
  return DEFAULT_CONFIG_URL;
}

function boundedPercent(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.min(100, Math.max(0, parsed)) * 10_000) / 10_000;
}

function roundingUnit(value: unknown) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100_000) return 100;
  return parsed;
}

function fallbackConfig(warning = ""): OwnersDiscountConfig {
  return {
    firstPurchasePercent: 1,
    repeatPurchasePercent: 1,
    friendGiftPercent: 1,
    priceBasis: "vehicle_pre_tax",
    roundingMode: "down",
    roundingUnit: 100,
    sourceVersion: "fallback",
    ...(warning ? { warning } : {}),
  };
}

async function fetchConfig(): Promise<OwnersDiscountConfig> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(configUrl(), {
      cache: "no-store",
      headers: { "user-agent": "MZJ-Platform/1.0 (+club-discounts)" },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as JsonRecord | null;
    if (!response.ok || !payload || payload.ok !== true) {
      throw new Error(`MZJ_CLUB_DISCOUNT_CONFIG_HTTP_${response.status}`);
    }

    return {
      firstPurchasePercent: boundedPercent(payload.firstPurchasePercent, 1),
      repeatPurchasePercent: boundedPercent(payload.repeatPurchasePercent, 1),
      friendGiftPercent: boundedPercent(payload.friendGiftPercent, 1),
      priceBasis: "vehicle_pre_tax",
      roundingMode: "down",
      roundingUnit: roundingUnit(payload.roundingUnit),
      sourceVersion: String(payload.version || "").trim(),
    };
  } catch (error) {
    const warning = error instanceof Error && error.name === "AbortError"
      ? "MZJ_CLUB_DISCOUNT_CONFIG_TIMEOUT"
      : error instanceof Error ? error.message : "MZJ_CLUB_DISCOUNT_CONFIG_FAILED";
    return fallbackConfig(warning);
  } finally {
    clearTimeout(timer);
  }
}

export async function getOwnersDiscountConfig(options: { refresh?: boolean } = {}) {
  if (!options.refresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await fetchConfig();
  cached = { expiresAt: Date.now() + CACHE_MS, value };
  return value;
}
