import type { VercelRequest } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { getSql } from "../_db.js";
import { clean, dateValue, hasPermission, isAdmin, pageValues } from "./common.js";

function campaignAccess(sql: ReturnType<typeof getSql>, user: SessionUser) {
  if (isAdmin(user) || hasPermission(user, "marketing.campaigns.manage") || hasPermission(user, "marketing.tasks.review")) return sql`true`;
  return sql`exists(select 1 from marketing.tasks ax where ax.campaign_id=c.id and ax.assigned_to=${user.id}::uuid)`;
}

export async function dashboard(user: SessionUser) {
  const sql = getSql();
  const access = campaignAccess(sql, user);
  const adminMode = isAdmin(user) || hasPermission(user, "marketing.campaigns.manage") || hasPermission(user, "marketing.tasks.review");
  const [stats] = await sql<any[]>`
    select
      count(distinct c.id)::int campaigns,
      count(distinct t.id)::int tasks,
      count(distinct t.department_code)::int departments,
      count(distinct v.id)::int stock_cars,
      count(distinct c.id) filter(where c.progress_percent>=100 or c.status='completed')::int completed_campaigns,
      count(distinct c.id) filter(where c.released_at is null and c.progress_percent<100 and c.status not in ('archived','cancelled'))::int active_campaigns,
      count(distinct t.id) filter(where t.due_at<now() and t.progress_percent<100)::int delayed_tasks,
      count(distinct t.id) filter(where t.status in ('template_submitted','under_review'))::int under_review
    from marketing.campaigns c
    left join marketing.tasks t on t.campaign_id=c.id
    left join operations.vehicles v on v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true
    where c.is_deleted=false and c.status<>'archived' and ${access}
  `;
  const campaigns = await sql<any[]>`
    select c.id::text,c.campaign_code,c.name,c.campaign_type,c.source_type,c.status,c.objective,c.publish_start_date,c.publish_end_date,c.progress_percent,c.updated_at,c.released_at,c.archived_at,
      coalesce(d.departments,'[]'::json) departments,coalesce(d.task_count,0)::int task_count,coalesce(d.started_count,0)::int started_count,
      coalesce(d.completed_count,0)::int completed_count,coalesce(d.delayed_count,0)::int delayed_count,
      coalesce(d.users,'[]'::json) users
    from marketing.campaigns c
    left join lateral (
      select count(*)::int task_count,count(*) filter(where t.progress_percent>0)::int started_count,count(*) filter(where t.progress_percent>=100)::int completed_count,
        count(*) filter(where t.due_at<now() and t.progress_percent<100)::int delayed_count,
        json_agg(distinct jsonb_build_object('code',t.department_code,'name',coalesce(dm.display_name,t.department_code),'progress',coalesce(dp.progress,0),'task_count',coalesce(dp.task_count,0),'started_count',coalesce(dp.started_count,0))) filter(where t.id is not null) departments,
        json_agg(distinct jsonb_build_object('id',u.id::text,'name',u.full_name,'department',t.department_code,'task_type',t.task_type)) filter(where u.id is not null) users
      from marketing.tasks t
      left join core.users u on u.id=t.assigned_to
      left join marketing.department_mappings dm on dm.department_code=t.department_code
      left join lateral (
        select round(avg(tx.progress_percent))::int progress,count(*)::int task_count,count(*) filter(where tx.progress_percent>0)::int started_count
        from marketing.tasks tx where tx.campaign_id=c.id and tx.department_code=t.department_code
      ) dp on true
      where t.campaign_id=c.id
    ) d on true
    where c.is_deleted=false and c.status<>'archived' and ${access}
    order by case when c.progress_percent<100 then 0 else 1 end,c.updated_at desc limit 100
  `;
  const taskProjection = sql`
    select t.id::text,t.task_code,t.task_type,t.title,t.status,t.progress_percent,t.due_at,t.received_at,t.completed_at,t.user_completed_at,t.department_code,
      t.assigned_to::text,t.paired_content_user_id::text,c.id::text campaign_id,c.campaign_code,c.name campaign_name,c.source_type,c.released_at,
      cr.id::text creative_id,cr.creative_name,cr.instance_code,dm.display_name department_name,u.full_name assigned_to_name,cu.full_name content_user_name,
      ca.writer_due_date,ca.department_note,ca.content_note,
      coalesce(a.actions,'[]'::json) actions
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id left join marketing.creatives cr on cr.id=t.creative_id
    left join marketing.department_mappings dm on dm.department_code=t.department_code left join core.users u on u.id=t.assigned_to
    left join core.users cu on cu.id=t.paired_content_user_id left join marketing.creative_assignments ca on ca.id=t.assignment_id
    left join lateral (select json_agg(json_build_object('id',x.id::text,'name',x.action_name,'order',x.action_order,'weight',x.weight,'admin_only',x.is_admin_only,'completed',x.is_completed) order by x.action_order) actions from marketing.task_action_events x where x.task_id=t.id) a on true
  `;
  const ownTasks = await sql<any[]>`
    ${taskProjection}
    where c.is_deleted=false and t.assigned_to=${user.id}::uuid
    order by case when t.due_at<now() and t.progress_percent<100 then 0 else 1 end,t.due_at nulls last,t.updated_at desc
  `;
  const adminTasks = adminMode ? await sql<any[]>`
    ${taskProjection}
    where c.is_deleted=false and c.status<>'archived'
    order by case t.department_code when 'content' then 1 when 'montage' then 2 when 'photography' then 3 when 'design' then 4 when 'publishing' then 5 else 6 end,
      c.updated_at desc,t.task_type,t.task_code
  ` : [];
  const archiveTasks = adminMode ? await sql<any[]>`
    ${taskProjection}
    where c.is_deleted=false and (t.status='completed' or t.user_completed_at is not null)
    order by coalesce(t.completed_at,t.user_completed_at,t.updated_at) desc limit 100
  ` : [];
  const notifications = await sql<any[]>`
    select t.id::text,t.task_code,t.status,t.updated_at,c.name campaign_name,cr.creative_name
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id left join marketing.creatives cr on cr.id=t.creative_id
    where c.is_deleted=false and (
      (t.assigned_to=${user.id}::uuid and t.status in ('ready','changes_requested'))
      or (${isAdmin(user) || hasPermission(user,"marketing.tasks.review")}=true and t.status in ('template_submitted','under_review'))
    ) order by t.updated_at desc limit 30
  `;
  return { ok: true, mode: adminMode ? "admin" : "user", stats: stats || {}, campaigns, ownTasks, adminTasks, archiveTasks, notifications };
}

export async function reports(request: VercelRequest, user: SessionUser) {
  const sql = getSql();
  const { page, pageSize, offset } = pageValues(request);
  const search = clean(request.query.search);
  const from = dateValue(request.query.from);
  const to = dateValue(request.query.to);
  const status = clean(request.query.status);
  const sourceType = clean(request.query.sourceType);
  const pattern = `%${search}%`;
  const access = campaignAccess(sql, user);
  const where = sql`
    c.is_deleted=false and ${access}
    and (${search}='' or c.name ilike ${pattern} or coalesce(c.campaign_code,'') ilike ${pattern})
    and (${from}='' or c.campaign_date>=nullif(${from}::text,'')::date)
    and (${to}='' or c.campaign_date<=nullif(${to}::text,'')::date)
    and (${status}='' or c.status=${status})
    and (${sourceType}='' or c.source_type=${sourceType})
  `;
  const [count] = await sql<{total:number}[]>`select count(*)::int total from marketing.campaigns c where ${where}`;
  const rows = await sql<any[]>`
    select c.id::text,c.campaign_date,c.campaign_code,c.name,c.campaign_type,c.objective,c.publish_start_date,c.publish_end_date,c.status,c.source_type,c.progress_percent,c.created_at,c.updated_at,
      coalesce(x.task_count,0)::int task_count,coalesce(x.completed_tasks,0)::int completed_tasks,coalesce(x.departments,'[]'::json) departments,coalesce(x.users,'[]'::json) users,
      coalesce(b.total_budget,0)::numeric total_budget,coalesce(p.published_targets,0)::int published_targets,coalesce(p.failed_targets,0)::int failed_targets
    from marketing.campaigns c
    left join lateral (
      select count(*)::int task_count,count(*) filter(where t.progress_percent>=100)::int completed_tasks,
        json_agg(distinct coalesce(dm.display_name,t.department_code)) filter(where t.id is not null) departments,
        json_agg(distinct u.full_name) filter(where u.id is not null) users
      from marketing.tasks t left join marketing.department_mappings dm on dm.department_code=t.department_code left join core.users u on u.id=t.assigned_to where t.campaign_id=c.id
    ) x on true
    left join lateral (select coalesce(sum(bp.amount),0) total_budget from marketing.campaign_budget_items bi join marketing.campaign_budget_platforms bp on bp.budget_item_id=bi.id where bi.campaign_id=c.id) b on true
    left join lateral (select count(*) filter(where pt.status='published')::int published_targets,count(*) filter(where pt.status='failed')::int failed_targets from marketing.publish_targets pt join marketing.publish_prep_items pi on pi.id=pt.publish_prep_item_id where pi.campaign_id=c.id) p on true
    where ${where} order by c.campaign_date desc,c.updated_at desc limit ${pageSize} offset ${offset}
  `;
  const userSummary = await sql<any[]>`
    select u.id::text user_id,u.full_name,t.department_code,t.task_type,count(*)::int task_count,round(avg(t.progress_percent))::int average_progress,
      count(*) filter(where t.progress_percent>=100)::int completed_count,count(*) filter(where t.due_at<now() and t.progress_percent<100)::int delayed_count
    from marketing.tasks t join core.users u on u.id=t.assigned_to join marketing.campaigns c on c.id=t.campaign_id
    where ${where}
    group by u.id,u.full_name,t.department_code,t.task_type
    order by case t.department_code when 'content' then 1 when 'montage' then 2 when 'photography' then 3 when 'design' then 4 else 5 end,u.full_name
  `;
  return { ok: true, rows, total: Number(count?.total || 0), page, pageSize, userSummary };
}

export async function calendar(request: VercelRequest, user: SessionUser) {
  const sql = getSql();
  const month = clean(request.query.month) || new Date().toISOString().slice(0, 7);
  const access = campaignAccess(sql, user);
  const original = await sql<any[]>`
    select si.id::text schedule_id,si.publish_date,si.caption,si.hashtags,c.id::text campaign_id,c.campaign_code,c.name campaign_name,c.source_type,
      cr.id::text creative_id,cr.creative_name,cr.instance_code,pc.code platform_code,pc.name platform_name,pt.name post_type_name,st.publish_time,st.status,'schedule' source
    from marketing.publish_schedule_items si join marketing.campaigns c on c.id=si.campaign_id join marketing.creatives cr on cr.id=si.creative_id
    join marketing.publish_schedule_targets st on st.schedule_item_id=si.id join marketing.platform_catalog pc on pc.id=st.platform_id join marketing.platform_post_types pt on pt.id=st.post_type_id
    where c.is_deleted=false and to_char(si.publish_date,'YYYY-MM')=${month} and ${access}
      and not exists (
        select 1 from marketing.publish_prep_items pi join marketing.publish_targets ptx on ptx.publish_prep_item_id=pi.id
        where pi.campaign_id=si.campaign_id and pi.creative_id=si.creative_id and ptx.platform_id=st.platform_id and ptx.post_type_id=st.post_type_id
      )
  `;
  const prepared = await sql<any[]>`
    select pi.id::text prep_id,(pt.scheduled_at at time zone 'Asia/Riyadh')::date publish_date,pi.caption,pi.hashtags,c.id::text campaign_id,c.campaign_code,c.name campaign_name,c.source_type,
      cr.id::text creative_id,cr.creative_name,cr.instance_code,pc.code platform_code,pc.name platform_name,pst.name post_type_name,
      (pt.scheduled_at at time zone 'Asia/Riyadh')::time publish_time,pt.status,'publish_prep' source,pt.published_url,pt.error_message
    from marketing.publish_prep_items pi join marketing.publish_targets pt on pt.publish_prep_item_id=pi.id
    join marketing.campaigns c on c.id=pi.campaign_id join marketing.creatives cr on cr.id=pi.creative_id join marketing.platform_catalog pc on pc.id=pt.platform_id left join marketing.platform_post_types pst on pst.id=pt.post_type_id
    where c.is_deleted=false and pt.scheduled_at is not null and to_char(pt.scheduled_at at time zone 'Asia/Riyadh','YYYY-MM')=${month} and ${access}
  `;
  return { ok: true, month, rows: [...original, ...prepared].sort((a,b) => String(a.publish_date).localeCompare(String(b.publish_date))) };
}

export async function receiptCalendar(request: VercelRequest, user: SessionUser) {
  const sql = getSql();
  const month = clean(request.query.month) || new Date().toISOString().slice(0, 7);
  const scope = isAdmin(user) || hasPermission(user, "marketing.tasks.review") ? sql`true` : sql`t.assigned_to=${user.id}::uuid`;
  const rows = await sql<any[]>`
    select t.id::text,t.task_code,t.task_type,t.status,t.progress_percent,t.due_at::date due_date,t.department_code,dm.display_name department_name,
      c.id::text campaign_id,c.campaign_code,c.name campaign_name,c.source_type,cr.creative_name,cr.instance_code,u.full_name assigned_to_name,cu.full_name content_user_name
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id left join marketing.creatives cr on cr.id=t.creative_id
    left join core.users u on u.id=t.assigned_to left join core.users cu on cu.id=t.paired_content_user_id left join marketing.department_mappings dm on dm.department_code=t.department_code
    where c.is_deleted=false and t.due_at is not null and to_char(t.due_at at time zone 'Asia/Riyadh','YYYY-MM')=${month} and ${scope}
    order by t.due_at,t.department_code,t.task_code
  `;
  return { ok: true, month, rows };
}
