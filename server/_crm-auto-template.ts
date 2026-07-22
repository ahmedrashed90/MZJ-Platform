import { clean, departmentKey } from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { deliverCrmMessage, renderCrmTemplate, type ConversationContext, type TemplateRow } from "./_crm-messaging.js";

const TEMPLATE_NAME = "finance_request_received";

type EntryTemplateReason = "cash_total_customers" | "finance_call_center";

function reasonFor(serviceKey: string): EntryTemplateReason | "" {
  const key = departmentKey(serviceKey);
  if (key === "cash") return "cash_total_customers";
  if (key === "finance") return "finance_call_center";
  return "";
}

export async function dispatchAutomaticEntryTemplate(input: {
  contactId: string;
  conversationId: string;
  serviceRequestId: string;
  leadId: string;
  serviceKey: string;
  callCenterAssignedTo?: string | null;
}) {
  const sql = getSql();
  const reason = reasonFor(input.serviceKey);
  if (!reason) return { attempted: false, reason: "unsupported_service" };
  if (reason === "finance_call_center" && !clean(input.callCenterAssignedTo)) {
    return { attempted: false, reason: "finance_not_assigned_to_call_center" };
  }

  const [settings] = await sql<any[]>`
    select cash_total_customers_template_enabled,finance_call_center_template_enabled
    from crm.automation_settings where id='default'
  `;
  const enabled = reason === "cash_total_customers"
    ? settings?.cash_total_customers_template_enabled === true
    : settings?.finance_call_center_template_enabled === true;
  if (!enabled) return { attempted: false, reason: "disabled" };

  const [dispatch] = await sql<any[]>`
    insert into crm.automatic_template_dispatches(
      contact_id,lead_id,conversation_id,service_request_id,template_name,reason,status
    ) values(
      ${input.contactId}::uuid,${input.leadId}::uuid,${input.conversationId}::uuid,${input.serviceRequestId}::uuid,
      ${TEMPLATE_NAME},${reason},'pending'
    )
    on conflict(service_request_id,template_name,reason) do nothing
    returning *,id::text
  `;
  if (!dispatch) {
    const [existing] = await sql<any[]>`
      select *,id::text,outbound_job_id::text,message_id::text
      from crm.automatic_template_dispatches
      where service_request_id=${input.serviceRequestId}::uuid and template_name=${TEMPLATE_NAME} and reason=${reason}
      limit 1
    `;
    return { attempted: false, reason: "already_claimed", dispatch: existing || null };
  }

  try {
    const [template] = await sql<any[]>`
      select *,id::text
      from crm.message_templates
      where is_active=true and (
        lower(coalesce(name,''))=lower(${TEMPLATE_NAME}) or
        lower(coalesce(external_id,''))=lower(${TEMPLATE_NAME})
      )
      order by (provider='mersal') desc,updated_at desc
      limit 1
    `;
    if (!template) throw new Error(`القالب ${TEMPLATE_NAME} غير موجود أو غير نشط`);

    const [conversation] = await sql<any[]>`
      select c.*,c.id::text,c.lead_id::text,c.contact_id::text,c.service_request_id::text,
        l.phone,l.phone_normalized,l.customer_name as lead_customer_name,l.car_name,l.status_label,
        l.source_code,l.source_name,l.platform_code,l.service_key
      from crm.conversations c
      left join crm.leads l on l.id=c.lead_id
      where c.id=${input.conversationId}::uuid
      limit 1
    `;
    if (!conversation) throw new Error("المحادثة غير موجودة بعد إنشاء طلب الخدمة");

    const renderedText = renderCrmTemplate(clean(template.content), conversation as ConversationContext);
    if (/{{\s*[^}]+\s*}}/.test(renderedText)) {
      throw new Error(`القالب ${TEMPLATE_NAME} يحتوي على متغيرات غير مكتملة ولا يمكن إرساله تلقائيًا`);
    }
    const result = await deliverCrmMessage({
      conversation: conversation as ConversationContext,
      template: template as TemplateRow,
      text: renderedText,
      senderType: "system",
      reason,
      automaticDispatchId: dispatch.id,
      idempotencyKey: `crm:auto-template:${input.serviceRequestId}:${TEMPLATE_NAME}:${reason}`,
    });

    const status = result.providerStatus === "sent" ? "sent" : result.providerStatus === "failed" ? "failed" : "queued";
    await sql`
      update crm.automatic_template_dispatches set
        status=${status},outbound_job_id=${result.jobId||null}::uuid,message_id=${result.message?.id||null}::uuid,
        error_message=${result.errorMessage||null},
        sent_at=case when ${status}='sent' then now() else sent_at end,
        failed_at=case when ${status}='failed' then now() else failed_at end,
        updated_at=now()
      where id=${dispatch.id}::uuid
    `;
    return { attempted: true, status, dispatchId: dispatch.id, jobId: result.jobId };
  } catch (error: any) {
    const message = clean(error?.message || error) || "تعذر تجهيز الإرسال التلقائي";
    await sql`
      update crm.automatic_template_dispatches set status='failed',error_message=${message},failed_at=now(),updated_at=now()
      where id=${dispatch.id}::uuid
    `;
    return { attempted: true, status: "failed", dispatchId: dispatch.id, error: message };
  }
}
