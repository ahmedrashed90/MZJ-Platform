import type { getSql } from "../../_db.js";

type SqlClient = ReturnType<typeof getSql>;

export async function allocateCampaignCode(sql: SqlClient | any, campaignType: string, requestDate?: string | null) {
  const date = requestDate ? new Date(`${requestDate}T00:00:00Z`) : new Date();
  const year = Number.isNaN(date.getTime()) ? new Date().getUTCFullYear() : date.getUTCFullYear();
  const [type] = await sql<{ id: string; prefix: string }[]>`
    select id::text,prefix from marketing.campaign_types where code=${campaignType} and is_active=true limit 1
  `;
  if (!type) throw new Error("CAMPAIGN_TYPE_NOT_FOUND");
  const lockKey = `marketing-campaign-code:${type.id}:${year}`;
  await sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`;
  const [counter] = await sql<{ current_value: number }[]>`
    insert into marketing.campaign_counters(campaign_type_id,year,current_value)
    values (${type.id}::uuid,${year},1)
    on conflict (campaign_type_id) do update set
      year=excluded.year,
      current_value=case when marketing.campaign_counters.year=excluded.year then marketing.campaign_counters.current_value+1 else 1 end,
      updated_at=now()
    returning current_value
  `;
  return `${type.prefix}-${year}-${String(counter.current_value).padStart(4, "0")}`;
}
