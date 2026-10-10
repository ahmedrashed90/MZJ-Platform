import { randomUUID } from "node:crypto";
import type { SessionUser } from "./_auth.js";
import { audit } from "./_crm-utils.js";
import { getSql, withDatabaseAdvisoryLock } from "./_db.js";

const FINANCE_DEPARTMENT_CODES = ["finance_sales", "call_center"];
const ELIGIBLE_STATUS_LABEL = "عميل جديد";
const TARGET_DEPARTMENT_CODE = "cash_sales";
const TARGET_SERVICE_KEY = "cash";
const TARGET_STATUS_LABEL = "عميل جديد";
const TARGET_PAYMENT_TYPE = "كاش";
const BULK_REALLOCATION_LOCK = "crm:finance-to-cash-equal-reallocation";

type SqlClient = ReturnType<typeof getSql>;

type CashAgentRow = {
  id: string;
  full_name: string;
  branch_code: string | null;
  branch_name: string | null;
};

type CashAgent = {
  id: string;
  full_name: string;
  branch_code: string;
  branch_name: string;
};

type FinanceLead = {
  id: string;
  customer_name: string | null;
  status_label: string | null;
  department_code: string | null;
  branch_code: string | null;
  assigned_to: string | null;
  call_center_assigned_to: string | null;
  responsible_name_snapshot: string | null;
  call_center_name_snapshot: string | null;
  contact_id: string | null;
  current_request_id: string | null;
};

export class CrmBulkReallocationError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CrmBulkReallocationError";
    this.status = status;
    this.code = code;
  }
}

function uniqueIds(values: unknown) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function equalAllocationCounts(total: number, agentCount: number) {
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(agentCount) || agentCount <= 0) return [];
  const base = Math.floor(total / agentCount);
  const remainder = total % agentCount;
  return Array.from({ length: agentCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

async function loadEligibleCashAgentRows(sql: SqlClient): Promise<CashAgentRow[]> {
  return sql<CashAgentRow[]>`
    select
      u.id::text,
      u.full_name,
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
      ) as branch_code,
      coalesce(
        (
          select b.name
          from core.user_system_branches usb
          join core.branches b on b.id=usb.branch_id and b.is_active=true
          where usb.user_id=u.id and usb.system_code='crm'
          order by usb.is_primary desc,b.sort_order,b.name
          limit 1
        ),
        (
          select b.name
          from core.user_branches ub
          join core.branches b on b.id=ub.branch_id and b.is_active=true
          where ub.user_id=u.id
          order by ub.is_primary desc,b.sort_order,b.name
          limit 1
        )
      ) as branch_name
    from core.users u
    where u.is_active=true
      and u.can_receive_leads=true
      and (
        exists (
          select 1
          from core.user_system_departments usd
          join core.departments d on d.id=usd.department_id and d.is_active=true
          where usd.user_id=u.id and usd.system_code='crm' and d.code=${TARGET_DEPARTMENT_CODE}
        )
        or exists (
          select 1
          from core.user_departments ud
          join core.departments d on d.id=ud.department_id and d.is_active=true
          where ud.user_id=u.id and d.code=${TARGET_DEPARTMENT_CODE}
        )
      )
    order by u.full_name,u.id
  `;
}

function normalizeCashAgent(row: CashAgentRow): CashAgent | null {
  const branchCode = String(row.branch_code || "").trim();
  if (!branchCode) return null;
  return {
    id: row.id,
    full_name: row.full_name,
    branch_code: branchCode,
    branch_name: String(row.branch_name || branchCode),
  };
}

export async function listCashReallocationAgents() {
  const rows = await loadEligibleCashAgentRows(getSql());
  return rows.map(normalizeCashAgent).filter((row): row is CashAgent => Boolean(row));
}

async function loadCashAgents(sql: SqlClient, rawAgentIds: unknown): Promise<CashAgent[]> {
  const agentIds = uniqueIds(rawAgentIds);
  if (!agentIds.length) {
    throw new CrmBulkReallocationError(400, "CASH_AGENTS_REQUIRED", "اختر مندوبًا واحدًا على الأقل من مناديب مبيعات الكاش");
  }

  const eligibleRows = await loadEligibleCashAgentRows(sql);
  const eligibleById = new Map(eligibleRows.map((row) => [row.id, row]));
  const requestedRows = agentIds.map((id) => eligibleById.get(id)).filter((row): row is CashAgentRow => Boolean(row));
  if (requestedRows.length !== agentIds.length) {
    throw new CrmBulkReallocationError(400, "INVALID_CASH_AGENT", "أحد المستخدمين المختارين غير نشط أو غير تابع لمبيعات الكاش أو غير مسموح له باستقبال العملاء");
  }

  const withoutBranch = requestedRows.filter((row) => !String(row.branch_code || "").trim());
  if (withoutBranch.length) {
    throw new CrmBulkReallocationError(400, "CASH_AGENT_BRANCH_REQUIRED", `اربط فرع CRM أساسي بالمندوب: ${withoutBranch.map((row) => row.full_name).join("، ")}`);
  }

  return requestedRows.map((row) => normalizeCashAgent(row) as CashAgent);
}
async function financeLeadCount(sql: SqlClient) {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from crm.leads
    where is_deleted=false
      and department_code=any(${FINANCE_DEPARTMENT_CODES}::text[])
      and btrim(coalesce(status_label,''))=${ELIGIBLE_STATUS_LABEL}
  `;
  return Number(row?.count || 0);
}

function previewPayload(total: number, agents: CashAgent[]) {
  const counts = equalAllocationCounts(total, agents.length);
  return {
    total,
    sourceDepartmentCodes: FINANCE_DEPARTMENT_CODES,
    sourceStatusLabel: ELIGIBLE_STATUS_LABEL,
    targetDepartmentCode: TARGET_DEPARTMENT_CODE,
    targetStatusLabel: TARGET_STATUS_LABEL,
    distributionMode: "equal",
    agents: agents.map((agent, index) => ({
      id: agent.id,
      fullName: agent.full_name,
      branchCode: agent.branch_code,
      branchName: agent.branch_name,
      customerCount: counts[index] || 0,
    })),
  };
}

export async function previewFinanceToCashReallocation(rawAgentIds: unknown) {
  const sql = getSql();
  const agents = await loadCashAgents(sql, rawAgentIds);
  const total = await financeLeadCount(sql);
  return previewPayload(total, agents);
}

export async function executeFinanceToCashReallocation(input: {
  agentIds: unknown;
  expectedLeadCount: unknown;
  actor: SessionUser;
}) {
  const requestedAgentIds = uniqueIds(input.agentIds);
  const expectedLeadCount = Number(input.expectedLeadCount);
  if (!Number.isInteger(expectedLeadCount) || expectedLeadCount < 0) {
    throw new CrmBulkReallocationError(400, "EXPECTED_COUNT_REQUIRED", "راجع المعاينة واكتب عدد العملاء الظاهر قبل تنفيذ النقل");
  }

  return withDatabaseAdvisoryLock(BULK_REALLOCATION_LOCK, async () => {
    const sql = getSql();
    const agents = await loadCashAgents(sql, requestedAgentIds);
    const runId = randomUUID();

    const result = await sql.begin(async (tx: any) => {
      const leads = await tx`
        select
          l.id::text,l.customer_name,l.status_label,l.department_code,l.branch_code,
          l.assigned_to::text,l.call_center_assigned_to::text,
          l.responsible_name_snapshot,l.call_center_name_snapshot,
          l.contact_id::text,l.current_request_id::text
        from crm.leads l
        where l.is_deleted=false
          and l.department_code=any(${FINANCE_DEPARTMENT_CODES}::text[])
          and btrim(coalesce(l.status_label,''))=${ELIGIBLE_STATUS_LABEL}
        order by coalesce(l.registered_at,l.created_at),l.id
        for update of l
      ` as FinanceLead[];

      if (leads.length !== expectedLeadCount) {
        throw new CrmBulkReallocationError(409, "LEAD_COUNT_CHANGED", `عدد العملاء تغير من ${expectedLeadCount} إلى ${leads.length}. اعمل معاينة جديدة قبل التنفيذ`);
      }
      if (!leads.length) {
        throw new CrmBulkReallocationError(409, "NO_ELIGIBLE_FINANCE_LEADS", "لا يوجد عملاء في مبيعات التمويل بحالة عميل جديد لنقلهم");
      }

      const assignedAgentIds: string[] = [];
      const assignedAgentNames: string[] = [];
      const assignedBranchCodes: string[] = [];
      for (let index = 0; index < leads.length; index += 1) {
        const agent = agents[index % agents.length];
        assignedAgentIds.push(agent.id);
        assignedAgentNames.push(agent.full_name);
        assignedBranchCodes.push(agent.branch_code);
      }
      const leadIds = leads.map((lead) => lead.id);

      await tx`
        with assignments as (
          select *
          from unnest(
            ${leadIds}::uuid[],
            ${assignedAgentIds}::uuid[],
            ${assignedAgentNames}::text[],
            ${assignedBranchCodes}::text[]
          ) as item(lead_id,agent_id,agent_name,branch_code)
        )
        insert into crm.lead_events(
          lead_id,event_type,old_status,new_status,old_department,new_department,
          old_branch,new_branch,actor_id,actor_name,actor_role,note,details
        )
        select
          l.id,'bulk_reallocation',l.status_label,${TARGET_STATUS_LABEL},l.department_code,${TARGET_DEPARTMENT_CODE},
          l.branch_code,item.branch_code,${input.actor.id}::uuid,${input.actor.fullName},${input.actor.roles.join("، ") || null},
          'نقل جماعي متساوٍ من مبيعات التمويل إلى مبيعات الكاش',
          jsonb_build_object(
            'runId',${runId}::uuid,
            'distributionMode','equal',
            'previousAssignedTo',l.assigned_to,
            'previousCallCenterAssignedTo',l.call_center_assigned_to,
            'newAgentId',item.agent_id,
            'newAgentName',item.agent_name,
            'source','settings.crm.distribution'
          )
        from assignments item
        join crm.leads l on l.id=item.lead_id
      `;

      await tx`
        with assignments as (
          select *
          from unnest(
            ${leadIds}::uuid[],
            ${assignedAgentIds}::uuid[],
            ${assignedAgentNames}::text[],
            ${assignedBranchCodes}::text[]
          ) as item(lead_id,agent_id,agent_name,branch_code)
        )
        insert into crm.ownership_events(
          contact_id,service_request_id,lead_id,
          previous_assigned_to,previous_assigned_name,new_assigned_to,new_assigned_name,
          previous_department_code,new_department_code,previous_branch_code,new_branch_code,
          actor_id,actor_name,actor_type,reason,metadata
        )
        select
          l.contact_id,l.current_request_id,l.id,
          l.assigned_to,coalesce(previous_owner.full_name,l.responsible_name_snapshot),item.agent_id,item.agent_name,
          l.department_code,${TARGET_DEPARTMENT_CODE},l.branch_code,item.branch_code,
          ${input.actor.id}::uuid,${input.actor.fullName},'user',
          'نقل جماعي متساوٍ من مبيعات التمويل إلى مبيعات الكاش',
          jsonb_build_object('runId',${runId}::uuid,'distributionMode','equal','previousCallCenterAssignedTo',l.call_center_assigned_to)
        from assignments item
        join crm.leads l on l.id=item.lead_id
        left join core.users previous_owner on previous_owner.id=l.assigned_to
      `;

      await tx`
        with assignments as (
          select *
          from unnest(
            ${leadIds}::uuid[],
            ${assignedAgentIds}::uuid[],
            ${assignedAgentNames}::text[],
            ${assignedBranchCodes}::text[]
          ) as item(lead_id,agent_id,agent_name,branch_code)
        )
        insert into crm.assignment_logs(
          rule_id,lead_id,department_code,branch_code,source_code,
          assigned_to,assigned_name,previous_assigned_to,previous_assigned_name,
          assignment_mode,action,actor_id,actor_name
        )
        select
          null,l.id,${TARGET_DEPARTMENT_CODE},item.branch_code,l.source_code,
          item.agent_id,item.agent_name,l.assigned_to,coalesce(previous_owner.full_name,l.responsible_name_snapshot),
          'equal_bulk','bulk_finance_to_cash',${input.actor.id}::uuid,${input.actor.fullName}
        from assignments item
        join crm.leads l on l.id=item.lead_id
        left join core.users previous_owner on previous_owner.id=l.assigned_to
      `;

      await tx`
        with assignments as (
          select *
          from unnest(
            ${leadIds}::uuid[],
            ${assignedAgentIds}::uuid[],
            ${assignedAgentNames}::text[],
            ${assignedBranchCodes}::text[]
          ) as item(lead_id,agent_id,agent_name,branch_code)
        )
        update crm.leads l set
          service_key=${TARGET_SERVICE_KEY},
          department_code=${TARGET_DEPARTMENT_CODE},
          branch_code=item.branch_code,
          status_code=null,
          status_label=${TARGET_STATUS_LABEL},
          payment_type=${TARGET_PAYMENT_TYPE},
          assigned_to=item.agent_id,
          call_center_assigned_to=null,
          responsible_name_snapshot=item.agent_name,
          call_center_name_snapshot=null,
          assignment_mode='equal_bulk',
          updated_by=${input.actor.id}::uuid,
          updated_at=now()
        from assignments item
        where l.id=item.lead_id
      `;

      await tx`
        with assignments as (
          select *
          from unnest(
            ${leadIds}::uuid[],
            ${assignedAgentIds}::uuid[],
            ${assignedBranchCodes}::text[]
          ) as item(lead_id,agent_id,branch_code)
        )
        update crm.service_requests request set
          service_key=${TARGET_SERVICE_KEY},
          department_code=${TARGET_DEPARTMENT_CODE},
          branch_code=item.branch_code,
          status_label=${TARGET_STATUS_LABEL},
          assigned_to=item.agent_id,
          call_center_assigned_to=null,
          updated_at=now()
        from assignments item
        where request.lead_id=item.lead_id and request.request_state='open'
      `;

      await tx`
        with assignments as (
          select *
          from unnest(
            ${leadIds}::uuid[],
            ${assignedAgentIds}::uuid[],
            ${assignedBranchCodes}::text[]
          ) as item(lead_id,agent_id,branch_code)
        )
        update crm.conversations conversation set
          service_key=${TARGET_SERVICE_KEY},
          department_code=${TARGET_DEPARTMENT_CODE},
          branch_code=item.branch_code,
          assigned_to=item.agent_id,
          call_center_assigned_to=null,
          updated_at=now()
        from assignments item
        where conversation.lead_id=item.lead_id
      `;

      await tx`
        with assignments as (
          select *
          from unnest(
            ${leadIds}::uuid[],
            ${assignedAgentIds}::uuid[],
            ${assignedBranchCodes}::text[]
          ) as item(lead_id,agent_id,branch_code)
        )
        update crm.manual_lead_requests request set
          payment_type=${TARGET_PAYMENT_TYPE},
          service_key=${TARGET_SERVICE_KEY},
          department_code=${TARGET_DEPARTMENT_CODE},
          branch_code=item.branch_code,
          requested_assigned_to=item.agent_id,
          requested_call_center_to=null,
          updated_at=now()
        from assignments item
        where request.created_lead_id=item.lead_id
      `;

      const distribution = previewPayload(leads.length, agents).agents;
      return { runId, total: leads.length, distribution };
    });

    await audit(input.actor, "crm_bulk_finance_to_cash_completed", "crm_bulk_reallocation", result.runId, {
      runId: result.runId,
      total: result.total,
      sourceDepartmentCodes: FINANCE_DEPARTMENT_CODES,
      sourceStatusLabel: ELIGIBLE_STATUS_LABEL,
      targetDepartmentCode: TARGET_DEPARTMENT_CODE,
      targetStatusLabel: TARGET_STATUS_LABEL,
      distributionMode: "equal",
      agents: result.distribution,
    });

    return result;
  });
}
