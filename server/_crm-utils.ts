import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SessionUser } from "./_auth.js";
import { requireUser } from "./_auth.js";
import { canAccessSystem, hasPermission } from "../shared/system-access.js";
import { getSystemAccess } from "./_access-control.js";
import { ensureCrmSchema } from "./_crm-schema.js";
import { getSql } from "./_db.js";
import { calculateLeadCompletion } from "./_crm-customer-fields.js";
import { normalizePhone } from "./_phone-utils.js";
export { normalizePhone };

export function clean(value: unknown) {
  return String(value ?? "").trim();
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

export function isCrmManager(user: SessionUser) {
  return [
    "crm.customer.bulk_transfer","crm.manual_lead.view_all","crm.manual_lead.duplicate.approve",
    "crm.conversation.classify","crm.reports.agents","crm.kpi.rate_branch",
    "crm.contacts.purge",
  ].some((permission) => hasPermission(user, permission));
}

export async function requireCrmUser(request: VercelRequest, response: VercelResponse) {
  const user = await requireUser(request, response);
  if (!user) return null;
  await ensureCrmSchema();
  if (!canAccessSystem(user, "crm")) {
    response.status(403).json({ ok: false, error: "لا توجد صلاحية للدخول إلى CRM" });
    return null;
  }
  return user;
}

export type Scope = {
  all: boolean;
  includeAssigned: boolean;
  departmentCodes: string[];
  branchCodes: string[];
  userId: string;
  callCenterOnly: boolean;
};

export function userScope(user: SessionUser): Scope {
  const access = getSystemAccess(user, "crm");
  const all = access.dataScope === "all";
  const includeAssigned = ["self", "assigned", "created_by_me", "workflow_assigned"].includes(access.dataScope);
  const allCrmDepartments = ["cash_sales", "finance_sales", "customer_service", "call_center"];
  const departmentCodes = ["branch", "branches"].includes(access.dataScope)
    ? allCrmDepartments
    : ["department", "departments", "branch_and_department"].includes(access.dataScope)
      ? access.departmentCodes
      : [];
  const branchCodes = ["branch", "branches", "branch_and_department"].includes(access.dataScope) ? access.branchCodes : [];
  const callCenterOnly = includeAssigned && access.departmentCodes.includes("call_center") && !access.departmentCodes.some((code) => ["cash_sales", "finance_sales", "customer_service"].includes(code));
  return { all, includeAssigned, departmentCodes, branchCodes, userId: user.id, callCenterOnly };
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

export function sourceLabel(source: string, fallback = "") {
  const raw = clean(source);
  const fallbackRaw = clean(fallback);
  const key = raw
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[\s/\-]+/g, "_");
  const map: Record<string, string> = {
    facebook: "فيسبوك", fb: "فيسبوك", meta: "فيسبوك", facebook_chat: "فيسبوك",
    instagram: "إنستجرام", ig: "إنستجرام", insta: "إنستجرام", instagram_chat: "إنستجرام",
    tiktok: "تيك توك", tt: "تيك توك", tik_tok: "تيك توك", tiktok_chat: "تيك توك", tiktok_snapchat: "تيك توك ليد وسناب شات ليد",
    tiktok_lead: "تيك توك ليد", snapchat: "سناب شات", snap: "سناب شات", snapchat_lead: "سناب شات ليد",
    whatsapp: "واتساب", wa: "واتساب", mersal: "واتساب",
    installment_calculator: "حاسبة التقسيط", installment: "حاسبة التقسيط", calculator: "حاسبة التقسيط",
    haraj: "موقع حراج", other_website: "موقع آخر", branch: "خلال الفرع", friend: "صديق",
    unified_number: "اتصال الرقم الموحد", manual: "إدخال يدوي", manual_entry: "إدخال يدوي",
    فيسبوك: "فيسبوك", فيس_بوك: "فيسبوك", انستجرام: "إنستجرام", انستغرام: "إنستجرام",
    تيك_توك: "تيك توك", تيك_توك_ليد: "تيك توك ليد", سناب_شات: "سناب شات", سناب_شات_ليد: "سناب شات ليد",
    واتساب: "واتساب", حاسبه_التقسيط: "حاسبة التقسيط", موقع_حراج: "موقع حراج", موقع_اخر: "موقع آخر",
    خلال_الفرع: "خلال الفرع", صديق: "صديق", اتصال_الرقم_الموحد: "اتصال الرقم الموحد", ادخال_يدوي: "إدخال يدوي",
  };
  if (map[key]) return map[key];
  if ((key.includes("tiktok") || key.includes("تيك_توك")) && (key.includes("lead") || key.includes("ليد"))) return "تيك توك ليد";
  if ((key.includes("snap") || key.includes("سناب")) && (key.includes("lead") || key.includes("ليد"))) return "سناب شات ليد";
  if (key.includes("facebook") || key.includes("فيسبوك") || key.includes("فيس_بوك")) return "فيسبوك";
  if (key.includes("instagram") || key.includes("انستجرام") || key.includes("انستغرام")) return "إنستجرام";
  if (key.includes("tiktok") || key.includes("تيك_توك")) return "تيك توك";
  if (key.includes("snap") || key.includes("سناب")) return "سناب شات";
  if (key.includes("whatsapp") || key.includes("mersal") || key.includes("واتساب")) return "واتساب";
  if (key.includes("installment") || key.includes("calculator") || key.includes("حاسبه_التقسيط")) return "حاسبة التقسيط";
  if (key.includes("manual") || key.includes("ادخال_يدوي")) return "إدخال يدوي";
  if (fallbackRaw && fallbackRaw !== raw) return sourceLabel(fallbackRaw);
  return raw || "غير محدد";
}

export async function resolveSourceName(sourceCode: string, fallback = "") {
  const code = clean(sourceCode);
  if (!code) return sourceLabel(fallback);
  const sql = getSql();
  const [row] = await sql<{ name: string }[]>`select name from core.sources where code=${code} limit 1`;
  return clean(row?.name) || sourceLabel(code || fallback);
}

export { calculateLeadCompletion };

export function calculateCreditLimit(salaryValue: unknown, obligationValue: unknown, financeTypeValue: unknown) {
  const salary = Number(salaryValue || 0);
  const obligation = Number(obligationValue || 0);
  const financeType = clean(financeTypeValue);
  const ratio = financeType === "rate55" || financeType === "55%" || financeType.includes("55")
    ? 0.55
    : financeType === "realEstate" || financeType.includes("65") || financeType.includes("عقاري")
      ? 0.65
      : financeType
        ? 0.45
        : 0;
  if (!salary || !ratio) return { amount: null as number | null, qualified: null as boolean | null, ratio };
  const amount = salary * ratio - obligation;
  return { amount, qualified: amount >= 650, ratio };
}

type AssignmentResult = {
  assignedTo: string | null;
  assignedName: string;
  branchCode: string;
  ruleId?: string | null;
  ruleName?: string;
};

function assignmentRulePoolKey(ruleId: string, branchCode: string) {
  return `rule:${ruleId}:branch:${branchCode}`;
}

async function chooseFromConfiguredRule(departmentCode: string, requestedBranch: string, sourceCode: string): Promise<AssignmentResult | null> {
  const branchCode = clean(requestedBranch);
  if (!branchCode) return null;

  const sql = getSql();
  const [rule] = await sql<any[]>`
    select r.*, r.id::text,
      state.last_user_id::text,
      state.updated_at as last_distribution_at
    from crm.assignment_rules r
    left join crm.assignment_state state on state.pool_key = concat('rule:', r.id::text, ':branch:', ${branchCode})
    where r.is_active = true
      and r.department_code = ${departmentCode}
      and (coalesce(array_length(r.branch_codes, 1), 0) = 0 or ${branchCode} = any(r.branch_codes))
      and (coalesce(array_length(r.source_codes, 1), 0) = 0 or ${sourceCode || ""} = any(r.source_codes))
    order by
      case when coalesce(array_length(r.branch_codes, 1), 0) > 0 then 0 else 1 end,
      case when coalesce(array_length(r.source_codes, 1), 0) > 0 then 0 else 1 end,
      r.sort_order,
      r.created_at
    limit 1
  `;
  if (!rule) return null;

  const candidates = await sql<any[]>`
    select u.id::text, u.full_name, m.priority, m.assignment_count
    from crm.assignment_rule_members m
    join core.users u on u.id = m.user_id
    where m.rule_id = ${rule.id}::uuid
      and m.is_active = true
      and u.is_active = true
      and u.can_receive_leads = true
      and (
        exists (
          select 1
          from core.user_system_departments usd
          join core.departments d on d.id=usd.department_id and d.is_active=true
          where usd.user_id=u.id and usd.system_code='crm' and d.code=${departmentCode}
        )
        or (
          not exists (
            select 1 from core.user_system_departments usd
            where usd.user_id=u.id and usd.system_code='crm'
          )
          and exists (
            select 1
            from core.user_departments ud
            join core.departments d on d.id=ud.department_id and d.is_active=true
            where ud.user_id=u.id and d.code=${departmentCode}
          )
        )
      )
      and (
        exists (
          select 1
          from core.user_system_branches usb
          join core.branches b on b.id=usb.branch_id and b.is_active=true
          where usb.user_id=u.id and usb.system_code='crm' and b.code=${branchCode}
        )
        or (
          not exists (
            select 1 from core.user_system_branches usb
            where usb.user_id=u.id and usb.system_code='crm'
          )
          and exists (
            select 1
            from core.user_branches ub
            join core.branches b on b.id=ub.branch_id and b.is_active=true
            where ub.user_id=u.id and b.code=${branchCode}
          )
        )
      )
    order by m.priority, u.full_name, u.id::text
  `;
  if (!candidates.length) return null;

  const lastIndex = candidates.findIndex((candidate) => candidate.id === rule.last_user_id);
  const selected = candidates[(lastIndex + 1 + candidates.length) % candidates.length];
  const poolKey = assignmentRulePoolKey(rule.id, branchCode);
  await sql`
    insert into crm.assignment_state(pool_key,last_user_id,last_branch_code,updated_at)
    values (${poolKey},${selected.id}::uuid,${branchCode},now())
    on conflict (pool_key) do update set last_user_id=excluded.last_user_id,last_branch_code=excluded.last_branch_code,updated_at=now()
  `;
  await sql`
    update crm.assignment_rule_members
    set assignment_count=assignment_count+1,last_assigned_at=now(),updated_at=now()
    where rule_id=${rule.id}::uuid and user_id=${selected.id}::uuid
  `;
  await sql`
    insert into crm.assignment_logs(rule_id,department_code,branch_code,source_code,assigned_to,assigned_name,assignment_mode)
    values (${rule.id}::uuid,${departmentCode},${branchCode},${sourceCode || null},${selected.id}::uuid,${selected.full_name},${rule.assignment_mode || "round_robin"})
  `;
  return { assignedTo: selected.id, assignedName: selected.full_name, branchCode, ruleId: rule.id, ruleName: rule.name };
}

export async function chooseAssignment(serviceKey: string, requestedBranch = "", sourceCode = "") {
  const department = departmentCodeFromKey(serviceKey);
  const branch = clean(requestedBranch) || branchForDepartment(serviceKey);
  const configured = await chooseFromConfiguredRule(department, branch, sourceCode);
  return configured || { assignedTo: null, assignedName: "", branchCode: branch };
}

export async function chooseCallCenterAssignment(sourceCode = "", requestedBranch = "online") {
  const branch = clean(requestedBranch) || "online";
  const configured = await chooseFromConfiguredRule("call_center", branch, sourceCode);
  return configured
    ? { assignedTo: configured.assignedTo, assignedName: configured.assignedName }
    : { assignedTo: null, assignedName: "" };
}
