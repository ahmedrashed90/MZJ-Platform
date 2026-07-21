import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { audit, clean, isCrmManager, parseBody, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { normalizeCustomerFieldOptions } from "../_crm-customer-fields.js";

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "إعدادات CRM متاحة للإدارة فقط" });
  const sql = getSql();

  if (request.method === "GET") {
    const [statuses, templates, mappings, quality, endpoints, branches, sources, customerFields, assignmentRules, assignmentLogs, assignmentUsers] = await Promise.all([
      sql`select * from crm.dashboard_statuses order by department_code,sort_order`,
      sql`select *,id::text,created_by::text from crm.message_templates order by updated_at desc`,
      sql`
        select m.*,m.id::text,m.template_id::text,t.display_name as template_label,t.content as template_content,t.template_type
        from crm.status_template_mappings m join crm.message_templates t on t.id=m.template_id
        order by m.department_code,m.status_label
      `,
      sql`select * from crm.report_quality_settings where id='default'`,
      sql`select * from crm.integration_endpoints order by display_name`,
      sql`select code,name,is_active,sort_order from core.branches order by sort_order,name`,
      sql`
        select s.*,
          (select count(*)::int from crm.leads l where l.is_deleted=false and l.source_code=s.code) as crm_usage_count,
          (select count(*)::int from crm.manual_lead_requests r where r.source_code=s.code) as request_usage_count
        from core.sources s
        order by s.sort_order,s.name
      `,
      sql`
        select id::text,field_key,label,field_type,sort_order,department_keys,is_active,is_required,
          include_in_completion,options,is_system,is_locked,created_at,updated_at
        from crm.customer_field_definitions
        order by sort_order,label
      `,
      sql`
        select r.*,r.id::text,
          b.name as branch_name,
          state.last_user_id::text,
          state.updated_at as last_distribution_at,
          last_user.full_name as last_user_name,
          coalesce(json_agg(json_build_object(
            'user_id',m.user_id::text,
            'full_name',u.full_name,
            'priority',m.priority,
            'is_active',m.is_active,
            'assignment_count',m.assignment_count,
            'last_assigned_at',m.last_assigned_at
          ) order by m.priority,u.full_name) filter (where m.user_id is not null),'[]'::json) as members
        from crm.assignment_rules r
        left join core.branches b on b.code=r.branch_code
        left join crm.assignment_state state on state.pool_key=concat('rule:',r.id::text)
        left join core.users last_user on last_user.id=state.last_user_id
        left join crm.assignment_rule_members m on m.rule_id=r.id
        left join core.users u on u.id=m.user_id
        group by r.id,b.name,state.last_user_id,state.updated_at,last_user.full_name
        order by r.sort_order,r.created_at
      `,
      sql`
        select l.*,l.rule_id::text,l.lead_id::text,l.assigned_to::text,l.previous_assigned_to::text,
          r.name as rule_name
        from crm.assignment_logs l
        left join crm.assignment_rules r on r.id=l.rule_id
        order by l.created_at desc
        limit 100
      `,
      sql`
        select u.id::text,u.full_name,u.employee_no,u.is_active,u.can_receive_leads,
          coalesce(array_agg(distinct d.code) filter (where d.code is not null),'{}') as department_codes,
          coalesce(array_agg(distinct d.name) filter (where d.name is not null),'{}') as departments,
          coalesce(array_agg(distinct b.code) filter (where b.code is not null),'{}') as branch_codes,
          coalesce(array_agg(distinct b.name) filter (where b.name is not null),'{}') as branches
        from core.users u
        left join core.user_departments ud on ud.user_id=u.id
        left join core.departments d on d.id=ud.department_id
        left join core.user_branches ub on ub.user_id=u.id
        left join core.branches b on b.id=ub.branch_id
        group by u.id
        order by u.full_name
      `,
    ]);

    const rules = (assignmentRules as any[]).map((rule) => {
      const activeMembers = (rule.members || []).filter((member: any) => member.is_active);
      const currentIndex = activeMembers.findIndex((member: any) => member.user_id === rule.last_user_id);
      const next = activeMembers.length ? activeMembers[(currentIndex + 1 + activeMembers.length) % activeMembers.length] : null;
      return { ...rule, next_user_id: next?.user_id || null, next_user_name: next?.full_name || null };
    });

    return response.status(200).json({
      ok: true,
      statuses,
      templates,
      mappings,
      quality: quality[0],
      endpoints,
      branches,
      sources,
      customerFields,
      assignmentRules: rules,
      assignmentLogs,
      assignmentUsers,
    });
  }

  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method || "")) return response.status(405).json({ ok: false, error: "Method not allowed" });
  const body = parseBody(request);
  const section = clean(body.section);
  const action = clean(body.action || (request.method === "DELETE" ? "delete" : "save"));

  if (section === "status") {
    const id = clean(body.id);
    if (!id) return response.status(400).json({ ok: false, error: "رقم الحالة مطلوب" });
    if (action === "delete") {
      await sql`delete from crm.dashboard_statuses where id=${id}`;
      await audit(user, "crm_status_deleted", "dashboard_status", id);
      return response.status(200).json({ ok: true });
    }
    const [row] = await sql<any[]>`
      insert into crm.dashboard_statuses(id,department_code,label,value,sort_order,is_active,updated_at)
      values (${id},${clean(body.departmentCode)},${clean(body.label)},${clean(body.value)},${Number(body.sortOrder||0)},${body.isActive!==false},now())
      on conflict (id) do update set department_code=excluded.department_code,label=excluded.label,value=excluded.value,sort_order=excluded.sort_order,is_active=excluded.is_active,updated_at=now()
      returning *
    `;
    await audit(user, "crm_status_saved", "dashboard_status", id, row);
    return response.status(200).json({ ok: true, row });
  }

  if (section === "source") {
    const code = clean(body.code).toLowerCase().replace(/\s+/g, "_");
    if (!code) return response.status(400).json({ ok: false, error: "كود المصدر مطلوب" });
    if (action === "delete") {
      const [usage] = await sql<{ count: number }[]>`
        select (
          (select count(*) from crm.leads where source_code=${code}) +
          (select count(*) from crm.manual_lead_requests where source_code=${code})
        )::int as count
      `;
      if (Number(usage?.count || 0) > 0) {
        await sql`update core.sources set is_active=false,updated_at=now() where code=${code}`;
        return response.status(200).json({ ok: true, deactivated: true, message: "المصدر مستخدم في بيانات سابقة، لذلك تم إيقافه بدل الحذف" });
      }
      await sql`delete from core.sources where code=${code}`;
      return response.status(200).json({ ok: true, deleted: true });
    }
    const name = clean(body.name);
    if (!name) return response.status(400).json({ ok: false, error: "اسم المصدر بالعربي مطلوب" });
    const systems = stringList(body.systemCodes);
    const reportGroup = ['digital','direct','other'].includes(clean(body.reportGroup)) ? clean(body.reportGroup) : 'other';
    const [row] = await sql<any[]>`
      insert into core.sources(code,name,sort_order,is_active,system_codes,delivery_route,allow_free_text,report_group,updated_at)
      values (${code},${name},${Number(body.sortOrder||0)},${body.isActive!==false},${systems.length ? systems : ["crm","marketing"]},${clean(body.deliveryRoute)||"whatsapp"},${body.allowFreeText===true},${reportGroup},now())
      on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,is_active=excluded.is_active,system_codes=excluded.system_codes,delivery_route=excluded.delivery_route,allow_free_text=excluded.allow_free_text,report_group=excluded.report_group,updated_at=now()
      returning *
    `;
    await audit(user, "source_saved", "source", code, row);
    return response.status(200).json({ ok: true, row });
  }

  if (section === "customer_field") {
    const id = clean(body.id);
    const requestedKey = clean(body.fieldKey || body.field_key).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (action === "delete") {
      const [existing] = await sql<any[]>`select *,id::text from crm.customer_field_definitions where id=${id || null}::uuid or field_key=${requestedKey || null} limit 1`;
      if (!existing) return response.status(404).json({ ok: false, error: "الحقل غير موجود" });
      if (existing.is_locked || existing.is_system) return response.status(400).json({ ok: false, error: "هذا حقل أساسي مرتبط بمنطق النظام ولا يمكن حذفه" });
      const [usage] = await sql<{ count: number }[]>`select count(*)::int as count from crm.leads where coalesce(extra_data,'{}'::jsonb) ? ${existing.field_key}`;
      if (Number(usage?.count || 0) > 0) {
        await sql`update crm.customer_field_definitions set is_active=false,include_in_completion=false,updated_by=${user.id}::uuid,updated_at=now() where id=${existing.id}::uuid`;
        return response.status(200).json({ ok: true, deactivated: true, message: "الحقل مستخدم في بيانات سابقة، لذلك تم إيقافه مع الاحتفاظ بالقيم القديمة" });
      }
      await sql`delete from crm.customer_field_definitions where id=${existing.id}::uuid`;
      await audit(user, "customer_field_deleted", "customer_field", existing.id, { fieldKey: existing.field_key });
      return response.status(200).json({ ok: true, deleted: true });
    }

    const label = clean(body.label);
    const fieldType = clean(body.fieldType || body.field_type) || "text";
    const departmentKeys = stringList(body.departmentKeys || body.department_keys).filter((key) => ["cash", "finance", "service"].includes(key));
    const options = normalizeCustomerFieldOptions(body.options);
    if (!label) return response.status(400).json({ ok: false, error: "اسم الحقل مطلوب" });
    if (!["text", "phone", "number", "date", "textarea", "select", "status", "source", "department", "transfer"].includes(fieldType)) {
      return response.status(400).json({ ok: false, error: "نوع الحقل غير مدعوم" });
    }
    if (fieldType === "select" && !options.length) return response.status(400).json({ ok: false, error: "أضف اختيارات القائمة قبل الحفظ" });

    let existing: any = null;
    if (id) {
      [existing] = await sql<any[]>`select *,id::text from crm.customer_field_definitions where id=${id}::uuid`;
      if (!existing) return response.status(404).json({ ok: false, error: "الحقل غير موجود" });
    }

    const generatedKey = requestedKey || `custom_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    if (!existing) {
      const [duplicate] = await sql<any[]>`select id::text from crm.customer_field_definitions where field_key=${generatedKey} limit 1`;
      if (duplicate) return response.status(409).json({ ok: false, error: "كود الحقل مستخدم بالفعل" });
    }

    const fieldKey = existing?.field_key || generatedKey;
    const locked = existing?.is_locked === true;
    const isSystem = existing?.is_system === true;
    const effectiveFieldType = isSystem ? existing.field_type : fieldType;
    if (!isSystem && !["text", "phone", "number", "date", "textarea", "select"].includes(effectiveFieldType)) {
      return response.status(400).json({ ok: false, error: "نوع الحقل المخصص غير مدعوم" });
    }
    const effectiveDepartments = locked ? (Array.isArray(existing.department_keys) ? existing.department_keys : []) : departmentKeys;
    const effectiveOptions = effectiveFieldType === "select" ? options : [];
    if (effectiveFieldType === "select" && !effectiveOptions.length) return response.status(400).json({ ok: false, error: "أضف اختيارات القائمة قبل الحفظ" });
    const isActive = locked ? true : body.isActive !== false;
    const isRequired = locked ? existing.is_required === true : body.isRequired === true;

    const [row] = existing
      ? await sql<any[]>`
          update crm.customer_field_definitions set
            label=${label},field_type=${effectiveFieldType},sort_order=${Number(body.sortOrder || 0)},department_keys=${effectiveDepartments},
            is_active=${isActive},is_required=${isRequired},include_in_completion=${body.includeInCompletion === true},
            options=${sql.json(effectiveOptions)},updated_by=${user.id}::uuid,updated_at=now()
          where id=${existing.id}::uuid
          returning *,id::text
        `
      : await sql<any[]>`
          insert into crm.customer_field_definitions(
            field_key,label,field_type,sort_order,department_keys,is_active,is_required,include_in_completion,options,is_system,is_locked,created_by,updated_by
          ) values (
            ${fieldKey},${label},${effectiveFieldType},${Number(body.sortOrder || 0)},${effectiveDepartments},${isActive},${isRequired},${body.includeInCompletion === true},${sql.json(effectiveOptions)},false,false,${user.id}::uuid,${user.id}::uuid
          ) returning *,id::text
        `;
    await audit(user, "customer_field_saved", "customer_field", row.id, row, existing || undefined);
    return response.status(200).json({ ok: true, row, message: isSystem ? "تم تحديث إعدادات الحقل الأساسي" : "تم حفظ حقل بيانات العميل" });
  }

  if (section === "template") {
    const id = clean(body.id);
    if (action === "delete") {
      await sql`delete from crm.message_templates where id=${id}::uuid`;
      return response.status(200).json({ ok: true });
    }
    const displayName = clean(body.displayName || body.name);
    const content = clean(body.content);
    if (!displayName || !content) return response.status(400).json({ ok: false, error: "الاسم الظاهر ومحتوى الرسالة مطلوبان" });
    const departments = stringList(body.departments);
    const [row] = id
      ? await sql<any[]>`
          update crm.message_templates set name=${clean(body.name)||displayName},display_name=${displayName},content=${content},template_type=${clean(body.templateType)||"quick_message"},provider=${clean(body.provider)||null},external_id=${clean(body.externalId)||null},language_code=${clean(body.languageCode)||null},departments=${departments},is_active=${body.isActive!==false},status=${clean(body.status)||"active"},updated_at=now() where id=${id}::uuid returning *,id::text
        `
      : await sql<any[]>`
          insert into crm.message_templates(name,display_name,content,template_type,provider,external_id,language_code,departments,is_active,status,created_by)
          values (${clean(body.name)||displayName},${displayName},${content},${clean(body.templateType)||"quick_message"},${clean(body.provider)||null},${clean(body.externalId)||null},${clean(body.languageCode)||null},${departments},${body.isActive!==false},${clean(body.status)||"active"},${user.id}::uuid) returning *,id::text
        `;
    await audit(user, "crm_template_saved", "message_template", row.id, row);
    return response.status(200).json({ ok: true, row });
  }

  if (section === "mapping") {
    const id = clean(body.id);
    if (action === "delete") {
      await sql`delete from crm.status_template_mappings where id=${id}::uuid`;
      return response.status(200).json({ ok: true });
    }
    const departmentCode = clean(body.departmentCode);
    const statusValue = clean(body.statusValue);
    const templateId = clean(body.templateId);
    if (!departmentCode || !statusValue || !templateId) return response.status(400).json({ ok: false, error: "اختار الحالة والقالب قبل الحفظ" });
    const [row] = await sql<any[]>`
      insert into crm.status_template_mappings(department_code,status_value,status_label,template_id,message_type,is_active,updated_at)
      values (${departmentCode},${statusValue},${clean(body.statusLabel)||statusValue},${templateId}::uuid,${clean(body.messageType)||"template"},${body.isActive!==false},now())
      on conflict (department_code,status_value) do update set status_label=excluded.status_label,template_id=excluded.template_id,message_type=excluded.message_type,is_active=excluded.is_active,updated_at=now()
      returning *,id::text,template_id::text
    `;
    return response.status(200).json({ ok: true, row });
  }

  if (section === "quality") {
    const marketingNumeratorStatuses = stringList(body.marketingNumeratorStatuses);
    const marketingDenominatorStatuses = stringList(body.marketingDenominatorStatuses);
    const salesNumeratorStatuses = stringList(body.salesNumeratorStatuses);
    const salesDenominatorStatuses = stringList(body.salesDenominatorStatuses);
    const qualifiedStatuses = stringList(body.qualifiedStatuses);
    const totalStatuses = stringList(body.totalStatuses);
    const notContactedStatuses = stringList(body.notContactedStatuses);
    const allowedCards = new Set(["marketing", "total", "notContacted", "waste", "qualified", "delayed", "potential", "sold", "sales"]);
    const summaryCards = stringList(body.summaryCards).filter((value) => allowedCards.has(value));
    const marketingMode = clean(body.marketingDenominatorMode) === "statuses" ? "statuses" : "all";
    const salesMode = clean(body.salesDenominatorMode) === "all" ? "all" : "statuses";
    const totalMode = clean(body.totalMode) === "statuses" ? "statuses" : "all";
    const selectedStatuses = [...new Set([
      ...marketingNumeratorStatuses,
      ...marketingDenominatorStatuses,
      ...salesNumeratorStatuses,
      ...salesDenominatorStatuses,
      ...qualifiedStatuses,
      ...totalStatuses,
      ...notContactedStatuses,
    ])];
    const knownStatusRows = await sql<{ value: string }[]>`
      select distinct value from crm.dashboard_statuses where is_active=true
      union
      select distinct status_label as value from crm.leads where is_deleted=false and nullif(status_label,'') is not null
    `;
    const knownStatuses = new Set(knownStatusRows.map((row) => row.value));
    const unknownStatuses = selectedStatuses.filter((value) => !knownStatuses.has(value));
    if (unknownStatuses.length) return response.status(400).json({ ok: false, error: `حالات غير معتمدة: ${unknownStatuses.join("، ")}` });
    if (!marketingNumeratorStatuses.length || !salesNumeratorStatuses.length) return response.status(400).json({ ok: false, error: "اختار حالات البسط للمؤشرات" });
    if (!qualifiedStatuses.length) return response.status(400).json({ ok: false, error: "اختار الحالات التي تُحسب مؤهل" });
    if (!notContactedStatuses.length) return response.status(400).json({ ok: false, error: "اختار حالات لم يتم الاتصال" });
    if (!summaryCards.length || summaryCards.length !== new Set(summaryCards).size) return response.status(400).json({ ok: false, error: "ترتيب كروت النتائج غير صحيح" });
    if (marketingMode === "statuses" && !marketingDenominatorStatuses.length) return response.status(400).json({ ok: false, error: "اختار حالات مقام جودة التسويق" });
    if (salesMode === "statuses" && !salesDenominatorStatuses.length) return response.status(400).json({ ok: false, error: "اختار حالات مقام جودة المبيعات" });
    if (totalMode === "statuses" && !totalStatuses.length) return response.status(400).json({ ok: false, error: "اختار الحالات الداخلة في إجمالي العملاء" });
    const missingMarketing = marketingMode === "statuses" ? marketingNumeratorStatuses.filter((value) => !marketingDenominatorStatuses.includes(value)) : [];
    const missingSales = salesMode === "statuses" ? salesNumeratorStatuses.filter((value) => !salesDenominatorStatuses.includes(value)) : [];
    if (missingMarketing.length || missingSales.length) return response.status(400).json({ ok: false, error: "يجب أن يحتوي مقام كل جودة على جميع حالات البسط" });
    const [before] = await sql<any[]>`select * from crm.report_quality_settings where id='default'`;
    const [row] = await sql<any[]>`
      update crm.report_quality_settings set
        marketing_numerator_statuses=${marketingNumeratorStatuses},marketing_denominator_mode=${marketingMode},marketing_denominator_statuses=${marketingDenominatorStatuses},
        sales_numerator_statuses=${salesNumeratorStatuses},sales_denominator_mode=${salesMode},sales_denominator_statuses=${salesDenominatorStatuses},
        qualified_statuses=${qualifiedStatuses},total_mode=${totalMode},total_statuses=${totalStatuses},not_contacted_statuses=${notContactedStatuses},
        summary_cards=${summaryCards},summary_cards_version=2,updated_by=${user.id}::uuid,updated_at=now()
      where id='default' returning *
    `;
    await audit(user, "report_quality_settings_saved", "report_quality_settings", "default", row, before);
    return response.status(200).json({ ok: true, row });
  }

  if (section === "endpoint") {
    const sourceCode = clean(body.sourceCode);
    if (!sourceCode) return response.status(400).json({ ok: false, error: "المصدر مطلوب" });
    const textSendUrl = clean(body.textSendUrl || body.sendUrl);
    const templateSendUrl = clean(body.templateSendUrl) || (["whatsapp", "mersal"].includes(sourceCode) ? textSendUrl : "");
    const mediaSendUrl = clean(body.mediaSendUrl) || textSendUrl;
    const templatesSyncUrl = clean(body.templatesSyncUrl);
    const inboundWebhookUrl = clean(body.inboundWebhookUrl || body.webhookUrl);
    const [row] = await sql<any[]>`
      insert into crm.integration_endpoints(
        source_code,display_name,send_url,webhook_url,text_send_url,template_send_url,media_send_url,templates_sync_url,inbound_webhook_url,
        health_url,secret_name,is_active,updated_by,updated_at
      ) values (
        ${sourceCode},${clean(body.displayName)||sourceCode},${textSendUrl||null},${inboundWebhookUrl||null},${textSendUrl||null},${templateSendUrl||null},
        ${mediaSendUrl||null},${templatesSyncUrl||null},${inboundWebhookUrl||null},${clean(body.healthUrl)||null},${clean(body.secretName)||null},${body.isActive!==false},${user.id}::uuid,now()
      )
      on conflict (source_code) do update set display_name=excluded.display_name,send_url=excluded.send_url,webhook_url=excluded.webhook_url,
        text_send_url=excluded.text_send_url,template_send_url=excluded.template_send_url,media_send_url=excluded.media_send_url,
        templates_sync_url=excluded.templates_sync_url,inbound_webhook_url=excluded.inbound_webhook_url,health_url=excluded.health_url,
        secret_name=excluded.secret_name,is_active=excluded.is_active,updated_by=excluded.updated_by,updated_at=now()
      returning *
    `;
    return response.status(200).json({ ok: true, row });
  }

  if (section === "branch") {
    const code = clean(body.code);
    if (!code) return response.status(400).json({ ok: false, error: "كود الفرع مطلوب" });
    if (action === "delete") {
      await sql`update core.branches set is_active=false,updated_at=now() where code=${code}`;
      return response.status(200).json({ ok: true });
    }
    const [row] = await sql<any[]>`
      insert into core.branches(code,name,is_active,sort_order,updated_at) values (${code},${clean(body.name)},${body.isActive!==false},${Number(body.sortOrder||0)},now())
      on conflict (code) do update set name=excluded.name,is_active=excluded.is_active,sort_order=excluded.sort_order,updated_at=now() returning *
    `;
    return response.status(200).json({ ok: true, row });
  }

  if (section === "assignment_rule") {
    const id = clean(body.id);
    if (action === "delete") {
      await sql`update crm.assignment_rules set is_active=false,updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid`;
      return response.status(200).json({ ok: true });
    }
    const name = clean(body.name);
    const departmentCode = clean(body.departmentCode);
    const memberIds = stringList(body.memberIds);
    if (!name || !departmentCode) return response.status(400).json({ ok: false, error: "اسم القاعدة والقسم مطلوبان" });
    if (!memberIds.length) return response.status(400).json({ ok: false, error: "اختار موظفًا واحدًا على الأقل في قاعدة التوزيع" });
    const sourceCodes = stringList(body.sourceCodes);
    const [rule] = id
      ? await sql<any[]>`
          update crm.assignment_rules set name=${name},department_code=${departmentCode},branch_code=${clean(body.branchCode)||null},source_codes=${sourceCodes},assignment_mode='round_robin',prevent_consecutive=${body.preventConsecutive!==false},sort_order=${Number(body.sortOrder||0)},is_active=${body.isActive!==false},updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid returning *,id::text
        `
      : await sql<any[]>`
          insert into crm.assignment_rules(name,department_code,branch_code,source_codes,assignment_mode,prevent_consecutive,sort_order,is_active,created_by,updated_by)
          values (${name},${departmentCode},${clean(body.branchCode)||null},${sourceCodes},'round_robin',${body.preventConsecutive!==false},${Number(body.sortOrder||0)},${body.isActive!==false},${user.id}::uuid,${user.id}::uuid) returning *,id::text
        `;
    await sql`delete from crm.assignment_rule_members where rule_id=${rule.id}::uuid and not (user_id = any(${memberIds}::uuid[]))`;
    for (let index = 0; index < memberIds.length; index += 1) {
      const memberId = memberIds[index];
      await sql`
        insert into crm.assignment_rule_members(rule_id,user_id,priority,is_active,updated_at)
        values (${rule.id}::uuid,${memberId}::uuid,${(index+1)*10},true,now())
        on conflict (rule_id,user_id) do update set priority=excluded.priority,is_active=true,updated_at=now()
      `;
    }
    await audit(user, "assignment_rule_saved", "assignment_rule", rule.id, { ...rule, memberIds });
    return response.status(200).json({ ok: true, row: rule });
  }

  if (section === "assignment_member") {
    const ruleId = clean(body.ruleId);
    const userId = clean(body.userId);
    if (!ruleId || !userId) return response.status(400).json({ ok: false, error: "قاعدة التوزيع والموظف مطلوبان" });
    await sql`
      update crm.assignment_rule_members
      set is_active=${body.isActive!==false},priority=${Number(body.priority||100)},updated_at=now()
      where rule_id=${ruleId}::uuid and user_id=${userId}::uuid
    `;
    return response.status(200).json({ ok: true });
  }

  return response.status(400).json({ ok: false, error: "قسم الإعدادات غير معروف" });
}
