import crypto from "node:crypto";
import type { SessionUser } from "./_auth.js";
import {
  branchForDepartment,
  chooseAssignment,
  chooseCallCenterAssignment,
  clean,
  departmentCodeFromKey,
  departmentKey,
  normalizePhone,
  resolveSourceName,
} from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { dispatchAutomaticEntryTemplate } from "./_crm-auto-template.js";

export type ContactIdentityInput = {
  channelCode: string;
  externalId: string;
  participantId?: string;
  pageId?: string;
  phone?: string;
  displayName?: string;
  aliases?: string[];
  metadata?: Record<string, unknown>;
};

function contactKey(phoneNormalized: string, channelCode: string, externalId: string) {
  if (phoneNormalized) return `phone:${phoneNormalized}`;
  return `identity:${channelCode}:${externalId || crypto.randomUUID()}`;
}

function uniqueIdentityValues(input: ContactIdentityInput) {
  return [...new Set([
    input.externalId,
    input.participantId,
    ...(Array.isArray(input.aliases) ? input.aliases : []),
  ].map(clean).filter(Boolean))];
}

async function mergeDuplicateContacts(tx: any, targetId: string, duplicateIds: string[]) {
  const sources = [...new Set(duplicateIds.map(clean).filter((id) => id && id !== targetId))];
  if (!sources.length) return;
  const allIds = [targetId, ...sources];

  const openRequests = await tx<any[]>`
    select id::text,contact_id::text,lead_id::text,conversation_id::text,service_key,department_code,opened_at,updated_at
    from crm.service_requests
    where contact_id=any(${allIds}::uuid[]) and request_state='open'
    order by opened_at desc,updated_at desc
  `;
  const keepOpen = openRequests[0] || null;
  const closeIds = openRequests.slice(1).map((row: any) => row.id);
  if (closeIds.length) {
    await tx`
      update crm.service_requests set request_state='closed',closed_at=coalesce(closed_at,now()),
        closure_reason=coalesce(nullif(closure_reason,''),'دمج جهة اتصال مكررة'),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('mergedIntoContactId',${targetId},'mergedAt',now()),updated_at=now()
      where id=any(${closeIds}::uuid[])
    `;
    await tx`update crm.leads set current_request_id=null,updated_at=now() where current_request_id=any(${closeIds}::uuid[])`;
  }

  for (const sourceId of sources) {
    await tx`update crm.contact_identities set contact_id=${targetId}::uuid,updated_at=now() where contact_id=${sourceId}::uuid`;
    await tx`update crm.leads set contact_id=${targetId}::uuid,updated_at=now() where contact_id=${sourceId}::uuid`;
    await tx`update crm.service_requests set contact_id=${targetId}::uuid,updated_at=now() where contact_id=${sourceId}::uuid`;
    await tx`update crm.conversations set contact_id=${targetId}::uuid,updated_at=now() where contact_id=${sourceId}::uuid`;
    await tx`update crm.ownership_events set contact_id=${targetId}::uuid where contact_id=${sourceId}::uuid`;
    await tx`update crm.automation_events set contact_id=${targetId}::uuid where contact_id=${sourceId}::uuid`;
    await tx`update crm.automation_jobs set contact_id=${targetId}::uuid,updated_at=now() where contact_id=${sourceId}::uuid`;
    await tx`update crm.conversation_automation_inbound_events set contact_id=${targetId}::uuid where contact_id=${sourceId}::uuid`.catch(()=>undefined);
    await tx`update crm.conversation_automation_final_actions set contact_id=${targetId}::uuid where contact_id=${sourceId}::uuid`.catch(()=>undefined);
    await tx`update crm.conversation_automation_sessions set contact_id=${targetId}::uuid,updated_at=now() where contact_id=${sourceId}::uuid`.catch(()=>undefined);
    await tx`delete from crm.contacts where id=${sourceId}::uuid`;
  }

  if (keepOpen) {
    await tx`update crm.service_requests set contact_id=${targetId}::uuid,updated_at=now() where id=${keepOpen.id}::uuid`;
    if (keepOpen.lead_id) await tx`update crm.leads set current_request_id=${keepOpen.id}::uuid,updated_at=now() where id=${keepOpen.lead_id}::uuid`;
  }
}

export async function ensureContactIdentity(input: ContactIdentityInput) {
  const sql = getSql();
  const channelCode = clean(input.channelCode).toLowerCase() || "unknown";
  const externalId = clean(input.externalId);
  if (!externalId) throw new Error("معرف العميل الخارجي مطلوب");
  const phoneNormalized = normalizePhone(input.phone);
  const aliases = uniqueIdentityValues(input);
  const pageId = clean(input.pageId);

  return sql.begin(async (tx) => {
    const identityContacts = aliases.length ? await tx<any[]>`
      select distinct c.*,c.id::text,
        exists(select 1 from crm.service_requests r where r.contact_id=c.id and r.request_state='open') as has_open_request,
        exists(select 1 from crm.leads l where l.contact_id=c.id and l.is_deleted=false) as has_active_lead,
        exists(select 1 from crm.conversations cv where cv.contact_id=c.id) as has_conversation
      from crm.contact_identities i
      join crm.contacts c on c.id=i.contact_id
      where i.channel_code=${channelCode}
        and (i.external_id=any(${aliases}::text[]) or coalesce(i.participant_id,'')=any(${aliases}::text[]))
        and (${pageId || null}::text is null or i.page_id is null or i.page_id=${pageId || null})
      order by has_open_request desc,has_active_lead desc,has_conversation desc,c.updated_at desc
    ` : [];

    let phoneContact: any = null;
    if (phoneNormalized) {
      [phoneContact] = await tx<any[]>`select *,id::text from crm.contacts where primary_phone_normalized=${phoneNormalized} limit 1 for update`;
    }

    const candidateMap = new Map<string, any>();
    for (const row of identityContacts) candidateMap.set(String(row.id), row);
    if (phoneContact) candidateMap.set(String(phoneContact.id), phoneContact);
    const candidates = [...candidateMap.values()];
    let contact: any = phoneContact || candidates[0] || null;

    if (!contact) {
      [contact] = await tx<any[]>`
        insert into crm.contacts(contact_key,display_name,primary_phone,primary_phone_normalized,metadata)
        values (${contactKey(phoneNormalized,channelCode,externalId)},${clean(input.displayName)||"عميل"},${clean(input.phone)||null},${phoneNormalized||null},${tx.json((input.metadata || {}) as any)})
        returning *,id::text
      `;
    } else {
      const duplicateIds = candidates.map((row: any) => String(row.id)).filter((id: string) => id !== String(contact.id));
      await mergeDuplicateContacts(tx, String(contact.id), duplicateIds);
      [contact] = await tx<any[]>`
        update crm.contacts set display_name=case when coalesce(metadata->>'conversationAutomationCustomerNameLocked','false')='true' then display_name else coalesce(nullif(${clean(input.displayName)},''),display_name) end,
          primary_phone=coalesce(nullif(${clean(input.phone)},''),primary_phone),
          primary_phone_normalized=coalesce(nullif(${phoneNormalized},''),primary_phone_normalized),
          metadata=coalesce(metadata,'{}'::jsonb)||${tx.json((input.metadata || {}) as any)}::jsonb,updated_at=now()
        where id=${contact.id}::uuid returning *,id::text
      `;
    }

    let savedIdentity: any = null;
    for (const alias of aliases) {
      const [row] = await tx<any[]>`
        insert into crm.contact_identities(contact_id,channel_code,external_id,participant_id,page_id,display_name,metadata)
        values (${contact.id}::uuid,${channelCode},${alias},${clean(input.participantId)||alias},${pageId||null},${clean(input.displayName)||null},${tx.json((input.metadata || {}) as any)})
        on conflict(channel_code,external_id) do update set
          contact_id=excluded.contact_id,participant_id=coalesce(nullif(excluded.participant_id,''),crm.contact_identities.participant_id),
          page_id=coalesce(nullif(excluded.page_id,''),crm.contact_identities.page_id),display_name=coalesce(nullif(excluded.display_name,''),crm.contact_identities.display_name),
          metadata=coalesce(crm.contact_identities.metadata,'{}'::jsonb)||excluded.metadata,updated_at=now()
        returning *,id::text,contact_id::text
      `;
      if (alias === externalId || !savedIdentity) savedIdentity = row;
    }

    return { contact, identity: savedIdentity };
  });
}

export async function findOpenServiceRequest(contactId: string, db?: any) {
  const sql = db || getSql();
  const [row] = await sql<any[]>`
    select r.*,r.id::text,r.contact_id::text,r.lead_id::text,r.conversation_id::text,r.assigned_to::text,r.call_center_assigned_to::text,
      sales.full_name as assigned_name,cc.full_name as call_center_name
    from crm.service_requests r
    join crm.leads l on l.id=r.lead_id and l.is_deleted=false
    left join core.users sales on sales.id=r.assigned_to
    left join core.users cc on cc.id=r.call_center_assigned_to
    where r.contact_id=${contactId}::uuid and r.request_state='open'
    order by r.opened_at desc limit 1
  `;
  return row || null;
}

async function ensureLeadForContact(input: {
  contactId: string; displayName: string; phone: string; phoneNormalized: string;
  sourceCode: string; sourceName: string; platformCode: string;
}, db?: any) {
  const sql = db || getSql();
  const [existing] = await sql<any[]>`
    select *,id::text,assigned_to::text,call_center_assigned_to::text from crm.leads
    where contact_id=${input.contactId}::uuid and is_deleted=false order by created_at limit 1
  `;
  if (existing) return existing;
  const [lead] = await sql<any[]>`
    insert into crm.leads(
      contact_id,customer_name,phone,phone_normalized,source_code,source_name,platform_code,service_key,department_code,
      status_label,payment_type,registered_at,source_history,extra_data,completion_percent
    ) values (
      ${input.contactId}::uuid,${input.displayName||"عميل"},${input.phone||input.phoneNormalized},${input.phoneNormalized||null},
      ${input.sourceCode},${input.sourceName},${input.platformCode},'cash','cash_sales','عميل جديد','كاش',now(),
      ${sql.json([{ source: input.sourceCode, at: new Date().toISOString() }])},jsonb_build_object('contactModel',true),0
    ) returning *,id::text
  `;
  return lead;
}

export async function recordOwnershipEvent(input: {
  contactId?: string | null; requestId?: string | null; leadId?: string | null;
  previousAssignedTo?: string | null; previousAssignedName?: string | null;
  newAssignedTo?: string | null; newAssignedName?: string | null;
  previousDepartmentCode?: string | null; newDepartmentCode?: string | null;
  previousBranchCode?: string | null; newBranchCode?: string | null;
  actor?: SessionUser | null; actorType?: string; reason?: string; metadata?: Record<string,unknown>;
}, db?: any) {
  const sql = db || getSql();
  await sql`
    insert into crm.ownership_events(
      contact_id,service_request_id,lead_id,previous_assigned_to,previous_assigned_name,new_assigned_to,new_assigned_name,
      previous_department_code,new_department_code,previous_branch_code,new_branch_code,actor_id,actor_name,actor_type,reason,metadata
    ) values (
      ${input.contactId||null}::uuid,${input.requestId||null}::uuid,${input.leadId||null}::uuid,
      ${input.previousAssignedTo||null}::uuid,${input.previousAssignedName||null},${input.newAssignedTo||null}::uuid,${input.newAssignedName||null},
      ${input.previousDepartmentCode||null},${input.newDepartmentCode||null},${input.previousBranchCode||null},${input.newBranchCode||null},
      ${input.actor?.id||null}::uuid,${input.actor?.fullName||"Automation Engine"},${input.actorType||"automation"},${input.reason||null},${sql.json((input.metadata || {}) as any)}
    )
  `;
}

export async function classifyConversationService(input: {
  conversationId: string; serviceKey: string; sourceCode?: string; classificationMethod: string;
  actor?: SessionUser | null; eventKey?: string;
  branchCode?: string | null;
  assignPrimary?: boolean;
  assignCallCenter?: boolean;
  suppressAutomaticTemplate?: boolean;
  db?: any;
}) {
  const sql = input.db || getSql();
  const serviceKey = departmentKey(input.serviceKey);
  const [conversation] = await sql<any[]>`
    select c.*,c.id::text,c.contact_id::text,c.lead_id::text,c.service_request_id::text,
      ct.display_name,ct.primary_phone,ct.primary_phone_normalized
    from crm.conversations c join crm.contacts ct on ct.id=c.contact_id
    where c.id=${input.conversationId}::uuid limit 1
  `;
  if (!conversation) throw new Error("المحادثة غير موجودة");

  const existing = await findOpenServiceRequest(conversation.contact_id, sql);
  const existingServiceKey = existing ? departmentKey(existing.service_key || existing.department_code) : "";

  // Selecting the same service must not create another request. It only completes a
  // missing assignment, then keeps the current request, lead and conversation linked.
  if (existing && existingServiceKey === serviceKey) {
    let activeRequest = existing;
    const primaryAllowed = input.assignPrimary !== false;
    const callCenterAllowed = existingServiceKey === "finance" && input.assignCallCenter !== false;
    const primaryMissing = primaryAllowed && !existing.assigned_to;
    const callCenterMissing = callCenterAllowed && !existing.call_center_assigned_to;
    if (primaryMissing || callCenterMissing) {
      const requestedBranch = clean(input.branchCode) || existing.branch_code || branchForDepartment(existingServiceKey);
      const assignment = primaryMissing
        ? await chooseAssignment(existingServiceKey, requestedBranch, existing.source_code || conversation.channel_code || "whatsapp", sql)
        : { assignedTo: existing.assigned_to || null, assignedName: existing.assigned_name || "", branchCode: requestedBranch };
      const callCenter = callCenterMissing
        ? await chooseCallCenterAssignment(existing.source_code || conversation.channel_code || "whatsapp", requestedBranch || "online", sql)
        : { assignedTo: existing.call_center_assigned_to || null, assignedName: existing.call_center_name || "" };
      const branchCode = assignment.branchCode || requestedBranch || null;
      const [updatedRequest] = await sql<any[]>`
        update crm.service_requests set assigned_to=${assignment.assignedTo}::uuid,call_center_assigned_to=${callCenter.assignedTo}::uuid,
          branch_code=${branchCode},updated_at=now()
        where id=${existing.id}::uuid and request_state='open'
        returning *,id::text,contact_id::text,lead_id::text,conversation_id::text,assigned_to::text,call_center_assigned_to::text
      `;
      activeRequest = { ...existing, ...updatedRequest, assigned_name: assignment.assignedName, call_center_name: callCenter.assignedName };
      if (existing.lead_id) {
        await sql`
          update crm.leads set assigned_to=${assignment.assignedTo}::uuid,call_center_assigned_to=${callCenter.assignedTo}::uuid,
            branch_code=${branchCode},responsible_name_snapshot=${assignment.assignedName||null},call_center_name_snapshot=${callCenter.assignedName||null},updated_at=now()
          where id=${existing.lead_id}::uuid and is_deleted=false
        `;
      }
      await recordOwnershipEvent({
        contactId: conversation.contact_id, requestId: existing.id, leadId: existing.lead_id,
        previousAssignedTo: null, previousAssignedName: "غير موزع",
        newAssignedTo: assignment.assignedTo, newAssignedName: assignment.assignedName,
        previousDepartmentCode: existing.department_code, newDepartmentCode: existing.department_code,
        previousBranchCode: existing.branch_code, newBranchCode: branchCode,
        actor: input.actor, actorType: input.actor ? "user" : "automation", reason: "استكمال توزيع طلب خدمة مفتوح غير موزع",
        metadata: { reusedRequest: true, callCenterAssignedTo: callCenter.assignedTo, callCenterName: callCenter.assignedName },
      }, sql);
    }
    await sql`
      update crm.conversations set service_request_id=${activeRequest.id}::uuid,lead_id=${activeRequest.lead_id||null}::uuid,
        service_key=${activeRequest.service_key},department_code=${activeRequest.department_code},branch_code=${activeRequest.branch_code},
        assigned_to=${activeRequest.assigned_to||null}::uuid,call_center_assigned_to=${activeRequest.call_center_assigned_to||null}::uuid,
        classification_state='classified',closed_at=null,updated_at=now() where id=${conversation.id}::uuid
    `;
    return { request: activeRequest, leadId: activeRequest.lead_id, reused: true, reclassified: false };
  }

  const sourceCode = clean(input.sourceCode || conversation.channel_code || "whatsapp");
  const sourceName = await resolveSourceName(sourceCode, "", sql);
  const requestedBranch = clean(input.branchCode) || branchForDepartment(serviceKey);
  const primaryAllowed = input.assignPrimary !== false;
  const callCenterAllowed = serviceKey === "finance" && input.assignCallCenter !== false;
  const assignment = primaryAllowed
    ? await chooseAssignment(serviceKey, requestedBranch, sourceCode, sql)
    : { assignedTo: null, assignedName: "", branchCode: requestedBranch };
  const callCenter = callCenterAllowed
    ? await chooseCallCenterAssignment(sourceCode, requestedBranch || "online", sql)
    : { assignedTo: null, assignedName: "" };
  const departmentCode = departmentCodeFromKey(serviceKey);
  const branchCode = assignment.branchCode || requestedBranch || null;
  const lead = await ensureLeadForContact({
    contactId: conversation.contact_id, displayName: conversation.display_name || conversation.customer_name || "عميل",
    phone: conversation.primary_phone || "", phoneNormalized: conversation.primary_phone_normalized || "",
    sourceCode, sourceName, platformCode: conversation.channel_code || sourceCode,
  }, sql);

  // A different explicit selection ends only the current service request. The customer,
  // lead, messages and history remain; a fresh request is then distributed to the new
  // department according to its own assignment rules.
  if (existing && existingServiceKey !== serviceKey) {
    await sql`
      update crm.service_requests set request_state='closed',closed_at=now(),closed_by=${input.actor?.id||null}::uuid,
        closure_reason='العميل اختار قسمًا آخر',
        metadata=coalesce(metadata,'{}'::jsonb)||${sql.json({
          reclassifiedTo: serviceKey,
          reclassifiedToDepartment: departmentCode,
          reclassificationEventKey: input.eventKey || null,
        })}::jsonb,
        updated_at=now()
      where id=${existing.id}::uuid and request_state='open'
    `;
    await sql`
      insert into crm.lead_events(lead_id,event_type,old_status,new_status,old_department,new_department,old_branch,new_branch,actor_id,actor_name,note,details)
      values (${lead.id}::uuid,'service_request_reclassified',${existing.status_label||"عميل جديد"},'عميل جديد',${existing.department_code||null},${departmentCode},
        ${existing.branch_code||null},${branchCode},${input.actor?.id||null}::uuid,${input.actor?.fullName||"Automation Engine"},
        'غيّر العميل القسم المطلوب وتم إغلاق الطلب السابق وإعادة التوزيع',${sql.json({
          previousRequestId: existing.id,
          previousServiceKey: existingServiceKey,
          newServiceKey: serviceKey,
          eventKey: input.eventKey || null,
        })})
    `;
  }

  const [request] = await sql<any[]>`
    insert into crm.service_requests(
      contact_id,lead_id,conversation_id,service_key,department_code,branch_code,status_label,request_state,source_code,
      classification_method,assigned_to,call_center_assigned_to,metadata
    ) values (
      ${conversation.contact_id}::uuid,${lead.id}::uuid,${conversation.id}::uuid,${serviceKey},${departmentCode},${branchCode},'عميل جديد','open',
      ${sourceCode},${input.classificationMethod},${assignment.assignedTo}::uuid,${callCenter.assignedTo}::uuid,${sql.json({
        eventKey: input.eventKey || null,
        previousRequestId: existing?.id || null,
        reclassifiedFrom: existingServiceKey || null,
      })}
    ) returning *,id::text,contact_id::text,lead_id::text,conversation_id::text,assigned_to::text,call_center_assigned_to::text
  `;
  await sql`
    update crm.leads set contact_id=${conversation.contact_id}::uuid,current_request_id=${request.id}::uuid,service_key=${serviceKey},
      department_code=${departmentCode},branch_code=${branchCode},status_label='عميل جديد',status_code=null,
      payment_type=${serviceKey === "finance" ? "تمويل" : serviceKey === "service" ? "خدمة عملاء" : "كاش"},
      source_code=${sourceCode},source_name=${sourceName},platform_code=${conversation.channel_code || sourceCode},
      assigned_to=${assignment.assignedTo}::uuid,call_center_assigned_to=${callCenter.assignedTo}::uuid,
      unread_count=greatest(coalesce(unread_count,0),${Number(conversation.unread_count||0)}),
      dashboard_unread=${Number(conversation.unread_count||0)>0},has_unread_message=${Number(conversation.unread_count||0)>0},has_unread_messages=${Number(conversation.unread_count||0)>0},
      last_incoming_message_at=coalesce(${conversation.last_customer_message_at||null}::timestamptz,last_incoming_message_at),last_message_at=greatest(coalesce(last_message_at,'epoch'),coalesce(${conversation.last_message_at||null}::timestamptz,'epoch')),
      responsible_name_snapshot=${assignment.assignedName||null},call_center_name_snapshot=${callCenter.assignedName||null},updated_at=now()
    where id=${lead.id}::uuid
  `;
  await sql`
    update crm.conversations set lead_id=${lead.id}::uuid,service_request_id=${request.id}::uuid,service_key=${serviceKey},
      department_code=${departmentCode},branch_code=${branchCode},assigned_to=${assignment.assignedTo}::uuid,
      call_center_assigned_to=${callCenter.assignedTo}::uuid,classification_state='classified',closed_at=null,updated_at=now()
    where id=${conversation.id}::uuid
  `;
  await sql`
    insert into crm.lead_events(lead_id,event_type,new_status,new_department,new_branch,actor_id,actor_name,note,details)
    values (${lead.id}::uuid,'service_request_created','عميل جديد',${departmentCode},${branchCode},${input.actor?.id||null}::uuid,
      ${input.actor?.fullName||"Automation Engine"},${existing ? 'تم إنشاء طلب خدمة جديد بعد تغيير القسم' : 'تم إنشاء طلب خدمة وتصنيف المحادثة'},
      ${sql.json({ requestId: request.id, classificationMethod: input.classificationMethod, eventKey: input.eventKey || null, previousRequestId: existing?.id || null })})
  `;
  await recordOwnershipEvent({
    contactId: conversation.contact_id, requestId: request.id, leadId: lead.id,
    previousAssignedTo: existing?.assigned_to || null, previousAssignedName: existing?.assigned_name || null,
    newAssignedTo: assignment.assignedTo, newAssignedName: assignment.assignedName,
    previousDepartmentCode: existing?.department_code || null, newDepartmentCode: departmentCode,
    previousBranchCode: existing?.branch_code || null, newBranchCode: branchCode,
    actor: input.actor, actorType: input.actor ? "user" : "automation",
    reason: existing ? "إعادة توزيع بعد اختيار قسم جديد" : "توزيع طلب خدمة جديد",
    metadata: {
      classificationMethod: input.classificationMethod,
      previousRequestId: existing?.id || null,
      previousServiceKey: existingServiceKey || null,
      callCenterAssignedTo: callCenter.assignedTo,
      callCenterName: callCenter.assignedName,
    },
  }, sql);
  const automaticTemplate = input.suppressAutomaticTemplate
    ? { attempted: false, reason: "suppressed_by_conversation_automation" }
    : await dispatchAutomaticEntryTemplate({
    contactId: conversation.contact_id,
    conversationId: conversation.id,
    serviceRequestId: request.id,
    leadId: lead.id,
    serviceKey,
    callCenterAssignedTo: request.call_center_assigned_to || callCenter.assignedTo || null,
  });
  return { request, leadId: lead.id, reused: false, reclassified: Boolean(existing), assignment, callCenter, automaticTemplate };
}

export async function closeCurrentServiceRequest(input: { leadId: string; statusLabel: string; actor?: SessionUser | null; reason?: string }) {
  const sql = getSql();
  const [settings] = await sql<any[]>`select closed_statuses from crm.automation_settings where id='default'`;
  const [lead] = await sql<any[]>`select *,id::text,current_request_id::text from crm.leads where id=${input.leadId}::uuid`;
  if (!lead?.current_request_id) return { closed: false, reason: "no_open_request" };
  const key = departmentKey(lead.service_key || lead.department_code);
  const closedStatuses = Array.isArray(settings?.closed_statuses?.[key]) ? settings.closed_statuses[key].map(clean) : [];
  if (!closedStatuses.includes(clean(input.statusLabel))) return { closed: false, reason: "status_not_final" };
  const [request] = await sql<any[]>`
    update crm.service_requests set request_state='closed',status_label=${input.statusLabel},closed_at=now(),closed_by=${input.actor?.id||null}::uuid,
      closure_reason=${input.reason||input.statusLabel},updated_at=now()
    where id=${lead.current_request_id}::uuid and request_state='open' returning *,id::text,contact_id::text,lead_id::text
  `;
  if (!request) return { closed: false, reason: "already_closed" };
  await sql`update crm.leads set current_request_id=null,updated_at=now() where id=${lead.id}::uuid`;
  await sql`
    update crm.conversations set service_request_id=null,classification_state='closed',service_selection_sent_at=null,closed_at=now(),updated_at=now()
    where service_request_id=${request.id}::uuid
  `;
  return { closed: true, request };
}

export async function attachLeadToContactAndOpenRequest(input: { leadId: string; actor?: SessionUser | null; classificationMethod?: string }) {
  const sql = getSql();
  const [lead] = await sql<any[]>`
    select l.*,l.id::text,l.contact_id::text,l.current_request_id::text,l.assigned_to::text,l.call_center_assigned_to::text,
      sales.full_name as assigned_name,cc.full_name as call_center_name
    from crm.leads l
    left join core.users sales on sales.id=l.assigned_to
    left join core.users cc on cc.id=l.call_center_assigned_to
    where l.id=${input.leadId}::uuid and l.is_deleted=false limit 1
  `;
  if (!lead) throw new Error("العميل غير موجود");
  const { contact } = await ensureContactIdentity({
    channelCode: "crm_manual",
    externalId: `lead:${lead.id}`,
    participantId: lead.phone_normalized || lead.phone || lead.id,
    phone: lead.phone || lead.phone_normalized || "",
    displayName: lead.customer_name || "عميل",
    metadata: { leadId: lead.id, origin: "crm" },
  });
  let request = await findOpenServiceRequest(contact.id);
  const serviceKey = departmentKey(lead.service_key || lead.department_code);
  const departmentCode = departmentCodeFromKey(serviceKey);
  const branchCode = lead.branch_code || branchForDepartment(serviceKey) || null;
  let [conversation] = await sql<any[]>`select *,id::text from crm.conversations where legacy_id=${`crm-manual:${lead.id}`} limit 1`;
  if (!conversation) {
    [conversation] = await sql<any[]>`
      insert into crm.conversations(legacy_id,lead_id,contact_id,service_request_id,channel_code,customer_name,assigned_to,call_center_assigned_to,
        service_key,department_code,branch_code,classification_state,metadata)
      values(${`crm-manual:${lead.id}`},${lead.id}::uuid,${contact.id}::uuid,${request?.id||null}::uuid,'whatsapp',${lead.customer_name||"عميل"},
        ${lead.assigned_to||null}::uuid,${lead.call_center_assigned_to||null}::uuid,${serviceKey},${departmentCode},${branchCode},'classified',${sql.json({manualEntry:true,sourceCode:lead.source_code||"branch"})})
      returning *,id::text
    `;
  }
  if (!request) {
    [request] = await sql<any[]>`
      insert into crm.service_requests(contact_id,lead_id,conversation_id,service_key,department_code,branch_code,status_label,request_state,source_code,
        classification_method,assigned_to,call_center_assigned_to,metadata)
      values(${contact.id}::uuid,${lead.id}::uuid,${conversation.id}::uuid,${serviceKey},${departmentCode},${branchCode},${lead.status_label||"عميل جديد"},'open',
        ${lead.source_code||"branch"},${input.classificationMethod||"manual"},${lead.assigned_to||null}::uuid,${lead.call_center_assigned_to||null}::uuid,${sql.json({createdFromLead:true})})
      returning *,id::text,contact_id::text,lead_id::text,conversation_id::text,assigned_to::text,call_center_assigned_to::text
    `;
    await recordOwnershipEvent({
      contactId: contact.id, requestId: request.id, leadId: lead.id,
      newAssignedTo: lead.assigned_to, newAssignedName: lead.assigned_name,
      newDepartmentCode: departmentCode, newBranchCode: branchCode,
      actor: input.actor, actorType: input.actor ? "user" : "automation", reason: "إنشاء طلب عميل من داخل CRM",
      metadata: { classificationMethod: input.classificationMethod || "manual" },
    });
  }
  await sql`update crm.leads set contact_id=${contact.id}::uuid,current_request_id=${request.id}::uuid,updated_at=now() where id=${lead.id}::uuid`;
  await sql`update crm.conversations set lead_id=${lead.id}::uuid,contact_id=${contact.id}::uuid,service_request_id=${request.id}::uuid,
    service_key=${serviceKey},department_code=${departmentCode},branch_code=${branchCode},assigned_to=${lead.assigned_to||null}::uuid,
    call_center_assigned_to=${lead.call_center_assigned_to||null}::uuid,classification_state='classified',updated_at=now() where id=${conversation.id}::uuid`;
  await sql`update crm.service_requests set conversation_id=coalesce(conversation_id,${conversation.id}::uuid),lead_id=${lead.id}::uuid,updated_at=now() where id=${request.id}::uuid`;
  return { contact, request, conversation };
}
