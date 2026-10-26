import type { getSql } from "./_db.js";
import { saleTimestampForOrder } from "./_crm-sale-timestamp.js";

export type CrmSalesSql = ReturnType<typeof getSql>;
export type CrmSalesMetadata = Parameters<CrmSalesSql["json"]>[0];

export type ManualSaleSnapshot = {
  leadId: string;
  saleAt: string;
  quantity: number;
  totalAmount?: number | null;
  assignedTo?: string | null;
  assignedName?: string | null;
  departmentCode?: string | null;
  branchCode?: string | null;
  sourceCode?: string | null;
  sourceName?: string | null;
  carName?: string | null;
  carCategory?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  sourceType?: string;
  sourceReference?: string | null;
  metadata?: CrmSalesMetadata;
};

export type CanonicalSaleDateCorrection = {
  leadId: string;
  saleAt: string;
  actorId: string;
  actorName?: string | null;
  reason?: string | null;
};

function positiveQuantity(value: unknown) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export async function insertManualSale(sql: CrmSalesSql, input: ManualSaleSnapshot) {
  const [row] = await sql<any[]>`
    insert into crm.sales_transactions(
      lead_id,source_type,source_reference,sale_at,quantity,total_amount,
      assigned_to,assigned_name,department_code,branch_code,source_code,source_name,
      car_name,car_category,created_by,updated_by,metadata
    ) values(
      ${input.leadId}::uuid,
      ${input.sourceType || "manual"},
      ${input.sourceReference || null},
      case
        when ${input.saleAt}::text ~ '^\\d{4}-\\d{2}-\\d{2}$'
          then (${input.saleAt}::date::timestamp at time zone 'Asia/Riyadh')
        else ${input.saleAt}::timestamptz
      end,
      ${positiveQuantity(input.quantity)},
      ${Number(input.totalAmount || 0)},
      ${input.assignedTo || null}::uuid,
      ${input.assignedName || null},
      ${input.departmentCode || null},
      ${input.branchCode || null},
      ${input.sourceCode || null},
      ${input.sourceName || null},
      ${input.carName || null},
      ${input.carCategory || null},
      ${input.createdBy || null}::uuid,
      ${input.updatedBy || input.createdBy || null}::uuid,
      ${sql.json(input.metadata ?? {})}
    )
    returning *,id::text,lead_id::text,assigned_to::text,created_by::text,updated_by::text
  `;
  return row;
}

export async function updateLatestManualSale(
  sql: CrmSalesSql,
  input: ManualSaleSnapshot & { createIfMissing?: boolean },
) {
  const [latest] = await sql<{ id: string }[]>`
    select id::text
    from crm.sales_transactions
    where lead_id=${input.leadId}::uuid
      and coalesce(is_cancelled,false)=false
      and source_type in ('manual','legacy_backfill','import_backfill')
    order by sale_at desc,created_at desc,id desc
    limit 1
    for update
  `;
  if (!latest) {
    if (input.createIfMissing === false) return null;
    return insertManualSale(sql, {
      ...input,
      sourceType: input.sourceType || "import_backfill",
      sourceReference: input.sourceReference || null,
    });
  }
  const [row] = await sql<any[]>`
    update crm.sales_transactions set
      sale_at=case
        when ${input.saleAt}::text ~ '^\\d{4}-\\d{2}-\\d{2}$'
          then (${input.saleAt}::date::timestamp at time zone 'Asia/Riyadh')
        else ${input.saleAt}::timestamptz
      end,
      quantity=${positiveQuantity(input.quantity)},
      total_amount=${Number(input.totalAmount || 0)},
      assigned_to=${input.assignedTo || null}::uuid,
      assigned_name=${input.assignedName || null},
      department_code=${input.departmentCode || null},
      branch_code=${input.branchCode || null},
      source_code=${input.sourceCode || null},
      source_name=${input.sourceName || null},
      car_name=${input.carName || null},
      car_category=${input.carCategory || null},
      updated_by=${input.updatedBy || input.createdBy || null}::uuid,
      metadata=coalesce(metadata,'{}'::jsonb)||${sql.json(input.metadata ?? {})},
      updated_at=now()
    where id=${latest.id}::uuid
    returning *,id::text,lead_id::text,assigned_to::text,created_by::text,updated_by::text
  `;
  return row;
}

export async function correctLatestCanonicalSaleDate(
  sql: CrmSalesSql,
  input: CanonicalSaleDateCorrection,
) {
  const [latest] = await sql<any[]>`
    select id::text,source_type,source_reference,sale_at
    from crm.sales_transactions
    where lead_id=${input.leadId}::uuid
      and coalesce(is_cancelled,false)=false
    order by sale_at desc,created_at desc,id desc
    limit 1
    for update
  `;
  if (!latest) return null;

  const correctedAt = new Date().toISOString();
  const correctedSaleAt = saleTimestampForOrder(input.saleAt, latest.sale_at);
  const [transaction] = await sql<any[]>`
    update crm.sales_transactions set
      sale_at=${correctedSaleAt}::timestamptz,
      updated_by=${input.actorId}::uuid,
      metadata=coalesce(metadata,'{}'::jsonb)||${sql.json({
        soldDateOverride: true,
        soldDateOverrideValue: input.saleAt,
        soldDateOverrideAt: correctedAt,
        soldDateOverrideBy: input.actorId,
        soldDateOverrideByName: input.actorName || null,
        soldDateOverrideReason: input.reason || "crm_database_edit",
        previousSaleAt: latest.sale_at || null,
      })}::jsonb,
      updated_at=now()
    where id=${latest.id}::uuid
    returning *,id::text,lead_id::text,assigned_to::text,created_by::text,updated_by::text
  `;

  const [summary] = await sql<any[]>`
    select
      coalesce(sum(greatest(coalesce(quantity,1),1)),0)::int as sold_quantity,
      max(sale_at) as sold_at
    from crm.sales_transactions
    where lead_id=${input.leadId}::uuid
      and coalesce(is_cancelled,false)=false
  `;

  return {
    transaction,
    soldQuantity: Math.max(0, Number(summary?.sold_quantity || 0)),
    soldAt: summary?.sold_at || null,
  };
}

