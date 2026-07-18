import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, normalizePhone, parseBody, requireCrmUser, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { markCrmLeadRead, markCrmLeadUnread } from "../_crm-unread-state.js";

function validIsoDate(value: unknown) {
  const text = clean(value);
  if (!text) return "";
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();
  const scope = userScope(user);
  const body = parseBody(request);
  const action = clean(body.action);
  const leadId = clean(body.leadId ?? body.lead_id);
  const conversationId = clean(body.conversationId ?? body.conversation_id);
  const phoneNormalized = normalizePhone(body.phone ?? body.phoneNormalized ?? body.phone_normalized);

  const [lead] = await sql<any[]>`
    select l.*,l.id::text,l.assigned_to::text,l.call_center_assigned_to::text
    from crm.leads l
    where l.is_deleted=false
      and (
        (${leadId || null}::uuid is not null and l.id=${leadId || null}::uuid)
        or (${conversationId || null}::text is not null and (
          l.legacy_id=${conversationId || null}
          or coalesce(l.extra_data->>'conversationId','')=${conversationId || null}
          or coalesce(l.extra_data->>'conversation_id','')=${conversationId || null}
          or coalesce(l.extra_data->>'convId','')=${conversationId || null}
          or coalesce(l.extra_data->>'waConversationId','')=${conversationId || null}
          or coalesce(l.extra_data->>'chatId','')=${conversationId || null}
          or coalesce(l.extra_data->>'participantId','')=${conversationId || null}
          or exists (
            select 1 from crm.conversations c
            where c.lead_id=l.id and (c.id::text=${conversationId || null} or c.legacy_id=${conversationId || null})
          )
        ))
        or (${phoneNormalized || null}::text is not null and l.phone_normalized=${phoneNormalized || null})
      )
      and (
        ${scope.all}::boolean
        or (${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
        or (not ${scope.callCenterOnly}::boolean and (l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
        or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
      )
    order by case when l.id::text=${leadId || ""} then 0 else 1 end,l.updated_at desc
    limit 1
  `;
  if (!lead) return response.status(404).json({ ok: false, error: "العميل غير موجود أو لا توجد صلاحية للوصول إليه" });

  if (action === "mark_unread") {
    const createdAt = validIsoDate(body.createdAt ?? body.created_at);
    if (!createdAt) return response.status(400).json({ ok: false, error: "وقت الرسالة الواردة غير صالح" });
    const messageId = clean(body.messageId ?? body.message_id);
    const messagePath = clean(body.messagePath ?? body.message_path);
    const messageKey = messageId || messagePath || `${conversationId}:${createdAt}`;
    const updated = await markCrmLeadUnread(sql, {
      leadId: lead.id,
      conversationId,
      createdAt,
      messageId,
      messagePath,
      messageKey,
    });
    return response.status(200).json({ ok: true, row: updated || lead, ignored: !updated });
  }

  if (action === "mark_read") {
    const readThroughAt = validIsoDate(body.readThroughAt ?? body.read_through_at) || new Date().toISOString();
    const updated = await markCrmLeadRead(sql, lead.id, { conversationId, readThroughAt });
    return response.status(200).json({ ok: true, row: updated, readThroughAt });
  }

  return response.status(400).json({ ok: false, error: "إجراء حالة القراءة غير مدعوم" });
}
