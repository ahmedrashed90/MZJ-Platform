import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { audit, clean, parseBody, requireCrmUser } from "../_crm-utils.js";
import { hasPermission } from "../_access-control.js";
import { getSql } from "../_db.js";
import { normalizeCustomerFieldOptions } from "../_crm-customer-fields.js";
import { CrmBulkReallocationError, executeFinanceToCashReallocation, listCashReallocationAgents, previewFinanceToCashReallocation } from "../_crm-bulk-reallocation.js";

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const requiredPermission = request.method === "GET" ? "settings.crm.view" : "settings.crm.manage";
  if (!hasPermission(user, requiredPermission)) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لإعدادات CRM" });
  const sql = getSql();
  const canManageBulkReallocation = hasPermission(user, "platform.superadmin")
    && hasPermission(user, "settings.crm.manage")
    && hasPermission(user, "crm.customer.bulk_transfer")
    && hasPermission(user, "crm.routing.manage");

  if (request.method === "GET") {
    const [statuses, templates, mappings, quality, automaticTemplateSettings, endpoints, branches, sources, customerFields, assignmentRules, assignmentLogs, assignmentUsers, kpiSectionPermissionRows, bulkCashAgents] = await Promise.all([
      sql`select * from crm.dashboard_statuses order by department_code,sort_order`,
      sql`select *,id::text,created_by::text from crm.message_templates order by updated_at desc`,
      sql`
        select m.*,m.id::text,m.template_id::text,t.display_name as template_label,t.content as template_content,t.template_type
        from crm.status_template_mappings m join crm.message_templates t on t.id=m.template_id
        order by m.department_code,m.status_label
      `,
      sql`select * from crm.report_quality_settings where id='default'`,
      sql`select cash_total_customers_template_enabled,finance_call_center_template_enabled from crm.crm_runtime_settings where id='default'`,
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
          coalesce(rule_branches.names,'{}'::text[]) as branch_names,
          last_assignment.assigned_to::text as last_user_id,
          last_assignment.created_at as last_distribution_at,
          last_assignment.assigned_name as last_user_name,
          coalesce(rule_members.items,'[]'::json) as members
        from crm.assignment_rules r
        left join lateral (
          select array_agg(b.name order by b.sort_order,b.name) as names
          from core.branches b
          where b.code=any(r.branch_codes)
        ) rule_branches on true
        left join lateral (
          select l.assigned_to,l.assigned_name,l.created_at
          from crm.assignment_logs l
          where l.rule_id=r.id and l.assigned_to is not null
          order by l.created_at desc,l.id desc
          limit 1
        ) last_assignment on true
        left join lateral (
          select json_agg(json_build_object(
            'user_id',m.user_id::text,
            'full_name',u.full_name,
            'priority',m.priority,
            'is_active',m.is_active,
            'assignment_count',m.assignment_count,
            'last_assigned_at',m.last_assigned_at
          ) order by m.priority,u.full_name) as items
          from crm.assignment_rule_members m
          join core.users u on u.id=m.user_id
          where m.rule_id=r.id
        ) rule_members on true
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
          case when exists(select 1 from core.user_system_departments usd0 where usd0.user_id=u.id and usd0.system_code='crm')
            then coalesce(crm_departments.codes,'{}'::text[]) else coalesce(global_departments.codes,'{}'::text[]) end as department_codes,
          case when exists(select 1 from core.user_system_departments usd0 where usd0.user_id=u.id and usd0.system_code='crm')
            then coalesce(crm_departments.names,'{}'::text[]) else coalesce(global_departments.names,'{}'::text[]) end as departments,
          case when exists(select 1 from core.user_system_branches usb0 where usb0.user_id=u.id and usb0.system_code='crm')
            then coalesce(crm_branches.codes,'{}'::text[]) else coalesce(global_branches.codes,'{}'::text[]) end as branch_codes,
          case when exists(select 1 from core.user_system_branches usb0 where usb0.user_id=u.id and usb0.system_code='crm')
            then coalesce(crm_branches.names,'{}'::text[]) else coalesce(global_branches.names,'{}'::text[]) end as branches
        from core.users u
        left join lateral (
          select array_agg(d.code order by usd.is_primary desc,d.created_at,d.code) as codes,
            array_agg(d.name order by usd.is_primary desc,d.created_at,d.code) as names
          from core.user_system_departments usd
          join core.departments d on d.id=usd.department_id and d.system_code='crm' and d.is_active=true
          where usd.user_id=u.id and usd.system_code='crm'
        ) crm_departments on true
        left join lateral (
          select array_agg(distinct d.code) as codes,array_agg(distinct d.name) as names
          from core.user_departments ud
          join core.departments d on d.id=ud.department_id and d.is_active=true
          where ud.user_id=u.id
        ) global_departments on true
        left join lateral (
          select array_agg(b.code order by usb.is_primary desc,b.sort_order,b.name) as codes,
            array_agg(b.name order by usb.is_primary desc,b.sort_order,b.name) as names
          from core.user_system_branches usb
          join core.branches b on b.id=usb.branch_id and b.is_active=true
          where usb.user_id=u.id and usb.system_code='crm'
        ) crm_branches on true
        left join lateral (
          select array_agg(distinct b.code) as codes,array_agg(distinct b.name) as names
          from core.user_branches ub
          join core.branches b on b.id=ub.branch_id and b.is_active=true
          where ub.user_id=u.id
        ) global_branches on true
        order by u.full_name
      `,
      sql`
        select p.section_code,p.user_id::text,u.full_name,u.is_active
        from crm.kpi_section_permissions p
        join core.users u on u.id=p.user_id
        where u.is_active=true
        order by p.section_code,u.full_name
      `,
      canManageBulkReallocation ? listCashReallocationAgents() : Promise.resolve([]),
    ]);

    const assignmentUserById = new Map((assignmentUsers as any[]).map((row: any) => [row.id, row]));
    const rules = (assignmentRules as any[]).map((rule) => {
      const branchCodes = stringList(rule.branch_codes);
      const singleBranchCode = branchCodes.length === 1 ? branchCodes[0] : "";
      const activeMembers = (rule.members || []).filter((member: any) => {
        if (!member.is_active) return false;
        const assignmentUser = assignmentUserById.get(member.user_id) as any;
        if (!assignmentUser?.is_active || !assignmentUser?.can_receive_leads) return false;
        if (!(assignmentUser.department_codes || []).includes(rule.department_code)) return false;
        if (singleBranchCode && !(assignmentUser.branch_codes || []).includes(singleBranchCode)) return false;
        return true;
      });
      const currentIndex = activeMembers.findIndex((member: any) => member.user_id === rule.last_user_id);
      const next = singleBranchCode && activeMembers.length
        ? activeMembers[(currentIndex + 1 + activeMembers.length) % activeMembers.length]
        : null;
      return { ...rule, branch_codes: branchCodes, next_user_id: next?.user_id || null, next_user_name: next?.full_name || null };
    });

    return response.status(200).json({
      ok: true,
      statuses,
      templates,
      mappings,
      quality: quality[0],
      automaticTemplateSettings: automaticTemplateSettings[0] || { cash_total_customers_template_enabled: false, finance_call_center_template_enabled: false },
      endpoints,
      branches,
      sources,
      customerFields,
      assignmentRules: rules,
      assignmentLogs,
      assignmentUsers,
      bulkCashAgents,
      kpiSectionPermissions: {
        speedUserIds: (kpiSectionPermissionRows as any[]).filter((row) => row.section_code === "speed").map((row) => row.user_id),
        efficiencyUserIds: (kpiSectionPermissionRows as any[]).filter((row) => row.section_code === "efficiency").map((row) => row.user_id),
        rows: kpiSectionPermissionRows,
      },
    });
  }

  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method || "")) return response.status(405).json({ ok: false, error: "Method not allowed" });
  const body = parseBody(request);
  const section = clean(body.section);
  const action = clean(body.action || (request.method === "DELETE" ? "delete" : "save"));

  if (section === "bulk_cash_reallocation") {
    if (!canManageBulkReallocation) {
      return response.status(403).json({ ok: false, error: "النقل الجماعي متاح لمدير النظام فقط" });
    }
    try {
      if (action === "preview") {
        const preview = await previewFinanceToCashReallocation(body.agentIds);
        return response.status(200).json({ ok: true, preview });
      }
      if (action === "execute") {
        const result = await executeFinanceToCashReallocation({
          agentIds: body.agentIds,
          expectedLeadCount: body.expectedLeadCount,
          actor: user,
        });
        return response.status(200).json({
          ok: true,
          ...result,
          message: `تم نقل وتوزيع ${result.total} عميل من مبيعات التمويل بحالة عميل جديد بالتساوي على مناديب مبيعات الكاش`,
        });
      }
      return response.status(400).json({ ok: false, error: "عملية النقل الجماعي غير معروفة" });
    } catch (error) {
      if (error instanceof CrmBulkReallocationError) {
        return response.status(error.status).json({ ok: false, code: error.code, error: error.message });
      }
      throw error;
    }
  }

  if (section === "status") {
    const id = clean(body.id);
    if (!id) return response.status(400).json({ ok: false, error: "رقم الحالة مطلوب" });
    if (action === "delete") {
      await sql`delete from crm.dashboard_statuses where id=${id}`;
      await audit(user, "crm_status_deleted", "dashboard_status", id);
      return response.status(200).json({ ok: true });
    }
    const [row] = await sql<any[]>`
      insert into crm.dashboard_statuses(id,department_code,label,value,sort_order,is_active,show_on_dashboard,updated_at)
      values (${id},${clean(body.departmentCode)},${clean(body.label)},${clean(body.value)},${Number(body.sortOrder||0)},${body.isActive!==false},${body.showOnDashboard!==false},now())
      on conflict (id) do update set department_code=excluded.department_code,label=excluded.label,value=excluded.value,sort_order=excluded.sort_order,is_active=excluded.is_active,show_on_dashboard=excluded.show_on_dashboard,updated_at=now()
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
    const canToggleVisibility = existing?.field_key === "department_transfer";
    const isActive = locked && !canToggleVisibility ? true : body.isActive !== false;
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

  if (section === "automatic_template_settings") {
    const [row] = await sql<any[]>`
      update crm.crm_runtime_settings set
        cash_total_customers_template_enabled=${body.cashTotalCustomersEnabled === true},
        finance_call_center_template_enabled=${body.financeCallCenterEnabled === true},
        updated_at=now()
      where id='default'
      returning cash_total_customers_template_enabled,finance_call_center_template_enabled
    `;
    await audit(user, "crm_automatic_template_settings_saved", "crm_runtime_settings", "default", row);
    return response.status(200).json({ ok: true, row, message: "تم حفظ إعدادات الإرسال التلقائي" });
  }

  if (section === "kpi_section_permissions") {
    const speedUserIds = [...new Set(stringList(body.speedUserIds))];
    const efficiencyUserIds = [...new Set(stringList(body.efficiencyUserIds))];
    const allUserIds = [...new Set([...speedUserIds, ...efficiencyUserIds])];
    if (allUserIds.length) {
      const activeUsers = await sql<{ id: string }[]>`select id::text from core.users where is_active=true and id=any(${allUserIds}::uuid[])`;
      const activeIds = new Set(activeUsers.map((row) => row.id));
      const invalidIds = allUserIds.filter((id) => !activeIds.has(id));
      if (invalidIds.length) return response.status(400).json({ ok: false, error: "يوجد مستخدم غير نشط أو غير موجود ضمن الاختيارات" });
    }
    const before = await sql<any[]>`select section_code,user_id::text from crm.kpi_section_permissions order by section_code,user_id`;
    await sql.begin(async (tx) => {
      await tx`delete from crm.kpi_section_permissions where section_code in ('speed','efficiency')`;
      if (speedUserIds.length) {
        await tx`
          insert into crm.kpi_section_permissions(section_code,user_id,created_by,updated_at)
          select 'speed',value::uuid,${user.id}::uuid,now() from unnest(${speedUserIds}::text[]) value
        `;
      }
      if (efficiencyUserIds.length) {
        await tx`
          insert into crm.kpi_section_permissions(section_code,user_id,created_by,updated_at)
          select 'efficiency',value::uuid,${user.id}::uuid,now() from unnest(${efficiencyUserIds}::text[]) value
        `;
      }
    });
    const after = { speedUserIds, efficiencyUserIds };
    await audit(user, "crm_kpi_section_permissions_saved", "kpi_section_permissions", "default", after, before);
    return response.status(200).json({ ok: true, ...after, message: "تم حفظ مسؤولي السرعة والكفاءة" });
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
    return response.status(410).json({ ok: false, error: "إدارة الفروع نُقلت إلى الإعدادات المركزية > المستخدمون والصلاحيات > الفروع والأقسام" });
  }

  if (section === "assignment_rule") {
    if (!hasPermission(user, "crm.routing.manage")) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لإدارة قواعد توزيع العملاء" });
    const id = clean(body.id);
    if (action === "delete") {
      await sql`update crm.assignment_rules set is_active=false,updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid`;
      return response.status(200).json({ ok: true });
    }
    const name = clean(body.name);
    const departmentCode = clean(body.departmentCode);
    const memberIds = [...new Set(stringList(body.memberIds))];
    const branchCodes = [...new Set(stringList(body.branchCodes))];
    if (!name || !departmentCode) return response.status(400).json({ ok: false, error: "اسم القاعدة والقسم مطلوبان" });
    if (!memberIds.length) return response.status(400).json({ ok: false, error: "اختار موظفًا واحدًا على الأقل في قاعدة التوزيع" });

    if (branchCodes.length) {
      const validBranches = await sql<any[]>`select code from core.branches where is_active=true and code=any(${branchCodes}::text[])`;
      if (validBranches.length !== branchCodes.length) return response.status(400).json({ ok: false, error: "يوجد فرع غير صالح ضمن فروع قاعدة التوزيع" });
    }

    const eligibleMembers = await sql<any[]>`
      select u.id::text
      from core.users u
      where u.id=any(${memberIds}::uuid[])
        and u.is_active=true
        and u.can_receive_leads=true
        and (
          exists (
            select 1
            from core.user_system_departments usd
            join core.departments d on d.id=usd.department_id and d.is_active=true
            where usd.user_id=u.id and usd.system_code='crm' and d.code=${departmentCode}
          )
          or (
            not exists (select 1 from core.user_system_departments usd where usd.user_id=u.id and usd.system_code='crm')
            and exists (
              select 1
              from core.user_departments ud
              join core.departments d on d.id=ud.department_id and d.is_active=true
              where ud.user_id=u.id and d.code=${departmentCode}
            )
          )
        )
        and (
          (
            ${branchCodes.length === 0}::boolean
            and (
              exists (
                select 1
                from core.user_system_branches usb
                join core.branches b on b.id=usb.branch_id and b.is_active=true
                where usb.user_id=u.id and usb.system_code='crm'
              )
              or (
                not exists (select 1 from core.user_system_branches usb where usb.user_id=u.id and usb.system_code='crm')
                and exists (
                  select 1
                  from core.user_branches ub
                  join core.branches b on b.id=ub.branch_id and b.is_active=true
                  where ub.user_id=u.id
                )
              )
            )
          )
          or (
            ${branchCodes.length > 0}::boolean
            and (
              exists (
                select 1
                from core.user_system_branches usb
                join core.branches b on b.id=usb.branch_id and b.is_active=true
                where usb.user_id=u.id and usb.system_code='crm' and b.code=any(${branchCodes}::text[])
              )
              or (
                not exists (select 1 from core.user_system_branches usb where usb.user_id=u.id and usb.system_code='crm')
                and exists (
                  select 1
                  from core.user_branches ub
                  join core.branches b on b.id=ub.branch_id and b.is_active=true
                  where ub.user_id=u.id and b.code=any(${branchCodes}::text[])
                )
              )
            )
          )
        )
    `;
    const eligibleMemberIds = new Set(eligibleMembers.map((row: any) => row.id));
    if (memberIds.some((memberId) => !eligibleMemberIds.has(memberId))) {
      return response.status(400).json({ ok: false, error: "الموظفون المختارون يجب أن يكونوا من مناديب القسم والفروع المحددة ومفعّلين لاستقبال العملاء" });
    }

    const sourceCodes = stringList(body.sourceCodes);
    const [rule] = id
      ? await sql<any[]>`
          update crm.assignment_rules set name=${name},department_code=${departmentCode},branch_codes=${branchCodes},source_codes=${sourceCodes},assignment_mode='round_robin',prevent_consecutive=${body.preventConsecutive!==false},sort_order=${Number(body.sortOrder||0)},is_active=${body.isActive!==false},updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid returning *,id::text
        `
      : await sql<any[]>`
          insert into crm.assignment_rules(name,department_code,branch_codes,source_codes,assignment_mode,prevent_consecutive,sort_order,is_active,created_by,updated_by)
          values (${name},${departmentCode},${branchCodes},${sourceCodes},'round_robin',${body.preventConsecutive!==false},${Number(body.sortOrder||0)},${body.isActive!==false},${user.id}::uuid,${user.id}::uuid) returning *,id::text
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
    await audit(user, "assignment_rule_saved", "assignment_rule", rule.id, { ...rule, branchCodes, memberIds });
    return response.status(200).json({ ok: true, row: rule });
  }

  if (section === "assignment_member") {
    if (!hasPermission(user, "crm.routing.manage")) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لإدارة قواعد توزيع العملاء" });
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
