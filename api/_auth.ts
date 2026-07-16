import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getSql } from "./_db";

export const SESSION_COOKIE = "mzj_session";
const SESSION_HOURS = 12;

export type SessionUser = {
  id: string;
  employeeNo: string | null;
  fullName: string;
  email: string | null;
  mobile: string | null;
  roles: string[];
  roleCodes: string[];
  departments: string[];
  departmentCodes: string[];
  branches: string[];
  branchCodes: string[];
};

function parseCookies(header: string | undefined) {
  const cookies: Record<string, string> = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

export function requestIp(request: VercelRequest) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0]?.trim();
  return forwarded || String(request.socket?.remoteAddress || "") || null;
}

export async function createSession(request: VercelRequest, response: VercelResponse, userId: string) {
  const sql = getSql();
  const token = randomBytes(32).toString("hex");
  const hash = tokenHash(token);
  const userAgent = String(request.headers["user-agent"] || "").slice(0, 500) || null;
  const ipAddress = requestIp(request);

  await sql`
    insert into core.sessions(token_hash, user_id, expires_at, user_agent, ip_address)
    values (${hash}, ${userId}::uuid, now() + ${SESSION_HOURS} * interval '1 hour', ${userAgent}, ${ipAddress})
  `;

  const secure = process.env.VERCEL ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure}`,
  );
}

export async function clearSession(request: VercelRequest, response: VercelResponse) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    const sql = getSql();
    await sql`delete from core.sessions where token_hash = ${tokenHash(token)}`.catch(() => undefined);
  }
  const secure = process.env.VERCEL ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

export async function getSessionUser(request: VercelRequest): Promise<SessionUser | null> {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;

  const sql = getSql();
  const [row] = await sql<{
    id: string;
    employee_no: string | null;
    full_name: string;
    email: string | null;
    mobile: string | null;
    roles: string[] | null;
    role_codes: string[] | null;
    departments: string[] | null;
    department_codes: string[] | null;
    branches: string[] | null;
    branch_codes: string[] | null;
  }[]>`
    select
      u.id::text,
      u.employee_no,
      u.full_name,
      u.email,
      u.mobile,
      coalesce(array_agg(distinct r.name) filter (where r.id is not null), '{}') as roles,
      coalesce(array_agg(distinct r.code) filter (where r.id is not null), '{}') as role_codes,
      coalesce(array_agg(distinct d.name) filter (where d.id is not null), '{}') as departments,
      coalesce(array_agg(distinct d.code) filter (where d.id is not null), '{}') as department_codes,
      coalesce(array_agg(distinct b.name) filter (where b.id is not null), '{}') as branches,
      coalesce(array_agg(distinct b.code) filter (where b.id is not null), '{}') as branch_codes
    from core.sessions s
    join core.users u on u.id = s.user_id and u.is_active = true
    left join core.user_roles ur on ur.user_id = u.id
    left join core.roles r on r.id = ur.role_id
    left join core.user_departments ud on ud.user_id = u.id
    left join core.departments d on d.id = ud.department_id
    left join core.user_branches ub on ub.user_id = u.id
    left join core.branches b on b.id = ub.branch_id
    where s.token_hash = ${tokenHash(token)} and s.expires_at > now()
    group by u.id
  `;

  if (!row) return null;

  await sql`
    update core.sessions
    set last_seen_at = now()
    where token_hash = ${tokenHash(token)}
      and last_seen_at < now() - interval '5 minutes'
  `.catch(() => undefined);

  return {
    id: row.id,
    employeeNo: row.employee_no,
    fullName: row.full_name,
    email: row.email,
    mobile: row.mobile,
    roles: normalizeArray(row.roles),
    roleCodes: normalizeArray(row.role_codes),
    departments: normalizeArray(row.departments),
    departmentCodes: normalizeArray(row.department_codes),
    branches: normalizeArray(row.branches),
    branchCodes: normalizeArray(row.branch_codes),
  };
}

export async function requireUser(request: VercelRequest, response: VercelResponse) {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      response.status(401).json({ ok: false, error: "يجب تسجيل الدخول أولًا" });
      return null;
    }
    return user;
  } catch (error) {
    console.error("Session lookup failed", error);
    response.status(401).json({ ok: false, error: "انتهت جلسة الدخول أو تعذر التحقق منها" });
    return null;
  }
}

export async function requireAdmin(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request, response);
  if (!user) return null;
  if (!user.roleCodes.includes("admin")) {
    response.status(403).json({ ok: false, error: "هذه العملية متاحة لمدير النظام فقط" });
    return null;
  }
  return user;
}

export function safeSecretEquals(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
