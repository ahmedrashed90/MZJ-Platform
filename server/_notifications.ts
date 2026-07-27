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

const OPERATIONS_REQUEST_STAGE_LABELS: Record<string, string> = {
  created: "تم الإنشاء",
  request_received: "تم استلام الطلب",
  vehicle_sent: "تم إرسال السيارة",
  vehicle_received: "تم استلام السيارة",
  completed: "تم الانتهاء",
};
const TRACKING_ACTION_LABELS: Record<string, string> = {
  complete_stage: "تم إنهاء المرحلة",
  revert_stage: "تم التراجع عن المرحلة",
  archive_order: "تم تحديث أرشفة الطلب",
};
const TRACKING_ARCHIVE_LABELS: Record<string, string> = {
  archived: "تمت الأرشفة",
  restored: "تمت الاستعادة",
};
const APPROVAL_TYPE_LABELS: Record<string, string> = {
  financial: "الموافقة المالية",
  administrative: "الموافقة الإدارية",
};
const APPROVAL_ACTION_LABELS: Record<string, string> = {
  approve: "اعتماد",
  revert: "تراجع عن الاعتماد",
  note: "إضافة أو تحديث ملاحظة",
  reset: "إعادة ضبط الموافقات",
};
const CRM_SOURCE_LABELS: Record<string, string> = {
  facebook: "فيسبوك",
  instagram: "إنستجرام",
  whatsapp: "واتساب",
  manychat: "ManyChat",
  tiktok: "تيك توك",
  web: "الموقع الإلكتروني",
};

function cleanOptional(value: unknown) {
  const normalized = clean(value);
  return normalized || "";
}

function truncateNotificationText(value: unknown, max = 240) {
  const normalized = clean(value).replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…` : normalized;
}

function detailLine(label: string, value: unknown) {
  const normalized = cleanOptional(value);
  return normalized ? `${label}: ${normalized}` : "";
}

function detailCount(label: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  const numberValue = Number(value);
  if (Number.isFinite(numberValue)) return `${label}: ${numberValue}`;
  const normalized = cleanOptional(value);
  return normalized ? `${label}: ${normalized}` : "";
}

function detailPath(label: string, fromValue: unknown, toValue: unknown) {
  const fromText = cleanOptional(fromValue);
  const toText = cleanOptional(toValue);
  if (!fromText && !toText) return "";
  if (fromText && toText) return `${label}: ${fromText} ← ${toText}`;
  return `${label}: ${fromText || toText}`;
}

function joinDetails(lines: Array<string | null | undefined>) {
  return lines.map((line) => cleanOptional(line)).filter(Boolean).join("\n");
}

function operationsRequestKindLabel(value: unknown) {
  return clean(value) === "photography" ? "طلب تصوير" : "طلب نقل";
}

function operationsRequestStageLabel(value: unknown) {
  const normalized = clean(value);
  return OPERATIONS_REQUEST_STAGE_LABELS[normalized] || normalized || "—";
}

function trackingArchiveStateLabel(archived: boolean) {
  return archived ? TRACKING_ARCHIVE_LABELS.archived : TRACKING_ARCHIVE_LABELS.restored;
}

function approvalStateLabel(value: unknown) {
  return value === true ? "معتمدة" : value === false ? "غير معتمدة" : "—";
}

function crmSourceLabel(value: unknown) {
  const normalized = clean(value).toLowerCase();
  return CRM_SOURCE_LABELS[normalized] || cleanOptional(value);
}


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
  const actorName = clean(input.actorName) || "النظام";
  const [row] = await sql<{ id: string }[]>`
    insert into core.notifications(
      system_code,event_type,title,body,entity_type,entity_id,action_url,severity,actor_id,actor_name,
      audience_user_ids,branch_codes,department_codes,metadata,dedupe_key
    ) values (
      ${input.systemCode},${clean(input.eventType) || "event"},${clean(input.title)},${clean(input.body) || null},
      ${clean(input.entityType) || null},${clean(input.entityId) || null},${clean(input.actionUrl) || null},${input.severity || "info"},
      ${input.actorId && validUuid(input.actorId) ? input.actorId : null}::uuid,${actorName},
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
    const sourceLabel = sourceType === "agenda" ? "الأجندة" : "الحملة";
    const name = clean(body?.name) || (sourceType === "agenda" ? "الأجندة الجديدة" : "الحملة الجديدة");
    await createNotification({
      systemCode: "marketing",
      eventType: `${sourceType}_created`,
      title: sourceType === "agenda" ? "تم إنشاء أجندة جديدة" : "تم إنشاء حملة جديدة",
      body: joinDetails([
        detailLine(sourceLabel, name),
        detailLine("النوع", sourceLabel),
      ]),
      entityType: sourceType,
      entityId: id,
      actionUrl: "/marketing",
      severity: "success",
      ...actor,
      dedupeKey: notificationDedupe(`marketing-${sourceType}-created`, id),
    });
    if (id && validUuid(id)) {
      const tasks = await sql<any[]>`
        select id::text,title,assigned_to::text,paired_content_user_id::text
        from marketing.tasks
        where source_type=${sourceType} and source_id=${id}::uuid and is_deleted=false
      `;
      for (const task of tasks) {
        for (const userId of values([task.assigned_to, task.paired_content_user_id])) {
          await createNotification({
            systemCode: "marketing",
            eventType: "task_assigned",
            title: "تم إسناد تكليف جديد",
            body: joinDetails([
              detailLine("السجل", name),
              detailLine("التكليف", task.title || "تكليف جديد"),
                  ]),
            entityType: "task",
            entityId: task.id,
            actionUrl: "/marketing",
            audienceUserIds: [userId],
            severity: "info",
            ...actor,
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
    let source: any = null;
    if (taskRef?.source_id) {
      [source] = taskRef.source_type === "agenda"
        ? await sql<any[]>`select name,progress from marketing.agendas where id=${taskRef.source_id}::uuid`
        : await sql<any[]>`select name,progress from marketing.campaigns where id=${taskRef.source_id}::uuid`;
    }
    const actionName = clean(taskRef?.action_name);
    await createNotification({
      systemCode: "marketing",
      eventType,
      title,
      body: joinDetails([
        detailLine(taskRef?.source_type === "agenda" ? "الأجندة" : "الحملة", source?.name || "—"),
        detailLine("التكليف", taskRef?.title || "—"),
        detailLine("الإجراء", action === "toggle_task_action" && actionName ? actionName : clean(result?.message) || title),
      ]),
      entityType: taskRef?.id ? "task" : "marketing",
      entityId: clean(taskRef?.id || id),
      actionUrl: "/marketing",
      audienceUserIds: taskRef ? [taskRef.assigned_to, taskRef.paired_content_user_id] : [],
      severity,
      ...actor,
      dedupeKey: notificationDedupe(`marketing-${eventType}`, clean(taskRef?.id || id), clean(body?.actionId), clean(result?.progress), Date.now()),
    });
    if (taskRef?.source_id && source) {
      const threshold = Math.min(100, Math.floor(Number(source?.progress || 0) / 25) * 25);
      if (threshold > 0) await createNotification({
        systemCode: "marketing",
        eventType: "progress_threshold",
        title: `نسبة التقدم ${threshold}%`,
        body: joinDetails([
          detailLine(taskRef.source_type === "agenda" ? "الأجندة" : "الحملة", source?.name || "السجل"),
          detailLine("نسبة التقدم", `${threshold}%`),
        ]),
        entityType: taskRef.source_type,
        entityId: taskRef.source_id,
        actionUrl: "/marketing",
        severity: threshold === 100 ? "success" : "info",
        ...actor,
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
  const item = map[action];
  if (!item) return;

  let branchCodes = values([result?.request?.source_branch_code, result?.request?.destination_branch_code]);
  let requestSummary: any = null;
  let vehicleSummary: any = null;
  let destinationSummary: any = null;

  const requestId = item.type === "request" ? id : clean(body?.requestId || body?.id);
  if (requestId && validUuid(requestId)) {
    [requestSummary] = await sql<any[]>`
      select r.id::text,r.request_no,r.request_kind,r.status,r.cancellation_reason,r.note,
        sl.name as source_location_name,dl.name as destination_location_name,
        r.source_branch_code,r.destination_branch_code,
        count(rv.vehicle_id)::int as vehicles_count
      from operations.transfer_requests r
      left join operations.locations sl on sl.id=r.source_location_id
      left join operations.locations dl on dl.id=r.destination_location_id
      left join operations.transfer_request_vehicles rv on rv.transfer_request_id=r.id
      where r.id=${requestId}::uuid
      group by r.id,sl.name,dl.name
    `;
    branchCodes = values([branchCodes[0], branchCodes[1], requestSummary?.source_branch_code, requestSummary?.destination_branch_code]);
  }

  const vehicleId = clean(body?.vehicleId || result?.vehicle?.id || (item.type === "vehicle" ? id : ""));
  if (vehicleId && validUuid(vehicleId)) {
    [vehicleSummary] = await sql<any[]>`
      select v.id::text,v.vin,v.car_name,v.statement,v.archived_at,v.status_code,l.name as location_name,l.branch_code,l.code as location_code
      from operations.vehicles v
      left join operations.locations l on l.id=v.location_id
      where v.id=${vehicleId}::uuid
    `;
    branchCodes = values([branchCodes[0], branchCodes[1], vehicleSummary?.branch_code, vehicleSummary?.location_code]);
  }

  const destinationLocationId = clean(body?.destinationLocationId);
  if (destinationLocationId && validUuid(destinationLocationId)) {
    [destinationSummary] = await sql<any[]>`select name,branch_code,code from operations.locations where id=${destinationLocationId}::uuid`;
    branchCodes = values([branchCodes[0], branchCodes[1], destinationSummary?.branch_code, destinationSummary?.code]);
  }

  let title = item.title;
  let bodyText = "";

  if (action === "create_transfer" || action === "transfer_action") {
    const transferAction = clean(body?.transferAction);
    const actionLabel = transferAction === "delete"
      ? "حذف الطلب"
      : transferAction === "cancel"
        ? "إلغاء الطلب"
        : "تحديث المرحلة";
    title = action === "create_transfer"
      ? `تم إنشاء ${operationsRequestKindLabel(requestSummary?.request_kind)}`
      : transferAction === "cancel"
        ? `تم إلغاء ${operationsRequestKindLabel(requestSummary?.request_kind)}`
        : transferAction === "delete"
          ? `تم حذف ${operationsRequestKindLabel(requestSummary?.request_kind)}`
          : `تم تحديث مرحلة ${operationsRequestKindLabel(requestSummary?.request_kind)}`;
    bodyText = joinDetails([
      detailLine("رقم الطلب", requestSummary?.request_no),
      detailLine("نوع الطلب", operationsRequestKindLabel(requestSummary?.request_kind)),
      detailLine("الإجراء", action === "create_transfer" ? "إنشاء الطلب" : actionLabel),
      detailLine("المرحلة الحالية", operationsRequestStageLabel(requestSummary?.status || (action === "create_transfer" ? "created" : ""))),
      detailPath("المسار", requestSummary?.source_location_name, requestSummary?.destination_location_name),
      detailCount("عدد السيارات", requestSummary?.vehicles_count || values(Array.isArray(body?.vehicleIds) ? body.vehicleIds : []).length),
      detailLine(transferAction === "cancel" ? "سبب الإلغاء" : "ملاحظة", clean(body?.reason) || clean(body?.note) || clean(requestSummary?.note)),
    ]);
  } else if (action === "approval_action") {
    const approvalType = clean(body?.approvalType);
    const approvalAction = clean(body?.approvalAction);
    title = result?.delivered ? "اكتملت الموافقتان وتم التسليم النهائي" : item.title;
    bodyText = joinDetails([
      detailLine("السيارة", [clean(vehicleSummary?.vin), clean(vehicleSummary?.car_name || vehicleSummary?.statement)].filter(Boolean).join(" - ")),
      detailLine("نوع الموافقة", APPROVAL_TYPE_LABELS[approvalType] || approvalType),
      detailLine("الإجراء", APPROVAL_ACTION_LABELS[approvalAction] || approvalAction),
      detailLine("الموافقة المالية", approvalStateLabel(result?.approval?.financial_approved)),
      detailLine("الموافقة الإدارية", approvalStateLabel(result?.approval?.administrative_approved)),
      detailLine("المكان الحالي", vehicleSummary?.location_name),
      detailLine("التسليم النهائي", result?.delivered ? "تم" : "لم يتم"),
      detailLine("ملاحظة", body?.note),
    ]);
  } else if (action === "move_vehicles") {
    const vehicleIds = values(Array.isArray(body?.vehicleIds) ? body.vehicleIds : Array.isArray(body?.ids) ? body.ids : []);
    bodyText = joinDetails([
      detailCount("عدد السيارات", vehicleIds.length || result?.movedCount || result?.updatedCount),
      detailLine("المكان المستهدف", destinationSummary?.name),
      detailLine("الحالة الجديدة", clean(body?.newStatus)),
    ]);
  } else if (action === "create_vehicle" || action === "update_vehicle" || action === "archive_vehicle") {
    bodyText = joinDetails([
      detailLine("السيارة", [clean(vehicleSummary?.vin), clean(vehicleSummary?.car_name || vehicleSummary?.statement)].filter(Boolean).join(" - ")),
      detailLine("المكان الحالي", vehicleSummary?.location_name),
      detailLine("الحالة", vehicleSummary?.status_code),
      detailLine("الأرشفة", action === "archive_vehicle" ? (vehicleSummary?.archived_at ? "مؤرشفة" : "غير مؤرشفة") : ""),
    ]);
  } else if (action === "import_vehicles") {
    bodyText = joinDetails([
      detailLine("وضع الاستيراد", clean(body?.mode)),
      detailCount("إجمالي الصفوف", result?.report?.total || result?.total),
      detailCount("المضاف", result?.report?.inserted),
      detailCount("المحدث", result?.report?.updated),
      detailCount("المتجاوز", result?.report?.skipped),
      detailCount("الفاشل", result?.report?.failed),
    ]);
  }

  await createNotification({
    systemCode: "operations",
    eventType: item.event,
    title,
    body: bodyText || (clean(result?.message) || item.title),
    entityType: item.type,
    entityId: id,
    actionUrl: item.url,
    severity: item.severity,
    branchCodes,
    ...actor,
    dedupeKey: notificationDedupe(`operations-${item.event}`, id || requestId || vehicleId, clean(body?.workflowAction || body?.transferAction || body?.status || body?.newStatus || body?.approvalAction), Date.now()),
  });
}

export async function emitTrackingNotification(user: PermissionUser, action: string, body: any, result: any) {
  const sql = getSql();
  const orderId = clean(body?.orderId || body?.id || result?.orderId);
  const stageNo = clean(body?.stageNo);
  const stageId = clean(body?.stageId);
  const map: Record<string, [string, string, NotificationSeverity]> = {
    complete_stage: ["stage_completed", "تم إنهاء مرحلة من مراحل الطلب", "success"],
    revert_stage: ["stage_reverted", "تم التراجع عن مرحلة من مراحل الطلب", "warning"],
    archive_order: ["order_archive_updated", body?.archived ? "تمت أرشفة الطلب" : "تمت استعادة الطلب", "warning"],
  };
  const item = map[action];
  if (!item) return;

  const [order] = orderId && validUuid(orderId)
    ? await sql<any[]>`select id::text,sales_order_no,branch from tracking.orders where id=${orderId}::uuid`
    : [null];
  const [stage] = stageId && validUuid(stageId)
    ? await sql<any[]>`select name,sort_order from tracking.stages where id=${stageId}::uuid`
    : stageNo
      ? [{ name: `المرحلة ${stageNo}`, sort_order: Number(stageNo) }]
      : [null];

  const stageLabel = stage?.name ? `${String(Number(stage?.sort_order || stageNo || 0)).padStart(2, "0")} - ${stage.name}` : (stageNo ? `المرحلة ${stageNo}` : "");
  const affectedVehicles = Number(result?.affectedVehicles || 0);
  const title = action === "archive_order"
    ? item[1]
    : `${TRACKING_ACTION_LABELS[action] || item[1]}${stage?.name ? `: ${stage.name}` : ""}`;
  const bodyText = joinDetails([
    detailLine("رقم الطلب", order?.sales_order_no),
    detailLine("المرحلة", stageLabel),
    detailCount("عدد السيارات المتأثرة", affectedVehicles || ""),
    detailLine("حالة الأرشفة", action === "archive_order" ? trackingArchiveStateLabel(Boolean(body?.archived || result?.archived || result?.order?.is_archived)) : ""),
    detailLine(action === "revert_stage" ? "سبب التراجع" : "ملاحظة", clean(body?.note)),
    detailLine("الفرع", order?.branch),
  ]);

  await createNotification({
    systemCode: "tracking",
    eventType: item[0],
    title,
    body: bodyText || (clean(result?.message) || item[1]),
    entityType: "tracking_order",
    entityId: orderId,
    actionUrl: body?.archived ? "/tracking/archive" : "/tracking",
    severity: item[2],
    actorId: user.id,
    actorName: user.fullName,
    branchCodes: [order?.branch],
    dedupeKey: notificationDedupe(`tracking-${item[0]}`, orderId, stageNo || stageId, Date.now()),
  });
}

export async function emitCrmLeadNotification(user: PermissionUser, event: "created" | "status" | "transfer", lead: any, before?: any) {
  const audience = [lead?.assigned_to, lead?.call_center_assigned_to];
  const title = event === "created" ? "دخل عميل جديد إلى النظام" : event === "transfer" ? "تم تحويل العميل إلى قسم آخر" : "تم تحديث حالة العميل";
  const body = joinDetails([
    detailLine("العميل", lead?.customer_name || "عميل"),
    detailLine("الحالة السابقة", event === "status" ? (before?.status_label || before?.status || "—") : event === "transfer" ? (before?.department_label || before?.department_code || "—") : ""),
    detailLine(event === "status" ? "الحالة الحالية" : event === "transfer" ? "القسم الحالي" : "الحالة", lead?.status_label || lead?.status || lead?.department_label || lead?.department_code || "—"),
    detailLine("الفرع", lead?.branch_name || lead?.branch_code),
    detailLine("القسم", lead?.department_label || lead?.department_code),
    detailLine("المندوب", lead?.assigned_to_name || lead?.assigned_user_name),
    detailLine("الكول سنتر", lead?.call_center_assigned_to_name || lead?.call_center_name),
  ]);
  const eventVersion = event === "created" ? lead?.created_at : lead?.updated_at || Date.now();
  await createNotification({
    systemCode: "crm",
    eventType: `lead_${event}`,
    title,
    body,
    entityType: "lead",
    entityId: clean(lead?.id),
    actionUrl: lead?.id ? `/crm?lead=${encodeURIComponent(clean(lead.id))}` : "/crm",
    severity: event === "created" ? "success" : "info",
    actorId: user.id,
    actorName: user.fullName,
    audienceUserIds: audience,
    branchCodes: [lead?.branch_code],
    departmentCodes: [lead?.department_code],
    dedupeKey: notificationDedupe(`crm-lead-${event}`, lead?.id, eventVersion),
  });
}

export async function emitInboundMessageNotification(input: { eventKey: string; source: string; lead?: any; conversation?: any; message?: any }) {
  const lead = input.lead || {};
  const conversation = input.conversation || {};
  const customerName = clean(lead.customer_name || conversation.customer_name) || "عميل";
  const preview = truncateNotificationText(input.message?.body || conversation.preview_text || "رسالة واردة جديدة", 220);
  await createNotification({
    systemCode: "crm",
    eventType: "customer_message_received",
    title: `رسالة واردة من ${customerName}`,
    body: joinDetails([
      detailLine("العميل", customerName),
      detailLine("القناة", crmSourceLabel(input.source)),
      detailLine("نص الرسالة", preview),
      detailLine("المندوب", lead.assigned_to_name || conversation.assigned_to_name),
      detailLine("الكول سنتر", lead.call_center_assigned_to_name || conversation.call_center_assigned_to_name),
    ]),
    entityType: "conversation",
    entityId: clean(conversation.id),
    actionUrl: "/crm/inbox",
    severity: "info",
    actorName: `العميل: ${customerName}`,
    audienceUserIds: [lead.assigned_to, lead.call_center_assigned_to, conversation.assigned_to, conversation.call_center_assigned_to],
    branchCodes: [lead.branch_code, conversation.branch_code],
    departmentCodes: [lead.department_code, conversation.department_code],
    dedupeKey: notificationDedupe("crm-inbound-message", input.source, input.eventKey),
  });
}

