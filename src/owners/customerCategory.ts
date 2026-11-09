export type OwnersCustomerCategory = "distinction" | "gold" | "special" | "none";

export function ownersCustomerCategory(lifetimePoints: unknown): OwnersCustomerCategory {
  const points = Math.max(0, Number(lifetimePoints || 0));
  if (points >= 2500) return "special";
  if (points >= 1500) return "gold";
  if (points >= 1000) return "distinction";
  return "none";
}

export function ownersCustomerCategoryLabel(category: OwnersCustomerCategory): string {
  if (category === "special") return "خاصة";
  if (category === "gold") return "ذهبي";
  if (category === "distinction") return "تميز";
  return "—";
}

export function ownersCustomerCategoryFromPoints(lifetimePoints: unknown) {
  const category = ownersCustomerCategory(lifetimePoints);
  return { category, label: ownersCustomerCategoryLabel(category) };
}
