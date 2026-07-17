import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, normalizePhone, parseBody, requireCrmUser, userScope } from "../_crm-utils.js";
import { deliverCrmMessage, renderCrmTemplate } from "../_crm-messaging.js";
import { publishAutomationEvent } from "../_crm-automation.js";
import { getSql } from "../_db.js";
import { markCrmLeadRead } from "../_crm-unread-state.js";

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
        select c.*, c.id::text, c.lead_id::text,
          l.phone,l.phone_normalized,l.customer_name as lead_customer_name,l.source_code,coalesce(src.name,l.source_name) as source_name,l.platform_code,l.service_key,
          sales.full_name as assigned_name,cc.full_name as call_center_name
        from crm.conversations c
        left join crm.leads l on l.id=c.lead_id
        left join core.sources src on src.code=l.source_code
        left join core.users sales on sales.id=c.assigned_to
        left join core.users cc on cc.id=c.call_center_assigned_to
        where c.id=${conversationId}::uuid
          and (
            ${scope.all}::boolean or c.assigned_to=${scope.userId}::uuid or c.call_center_assigned_to=${scope.userId}::uuid
            or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
          )
      `;
      if (!conversation) return response.status(404).json({ ok: false, error: "المحادثة غير موجودة" });
      const messages = await sql<any[]>`
        select m.*, m.id::text, m.conversation_id::text, u.full_name as sent_by_name, a.id::text as media_asset_id
        from crm.messages m left join core.users u on u.id=m.sent_by
        left join crm.media_assets a on a.message_id=m.id
        where m.conversation_id=${conversationId}::uuid
        order by m.created_at asc limit ${limit}
      `;
      if (conversation.lead_id) await markCrmLeadRead(sql, conversation.lead_id);
      else await sql`update crm.conversations set unread_count=0, updated_at=now() where id=${conversationId}::uuid`;
      return response.status(200).json({ ok: true, conversation: { ...conversation, unread_count: 0 }, messages });
    }

    let rows: any[] = [...await sql<any[]>`
      select c.*, c.id::text, c.lead_id::text, l.phone, l.phone_normalized, l.customer_name as lead_customer_name,
        l.source_code,coalesce(src.name,l.source_name) as source_name,l.platform_code,l.service_key,
        sales.full_name as assigned_name, cc.full_name as call_center_name
      from crm.conversations c
      left join crm.leads l on l.id=c.lead_id
      left join core.sources src on src.code=l.source_code
      left join core.users sales on sales.id=c.assigned_to
      left join core.users cc on cc.id=c.call_center_assigned_to
      where (${leadId || null}::uuid is null or c.lead_id=${leadId || null}::uuid)
        and (
          ${scope.all}::boolean or c.assigned_to=${scope.userId}::uuid or c.call_center_assigned_to=${scope.userId}::uuid
          or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
        )
      order by c.last_message_at desc nulls last,c.updated_at desc
      limit ${limit}
    `];

    if (leadId && !rows.length) {
      const [lead] = await sql<any[]>`
        select l.*,l.id::text,l.assigned_to::text,l.call_center_assigned_to::text,
          exists(select 1 from crm.manual_lead_requests r where r.created_lead_id=l.id) as is_manual_entry
        from crm.leads l
        where l.id=${leadId}::uuid and l.is_deleted=false
          and (
            ${scope.all}::boolean or l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid
            or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
          )
      `;
      if (lead?.phone_normalized || lead?.phone) {
        const whatsappId = normalizePhone(lead.phone_normalized || lead.phone);
        const [created] = await sql<any[]>`
          insert into crm.conversations(
            legacy_id,lead_id,channel_code,customer_name,participant_id,assigned_to,call_center_assigned_to,provider,metadata,last_message_at
          ) values (
            ${whatsappId},${lead.id}::uuid,'whatsapp',${lead.customer_name || "عميل"},${whatsappId},${lead.assigned_to || null}::uuid,${lead.call_center_assigned_to || null}::uuid,'mersal',
            ${sql.json({ manualEntry: Boolean(lead.is_manual_entry), sourceCode: lead.source_code, sourceName: lead.source_name, autoCreated: true })},null
          )
          on conflict (legacy_id) do update set
            lead_id=excluded.lead_id,participant_id=excluded.participant_id,assigned_to=excluded.assigned_to,call_center_assigned_to=excluded.call_center_assigned_to,
            customer_name=excluded.customer_name,provider='mersal',updated_at=now()
          returning *,id::text,lead_id::text
        `;
        rows = [{
          ...created,
          phone: lead.phone,
          phone_normalized: lead.phone_normalized,
          lead_customer_name: lead.customer_name,
          source_code: lead.source_code,
          source_name: lead.source_name,
          platform_code: lead.platform_code,
          service_key: lead.service_key,
        }];
      }
    }

    return response.status(200).json({ ok: true, rows });
  }

  if (request.method === "POST") {
    const body = parseBody(request);
    const conversationId = clean(body.conversationId);
    const text = clean(body.text || body.message);
    const templateId = clean(body.templateId);
    const mediaAssetId = clean(body.mediaAssetId);
    if (!conversationId) return response.status(400).json({ ok: false, error: "المحادثة مطلوبة" });
    if (!text && !templateId && !mediaAssetId) return response.status(400).json({ ok: false, error: "اكتب الرسالة أو اختر القالب أو أرفق ملفًا" });

    const [conversation] = await sql<any[]>`
      select c.*, c.id::text, c.lead_id::text, l.phone, l.phone_normalized, l.customer_name as lead_customer_name,
        l.car_name,l.status_label,l.source_code,coalesce(src.name,l.source_name) as source_name,l.platform_code,l.service_key
      from crm.conversations c left join crm.leads l on l.id=c.lead_id
      left join core.sources src on src.code=l.source_code
      where c.id=${conversationId}::uuid
        and (
          ${scope.all}::boolean or c.assigned_to=${scope.userId}::uuid or c.call_center_assigned_to=${scope.userId}::uuid
          or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
        )
    `;
    if (!conversation) return response.status(404).json({ ok: false, error: "المحادثة غير موجودة" });

    let finalText = text;
    let template: any = null;
    let media: any = null;
    if (templateId) {
      [template] = await sql<any[]>`select *,id::text from crm.message_templates where id=${templateId}::uuid and is_active=true`;
      if (!template) return response.status(404).json({ ok: false, error: "القالب غير موجود" });
      finalText = text || renderCrmTemplate(String(template.content || ""), conversation);
      if (/{{\s*[^}]+\s*}}/.test(finalText)) return response.status(400).json({ ok: false, error: "استكمل متغيرات القالب الظاهرة داخل مكان الكتابة قبل الإرسال" });
    }

    if (mediaAssetId) {
      [media] = await sql<any[]>`select *,id::text,conversation_id::text from crm.media_assets where id=${mediaAssetId}::uuid and conversation_id=${conversationId}::uuid and status in ('uploading','ready')`;
      if (!media) return response.status(404).json({ ok: false, error: "المرفق غير موجود" });
      await sql`update crm.media_assets set status='ready',updated_at=now() where id=${media.id}::uuid`;
    }

    try {
      const delivery = await deliverCrmMessage({
        conversation,
        text: finalText,
        template,
        media: media ? { storageKey: media.storage_key, mediaType: media.media_type, fileName: media.original_name, mimeType: media.mime_type, fileSize: media.file_size, caption: finalText, isSensitive: media.is_sensitive } : null,
        actor: user,
        senderType: "human",
        reason: "manual",
      });
      if (media && delivery.message?.id) await sql`update crm.media_assets set message_id=${delivery.message.id}::uuid,status='ready',updated_at=now() where id=${media.id}::uuid`;
      await publishAutomationEvent({
        eventKey: `crm-message-sent:${delivery.message?.id || delivery.jobId}`,
        eventType: "message.sent",
        source: conversation.channel_code,
        contactId: conversation.contact_id || null,
        conversationId,
        serviceRequestId: conversation.service_request_id || null,
        leadId: conversation.lead_id || null,
        payload: { direction: "out", senderType: "human", text: finalText, messageId: delivery.message?.id || null, providerStatus: delivery.providerStatus },
        actor: user,
      });
      await audit(user, "message_sent", "conversation", conversationId, {
        channel: delivery.routing?.route || conversation.channel_code,
        source: delivery.routing?.sourceArabic || conversation.source_name,
        providerStatus: delivery.providerStatus,
        templateOnly: delivery.routing?.templateOnly,
      });
      const responseStatus = delivery.providerStatus === "failed" ? 502 : delivery.providerStatus === "pending_confirmation" ? 202 : 201;
      return response.status(responseStatus).json({
        ok: delivery.providerStatus !== "failed",
        message: delivery.message,
        providerStatus: delivery.providerStatus,
        routing: delivery.routing,
        workerRoute: delivery.workerRoute || undefined,
        workerAttempts: delivery.workerAttempts || undefined,
        providerResponse: delivery.providerStatus === "failed" ? delivery.providerResponse : undefined,
        error: delivery.providerStatus === "failed" ? delivery.errorMessage || undefined : undefined,
      });
    } catch (error: any) {
      return response.status(400).json({ ok: false, error: error?.message || "فشل إرسال الرسالة" });
    }
  }

  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
