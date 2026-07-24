import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getSql } from "./_db.js";
import { getEffectiveAccess, hasPermission, type EffectiveAccessSnapshot } from "./_access-control.js";

export const SESSION_COOKIE = "mzj_session";
const SESSION_HOURS = 12;
const REQUEST_USER_KEY = Symbol.for("mzj.session.user");

export type SessionUser = EffectiveAccessSnapshot & {
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

export async function loadUserProfile(userId: string): Promise<SessionUser | null> {
  const sql = getSql();
  const [rows, access] = await Promise.all([
    sql<{
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
        u.id::text,u.employee_no,u.full_name,u.email,u.mobile,
        coalesce((select array_agg(r.name order by r.name) from core.user_roles ur join core.roles r on r.id=ur.role_id and r.is_active=true where ur.user_id=u.id),'{}') as roles,
        coalesce((select array_agg(r.code order by r.code) from core.user_roles ur join core.roles r on r.id=ur.role_id and r.is_active=true where ur.user_id=u.id),'{}') as role_codes,
        coalesce((select array_agg(d.name order by ud.is_primary desc,d.name) from core.user_departments ud join core.departments d on d.id=ud.department_id and d.is_active=true where ud.user_id=u.id),'{}') as departments,
        coalesce((select array_agg(d.code order by ud.is_primary desc,d.name) from core.user_departments ud join core.departments d on d.id=ud.department_id and d.is_active=true where ud.user_id=u.id),'{}') as department_codes,
        coalesce((select array_agg(b.name order by ub.is_primary desc,b.sort_order,b.name) from core.user_branches ub join core.branches b on b.id=ub.branch_id and b.is_active=true where ub.user_id=u.id),'{}') as branches,
        coalesce((select array_agg(b.code order by ub.is_primary desc,b.sort_order,b.name) from core.user_branches ub join core.branches b on b.id=ub.branch_id and b.is_active=true where ub.user_id=u.id),'{}') as branch_codes
      from core.users u
      where u.id=${userId}::uuid and u.is_active=true
    `,
    getEffectiveAccess(userId),
  ]);
  const row = rows[0];
  if (!row) return null;
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
    ...access,
  };
}

export async function createSession(request: VercelRequest, response: VercelResponse, userId: string) {
  const sql = getSql();
  const token = randomBytes(32).toString("hex");
  const hash = tokenHash(token);
  const userAgent = String(request.headers["user-agent"] || "").slice(0, 500) || null;
  const ipAddress = requestIp(request);

  await sql`
    insert into core.sessions(token_hash,user_id,expires_at,user_agent,ip_address,permission_version)
    select ${hash},u.id,now()+${SESSION_HOURS}*interval '1 hour',${userAgent},${ipAddress},u.permission_version
    from core.users u where u.id=${userId}::uuid and u.is_active=true
  `;

  const secure = process.env.VERCEL ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure}`);
}

export async function clearSession(request: VercelRequest, response: VercelResponse) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    const sql = getSql();
    await sql`delete from core.sessions where token_hash=${tokenHash(token)}`.catch(() => undefined);
  }
  const secure = process.env.VERCEL ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

export async function getSessionUser(request: VercelRequest): Promise<SessionUser | null> {
  const requestWithCache = request as VercelRequest & { [REQUEST_USER_KEY]?: SessionUser | null };
  if (REQUEST_USER_KEY in requestWithCache) return requestWithCache[REQUEST_USER_KEY] || null;
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!token) {
    requestWithCache[REQUEST_USER_KEY] = null;
    return null;
  }

  const sql = getSql();
  const [session] = await sql<{ user_id: string }[]>`
    select s.user_id::text
    from core.sessions s
    join core.users u on u.id=s.user_id and u.is_active=true
    where s.token_hash=${tokenHash(token)}
      and s.expires_at>now()
      and s.permission_version=u.permission_version
  `;
  if (!session) {
    requestWithCache[REQUEST_USER_KEY] = null;
    return null;
  }

  const user = await loadUserProfile(session.user_id);
  requestWithCache[REQUEST_USER_KEY] = user;
  if (!user) return null;

  await sql`
    update core.sessions set last_seen_at=now()
    where token_hash=${tokenHash(token)} and last_seen_at<now()-interval '5 minutes'
  `.catch(() => undefined);
  return user;
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
  if (!hasPermission(user, "platform.superadmin")) {
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
