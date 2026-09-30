export type SubscriptionBillingCycle = "monthly" | "annual";
export type SubscriptionPricingModel = "fixed" | "per_unit" | "usage";

export type MarketingSubscription = {
  id: string;
  service_name: string;
  billing_cycle: SubscriptionBillingCycle;
  pricing_model: SubscriptionPricingModel;
  amount: number;
  unit_price: number | null;
  usage_quantity: number | null;
  usage_limit: number | null;
  usage_unit: string | null;
  currency: string;
  start_date: string;
  renewal_date: string;
  notes: string | null;
  effective_amount: number;
  days_remaining: number;
  is_expired: boolean;
  renewal_count: number;
  created_at?: string;
  updated_at?: string;
};

export type MarketingSubscriptionsPayload = {
  ok: true;
  rows: MarketingSubscription[];
  stats: {
    activeCount: number;
    expiringSoonCount: number;
    expiredCount: number;
    totalCurrentCost: number;
    usageBasedCost: number;
  };
  permissions: {
    canRenew: boolean;
    canManage: boolean;
  };
};

export type SubscriptionRenewal = {
  id: string;
  previous_start_date: string;
  previous_renewal_date: string;
  actual_renewal_date: string;
  next_renewal_date: string;
  billing_cycle: SubscriptionBillingCycle;
  pricing_model: SubscriptionPricingModel;
  amount: number;
  unit_price: number | null;
  usage_quantity: number | null;
  usage_limit: number | null;
  usage_unit: string | null;
  currency: string;
  note: string | null;
  created_at: string;
  renewed_by_name: string | null;
};

export type SubscriptionHistoryPayload = {
  ok: true;
  subscription: { id: string; service_name: string };
  rows: SubscriptionRenewal[];
};

export const BILLING_CYCLE_LABELS: Record<SubscriptionBillingCycle, string> = {
  monthly: "شهري",
  annual: "سنوي",
};

export const PRICING_MODEL_LABELS: Record<SubscriptionPricingModel, string> = {
  fixed: "مبلغ ثابت",
  per_unit: "حسب الوحدة",
  usage: "حسب الاستخدام",
};

export function formatSubscriptionMoney(value: number | null | undefined) {
  const numeric = Number(value || 0);
  return `${numeric.toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: numeric % 1 ? 2 : 0, maximumFractionDigits: 2 })} ر.س`;
}

export function formatSubscriptionUsage(value: number | null | undefined, unit: string | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("ar-SA-u-nu-latn", { maximumFractionDigits: 4 })}${unit ? ` ${unit}` : ""}`;
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addSubscriptionCycle(dateKey: string, cycle: SubscriptionBillingCycle) {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-").map(Number);
  if (!yearRaw || !monthRaw || !dayRaw) return dateKey;
  const targetYear = cycle === "annual" ? yearRaw + 1 : yearRaw + Math.floor(monthRaw / 12);
  const targetMonthIndex = cycle === "annual" ? monthRaw - 1 : monthRaw % 12;
  const lastDay = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
  const result = new Date(targetYear, targetMonthIndex, Math.min(dayRaw, lastDay));
  return localDateKey(result);
}
