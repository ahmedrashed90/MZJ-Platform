import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, isCrmManager, parseBody, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "إعدادات CRM متاحة للإدارة فقط" });
  const sql = getSql();

  if (request.method === "GET") {
    const [statuses, templates, mappings, quality, endpoints, branches] = await Promise.all([
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
    ]);
    return response.status(200).json({ ok: true, statuses, templates, mappings, quality: quality[0], endpoints, branches });
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

  if (section === "template") {
    const id = clean(body.id);
    if (action === "delete") {
      await sql`delete from crm.message_templates where id=${id}::uuid`;
      return response.status(200).json({ ok: true });
    }
    const displayName = clean(body.displayName || body.name);
    const content = clean(body.content);
    if (!displayName || !content) return response.status(400).json({ ok: false, error: "الاسم الظاهر ومحتوى الرسالة مطلوبان" });
    const departments = Array.isArray(body.departments) ? body.departments.map(clean).filter(Boolean) : [];
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
    const marketingNumeratorStatuses = Array.isArray(body.marketingNumeratorStatuses) ? body.marketingNumeratorStatuses.map(clean).filter(Boolean) : [];
    const marketingDenominatorStatuses = Array.isArray(body.marketingDenominatorStatuses) ? body.marketingDenominatorStatuses.map(clean).filter(Boolean) : [];
    const salesNumeratorStatuses = Array.isArray(body.salesNumeratorStatuses) ? body.salesNumeratorStatuses.map(clean).filter(Boolean) : [];
    const salesDenominatorStatuses = Array.isArray(body.salesDenominatorStatuses) ? body.salesDenominatorStatuses.map(clean).filter(Boolean) : [];
    if (!marketingNumeratorStatuses.length || !salesNumeratorStatuses.length) return response.status(400).json({ ok: false, error: "اختار حالات البسط للمؤشرات" });
    const [row] = await sql<any[]>`
      update crm.report_quality_settings set
        marketing_numerator_statuses=${marketingNumeratorStatuses},marketing_denominator_mode=${clean(body.marketingDenominatorMode)||"all"},marketing_denominator_statuses=${marketingDenominatorStatuses},
        sales_numerator_statuses=${salesNumeratorStatuses},sales_denominator_mode=${clean(body.salesDenominatorMode)||"statuses"},sales_denominator_statuses=${salesDenominatorStatuses},updated_by=${user.id}::uuid,updated_at=now()
      where id='default' returning *
    `;
    return response.status(200).json({ ok: true, row });
  }

  if (section === "endpoint") {
    const sourceCode = clean(body.sourceCode);
    if (!sourceCode) return response.status(400).json({ ok: false, error: "المصدر مطلوب" });
    const [row] = await sql<any[]>`
      insert into crm.integration_endpoints(source_code,display_name,send_url,webhook_url,health_url,secret_name,is_active,updated_by,updated_at)
      values (${sourceCode},${clean(body.displayName)||sourceCode},${clean(body.sendUrl)||null},${clean(body.webhookUrl)||null},${clean(body.healthUrl)||null},${clean(body.secretName)||null},${body.isActive!==false},${user.id}::uuid,now())
      on conflict (source_code) do update set display_name=excluded.display_name,send_url=excluded.send_url,webhook_url=excluded.webhook_url,health_url=excluded.health_url,secret_name=excluded.secret_name,is_active=excluded.is_active,updated_by=excluded.updated_by,updated_at=now()
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

  return response.status(400).json({ ok: false, error: "قسم الإعدادات غير معروف" });
}
