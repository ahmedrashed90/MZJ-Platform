import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "./_db.js";
import { requireUser } from "./_auth.js";
import { hasPermission, logSecurityEvent } from "./_access-control.js";
import { buildActivityDetails } from "./_activity-details.js";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function bodyObject(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, unknown>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { return {}; }
  }
  return {};
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  const user = await requireUser(request, response);
  if (!user) return;

  if (request.method === "POST") {
    const payload = bodyObject(request);
    if (clean(payload.action) !== "page_view") return response.status(400).json({ ok: false, error: "الإجراء غير مدعوم" });
    const path = clean(payload.path).slice(0, 300);
    const title = clean(payload.title).slice(0, 180);
    if (!path.startsWith("/")) return response.status(400).json({ ok: false, error: "مسار الصفحة غير صحيح" });
    await logSecurityEvent({
      request,
      user,
      systemCode: clean(payload.systemCode) || "core",
      pageCode: path.slice(1).split("/")[0] || "dashboard",
      action: "page_view",
      entityType: "page",
      entityId: path,
      result: "success",
      afterData: { path, title: title || null },
    });
    return response.status(200).json({ ok: true });
  }

  const canDeleteActivity = hasPermission(user, "platform.superadmin");
  const sql = getSql();

  if (request.method === "DELETE") {
    if (!canDeleteActivity) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لمسح سجل النشاط" });
    const payload = bodyObject(request);
    const dateFrom = validDate(clean(payload.dateFrom));
    const dateTo = validDate(clean(payload.dateTo));
    if (!dateFrom && !dateTo) return response.status(400).json({ ok: false, error: "حدد تاريخ البداية أو تاريخ النهاية لمسح السجل" });
    if (dateFrom && dateTo && dateFrom > dateTo) return response.status(400).json({ ok: false, error: "تاريخ البداية يجب أن يكون قبل تاريخ النهاية" });

    const deleted = await sql<{ id: string }[]>`
      delete from audit.activity_log
      where (${dateFrom}='' or created_at >= ${dateFrom || "1970-01-01"}::date)
        and (${dateTo}='' or created_at < (${dateTo || "2999-12-31"}::date + interval '1 day'))
      returning id::text
    `;
    await logSecurityEvent({
      request,
      user,
      systemCode: "core",
      pageCode: "activity",
      permissionCode: "platform.superadmin",
      action: "activity_log_deleted",
      entityType: "activity_log",
      result: "success",
      afterData: { dateFrom: dateFrom || null, dateTo: dateTo || null, deletedCount: deleted.length },
    });
    return response.status(200).json({ ok: true, deletedCount: deleted.length });
  }

  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  if (!hasPermission(user, "platform.activity.view")) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لعرض سجل النشاط" });
  const search = clean(request.query.search).slice(0, 160);
  const system = clean(request.query.system).slice(0, 40);
  const action = clean(request.query.action).slice(0, 100);
  const result = clean(request.query.result).slice(0, 30);
  const actor = clean(request.query.actor).slice(0, 160);
  const dateFrom = validDate(clean(request.query.dateFrom));
  const dateTo = validDate(clean(request.query.dateTo));
  const page = number(request.query.page, 1, 1, 100000);
  const pageSize = number(request.query.pageSize, 50, 10, 100);
  const offset = (page - 1) * pageSize;
  const like = `%${search}%`;
  const actorLike = `%${actor}%`;

  const [rows, totals, systems, actions] = await Promise.all([
    sql<any[]>`
      select
        l.id::text,
        l.user_id::text,
        coalesce(u.full_name,l.user_email,'مستخدم غير معروف') as user_name,
        coalesce(l.user_email,u.email) as user_email,
        l.user_role,
        l.system_code,
        l.page_code,
        l.permission_code,
        l.action,
        l.entity_type,
        l.entity_id,
        l.before_data,
        l.after_data,
        host(l.ip_address) as ip_address,
        l.user_agent,
        l.result,
        l.rejection_reason,
        l.request_id,
        l.created_at,
        ov.vin as activity_vehicle_vin,
        ov.car_name as activity_vehicle_name,
        ov.statement as activity_vehicle_statement,
        ol.name as activity_location_name,
        ovs.name as activity_current_status_name
      from audit.activity_log l
      left join core.users u on u.id=l.user_id
      left join operations.vehicles ov on l.entity_type='vehicle' and ov.id::text=l.entity_id
      left join operations.locations ol on ol.id=ov.location_id
      left join operations.vehicle_statuses ovs on ovs.code=ov.status_code
      where (${search}='' or concat_ws(' ',coalesce(u.full_name,''),coalesce(l.user_email,''),coalesce(l.action,''),coalesce(l.entity_type,''),coalesce(l.entity_id,''),coalesce(l.page_code,''),coalesce(l.permission_code,'')) ilike ${like})
        and (${system}='' or l.system_code=${system})
        and (${action}='' or l.action=${action})
        and (${result}='' or l.result=${result})
        and (${actor}='' or concat_ws(' ',coalesce(u.full_name,''),coalesce(l.user_email,'')) ilike ${actorLike})
        and (${dateFrom}='' or l.created_at >= ${dateFrom || "1970-01-01"}::date)
        and (${dateTo}='' or l.created_at < (${dateTo || "2999-12-31"}::date + interval '1 day'))
      order by l.created_at desc,l.id desc
      limit ${pageSize} offset ${offset}
    `,
    sql<any[]>`
      select
        count(*)::int as total,
        count(*) filter (where l.created_at >= date_trunc('day',now()))::int as today,
        count(*) filter (where coalesce(l.result,'success') in ('failure','denied'))::int as failed,
        count(distinct l.user_id) filter (where l.created_at >= now()-interval '24 hours')::int as active_users,
        count(*) filter (where l.action='page_view' and l.created_at >= now()-interval '24 hours')::int as page_views
      from audit.activity_log l
      left join core.users u on u.id=l.user_id
      where (${search}='' or concat_ws(' ',coalesce(u.full_name,''),coalesce(l.user_email,''),coalesce(l.action,''),coalesce(l.entity_type,''),coalesce(l.entity_id,''),coalesce(l.page_code,''),coalesce(l.permission_code,'')) ilike ${like})
        and (${system}='' or l.system_code=${system})
        and (${action}='' or l.action=${action})
        and (${result}='' or l.result=${result})
        and (${actor}='' or concat_ws(' ',coalesce(u.full_name,''),coalesce(l.user_email,'')) ilike ${actorLike})
        and (${dateFrom}='' or l.created_at >= ${dateFrom || "1970-01-01"}::date)
        and (${dateTo}='' or l.created_at < (${dateTo || "2999-12-31"}::date + interval '1 day'))
    `,
    sql<{ system_code: string }[]>`select distinct system_code from audit.activity_log where system_code is not null order by system_code`,
    sql<{ action: string }[]>`select action from audit.activity_log where action is not null group by action order by max(created_at) desc limit 150`,
  ]);

  const detailedRows = rows.map((row) => {
    const details = buildActivityDetails(row);
    const { before_data: _beforeData, after_data: _afterData, ...publicRow } = row;
    return { ...publicRow, ...details };
  });

  return response.status(200).json({
    ok: true,
    rows: detailedRows,
    total: Number(totals[0]?.total || 0),
    stats: {
      today: Number(totals[0]?.today || 0),
      failed: Number(totals[0]?.failed || 0),
      activeUsers: Number(totals[0]?.active_users || 0),
      pageViews: Number(totals[0]?.page_views || 0),
    },
    filters: {
      systems: systems.map((item) => item.system_code),
      actions: actions.map((item) => item.action),
    },
    page,
    pageSize,
    canDelete: canDeleteActivity,
  });
}
