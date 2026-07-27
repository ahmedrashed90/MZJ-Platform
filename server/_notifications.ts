import { getSql } from "./_db.js";
import { hasPermission, type PermissionUser } from "./_access-control.js";

export type NotificationSystem = "crm" | "marketing" | "operations" | "tracking";
export type NotificationSeverity = "info" | "success" | "warning" | "danger";

export type NotificationJsonValue =
  | string
  | number
  | boolean
  | null
  | NotificationJsonValue[]
  | { [key: string]: NotificationJsonValue };

export type NotificationPreferences = {
  soundEnabled: boolean;
  toastEnabled: boolean;
  toastDurationSeconds: 3 | 5 | 8 | 10;
  systemAlerts: Record<NotificationSystem, boolean>;
};

export type NotificationPreferencesInput = Partial<{
  soundEnabled: boolean;
  toastEnabled: boolean;
  toastDurationSeconds: number;
  systemAlerts: Partial<Record<NotificationSystem, boolean>>;
}>;

export type NotificationInput = {
  systemCode: NotificationSystem;
  eventType: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actionUrl?: string | null;
  severity?: NotificationSeverity;
  actorId?: string | null;
  actorName?: string | null;
  audienceUserIds?: Array<string | null | undefined>;
  branchCodes?: Array<string | null | undefined>;
  departmentCodes?: Array<string | null | undefined>;
  metadata?: { [key: string]: NotificationJsonValue };
  dedupeKey?: string | null;
};

let schemaPromise: Promise<void> | null = null;
const SYSTEMS: NotificationSystem[] = ["crm", "marketing", "operations", "tracking"];
const TOAST_DURATIONS = [3, 5, 8, 10] as const;
const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  soundEnabled: true,
  toastEnabled: true,
  toastDurationSeconds: 5,
  systemAlerts: { crm: true, marketing: true, operations: true, tracking: true },
};

function clean(value: unknown) { return String(value ?? "").trim(); }
function values(input?: Array<string | null | undefined>) { return [...new Set((input || []).map(clean).filter(Boolean))]; }
function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

export function isSystemAdministrator(user: Pick<PermissionUser, "roleCodes" | "permissions"> | null | undefined) {
  if (!user) return false;
  return hasPermission(user as PermissionUser, "platform.superadmin") || (user.roleCodes || []).some((code) => ["admin", "system_admin"].includes(code));
}

export async function ensureNotificationsSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const sql = getSql();
    await sql`
      create table if not exists core.notifications (
        id uuid primary key default gen_random_uuid(),
        system_code text not null check (system_code in ('crm','marketing','operations','tracking')),
        event_type text not null,
        title text not null,
        body text,
        entity_type text,
        entity_id text,
        action_url text,
        severity text not null default 'info' check (severity in ('info','success','warning','danger')),
        actor_id uuid references core.users(id) on delete set null,
        actor_name text,
        audience_user_ids uuid[] not null default '{}'::uuid[],
        branch_codes text[] not null default '{}'::text[],
        department_codes text[] not null default '{}'::text[],
        metadata jsonb not null default '{}'::jsonb,
        dedupe_key text,
        created_at timestamptz not null default now(),
        expires_at timestamptz
      )
    `;
    await sql`create unique index if not exists core_notifications_dedupe_unique on core.notifications(dedupe_key) where dedupe_key is not null`;
    await sql`create index if not exists core_notifications_system_created_idx on core.notifications(system_code,created_at desc)`;
    await sql`create index if not exists core_notifications_audience_idx on core.notifications using gin(audience_user_ids)`;
    await sql`
      create table if not exists core.notification_user_state (
        notification_id uuid not null references core.notifications(id) on delete cascade,
        user_id uuid not null references core.users(id) on delete cascade,
        read_at timestamptz,
        dismissed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key(notification_id,user_id)
      )
    `;
    await sql`create index if not exists core_notification_state_user_idx on core.notification_user_state(user_id,read_at,dismissed_at)`;
    await sql`
      create table if not exists core.notification_preferences (
        user_id uuid primary key references core.users(id) on delete cascade,
        sound_enabled boolean not null default true,
        toast_enabled boolean not null default true,
        toast_duration_seconds smallint not null default 5 check (toast_duration_seconds in (3,5,8,10)),
        crm_alerts_enabled boolean not null default true,
        marketing_alerts_enabled boolean not null default true,
        operations_alerts_enabled boolean not null default true,
        tracking_alerts_enabled boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
  })().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

function preferenceBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function preferenceDuration(value: unknown, fallback: NotificationPreferences["toastDurationSeconds"]) {
  const duration = Number(value);
  return TOAST_DURATIONS.includes(duration as (typeof TOAST_DURATIONS)[number])
    ? duration as NotificationPreferences["toastDurationSeconds"]
    : fallback;
}

function mapNotificationPreferences(row?: Record<string, unknown> | null): NotificationPreferences {
  return {
    soundEnabled: preferenceBoolean(row?.sound_enabled, DEFAULT_NOTIFICATION_PREFERENCES.soundEnabled),
    toastEnabled: preferenceBoolean(row?.toast_enabled, DEFAULT_NOTIFICATION_PREFERENCES.toastEnabled),
    toastDurationSeconds: preferenceDuration(row?.toast_duration_seconds, DEFAULT_NOTIFICATION_PREFERENCES.toastDurationSeconds),
    systemAlerts: {
      crm: preferenceBoolean(row?.crm_alerts_enabled, true),
      marketing: preferenceBoolean(row?.marketing_alerts_enabled, true),
      operations: preferenceBoolean(row?.operations_alerts_enabled, true),
      tracking: preferenceBoolean(row?.tracking_alerts_enabled, true),
    },
  };
}

export async function getNotificationPreferences(userId: string) {
  await ensureNotificationsSchema();
  const sql = getSql();
  const [row] = await sql<Record<string, unknown>[]>`
    select sound_enabled,toast_enabled,toast_duration_seconds,crm_alerts_enabled,marketing_alerts_enabled,
      operations_alerts_enabled,tracking_alerts_enabled
    from core.notification_preferences where user_id=${userId}::uuid
  `;
  return mapNotificationPreferences(row);
}

export async function saveNotificationPreferences(userId: string, input: NotificationPreferencesInput) {
  await ensureNotificationsSchema();
  const current = await getNotificationPreferences(userId);
  const next: NotificationPreferences = {
    soundEnabled: preferenceBoolean(input.soundEnabled, current.soundEnabled),
    toastEnabled: preferenceBoolean(input.toastEnabled, current.toastEnabled),
    toastDurationSeconds: preferenceDuration(input.toastDurationSeconds, current.toastDurationSeconds),
    systemAlerts: {
      crm: preferenceBoolean(input.systemAlerts?.crm, current.systemAlerts.crm),
      marketing: preferenceBoolean(input.systemAlerts?.marketing, current.systemAlerts.marketing),
      operations: preferenceBoolean(input.systemAlerts?.operations, current.systemAlerts.operations),
      tracking: preferenceBoolean(input.systemAlerts?.tracking, current.systemAlerts.tracking),
    },
  };
  const sql = getSql();
  const [row] = await sql<Record<string, unknown>[]>`
    insert into core.notification_preferences(
      user_id,sound_enabled,toast_enabled,toast_duration_seconds,crm_alerts_enabled,marketing_alerts_enabled,
      operations_alerts_enabled,tracking_alerts_enabled,updated_at
    ) values (
      ${userId}::uuid,${next.soundEnabled},${next.toastEnabled},${next.toastDurationSeconds},${next.systemAlerts.crm},
      ${next.systemAlerts.marketing},${next.systemAlerts.operations},${next.systemAlerts.tracking},now()
    )
    on conflict(user_id) do update set
      sound_enabled=excluded.sound_enabled,toast_enabled=excluded.toast_enabled,
      toast_duration_seconds=excluded.toast_duration_seconds,crm_alerts_enabled=excluded.crm_alerts_enabled,
      marketing_alerts_enabled=excluded.marketing_alerts_enabled,operations_alerts_enabled=excluded.operations_alerts_enabled,
      tracking_alerts_enabled=excluded.tracking_alerts_enabled,updated_at=now()
    returning sound_enabled,toast_enabled,toast_duration_seconds,crm_alerts_enabled,marketing_alerts_enabled,
      operations_alerts_enabled,tracking_alerts_enabled
  `;
  return mapNotificationPreferences(row);
}

export async function createNotification(input: NotificationInput) {
  await ensureNotificationsSchema();
  if (!SYSTEMS.includes(input.systemCode)) return null;
  const sql = getSql();
  const audience = values(input.audienceUserIds).filter(validUuid);
  const branches = values(input.branchCodes);
  const departments = values(input.departmentCodes);
  const dedupeKey = clean(input.dedupeKey) || null;
  const [row] = await sql<{ id: string }[]>`
    insert into core.notifications(
      system_code,event_type,title,body,entity_type,entity_id,action_url,severity,actor_id,actor_name,
      audience_user_ids,branch_codes,department_codes,metadata,dedupe_key
    ) values (
      ${input.systemCode},${clean(input.eventType) || "event"},${clean(input.title)},${clean(input.body) || null},
      ${clean(input.entityType) || null},${clean(input.entityId) || null},${clean(input.actionUrl) || null},${input.severity || "info"},
      ${input.actorId && validUuid(input.actorId) ? input.actorId : null}::uuid,${clean(input.actorName) || null},
      ${audience}::uuid[],${branches}::text[],${departments}::text[],${sql.json(input.metadata || {})},${dedupeKey}
    )
    on conflict(dedupe_key) where dedupe_key is not null do nothing
    returning id::text
  `;
  return row?.id || null;
}

function enabledSystems(user: PermissionUser) {
  if (isSystemAdministrator(user)) return SYSTEMS;
  return SYSTEMS.filter((system) => user.systemAccess?.[system]?.enabled);
}

function scopeFor(user: PermissionUser, system: NotificationSystem) {
  const access = user.systemAccess?.[system];
  return {
    all: isSystemAdministrator(user) || access?.dataScope === "all",
    branches: values(access?.branchCodes),
    departments: values(access?.departmentCodes),
  };
}

export async function listNotifications(user: PermissionUser, options: { system?: string; limit?: number; offset?: number; unreadOnly?: boolean }) {
  await ensureNotificationsSchema();
  const sql = getSql();
  const admin = isSystemAdministrator(user);
  const requested = clean(options.system).toLowerCase();
  const system = SYSTEMS.includes(requested as NotificationSystem) ? requested as NotificationSystem : null;
  if (requested && requested !== "all" && !system) throw new Error("نظام الإشعارات غير صحيح");
  if (requested === "all" && !admin) throw new Error("مركز إشعارات المنصة الكامل متاح لمدير النظام فقط");
  if (system && !enabledSystems(user).includes(system)) throw new Error("لا توجد صلاحية لعرض إشعارات هذا النظام");
  const allowedSystems = system ? [system] : admin ? SYSTEMS : enabledSystems(user);
  const limit = Math.min(100, Math.max(1, Number(options.limit || 30)));
  const offset = Math.max(0, Number(options.offset || 0));
  if (!allowedSystems.length) return { ok: true, rows: [], total: 0, unread: 0, system: system || "all" };
  const scopes = Object.fromEntries(SYSTEMS.map((code) => [code, scopeFor(user, code)])) as Record<NotificationSystem, ReturnType<typeof scopeFor>>;
  const crmScope = scopes.crm;
  const marketingScope = scopes.marketing;
  const operationsScope = scopes.operations;
  const trackingScope = scopes.tracking;

  const visible = sql`
    n.system_code in ${sql(allowedSystems)}
    and (
      ${admin}=true
      or (
        (cardinality(n.audience_user_ids)>0 and ${user.id}::uuid=any(n.audience_user_ids))
        or (
          cardinality(n.audience_user_ids)=0
          and (
          case n.system_code
            when 'crm' then ${crmScope.all}=true or (
              (cardinality(n.branch_codes)=0 or n.branch_codes && ${crmScope.branches}::text[])
              and (cardinality(n.department_codes)=0 or n.department_codes && ${crmScope.departments}::text[])
            )
            when 'marketing' then ${marketingScope.all}=true or (
              (cardinality(n.branch_codes)=0 or n.branch_codes && ${marketingScope.branches}::text[])
              and (cardinality(n.department_codes)=0 or n.department_codes && ${marketingScope.departments}::text[])
            )
            when 'operations' then ${operationsScope.all}=true or (
              (cardinality(n.branch_codes)=0 or n.branch_codes && ${operationsScope.branches}::text[])
              and (cardinality(n.department_codes)=0 or n.department_codes && ${operationsScope.departments}::text[])
            )
            when 'tracking' then ${trackingScope.all}=true or (
              (cardinality(n.branch_codes)=0 or n.branch_codes && ${trackingScope.branches}::text[])
              and (cardinality(n.department_codes)=0 or n.department_codes && ${trackingScope.departments}::text[])
            )
            else false
          end
          )
        )
      )
    )
    and (n.expires_at is null or n.expires_at>now())
  `;

  const unreadOnly = Boolean(options.unreadOnly);
  const [countRows, unreadRows, rows] = await Promise.all([
    sql<{ total: number }[]>`
      select count(*)::int as total from core.notifications n
      left join core.notification_user_state s on s.notification_id=n.id and s.user_id=${user.id}::uuid
      where ${visible} and s.dismissed_at is null and (${unreadOnly}=false or s.read_at is null)
    `,
    sql<{ unread: number }[]>`
      select count(*)::int as unread from core.notifications n
      left join core.notification_user_state s on s.notification_id=n.id and s.user_id=${user.id}::uuid
      where ${visible} and s.dismissed_at is null and s.read_at is null
    `,
    sql<any[]>`
      select n.id::text,n.system_code,n.event_type,n.title,n.body,n.entity_type,n.entity_id,n.action_url,n.severity,
        n.actor_id::text,n.actor_name,n.metadata,n.created_at,s.read_at,s.dismissed_at
      from core.notifications n
      left join core.notification_user_state s on s.notification_id=n.id and s.user_id=${user.id}::uuid
      where ${visible} and s.dismissed_at is null and (${unreadOnly}=false or s.read_at is null)
      order by n.created_at desc,n.id desc limit ${limit} offset ${offset}
    `,
  ]);
  const countRow = countRows[0];
  const unreadRow = unreadRows[0];
  return { ok: true, rows, total: Number(countRow?.total || 0), unread: Number(unreadRow?.unread || 0), system: system || "all" };
}

export async function markNotifications(user: PermissionUser, input: { ids?: string[]; system?: string; read?: boolean; dismiss?: boolean }) {
  await ensureNotificationsSchema();
  const sql = getSql();
  const ids = values(input.ids).filter(validUuid);
  const requested = clean(input.system).toLowerCase();
  const system = SYSTEMS.includes(requested as NotificationSystem) ? requested as NotificationSystem : null;
  if (requested && requested !== "all" && !system) throw new Error("نظام الإشعارات غير صحيح");
  if (requested === "all" && !isSystemAdministrator(user)) throw new Error("مركز إشعارات المنصة الكامل متاح لمدير النظام فقط");
  const visibleIds: string[] = [];
  const requestedIds = new Set(ids);
  let offset = 0;
  do {
    const page = await listNotifications(user, { system: requested || system || undefined, limit: 100, offset });
    const pageIds = page.rows.map((row: any) => row.id as string);
    visibleIds.push(...(ids.length ? pageIds.filter((id) => ids.includes(id)) : pageIds));
    offset += page.rows.length;
    if (
      !page.rows.length
      || offset >= page.total
      || (ids.length > 0 && visibleIds.every((id) => requestedIds.has(id)) && visibleIds.length === requestedIds.size)
    ) break;
  } while (true);
  if (!visibleIds.length) return { ok: true, updated: 0 };
  const read = input.read !== false;
  const dismiss = Boolean(input.dismiss);
  const rows = await sql<any[]>`
    insert into core.notification_user_state(notification_id,user_id,read_at,dismissed_at,updated_at)
    select id,${user.id}::uuid,case when ${read} then now() else null end,case when ${dismiss} then now() else null end,now()
    from core.notifications where id in ${sql(visibleIds)}
    on conflict(notification_id,user_id) do update set
      read_at=case when ${read} then now() else null end,
      dismissed_at=case when ${dismiss} then now() else core.notification_user_state.dismissed_at end,
      updated_at=now()
    returning notification_id::text
  `;
  return { ok: true, updated: rows.length };
}

export function notificationDedupe(prefix: string, ...parts: unknown[]) {
  return [prefix, ...parts.map(clean).filter(Boolean)].join(":").slice(0, 500);
}

export async function emitMarketingNotification(user: PermissionUser, action: string, body: any, result: any) {
  const sql = getSql();
  const id = clean(result?.id || body?.id || body?.sourceId || body?.taskId || body?.templateId);
  const actor = { actorId: user.id, actorName: user.fullName };
  if (action === "create_campaign" || action === "create_agenda") {
    const sourceType = action === "create_agenda" ? "agenda" : "campaign";
    const name = clean(body?.name) || (sourceType === "agenda" ? "الأجندة الجديدة" : "الحملة الجديدة");
    await createNotification({ systemCode: "marketing", eventType: `${sourceType}_created`, title: sourceType === "agenda" ? "تم إنشاء أجندة جديدة" : "تم إنشاء حملة جديدة", body: `${name} بواسطة ${user.fullName}`, entityType: sourceType, entityId: id, actionUrl: "/marketing", severity: "success", ...actor, dedupeKey: notificationDedupe(`marketing-${sourceType}-created`, id) });
    if (id && validUuid(id)) {
      const tasks = await sql<any[]>`
        select id::text,title,assigned_to::text,paired_content_user_id::text
        from marketing.tasks
        where source_type=${sourceType} and source_id=${id}::uuid and is_deleted=false
      `;
      for (const task of tasks) {
        for (const userId of values([task.assigned_to, task.paired_content_user_id])) {
          await createNotification({
            systemCode: "marketing", eventType: "task_assigned", title: "تم إسناد تكليف جديد",
            body: task.title || name, entityType: "task", entityId: task.id, actionUrl: "/marketing",
            audienceUserIds: [userId], severity: "info", ...actor,
            dedupeKey: notificationDedupe("marketing-task-assigned", task.id, userId),
          });
        }
      }
    }
    return;
  }
  if (["receive_task", "upload_template", "review_template", "toggle_task_action", "attach_final_file", "publish_now", "archive_entity"].includes(action)) {
    const map: Record<string, [string, string, NotificationSeverity]> = {
      receive_task: ["task_received", "تم استلام التكليف", "success"],
      upload_template: ["task_template_uploaded", "تم رفع Task Template", "info"],
      review_template: ["task_template_reviewed", clean(result?.message) || "تم تنفيذ إجراء المراجعة والاعتماد", "info"],
      toggle_task_action: ["assignment_action_updated", body?.completed === false ? "تم التراجع عن إجراء التكليف" : "تم تنفيذ إجراء من إجراءات التكليف", "success"],
      attach_final_file: ["final_file_uploaded", "تم رفع الملف النهائي", "success"],
      publish_now: ["published", "تم تنفيذ النشر", "success"],
      archive_entity: ["entity_archived", "تمت أرشفة السجل", "warning"],
    };
    const [eventType, title, severity] = map[action];
    const taskId = clean(body?.taskId || (action === "receive_task" ? body?.id : ""));
    const templateId = clean(body?.templateId);
    let taskRef: any = null;
    if (taskId && validUuid(taskId)) {
      [taskRef] = await sql<any[]>`
        select t.id::text,t.source_type,t.source_id::text,t.assigned_to::text,t.paired_content_user_id::text,t.title,
          (select name from marketing.assignment_actions where id=nullif(${clean(body?.actionId)},'')::uuid) as action_name
        from marketing.tasks t where t.id=${taskId}::uuid and t.is_deleted=false
      `;
    } else if (templateId && validUuid(templateId)) {
      [taskRef] = await sql<any[]>`
        select t.id::text,t.source_type,t.source_id::text,t.assigned_to::text,t.paired_content_user_id::text,t.title,null::text as action_name
        from marketing.tasks t
        where t.task_template_id=${templateId}::uuid and t.is_deleted=false
        order by case when t.task_kind='execution' then 0 else 1 end,t.created_at
        limit 1
      `;
    }
    const actionName = clean(taskRef?.action_name);
    const detail = action === "toggle_task_action" && actionName
      ? `${title}: ${actionName}${taskRef?.title ? ` - ${taskRef.title}` : ""}`
      : `${clean(result?.message) || title}${taskRef?.title ? ` - ${taskRef.title}` : ""}`;
    await createNotification({
      systemCode: "marketing", eventType, title, body: `${detail} بواسطة ${user.fullName}`,
      entityType: taskRef?.id ? "task" : "marketing", entityId: clean(taskRef?.id || id), actionUrl: "/marketing",
      audienceUserIds: taskRef ? [taskRef.assigned_to, taskRef.paired_content_user_id] : [],
      severity, ...actor,
      dedupeKey: notificationDedupe(`marketing-${eventType}`, clean(taskRef?.id || id), clean(body?.actionId), clean(result?.progress), Date.now()),
    });
    if (taskRef?.source_id) {
      const [source] = taskRef.source_type === "agenda"
        ? await sql<any[]>`select name,progress from marketing.agendas where id=${taskRef.source_id}::uuid`
        : await sql<any[]>`select name,progress from marketing.campaigns where id=${taskRef.source_id}::uuid`;
      const threshold = Math.min(100, Math.floor(Number(source?.progress || 0) / 25) * 25);
      if (threshold > 0) await createNotification({
        systemCode: "marketing", eventType: "progress_threshold", title: `نسبة التقدم ${threshold}%`,
        body: `${source?.name || "السجل"} وصل إلى ${threshold}%`, entityType: taskRef.source_type,
        entityId: taskRef.source_id, actionUrl: "/marketing", severity: threshold === 100 ? "success" : "info", ...actor,
        dedupeKey: notificationDedupe("marketing-progress", taskRef.source_type, taskRef.source_id, threshold),
      });
    }
  }
}

export async function emitOperationsNotification(user: PermissionUser, action: string, body: any, result: any) {
  const sql = getSql();
  const actor = { actorId: user.id, actorName: user.fullName };
  const id = clean(
    result?.vehicle?.id
    || result?.request?.id
    || result?.batchId
    || result?.id
    || body?.vehicleId
    || body?.requestId
    || body?.id,
  );
  const map: Record<string, { event: string; title: string; severity: NotificationSeverity; type: string; url: string }> = {
    create_vehicle: { event: "vehicle_created", title: "تمت إضافة سيارة جديدة", severity: "success", type: "vehicle", url: "/operations/manage" },
    create_transfer: { event: "request_created", title: "تم إنشاء طلب جديد", severity: "success", type: "request", url: "/operations/transfers" },
    transfer_action: { event: "request_stage_updated", title: "تم تحديث مرحلة الطلب", severity: "info", type: "request", url: "/operations/transfers" },
    approval_action: { event: "approval_updated", title: "تم تحديث موافقة السيارة", severity: "info", type: "vehicle", url: "/operations/approvals" },
    move_vehicles: { event: "vehicles_moved", title: "تم تنفيذ حركة سيارات", severity: "success", type: "movement", url: "/operations/movements" },
    update_vehicle: { event: "vehicle_updated", title: "تم تحديث بيانات السيارة", severity: "info", type: "vehicle", url: "/operations/manage" },
    archive_vehicle: { event: "vehicle_archived", title: "تم تحديث أرشفة السيارة", severity: "warning", type: "vehicle", url: "/operations/archive" },
    import_vehicles: { event: "vehicles_imported", title: "تم استيراد السيارات", severity: "success", type: "vehicle", url: "/operations/manage" },
  };
  const item = map[action]; if (!item) return;
  let branchCodes = values([result?.request?.source_branch_code, result?.request?.destination_branch_code]);
  if (item.type === "request" && id && validUuid(id) && !branchCodes.length) {
    const [request] = await sql<any[]>`
      select source_branch_code,destination_branch_code from operations.transfer_requests where id=${id}::uuid
    `;
    branchCodes = values([request?.source_branch_code, request?.destination_branch_code]);
  } else if (item.type === "vehicle" && id && validUuid(id)) {
    const [vehicle] = await sql<any[]>`
      select l.branch_code,l.code as location_code
      from operations.vehicles v left join operations.locations l on l.id=v.location_id
      where v.id=${id}::uuid
    `;
    branchCodes = values([vehicle?.branch_code, vehicle?.location_code]);
  } else if (action === "move_vehicles") {
    const vehicleIds = values(Array.isArray(body?.vehicleIds) ? body.vehicleIds : Array.isArray(body?.ids) ? body.ids : []).filter(validUuid);
    if (vehicleIds.length) {
      const locations = await sql<any[]>`
        select distinct l.branch_code,l.code as location_code
        from operations.vehicles v left join operations.locations l on l.id=v.location_id
        where v.id in ${sql(vehicleIds)}
      `;
      branchCodes = values(locations.flatMap((row) => [row.branch_code, row.location_code]));
    }
  }
  await createNotification({ systemCode: "operations", eventType: item.event, title: item.title, body: `${clean(result?.message) || item.title} بواسطة ${user.fullName}`, entityType: item.type, entityId: id, actionUrl: item.url, severity: item.severity, branchCodes, ...actor, dedupeKey: notificationDedupe(`operations-${item.event}`, id, clean(body?.workflowAction || body?.transferAction || body?.status || body?.newStatus), Date.now()) });
}

export async function emitTrackingNotification(user: PermissionUser, action: string, body: any, result: any) {
  const sql = getSql();
  const orderId = clean(body?.orderId || body?.id || result?.orderId);
  const stageNo = clean(body?.stageNo);
  const map: Record<string, [string, string, NotificationSeverity]> = {
    complete_stage: ["stage_completed", "تم إنهاء مرحلة من مراحل الطلب", "success"],
    revert_stage: ["stage_reverted", "تم التراجع عن مرحلة من مراحل الطلب", "warning"],
    archive_order: ["order_archive_updated", body?.archived ? "تمت أرشفة الطلب" : "تمت استعادة الطلب", "warning"],
  };
  const item = map[action]; if (!item) return;
  const [order] = orderId && validUuid(orderId)
    ? await sql<any[]>`select branch from tracking.orders where id=${orderId}::uuid`
    : [null];
  await createNotification({ systemCode: "tracking", eventType: item[0], title: item[1], body: `${clean(result?.message) || item[1]} بواسطة ${user.fullName}`, entityType: "tracking_order", entityId: orderId, actionUrl: body?.archived ? "/tracking/archive" : "/tracking", severity: item[2], actorId: user.id, actorName: user.fullName, branchCodes: [order?.branch], dedupeKey: notificationDedupe(`tracking-${item[0]}`, orderId, stageNo, Date.now()) });
}

export async function emitCrmLeadNotification(user: PermissionUser, event: "created" | "status" | "transfer", lead: any, before?: any) {
  const audience = [lead?.assigned_to, lead?.call_center_assigned_to];
  const title = event === "created" ? "دخل عميل جديد إلى النظام" : event === "transfer" ? "تم تحويل العميل إلى قسم آخر" : "تم تحديث حالة العميل";
  const body = event === "status" ? `${lead?.customer_name || "العميل"}: ${before?.status_label || "—"} ← ${lead?.status_label || "—"}` : `${lead?.customer_name || "عميل"} بواسطة ${user.fullName}`;
  const eventVersion = event === "created" ? lead?.created_at : lead?.updated_at || Date.now();
  await createNotification({ systemCode: "crm", eventType: `lead_${event}`, title, body, entityType: "lead", entityId: clean(lead?.id), actionUrl: lead?.id ? `/crm?lead=${encodeURIComponent(clean(lead.id))}` : "/crm", severity: event === "created" ? "success" : "info", actorId: user.id, actorName: user.fullName, audienceUserIds: audience, branchCodes: [lead?.branch_code], departmentCodes: [lead?.department_code], dedupeKey: notificationDedupe(`crm-lead-${event}`, lead?.id, eventVersion) });
}

export async function emitInboundMessageNotification(input: { eventKey: string; source: string; lead?: any; conversation?: any; message?: any }) {
  const lead = input.lead || {};
  const conversation = input.conversation || {};
  const customerName = clean(lead.customer_name || conversation.customer_name) || "عميل";
  const preview = clean(input.message?.body || conversation.preview_text) || "رسالة واردة جديدة";
  await createNotification({ systemCode: "crm", eventType: "customer_message_received", title: `رسالة واردة من ${customerName}`, body: preview.slice(0, 240), entityType: "conversation", entityId: clean(conversation.id), actionUrl: "/crm/inbox", severity: "info", audienceUserIds: [lead.assigned_to, lead.call_center_assigned_to, conversation.assigned_to, conversation.call_center_assigned_to], branchCodes: [lead.branch_code, conversation.branch_code], departmentCodes: [lead.department_code, conversation.department_code], dedupeKey: notificationDedupe("crm-inbound-message", input.source, input.eventKey) });
}

