import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, parseBody, requireCrmUser, userScope } from "../_crm-utils.js";
import { deliverCrmMessage, renderCrmTemplate } from "../_crm-messaging.js";
import { getSql } from "../_db.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();
  const scope = userScope(user);

  if (request.method === "GET") {
    const leadId = clean(request.query.leadId);
    const conversationId = clean(request.query.conversationId);
    const limit = Math.min(300, Math.max(1, Number(request.query.limit || 100)));

    if (conversationId) {
      const [conversation] = await sql<any[]>`
        select c.*, c.id::text, c.lead_id::text from crm.conversations c
        left join crm.leads l on l.id=c.lead_id
        where c.id=${conversationId}::uuid
          and (
            ${scope.all}::boolean or c.assigned_to=${scope.userId}::uuid or c.call_center_assigned_to=${scope.userId}::uuid
            or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
          )
      `;
      if (!conversation) return response.status(404).json({ ok: false, error: "المحادثة غير موجودة" });
      const messages = await sql<any[]>`
        select m.*, m.id::text, m.conversation_id::text, u.full_name as sent_by_name
        from crm.messages m left join core.users u on u.id=m.sent_by
        where m.conversation_id=${conversationId}::uuid
        order by m.created_at asc limit ${limit}
      `;
      await sql`update crm.conversations set unread_count=0, updated_at=now() where id=${conversationId}::uuid`;
      return response.status(200).json({ ok: true, conversation: { ...conversation, unread_count: 0 }, messages });
    }

    const rows = await sql<any[]>`
      select c.*, c.id::text, c.lead_id::text, l.phone, l.phone_normalized, l.customer_name as lead_customer_name,
        sales.full_name as assigned_name, cc.full_name as call_center_name
      from crm.conversations c
      left join crm.leads l on l.id=c.lead_id
      left join core.users sales on sales.id=c.assigned_to
      left join core.users cc on cc.id=c.call_center_assigned_to
      where (${leadId || null}::uuid is null or c.lead_id=${leadId || null}::uuid)
        and (
          ${scope.all}::boolean or c.assigned_to=${scope.userId}::uuid or c.call_center_assigned_to=${scope.userId}::uuid
          or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
        )
      order by c.last_message_at desc nulls last,c.updated_at desc
      limit ${limit}
    `;
    return response.status(200).json({ ok: true, rows });
  }

  if (request.method === "POST") {
    const body = parseBody(request);
    const conversationId = clean(body.conversationId);
    const text = clean(body.text || body.message);
    const templateId = clean(body.templateId);
    if (!conversationId) return response.status(400).json({ ok: false, error: "المحادثة مطلوبة" });
    if (!text && !templateId) return response.status(400).json({ ok: false, error: "اكتب الرسالة أو اختر القالب" });

    const [conversation] = await sql<any[]>`
      select c.*, c.id::text, c.lead_id::text, l.phone, l.phone_normalized, l.customer_name as lead_customer_name,
        l.car_name,l.status_label
      from crm.conversations c left join crm.leads l on l.id=c.lead_id
      where c.id=${conversationId}::uuid
        and (
          ${scope.all}::boolean or c.assigned_to=${scope.userId}::uuid or c.call_center_assigned_to=${scope.userId}::uuid
          or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
        )
    `;
    if (!conversation) return response.status(404).json({ ok: false, error: "المحادثة غير موجودة" });

    let finalText = text;
    let template: any = null;
    if (templateId) {
      [template] = await sql<any[]>`select *,id::text from crm.message_templates where id=${templateId}::uuid and is_active=true`;
      if (!template) return response.status(404).json({ ok: false, error: "القالب غير موجود" });
      finalText = renderCrmTemplate(String(template.content || ""), conversation);
    }

    const delivery = await deliverCrmMessage({ conversation, text: finalText, template, actor: user, reason: "manual" });
    await audit(user, "message_sent", "conversation", conversationId, { channel: conversation.channel_code, providerStatus: delivery.providerStatus });
    return response.status(delivery.providerStatus === "failed" ? 502 : 201).json({ ok: delivery.providerStatus !== "failed", message: delivery.message, providerStatus: delivery.providerStatus, error: delivery.errorMessage || undefined });
  }

  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
