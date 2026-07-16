import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SessionUser } from "./_auth.js";
import { requireUser } from "./_auth.js";
import { ensureCrmSchema } from "./_crm-schema.js";
import { getSql } from "./_db.js";

export function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizePhone(value: unknown) {
  let phone = clean(value).replace(/[^0-9+]/g, "").replace(/^00/, "").replace(/^\+/, "");
  if (phone.startsWith("966") && phone.length >= 12) phone = phone.slice(0, 12);
  else if (/^05\d{8}$/.test(phone)) phone = `966${phone.slice(1)}`;
  else if (/^5\d{8}$/.test(phone)) phone = `966${phone}`;
  return /^9665\d{8}$/.test(phone) ? phone : "";
}

export function departmentKey(value: unknown) {
  const raw = clean(value).toLowerCase();
  if (raw.includes("call_center") || raw.includes("callcenter") || raw.includes("كول")) return "finance";
  if (raw.includes("finance") || raw.includes("تمويل")) return "finance";
  if (raw.includes("customer_service") || raw === "cs" || raw.includes("service") || raw.includes("خدم")) return "service";
  return "cash";
}

export function departmentCodeFromKey(key: string) {
  if (key === "finance") return "finance_sales";
  if (key === "service") return "customer_service";
  return "cash_sales";
}

export function branchForDepartment(key: string) {
  if (key === "finance") return "online";
  if (key === "service") return "customer_service";
  return "";
}

export function hasAnyRole(user: SessionUser, roles: string[]) {
  return user.roleCodes.some((role) => roles.includes(role));
}

export function isCrmManager(user: SessionUser) {
  return hasAnyRole(user, ["admin", "sales_manager", "branch_manager"]);
}

export async function requireCrmUser(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request, response);
  if (!user) return null;
  await ensureCrmSchema();
  const crmDepartments = new Set(["cash_sales", "finance_sales", "customer_service", "call_center"]);
  const allowed = user.roleCodes.includes("admin") || user.roleCodes.includes("sales_manager") || user.departmentCodes.some((code) => crmDepartments.has(code));
  if (!allowed) {
    response.status(403).json({ ok: false, error: "لا توجد صلاحية للدخول إلى CRM" });
    return null;
  }
  return user;
}

export type Scope = {
  all: boolean;
  departmentCodes: string[];
  branchCodes: string[];
  userId: string;
  callCenterOnly: boolean;
};

export function userScope(user: SessionUser): Scope {
  const all = hasAnyRole(user, ["admin", "sales_manager"]);
  const callCenterOnly = !all && user.departmentCodes.includes("call_center") && !user.departmentCodes.some((code) => ["cash_sales", "finance_sales", "customer_service"].includes(code));
  return {
    all,
    departmentCodes: user.departmentCodes,
    branchCodes: user.branchCodes,
    userId: user.id,
    callCenterOnly,
  };
}

export function parseBody(request: VercelRequest): Record<string, any> {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { return {}; }
  }
  return {};
}

export function positiveInt(value: unknown, fallback: number, max = 500) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(max, Math.floor(number));
}

export async function audit(user: SessionUser, action: string, entityType: string, entityId: string | null, afterData?: unknown, beforeData?: unknown) {
  const sql = getSql();
  await sql`
    insert into audit.activity_log(user_id, system_code, action, entity_type, entity_id, before_data, after_data)
    values (${user.id}::uuid, 'crm', ${action}, ${entityType}, ${entityId}, ${beforeData ? sql.json(beforeData as any) : null}, ${afterData ? sql.json(afterData as any) : null})
  `.catch(() => undefined);
}

export function sourceLabel(source: string) {
  const map: Record<string, string> = {
    facebook: "فيسبوك", fb: "فيسبوك", meta: "فيسبوك",
    instagram: "إنستجرام", ig: "إنستجرام",
    tiktok: "تيك توك", tiktok_lead: "تيك توك ليد", snapchat: "سناب شات", snapchat_lead: "سناب شات ليد", whatsapp: "واتساب", mersal: "واتساب",
    installment_calculator: "حاسبة التقسيط", calculator: "حاسبة التقسيط",
    haraj: "موقع حراج", other_website: "موقع آخر", branch: "خلال الفرع", friend: "صديق", unified_number: "اتصال الرقم الموحد",
  };
  return map[clean(source).toLowerCase()] || clean(source) || "غير محدد";
}

export async function chooseAssignment(serviceKey: string, requestedBranch = "") {
  const sql = getSql();
  const department = departmentCodeFromKey(serviceKey);
  const branch = requestedBranch || branchForDepartment(serviceKey);

  const candidates = await sql<{ id: string; full_name: string; branch_code: string | null }[]>`
    select u.id::text, u.full_name, min(b.code) as branch_code
    from core.users u
    join core.user_departments ud on ud.user_id = u.id
    join core.departments d on d.id = ud.department_id and d.code = ${department}
    left join core.user_branches ub on ub.user_id = u.id
    left join core.branches b on b.id = ub.branch_id
    where u.is_active = true and u.can_receive_leads = true
      and (${branch || null}::text is null or b.code = ${branch || null})
    group by u.id
    order by u.full_name, u.id
  `;

  if (!candidates.length) return { assignedTo: null, assignedName: "", branchCode: branch };
  const poolKey = `sales:${department}:${branch || "all"}`;
  const [state] = await sql<{ last_user_id: string | null }[]>`select last_user_id::text from crm.assignment_state where pool_key = ${poolKey}`;
  const lastIndex = candidates.findIndex((candidate) => candidate.id === state?.last_user_id);
  const selected = candidates[(lastIndex + 1 + candidates.length) % candidates.length];
  await sql`
    insert into crm.assignment_state(pool_key, last_user_id, last_branch_code, updated_at)
    values (${poolKey}, ${selected.id}::uuid, ${selected.branch_code || branch || null}, now())
    on conflict (pool_key) do update set last_user_id = excluded.last_user_id, last_branch_code = excluded.last_branch_code, updated_at = now()
  `;
  return { assignedTo: selected.id, assignedName: selected.full_name, branchCode: selected.branch_code || branch };
}

export async function chooseCallCenterAssignment() {
  const sql = getSql();
  const candidates = await sql<{ id: string; full_name: string }[]>`
    select distinct u.id::text, u.full_name
    from core.users u
    join core.user_departments ud on ud.user_id = u.id
    join core.departments d on d.id = ud.department_id and d.code = 'call_center'
    where u.is_active = true and u.can_receive_leads = true
    order by u.full_name, u.id
  `;
  if (!candidates.length) return { assignedTo: null, assignedName: "" };
  const [state] = await sql<{ last_user_id: string | null }[]>`select last_user_id::text from crm.assignment_state where pool_key = 'call_center'`;
  const lastIndex = candidates.findIndex((candidate) => candidate.id === state?.last_user_id);
  const selected = candidates[(lastIndex + 1 + candidates.length) % candidates.length];
  await sql`
    insert into crm.assignment_state(pool_key, last_user_id, updated_at)
    values ('call_center', ${selected.id}::uuid, now())
    on conflict (pool_key) do update set last_user_id = excluded.last_user_id, updated_at = now()
  `;
  return { assignedTo: selected.id, assignedName: selected.full_name };
}
