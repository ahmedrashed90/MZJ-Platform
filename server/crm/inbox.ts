import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, isCrmManager, parseBody, requireCrmUser, userScope, crmLeadScopeSql } from "../_crm-utils.js";
import { classifyConversationService } from "../_crm-lifecycle.js";
import { getSql } from "../_db.js";
import { withMessagingWindow } from "../_crm-window.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();

  if (request.method === "GET") {
    const scope = userScope(user);
    const leadScope = crmLeadScopeSql(sql, scope);
    const manager = isCrmManager(user);
    const state = clean(request.query.state);
    const channel = clean(request.query.channel);
    const search = clean(request.query.search);
    const like = `%${search}%`;

    const rows = await sql<any[]>`
      select
        c.*,c.id::text,c.lead_id::text,c.contact_id::text,c.service_request_id::text,
        ct.display_name as contact_display_name,ct.primary_phone,ct.primary_phone_normalized,
        l.customer_name as lead_customer_name,
        l.assigned_to::text as lead_assigned_to,l.call_center_assigned_to::text as lead_call_center_assigned_to,
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
        and (c.metadata->>'inboxDismissedAt' is null
          or c.last_customer_message_at > (c.metadata->>'inboxDismissedAt')::timestamptz)
        and (${state}='' or c.classification_state=${state})
        and (${channel}='' or c.channel_code=${channel})
        and (${search}='' or concat_ws(' ',c.customer_name,ct.display_name,ct.primary_phone,ct.primary_phone_normalized,c.preview_text) ilike ${like})
        and (
          ${scope.all}::boolean
          or (${manager}::boolean and not ${scope.branchRestricted}::boolean)
          or (${manager}::boolean and ${scope.branchRestricted}::boolean and
              ((l.id is not null and ${leadScope}) or (l.id is null and c.branch_code=any(${scope.branchCodes}::text[]))))
          or (${scope.includeAssigned}::boolean and (c.assigned_to=${user.id}::uuid or c.call_center_assigned_to=${user.id}::uuid))
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
      left join crm.leads l on l.id=c.lead_id and l.is_deleted=false
      where c.service_request_id is null
        and (
          c.classification_state in ('new','awaiting_service')
          or (c.classification_state='closed' and c.last_customer_message_at is not null and c.last_customer_message_at>coalesce(c.closed_at,'epoch'::timestamptz))
        )
        and (c.metadata->>'inboxDismissedAt' is null
          or c.last_customer_message_at > (c.metadata->>'inboxDismissedAt')::timestamptz)
        and (
          ${scope.all}::boolean
          or (${manager}::boolean and not ${scope.branchRestricted}::boolean)
          or (${manager}::boolean and ${scope.branchRestricted}::boolean and ((l.id is not null and ${leadScope}) or (l.id is null and c.branch_code=any(${scope.branchCodes}::text[]))))
          or (${scope.includeAssigned}::boolean and (c.assigned_to=${user.id}::uuid or c.call_center_assigned_to=${user.id}::uuid))
        )
    `;

    return response.status(200).json({ ok: true, rows: rows.map(withMessagingWindow), summary: summary || {}, canClassify: manager });
  }

  if (request.method === "DELETE") {
    // "مسح" removes a stale conversation from this intake queue only. Never
    // delete the conversation, inbound messages, contact or historical lead.
    if (!isCrmManager(user)) return response.status(403).json({ ok:false, error:"مسح الرسائل غير المصنفة متاح للإدارة فقط" });
    const conversationId=clean(request.query.conversationId);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(conversationId)) {
      return response.status(400).json({ ok:false, error:"معرّف المحادثة غير صحيح" });
    }
    const scope=userScope(user);
    const leadScope=crmLeadScopeSql(sql,scope);
    const manager=isCrmManager(user);
    const [allowed]=await sql<any[]>`
      select c.id::text,c.last_customer_message_at from crm.conversations c
      left join crm.leads l on l.id=c.lead_id and l.is_deleted=false
      where c.id=${conversationId}::uuid and c.service_request_id is null
        and (c.classification_state in ('new','awaiting_service')
          or (c.classification_state='closed' and c.last_customer_message_at>coalesce(c.closed_at,'epoch'::timestamptz)))
        and (${scope.all}::boolean
          or (${manager}::boolean and not ${scope.branchRestricted}::boolean)
          or (${manager}::boolean and ${scope.branchRestricted}::boolean and
             ((l.id is not null and ${leadScope}) or (l.id is null and c.branch_code=any(${scope.branchCodes}::text[])))))
      limit 1
    `;
    if (!allowed) return response.status(404).json({ok:false,error:"المحادثة غير موجودة أو خارج صلاحياتك"});
    const [updated]=await sql<any[]>`
      update crm.conversations set
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'inboxDismissedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'inboxDismissedBy',${user.id}::text
        ),updated_at=now()
      where id=${conversationId}::uuid and service_request_id is null
        and (classification_state in ('new','awaiting_service')
          or (classification_state='closed' and last_customer_message_at>coalesce(closed_at,'epoch'::timestamptz)))
        and last_customer_message_at is not distinct from ${allowed.last_customer_message_at||null}::timestamptz
      returning id::text
    `;
    if (!updated) return response.status(409).json({ok:false,error:"وصلت رسالة جديدة أو تم تصنيف المحادثة؛ حدّث القائمة قبل المسح"});
    await audit(user,'dismiss_unclassified_conversation','conversation',conversationId, {removedFromUnclassifiedQueue:true});
    return response.status(200).json({ok:true,dismissed:true});
  }

  if (request.method === "POST") {
    if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "تصنيف الرسائل غير المصنفة متاح للإدارة فقط" });
    const body = parseBody(request);
    const conversationId = clean(body.conversationId);
    const serviceKey = clean(body.serviceKey);
    if (!conversationId || !serviceKey) return response.status(400).json({ ok: false, error: "المحادثة والخدمة مطلوبتان" });
    const scope = userScope(user);
    if (scope.branchRestricted && !scope.all) {
      const leadScope = crmLeadScopeSql(sql, scope);
      const [allowed] = await sql<any[]>`
        select c.id::text from crm.conversations c
        left join crm.leads l on l.id=c.lead_id and l.is_deleted=false
        where c.id=${conversationId}::uuid
          and ((l.id is not null and ${leadScope}) or (l.id is null and c.branch_code=any(${scope.branchCodes}::text[])))
        limit 1
      `;
      if (!allowed) return response.status(403).json({ ok: false, error: "المحادثة ليست ضمن فرعك الحالي" });
    }
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
