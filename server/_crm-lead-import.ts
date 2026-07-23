import { clean, normalizePhone, resolveSourceName } from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { publishBackgroundEvent } from "./_crm-background-jobs.js";
import {
  classifyConversationService,
  ensureContactIdentity,
  findOpenServiceRequest,
} from "./_crm-lifecycle.js";

function first(...values: unknown[]) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

function bool(value: unknown) {
  return value === true || value === 1 || ["true", "1", "yes", "on"].includes(clean(value).toLowerCase());
}

function dateValue(payload: any) {
  const raw = payload?.occurredAt ?? payload?.occurred_at ?? payload?.createdAt ?? payload?.created_at ?? payload?.receivedAt ?? payload?.received_at ?? payload?.timestamp;
  if (raw == null || raw === "") return new Date().toISOString();
  if (typeof raw === "number") return new Date(raw < 1e12 ? raw * 1000 : raw).toISOString();
  const text = String(raw).trim();
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function sourceCodeForImport(routeSource: string, payload: any) {
  if (routeSource === "installment-calculator") return "installment_calculator";
  const declared = first(payload?.sourceCode, payload?.source_code, payload?.source, payload?.platform, payload?.channel).toLowerCase();
  return declared.includes("snap") ? "snapchat_lead" : "tiktok_lead";
}

function importedData(payload: any) {
  const calculator = payload?.calculator && typeof payload.calculator === "object" ? payload.calculator : {};
  const raw = payload?.rawCalculatorRow && typeof payload.rawCalculatorRow === "object"
    ? payload.rawCalculatorRow
    : payload?.raw_calculator_row && typeof payload.raw_calculator_row === "object"
      ? payload.raw_calculator_row
      : payload?.raw && typeof payload.raw === "object"
        ? payload.raw
        : payload;

  const phone = first(
    payload?.phone,
    payload?.mobile,
    payload?.phoneNumber,
    payload?.phone_number,
    payload?.clientNumber,
    payload?.client_number,
    calculator?.phone,
    calculator?.mobile,
    calculator?.phoneNumber,
    calculator?.clientNumber,
    raw?.phone,
    raw?.mobile,
    raw?.clientNumber,
    raw?.["رقم الجوال"],
    raw?.["رقم العميل"],
  );
  const phoneNormalized = normalizePhone(first(payload?.phoneNormalized, payload?.phone_normalized, phone));
  const customerName = first(
    payload?.customerName,
    payload?.customer_name,
    payload?.fullName,
    payload?.full_name,
    payload?.displayName,
    payload?.display_name,
    payload?.name,
    calculator?.name,
    raw?.name,
    raw?.customerName,
    raw?.["الاسم"],
    raw?.["اسم العميل"],
    "عميل",
  );
  const carName = first(
    payload?.car,
    payload?.carName,
    payload?.car_name,
    payload?.vehicleName,
    payload?.vehicle_name,
    calculator?.carName,
    raw?.car,
    raw?.carName,
    raw?.["اسم السيارة"],
    raw?.["السيارة"],
    raw?.["نوع السيارة"],
  );
  const location = first(payload?.location, payload?.city, payload?.place, raw?.location, raw?.city, raw?.["المدينة"], raw?.["المكان"], raw?.["المنطقة"]);
  const salaryBank = first(payload?.salaryBank, payload?.salary_bank, payload?.bank, calculator?.salaryBank, calculator?.bank, raw?.salaryBank, raw?.bank, raw?.["بنك الراتب"], raw?.["البنك"]);
  const notes = first(payload?.notes, payload?.note, raw?.notes, raw?.note, raw?.["ملاحظات"]);
  const financeType = first(payload?.financeType, payload?.finance_type, raw?.financeType, raw?.["نوع التمويل"], "general");

  return {
    calculator,
    raw,
    phone,
    phoneNormalized,
    customerName,
    carName,
    location,
    salaryBank,
    notes,
    financeType,
    age: integerOrNull(first(payload?.age, calculator?.age, raw?.age, raw?.["العمر"])),
    salary: numberOrNull(first(payload?.salary, calculator?.salary, raw?.salary, raw?.["الراتب"])),
    obligation: numberOrNull(first(payload?.obligation, payload?.obligations, calculator?.obligations, raw?.obligation, raw?.obligations, raw?.["الالتزامات"])),
  };
}

function numberOrNull(value: unknown) {
  const text = clean(value).replace(/,/g, "");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value: unknown) {
  const number = numberOrNull(value);
  return number == null ? null : Math.trunc(number);
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) result[key] = toJsonValue(item);
    }
    return result;
  }
  return String(value);
}

function objectValue(value: unknown): JsonObject {
  const normalized = toJsonValue(value);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized) ? normalized : {};
}

function sourceHistory(value: unknown, sourceCode: string, sourceName: string, occurredAt: string) {
  const history = Array.isArray(value) ? [...value] : [];
  const normalizedCode = clean(sourceCode).toLowerCase();
  const normalizedName = clean(sourceName).toLowerCase();
  const exists = history.some((item) => {
    if (typeof item === "string") {
      const text = clean(item).toLowerCase();
      return text === normalizedCode || text === normalizedName;
    }
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    const text = first(record.sourceCode, record.source_code, record.source, record.name, record.label).toLowerCase();
    return text === normalizedCode || text === normalizedName;
  });
  if (!exists) history.push({ source: sourceCode, sourceCode, sourceName, at: occurredAt });
  return history;
}

export function isLeadImportEvent(routeSource: string, payload: any) {
  if (["installment-calculator", "tiktok-snapchat"].includes(routeSource)) return true;
  const eventType = first(payload?.type, payload?.eventType, payload?.event_type, payload?.event, payload?.action).toLowerCase();
  return eventType === "lead_import" && (bool(payload?.importOnly) || bool(payload?.import_only) || payload?.saveMessage === false || payload?.save_message === false);
}

export async function processLeadImportEvent(routeSource: string, eventId: string, payload: any) {
  const sql = getSql();
  const sourceCode = sourceCodeForImport(routeSource, payload);
  const sourceName = await resolveSourceName(sourceCode);
  const occurredAt = dateValue(payload);
  const data = importedData(payload);
  if (!data.phoneNormalized) throw new Error("رقم جوال ليد الاستيراد غير صالح");

  const preferredContactChannel = first(payload?.preferredContactChannel, payload?.preferred_contact_channel, payload?.outboundChannel, payload?.outbound_channel, "whatsapp").toLowerCase();
  const externalId = `lead-import:${sourceCode}:${data.phoneNormalized}`;
  const { contact } = await ensureContactIdentity({
    channelCode: sourceCode,
    externalId,
    participantId: data.phoneNormalized,
    phone: data.phone || data.phoneNormalized,
    displayName: data.customerName,
    aliases: [data.phoneNormalized, data.phone, first(payload?.waId, payload?.wa_id)].filter(Boolean),
    metadata: { routeSource, sourceCode, importOnly: true, preferredContactChannel, lastEventId: eventId },
  });

  let [lead] = await sql<any[]>`
    select l.*,l.id::text,l.contact_id::text,l.current_request_id::text,l.assigned_to::text,l.call_center_assigned_to::text,
      sales.full_name as assigned_name,cc.full_name as call_center_name
    from crm.leads l
    left join core.users sales on sales.id=l.assigned_to
    left join core.users cc on cc.id=l.call_center_assigned_to
    where l.is_deleted=false and (
      l.contact_id=${contact.id}::uuid
      or right(regexp_replace(coalesce(l.phone_normalized,l.phone,''),'\\D','','g'),9)=right(${data.phoneNormalized},9)
    )
    order by (l.current_request_id is not null) desc,l.updated_at desc,l.created_at desc
    limit 1
  `;
  let request = await findOpenServiceRequest(contact.id);
  if (request?.lead_id && (!lead || String(lead.id) !== String(request.lead_id))) {
    [lead] = await sql<any[]>`
      select l.*,l.id::text,l.contact_id::text,l.current_request_id::text,l.assigned_to::text,l.call_center_assigned_to::text,
        sales.full_name as assigned_name,cc.full_name as call_center_name
      from crm.leads l
      left join core.users sales on sales.id=l.assigned_to
      left join core.users cc on cc.id=l.call_center_assigned_to
      where l.id=${request.lead_id}::uuid and l.is_deleted=false limit 1
    `;
  }
  const existedBefore = Boolean(lead);

  let [conversation] = request?.conversation_id ? await sql<any[]>`
    select *,id::text,lead_id::text,contact_id::text,service_request_id::text
    from crm.conversations where id=${request.conversation_id}::uuid limit 1
  ` : [];

  if (!conversation && lead?.id) {
    [conversation] = await sql<any[]>`
      select *,id::text,lead_id::text,contact_id::text,service_request_id::text
      from crm.conversations
      where lead_id=${lead.id}::uuid
      order by (service_request_id is not null) desc,last_message_at desc nulls last,updated_at desc
      limit 1
    `;
  }

  if (!conversation) {
    [conversation] = await sql<any[]>`
      insert into crm.conversations(
        legacy_id,lead_id,contact_id,service_request_id,channel_code,customer_name,participant_id,status,
        unread_count,last_message_at,service_key,department_code,branch_code,assigned_to,call_center_assigned_to,
        provider,classification_state,metadata
      ) values(
        ${externalId},${lead?.id || null}::uuid,${contact.id}::uuid,${request?.id || null}::uuid,${sourceCode},${data.customerName},${data.phoneNormalized},'open',
        0,null,${request?.service_key || lead?.service_key || "finance"},${request?.department_code || lead?.department_code || "finance_sales"},
        ${request?.branch_code || lead?.branch_code || "online"},${request?.assigned_to || lead?.assigned_to || null}::uuid,
        ${request?.call_center_assigned_to || lead?.call_center_assigned_to || null}::uuid,${routeSource},${request || lead ? "classified" : "new"},
        ${sql.json({ routeSource, sourceCode, importOnly: true, preferredContactChannel, lastEventId: eventId })}
      )
      on conflict(legacy_id) do update set
        contact_id=excluded.contact_id,
        lead_id=coalesce(crm.conversations.lead_id,excluded.lead_id),
        service_request_id=coalesce(crm.conversations.service_request_id,excluded.service_request_id),
        customer_name=coalesce(nullif(crm.conversations.customer_name,''),excluded.customer_name),
        participant_id=coalesce(nullif(crm.conversations.participant_id,''),excluded.participant_id),
        metadata=coalesce(crm.conversations.metadata,'{}'::jsonb)||excluded.metadata,
        updated_at=now()
      returning *,id::text,lead_id::text,contact_id::text,service_request_id::text
    `;
  }

  let createdLead = false;
  if (!lead) {
    const classified = await classifyConversationService({
      conversationId: conversation.id,
      serviceKey: "finance",
      sourceCode,
      classificationMethod: "lead_import",
      eventKey: eventId,
      skipAutomaticTemplate: true,
      requestedBranchCode: "online",
    });
    createdLead = classified.reused !== true;
    request = classified.request;
    [lead] = await sql<any[]>`
      select l.*,l.id::text,l.contact_id::text,l.current_request_id::text,l.assigned_to::text,l.call_center_assigned_to::text,
        sales.full_name as assigned_name,cc.full_name as call_center_name
      from crm.leads l
      left join core.users sales on sales.id=l.assigned_to
      left join core.users cc on cc.id=l.call_center_assigned_to
      where l.id=${classified.leadId}::uuid limit 1
    `;
    [conversation] = await sql<any[]>`
      select *,id::text,lead_id::text,contact_id::text,service_request_id::text
      from crm.conversations where id=${conversation.id}::uuid limit 1
    `;
  } else {
    await sql`
      update crm.conversations set
        lead_id=${lead.id}::uuid,
        contact_id=${contact.id}::uuid,
        service_request_id=coalesce(${request?.id || null}::uuid,service_request_id),
        service_key=coalesce(${request?.service_key || lead.service_key || null},service_key),
        department_code=coalesce(${request?.department_code || lead.department_code || null},department_code),
        branch_code=coalesce(${request?.branch_code || lead.branch_code || null},branch_code),
        assigned_to=coalesce(${request?.assigned_to || lead.assigned_to || null}::uuid,assigned_to),
        call_center_assigned_to=coalesce(${request?.call_center_assigned_to || lead.call_center_assigned_to || null}::uuid,call_center_assigned_to),
        classification_state=case when ${Boolean(request)} then 'classified' else classification_state end,
        metadata=coalesce(metadata,'{}'::jsonb)||${sql.json({ routeSource, sourceCode, importOnly: true, preferredContactChannel, lastEventId: eventId })}::jsonb,
        updated_at=now()
      where id=${conversation.id}::uuid
    `;
  }

  const existingExtraData = objectValue(lead.extra_data);
  const nextExtraData: JsonObject = {
    ...existingExtraData,
    importOnly: true,
    preferredContactChannel,
    outboundChannel: preferredContactChannel,
    latestSource: sourceName,
    latestSourceCode: sourceCode,
    latestSourceAt: occurredAt,
    lastImportEventId: eventId,
    lastImportRouteSource: routeSource,
    lastImportPayload: toJsonValue(data.raw),
  };
  if (sourceCode === "installment_calculator") {
    nextExtraData.calculator = toJsonValue(data.calculator);
    nextExtraData.rawCalculatorRow = toJsonValue(data.raw);
    nextExtraData.calculatorLastEventAt = occurredAt;
  }
  const nextSourceHistory = sourceHistory(lead.source_history, sourceCode, sourceName, occurredAt);

  [lead] = await sql<any[]>`
    update crm.leads set
      contact_id=${contact.id}::uuid,
      customer_name=case when ${existedBefore} then coalesce(nullif(customer_name,''),${data.customerName}) else ${data.customerName} end,
      phone=case when ${existedBefore} then coalesce(nullif(phone,''),${data.phone || data.phoneNormalized}) else ${data.phone || data.phoneNormalized} end,
      phone_normalized=coalesce(nullif(phone_normalized,''),${data.phoneNormalized}),
      source_code=case when ${existedBefore} then source_code else ${sourceCode} end,
      source_name=case when ${existedBefore} then source_name else ${sourceName} end,
      platform_code=case when ${existedBefore} then platform_code else ${sourceCode} end,
      service_key=case when ${existedBefore} then service_key else 'finance' end,
      department_code=case when ${existedBefore} then department_code else 'finance_sales' end,
      branch_code=case when ${existedBefore} then branch_code else 'online' end,
      status_label=case when ${existedBefore} then status_label else 'عميل جديد' end,
      payment_type=case when ${existedBefore} then payment_type else 'تمويل' end,
      car_name=case when ${existedBefore} then coalesce(nullif(car_name,''),${data.carName || null}) else ${data.carName || null} end,
      car_type=case when ${existedBefore} then coalesce(nullif(car_type,''),${data.carName || null}) else ${data.carName || null} end,
      location=case when ${existedBefore} then coalesce(nullif(location,''),${data.location || null}) else ${data.location || null} end,
      age=case when ${existedBefore} then coalesce(age,${data.age}) else ${data.age} end,
      salary=case when ${existedBefore} then coalesce(salary,${data.salary}) else ${data.salary} end,
      obligation=case when ${existedBefore} then coalesce(obligation,${data.obligation}) else ${data.obligation} end,
      salary_bank=case when ${existedBefore} then coalesce(nullif(salary_bank,''),${data.salaryBank || null}) else ${data.salaryBank || null} end,
      finance_type=case when ${existedBefore} then coalesce(nullif(finance_type,''),${data.financeType || null}) else ${data.financeType || null} end,
      notes=case when ${existedBefore} then coalesce(nullif(notes,''),${data.notes || null}) else ${data.notes || null} end,
      registered_at=coalesce(registered_at,${occurredAt}::timestamptz),
      source_history=${sql.json(nextSourceHistory)},
      extra_data=${sql.json(nextExtraData)},
      updated_at=now()
    where id=${lead.id}::uuid
    returning *,id::text,contact_id::text,current_request_id::text,assigned_to::text,call_center_assigned_to::text
  `;

  await sql`
    insert into crm.lead_events(lead_id,event_type,new_status,new_department,new_branch,actor_name,note,details,created_at)
    select ${lead.id}::uuid,'lead_import_received',${lead.status_label || "عميل جديد"},${lead.department_code || "finance_sales"},${lead.branch_code || "online"},
      'Integration Gateway',${existedBefore ? "تم إرفاق بيانات مصدر جديد بالعميل الموجود" : "تم استيراد العميل وتوزيعه من المصدر الخارجي"},
      ${sql.json({ eventId, routeSource, sourceCode, sourceName, preferredContactChannel, existedBefore })},${occurredAt}::timestamptz
    where not exists(
      select 1 from crm.lead_events
      where lead_id=${lead.id}::uuid and event_type='lead_import_received' and details->>'eventId'=${eventId}
    )
  `;

  let backgroundError = "";
  try {
    await publishBackgroundEvent({
      eventKey: `${sourceCode}:${eventId}:lead-import`,
      eventType: "lead.imported",
      source: sourceCode,
      contactId: contact.id,
      conversationId: conversation.id,
      serviceRequestId: request?.id || conversation.service_request_id || null,
      leadId: lead.id,
      payload: { eventId, sourceCode, sourceName, preferredContactChannel, existedBefore, createdLead },
      actor: null,
    });
  } catch (error: any) {
    backgroundError = error?.message || String(error);
    console.error("Lead import persisted; background side effect failed", { routeSource, eventId, leadId: lead.id, error: backgroundError });
  }

  await sql`
    update integrations.inbound_events
    set status='processed',processed_at=now(),error_message=${backgroundError ? `background: ${backgroundError}` : null}
    where source=${routeSource} and event_key=${eventId}
  `;

  return {
    lead,
    conversation,
    message: null,
    createLead: createdLead,
    contact,
    automation: null,
    automationError: backgroundError || null,
    automaticTemplate: null,
    serviceSelectionAccepted: null,
    importOnly: true,
    existedBefore,
  };
}
