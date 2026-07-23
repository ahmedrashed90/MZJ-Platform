import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, type SessionUser } from "./_auth.js";

export type MarketingUser = SessionUser & {
  isAdmin: boolean;
};

export function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function parseBody(request: VercelRequest): Record<string, unknown> {
  if (typeof request.body === "string") {
    try {
      const parsed: unknown = JSON.parse(request.body || "{}");
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(request.body) ? request.body : {};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

export function recordArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function booleanValue(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function dateValue(value: unknown) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function isAdmin(user: SessionUser) {
  return user.roleCodes.some((code) => ["admin", "system_admin"].includes(code));
}

export function hasMarketingPermission(user: SessionUser, permission: string) {
  return isAdmin(user) || user.permissions.includes(permission);
}

export async function requireMarketingUser(request: VercelRequest, response: VercelResponse): Promise<MarketingUser | null> {
  const user = await requireUser(request, response);
  if (!user) return null;
  const admin = isAdmin(user);
  const allowed = admin
    || user.permissions.some((code) => code.startsWith("marketing."))
    || user.roleCodes.includes("marketing_user")
    || user.departmentCodes.includes("marketing");
  if (!allowed) {
    response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية الدخول إلى نظام التسويق" });
    return null;
  }
  return { ...user, isAdmin: admin };
}

export function requireMarketingPermission(user: MarketingUser, response: VercelResponse, permission: string) {
  if (user.isAdmin || user.permissions.includes(permission)) return true;
  response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية تنفيذ هذا الإجراء" });
  return false;
}

export function queryText(value: string | string[] | undefined) {
  return clean(Array.isArray(value) ? value[0] : value);
}
