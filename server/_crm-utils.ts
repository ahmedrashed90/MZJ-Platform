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

export function distributionSourceCode(value: unknown) {
  const source = clean(value).toLowerCase();
  if (source === "facebook_post") return "facebook";
  if (source === "instagram_post") return "instagram";
  return source;
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
    qr: "QR", cash_qr: "QR",
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

async function chooseFromConfiguredRule(departmentCode: string, requestedBranch: string, sourceCode: string): Promise<AssignmentResult | null> {
  const sql = getSql();
  const requested = clean(requestedBranch);
  const source = clean(sourceCode);
  const routingSource = distributionSourceCode(source);

  const matchingRules = await sql<any[]>`
    select r.id::text,r.name,r.branch_code,r.source_codes,r.assignment_mode,r.prevent_consecutive,r.sort_order,r.created_at,
      case when ${requested || null}::text is not null and r.branch_code = ${requested || null} then 0
           when ${requested || null}::text is not null and r.branch_code is null then 1
           else 0 end as branch_specificity,
      case when coalesce(array_length(r.source_codes,1),0) > 0 then 0 else 1 end as source_specificity
    from crm.assignment_rules r
    where r.is_active=true
      and r.department_code=${departmentCode}
      and (${requested || null}::text is null or r.branch_code is null or r.branch_code=${requested || null})
      and (coalesce(array_length(r.source_codes,1),0)=0 or ${source}=any(r.source_codes) or ${routingSource}=any(r.source_codes))
    order by branch_specificity,source_specificity,r.sort_order,r.created_at,r.id
  `;
  if (!matchingRules.length) return null;

  const firstRule = matchingRules[0];
  const activeRules = matchingRules.filter((rule) =>
    Number(rule.branch_specificity) === Number(firstRule.branch_specificity)
    && Number(rule.source_specificity) === Number(firstRule.source_specificity)
    && Number(rule.sort_order || 0) === Number(firstRule.sort_order || 0)
    && String(rule.assignment_mode || "round_robin") === String(firstRule.assignment_mode || "round_robin")
  );
  const ruleIds = activeRules.map((rule) => rule.id);
  const ruleById = new Map(activeRules.map((rule) => [rule.id, rule]));

  const candidateRows = await sql<any[]>`
    select m.rule_id::text,u.id::text as user_id,u.full_name,m.priority,m.assignment_count,m.allocation_percentage,m.weighted_assignment_count,
      r.branch_code as rule_branch_code,r.sort_order as rule_sort_order,r.assignment_mode as rule_assignment_mode,
      coalesce(
        (
          select b.code
          from core.user_system_branches usb
          join core.branches b on b.id=usb.branch_id and b.is_active=true
          where usb.user_id=u.id and usb.system_code='crm'
          order by usb.is_primary desc,b.sort_order,b.name
          limit 1
        ),
        (
          select b.code
          from core.user_branches ub
          join core.branches b on b.id=ub.branch_id and b.is_active=true
          where ub.user_id=u.id
          order by ub.is_primary desc,b.sort_order,b.name
          limit 1
        )
      ) as primary_branch_code
    from crm.assignment_rule_members m
    join crm.assignment_rules r on r.id=m.rule_id
    join core.users u on u.id=m.user_id
    where m.rule_id=any(${ruleIds}::uuid[])
      and m.is_active=true
      and u.is_active=true
      and u.can_receive_leads=true
      and (
        exists (
          select 1
          from core.user_system_departments usd
          join core.departments d on d.id=usd.department_id and d.system_code='crm' and d.is_active=true
          where usd.user_id=u.id and usd.system_code='crm' and d.code=${departmentCode}
        )
        or (
          not exists (select 1 from core.user_system_departments usd0 where usd0.user_id=u.id and usd0.system_code='crm')
          and exists (
            select 1
            from core.user_departments ud
            join core.departments d on d.id=ud.department_id and d.is_active=true
            where ud.user_id=u.id and d.code=${departmentCode}
          )
        )
      )
      and (
        r.branch_code is null
        or exists (
          select 1
          from core.user_system_branches usb
          join core.branches b on b.id=usb.branch_id and b.is_active=true
          where usb.user_id=u.id and usb.system_code='crm' and b.code=r.branch_code
        )
        or (
          not exists (select 1 from core.user_system_branches usb0 where usb0.user_id=u.id and usb0.system_code='crm')
          and exists (
            select 1
            from core.user_branches ub
            join core.branches b on b.id=ub.branch_id and b.is_active=true
            where ub.user_id=u.id and b.code=r.branch_code
          )
        )
      )
      and (
        ${requested || null}::text is null
        or exists (
          select 1
          from core.user_system_branches usb
          join core.branches b on b.id=usb.branch_id and b.is_active=true
          where usb.user_id=u.id and usb.system_code='crm' and b.code=${requested || null}
        )
        or (
          not exists (select 1 from core.user_system_branches usb0 where usb0.user_id=u.id and usb0.system_code='crm')
          and exists (
            select 1
            from core.user_branches ub
            join core.branches b on b.id=ub.branch_id and b.is_active=true
            where ub.user_id=u.id and b.code=${requested || null}
          )
        )
      )
    order by r.sort_order,m.priority,u.full_name,u.id::text,m.rule_id::text
  `;
  if (!candidateRows.length) return null;

  const candidateByUser = new Map<string, any>();
  for (const candidate of candidateRows) {
    const existing = candidateByUser.get(candidate.user_id);
    if (!existing || (candidate.primary_branch_code && candidate.rule_branch_code === candidate.primary_branch_code && existing.rule_branch_code !== existing.primary_branch_code)) {
      candidateByUser.set(candidate.user_id, candidate);
    }
  }
  const candidates = [...candidateByUser.values()].sort((left, right) => {
    const sortOrder = Number(left.rule_sort_order || 0) - Number(right.rule_sort_order || 0);
    if (sortOrder) return sortOrder;
    const priority = Number(left.priority || 0) - Number(right.priority || 0);
    if (priority) return priority;
    return String(left.full_name || '').localeCompare(String(right.full_name || ''), 'ar');
  });
  if (!candidates.length) return null;

  const percentageCandidates = candidates.filter((candidate) => (ruleById.get(candidate.rule_id) || firstRule).assignment_mode === "percentage" && Number(candidate.allocation_percentage || 0) > 0);
  let selected: any;
  let selectedRule: any;
  let poolKey = `rules:${departmentCode}:${requested || "auto"}:${routingSource || source || "all"}:${ruleIds.slice().sort().join(",")}`;
  if (percentageCandidates.length && percentageCandidates.length === candidates.length) {
    const totalWeight = percentageCandidates.reduce((sum, candidate) => sum + Number(candidate.allocation_percentage || 0), 0);
    const totalAssigned = percentageCandidates.reduce((sum, candidate) => sum + Number(candidate.weighted_assignment_count || 0), 0);
    selected = percentageCandidates.slice().sort((left, right) => {
      const leftDeficit = totalWeight > 0 ? ((totalAssigned + 1) * Number(left.allocation_percentage || 0) / totalWeight) - Number(left.weighted_assignment_count || 0) : 0;
      const rightDeficit = totalWeight > 0 ? ((totalAssigned + 1) * Number(right.allocation_percentage || 0) / totalWeight) - Number(right.weighted_assignment_count || 0) : 0;
      return rightDeficit - leftDeficit
        || Number(left.rule_sort_order || 0) - Number(right.rule_sort_order || 0)
        || Number(left.priority || 0) - Number(right.priority || 0)
        || String(left.full_name || "").localeCompare(String(right.full_name || ""), "ar");
    })[0];
    selectedRule = ruleById.get(selected.rule_id) || firstRule;
  } else {
    const [state] = await sql<any[]>`select last_user_id::text from crm.assignment_state where pool_key=${poolKey} limit 1`;
    const lastIndex = candidates.findIndex((candidate) => candidate.user_id === state?.last_user_id);
    selected = candidates[(lastIndex + 1 + candidates.length) % candidates.length];
    selectedRule = ruleById.get(selected.rule_id) || firstRule;
  }
  const selectedBranch = clean(selected.primary_branch_code) || clean(selected.rule_branch_code) || requested;

  await sql`
    insert into crm.assignment_state(pool_key,last_user_id,last_branch_code,updated_at)
    values (${poolKey},${selected.user_id}::uuid,${selectedBranch || null},now())
    on conflict (pool_key) do update set last_user_id=excluded.last_user_id,last_branch_code=excluded.last_branch_code,updated_at=now()
  `;
  await sql`
    insert into crm.assignment_state(pool_key,last_user_id,last_branch_code,updated_at)
    values (${`rule:${selected.rule_id}`},${selected.user_id}::uuid,${selectedBranch || null},now())
    on conflict (pool_key) do update set last_user_id=excluded.last_user_id,last_branch_code=excluded.last_branch_code,updated_at=now()
  `;
  await sql`
    update crm.assignment_rule_members
    set assignment_count=assignment_count+1,
        weighted_assignment_count=case when ${selectedRule.assignment_mode || "round_robin"}='percentage' then weighted_assignment_count+1 else weighted_assignment_count end,
        last_assigned_at=now(),updated_at=now()
    where rule_id=${selected.rule_id}::uuid and user_id=${selected.user_id}::uuid
  `;
  await sql`
    insert into crm.assignment_logs(rule_id,department_code,branch_code,source_code,assigned_to,assigned_name,assignment_mode)
    values (${selected.rule_id}::uuid,${departmentCode},${selectedBranch || null},${source || null},${selected.user_id}::uuid,${selected.full_name},${selectedRule.assignment_mode || "round_robin"})
  `;
  return {
    assignedTo: selected.user_id,
    assignedName: selected.full_name,
    branchCode: selectedBranch,
    ruleId: selected.rule_id,
    ruleName: selectedRule.name,
  };
}

export async function chooseAssignment(serviceKey: string, requestedBranch = "", sourceCode = "") {
  const department = departmentCodeFromKey(serviceKey);
  const branch = requestedBranch || branchForDepartment(serviceKey);
  const configured = await chooseFromConfiguredRule(department, branch, sourceCode);
  return configured || { assignedTo: null, assignedName: "", branchCode: branch };
}

export async function chooseCallCenterAssignment(sourceCode = "", requestedBranch = "online") {
  const configured = await chooseFromConfiguredRule("call_center", requestedBranch, sourceCode);
  return configured ? { assignedTo: configured.assignedTo, assignedName: configured.assignedName } : { assignedTo: null, assignedName: "" };
}
