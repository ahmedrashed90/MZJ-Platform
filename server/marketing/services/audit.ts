import type { VercelRequest } from "@vercel/node";
import { requestIp, type SessionUser } from "../../_auth.js";
import type { getSql } from "../../_db.js";

type SqlClient = ReturnType<typeof getSql>;

export async function writeMarketingAudit(
  sql: SqlClient | any,
  request: VercelRequest,
  user: SessionUser,
  action: string,
  entityType: string,
  entityId: string | null,
  beforeData: unknown = null,
  afterData: unknown = null,
) {
  await sql`
    insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data,ip_address)
    values (${user.id}::uuid,'marketing',${action},${entityType},${entityId},${beforeData ? sql.json(beforeData) : null},${afterData ? sql.json(afterData) : null},${requestIp(request)})
  `;
}
