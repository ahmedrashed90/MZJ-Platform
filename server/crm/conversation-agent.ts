import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, parseBody, requireCrmUser, userScope, currentCrmLeadBranchSql } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { ensureInboxAgentEngineSchema } from "../_crm-inbox-agent-engine.js";

/**
 * POST /api/crm/conversation-agent
 * Body: { conversationId: string; muted: boolean }
 *
 * Muting stops the inbox agent from sending escalation alerts and the 23h customer
 * notice for this conversation. The mute is non-destructive: if the customer sends a
 * new message after the mute, the agent re-arms automatically (phone_requested_at and
 * agent_muted_at are both cleared once last_customer_message_at advances past them).
 */
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });

  const user = await requireCrmUser(request, response);
  if (!user) return;

  const sql = getSql();
  await ensureInboxAgentEngineSchema();

  const scope = userScope(user);
  const body = parseBody(request);
  const conversationId = clean(body.conversationId);
  const muted = Boolean(body.muted);

  if (!conversationId) return response.status(400).json({ ok: false, error: "conversationId مطلوب" });

  const [conversation] = await sql<any[]>`
    select c.id::text, c.lead_id::text, c.agent_muted_at
    from crm.conversations c
    left join crm.leads l on l.id=c.lead_id
    where c.id=${conversationId}::uuid
      and (
        ${scope.all}::boolean
        or (${scope.includeAssigned}::boolean and (c.assigned_to=${scope.userId}::uuid or c.call_center_assigned_to=${scope.userId}::uuid))
        or (l.id is not null and l.department_code=any(${scope.departmentCodes}::text[])
          and (not ${scope.branchRestricted}::boolean or ${currentCrmLeadBranchSql(sql)}=any(${scope.branchCodes}::text[])))
      )
  `;
  if (!conversation) return response.status(404).json({ ok: false, error: "المحادثة غير موجودة أو لا تملك صلاحية الوصول إليها" });

  if (muted) {
    await sql`
      update crm.conversations
      set agent_muted_at=now(), agent_muted_by=${scope.userId}::uuid, updated_at=now()
      where id=${conversationId}::uuid
    `;
    // Cancel any active escalation entries so alerts stop immediately.
    await sql`
      update crm.inbox_agent_escalations set status='cancelled', updated_at=now()
      where conversation_id=${conversationId}::uuid and status='active'
    `;
    await audit(user, "conversation_agent_muted", "conversation", conversationId, {});
  } else {
    await sql`
      update crm.conversations
      set agent_muted_at=null, agent_muted_by=null, updated_at=now()
      where id=${conversationId}::uuid
    `;
    await audit(user, "conversation_agent_resumed", "conversation", conversationId, {});
  }

  return response.status(200).json({ ok: true, muted });
}
