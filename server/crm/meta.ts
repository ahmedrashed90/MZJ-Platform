import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();

  const [statuses, branches, users, sources, quality, endpoints, templates, mappings, customerFields] = await Promise.all([
    sql`select id, department_code, label, value, sort_order, is_active from crm.dashboard_statuses order by department_code, sort_order`,
    sql`select code, name, is_active, sort_order from core.branches where is_active = true order by sort_order, name`,
    sql`
      select u.id::text, u.full_name, u.employee_no, u.is_active, u.can_receive_leads,
        coalesce(array_agg(distinct d.code) filter (where d.code is not null), '{}') as department_codes,
        coalesce(array_agg(distinct d.name) filter (where d.name is not null), '{}') as departments,
        coalesce(array_agg(distinct b.code) filter (where b.code is not null), '{}') as branch_codes,
        coalesce(array_agg(distinct b.name) filter (where b.name is not null), '{}') as branches,
        coalesce(array_agg(distinct r.code) filter (where r.code is not null), '{}') as role_codes
      from core.users u
      left join core.user_departments ud on ud.user_id = u.id
      left join core.departments d on d.id = ud.department_id
      left join core.user_branches ub on ub.user_id = u.id
      left join core.branches b on b.id = ub.branch_id
      left join core.user_roles ur on ur.user_id = u.id
      left join core.roles r on r.id = ur.role_id
      where u.is_active = true
      group by u.id
      order by u.full_name
    `,
    sql`select code,name,sort_order,system_codes,delivery_route,allow_free_text from core.sources where is_active=true order by sort_order,name`,
    sql`select * from crm.report_quality_settings where id = 'default'`,
    sql`select source_code, display_name, send_url, templates_sync_url, inbound_webhook_url, health_url, secret_name, is_active from crm.integration_endpoints order by display_name`,
    sql`select id::text,display_name,content,template_type,provider,departments from crm.message_templates where is_active=true order by display_name`,
    sql`select id::text,department_code,status_value,status_label,template_id::text,message_type from crm.status_template_mappings where is_active=true`,
    sql`select id::text,field_key,label,field_type,sort_order,department_keys,is_active,is_required,include_in_completion,options,is_system,is_locked from crm.customer_field_definitions where is_active=true order by sort_order,label`,
  ]);

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({ ok: true, statuses, branches, users, sources, quality: quality[0] || null, endpoints, templates, mappings, customerFields });
}
