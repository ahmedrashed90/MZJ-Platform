import type { VercelRequest } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { getSql } from "./_db.js";
import { logSecurityEvent, requestId, type PermissionUser } from "./_access-control.js";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function ensureRequestId(request: VercelRequest) {
  const current = clean(request.headers["x-request-id"] || request.headers["x-vercel-id"]);
  if (current) return current.slice(0, 120);
  const generated = randomUUID();
  request.headers["x-request-id"] = generated;
  return generated;
}

export async function logApiWriteIfMissing(input: {
  request: VercelRequest;
  user: PermissionUser;
  route: string;
  systemCode: string;
  pageCode?: string | null;
  permissionCode?: string | null;
  action?: string | null;
  statusCode: number;
  durationMs: number;
}) {
  const id = requestId(input.request);
  const sql = getSql();
  const [existing] = await sql<{ exists: boolean }[]>`
    select exists(
      select 1 from audit.activity_log
      where request_id=${id}
        and user_id=${input.user.id}::uuid
    ) as exists
  `.catch(() => [{ exists: false }]);
  if (existing?.exists) return;

  await logSecurityEvent({
    request: input.request,
    user: input.user,
    systemCode: input.systemCode || "core",
    pageCode: input.pageCode || null,
    permissionCode: input.permissionCode || null,
    action: clean(input.action) || `api_${clean(input.request.method).toLowerCase() || "write"}`,
    entityType: "api_route",
    entityId: input.route,
    result: input.statusCode >= 400 ? "failure" : "success",
    reason: input.statusCode >= 400 ? `HTTP_${input.statusCode}` : null,
    afterData: {
      route: input.route,
      method: clean(input.request.method || "POST").toUpperCase(),
      statusCode: input.statusCode,
      durationMs: Math.max(0, Math.round(input.durationMs)),
    },
  });
}
