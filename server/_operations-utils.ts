import { randomBytes } from "node:crypto";
import type { SessionUser } from "./_auth.js";
import { getSql } from "./_db.js";

export function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function nullableText(value: unknown) {
  const text = clean(value);
  return text || null;
}

export function asBoolean(value: unknown) {
  return value === true || value === 1 || ["1", "true", "yes", "نعم"].includes(clean(value).toLowerCase());
}

export function normalizeVin(value: unknown) {
  return clean(value).toUpperCase().replace(/\s+/g, "");
}

export function normalizeContents(value: unknown) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const keys = ["farshat", "tafaia", "shanta", "spare", "remote", "screen", "recorder", "ac", "camera", "sensors"];
  return Object.fromEntries(keys.map((key) => [key, asBoolean(input[key])]));
}

export function requestStatusFromStage(stage: number) {
  if (stage >= 4) return "completed";
  if (stage === 3) return "vehicle_received";
  if (stage === 2) return "vehicle_sent";
  if (stage === 1) return "request_received";
  return "not_started";
}

export function nextOperationsNumber(prefix: "MOV" | "REQ" | "IMP") {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  return `${prefix}-${date}-${time}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

export async function auditOperations(user: SessionUser, action: string, entityType: string, entityId: string | null, afterData?: unknown, beforeData?: unknown) {
  const sql = getSql();
  await sql`
    insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data)
    values (${user.id}::uuid,'operations',${action},${entityType},${entityId},${beforeData ? sql.json(beforeData as never) : null},${afterData ? sql.json(afterData as never) : null})
  `.catch(() => undefined);
}
