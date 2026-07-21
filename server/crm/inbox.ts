import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, isCrmManager, parseBody, requireCrmUser, userScope } from "../_crm-utils.js";
import { classifyConversationService } from "../_crm-lifecycle.js";
import { getSql } from "../_db.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();

  if (request.method === "GET") {
    const scope = userScope(user);
    const manager = isCrmManager(user);
    const state = clean(request.query.state);
    const channel = clean(request.query.channel);
    const search = clean(request.query.search);
    const like = `%${search}%`;

    const rows = await sql<any[]>`
      select
        c.*,c.id::text,c.lead_id::text,c.contact_id::text,c.service_request_id::text,
        ct.display_name as contact_display_name,ct.primary_phone,ct.primary_phone_normalized,
        l.customer_name as lead_customer_name,l.assigned_to::text,l.call_center_assigned_to::text,
        sales.full_name as assigned_name
      from crm.conversations c
      join crm.contacts ct on ct.id=c.contact_id
      left join crm.leads l on l.id=c.lead_id and l.is_deleted=false
      left join core.users sales on sales.id=c.assigned_to
      where c.service_request_id is null
        and (
          c.classification_state in ('new','awaiting_service')
          or (c.classification_state='closed' and c.last_customer_message_at is not null and c.last_customer_message_at>coalesce(c.closed_at,'epoch'::timestamptz))
        )
        and (${state}='' or c.classification_state=${state})
        and (${channel}='' or c.channel_code=${channel})
        and (${search}='' or concat_ws(' ',c.customer_name,ct.display_name,ct.primary_phone,ct.primary_phone_normalized,c.preview_text) ilike ${like})
        and (
          ${manager}::boolean
          or ${scope.all}::boolean
          or c.assigned_to=${user.id}::uuid
          or c.call_center_assigned_to=${user.id}::uuid
        )
      order by coalesce(c.last_customer_message_at,c.last_message_at,c.updated_at) desc nulls last
      limit 300
    `;

    const [summary] = await sql<any[]>`
      select
        count(*)::int as total,
        count(*) filter(where c.classification_state='new')::int as new_count,
        count(*) filter(where c.classification_state='awaiting_service')::int as awaiting_count,
        count(*) filter(where coalesce(c.unread_count,0)>0)::int as unread_count
      from crm.conversations c
      where c.service_request_id is null
        and (
          c.classification_state in ('new','awaiting_service')
          or (c.classification_state='closed' and c.last_customer_message_at is not null and c.last_customer_message_at>coalesce(c.closed_at,'epoch'::timestamptz))
        )
        and (${manager}::boolean or ${scope.all}::boolean or c.assigned_to=${user.id}::uuid or c.call_center_assigned_to=${user.id}::uuid)
    `;

    return response.status(200).json({ ok: true, rows, summary: summary || {}, canClassify: manager });
  }

  if (request.method === "POST") {
    if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "تصنيف الرسائل غير المصنفة متاح للإدارة فقط" });
    const body = parseBody(request);
    const conversationId = clean(body.conversationId);
    const serviceKey = clean(body.serviceKey);
    if (!conversationId || !serviceKey) return response.status(400).json({ ok: false, error: "المحادثة والخدمة مطلوبتان" });
    const result = await classifyConversationService({
      conversationId,
      serviceKey,
      sourceCode: clean(body.sourceCode),
      classificationMethod: "manual",
      actor: user,
      eventKey: `manual-classification:${conversationId}:${Date.now()}`,
    });
    return response.status(200).json({ ok: true, result });
  }

  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
