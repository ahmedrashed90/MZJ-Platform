export type DatabaseJsonValue =
  | null
  | string
  | number
  | boolean
  | Date
  | readonly DatabaseJsonValue[]
  | { readonly [key: string]: DatabaseJsonValue | undefined };

function normalizeJson(value: unknown, seen: WeakSet<object>): DatabaseJsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (Array.isArray(value)) return value.map((entry) => normalizeJson(entry, seen));
  if (typeof value !== "object") return null;

  if (seen.has(value)) return null;
  seen.add(value);
  try {
    const customToJson = (value as { toJSON?: unknown }).toJSON;
    if (typeof customToJson === "function") {
      return normalizeJson(customToJson.call(value), seen);
    }

    const normalized: Record<string, DatabaseJsonValue | undefined> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") continue;
      normalized[key] = normalizeJson(entry, seen);
    }
    return normalized;
  } finally {
    seen.delete(value);
  }
}

export function toDatabaseJson(value: unknown): DatabaseJsonValue {
  return normalizeJson(value, new WeakSet<object>());
}
