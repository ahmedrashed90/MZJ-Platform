import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();

  const [statuses, branches, users, sources, quality, endpoints, templates, mappings, customerFields] = await Promise.all([
    sql`select id, department_code, label, value, sort_order, is_active, show_on_dashboard from crm.dashboard_statuses order by department_code, sort_order`,
    sql`select code, name, is_active, sort_order from core.branches where is_active = true order by sort_order, name`,
    sql`
      select u.id::text, u.full_name, u.employee_no, u.is_active, u.can_receive_leads,
        coalesce(crm_departments.codes, global_departments.codes, '{}'::text[]) as department_codes,
        coalesce(crm_departments.names, global_departments.names, '{}'::text[]) as departments,
        coalesce(crm_branches.codes, global_branches.codes, '{}'::text[]) as branch_codes,
        coalesce(crm_branches.names, global_branches.names, '{}'::text[]) as branches,
        coalesce(user_roles.codes, '{}'::text[]) as role_codes,
        coalesce((crm_departments.codes)[1],(global_departments.codes)[1]) as primary_department_code,
        coalesce((crm_departments.names)[1],(global_departments.names)[1]) as primary_department_name,
        coalesce((crm_branches.codes)[1],(global_branches.codes)[1]) as primary_branch_code,
        coalesce((crm_branches.names)[1],(global_branches.names)[1]) as primary_branch_name
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
      left join lateral (
        select array_agg(distinct roles.code) as codes
        from (
          select r.code
          from core.user_roles ur join core.roles r on r.id=ur.role_id
          where ur.user_id=u.id
          union all
          select r.code
          from core.user_systems us join core.roles r on r.id=us.role_id
          where us.user_id=u.id and us.system_code='crm' and us.is_enabled=true
        ) roles
      ) user_roles on true
      where u.is_active = true
      order by u.full_name
    `,
    sql`select code,name,sort_order,system_codes,delivery_route,allow_free_text,report_group from core.sources where is_active=true order by sort_order,name`,
    sql`select * from crm.report_quality_settings where id = 'default'`,
    sql`select source_code, display_name, send_url, webhook_url, health_url, secret_name, is_active from crm.integration_endpoints order by display_name`,
    sql`select id::text,display_name,content,template_type,provider,departments from crm.message_templates where is_active=true order by display_name`,
    sql`select id::text,department_code,status_value,status_label,template_id::text,message_type from crm.status_template_mappings where is_active=true`,
    sql`select id::text,field_key,label,field_type,sort_order,department_keys,is_active,is_required,include_in_completion,options,is_system,is_locked from crm.customer_field_definitions where is_active=true order by sort_order,label`,
  ]);

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({ ok: true, statuses, branches, users, sources, quality: quality[0] || null, endpoints, templates, mappings, customerFields });
}
