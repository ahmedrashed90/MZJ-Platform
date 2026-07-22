import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, hasAnyRole, normalizePhone, parseBody, positiveInt, requireCrmUser, sourceLabel, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";

function scopeSql(scope: ReturnType<typeof userScope>, userId: string) {
  return {
    all: scope.all,
    callCenterOnly: scope.callCenterOnly,
    userId,
    departmentCodes: scope.departmentCodes,
    branchCodes: scope.branchCodes,
  };
}

function canPurgeContact(user: any) {
  return hasAnyRole(user, ["admin", "sales_manager"]);
}

async function canAccessContact(contactId: string, user: any) {
  const sql = getSql();
  const scope = scopeSql(userScope(user), user.id);
  const [row] = await sql<{ allowed: boolean }[]>`
    select exists(
      select 1
      from crm.contacts c
      where c.id=${contactId}::uuid
        and (
          ${scope.all}::boolean
          or exists (
            select 1 from crm.leads l
            where l.contact_id=c.id and l.is_deleted=false
              and (
                (${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
                or (not ${scope.callCenterOnly}::boolean and (l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
                or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
              )
          )
          or exists (
            select 1 from crm.conversations cv
            where cv.contact_id=c.id and (cv.assigned_to=${scope.userId}::uuid or cv.call_center_assigned_to=${scope.userId}::uuid)
          )
        )
    ) as allowed
  `;
  return Boolean(row?.allowed);
}

async function listContacts(request: VercelRequest, response: VercelResponse, user: any) {
  const sql = getSql();
  const scope = scopeSql(userScope(user), user.id);
  const q = clean(request.query.q);
  const limit = positiveInt(request.query.limit, 60, 200);
  const offset = Math.max(0, Number(request.query.offset || 0) || 0);
  const like = q ? `%${q}%` : null;

  const rows = await sql<any[]>`
    select
      c.id::text,c.display_name,c.primary_phone,c.primary_phone_normalized,c.is_active,c.metadata,c.created_at,c.updated_at,
      coalesce(stats.leads_count,0)::int as leads_count,
      coalesce(stats.requests_count,0)::int as requests_count,
      coalesce(stats.open_requests_count,0)::int as open_requests_count,
      coalesce(stats.conversations_count,0)::int as conversations_count,
      latest.id::text as latest_lead_id,latest.customer_name,latest.status_label,latest.department_code,latest.branch_code,
      latest.service_key,latest.source_code,latest.source_name,latest.notes,latest.assigned_to::text,latest.call_center_assigned_to::text,
      sales.full_name as assigned_name,cc.full_name as call_center_name,
      activity.last_activity_at
    from crm.contacts c
    left join lateral (
      select
        count(*) filter(where l.is_deleted=false)::int as leads_count,
        (select count(*) from crm.service_requests r where r.contact_id=c.id)::int as requests_count,
        (select count(*) from crm.service_requests r where r.contact_id=c.id and r.request_state='open')::int as open_requests_count,
        (select count(*) from crm.conversations cv where cv.contact_id=c.id)::int as conversations_count
      from crm.leads l where l.contact_id=c.id
    ) stats on true
    left join lateral (
      select l.* from crm.leads l
      where l.contact_id=c.id and l.is_deleted=false
      order by coalesce(l.updated_at,l.created_at) desc limit 1
    ) latest on true
    left join core.users sales on sales.id=latest.assigned_to
    left join core.users cc on cc.id=latest.call_center_assigned_to
    left join lateral (
      select greatest(
        coalesce((select max(coalesce(l.updated_at,l.created_at)) from crm.leads l where l.contact_id=c.id),'epoch'::timestamptz),
        coalesce((select max(coalesce(r.updated_at,r.created_at)) from crm.service_requests r where r.contact_id=c.id),'epoch'::timestamptz),
        coalesce((select max(coalesce(cv.last_message_at,cv.updated_at,cv.created_at)) from crm.conversations cv where cv.contact_id=c.id),'epoch'::timestamptz)
      ) as last_activity_at
    ) activity on true
    where (
      ${scope.all}::boolean
      or exists (
        select 1 from crm.leads l
        where l.contact_id=c.id and l.is_deleted=false
          and (
            (${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
            or (not ${scope.callCenterOnly}::boolean and (l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
            or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
          )
      )
      or exists (
        select 1 from crm.conversations cv
        where cv.contact_id=c.id and (cv.assigned_to=${scope.userId}::uuid or cv.call_center_assigned_to=${scope.userId}::uuid)
      )
    )
      and (${like}::text is null or concat_ws(' ',c.display_name,c.primary_phone,c.primary_phone_normalized,latest.customer_name,latest.status_label,latest.notes) ilike ${like})
    order by activity.last_activity_at desc,c.updated_at desc
    limit ${limit} offset ${offset}
  `;

  const [count] = await sql<{ total: number }[]>`
    select count(*)::int as total from crm.contacts c
    where (
      ${scope.all}::boolean
      or exists (
        select 1 from crm.leads l
        where l.contact_id=c.id and l.is_deleted=false
          and (
            (${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
            or (not ${scope.callCenterOnly}::boolean and (l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
            or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
          )
      )
      or exists (
        select 1 from crm.conversations cv
        where cv.contact_id=c.id and (cv.assigned_to=${scope.userId}::uuid or cv.call_center_assigned_to=${scope.userId}::uuid)
      )
    )
      and (${like}::text is null or concat_ws(' ',c.display_name,c.primary_phone,c.primary_phone_normalized) ilike ${like})
  `;

  const [summary] = await sql<any[]>`
    select
      count(*)::int as total_contacts,
      count(*) filter(where exists(select 1 from crm.service_requests r where r.contact_id=c.id and r.request_state='open'))::int as open_contacts,
      count(*) filter(where exists(select 1 from crm.service_requests r where r.contact_id=c.id and r.request_state='closed'))::int as completed_contacts,
      count(*) filter(where exists(select 1 from crm.conversations cv where cv.contact_id=c.id))::int as contacts_with_conversations
    from crm.contacts c
    where ${scope.all}::boolean or exists(
      select 1 from crm.leads l where l.contact_id=c.id and l.is_deleted=false and (
        (${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
        or (not ${scope.callCenterOnly}::boolean and (l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
        or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
      )
    )
  `;

  for (const row of rows) row.source_name = sourceLabel(row.source_code, row.source_name);
  return response.status(200).json({ ok: true, rows, total: Number(count?.total || 0), limit, offset, summary: summary || {}, canPurge: canPurgeContact(user) });
}

async function contactProfile(request: VercelRequest, response: VercelResponse, user: any, id: string) {
  if (!(await canAccessContact(id, user))) return response.status(404).json({ ok: false, error: "جهة الاتصال غير موجودة أو لا توجد صلاحية لعرضها" });
  const sql = getSql();
  const [contact] = await sql<any[]>`select *,id::text from crm.contacts where id=${id}::uuid limit 1`;
  if (!contact) return response.status(404).json({ ok: false, error: "جهة الاتصال غير موجودة" });

  const [identities, leads, requests, conversations, messages, events, ownership] = await Promise.all([
    sql<any[]>`select id::text,channel_code,external_id,participant_id,page_id,display_name,metadata,created_at,updated_at from crm.contact_identities where contact_id=${id}::uuid order by updated_at desc`,
    sql<any[]>`
      select l.*,l.id::text,l.contact_id::text,l.current_request_id::text,l.assigned_to::text,l.call_center_assigned_to::text,
        sales.full_name as assigned_name,cc.full_name as call_center_name,b.name as branch_name,src.name as catalog_source_name
      from crm.leads l
      left join core.users sales on sales.id=l.assigned_to
      left join core.users cc on cc.id=l.call_center_assigned_to
      left join core.branches b on b.code=l.branch_code
      left join core.sources src on src.code=l.source_code
      where l.contact_id=${id}::uuid
      order by l.is_deleted asc,coalesce(l.updated_at,l.created_at) desc
    `,
    sql<any[]>`
      select r.*,r.id::text,r.lead_id::text,r.conversation_id::text,r.assigned_to::text,r.call_center_assigned_to::text,
        sales.full_name as assigned_name,cc.full_name as call_center_name,b.name as branch_name
      from crm.service_requests r
      left join core.users sales on sales.id=r.assigned_to
      left join core.users cc on cc.id=r.call_center_assigned_to
      left join core.branches b on b.code=r.branch_code
      where r.contact_id=${id}::uuid order by r.opened_at desc
    `,
    sql<any[]>`
      select c.*,c.id::text,c.lead_id::text,c.service_request_id::text,c.assigned_to::text,c.call_center_assigned_to::text,
        sales.full_name as assigned_name,cc.full_name as call_center_name
      from crm.conversations c
      left join core.users sales on sales.id=c.assigned_to
      left join core.users cc on cc.id=c.call_center_assigned_to
      where c.contact_id=${id}::uuid order by coalesce(c.last_message_at,c.updated_at,c.created_at) desc
    `,
    sql<any[]>`
      select m.*,m.id::text,m.conversation_id::text,u.full_name as sent_by_name
      from crm.messages m
      join crm.conversations c on c.id=m.conversation_id
      left join core.users u on u.id=m.sent_by
      where c.contact_id=${id}::uuid
      order by m.created_at desc limit 200
    `,
    sql<any[]>`
      select e.*,e.id::text,e.lead_id::text
      from crm.lead_events e join crm.leads l on l.id=e.lead_id
      where l.contact_id=${id}::uuid order by e.created_at desc limit 500
    `,
    sql<any[]>`
      select o.*,o.id::text,o.lead_id::text,o.service_request_id::text,o.previous_assigned_to::text,o.new_assigned_to::text
      from crm.ownership_events o
      where o.contact_id=${id}::uuid order by o.created_at desc limit 300
    `,
  ]);

  for (const lead of leads) {
    lead.source_name = sourceLabel(lead.source_code, lead.catalog_source_name || lead.source_name);
    delete lead.catalog_source_name;
  }
  const notes = leads.flatMap((lead) => clean(lead.notes) ? [{ leadId: lead.id, customerName: lead.customer_name, text: lead.notes, updatedAt: lead.updated_at }] : []);
  return response.status(200).json({ ok: true, contact, identities, leads, requests, conversations, messages, events, ownership, notes, canPurge: canPurgeContact(user) });
}

async function purgeContact(request: VercelRequest, response: VercelResponse, user: any) {
  if (!canPurgeContact(user)) return response.status(403).json({ ok: false, error: "حذف ملف جهة الاتصال بالكامل متاح لمدير النظام أو مدير المبيعات فقط" });
  const sql = getSql();
  const body = parseBody(request);
  const id = clean(body.id || request.query.id);
  const confirmation = clean(body.confirmPhone ?? body.confirm_phone);
  if (!id || !confirmation) return response.status(400).json({ ok: false, error: "اكتب رقم الجوال المسجل أو كلمة التأكيد الأساسية لحذف الملف بالكامل" });

  const [contact] = await sql<any[]>`select *,id::text from crm.contacts where id=${id}::uuid limit 1`;
  if (!contact) return response.status(404).json({ ok: false, error: "جهة الاتصال غير موجودة" });
  const storedPhone = normalizePhone(contact.primary_phone_normalized || contact.primary_phone);
  const hasStoredPhone = Boolean(storedPhone);
  if (hasStoredPhone) {
    const confirmPhone = normalizePhone(confirmation);
    if (!confirmPhone || storedPhone !== confirmPhone) return response.status(400).json({ ok: false, error: "رقم التأكيد لا يطابق رقم جهة الاتصال" });
  } else if (confirmation !== "2106") {
    return response.status(400).json({ ok: false, error: "كلمة التأكيد الأساسية غير صحيحة" });
  }

  const result = await sql.begin(async (tx) => {
    const [counts] = await tx<any[]>`
      select
        (select count(*) from crm.leads where contact_id=${id}::uuid)::int as leads,
        (select count(*) from crm.service_requests where contact_id=${id}::uuid)::int as requests,
        (select count(*) from crm.conversations where contact_id=${id}::uuid)::int as conversations,
        (select count(*) from crm.messages m join crm.conversations c on c.id=m.conversation_id where c.contact_id=${id}::uuid)::int as messages,
        (select count(*) from crm.manual_lead_requests where (${hasStoredPhone}::boolean and phone_normalized=${storedPhone}) or duplicate_lead_id in (select id from crm.leads where contact_id=${id}::uuid) or created_lead_id in (select id from crm.leads where contact_id=${id}::uuid))::int as manual_requests
    `;
    await tx`delete from crm.manual_lead_requests where (${hasStoredPhone}::boolean and phone_normalized=${storedPhone}) or duplicate_lead_id in (select id from crm.leads where contact_id=${id}::uuid) or created_lead_id in (select id from crm.leads where contact_id=${id}::uuid)`;
    await tx`delete from crm.inbox_agent_logs where lead_id in (select id from crm.leads where contact_id=${id}::uuid) or conversation_id in (select id from crm.conversations where contact_id=${id}::uuid) or (${hasStoredPhone}::boolean and customer_phone in (${contact.primary_phone},${contact.primary_phone_normalized},${storedPhone}))`;
    await tx`delete from crm.assignment_logs where lead_id in (select id from crm.leads where contact_id=${id}::uuid)`;
    await tx`delete from crm.background_events where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid) or conversation_id in (select id from crm.conversations where contact_id=${id}::uuid) or service_request_id in (select id from crm.service_requests where contact_id=${id}::uuid)`;
    await tx`delete from crm.ownership_events where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid) or service_request_id in (select id from crm.service_requests where contact_id=${id}::uuid)`;
    await tx`delete from crm.conversations where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid)`;
    await tx`delete from crm.service_requests where contact_id=${id}::uuid`;
    await tx`delete from crm.leads where contact_id=${id}::uuid`;
    await tx`delete from crm.contacts where id=${id}::uuid`;
    return counts || { leads: 0, requests: 0, conversations: 0, messages: 0, manual_requests: 0 };
  });

  await audit(user, "contact_file_purged", "contact", id, { ...result, phone: storedPhone || null, confirmationMode: hasStoredPhone ? "phone" : "default_password" }, contact);
  return response.status(200).json({ ok: true, deleted: result });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "GET") {
    const id = clean(request.query.id);
    return id ? contactProfile(request, response, user, id) : listContacts(request, response, user);
  }
  if (request.method === "DELETE") return purgeContact(request, response, user);
  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
