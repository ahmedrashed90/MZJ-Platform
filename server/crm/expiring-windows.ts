import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, parseBody, requireCrmUser, userScope, currentCrmLeadBranchSql } from "../_crm-utils.js";
import { deliverConversationMessage } from "../_crm-messaging.js";
import { getSql } from "../_db.js";
import { computeMessagingWindow } from "../../shared/crm-messaging-window.js";
import { tiktokWindowHours } from "../_crm-window.js";

const ASK_PHONE_TEXT = "هلا فيك 👋 عشان نخدمك بشكل أسرع ونتواصل معك بسهولة، تقدر ترسل لنا رقم جوالك؟";

function askPhoneText() {
  return clean(process.env.CRM_ASK_PHONE_MESSAGE) || ASK_PHONE_TEXT;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();
  const scope = userScope(user);

  if (request.method === "GET") {
    const hours = Math.min(24, Math.max(1, Number(request.query.hours || 12)));
    const candidates = await sql<any[]>`
      select c.id::text, c.lead_id::text, c.channel_code, c.customer_name, c.last_customer_message_at, c.unread_count,
        l.customer_name as lead_customer_name, l.phone, l.phone_normalized, l.status_label, l.car_name, l.service_key,
        sales.full_name as assigned_name
      from crm.conversations c
      join crm.leads l on l.id=c.lead_id and l.is_deleted=false
      left join core.users sales on sales.id=c.assigned_to
      where c.last_customer_message_at is not null
        and c.last_customer_message_at > now() - interval '48 hours'
        and c.channel_code in ('facebook','instagram','tiktok','whatsapp','mersal')
        and (
          ${scope.all}::boolean or (${scope.includeAssigned}::boolean and (c.assigned_to=${scope.userId}::uuid or c.call_center_assigned_to=${scope.userId}::uuid))
          or (l.department_code=any(${scope.departmentCodes}::text[]) and (not ${scope.branchRestricted}::boolean or ${currentCrmLeadBranchSql(sql)}=any(${scope.branchCodes}::text[])))
        )
      limit 1000
    `;
    const now = Date.now();
    const rows = candidates
      .map((row) => ({ ...row, messaging_window: computeMessagingWindow({ channelCode: row.channel_code, lastCustomerMessageAt: row.last_customer_message_at, tiktokHours: tiktokWindowHours(), now }) }))
      .filter((row) => row.messaging_window && row.messaging_window.remainingMs !== null && row.messaging_window.remainingMs > 0 && row.messaging_window.remainingMs <= hours * 3_600_000)
      .sort((a, b) => (a.messaging_window!.remainingMs as number) - (b.messaging_window!.remainingMs as number))
      .slice(0, 300)
      .map((row) => ({ ...row, has_phone: Boolean(row.phone_normalized) }));
    return response.status(200).json({ ok: true, rows, hours });
  }

  if (request.method === "POST") {
    const body = parseBody(request);
    const action = clean(body.action);
    const conversationId = clean(body.conversationId);
    if (action !== "ask_phone" || !conversationId) return response.status(400).json({ ok: false, error: "طلب غير صحيح" });
    const [conversation] = await sql<any[]>`
      select c.id::text, c.lead_id::text, l.phone_normalized
      from crm.conversations c join crm.leads l on l.id=c.lead_id and l.is_deleted=false
      where c.id=${conversationId}::uuid
        and (
          ${scope.all}::boolean or (${scope.includeAssigned}::boolean and (c.assigned_to=${scope.userId}::uuid or c.call_center_assigned_to=${scope.userId}::uuid))
          or (l.department_code=any(${scope.departmentCodes}::text[]) and (not ${scope.branchRestricted}::boolean or ${currentCrmLeadBranchSql(sql)}=any(${scope.branchCodes}::text[])))
        )
    `;
    if (!conversation) return response.status(404).json({ ok: false, error: "المحادثة غير موجودة" });
    if (conversation.phone_normalized) return response.status(409).json({ ok: false, error: "رقم العميل مسجل بالفعل" });
    try {
      const result = await deliverConversationMessage({
        conversationId, text: askPhoneText(), actor: user, senderType: "human", reason: "ask_phone",
        idempotencyKey: `ask-phone:${conversationId}:${Math.floor(Date.now() / 60_000)}`,
      });
      await audit(user, "conversation_ask_phone", "conversation", conversationId, { providerStatus: (result as any)?.providerStatus });
      return response.status(200).json({ ok: true, providerStatus: (result as any)?.providerStatus || "queued" });
    } catch (error) {
      return response.status(400).json({ ok: false, error: error instanceof Error ? error.message : "تعذر إرسال الرسالة" });
    }
  }
  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
