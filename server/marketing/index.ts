import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { requireUser, requestIp, type SessionUser } from "../_auth.js";
import { canAccessSystem, hasPermission } from "../../shared/system-access.js";
import { getSystemAccess } from "../_access-control.js";
import { ensureAccessControlSchema } from "../_access-control-schema.js";
import { completePhotographyRequest } from "../operations/index.js";
import { ensureMarketingSchema } from "../_marketing-schema.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { buildMarketingStorageKey, createDownloadUrl, createUploadUrl, mediaStorageConfigured } from "../_media-storage.js";
import { emitMarketingNotification } from "../_notifications.js";
import {
  decryptPlatformToken,
  getYouTubePublishSettings,
  loadYouTubePublishOptions,
  publicPlatformConnection,
} from "../_platform-connections.js";
import { normalizeYouTubePublishOptions } from "../../shared/youtube-publishing.js";
import { normalizeMarketingPublishFormat, publishFormatRequiresImages, publishFormatRequiresVideo, type MarketingPublishFormat } from "../../shared/marketing-publishing.js";
import { publishYouTubeVideo } from "../_youtube-publisher.js";
import { publishInstagramContent } from "../_instagram-publisher.js";
import { createOpaqueTicket, getZohoFileInfo, getZohoRuntime, ticketHash } from "../_zoho-workdrive.js";
import { commitZohoChunkUpload, prepareZohoUpload, uploadZohoChunk, uploadZohoStandardFile, ZOHO_PROVIDER_CHUNK_SIZE, ZOHO_PROXY_CHUNK_SIZE } from "../_zoho-upload.js";
import { backfillPublishedPosts, engagementData, engagementResultsData, manageEngagementItem, recordPublishedPost, refreshEngagementMetrics, subscribeMetaEngagementWebhooks } from "../_marketing-engagement.js";

function clean(value: unknown) { return String(value ?? "").trim(); }
function bodyObject(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") { try { return JSON.parse(request.body || "{}"); } catch { return {}; } }
  return {};
}
function bool(value: unknown) { return value === true || value === "true" || value === 1 || value === "1"; }
function numberValue(value: unknown, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function arrayValue<T = any>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function dbJson(value: unknown): any { return JSON.parse(JSON.stringify(value ?? null)); }
const TEMPLATE_FIELDS = ["proposedName", "goal", "mainMessage", "hook", "mainScript", "cta", "caption", "hashtags"] as const;
function cleanTemplateData(value: unknown) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const output: Record<string, string> = {};
  for (const key of TEMPLATE_FIELDS) if (Object.prototype.hasOwnProperty.call(input, key)) output[key] = clean(input[key]);
  return output;
}
function validateTemplateData(value: unknown) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const keys = Object.keys(input);
  const unknown = keys.filter((key) => !TEMPLATE_FIELDS.includes(key as any));
  const missing = TEMPLATE_FIELDS.filter((key) => !Object.prototype.hasOwnProperty.call(input, key));
  if (unknown.length || missing.length) throw new Error("ملف Task Template لا يطابق الحقول المعتمدة في النظام");
  const output = cleanTemplateData(input);
  const required = ["proposedName", "goal", "mainMessage", "hook", "mainScript", "cta"];
  const empty = required.filter((key) => !clean(output[key]));
  if (empty.length) throw new Error("ملف Task Template ناقص بيانات إلزامية. راجع المعاينة وأعد الرفع");
  return output;
}
function marketingAccess(user: SessionUser) { return getSystemAccess(user, "marketing"); }
function canViewAllTasks(user: SessionUser) { return hasPermission(user, "marketing.task.view_all") && marketingAccess(user).dataScope === "all"; }
function marketingDepartmentCodes(user: SessionUser) { const codes = marketingAccess(user).departmentCodes; return codes.length ? codes : ["__no_department__"]; }
async function canAccessMarketingEntity(sql: ReturnType<typeof getSql>, user: SessionUser, sourceType: string, sourceId: string) {
  const access = marketingAccess(user);
  if (access.dataScope === "all") return true;
  const departmentCodes = marketingDepartmentCodes(user);
  const createdByMe = access.dataScope === "created_by_me";
  const departmentScoped = ["department", "departments", "branch_and_department"].includes(access.dataScope);
  const [visible] = await sql<any[]>`
    select 1
    where exists (
      select 1 from marketing.tasks t
      where t.source_type=${sourceType} and t.source_id=${sourceId}::uuid and t.is_deleted=false
        and (
          t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid
          or (${departmentScoped}=true and exists (
            select 1 from core.user_departments ud join core.departments d on d.id=ud.department_id
            where ud.user_id in (t.assigned_to,t.paired_content_user_id) and d.code in ${sql(departmentCodes)}
          ))
        )
    ) or (${createdByMe}=true and exists (
      select 1 from marketing.campaigns c where ${sourceType}='campaign' and c.id=${sourceId}::uuid and c.created_by=${user.id}::uuid
      union all
      select 1 from marketing.agendas a where ${sourceType}='agenda' and a.id=${sourceId}::uuid and a.created_by=${user.id}::uuid
    ))
    limit 1
  `;
  return Boolean(visible);
}
async function assertMarketingEntityAccess(sql: ReturnType<typeof getSql>, user: SessionUser, sourceType: string, sourceId: string) {
  if (!sourceId || !await canAccessMarketingEntity(sql, user, sourceType, sourceId)) throw new Error("السجل خارج نطاق بياناتك");
}
async function canAccessMarketingTask(sql: ReturnType<typeof getSql>, user: SessionUser, taskId: string) {
  const access = marketingAccess(user);
  if (access.dataScope === "all") return true;
  const departmentCodes = marketingDepartmentCodes(user);
  const createdByMe = access.dataScope === "created_by_me";
  const departmentScoped = ["department", "departments", "branch_and_department"].includes(access.dataScope);
  const [visible] = await sql<any[]>`
    select 1 from marketing.tasks t
    where t.id=${taskId}::uuid and t.is_deleted=false and (
      t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid
      or (${departmentScoped}=true and exists (
        select 1 from core.user_departments ud join core.departments d on d.id=ud.department_id
        where ud.user_id in (t.assigned_to,t.paired_content_user_id) and d.code in ${sql(departmentCodes)}
      ))
      or (${createdByMe}=true and (
        exists(select 1 from marketing.campaigns c where t.source_type='campaign' and c.id=t.source_id and c.created_by=${user.id}::uuid)
        or exists(select 1 from marketing.agendas a where t.source_type='agenda' and a.id=t.source_id and a.created_by=${user.id}::uuid)
      ))
    ) limit 1
  `;
  return Boolean(visible);
}
async function requireTaskTemplateUploadAccess(sql: ReturnType<typeof getSql>, user: SessionUser, taskId: string) {
  if (!taskId) throw new Error("رقم التاسك مطلوب");
  const [task] = await sql<any[]>`
    select t.id::text,t.task_kind,t.source_type,t.source_id::text,t.assigned_to::text,t.paired_content_user_id::text,
      t.task_template_id::text,tt.file_id::text as template_file_id
    from marketing.tasks t
    left join marketing.task_templates tt on tt.id=t.task_template_id
    where t.id=${taskId}::uuid and t.is_deleted=false
  `;
  if (!task || task.task_kind !== "task_template") throw new Error("Task Template غير موجود");
  if (!await canAccessMarketingTask(sql, user, taskId)) throw new Error("لا توجد صلاحية للوصول إلى هذا التكليف");
  const permission = task.template_file_id ? "marketing.task_template.reupload" : "marketing.task_template.upload";
  if (!hasPermission(user, permission)) throw new Error("لا توجد صلاحية لرفع Task Template");
  return task;
}

async function requireFinalFileUploadAccess(sql: ReturnType<typeof getSql>, user: SessionUser, taskId: string) {
  if (!taskId) throw new Error("رقم التاسك مطلوب");
  const [task] = await sql<any[]>`
    select t.id::text,t.task_kind,t.source_type,t.source_id::text,t.assigned_to::text,
      t.approved_template_data,tt.status as template_status
    from marketing.tasks t
    left join marketing.task_templates tt on tt.id=t.task_template_id
    where t.id=${taskId}::uuid and t.is_deleted=false
  `;
  if (!task) throw new Error("التاسك غير موجود");
  const isManualPublish = task.task_kind === "manual_publish";
  const permission = isManualPublish ? "marketing.publish_prep.manage" : "marketing.task.final_file.upload";
  if (!hasPermission(user, permission)) throw new Error(isManualPublish ? "لا توجد صلاحية لإنشاء نشر يدوي" : "لا توجد صلاحية لرفع الملف النهائي");
  if (!await canAccessMarketingTask(sql, user, taskId)) throw new Error("لا توجد صلاحية للوصول إلى هذا التكليف");
  if (task.task_kind === "execution" && task.template_status !== "approved") throw new Error("في انتظار اعتماد Task Template");
  if (!isManualPublish && task.task_kind !== "execution") throw new Error("رفع الملف النهائي غير متاح لهذا النوع من التاسكات");
  return task;
}
function canUseMarketing(user: SessionUser) { return canAccessSystem(user, "marketing"); }
function safeCode(value: unknown) { return clean(value).toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48); }
function zohoFinalFileName(originalName: unknown, sourceType: unknown, sourceId: unknown, taskId: unknown, groupId: unknown, orderIndex: number) {
  const raw=(clean(originalName)||`file-${orderIndex+1}`).replace(/[\/\\\u0000-\u001f]/g,"-");
  const dot=raw.lastIndexOf(".");
  const extension=dot>0&&dot<raw.length-1?raw.slice(dot).slice(0,24):"";
  const stem=(extension?raw.slice(0,dot):raw).trim()||`file-${orderIndex+1}`;
  const prefix=`${clean(sourceType)==='agenda'?'agenda':'campaign'}-${clean(sourceId).slice(0,8)}-${clean(taskId).slice(0,8)}-${clean(groupId).slice(0,8)}-${String(orderIndex+1).padStart(2,'0')}-`;
  return `${prefix}${stem.slice(0,Math.max(20,180-prefix.length-extension.length))}${extension}`;
}
function isoDate(value: unknown) { const text = clean(value); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null; }
function sourceTable(sourceType: string) { return sourceType === "agenda" ? "marketing.agendas" : "marketing.campaigns"; }
async function audit(sql: ReturnType<typeof getSql>, user: SessionUser, action: string, entityType: string, entityId: string | null, afterData?: unknown, beforeData?: unknown, ip?: string | null) {
  await sql`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data,ip_address) values (${user.id}::uuid,'marketing',${action},${entityType},${entityId},${beforeData ? sql.json(dbJson(beforeData)) : null},${afterData ? sql.json(dbJson(afterData)) : null},${ip || null})`;
}

async function marketingMeta(sql: ReturnType<typeof getSql>, user: SessionUser) {
  // Keep marketing metadata mirrored without crashing when an older database
  // contains the same marketing name under a different legacy ID. Existing
  // metadata wins until the user edits it, while missing canonical IDs are
  // inserted only when their normalized name is not already represented.
  await sql`
    update marketing.departments md
    set name=d.name,is_active=d.is_active,updated_at=greatest(md.updated_at,d.updated_at)
    from core.departments d
    where d.id=md.id and d.system_code='marketing'
      and not exists(
        select 1 from marketing.departments conflicting_name
        where conflicting_name.id<>md.id
          and lower(btrim(conflicting_name.name))=lower(btrim(d.name))
      )
  `;
  await sql`
    insert into marketing.departments(id,name,is_content,is_active,created_at,updated_at)
    select d.id,d.name,false,d.is_active,d.created_at,d.updated_at
    from core.departments d
    where d.system_code='marketing'
      and not exists(select 1 from marketing.departments by_id where by_id.id=d.id)
      and not exists(
        select 1 from marketing.departments by_name
        where lower(btrim(by_name.name))=lower(btrim(d.name))
      )
    on conflict(id) do update set name=excluded.name,is_active=excluded.is_active,updated_at=greatest(marketing.departments.updated_at,excluded.updated_at)
  `;

  // Recover the single canonical content department ID. Older data can keep the
  // user membership on the correct department while the is_content flag points
  // to another row. Prefer the established content department name only as a
  // repair fallback, then persist the chosen UUID so every screen uses the same ID.
  const [contentDepartment] = await sql<any[]>`
    select md.id::text
    from marketing.departments md
    join core.departments cd on cd.id=md.id and cd.system_code='marketing'
    left join lateral (
      select count(*)::int as members
      from core.user_system_departments usd
      where usd.system_code='marketing' and usd.department_id=md.id
    ) membership on true
    where md.is_active=true and cd.is_active=true
      and (
        md.is_content=true
        or replace(lower(btrim(cd.name)), ' ', '') in ('قسمالمحتوى','المحتوى','content','contentdepartment')
      )
    order by
      case when replace(lower(btrim(cd.name)), ' ', '') in ('قسمالمحتوى','المحتوى','content','contentdepartment') then 0 else 1 end,
      md.is_content desc,
      coalesce(membership.members,0) desc,
      md.created_at,
      md.id
    limit 1
  `;
  const contentDepartmentIdValue=clean(contentDepartment?.id);
  if(contentDepartmentIdValue){
    await sql`
      update marketing.departments
      set is_content=(id=${contentDepartmentIdValue}::uuid),updated_at=case when is_content is distinct from (id=${contentDepartmentIdValue}::uuid) then now() else updated_at end
      where is_content=true or id=${contentDepartmentIdValue}::uuid
    `;
  }
  const [users, departments, actions, creativeTypes, campaignTypes, platforms, postTypes, funnels] = await Promise.all([
    sql<any[]>`
      select u.id::text,u.full_name,u.email,u.mobile,u.is_active,u.can_receive_tasks
      from core.users u
      where u.is_active=true
        and coalesce(u.disabled_reason,'') not like 'ACCOUNT_DELETED:%'
      order by u.full_name
    `,
    sql<any[]>`
      select d.id::text,cd.name,d.is_content,(d.is_active and cd.is_active) as is_active,
        coalesce(
          json_agg(
            json_build_object('id',u.id::text,'fullName',u.full_name,'email',u.email)
            order by u.full_name
          ) filter(where u.id is not null),
          '[]'::json
        ) as users
      from marketing.departments d
      join core.departments cd on cd.id=d.id and cd.system_code='marketing'
      left join core.user_system_departments usd on usd.department_id=d.id and usd.system_code='marketing'
      left join core.users u on u.id=usd.user_id and u.is_active=true and coalesce(u.disabled_reason,'') not like 'ACCOUNT_DELETED:%'
      where d.is_active=true and cd.is_active=true
      group by d.id,cd.name,cd.is_active
      order by d.is_content desc,cd.name
    `,
    sql<any[]>`select a.id::text,a.department_id::text,cd.name as department_name,a.name,a.percentage::float,a.admin_only,a.sort_order from marketing.assignment_actions a join core.departments cd on cd.id=a.department_id and cd.system_code='marketing' where a.is_active=true order by cd.name,a.sort_order,a.created_at`,
    sql<any[]>`select c.id::text,c.name,c.short_code,c.primary_department_id::text,cd.name as primary_department_name,c.is_active from marketing.creative_types c left join core.departments cd on cd.id=c.primary_department_id and cd.system_code='marketing' where c.is_active=true order by c.name`,
    sql<any[]>`select id::text,name,short_code,code_prefix,sequence_value,is_active from marketing.campaign_types where is_active=true order by name`,
    sql<any[]>`select id::text,code,name,is_active from marketing.platforms where is_active=true order by name`,
    sql<any[]>`select p.id::text,p.platform_id::text,p.name,p.width,p.height from marketing.platform_post_types p where p.is_active=true order by p.name`,
    sql<any[]>`select id::text,name,active,source,created_at from marketing.funnels where active=true order by created_at`,
  ]);
  const connections = await sql<any[]>`select * from marketing.platform_connections order by platform`;
  return { ok: true, users, departments, contentDepartmentId: contentDepartmentIdValue, actions, creativeTypes, campaignTypes, platforms, postTypes, funnels, connections: connections.map(publicPlatformConnection), permissions: { effective: user.permissions.filter((code) => code.startsWith("marketing.")) } };
}

async function createFunnel(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: SessionUser) {
  if (!hasPermission(user, "marketing.campaign.create") && !hasPermission(user, "marketing.campaign.edit")) {
    throw new Error("لا توجد صلاحية لإضافة Funnel جديد");
  }
  const name = clean(body.name).replace(/\s+/g, " ");
  if (!name) throw new Error("اكتب اسم Funnel الجديد");
  if (name.length > 100) throw new Error("اسم Funnel يجب ألا يزيد عن 100 حرف");

  const [existing] = await sql<any[]>`
    select id::text,name,active
    from marketing.funnels
    where lower(btrim(name))=lower(${name})
    order by active desc,created_at
    limit 1
  `;
  if (existing) {
    const [funnel] = await sql<any[]>`
      update marketing.funnels
      set active=true,source=coalesce(nullif(source,''),'campaign_budget')
      where id=${existing.id}::uuid
      returning id::text,name
    `;
    return { ok: true, id: funnel.id, funnel, message: "تم اختيار Funnel الموجود بالفعل" };
  }

  const [funnel] = await sql<any[]>`
    insert into marketing.funnels(name,active,source)
    values(${name},true,'campaign_budget')
    on conflict(name) do update
    set active=true,source=coalesce(nullif(marketing.funnels.source,''),'campaign_budget')
    returning id::text,name
  `;
  return { ok: true, id: funnel.id, funnel, message: "تمت إضافة Funnel بنجاح" };
}

async function loadOperationsCars(sql: ReturnType<typeof getSql>) {
  return sql<any[]>`
    select v.id::text,v.vin,v.car_name,v.statement,v.model_year,v.exterior_color,v.interior_color,
      v.location_id::text,l.code as location_code,l.name as location_name,l.branch_code,
      v.status_code,coalesce(vs.name,v.status_code) as status_name,
      coalesce(v.photographed,false) as photographed,v.photographed_at,
      coalesce(a.financial_approved,false) as financial_approved,
      coalesce(a.administrative_approved,false) as administrative_approved,
      coalesce(req.active_requests,0)::int as active_transfer_requests,
      coalesce(ms.content_usage,'[]'::jsonb) as content_usage
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.vehicle_statuses vs on vs.code=v.status_code
    left join lateral (
      select va.financial_approved,va.administrative_approved
      from operations.vehicle_approvals va
      where va.vehicle_id=v.id and va.is_active=true
      order by va.cycle_no desc limit 1
    ) a on true
    left join lateral (
      select count(*)::int as active_requests
      from operations.transfer_request_vehicles rv
      join operations.transfer_requests r on r.id=rv.transfer_request_id
      where rv.vehicle_id=v.id and r.is_deleted=false and r.cancelled_at is null and r.status<>'completed'
    ) req on true
    left join marketing.stock_vehicle_state ms on ms.vehicle_id=v.id
    where v.is_deleted=false and v.archived_at is null and coalesce(v.is_inventory_active,true)=true
    order by v.car_name,v.statement,v.exterior_color,v.interior_color,v.vin
  `;
}

async function allocateCampaignCode(tx: any, campaignTypeId: string, requestedCode?: string | null) {
  const [type] = await tx<any[]>`select * from marketing.campaign_types where id=${campaignTypeId}::uuid and is_active=true for update`;
  if (!type) throw new Error("نوع الحملة غير موجود");

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const base = `${safeCode(type.code_prefix || type.short_code)}-${year}-${month}-`;
  const requested = clean(requestedCode);

  if (requested && requested.startsWith(base)) {
    const [duplicate] = await tx<any[]>`select 1 from marketing.campaigns where campaign_code=${requested} limit 1`;
    if (!duplicate) {
      const requestedSequence = Number(requested.slice(base.length));
      if (Number.isInteger(requestedSequence) && requestedSequence > Number(type.sequence_value || 0)) {
        await tx`update marketing.campaign_types set sequence_value=${requestedSequence},updated_at=now() where id=${campaignTypeId}::uuid`;
      }
      return requested;
    }
  }

  const [existing] = await tx<any[]>`
    select coalesce(max((substring(campaign_code from '([0-9]+)$'))::int),0)::int as max_sequence
    from marketing.campaigns
    where campaign_code like ${`${base}%`}
  `;
  const sequence = Math.max(Number(type.sequence_value || 0), Number(existing?.max_sequence || 0)) + 1;
  await tx`update marketing.campaign_types set sequence_value=${sequence},updated_at=now() where id=${campaignTypeId}::uuid`;
  return `${base}${String(sequence).padStart(3, "0")}`;
}

async function nextCampaignCode(sql: ReturnType<typeof getSql>, campaignTypeId: string) {
  return sql.begin(async (tx) => allocateCampaignCode(tx, campaignTypeId));
}

function contentDepartmentId(meta: { contentDepartmentId?: string; departments: any[] }) { return clean(meta.contentDepartmentId || meta.departments.find((item) => item.is_content)?.id); }

type ExecutionFolderCreationInput = { request?: Record<string, any>; result?: Record<string, any> };

type ExecutionFolderLinkInput = {
  creativeLinkId: string;
  creativeName: string;
  assignedTo: string;
};

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function objectItems(value: unknown) {
  if (Array.isArray(value)) return value.map(objectValue);
  return Object.values(objectValue(value)).map(objectValue);
}

function normalizedFolderMatch(value: unknown) {
  return clean(value).normalize("NFKC").toLocaleLowerCase("en-US");
}

function firstText(value: unknown, keys: string[]) {
  const record = objectValue(value);
  for (const key of keys) {
    const text = clean(record[key]);
    if (text) return text;
  }
  return "";
}

function joinServerPath(base: unknown, ...parts: unknown[]) {
  const root = clean(base).replace(/\\/g, "/").replace(/\/+$/g, "");
  const tail = parts.map((part) => clean(part).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")).filter(Boolean);
  return [root, ...tail].filter(Boolean).join("/");
}

function raidrivePathFromServerPath(serverPath: unknown, driveLetter: unknown, roots: unknown[]) {
  let value = clean(serverPath);
  if (!value) return "";
  try { value = decodeURIComponent(value); } catch { /* keep the exact path returned by the server */ }
  if (/^file:\/\//i.test(value)) value = value.replace(/^file:\/+/i, "/");
  if (/^[a-z]:[\\/]/i.test(value)) return value.replace(/\//g, "\\").replace(/\\+$/g, "");

  const normalized = value.replace(/\\/g, "/").replace(/\/+$/g, "");
  const candidateRoots = [...new Set([
    ...roots.map((root) => clean(root).replace(/\\/g, "/").replace(/\/+$/g, "")).filter(Boolean),
    process.env.MZJ_RAW_ROOT,
    "/var/www/mzj-raw",
  ].map((root) => clean(root).replace(/\\/g, "/").replace(/\/+$/g, "")).filter(Boolean))]
    .sort((a, b) => b.length - a.length);

  let relative = "";
  for (const root of candidateRoots) {
    if (normalized.startsWith(`${root}/`)) { relative = normalized.slice(root.length + 1); break; }
  }
  if (!relative) {
    const marker = normalized.toLocaleLowerCase("en-US").indexOf("/mzj-raw/");
    if (marker >= 0) relative = normalized.slice(marker + "/mzj-raw/".length);
  }
  if (!relative && !normalized.startsWith("/")) relative = normalized;
  if (!relative) return "";

  const drive = (clean(driveLetter) || "Z:").replace(/[\\/]+$/g, "");
  const windowsRelative = relative.split("/").filter(Boolean).join("\\");
  return windowsRelative ? `${drive}\\${windowsRelative}` : `${drive}\\`;
}

function raidriveFolderPath(driveLetter: unknown, parts: unknown[]) {
  const drive = (clean(driveLetter) || "Z:").replace(/[\\/]+$/g, "");
  const folders = parts
    .map((part) => clean(part).replace(/[\\/]+/g, "-").replace(/^\.+|\.+$/g, "").trim())
    .filter(Boolean);
  return folders.length ? `${drive}\\${folders.join("\\")}` : "";
}

function normalizedWindowsFolderPath(value: unknown) {
  let path = clean(value);
  if (!path) return "";
  try { path = decodeURIComponent(path); } catch { /* keep stored value */ }
  path = path.replace(/^file:\/+/i, "").replace(/\//g, "\\").replace(/\\+$/g, "");
  return /^[a-z]:\\/i.test(path) ? path : "";
}

function repairedExecutionFolders(value: unknown) {
  const folders = objectValue(value);
  if (!folders.linked) return folders;
  const driveLetter = clean(folders.driveLetter) || "Z:";
  const roots = [folders.rawRoot, folders.rootPath, folders.basePath, "/var/www/mzj-raw"];
  // Translate the exact filesystem paths returned by the RAW server first. The
  // deterministic path is only a compatibility fallback for older task rows.
  const rawWindowsPath = raidrivePathFromServerPath(folders.rawServerPath, driveLetter, roots)
    || normalizedWindowsFolderPath(folders.rawWindowsPath)
    || raidriveFolderPath(driveLetter, [folders.monthKey, folders.campaignFolderName, folders.creativeFolderName, "01-RAW"]);
  const outputWindowsPath = raidrivePathFromServerPath(folders.outputServerPath, driveLetter, roots)
    || normalizedWindowsFolderPath(folders.outputWindowsPath)
    || raidriveFolderPath(driveLetter, [folders.monthKey, folders.campaignFolderName, folders.creativeFolderName, "02-OUTPUT"]);
  const userOutputWindowsPath = raidrivePathFromServerPath(folders.userOutputServerPath, driveLetter, roots)
    || normalizedWindowsFolderPath(folders.userOutputWindowsPath)
    || raidriveFolderPath(driveLetter, [folders.monthKey, folders.campaignFolderName, folders.creativeFolderName, "02-OUTPUT", folders.userFolderName]);
  return {
    ...folders,
    version: 4,
    rawWindowsPath,
    outputWindowsPath,
    userOutputWindowsPath: userOutputWindowsPath || outputWindowsPath,
  };
}

function executionFoldersForTask(creationValue: unknown, input: ExecutionFolderLinkInput) {
  const creation = objectValue(creationValue) as ExecutionFolderCreationInput;
  const request = objectValue(creation.request);
  const result = objectValue(creation.result);
  if (!Object.keys(request).length || !Object.keys(result).length || result.ok === false) return null;

  const creativeLinkId = normalizedFolderMatch(input.creativeLinkId);
  const creativeName = normalizedFolderMatch(input.creativeName);
  const requestCreatives = arrayValue<Record<string, any>>(request.creatives);
  const requestCreative = requestCreatives.find((item) => normalizedFolderMatch(item.creativeInstanceId) === creativeLinkId)
    || requestCreatives.find((item) => normalizedFolderMatch(item.folderName) === creativeLinkId)
    || requestCreatives.find((item) => normalizedFolderMatch(item.name) === creativeName);
  if (!requestCreative) return null;

  const serverCreatives = objectItems(result.rawFolders);
  const requestFolderName = clean(requestCreative.folderName);
  const serverCreative = serverCreatives.find((item) => normalizedFolderMatch(item.creativeInstanceId) === creativeLinkId)
    || serverCreatives.find((item) => normalizedFolderMatch(item.folderName) === normalizedFolderMatch(requestFolderName))
    || serverCreatives.find((item) => normalizedFolderMatch(item.name) === creativeName);
  if (!serverCreative) return null;

  const assignedTo = clean(input.assignedTo);
  const requestUser = arrayValue<Record<string, any>>(requestCreative.users).find((item) => clean(item.uid || item.id) === assignedTo);
  if (!requestUser) return null;
  const serverUsers = objectItems(serverCreative.users);
  const serverUser = serverUsers.find((item) => clean(item.uid || item.id || item.userId) === assignedTo)
    || serverUsers.find((item) => normalizedFolderMatch(item.folderName) === normalizedFolderMatch(requestUser.folderName || requestUser.name));
  if (!serverUser) return null;

  const driveLetter = clean(request.driveLetter || result.driveLetter) || "Z:";
  const monthKey = clean(result.monthKey || request.monthKey);
  const campaignCode = clean(result.campaignCode || request.campaignCode);
  const campaignFolderName = clean(result.campaignFolderName || request.campaignFolderName || request.campaignDisplayName || campaignCode);
  const creativeFolderName = clean(serverCreative.folderName || requestCreative.folderName || requestCreative.name);
  const userFolderName = clean(serverUser.folderName || requestUser.folderName || requestUser.name);
  const rawRoots = [result.rawRoot, result.rootPath, result.basePath, request.remoteRoot, request.rawRoot];

  const campaignServerPath = firstText(result, ["campaignFolderPath", "folderPath", "campaignPath"])
    || joinServerPath(firstText(result, ["rawRoot", "rootPath", "basePath"]) || request.remoteRoot || request.rawRoot, monthKey, campaignFolderName);
  const creativeServerPath = firstText(serverCreative, ["folderPath", "creativeFolderPath", "path"])
    || joinServerPath(campaignServerPath, creativeFolderName);
  const rawServerPath = firstText(serverCreative, ["rawFolderPath", "rawPath"])
    || joinServerPath(creativeServerPath, "01-RAW");
  const outputServerPath = firstText(serverCreative, ["outputFolderPath", "outputPath"])
    || joinServerPath(creativeServerPath, "02-OUTPUT");
  const userOutputServerPath = firstText(serverUser, ["folderPath", "outputFolderPath", "path"])
    || joinServerPath(outputServerPath, userFolderName);

  // The RAW server's folderPath values are authoritative because they contain
  // its exact safeName output. Translate those paths to the RaiDrive mount; do
  // not guess folder names from the form, which makes Explorer fall back to
  // Documents when the guessed directory does not exist.
  const explicitRawWindowsPath = firstText(serverCreative, ["rawWindowsPath", "windowsRawPath"]);
  const explicitOutputWindowsPath = firstText(serverCreative, ["outputWindowsPath", "windowsOutputPath"]);
  const explicitUserOutputWindowsPath = firstText(serverUser, ["userOutputWindowsPath", "outputWindowsPath", "windowsPath"]);
  const rawWindowsPath = normalizedWindowsFolderPath(explicitRawWindowsPath)
    || raidrivePathFromServerPath(rawServerPath, driveLetter, rawRoots)
    || raidriveFolderPath(driveLetter, [monthKey, campaignFolderName, creativeFolderName, "01-RAW"]);
  const outputWindowsPath = normalizedWindowsFolderPath(explicitOutputWindowsPath)
    || raidrivePathFromServerPath(outputServerPath, driveLetter, rawRoots)
    || raidriveFolderPath(driveLetter, [monthKey, campaignFolderName, creativeFolderName, "02-OUTPUT"]);
  const userOutputWindowsPath = normalizedWindowsFolderPath(explicitUserOutputWindowsPath)
    || raidrivePathFromServerPath(userOutputServerPath, driveLetter, rawRoots)
    || raidriveFolderPath(driveLetter, [monthKey, campaignFolderName, creativeFolderName, "02-OUTPUT", userFolderName]);
  if (!rawWindowsPath || !userOutputWindowsPath) return null;

  const subFolders = objectValue(serverCreative.subFolders);
  return {
    linked: true,
    version: 4,
    type: "raidrive_sftp",
    driveLetter,
    monthKey,
    campaignCode,
    campaignFolderName,
    creativeFolderName,
    userFolderName,
    creativeInstanceId: clean(serverCreative.creativeInstanceId || requestCreative.creativeInstanceId),
    assignedUserId: assignedTo,
    rawServerPath,
    outputServerPath,
    userOutputServerPath,
    rawFolderUrl: clean(serverCreative.rawFolderUrl || subFolders.raw),
    outputFolderUrl: clean(serverCreative.outputFolderUrl || subFolders.output),
    userOutputFolderUrl: clean(serverUser.outputFolderUrl || serverUser.folderUrl),
    rawWindowsPath,
    outputWindowsPath,
    userOutputWindowsPath,
  };
}

async function createTasksForCreative(tx: any, input: { sourceType: "campaign" | "agenda"; sourceId: string; campaignId?: string | null; agendaId?: string | null; sourceCode: string; sourceName: string; creativeId: string; creativeIndex: number; creativeName: string; creativeType: string; contentDepartmentId: string; contentAssignments: any[]; primaryDepartmentId?: string; primaryAssignments: any[]; optionalAssignments: any[]; requiredFromContent?: string; executionFolderCreation?: unknown; creativeFolderLinkId?: string }) {
  const templates = new Map<string, string>();
  let templateIndex = 0;
  for (const content of input.contentAssignments) {
    const contentUserId = clean(content.userId); if (!contentUserId) continue;
    templateIndex += 1;
    const taskNo = `${safeCode(input.sourceCode || input.sourceName)}_${input.sourceId.slice(0,8).toUpperCase()}_TPL_${input.creativeIndex}_${templateIndex}`;
    const [template] = await tx<any[]>`
      insert into marketing.task_templates(source_type,source_id,creative_id,content_user_id,task_no,status,progress,due_on,department_note,template_data)
      values (${input.sourceType},${input.sourceId}::uuid,${input.creativeId}::uuid,${contentUserId}::uuid,${taskNo},'not_started',0,${isoDate(content.dueOn)},${clean(content.note)||null},${tx.json(dbJson({ sourceName: input.sourceName, sourceCode: input.sourceCode, creativeName: input.creativeName, creativeType: input.creativeType, requiredFromContent: input.requiredFromContent || "" }))})
      returning id::text
    `;
    templates.set(contentUserId, template.id);
    await tx`
      insert into marketing.tasks(campaign_id,agenda_id,source_type,source_id,creative_id,department_code,department_id,assigned_to,paired_content_user_id,task_template_id,task_kind,title,status,due_at,progress,note)
      values (${input.campaignId ? tx`${input.campaignId}::uuid` : null},${input.agendaId ? tx`${input.agendaId}::uuid` : null},${input.sourceType},${input.sourceId}::uuid,${input.creativeId}::uuid,'content',${input.contentDepartmentId ? tx`${input.contentDepartmentId}::uuid` : null},${contentUserId}::uuid,${contentUserId}::uuid,${template.id}::uuid,'task_template',${`Task Template - ${input.creativeName}`},'required',${isoDate(content.dueOn)},0,${clean(content.note)||null})
    `;
  }
  if (!templates.size) throw new Error(`اختر كاتب محتوى واحدًا على الأقل داخل ${input.creativeName}`);

  const contentUserIds = Array.from(templates.keys());
  const groups = [
    { departmentId: clean(input.primaryDepartmentId), assignments: input.primaryAssignments },
    ...arrayValue(input.optionalAssignments).map((group: any) => ({ departmentId: clean(group.departmentId), assignments: arrayValue(group.assignments) })),
  ];
  const linkedTemplateUsers = new Set<string>();
  let taskIndex = 0;
  for (const group of groups) {
    if (!group.departmentId) continue;
    for (const assignment of arrayValue(group.assignments)) {
      const assignedTo = clean(assignment.userId); if (!assignedTo) continue;
      const explicitLinks = arrayValue<string>(assignment.contentUserIds)
        .map(clean)
        .filter((contentUserId) => Boolean(contentUserId) && templates.has(contentUserId));
      const linkedContentUserIds = explicitLinks.length
        ? Array.from(new Set(explicitLinks))
        : contentUserIds.length === 1
          ? [contentUserIds[0]]
          : [];

      for (const contentUserId of linkedContentUserIds) {
        const templateId = templates.get(contentUserId); if (!templateId) continue;
        taskIndex += 1;
        linkedTemplateUsers.add(contentUserId);
        const executionFolders = executionFoldersForTask(input.executionFolderCreation, {
          creativeLinkId: clean(input.creativeFolderLinkId) || input.creativeName,
          creativeName: input.creativeName,
          assignedTo,
        });
        const [task] = await tx<any[]>`
          insert into marketing.tasks(campaign_id,agenda_id,source_type,source_id,creative_id,department_code,department_id,assigned_to,paired_content_user_id,task_template_id,task_kind,title,status,due_at,progress,note,execution_folders)
          values (${input.campaignId ? tx`${input.campaignId}::uuid` : null},${input.agendaId ? tx`${input.agendaId}::uuid` : null},${input.sourceType},${input.sourceId}::uuid,${input.creativeId}::uuid,'execution',${group.departmentId}::uuid,${assignedTo}::uuid,${contentUserId}::uuid,${templateId}::uuid,'execution',${`${input.creativeName} - تنفيذ ${taskIndex}`},'required',${isoDate(assignment.dueOn)},0,${clean(assignment.note)||null},${tx.json(dbJson(executionFolders || {}))})
          returning id::text
        `;
        await tx`insert into marketing.task_action_progress(task_id,action_id) select ${task.id}::uuid,id from marketing.assignment_actions where department_id=${group.departmentId}::uuid and is_active=true on conflict do nothing`;
      }
    }
  }

  if (!taskIndex) throw new Error(`اختر يوزرًا تنفيذيًا واربطه بكاتب المحتوى داخل ${input.creativeName}`);
  const unlinkedContentUser = contentUserIds.find((contentUserId) => !linkedTemplateUsers.has(contentUserId));
  if (unlinkedContentUser) throw new Error(`يجب ربط كل Task Template بتاسك تنفيذي داخل ${input.creativeName}`);
}

async function createCampaignInTransaction(
  tx: any,
  body: Record<string, any>,
  user: SessionUser,
  contentId: string,
  options: { preserveRequestedCode?: boolean } = {},
) {
  const campaignTypeId = clean(body.campaignTypeId); const name = clean(body.name); const start = isoDate(body.publishStart); const end = isoDate(body.publishEnd);
  if (!campaignTypeId || !name || !start || !end) throw new Error("بيانات الحملة الأساسية غير مكتملة");
  const requestedCode = clean(body.campaignCode);
  let code = requestedCode && options.preserveRequestedCode
    ? requestedCode
    : await allocateCampaignCode(tx, campaignTypeId, requestedCode);
  let campaign: any = null;
  for (let attempt = 0; attempt < 3 && !campaign; attempt += 1) {
    [campaign] = await tx<any[]>`
      insert into marketing.campaigns(campaign_code,name,campaign_type_id,campaign_type,objective,status,campaign_date,publish_start,publish_end,starts_at,ends_at,required_from_content,payload,progress,created_by)
      select ${code},${name},ct.id,ct.name,${clean(body.objective)||null},'required',${isoDate(body.campaignDate)||new Date().toISOString().slice(0,10)},${start},${end},${start}::date,${end}::date,${clean(body.requiredFromContent)||null},${tx.json(dbJson({ ...body, campaignCode: code }))},0,${user.id}::uuid
      from marketing.campaign_types ct where ct.id=${campaignTypeId}::uuid and ct.is_active=true
      on conflict(campaign_code) do nothing
      returning id::text,campaign_code,name
    `;
    if (!campaign) {
      if (options.preserveRequestedCode && requestedCode) throw new Error("كود الحملة موجود بالفعل داخل النظام الجديد");
      code = await allocateCampaignCode(tx, campaignTypeId);
    }
  }
  if (!campaign) throw new Error("تعذر إنشاء كود حملة فريد. أعد المحاولة مرة أخرى");
  const creativeMap = new Map<string, string>();
  let creativeIndex = 0;
  for (const rawCreative of arrayValue(body.creatives)) {
    creativeIndex += 1;
    const creativeTypeId = clean(rawCreative.creativeTypeId);
    const [creativeType] = await tx<any[]>`select c.*,d.name as department_name from marketing.creative_types c left join marketing.departments d on d.id=c.primary_department_id where c.id=${creativeTypeId}::uuid`;
    if (!creativeType) continue;
    const requestedCreativeName = clean(rawCreative.name);
    if (!requestedCreativeName && !options.preserveRequestedCode) throw new Error(`اكتب اسم الكرييتيف من نوع ${creativeType.name}`);
    if (requestedCreativeName.length > 160) throw new Error("اسم الكرييتيف يجب ألا يزيد عن 160 حرف");
    const creativeName = requestedCreativeName || creativeType.name;
    const tempId = clean(rawCreative.tempId || rawCreative.id || `creative-${creativeIndex}`);
    const instanceCode = `${safeCode(creativeType.short_code)}${String(creativeIndex).padStart(2,"0")}`;
    const [creative] = await tx<any[]>`
      insert into marketing.creatives(campaign_id,creative_type,creative_type_id,quantity,status,instance_code,name,primary_department_id,cars,content_assignments,primary_assignments,optional_assignments,platform_assignments,notes)
      values (${campaign.id}::uuid,${creativeType.name},${creativeTypeId}::uuid,1,'required',${instanceCode},${creativeName},${creativeType.primary_department_id},${tx.json(dbJson(arrayValue(rawCreative.cars)))},${tx.json(dbJson(arrayValue(rawCreative.contentAssignments)))},${tx.json(dbJson(arrayValue(rawCreative.primaryAssignments)))},${tx.json(dbJson(arrayValue(rawCreative.optionalAssignments)))},${tx.json(dbJson(arrayValue(rawCreative.platforms)))},${tx.json(dbJson(rawCreative.notes || {}))}) returning id::text
    `;
    creativeMap.set(tempId, creative.id);
    await createTasksForCreative(tx, { sourceType: "campaign", sourceId: campaign.id, campaignId: campaign.id, sourceCode: code, sourceName: name, creativeId: creative.id, creativeIndex, creativeName, creativeType: creativeType.name, contentDepartmentId: contentId, contentAssignments: arrayValue(rawCreative.contentAssignments), primaryDepartmentId: clean(creativeType.primary_department_id), primaryAssignments: arrayValue(rawCreative.primaryAssignments), optionalAssignments: arrayValue(rawCreative.optionalAssignments), requiredFromContent: clean(body.requiredFromContent), executionFolderCreation: body.executionFolders, creativeFolderLinkId: tempId });
  }
  for (const budget of arrayValue(body.budgets)) {
    const requestedCreativeIds = arrayValue<string>(budget.creativeTempIds).length
      ? arrayValue<string>(budget.creativeTempIds)
      : [clean(budget.creativeTempId)].filter(Boolean);
    const creativeIds = [...new Set(requestedCreativeIds.flatMap((tempId) => {
      const creativeId = creativeMap.get(clean(tempId));
      return creativeId ? [creativeId] : [];
    }))];
    if (!creativeIds.length) continue;
    const amounts = arrayValue(budget.platformAmounts)
      .map((item: any) => ({ platformId: clean(item.platformId), amount: Math.max(0, numberValue(item.amount)) }))
      .filter((item: any) => item.platformId);
    const total = amounts.reduce((sum, item: any) => sum + item.amount, 0);
    const [budgetItem] = await tx<any[]>`
      insert into marketing.budget_items(campaign_id,funnel_id,creative_id,ads_count,content_goal,expected_goal,platform_amounts,total)
      values(
        ${campaign.id}::uuid,
        ${clean(budget.funnelId) ? tx`${clean(budget.funnelId)}::uuid` : null},
        ${creativeIds.length === 1 ? tx`${creativeIds[0]}::uuid` : null},
        ${Math.max(1,numberValue(budget.adsCount,1))},
        ${clean(budget.contentGoal)||null},
        ${clean(budget.expectedGoal)||null},
        ${tx.json(dbJson(amounts))},
        ${total}
      ) returning id::text
    `;
    for (const creativeId of creativeIds) {
      await tx`insert into marketing.budget_item_creatives(budget_item_id,creative_id) values(${budgetItem.id}::uuid,${creativeId}::uuid) on conflict do nothing`;
    }
  }
  for (const item of arrayValue(body.schedule)) {
    const requestedCreativeIds = arrayValue<string>(item.creativeTempIds).length
      ? arrayValue<string>(item.creativeTempIds)
      : [clean(item.creativeTempId)].filter(Boolean);
    const creativeIds = [...new Set(requestedCreativeIds.flatMap((tempId) => {
      const creativeId = creativeMap.get(clean(tempId));
      return creativeId ? [creativeId] : [];
    }))];
    const publishDate = isoDate(item.date);
    if (!creativeIds.length || !publishDate) continue;
    for (const creativeId of creativeIds) {
      const executionTasks = await tx<any[]>`select id::text from marketing.tasks where creative_id=${creativeId}::uuid and task_kind='execution' and is_deleted=false order by created_at`;
      const scheduleTasks = executionTasks.length ? executionTasks : [{ id: null }];
      for (const scheduleTask of scheduleTasks) {
        const [scheduleGroup] = await tx<any[]>`select gen_random_uuid()::text as id`;
        for (const platform of arrayValue(item.platforms)) for (const postTypeId of arrayValue<string>(platform.postTypeIds)) {
          await tx`insert into marketing.publish_schedule(group_id,source_type,source_id,creative_id,task_id,publish_date,platform_id,post_type_id) values (${scheduleGroup.id}::uuid,'campaign',${campaign.id}::uuid,${creativeId}::uuid,${scheduleTask.id ? tx`${scheduleTask.id}::uuid` : null},${publishDate},${clean(platform.platformId)}::uuid,${clean(postTypeId)}::uuid)`;
        }
      }
    }
  }
  await audit(tx as any,user,"campaign_created","campaign",campaign.id,{ code,name },undefined,undefined);
  return { ok: true, id: campaign.id, code, message: "تم إنشاء الحملة والتاسكات" };
}

async function createCampaign(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: SessionUser) {
  const meta = await marketingMeta(sql, user);
  const contentId = contentDepartmentId(meta);
  return sql.begin((tx) => createCampaignInTransaction(tx, body, user, contentId));
}

function datesBetween(start: string, end: string) {
  const output: string[] = []; const date = new Date(`${start}T00:00:00Z`); const last = new Date(`${end}T00:00:00Z`);
  while (date <= last && output.length < 370) { output.push(date.toISOString().slice(0,10)); date.setUTCDate(date.getUTCDate()+1); }
  return output;
}

async function createAgendaInTransaction(tx: any, body: Record<string, any>, user: SessionUser, contentId: string) {
  const name = clean(body.name); const start = isoDate(body.publishStart); const end = isoDate(body.publishEnd); const monthKey = clean(body.monthKey);
  if (!name || !start || !end || !monthKey) throw new Error("بيانات الأجندة الأساسية غير مكتملة");
  const [agenda] = await tx<any[]>`insert into marketing.agendas(name,month_key,publish_start,publish_end,status,payload,progress,created_by) values (${name},${monthKey},${start},${end},'required',${tx.json(dbJson(body))},0,${user.id}::uuid) returning id::text`;
  let creativeIndex = 0;
  for (const day of arrayValue(body.days)) {
    const dayDate = isoDate(day.date); if (!dayDate) continue;
    for (const rawCreative of arrayValue(day.creatives)) {
      const quantity = Math.max(1,numberValue(rawCreative.quantity,1));
      for (let instance=0; instance<quantity; instance += 1) {
        creativeIndex += 1;
        const creativeTypeId = clean(rawCreative.creativeTypeId);
        const [creativeType] = await tx<any[]>`select * from marketing.creative_types where id=${creativeTypeId}::uuid`;
        if (!creativeType) continue;
        const contentAssignmentMap = new Map<string, any>();
        for (const assignment of arrayValue(rawCreative.contentAssignments)) {
          const userId = clean(assignment.userId);
          if (!userId) continue;
          contentAssignmentMap.set(userId, { ...assignment, userId });
        }
        const contentAssignments = [...contentAssignmentMap.values()];
        const contentUserIds = contentAssignments.map((item: any) => clean(item.userId)).filter(Boolean);
        if (!contentUserIds.length) throw new Error(`اختر يوزر قسم المحتوى للكرييتيف ${creativeType.name}`);

        const normalizeExecutionAssignments = (assignments: any[]) => {
          const assignmentMap = new Map<string, any>();
          for (const assignment of arrayValue(assignments)) {
            const userId = clean(assignment.userId);
            if (!userId) continue;
            const linked = arrayValue<string>(assignment.contentUserIds).map(clean).filter((id) => contentUserIds.includes(id));
            const existing = assignmentMap.get(userId);
            assignmentMap.set(userId, {
              ...(existing || assignment),
              ...assignment,
              userId,
              contentUserIds: [...new Set([...(existing?.contentUserIds || []), ...linked])],
            });
          }
          return [...assignmentMap.values()];
        };
        const primaryAssignments = normalizeExecutionAssignments(rawCreative.primaryAssignments);
        const optionalAssignments = arrayValue(rawCreative.optionalAssignments).map((group: any) => ({
          ...group,
          assignments: normalizeExecutionAssignments(group.assignments),
        }));
        const executionAssignments = [
          ...primaryAssignments,
          ...optionalAssignments.flatMap((group: any) => arrayValue(group.assignments)),
        ];
        if (!executionAssignments.length) throw new Error(`اختر يوزرًا تنفيذيًا للكرييتيف ${creativeType.name}`);
        const coveredContentUsers = new Set(executionAssignments.flatMap((assignment: any) => arrayValue<string>(assignment.contentUserIds).map(clean).filter(Boolean)));
        const missingContentUsers = contentUserIds.filter((id: string) => !coveredContentUsers.has(id));
        if (missingContentUsers.length && executionAssignments.length === 1) {
          executionAssignments[0].contentUserIds = [...new Set([...arrayValue<string>(executionAssignments[0].contentUserIds).map(clean).filter(Boolean), ...missingContentUsers])];
        } else if (missingContentUsers.length) {
          throw new Error(`كل Task Template يجب ربطه بتاسك تنفيذي داخل ${creativeType.name}`);
        }
        const instanceCode = `${safeCode(creativeType.short_code)}${String(creativeIndex).padStart(2,"0")}`;
        const [creative] = await tx<any[]>`
          insert into marketing.creatives(agenda_id,creative_type,creative_type_id,quantity,status,instance_code,name,primary_department_id,cars,content_assignments,primary_assignments,optional_assignments,platform_assignments,schedule_day,notes)
          values (${agenda.id}::uuid,${creativeType.name},${creativeTypeId}::uuid,1,'required',${instanceCode},${creativeType.name},${creativeType.primary_department_id},${tx.json(dbJson(arrayValue(rawCreative.cars)))},${tx.json(dbJson(contentAssignments))},${tx.json(dbJson(primaryAssignments))},${tx.json(dbJson(optionalAssignments))},${tx.json(dbJson(arrayValue(rawCreative.platforms)))},${dayDate},${tx.json(dbJson(rawCreative.notes || {}))}) returning id::text
        `;
        await createTasksForCreative(tx,{ sourceType:"agenda",sourceId:agenda.id,agendaId:agenda.id,sourceCode:monthKey,sourceName:name,creativeId:creative.id,creativeIndex,creativeName:creativeType.name,creativeType:creativeType.name,contentDepartmentId:contentId,contentAssignments,primaryDepartmentId:clean(creativeType.primary_department_id),primaryAssignments,optionalAssignments,requiredFromContent:"",executionFolderCreation:body.executionFolders,creativeFolderLinkId:`${dayDate}__${clean(rawCreative.tempId)}__${instance + 1}` });
        const templatesWithoutExecution = await tx<any[]>`
          select tt.id::text
          from marketing.task_templates tt
          where tt.creative_id=${creative.id}::uuid
            and not exists (
              select 1 from marketing.tasks execution_task
              where execution_task.task_template_id=tt.id
                and execution_task.task_kind='execution'
                and execution_task.is_deleted=false
            )
        `;
        if (templatesWithoutExecution.length) throw new Error(`كل Task Template يجب أن يكون معه تاسك تنفيذي داخل ${creativeType.name}`);
        const executionTasks = await tx<any[]>`select id::text from marketing.tasks where creative_id=${creative.id}::uuid and task_kind='execution' and is_deleted=false order by created_at`;
        const scheduleTasks = executionTasks.length ? executionTasks : [{ id: null }];
        for (const scheduleTask of scheduleTasks) {
          const [scheduleGroup] = await tx<any[]>`select gen_random_uuid()::text as id`;
          for (const platform of arrayValue(rawCreative.platforms)) for (const postTypeId of arrayValue<string>(platform.postTypeIds)) {
            await tx`insert into marketing.publish_schedule(group_id,source_type,source_id,creative_id,task_id,publish_date,platform_id,post_type_id) values (${scheduleGroup.id}::uuid,'agenda',${agenda.id}::uuid,${creative.id}::uuid,${scheduleTask.id ? tx`${scheduleTask.id}::uuid` : null},${dayDate},${clean(platform.platformId)}::uuid,${clean(postTypeId)}::uuid)`;
          }
        }
      }
    }
  }
  await audit(tx as any,user,"agenda_created","agenda",agenda.id,{ name,monthKey },undefined,undefined);
  return { ok:true,id:agenda.id,message:"تم إنشاء الأجندة والتاسكات" };
}

async function createAgenda(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: SessionUser) {
  const meta = await marketingMeta(sql, user);
  const contentId = contentDepartmentId(meta);
  return sql.begin((tx) => createAgendaInTransaction(tx, body, user, contentId));
}

async function importFreshMarketingBundle(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: SessionUser) {
  if (!hasPermission(user, "marketing.campaign.create") || !hasPermission(user, "marketing.agenda.create")) {
    throw new Error("لا توجد صلاحية لإنشاء الحملة والأجندة");
  }
  if (clean(body.format) !== "mzj-marketing-fresh-import" || numberValue(body.version) !== 1) {
    throw new Error("ملف النقل غير معتمد");
  }
  const migrationKey = clean(body.migrationKey);
  if (!migrationKey || migrationKey.length > 180) throw new Error("مفتاح عملية النقل غير صحيح");
  const campaigns = arrayValue<Record<string, any>>(body.campaigns);
  const agendas = arrayValue<Record<string, any>>(body.agendas);
  if (!campaigns.length && !agendas.length) throw new Error("ملف النقل لا يحتوي على حملة أو أجندة");

  const meta = await marketingMeta(sql, user);
  const contentId = contentDepartmentId(meta);
  return sql.begin(async (tx) => {
    const [existing] = await tx<any[]>`
      select details
      from marketing.data_migrations
      where migration_key=${migrationKey}
      for update
    `;
    if (existing) {
      return { ok: true, alreadyApplied: true, message: "تم تنفيذ عملية النقل دي قبل كده", details: existing.details || {} };
    }

    const createdCampaigns: any[] = [];
    const createdAgendas: any[] = [];
    for (const campaign of campaigns) {
      createdCampaigns.push(await createCampaignInTransaction(tx, campaign, user, contentId, { preserveRequestedCode: true }));
    }
    for (const agenda of agendas) {
      createdAgendas.push(await createAgendaInTransaction(tx, agenda, user, contentId));
    }
    const details = {
      source: body.source || null,
      campaigns: createdCampaigns.map((item) => ({ id: item.id, code: item.code })),
      agendas: createdAgendas.map((item) => ({ id: item.id })),
      importedBy: user.id,
    };
    await tx`
      insert into marketing.data_migrations(migration_key,details)
      values(${migrationKey},${tx.json(dbJson(details))})
    `;
    return {
      ok: true,
      alreadyApplied: false,
      message: "تم إنشاء الحملة والأجندة وتوليد التاسكات من البداية",
      details,
    };
  });
}

type EntityCreativeScheduleInput = {
  id?: string;
  date?: string;
  platforms?: Array<{ platformId?: string; postTypeIds?: string[] }>;
};

type EntityCreativeBudgetInput = {
  id?: string;
  funnelId?: string;
  adsCount?: number;
  contentGoal?: string;
  expectedGoal?: string;
  platformAmounts?: Array<{ platformId?: string; amount?: number }>;
};

type CampaignBudgetInput = EntityCreativeBudgetInput & {
  creativeIds?: string[];
  creativeId?: string;
};

function creativeTaskFlowSnapshot(value: any) {
  return JSON.stringify(dbJson({
    creativeTypeId: clean(value?.creativeTypeId || value?.creative_type_id),
    quantity: Math.max(1, numberValue(value?.quantity, 1)),
    cars: arrayValue(value?.cars),
    contentAssignments: arrayValue(value?.contentAssignments ?? value?.content_assignments),
    primaryAssignments: arrayValue(value?.primaryAssignments ?? value?.primary_assignments),
    optionalAssignments: arrayValue(value?.optionalAssignments ?? value?.optional_assignments),
  }));
}

function creativeBudgetSnapshot(value: unknown) {
  const rows = arrayValue<any>(value)
    .map((item) => ({
      id: clean(item?.id),
      funnelId: clean(item?.funnelId ?? item?.funnel_id),
      adsCount: Math.max(1, numberValue(item?.adsCount ?? item?.ads_count, 1)),
      contentGoal: clean(item?.contentGoal ?? item?.content_goal),
      expectedGoal: clean(item?.expectedGoal ?? item?.expected_goal),
      platformAmounts: arrayValue<any>(item?.platformAmounts ?? item?.platform_amounts)
        .map((part) => ({
          platformId: clean(part?.platformId ?? part?.platform_id),
          amount: Math.max(0, numberValue(part?.amount)),
        }))
        .filter((part) => part.platformId)
        .sort((left, right) => left.platformId.localeCompare(right.platformId)),
    }))
    .sort((left, right) => left.id.localeCompare(right.id) || JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify(dbJson(rows));
}

function creativeScheduleSnapshot(value: unknown) {
  const signatures = arrayValue<any>(value).flatMap((item) => {
    const date = isoDate(item?.date ?? item?.publish_date);
    const platforms = arrayValue<any>(item?.platforms)
      .map((platform) => ({
        platformId: clean(platform?.platformId ?? platform?.platform_id),
        postTypeIds: [...new Set(arrayValue<string>(platform?.postTypeIds ?? platform?.post_type_ids).map(clean).filter(Boolean))].sort(),
      }))
      .filter((platform) => platform.platformId && platform.postTypeIds.length)
      .sort((left, right) => left.platformId.localeCompare(right.platformId));
    if (!date || !platforms.length) return [];
    return [`${date}|${platforms.map((platform) => `${platform.platformId}:${platform.postTypeIds.join(",")}`).join("|")}`];
  });
  return JSON.stringify([...new Set(signatures)].sort());
}

function groupedScheduleSnapshotRows(rows: any[]) {
  const groups = new Map<string, { date: string; platforms: Map<string, Set<string>> }>();
  for (const row of rows) {
    const date = isoDate(row?.publish_date);
    const groupKey = `${date}|${clean(row?.group_id || row?.id)}`;
    if (!date || !clean(row?.platform_id) || !clean(row?.post_type_id)) continue;
    if (!groups.has(groupKey)) groups.set(groupKey, { date, platforms: new Map() });
    const group = groups.get(groupKey)!;
    const platformId = clean(row.platform_id);
    if (!group.platforms.has(platformId)) group.platforms.set(platformId, new Set());
    group.platforms.get(platformId)!.add(clean(row.post_type_id));
  }
  return [...groups.values()].map((group) => ({
    date: group.date,
    platforms: [...group.platforms.entries()].map(([platformId, postTypeIds]) => ({
      platformId,
      postTypeIds: [...postTypeIds],
    })),
  }));
}

async function replaceCreativeBudgets(tx: any, campaignId: string, creativeId: string, budgets: EntityCreativeBudgetInput[]) {
  const affected = await tx<any[]>`
    select distinct b.id::text
    from marketing.budget_items b
    left join marketing.budget_item_creatives bic on bic.budget_item_id=b.id
    where b.campaign_id=${campaignId}::uuid and (bic.creative_id=${creativeId}::uuid or b.creative_id=${creativeId}::uuid)
  `;
  await tx`delete from marketing.budget_item_creatives where creative_id=${creativeId}::uuid and budget_item_id in (select id from marketing.budget_items where campaign_id=${campaignId}::uuid)`;
  for (const item of affected) {
    const [remaining] = await tx<any[]>`select creative_id::text from marketing.budget_item_creatives where budget_item_id=${item.id}::uuid order by created_at limit 1`;
    if (!remaining) await tx`delete from marketing.budget_items where id=${item.id}::uuid`;
    else await tx`update marketing.budget_items set creative_id=${remaining.creative_id}::uuid where id=${item.id}::uuid`;
  }
  for (const budget of arrayValue<EntityCreativeBudgetInput>(budgets)) {
    const amounts = arrayValue(budget.platformAmounts)
      .map((item) => ({ platformId: clean(item.platformId), amount: Math.max(0, numberValue(item.amount)) }))
      .filter((item) => item.platformId);
    const total = amounts.reduce((sum, item) => sum + item.amount, 0);
    const [created] = await tx<any[]>`
      insert into marketing.budget_items(campaign_id,funnel_id,creative_id,ads_count,content_goal,expected_goal,platform_amounts,total)
      values(
        ${campaignId}::uuid,
        ${clean(budget.funnelId) ? tx`${clean(budget.funnelId)}::uuid` : null},
        ${creativeId}::uuid,
        ${Math.max(1, numberValue(budget.adsCount, 1))},
        ${clean(budget.contentGoal) || null},
        ${clean(budget.expectedGoal) || null},
        ${tx.json(dbJson(amounts))},
        ${total}
      ) returning id::text
    `;
    await tx`insert into marketing.budget_item_creatives(budget_item_id,creative_id) values(${created.id}::uuid,${creativeId}::uuid) on conflict do nothing`;
  }
}

async function saveCampaignBudgets(
  sql: ReturnType<typeof getSql>,
  body: Record<string, any>,
  user: SessionUser,
) {
  if (!hasPermission(user, "marketing.campaign.edit")) throw new Error("لا توجد صلاحية لتعديل ميزانية الحملة");
  const campaignId = clean(body.campaignId || body.id);
  if (!campaignId) throw new Error("رقم الحملة مطلوب");
  await assertMarketingEntityAccess(sql, user, "campaign", campaignId);

  const rawBudgets = arrayValue<CampaignBudgetInput>(body.budgets);
  if (rawBudgets.length > 100) throw new Error("عدد بنود الميزانية يتجاوز الحد المسموح");

  const budgets = rawBudgets.map((budget, index) => {
    const creativeIds = [...new Set(
      (arrayValue<string>(budget.creativeIds).length
        ? arrayValue<string>(budget.creativeIds)
        : [clean(budget.creativeId)].filter(Boolean))
        .map(clean)
        .filter(Boolean),
    )];
    const amountMap = new Map<string, number>();
    for (const part of arrayValue(budget.platformAmounts)) {
      const platformId = clean(part?.platformId);
      if (!platformId) continue;
      amountMap.set(platformId, Math.max(0, numberValue(part?.amount)));
    }
    const platformAmounts = [...amountMap.entries()].map(([platformId, amount]) => ({ platformId, amount }));
    const funnelId = clean(budget.funnelId);
    if (!funnelId) throw new Error(`اختر Funnel داخل بند الميزانية ${index + 1}`);
    if (!creativeIds.length) throw new Error(`اختر كرييتيفًا واحدًا على الأقل داخل بند الميزانية ${index + 1}`);
    if (!platformAmounts.length) throw new Error(`حدد منصة واحدة على الأقل داخل بند الميزانية ${index + 1}`);
    return {
      funnelId,
      creativeIds,
      adsCount: Math.max(1, numberValue(budget.adsCount, 1)),
      contentGoal: clean(budget.contentGoal),
      expectedGoal: clean(budget.expectedGoal),
      platformAmounts,
      total: platformAmounts.reduce((sum, part) => sum + part.amount, 0),
    };
  });

  return sql.begin(async (tx) => {
    const [campaign] = await tx<any[]>`
      select id::text,name
      from marketing.campaigns
      where id=${campaignId}::uuid and is_deleted=false
      for update
    `;
    if (!campaign) throw new Error("الحملة غير موجودة");

    const funnelIds = [...new Set(budgets.map((item) => item.funnelId))];
    if (funnelIds.length) {
      const validFunnels = await tx<any[]>`
        select id::text from marketing.funnels
        where id in ${tx(funnelIds)} and active=true
      `;
      if (validFunnels.length !== funnelIds.length) throw new Error("يوجد Funnel غير متاح داخل الميزانية");
    }

    const creativeIds = [...new Set(budgets.flatMap((item) => item.creativeIds))];
    if (creativeIds.length) {
      const validCreatives = await tx<any[]>`
        select id::text from marketing.creatives
        where campaign_id=${campaignId}::uuid and id in ${tx(creativeIds)}
      `;
      if (validCreatives.length !== creativeIds.length) throw new Error("يوجد كرييتيف غير تابع لهذه الحملة داخل الميزانية");
    }

    const platformIds = [...new Set(budgets.flatMap((item) => item.platformAmounts.map((part) => part.platformId)))];
    if (platformIds.length) {
      const validPlatforms = await tx<any[]>`
        select id::text from marketing.platforms
        where id in ${tx(platformIds)} and is_active=true
      `;
      if (validPlatforms.length !== platformIds.length) throw new Error("يوجد منصة غير متاحة داخل الميزانية");
    }

    await tx`delete from marketing.budget_items where campaign_id=${campaignId}::uuid`;
    for (const budget of budgets) {
      const [created] = await tx<any[]>`
        insert into marketing.budget_items(campaign_id,funnel_id,creative_id,ads_count,content_goal,expected_goal,platform_amounts,total)
        values(
          ${campaignId}::uuid,
          ${budget.funnelId}::uuid,
          ${budget.creativeIds.length === 1 ? tx`${budget.creativeIds[0]}::uuid` : null},
          ${budget.adsCount},
          ${budget.contentGoal || null},
          ${budget.expectedGoal || null},
          ${tx.json(dbJson(budget.platformAmounts))},
          ${budget.total}
        )
        returning id::text
      `;
      for (const creativeId of budget.creativeIds) {
        await tx`
          insert into marketing.budget_item_creatives(budget_item_id,creative_id)
          values(${created.id}::uuid,${creativeId}::uuid)
          on conflict do nothing
        `;
      }
    }

    return {
      ok: true,
      id: campaignId,
      campaignId,
      budgetCount: budgets.length,
      total: budgets.reduce((sum, item) => sum + item.total, 0),
      message: budgets.length ? "تم حفظ ميزانية الحملة" : "تم حذف ميزانية الحملة",
    };
  });
}

async function replaceCreativeSchedule(tx: any, input: {
  sourceType: "campaign" | "agenda";
  sourceId: string;
  creativeId: string;
  start: string;
  end: string;
  schedule: EntityCreativeScheduleInput[];
}) {
  await tx`delete from marketing.publish_schedule where source_type=${input.sourceType} and source_id=${input.sourceId}::uuid and creative_id=${input.creativeId}::uuid`;
  const executionTasks = await tx<any[]>`
    select id::text from marketing.tasks
    where creative_id=${input.creativeId}::uuid and task_kind='execution' and is_deleted=false
    order by created_at
  `;
  const scheduleTasks = executionTasks.length ? executionTasks : [{ id: null }];
  let firstDate = "";
  for (const item of arrayValue<EntityCreativeScheduleInput>(input.schedule)) {
    const publishDate = isoDate(item.date);
    if (!publishDate) continue;
    if (publishDate < input.start || publishDate > input.end) throw new Error("تاريخ النشر خارج فترة الحملة أو الأجندة");
    if (!firstDate) firstDate = publishDate;
    const platforms = arrayValue(item.platforms)
      .map((platform) => ({
        platformId: clean(platform.platformId),
        postTypeIds: [...new Set(arrayValue<string>(platform.postTypeIds).map(clean).filter(Boolean))],
      }))
      .filter((platform) => platform.platformId && platform.postTypeIds.length);
    for (const scheduleTask of scheduleTasks) {
      const [scheduleGroup] = await tx<any[]>`select gen_random_uuid()::text as id`;
      for (const platform of platforms) {
        for (const postTypeId of platform.postTypeIds) {
          await tx`
            insert into marketing.publish_schedule(group_id,source_type,source_id,creative_id,task_id,publish_date,platform_id,post_type_id)
            values(
              ${scheduleGroup.id}::uuid,
              ${input.sourceType},
              ${input.sourceId}::uuid,
              ${input.creativeId}::uuid,
              ${scheduleTask.id ? tx`${scheduleTask.id}::uuid` : null},
              ${publishDate},
              ${platform.platformId}::uuid,
              ${postTypeId}::uuid
            )
          `;
        }
      }
    }
  }
  await tx`update marketing.creatives set schedule_day=${firstDate || null},updated_at=now() where id=${input.creativeId}::uuid`;
}

async function promoteCreativeRevisionForReview(tx: any, creativeId: string, previousTemplates: any[], user: SessionUser) {
  if (!previousTemplates.length) return;
  const currentTemplates = await tx<any[]>`
    select id::text,content_user_id::text from marketing.task_templates
    where creative_id=${creativeId}::uuid
    order by created_at desc
  `;
  const latestByUser = new Map<string, any>();
  for (const item of currentTemplates) if (!latestByUser.has(item.content_user_id)) latestByUser.set(item.content_user_id, item);
  const promotedUsers = new Set<string>();
  for (const previous of previousTemplates) {
    if (previous.status !== 'approved' || promotedUsers.has(previous.content_user_id)) continue;
    promotedUsers.add(previous.content_user_id);
    const current = latestByUser.get(previous.content_user_id);
    if (!current || current.id === previous.id) continue;
    await tx`
      update marketing.task_templates
      set status='under_review',progress=50,file_id=${previous.file_id ? tx`${previous.file_id}::uuid` : null},
          template_data=${tx.json(dbJson(previous.template_data || {}))},
          approved_data=${tx.json(dbJson(previous.approved_data || {}))},
          admin_note='تم تعديل بيانات الكرييتيف ويحتاج إعادة اعتماد',updated_at=now()
      where id=${current.id}::uuid
    `;
    await tx`update marketing.tasks set status='under_review',progress=50,updated_at=now() where task_template_id=${current.id}::uuid and task_kind='task_template' and is_deleted=false`;
    await tx`
      insert into marketing.task_review_history(task_template_id,action,note,before_data,after_data,actor_id,actor_name)
      values(
        ${current.id}::uuid,
        'creative_revision',
        'تم إنشاء مراجعة جديدة بعد تعديل بيانات الكرييتيف',
        ${tx.json(dbJson(previous.approved_data || previous.template_data || {}))},
        ${tx.json(dbJson(previous.template_data || {}))},
        ${user.id}::uuid,
        ${user.fullName}
      )
    `;
  }
}

async function saveEntityCreative(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: SessionUser) {
  const sourceType = clean(body.sourceType) as "campaign" | "agenda";
  const sourceId = clean(body.sourceId);
  const creativeId = clean(body.creativeId);
  const rawCreative = body.creative || {};
  if (!['campaign','agenda'].includes(sourceType) || !sourceId) throw new Error("بيانات الحملة أو الأجندة غير صحيحة");
  const permission = sourceType === 'campaign' ? 'marketing.campaign.edit' : 'marketing.agenda.edit';
  if (!hasPermission(user, permission)) throw new Error("لا توجد صلاحية لتعديل الكرييتيفات");
  await assertMarketingEntityAccess(sql, user, sourceType, sourceId);
  const creativeTypeId = clean(rawCreative.creativeTypeId);
  if (!creativeTypeId) throw new Error("اختر نوع الكرييتيف");
  const requestedCreativeName = clean(rawCreative.name);
  if (sourceType === 'campaign' && !requestedCreativeName) throw new Error("اكتب اسم الكرييتيف");
  if (requestedCreativeName.length > 160) throw new Error("اسم الكرييتيف يجب ألا يزيد عن 160 حرف");
  const budgetInputs = arrayValue<EntityCreativeBudgetInput>(body.budgets);
  const scheduleInputs = arrayValue<EntityCreativeScheduleInput>(body.schedule);
  if (sourceType === 'campaign' && !budgetInputs.length) throw new Error("أضف ميزانية للكرييتيف");
  if (sourceType === 'campaign' && budgetInputs.some((item) => !arrayValue(item.platformAmounts).some((part) => clean(part.platformId)))) {
    throw new Error("حدد منصة واحدة على الأقل لكل بند ميزانية");
  }
  if (!scheduleInputs.length) throw new Error("أضف موعد نشر واحدًا على الأقل للكرييتيف");
  if (scheduleInputs.some((item) => !isoDate(item.date) || !arrayValue(item.platforms).some((platform) => clean(platform.platformId) && arrayValue<string>(platform.postTypeIds).some((id) => clean(id))))) {
    throw new Error("أكمل تاريخ ومنصة ونوع النشر لكل موعد");
  }
  const meta = await marketingMeta(sql, user);
  const contentId = contentDepartmentId(meta);
  const contentAssignments = arrayValue(rawCreative.contentAssignments);
  const primaryAssignments = arrayValue(rawCreative.primaryAssignments);
  const optionalAssignments = arrayValue(rawCreative.optionalAssignments);
  if (!contentAssignments.length) throw new Error("اختر يوزر قسم المحتوى");
  if (![...primaryAssignments, ...optionalAssignments.flatMap((group: any) => arrayValue(group.assignments))].length) throw new Error("اختر يوزرًا تنفيذيًا واحدًا على الأقل");

  return sql.begin(async (tx) => {
    const [entity] = sourceType === 'campaign'
      ? await tx<any[]>`select id::text,name,campaign_code as code,publish_start::text,publish_end::text,required_from_content from marketing.campaigns where id=${sourceId}::uuid and is_deleted=false for update`
      : await tx<any[]>`select id::text,name,month_key as code,publish_start::text,publish_end::text,''::text as required_from_content from marketing.agendas where id=${sourceId}::uuid for update`;
    if (!entity) throw new Error(sourceType === 'campaign' ? "الحملة غير موجودة" : "الأجندة غير موجودة");
    const [creativeType] = await tx<any[]>`
      select c.*,d.name as department_name
      from marketing.creative_types c
      left join marketing.departments d on d.id=c.primary_department_id
      where c.id=${creativeTypeId}::uuid and c.is_active=true
    `;
    if (!creativeType) throw new Error("نوع الكرييتيف غير موجود");
    const creativeName = sourceType === 'campaign' ? requestedCreativeName : creativeType.name;

    const saveSingle = async (existingId: string | null) => {
      let targetId = existingId || '';
      let taskFlowChanged = true;
      let budgetsChanged = sourceType === 'campaign';
      let scheduleChanged = true;
      let previousTemplates: any[] = [];
      let creativeIndex = 1;
      if (existingId) {
        const [existing] = await tx<any[]>`
          select *,id::text,creative_type_id::text
          from marketing.creatives
          where id=${existingId}::uuid
            and ((${sourceType}='campaign' and campaign_id=${sourceId}::uuid) or (${sourceType}='agenda' and agenda_id=${sourceId}::uuid))
          for update
        `;
        if (!existing) throw new Error("الكرييتيف غير موجود داخل السجل المحدد");
        const [published] = await tx<any[]>`select 1 from marketing.publish_schedule where creative_id=${existingId}::uuid and status='published' limit 1`;
        if (published) throw new Error("لا يمكن تعديل كرييتيف تم نشره");
        const currentBudgets = sourceType === 'campaign'
          ? await tx<any[]>`
              select distinct
                b.id::text,
                b.funnel_id::text,
                b.ads_count,
                b.content_goal,
                b.expected_goal,
                b.platform_amounts
              from marketing.budget_items b
              left join marketing.budget_item_creatives bic on bic.budget_item_id=b.id
              where b.campaign_id=${sourceId}::uuid
                and (bic.creative_id=${existingId}::uuid or b.creative_id=${existingId}::uuid)
              order by b.id::text
            `
          : [];
        const currentScheduleRows = await tx<any[]>`
          select
            s.id::text,
            s.group_id::text,
            s.publish_date::text,
            s.platform_id::text,
            s.post_type_id::text
          from marketing.publish_schedule s
          where s.source_type=${sourceType}
            and s.source_id=${sourceId}::uuid
            and s.creative_id=${existingId}::uuid
          order by s.publish_date,s.group_id,s.platform_id,s.post_type_id,s.id
        `;
        taskFlowChanged = creativeTaskFlowSnapshot(existing) !== creativeTaskFlowSnapshot(rawCreative);
        budgetsChanged = sourceType === 'campaign' && creativeBudgetSnapshot(currentBudgets) !== creativeBudgetSnapshot(budgetInputs);
        scheduleChanged = taskFlowChanged
          || creativeScheduleSnapshot(groupedScheduleSnapshotRows(currentScheduleRows)) !== creativeScheduleSnapshot(scheduleInputs);
        if (taskFlowChanged) {
          const [started] = await tx<any[]>`
            select 1 from marketing.tasks
            where creative_id=${existingId}::uuid and task_kind='execution' and is_deleted=false
              and (received_at is not null or progress>0 or status in ('in_progress','ready_to_complete','completed'))
            limit 1
          `;
          if (started) throw new Error("بدأ تنفيذ هذا الكرييتيف؛ يمكن تعديل الميزانية وجدول النشر فقط دون تغيير بيانات التكليف");
          previousTemplates = await tx<any[]>`
            select distinct on (content_user_id) *,id::text,content_user_id::text,file_id::text
            from marketing.task_templates
            where creative_id=${existingId}::uuid
            order by content_user_id,created_at desc,id desc
          `;
          await tx`update marketing.tasks set is_deleted=true,updated_at=now() where creative_id=${existingId}::uuid and is_deleted=false`;
        }
        await tx`
          update marketing.creatives set
            creative_type=${creativeType.name},creative_type_id=${creativeTypeId}::uuid,
            quantity=${sourceType === 'campaign' ? 1 : Math.max(1, numberValue(rawCreative.quantity, 1))},
            status=case when ${taskFlowChanged} then 'required' else status end,name=${creativeName},
            primary_department_id=${creativeType.primary_department_id},cars=${tx.json(dbJson(arrayValue(rawCreative.cars)))},
            content_assignments=${tx.json(dbJson(contentAssignments))},primary_assignments=${tx.json(dbJson(primaryAssignments))},
            optional_assignments=${tx.json(dbJson(optionalAssignments))},platform_assignments=${tx.json(dbJson(arrayValue(rawCreative.platforms)))},
            notes=${tx.json(dbJson(rawCreative.notes || {}))},updated_at=now()
          where id=${existingId}::uuid
        `;
        const [sequence] = await tx<any[]>`select count(*)::int + 1000 as value from marketing.task_templates where source_type=${sourceType} and source_id=${sourceId}::uuid`;
        creativeIndex = Number(sequence?.value || 1001);
      } else {
        const [sequence] = await tx<any[]>`select count(*)::int + 1 as value from marketing.creatives where (${sourceType}='campaign' and campaign_id=${sourceId}::uuid) or (${sourceType}='agenda' and agenda_id=${sourceId}::uuid)`;
        creativeIndex = Number(sequence?.value || 1);
        const instanceCode = `${safeCode(creativeType.short_code)}${String(creativeIndex).padStart(2,'0')}`;
        const [created] = await tx<any[]>`
          insert into marketing.creatives(campaign_id,agenda_id,creative_type,creative_type_id,quantity,status,instance_code,name,primary_department_id,cars,content_assignments,primary_assignments,optional_assignments,platform_assignments,notes)
          values(
            ${sourceType === 'campaign' ? tx`${sourceId}::uuid` : null},
            ${sourceType === 'agenda' ? tx`${sourceId}::uuid` : null},
            ${creativeType.name},${creativeTypeId}::uuid,1,
            'required',${instanceCode},${creativeName},${creativeType.primary_department_id},
            ${tx.json(dbJson(arrayValue(rawCreative.cars)))},${tx.json(dbJson(contentAssignments))},${tx.json(dbJson(primaryAssignments))},
            ${tx.json(dbJson(optionalAssignments))},${tx.json(dbJson(arrayValue(rawCreative.platforms)))},${tx.json(dbJson(rawCreative.notes || {}))}
          ) returning id::text
        `;
        targetId = created.id;
      }

      if (!existingId || taskFlowChanged) {
        await createTasksForCreative(tx, {
          sourceType,sourceId,
          campaignId: sourceType === 'campaign' ? sourceId : null,
          agendaId: sourceType === 'agenda' ? sourceId : null,
          sourceCode: entity.code || entity.name,
          sourceName: entity.name,
          creativeId: targetId,
          creativeIndex,
          creativeName,
          creativeType: creativeType.name,
          contentDepartmentId: contentId,
          contentAssignments,
          primaryDepartmentId: clean(creativeType.primary_department_id),
          primaryAssignments,
          optionalAssignments,
          requiredFromContent: clean(entity.required_from_content),
        });
        if (existingId) await promoteCreativeRevisionForReview(tx, targetId, previousTemplates, user);
      }

      if (sourceType === 'campaign' && (!existingId || budgetsChanged)) {
        await replaceCreativeBudgets(tx, sourceId, targetId, budgetInputs);
      }
      if (!existingId || scheduleChanged) {
        await replaceCreativeSchedule(tx, {
          sourceType,sourceId,creativeId:targetId,start:entity.publish_start,end:entity.publish_end,
          schedule:scheduleInputs,
        });
      }
      return targetId;
    };

    const quantity = Math.max(1, numberValue(rawCreative.quantity, 1));
    const ids: string[] = [];
    if (!creativeId && sourceType === 'agenda' && quantity > 1) {
      for (let index = 0; index < quantity; index += 1) ids.push(await saveSingle(null));
    } else {
      ids.push(await saveSingle(creativeId || null));
    }
    await recalculateProgress(tx, sourceType, sourceId);
    await audit(tx as any,user,creativeId ? 'creative_updated' : 'creative_added',sourceType,sourceId,{ creativeIds:ids,creativeType:creativeType.name,creativeName },undefined,undefined);
    return { ok:true,id:sourceId,creativeIds:ids,message:creativeId ? "تم تعديل الكرييتيف وإنشاء مراجعة التكليف عند الحاجة" : "تمت إضافة الكرييتيف والتاسكات المرتبطة" };
  });
}

async function recalculateProgress(sql: any, sourceType: string, sourceId: string) {
  if (sourceType === "manual") return;
  const rows = await sql<any[]>`
    select coalesce(t.department_id::text,'content') as department_id,avg(t.progress)::float as progress
    from marketing.tasks t where t.source_type=${sourceType} and t.source_id=${sourceId}::uuid and t.is_deleted=false and t.task_kind in ('task_template','execution')
    group by coalesce(t.department_id::text,'content')
  `;
  const [completion] = await sql<any[]>`
    select count(*)::int as total,
      count(*) filter(where
        (t.task_kind='task_template' and t.progress>=100 and t.status='approved')
        or
        (t.task_kind='execution' and t.progress>=100 and t.status='completed' and t.completed_at is not null)
      )::int as ready
    from marketing.tasks t
    where t.source_type=${sourceType} and t.source_id=${sourceId}::uuid and t.is_deleted=false and t.task_kind in ('task_template','execution')
  `;
  const progress = rows.length ? rows.reduce((sum:number,row:any)=>sum+numberValue(row.progress),0)/rows.length : 0;
  const readyForPublishing = Number(completion?.total || 0) > 0 && Number(completion?.total || 0) === Number(completion?.ready || 0);
  if (sourceType === "agenda") await sql`
    update marketing.agendas
    set progress=${progress},
      status=case
        when status in ('publishing','archived') then status
        when ${readyForPublishing} then 'ready_publish'
        when status='ready_publish' then 'required'
        else status
      end,
      updated_at=now()
    where id=${sourceId}::uuid
  `;
  else await sql`
    update marketing.campaigns
    set progress=${progress},
      status=case
        when status in ('publishing','archived') then status
        when ${readyForPublishing} then 'ready_publish'
        when status='ready_publish' then 'required'
        else status
      end,
      updated_at=now()
    where id=${sourceId}::uuid
  `;
  return progress;
}

async function moveEntityToPublishing(sql: ReturnType<typeof getSql>, body: any, user: SessionUser) {
  const sourceType = clean(body.sourceType);
  const sourceId = clean(body.sourceId);
  if (!['campaign','agenda'].includes(sourceType) || !sourceId) throw new Error("بيانات الحملة أو الأجندة غير مكتملة");
  const canMove = hasPermission(user,"marketing.publish_prep.manage")
    || (sourceType === 'campaign' && hasPermission(user,"marketing.campaign.edit"))
    || (sourceType === 'agenda' && hasPermission(user,"marketing.agenda.edit"));
  if (!canMove) throw new Error("لا توجد صلاحية لنقل الحملة أو الأجندة إلى قسم النشر");
  await assertMarketingEntityAccess(sql,user,sourceType,sourceId);
  await recalculateProgress(sql,sourceType,sourceId);

  const [entity] = sourceType === 'campaign'
    ? await sql<any[]>`select id::text,name,status,progress::float from marketing.campaigns where id=${sourceId}::uuid and is_deleted=false and archived_at is null`
    : await sql<any[]>`select id::text,name,status,progress::float from marketing.agendas where id=${sourceId}::uuid and archived_at is null`;
  if (!entity) throw new Error("الحملة أو الأجندة غير موجودة");
  if (entity.status === 'publishing') return { ok:true, id:sourceId, message:"الحملة أو الأجندة موجودة بالفعل في قسم النشر" };
  if (numberValue(entity.progress) < 100 || entity.status !== 'ready_publish') {
    throw new Error("لا يمكن النقل إلى قسم النشر قبل اكتمال Task Template وإنهاء كل التاسكات التنفيذية بنسبة 100%");
  }

  if (sourceType === 'campaign') await sql`update marketing.campaigns set status='publishing',updated_at=now() where id=${sourceId}::uuid`;
  else await sql`update marketing.agendas set status='publishing',updated_at=now() where id=${sourceId}::uuid`;
  return { ok:true, id:sourceId, message:`تم نقل ${sourceType === 'campaign' ? 'الحملة' : 'الأجندة'} إلى قسم النشر` };
}

async function dashboardVersion(sql: ReturnType<typeof getSql>) {
  const [row] = await sql<any[]>`
    select greatest(
      coalesce((select max(updated_at) from marketing.tasks),'epoch'::timestamptz),
      coalesce((select max(updated_at) from marketing.task_templates),'epoch'::timestamptz),
      coalesce((select max(updated_at) from marketing.campaigns),'epoch'::timestamptz),
      coalesce((select max(updated_at) from marketing.agendas),'epoch'::timestamptz),
      coalesce((select max(updated_at) from marketing.user_colors),'epoch'::timestamptz)
    )::text as version
  `;
  return clean(row?.version);
}

async function dashboard(sql: ReturnType<typeof getSql>, user: SessionUser) {
  const access = marketingAccess(user);
  const unrestricted = access.dataScope === "all";
  const createdByMe = access.dataScope === "created_by_me";
  const departmentScoped = ["department", "departments", "branch_and_department"].includes(access.dataScope);
  const departmentCodes = marketingDepartmentCodes(user);
  const taskFilter = unrestricted
    ? sql`true`
    : sql`(
      t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid
      or (${departmentScoped}=true and exists(
        select 1 from core.user_departments ud join core.departments cd on cd.id=ud.department_id
        where ud.user_id in (t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)}
      ))
      or (${createdByMe}=true and (
        exists(select 1 from marketing.campaigns x where t.source_type='campaign' and x.id=t.source_id and x.created_by=${user.id}::uuid)
        or exists(select 1 from marketing.agendas x where t.source_type='agenda' and x.id=t.source_id and x.created_by=${user.id}::uuid)
      ))
    )`;
  const liveSourceFilter = sql`(
    (t.source_type='campaign' and exists(
      select 1 from marketing.campaigns source_campaign
      where source_campaign.id=t.source_id
        and source_campaign.is_deleted=false
        and source_campaign.archived_at is null
    ))
    or
    (t.source_type='agenda' and exists(
      select 1 from marketing.agendas source_agenda
      where source_agenda.id=t.source_id
        and source_agenda.archived_at is null
    ))
  )`;
  const tasks = await sql<any[]>`
    select t.id::text,t.source_type,t.source_id::text,t.task_kind,t.title,t.status,t.progress::float,t.due_at,t.received_at,t.completed_at,t.completed_by::text,t.note,
      done_by.full_name as completed_by_name,t.assigned_to::text,u.full_name as assigned_name,auc.color as assigned_user_color,
      t.paired_content_user_id::text,cu.full_name as content_user_name,cuc.color as content_user_color,
      d.id::text as department_id,d.name as department_name,c.name as creative_name,c.instance_code,
      coalesce(cam.name,ag.name) as source_name,cam.campaign_code,tt.status as template_status,tt.approved_data,
      f.id::text as final_file_id,f.original_name as final_file_name,
      (t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid or ${canViewAllTasks(user)}=true) as can_complete_task
    from marketing.tasks t
    left join core.users u on u.id=t.assigned_to left join core.users cu on cu.id=t.paired_content_user_id
    left join core.users done_by on done_by.id=t.completed_by
    left join marketing.user_colors auc on auc.user_id=t.assigned_to
    left join marketing.user_colors cuc on cuc.user_id=t.paired_content_user_id
    left join marketing.departments d on d.id=t.department_id left join marketing.creatives c on c.id=t.creative_id
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id
    left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    left join marketing.task_templates tt on tt.id=t.task_template_id left join marketing.files f on f.id=t.final_file_id
    where t.is_deleted=false and t.task_kind in ('task_template','execution') and ${liveSourceFilter} and ${taskFilter}
    order by t.received_at nulls first,t.due_at nulls last,t.created_at
  `;
  const entities = await sql<any[]>`
    select 'campaign' as source_type,c.id::text,c.name,c.campaign_code as code,c.status,c.progress::float,c.publish_start,c.publish_end,c.created_at
    from marketing.campaigns c
    where c.is_deleted=false and c.archived_at is null and (
      ${unrestricted}=true or (${createdByMe}=true and c.created_by=${user.id}::uuid)
      or exists(select 1 from marketing.tasks t where t.source_type='campaign' and t.source_id=c.id and t.is_deleted=false and ${taskFilter})
    )
    union all
    select 'agenda',a.id::text,a.name,a.month_key,a.status,a.progress::float,a.publish_start,a.publish_end,a.created_at
    from marketing.agendas a
    where a.archived_at is null and (
      ${unrestricted}=true or (${createdByMe}=true and a.created_by=${user.id}::uuid)
      or exists(select 1 from marketing.tasks t where t.source_type='agenda' and t.source_id=a.id and t.is_deleted=false and ${taskFilter})
    )
    order by created_at desc
  `;
  const version = await dashboardVersion(sql);
  const completed = tasks.filter((task)=>task.status==='completed' && task.completed_at);
  return {
    ok:true,
    version,
    required:tasks.filter((task)=>!task.received_at && task.status!=='completed'),
    received:tasks.filter((task)=>task.received_at && task.status!=='completed'),
    completed,
    entities,
    permissions:user.permissions.filter((code)=>code.startsWith("marketing.")),
  };
}

async function databaseRows(sql: ReturnType<typeof getSql>, user: SessionUser) {
  const access = marketingAccess(user);
  const unrestricted = access.dataScope === "all";
  const createdByMe = access.dataScope === "created_by_me";
  const departmentScoped = ["department", "departments", "branch_and_department"].includes(access.dataScope);
  const departmentCodes = marketingDepartmentCodes(user);
  const rows = await sql<any[]>`
    select 'campaign' as source_type,c.id::text,c.campaign_date as record_date,c.campaign_code as code,c.name,coalesce(ct.name,c.campaign_type) as type,c.objective,c.publish_start,c.publish_end,c.status,c.progress::float,c.archived_at,c.created_at,
      (select count(*)::int from marketing.tasks t where t.source_type='campaign' and t.source_id=c.id and t.is_deleted=false and t.task_kind in ('task_template','execution')) as tasks_count,
      (select count(*)::int from marketing.tasks t where t.source_type='campaign' and t.source_id=c.id and t.progress>=100 and t.is_deleted=false and t.task_kind in ('task_template','execution')) as completed_count,
      c.result_file_id::text,coalesce(jsonb_array_length(c.links),0)::int as links_count
    from marketing.campaigns c left join marketing.campaign_types ct on ct.id=c.campaign_type_id
    where c.is_deleted=false and (
      ${unrestricted}=true or (${createdByMe}=true and c.created_by=${user.id}::uuid)
      or exists(select 1 from marketing.tasks t where t.source_type='campaign' and t.source_id=c.id and t.is_deleted=false and (
        t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid
        or (${departmentScoped}=true and exists(select 1 from core.user_departments ud join core.departments d on d.id=ud.department_id where ud.user_id in(t.assigned_to,t.paired_content_user_id) and d.code in ${sql(departmentCodes)}))
      ))
    )
    union all
    select 'agenda',a.id::text,a.created_at::date,a.month_key,a.name,'أجندة',null,a.publish_start,a.publish_end,a.status,a.progress::float,a.archived_at,a.created_at,
      (select count(*)::int from marketing.tasks t where t.source_type='agenda' and t.source_id=a.id and t.is_deleted=false and t.task_kind in ('task_template','execution')),
      (select count(*)::int from marketing.tasks t where t.source_type='agenda' and t.source_id=a.id and t.progress>=100 and t.is_deleted=false and t.task_kind in ('task_template','execution')),
      a.result_file_id::text,coalesce(jsonb_array_length(a.links),0)::int
    from marketing.agendas a
    where ${unrestricted}=true or (${createdByMe}=true and a.created_by=${user.id}::uuid)
      or exists(select 1 from marketing.tasks t where t.source_type='agenda' and t.source_id=a.id and t.is_deleted=false and (
        t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid
        or (${departmentScoped}=true and exists(select 1 from core.user_departments ud join core.departments d on d.id=ud.department_id where ud.user_id in(t.assigned_to,t.paired_content_user_id) and d.code in ${sql(departmentCodes)}))
      ))
    order by created_at desc
  `;
  return { ok:true,rows };
}

async function entityDetail(sql: ReturnType<typeof getSql>, sourceType: string, id: string, user: SessionUser) {
  await assertMarketingEntityAccess(sql,user,sourceType,id);
  const [entity] = sourceType === "agenda"
    ? await sql<any[]>`select 'agenda' as source_type,a.*,a.id::text,a.result_file_id::text from marketing.agendas a where a.id=${id}::uuid`
    : await sql<any[]>`select 'campaign' as source_type,c.*,c.id::text,c.campaign_type_id::text,c.result_file_id::text,ct.name as campaign_type_name from marketing.campaigns c left join marketing.campaign_types ct on ct.id=c.campaign_type_id where c.id=${id}::uuid and c.is_deleted=false`;
  if (!entity) throw new Error("السجل غير موجود");
  const [creatives,tasks,budgets,schedule,reviewHistory,files,engagementResultsPayload] = await Promise.all([
    sql<any[]>`select c.*,c.id::text,c.campaign_id::text,c.agenda_id::text,c.creative_type_id::text,c.primary_department_id::text,ct.name as creative_type_name,d.name as primary_department_name from marketing.creatives c left join marketing.creative_types ct on ct.id=c.creative_type_id left join marketing.departments d on d.id=c.primary_department_id where (${sourceType}='campaign' and c.campaign_id=${id}::uuid) or (${sourceType}='agenda' and c.agenda_id=${id}::uuid) order by c.created_at`,
    sql<any[]>`select t.*,t.id::text,t.source_id::text,t.department_id::text,t.assigned_to::text,t.paired_content_user_id::text,t.task_template_id::text,u.full_name as assigned_name,cu.full_name as content_user_name,d.name as department_name,c.name as creative_name,tt.status as template_status,tt.template_data,tt.approved_data,tt.file_id::text as template_file_id,ff.original_name as final_file_name from marketing.tasks t left join core.users u on u.id=t.assigned_to left join core.users cu on cu.id=t.paired_content_user_id left join marketing.departments d on d.id=t.department_id left join marketing.creatives c on c.id=t.creative_id left join marketing.task_templates tt on tt.id=t.task_template_id left join marketing.files ff on ff.id=t.final_file_id where t.source_type=${sourceType} and t.source_id=${id}::uuid and t.is_deleted=false and t.task_kind in ('task_template','execution') order by d.name,u.full_name`,
    sourceType === "campaign" ? sql<any[]>`
      select b.*,b.id::text,b.funnel_id::text,b.creative_id::text,f.name as funnel_name,c.name as creative_name,
        coalesce((
          select jsonb_agg(link.creative_id::text order by linked_creative.instance_code,linked_creative.name)
          from marketing.budget_item_creatives link
          join marketing.creatives linked_creative on linked_creative.id=link.creative_id
          where link.budget_item_id=b.id
        ),case when b.creative_id is null then '[]'::jsonb else jsonb_build_array(b.creative_id::text) end) as creative_ids,
        coalesce((
          select string_agg(linked_creative.name, '، ' order by linked_creative.instance_code,linked_creative.name)
          from marketing.budget_item_creatives link
          join marketing.creatives linked_creative on linked_creative.id=link.creative_id
          where link.budget_item_id=b.id
        ),c.name,'—') as creative_names,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'platformId',part.value->>'platformId',
            'platformName',coalesce(p.name,'منصة غير معروفة'),
            'amount',coalesce(nullif(part.value->>'amount','')::numeric,0)
          ) order by p.name)
          from jsonb_array_elements(coalesce(b.platform_amounts,'[]'::jsonb)) part(value)
          left join marketing.platforms p on p.id::text=part.value->>'platformId'
        ),'[]'::jsonb) as platform_details
      from marketing.budget_items b
      left join marketing.funnels f on f.id=b.funnel_id
      left join marketing.creatives c on c.id=b.creative_id
      where b.campaign_id=${id}::uuid
      order by b.created_at
    ` : Promise.resolve([]),
    sql<any[]>`select s.*,s.id::text,s.platform_id::text,s.post_type_id::text,p.name as platform_name,pt.name as post_type_name,c.name as creative_name,c.instance_code from marketing.publish_schedule s left join marketing.platforms p on p.id=s.platform_id left join marketing.platform_post_types pt on pt.id=s.post_type_id left join marketing.creatives c on c.id=s.creative_id where s.source_type=${sourceType} and s.source_id=${id}::uuid order by s.publish_date,p.name,pt.name`,
    sql<any[]>`select h.*,h.id::text,h.task_template_id::text from marketing.task_review_history h join marketing.task_templates tt on tt.id=h.task_template_id where tt.source_type=${sourceType} and tt.source_id=${id}::uuid order by h.created_at desc`,
    sql<any[]>`select f.*,f.id::text from marketing.files f where f.source_type=${sourceType} and f.source_id=${id}::uuid order by f.created_at desc`,
    engagementResultsData(sql,{ sourceType, sourceId:id, source:entity }),
  ]);
  return { ok:true,entity,creatives,tasks,budgets,schedule,reviewHistory,files,engagementResults:engagementResultsPayload.groups[0] || null };
}

async function taskDetail(sql: ReturnType<typeof getSql>, id: string, user: SessionUser) {
  const [task] = await sql<any[]>`
    select t.*,t.id::text,t.source_id::text,t.department_id::text,t.assigned_to::text,t.paired_content_user_id::text,t.task_template_id::text,
      u.full_name as assigned_name,cu.full_name as content_user_name,d.name as department_name,c.name as creative_name,c.cars,c.instance_code,
      coalesce(cam.name,ag.name) as source_name,cam.campaign_code,cam.campaign_date,cam.campaign_type,cam.objective,cam.required_from_content,
      coalesce(cam.publish_start,ag.publish_start) as campaign_start,coalesce(cam.publish_end,ag.publish_end) as campaign_end,
      tt.task_no,tt.status as template_status,tt.progress as template_progress,tt.due_on as template_due_on,tt.department_note as template_department_note,tt.admin_note,tt.template_data,tt.approved_data,tt.file_id::text as template_file_id,
      coalesce(fm.primary_name,ff.original_name) as final_file_name,coalesce(fm.file_count,case when ff.id is null then 0 else 1 end)::int as final_file_count,coalesce(fm.files,'[]'::jsonb) as final_files,done_by.full_name as completed_by_name
    from marketing.tasks t left join core.users u on u.id=t.assigned_to left join core.users cu on cu.id=t.paired_content_user_id left join core.users done_by on done_by.id=t.completed_by left join marketing.departments d on d.id=t.department_id left join marketing.creatives c on c.id=t.creative_id
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    left join marketing.task_templates tt on tt.id=t.task_template_id left join marketing.files ff on ff.id=t.final_file_id
    left join lateral (
      select count(*)::int as file_count,min(f.original_name) filter(where f.order_index=0) as primary_name,
        jsonb_agg(jsonb_build_object('id',f.id::text,'name',f.original_name,'mimeType',f.mime_type,'size',f.file_size,'orderIndex',f.order_index) order by f.order_index,f.created_at) as files
      from marketing.files f
      where t.final_media_group_id is not null and f.final_media_group_id=t.final_media_group_id and f.status='ready'
    ) fm on true
    where t.id=${id}::uuid and t.is_deleted=false
  `;
  if (!task) throw new Error("التاسك غير موجود");
  if (!await canAccessMarketingTask(sql,user,id)) throw new Error("لا توجد صلاحية لعرض التاسك");
  if (task.task_kind === "execution") task.execution_folders = repairedExecutionFolders(task.execution_folders);
  const actionsPromise = task.department_id
    ? sql<any[]>`select a.id::text,a.name,a.percentage::float,a.admin_only,a.sort_order,coalesce(p.completed,false) as completed,p.completed_at,u.full_name as completed_by_name from marketing.assignment_actions a left join marketing.task_action_progress p on p.action_id=a.id and p.task_id=${id}::uuid left join core.users u on u.id=p.completed_by where a.department_id=${task.department_id}::uuid and a.is_active=true order by a.sort_order,a.created_at`
    : Promise.resolve([] as any[]);
  const [actions,history] = await Promise.all([
    actionsPromise,
    task.task_template_id ? sql<any[]>`select h.*,h.id::text from marketing.task_review_history h where h.task_template_id=${task.task_template_id}::uuid order by h.created_at desc` : Promise.resolve([]),
  ]);
  return {
    ok:true,task,actions,history,
    permissions:{
      canDownloadTemplate:hasPermission(user,"marketing.task_template.download"),
      canUploadTemplate:hasPermission(user,task.template_file_id?"marketing.task_template.reupload":"marketing.task_template.upload"),
      canApproveTemplate:hasPermission(user,"marketing.task_template.approve"),
      canUnapproveTemplate:hasPermission(user,"marketing.task_template.approve"),
      canRejectTemplate:hasPermission(user,"marketing.task_template.reject"),
      canViewFeedback:hasPermission(user,"marketing.task_template.view_feedback") || task.assigned_to===user.id || task.paired_content_user_id===user.id,
      canExecuteAction:hasPermission(user,"marketing.assignment_action.execute"),
      canExecuteAdminAction:hasPermission(user,"marketing.assignment_action.admin"),
      canUploadFinal:hasPermission(user,"marketing.task.final_file.upload"),
      canDownloadFile:hasPermission(user,"marketing.file.download"),
      canCompleteTask:task.assigned_to===user.id || task.paired_content_user_id===user.id || canViewAllTasks(user),
    }
  };
}

async function saveDepartment(sql: ReturnType<typeof getSql>, body: any, user: SessionUser) {
  const requestedId=clean(body.id);
  const name=clean(body.name);
  const userIds=[...new Set(arrayValue<string>(body.userIds).map(clean).filter(Boolean))];
  if(!name)throw new Error("اسم القسم مطلوب");
  try {
    const result=await sql.begin(async(tx)=>{
      const activeUsers=userIds.length?await tx<any[]>`
        select id::text from core.users
        where id in ${tx(userIds)} and is_active=true and coalesce(disabled_reason,'') not like 'ACCOUNT_DELETED:%'
      `:[];
      if(activeUsers.length!==userIds.length)throw new Error("يوجد مستخدم غير فعال أو غير موجود ضمن الاختيار");

      let departmentId=requestedId;
      let row:any;
      let reused=false;
      if(bool(body.isContent)){
        await tx`update marketing.departments set is_content=false,updated_at=now() where is_content=true and (${requestedId}='' or id<>nullif(${requestedId},'')::uuid)`;
      }
      if(departmentId){
        const [existing]=await tx<any[]>`
          select md.id::text,cd.name,md.is_content,md.is_active
          from marketing.departments md join core.departments cd on cd.id=md.id
          where md.id=${departmentId}::uuid and cd.system_code='marketing'
        `;
        if(!existing)throw new Error("قسم التسويق غير موجود");
        const [duplicate]=await tx<any[]>`
          select md.id::text
          from marketing.departments md
          join core.departments cd on cd.id=md.id and cd.system_code='marketing'
          where md.id<>${departmentId}::uuid
            and lower(btrim(cd.name))=lower(btrim(${name}))
          limit 1
        `;
        if(duplicate)throw new Error("يوجد قسم تسويق آخر بنفس الاسم");
        await tx`update core.departments set name=${name},is_active=true,updated_at=now() where id=${departmentId}::uuid and system_code='marketing'`;
        [row]=await tx<any[]>`update marketing.departments set name=${name},is_content=${bool(body.isContent)},is_active=true,updated_at=now() where id=${departmentId}::uuid returning id::text,name,is_content,is_active`;
      }else{
        const [existingMarketing]=await tx<any[]>`
          select md.id::text
          from marketing.departments md
          join core.departments cd on cd.id=md.id and cd.system_code='marketing'
          where lower(btrim(md.name))=lower(btrim(${name}))
             or lower(btrim(cd.name))=lower(btrim(${name}))
          order by md.created_at
          limit 1
        `;
        const [existingCore]=existingMarketing?[]:await tx<any[]>`
          select id::text
          from core.departments
          where system_code='marketing' and lower(btrim(name))=lower(btrim(${name}))
          order by is_active desc,created_at
          limit 1
        `;
        departmentId=clean(existingMarketing?.id||existingCore?.id);
        reused=Boolean(departmentId);

        if(departmentId){
          await tx`update core.departments set name=${name},is_active=true,updated_at=now() where id=${departmentId}::uuid and system_code='marketing'`;
          [row]=await tx<any[]>`
            insert into marketing.departments(id,name,is_content,is_active,created_by)
            values(${departmentId}::uuid,${name},${bool(body.isContent)},true,${user.id}::uuid)
            on conflict(id) do update set name=excluded.name,is_content=excluded.is_content,is_active=true,updated_at=now()
            returning id::text,name,is_content,is_active
          `;
        }else{
          departmentId=crypto.randomUUID();
          const code=`marketing_${departmentId.replace(/-/g,"").slice(0,16)}`;
          await tx`insert into core.departments(id,code,name,system_code,is_active) values(${departmentId}::uuid,${code},${name},'marketing',true)`;
          [row]=await tx<any[]>`insert into marketing.departments(id,name,is_content,is_active,created_by) values(${departmentId}::uuid,${name},${bool(body.isContent)},true,${user.id}::uuid) returning id::text,name,is_content,is_active`;
        }
      }

      const previous=await tx<any[]>`select user_id::text from core.user_system_departments where system_code='marketing' and department_id=${departmentId}::uuid`;
      const previousIds=previous.map((item:any)=>clean(item.user_id));
      const affected=[...new Set([...previousIds,...userIds])];

      await tx`delete from core.user_system_departments where system_code='marketing' and department_id=${departmentId}::uuid and not (user_id::text = any(${userIds}::text[]))`;
      for(const userId of userIds){
        await tx`insert into core.user_system_departments(user_id,system_code,department_id,is_primary) values(${userId}::uuid,'marketing',${departmentId}::uuid,false) on conflict(user_id,system_code,department_id) do nothing`;
      }

      for(const userId of affected){
        await tx`delete from core.user_departments ud where ud.user_id=${userId}::uuid and ud.department_id=${departmentId}::uuid and not exists(select 1 from core.user_system_departments usd where usd.user_id=ud.user_id and usd.department_id=ud.department_id)`;
        await tx`insert into core.user_departments(user_id,department_id,is_primary) select ${userId}::uuid,${departmentId}::uuid,bool_or(is_primary) from core.user_system_departments where user_id=${userId}::uuid and department_id=${departmentId}::uuid group by user_id,department_id on conflict(user_id,department_id) do update set is_primary=excluded.is_primary`;
        await tx`update core.users set permission_version=permission_version+1,updated_at=now() where id=${userId}::uuid`;
        await tx`delete from core.sessions where user_id=${userId}::uuid`;
      }
      return{row,departmentId,previousIds,reused:!requestedId&&reused};
    });
    await audit(sql,user,requestedId?"department_updated":result.reused?"department_reused":"department_created","department",result.departmentId,{name,isContent:bool(body.isContent),userIds},requestedId?{userIds:result.previousIds}:undefined);
    return{ok:true,row:result.row,message:result.reused?"تم ربط القسم الموجود وحفظ يوزراته فعليًا":"تم حفظ القسم وربط الأقسام المسموحة للمستخدمين فعليًا"};
  } catch (failure) {
    const error=failure as Error & { code?: string; constraint_name?: string; constraint?: string };
    const constraint=clean(error.constraint_name||error.constraint);
    if(error.code==='23505'&&constraint.includes('departments_name_key'))throw new Error("يوجد قسم بنفس الاسم؛ افتح القسم الموجود وعدّل يوزراته بدل إنشاء نسخة مكررة");
    throw failure;
  }
}

async function saveAssignmentAction(sql: ReturnType<typeof getSql>, body:any){const id=clean(body.id),departmentId=clean(body.departmentId),name=clean(body.name),percentage=numberValue(body.percentage);if(!departmentId||!name)throw new Error("بيانات إجراء التكليف غير مكتملة");const [sum]=await sql<any[]>`select coalesce(sum(percentage),0)::float as total from marketing.assignment_actions where department_id=${departmentId}::uuid and is_active=true and (${id}='' or id<>nullif(${id},'')::uuid)`;if(Number(sum?.total||0)+percentage>100.001)throw new Error("مجموع نسب إجراءات القسم لا يمكن أن يتجاوز 100%");const [row]=id?await sql<any[]>`update marketing.assignment_actions set department_id=${departmentId}::uuid,name=${name},percentage=${percentage},admin_only=${bool(body.adminOnly)},sort_order=${numberValue(body.sortOrder)},updated_at=now() where id=${id}::uuid returning *,id::text`:await sql<any[]>`insert into marketing.assignment_actions(department_id,name,percentage,admin_only,sort_order) values(${departmentId}::uuid,${name},${percentage},${bool(body.adminOnly)},${numberValue(body.sortOrder)}) returning *,id::text`;return{ok:true,row,message:"تم حفظ إجراء التكليف"};}
async function saveCreativeType(sql:ReturnType<typeof getSql>,body:any){const id=clean(body.id),name=clean(body.name),shortCode=safeCode(body.shortCode),departmentId=clean(body.primaryDepartmentId);if(!name||!shortCode||!departmentId)throw new Error("بيانات الكرييتيف غير مكتملة");const[row]=id?await sql<any[]>`update marketing.creative_types set name=${name},short_code=${shortCode},primary_department_id=${departmentId}::uuid,updated_at=now() where id=${id}::uuid returning *,id::text`:await sql<any[]>`insert into marketing.creative_types(name,short_code,primary_department_id) values(${name},${shortCode},${departmentId}::uuid) returning *,id::text`;return{ok:true,row,message:"تم حفظ الكرييتيف"};}
async function saveCampaignType(sql:ReturnType<typeof getSql>,body:any){const id=clean(body.id),name=clean(body.name),shortCode=safeCode(body.shortCode),prefix=safeCode(body.codePrefix);if(!name||!shortCode||!prefix)throw new Error("بيانات نوع الحملة غير مكتملة");const[row]=id?await sql<any[]>`update marketing.campaign_types set name=${name},short_code=${shortCode},code_prefix=${prefix},updated_at=now() where id=${id}::uuid returning *,id::text`:await sql<any[]>`insert into marketing.campaign_types(name,short_code,code_prefix) values(${name},${shortCode},${prefix}) returning *,id::text`;return{ok:true,row,message:"تم حفظ نوع الحملة"};}
async function savePlatform(sql:ReturnType<typeof getSql>,body:any){const id=clean(body.id),name=clean(body.name),code=safeCode(body.code||name).toLowerCase(),postTypes=arrayValue(body.postTypes);if(!name||!code)throw new Error("اسم المنصة مطلوب");return sql.begin(async(tx)=>{const[row]=id?await tx<any[]>`update marketing.platforms set name=${name},code=${code},updated_at=now() where id=${id}::uuid returning *,id::text`:await tx<any[]>`insert into marketing.platforms(name,code) values(${name},${code}) returning *,id::text`;await tx`update marketing.platform_post_types set is_active=false,updated_at=now() where platform_id=${row.id}::uuid`;for(const item of postTypes){const postName=clean(item.name);if(!postName)continue;await tx`insert into marketing.platform_post_types(platform_id,name,width,height,is_active) values(${row.id}::uuid,${postName},${numberValue(item.width)||null},${numberValue(item.height)||null},true) on conflict(platform_id,name) do update set width=excluded.width,height=excluded.height,is_active=true,updated_at=now()`;}return{ok:true,row,message:"تم حفظ المنصة وأنواع النشر"};});}
async function packageSettings(sql:ReturnType<typeof getSql>){
  const[categories,salesTypes]=await Promise.all([
    sql<any[]>`select id::text,name,sort_order from marketing.package_categories where is_active=true order by sort_order,name`,
    sql<any[]>`select id::text,name,sort_order from marketing.package_sales_types where is_active=true order by sort_order,name`,
  ]);
  return{ok:true,categories,salesTypes};
}

async function savePackageLookup(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!hasPermission(user,"settings.marketing.manage"))throw new Error("لا توجد صلاحية لإدارة إعدادات الباقات");
  const lookupType=clean(body.lookupType),id=clean(body.id),name=clean(body.name),sortOrder=Math.trunc(numberValue(body.sortOrder));
  if(!name)throw new Error("اسم القيمة مطلوب");
  const config=lookupType==='category'
    ?{table:'marketing.package_categories',label:'التصنيف'}
    :lookupType==='sales_type'
      ?{table:'marketing.package_sales_types',label:'نوع المبيعات'}
      :null;
  if(!config)throw new Error("نوع الإعداد غير صحيح");
  const duplicate=await sql.unsafe<any[]>(`select id::text from ${config.table} where lower(btrim(name))=lower(btrim($1)) and ($2::text='' or id<>$2::uuid) limit 1`,[name,id]);
  if(duplicate.length)throw new Error(`${config.label} موجود بالفعل`);
  const rows=id
    ?await sql.unsafe<any[]>(`update ${config.table} set name=$1,sort_order=$2,is_active=true,updated_at=now() where id=$3::uuid returning id::text,name,sort_order`,[name,sortOrder,id])
    :await sql.unsafe<any[]>(`insert into ${config.table}(name,sort_order,created_by) values($1,$2,$3::uuid) returning id::text,name,sort_order`,[name,sortOrder,user.id]);
  return{ok:true,row:rows[0],message:`تم حفظ ${config.label}`};
}

async function savePackage(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const id=clean(body.id),name=clean(body.name),categoryId=clean(body.categoryId),salesTypeId=clean(body.salesTypeId);
  if(!name||!categoryId||!salesTypeId)throw new Error("اسم الباقة والتصنيف والمبيعات مطلوبة");
  const[[category],[salesType]]=await Promise.all([
    sql<any[]>`select id::text,name from marketing.package_categories where id=${categoryId}::uuid and is_active=true`,
    sql<any[]>`select id::text,name from marketing.package_sales_types where id=${salesTypeId}::uuid and is_active=true`,
  ]);
  if(!category)throw new Error("التصنيف المحدد غير موجود");
  if(!salesType)throw new Error("نوع المبيعات المحدد غير موجود");
  const features=arrayValue(body.careFeatures).map(clean).filter(Boolean);
  const[row]=id
    ?await sql<any[]>`update marketing.packages set name=${name},category=${category.name},category_id=${categoryId}::uuid,sales_type=${salesType.name},sales_type_id=${salesTypeId}::uuid,price=${numberValue(body.price)},cash_discount=${numberValue(body.cashDiscount)},registration_fees=${bool(body.registrationFees)},insurance=${bool(body.insurance)},issuance_fees=${bool(body.issuanceFees)},care_features=${sql.json(dbJson(features))},delivery_home=${bool(body.deliveryHome)},delivery_region=${bool(body.deliveryRegion)},updated_at=now() where id=${id}::uuid returning *,id::text,category_id::text,sales_type_id::text`
    :await sql<any[]>`insert into marketing.packages(name,category,category_id,sales_type,sales_type_id,price,cash_discount,registration_fees,insurance,issuance_fees,care_features,delivery_home,delivery_region,created_by) values(${name},${category.name},${categoryId}::uuid,${salesType.name},${salesTypeId}::uuid,${numberValue(body.price)},${numberValue(body.cashDiscount)},${bool(body.registrationFees)},${bool(body.insurance)},${bool(body.issuanceFees)},${sql.json(dbJson(features))},${bool(body.deliveryHome)},${bool(body.deliveryRegion)},${user.id}::uuid) returning *,id::text,category_id::text,sales_type_id::text`;
  return{ok:true,row,message:"تم حفظ الباقة"};
}
async function softDeleteSetting(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){const entity=clean(body.entity),id=clean(body.id);if((entity==='package_category'||entity==='package_sales_type')&&!hasPermission(user,"settings.marketing.manage"))throw new Error("لا توجد صلاحية لإدارة إعدادات الباقات");if(!id)throw new Error("بيانات الحذف غير صحيحة");if(entity==='package_category'){const[used]=await sql<any[]>`select count(*)::int as count from marketing.packages where is_active=true and category_id=${id}::uuid`;if(Number(used?.count||0)>0)throw new Error("لا يمكن حذف التصنيف لأنه مستخدم داخل باقات حالية");}if(entity==='package_sales_type'){const[used]=await sql<any[]>`select count(*)::int as count from marketing.packages where is_active=true and sales_type_id=${id}::uuid`;if(Number(used?.count||0)>0)throw new Error("لا يمكن حذف نوع المبيعات لأنه مستخدم داخل باقات حالية");}if(entity==='department'){await sql.begin(async tx=>{const users=await tx<any[]>`select user_id::text from core.user_system_departments where system_code='marketing' and department_id=${id}::uuid`;await tx`update marketing.departments set is_active=false,updated_at=now() where id=${id}::uuid`;await tx`update core.departments set is_active=false,updated_at=now() where id=${id}::uuid and system_code='marketing'`;await tx`delete from core.user_system_departments where system_code='marketing' and department_id=${id}::uuid`;for(const item of users){await tx`delete from core.user_departments where user_id=${item.user_id}::uuid and department_id=${id}::uuid and not exists(select 1 from core.user_system_departments where user_id=${item.user_id}::uuid and department_id=${id}::uuid)`;await tx`update core.users set permission_version=permission_version+1,updated_at=now() where id=${item.user_id}::uuid`;await tx`delete from core.sessions where user_id=${item.user_id}::uuid`;}});return{ok:true,message:"تم حذف القسم وإزالة عضويته من التسويق فقط"};}const allowed:Record<string,string>={action:"marketing.assignment_actions",creative_type:"marketing.creative_types",campaign_type:"marketing.campaign_types",platform:"marketing.platforms",package:"marketing.packages",package_category:"marketing.package_categories",package_sales_type:"marketing.package_sales_types"};const table=allowed[entity];if(!table)throw new Error("بيانات الحذف غير صحيحة");await sql.unsafe(`update ${table} set is_active=false,updated_at=now() where id=$1::uuid`,[id]);return{ok:true,message:"تم الحذف"};}

async function receiveTask(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){const id=clean(body.id);if(!hasPermission(user,"marketing.task.receive"))throw new Error("لا توجد صلاحية لاستلام التاسك");const[task]=await sql<any[]>`select *,id::text,source_id::text,assigned_to::text from marketing.tasks where id=${id}::uuid and is_deleted=false`;if(!task)throw new Error("التاسك غير موجود");if(!await canAccessMarketingTask(sql,user,id))throw new Error("لا توجد صلاحية لاستلام التاسك");await sql`update marketing.tasks set received_at=coalesce(received_at,now()),status=case when status='required' then 'received' else status end,updated_at=now() where id=${id}::uuid`;if(task.task_kind==='task_template')await sql`update marketing.task_templates set received_at=coalesce(received_at,now()),updated_at=now() where id=${task.task_template_id}::uuid`;await recalculateProgress(sql,task.source_type,task.source_id);return{ok:true,message:"تم الاستلام"};}
async function uploadTemplate(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId),fileId=clean(body.fileId),data=validateTemplateData(body.templateData);
  const task=await requireTaskTemplateUploadAccess(sql,user,taskId);
  const[file]=await sql<any[]>`select id::text,category,task_id::text,status,uploaded_by::text from marketing.files where id=${fileId}::uuid`;
  if(!file||file.category!=="task-template"||file.task_id!==taskId||file.status!=="ready")throw new Error("ملف Task Template غير صالح أو غير مرتبط بهذا التكليف");
  if(file.uploaded_by!==user.id&&!hasPermission(user,"marketing.file.view_others"))throw new Error("لا توجد صلاحية لاستخدام هذا الملف");
  await sql.begin(async tx=>{
    await tx`update marketing.task_templates set file_id=${fileId}::uuid,template_data=template_data||${tx.json(dbJson(data))},status='under_review',progress=50,updated_at=now() where id=${task.task_template_id}::uuid`;
    await tx`update marketing.tasks set progress=50,status='under_review',updated_at=now() where id=${taskId}::uuid`;
    await tx`insert into marketing.task_review_history(task_template_id,action,after_data,actor_id,actor_name) values(${task.task_template_id}::uuid,'uploaded',${tx.json(dbJson(data))},${user.id}::uuid,${user.fullName})`;
  });
  await recalculateProgress(sql,task.source_type,task.source_id);
  return{ok:true,message:"تم رفع Task Template وإرساله للمراجعة"};
}
async function reviewTemplate(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const templateId=clean(body.templateId),action=clean(body.reviewAction),note=clean(body.note),data=cleanTemplateData(body.data);
  const permission=action==='approve'||action==='unapprove'?'marketing.task_template.approve':'marketing.task_template.reject';
  if(!hasPermission(user,permission))throw new Error("لا توجد صلاحية لمراجعة Task Template");
  const[template]=await sql<any[]>`select *,id::text,source_id::text,file_id::text from marketing.task_templates where id=${templateId}::uuid`;
  if(!template)throw new Error("Task Template غير موجود");
  if(action==='unapprove'){
    if(template.status!=='approved')throw new Error("يمكن إلغاء اعتماد Task Template المعتمد فقط");
    if(!note)throw new Error("اكتب سبب إلغاء الاعتماد");
    await sql.begin(async tx=>{
      await tx`insert into marketing.task_review_history(task_template_id,action,note,before_data,after_data,actor_id,actor_name) values(${templateId}::uuid,'unapproved',${note},${tx.json(dbJson(template))},${tx.json({status:'not_started',fileId:null})},${user.id}::uuid,${user.fullName})`;
      await tx`update marketing.task_templates set status='not_started',progress=0,admin_note=${note},template_data='{}'::jsonb,approved_data='{}'::jsonb,file_id=null,reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now() where id=${templateId}::uuid`;
      await tx`update marketing.tasks set status='required',progress=0,completed_at=null,completed_by=null,final_file_id=null,approved_template_data='{}'::jsonb,updated_at=now() where task_template_id=${templateId}::uuid and is_deleted=false`;
      await tx`delete from marketing.task_action_progress where task_id in (select id from marketing.tasks where task_template_id=${templateId}::uuid and task_kind='execution' and is_deleted=false)`;
    });
    await recalculateProgress(sql,template.source_type,template.source_id);
    return{ok:true,message:"تم إلغاء اعتماد Task Template وإعادة التاسكات إلى انتظار الرفع"};
  }
  let status=template.status,progress=numberValue(template.progress);
  if(action==='approve'){status='approved';progress=100;}
  else if(action==='request_edit'){status='revision_requested';progress=50;}
  else if(action==='reject'){status='rejected';progress=0;}
  else if(action==='edit'){status='under_review';progress=50;}
  else throw new Error("إجراء المراجعة غير صحيح");
  await sql.begin(async tx=>{
    await tx`insert into marketing.task_review_history(task_template_id,action,note,before_data,after_data,actor_id,actor_name) values(${templateId}::uuid,${action},${note||null},${tx.json(dbJson(template))},${tx.json(dbJson(data))},${user.id}::uuid,${user.fullName})`;
    await tx`update marketing.task_templates set status=${status},progress=${progress},admin_note=${note||null},template_data=case when ${action} in ('edit','approve') then template_data||${tx.json(dbJson(data))} else template_data end,approved_data=case when ${action}='approve' then template_data||${tx.json(dbJson(data))} else approved_data end,reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now() where id=${templateId}::uuid`;
    await tx`update marketing.tasks set status=${status},progress=${progress},updated_at=now() where task_template_id=${templateId}::uuid and task_kind='task_template'`;
    if(action==='approve')await tx`update marketing.tasks set approved_template_data=(select approved_data from marketing.task_templates where id=${templateId}::uuid),status=case when status='required' then 'required' else status end,updated_at=now() where task_template_id=${templateId}::uuid and task_kind='execution'`;
  });
  await recalculateProgress(sql,template.source_type,template.source_id);
  return{ok:true,message:action==='approve'?"تم اعتماد التعليمات":"تم حفظ إجراء المراجعة"};
}
async function toggleTaskAction(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId),actionId=clean(body.actionId),completed=bool(body.completed);
  const[record]=await sql<any[]>`select t.id::text,t.source_type,t.source_id::text,t.assigned_to::text,t.status as task_status,a.admin_only,tt.status as template_status from marketing.tasks t join marketing.assignment_actions a on a.id=${actionId}::uuid left join marketing.task_templates tt on tt.id=t.task_template_id where t.id=${taskId}::uuid and t.is_deleted=false`;
  if(!record)throw new Error("الإجراء أو التاسك غير موجود");
  if(record.task_status==='completed')throw new Error("التاسك منتهي ولا يمكن تعديل إجراءاته");
  if(record.template_status!=='approved')throw new Error("في انتظار اعتماد Task Template");
  const actionPermission=record.admin_only?"marketing.assignment_action.admin":"marketing.assignment_action.execute";
  if(!hasPermission(user,actionPermission))throw new Error(record.admin_only?"هذا الإجراء يحتاج صلاحية إجراء إداري":"لا توجد صلاحية لتنفيذ إجراء التكليف");
  if(!await canAccessMarketingTask(sql,user,taskId))throw new Error("لا توجد صلاحية لتنفيذ الإجراء");
  await sql`insert into marketing.task_action_progress(task_id,action_id,completed,completed_by,completed_at) values(${taskId}::uuid,${actionId}::uuid,${completed},${completed?sql`${user.id}::uuid`:null},${completed?sql`now()`:null}) on conflict(task_id,action_id) do update set completed=excluded.completed,completed_by=excluded.completed_by,completed_at=excluded.completed_at`;
  const[sum]=await sql<any[]>`select coalesce(sum(a.percentage) filter(where p.completed),0)::float as progress,count(a.id)::int as actions from marketing.assignment_actions a left join marketing.task_action_progress p on p.action_id=a.id and p.task_id=${taskId}::uuid where a.department_id=(select department_id from marketing.tasks where id=${taskId}::uuid) and a.is_active=true`;
  const progress=Math.min(100,numberValue(sum?.progress));
  await sql`update marketing.tasks set progress=${progress},status=case when ${progress}>=100 then 'ready_to_complete' when ${progress}>0 then 'in_progress' when received_at is not null then 'received' else 'required' end,completed_at=null,completed_by=null,updated_at=now() where id=${taskId}::uuid`;
  await recalculateProgress(sql,record.source_type,record.source_id);
  return{ok:true,progress,message:"تم تحديث إجراء التكليف"};
}
async function completeTask(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId);
  if(!taskId)throw new Error("رقم التاسك مطلوب");
  const[task]=await sql<any[]>`
    select t.id::text,t.source_type,t.source_id::text,t.task_kind,t.status,t.progress::float,t.received_at,
      t.assigned_to::text,t.paired_content_user_id::text
    from marketing.tasks t
    where t.id=${taskId}::uuid and t.is_deleted=false
  `;
  if(!task)throw new Error("التاسك غير موجود");
  if(task.task_kind!=='execution')throw new Error("إنهاء التاسك متاح للتاسكات التنفيذية فقط");
  if(!await canAccessMarketingTask(sql,user,taskId))throw new Error("لا توجد صلاحية لإنهاء التاسك");
  const assignedUser=task.assigned_to===user.id || task.paired_content_user_id===user.id;
  if(!assignedUser&&!canViewAllTasks(user))throw new Error("لا توجد صلاحية لإنهاء هذا التاسك");
  if(task.status==='completed')return{ok:true,message:"التاسك موجود بالفعل ضمن التاسكات المنتهية"};
  if(!task.received_at)throw new Error("يجب استلام التاسك أولًا");
  if(numberValue(task.progress)<100)throw new Error("لا يمكن إنهاء التاسك قبل وصول نسبة الإنجاز إلى 100%");
  await sql`update marketing.tasks set status='completed',completed_at=now(),completed_by=${user.id}::uuid,updated_at=now() where id=${taskId}::uuid`;
  await recalculateProgress(sql,task.source_type,task.source_id);
  return{ok:true,message:"تم إنهاء التاسك ونقله إلى قائمة التاسكات المنتهية"};
}

async function attachFinalFile(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId),fileId=clean(body.fileId);
  const task=await requireFinalFileUploadAccess(sql,user,taskId);
  if(task.task_kind==='manual_publish')throw new Error("ملفات النشر اليدوي تُرفع كمجموعة مرتبة من شاشة تجهيز النشر");
  const[file]=await sql<any[]>`select id::text,category,task_id::text,status,uploaded_by::text from marketing.files where id=${fileId}::uuid`;
  if(!file||file.category!=="final-file"||file.task_id!==taskId||file.status!=="ready")throw new Error("الملف النهائي غير صالح أو غير مرتبط بهذا التكليف");
  if(file.uploaded_by!==user.id&&!hasPermission(user,"marketing.file.view_others"))throw new Error("لا توجد صلاحية لاستخدام هذا الملف");
  await sql`update marketing.tasks set final_file_id=${fileId}::uuid,updated_at=now() where id=${taskId}::uuid`;
  const[count]=await sql<any[]>`select count(*)::int as count from marketing.assignment_actions where department_id=(select department_id from marketing.tasks where id=${taskId}::uuid) and is_active=true`;
  if(Number(count?.count||0)===0)await sql`update marketing.tasks set progress=100,status='ready_to_complete',completed_at=null,completed_by=null,updated_at=now() where id=${taskId}::uuid`;
  await recalculateProgress(sql,task.source_type,task.source_id);
  return{ok:true,message:"تم رفع الملف النهائي"};
}


async function prepareFinalUpload(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId);
  const task=await requireFinalFileUploadAccess(sql,user,taskId);
  const requested=arrayValue<any>(body.files).map((item,index)=>({
    name:clean(item?.name)||`file-${index+1}`,
    mimeType:clean(item?.mimeType)||"application/octet-stream",
    size:Math.max(0,numberValue(item?.size)),
    orderIndex:index,
  }));
  if(!requested.length)throw new Error("اختر الملف النهائي أولًا");
  if(requested.length>30)throw new Error("الحد الأقصى 30 صورة داخل مجموعة النشر الواحدة");
  const isVideo=(item:any)=>item.mimeType.startsWith('video/')||/\.(mp4|mov|m4v|webm)$/i.test(item.name);
  const isImage=(item:any)=>item.mimeType.startsWith('image/')||/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(item.name);
  if(requested.some((item)=>!isVideo(item)&&!isImage(item)))throw new Error("الملف النهائي يجب أن يكون صورة أو فيديو");
  const videoCount=requested.filter(isVideo).length;
  if(videoCount&&requested.length!==1)throw new Error("الفيديو أو الريل يُرفع كملف واحد فقط. الصور يمكن رفعها ككاروسيل مرتب");
  if(requested.some((item)=>item.size<=0))throw new Error("يوجد ملف فارغ ضمن الاختيار");
  if(task.task_kind==='manual_publish'){
    const expected=arrayValue<any>(task.approved_template_data?.manualFiles);
    const sameFiles=expected.length===requested.length&&expected.every((item:any,index:number)=>{
      const actual=requested[index];
      return clean(item?.name)===actual.name
        && clean(item?.mimeType||'application/octet-stream')===actual.mimeType
        && Math.max(0,numberValue(item?.size))===actual.size;
    });
    if(expected.length&&!sameFiles)throw new Error("الملفات المختارة لا تطابق ملفات النشر اليدوي المحفوظة. أعد إنشاء التجهيز بالملفات الحالية");
  }

  const mediaKind=videoCount?'video':requested.length>1?'carousel':'image';
  await sql`delete from marketing.zoho_upload_tickets where expires_at<now()`;
  const[group]=await sql<any[]>`
    insert into marketing.final_media_groups(task_id,media_kind,file_count,status,is_active,created_by)
    values(${taskId}::uuid,${mediaKind},${requested.length},'uploading',false,${user.id}::uuid)
    returning id::text
  `;
  const uploads:any[]=[];
  try{
    for(const item of requested){
      const[file]=await sql<any[]>`
        insert into marketing.files(storage_key,original_name,mime_type,file_size,category,source_type,source_id,task_id,status,uploaded_by,storage_provider,final_media_group_id,order_index)
        values(${`zoho:${group.id}:${globalThis.crypto.randomUUID()}`},${item.name},${item.mimeType},${item.size},'final-file',${task.source_type},${task.source_id}::uuid,${taskId}::uuid,'uploading',${user.id}::uuid,'zoho',${group.id}::uuid,${item.orderIndex})
        returning id::text
      `;
      const ticket=createOpaqueTicket();
      const zohoFileName=zohoFinalFileName(item.name,task.source_type,task.source_id,taskId,group.id,item.orderIndex);
      const transfer=await prepareZohoUpload(sql,{fileName:zohoFileName,fileSize:item.size});
      await sql`
        insert into marketing.zoho_upload_tickets(ticket_hash,file_id,final_media_group_id,task_id,file_name,mime_type,file_size,parent_folder_id,upload_strategy,upload_id,status,expires_at,created_by)
        values(${ticketHash(ticket)},${file.id}::uuid,${group.id}::uuid,${taskId}::uuid,${zohoFileName},${item.mimeType},${item.size},${transfer.parentId},${transfer.strategy},${transfer.uploadId},'prepared',now()+interval '7 days',${user.id}::uuid)
      `;
      uploads.push({
        ticket,
        fileId:file.id,
        orderIndex:item.orderIndex,
        originalFileName:item.name,
        fileName:zohoFileName,
        mimeType:item.mimeType,
        fileSize:item.size,
        uploadStrategy:transfer.strategy,
        chunkSize:ZOHO_PROXY_CHUNK_SIZE,
      });
    }
  }catch(error:any){
    const message=clean(error?.message)||"تعذر تجهيز رفع الملف النهائي";
    await sql.begin(async tx=>{
      await tx`update marketing.zoho_upload_tickets set status='failed',completed_at=now() where final_media_group_id=${group.id}::uuid and status in ('prepared','uploading')`;
      await tx`update marketing.files set status='failed',upload_error=${message},updated_at=now() where final_media_group_id=${group.id}::uuid and status='uploading'`;
      await tx`update marketing.final_media_groups set status='failed',updated_at=now() where id=${group.id}::uuid`;
    }).catch(()=>undefined);
    throw error;
  }
  return{ok:true,groupId:group.id,mediaKind,uploads,chunkSize:ZOHO_PROXY_CHUNK_SIZE};
}

function finalUploadHeader(request:VercelRequest,name:string){
  const value=request.headers[name.toLowerCase()];
  return Array.isArray(value)?clean(value[0]):clean(value);
}

function finalUploadBytes(request:VercelRequest){
  const body=request.body;
  if(Buffer.isBuffer(body)){
    const bytes=new Uint8Array(body.byteLength);
    bytes.set(body);
    return bytes;
  }
  if(body instanceof Uint8Array){
    const bytes=new Uint8Array(body.byteLength);
    bytes.set(body);
    return bytes;
  }
  if(body instanceof ArrayBuffer)return new Uint8Array(body);
  return null;
}

async function finalUploadTicket(sql:ReturnType<typeof getSql>,ticket:string,user:SessionUser){
  const[row]=await sql<any[]>`
    select z.*,z.file_id::text,z.final_media_group_id::text,z.task_id::text,z.created_by::text
    from marketing.zoho_upload_tickets z
    where z.ticket_hash=${ticketHash(ticket)} and z.expires_at>now() and z.status in ('prepared','uploading')
  `;
  if(!row)throw new Error("جلسة رفع الملف منتهية أو غير صالحة");
  await requireFinalFileUploadAccess(sql,user,row.task_id);
  if(row.created_by!==user.id&&!canViewAllTasks(user))throw new Error("جلسة الرفع لا تخص هذا المستخدم");
  return row;
}

function finalUploadStrategy(row:any){
  return clean(row?.upload_strategy)==='standard'?'standard':'chunk';
}

async function stageFinalUploadPart(sql:ReturnType<typeof getSql>,row:any,start:number,total:number,bytes:Uint8Array){
  const hash=clean(row.ticket_hash);
  return sql.begin(async tx=>{
    const[locked]=await tx<any[]>`
      select ticket_hash,file_size,status,upload_strategy,coalesce(provider_uploaded_bytes,0)::bigint as provider_uploaded_bytes
      from marketing.zoho_upload_tickets
      where ticket_hash=${hash} and expires_at>now() and status in ('prepared','uploading')
      for update
    `;
    if(!locked)throw new Error("جلسة رفع الملف منتهية أو غير صالحة");
    if(Number(locked.file_size||0)!==total)throw new Error("حجم الملف لا يطابق جلسة الرفع");
    const providerUploaded=Number(locked.provider_uploaded_bytes||0);
    const[progress]=await tx<any[]>`
      select coalesce(sum(byte_length),0)::bigint as staged
      from marketing.zoho_standard_upload_parts
      where ticket_hash=${hash}
    `;
    const staged=Number(progress?.staged||0);
    const received=providerUploaded+staged;

    if(start<providerUploaded)return received;
    if(start<received){
      const[existing]=await tx<any[]>`
        select byte_length,content from marketing.zoho_standard_upload_parts
        where ticket_hash=${hash} and start_offset=${start}
      `;
      if(existing&&Number(existing.byte_length||0)===bytes.byteLength&&Buffer.from(existing.content).equals(Buffer.from(bytes)))return received;
      throw new Error(`جزء الملف عند الموضع ${start} تم استلامه سابقًا بمحتوى مختلف`);
    }
    if(start!==received)throw new Error(`ترتيب أجزاء الملف غير صحيح. الجزء المتوقع يبدأ من ${received}`);

    await tx`
      insert into marketing.zoho_standard_upload_parts(ticket_hash,start_offset,byte_length,content)
      values(${hash},${start},${bytes.byteLength},${Buffer.from(bytes)})
    `;
    await tx`update marketing.zoho_upload_tickets set status='uploading' where ticket_hash=${hash} and status='prepared'`;
    return start+bytes.byteLength;
  });
}

async function readFinalUploadParts(sql:ReturnType<typeof getSql>,row:any){
  const expected=Number(row.file_size||0);
  const parts=await sql<{start_offset:number|string;byte_length:number;content:Buffer}[]>`
    select start_offset,byte_length,content
    from marketing.zoho_standard_upload_parts
    where ticket_hash=${clean(row.ticket_hash)}
    order by start_offset
  `;
  const output:Uint8Array[]=[];
  let offset=0;
  for(const part of parts){
    const start=Number(part.start_offset);
    const content=Buffer.from(part.content);
    if(start!==offset||content.byteLength!==Number(part.byte_length||0))throw new Error("أجزاء الملف المرفوع غير مكتملة أو غير مرتبة");
    const bytes=new Uint8Array(content.byteLength);
    bytes.set(content);
    output.push(bytes);
    offset+=bytes.byteLength;
  }
  if(offset!==expected)throw new Error(`لم يكتمل رفع الملف إلى المنصة (${offset} من ${expected} بايت)`);
  return output;
}

async function readFinalUploadRange(sql:ReturnType<typeof getSql>,ticketHashValue:string,start:number,length:number){
  const end=start+length;
  const parts=await sql<{start_offset:number|string;byte_length:number;content:Buffer}[]>`
    select start_offset,byte_length,content
    from marketing.zoho_standard_upload_parts
    where ticket_hash=${ticketHashValue} and start_offset>=${start} and start_offset<${end}
    order by start_offset
  `;
  const output=new Uint8Array(length);
  let offset=start;
  let cursor=0;
  for(const part of parts){
    const partStart=Number(part.start_offset);
    const content=Buffer.from(part.content);
    if(partStart!==offset||content.byteLength!==Number(part.byte_length||0))throw new Error("أجزاء ملف Zoho غير مكتملة أو غير مرتبة");
    if(cursor+content.byteLength>output.byteLength)throw new Error("أجزاء ملف Zoho تتجاوز نافذة الرفع المحددة");
    output.set(content,cursor);
    cursor+=content.byteLength;
    offset+=content.byteLength;
  }
  if(cursor!==length)throw new Error(`نافذة رفع Zoho غير مكتملة (${cursor} من ${length} بايت)`);
  return output;
}

async function flushFinalUploadZohoChunks(sql:ReturnType<typeof getSql>,row:any){
  const hash=clean(row.ticket_hash);
  const uploadId=clean(row.upload_id);
  if(!uploadId)throw new Error("معرف جلسة رفع Zoho غير موجود");
  const total=Number(row.file_size||0);

  while(true){
    const[current]=await sql<any[]>`
      select coalesce(provider_uploaded_bytes,0)::bigint as provider_uploaded_bytes
      from marketing.zoho_upload_tickets
      where ticket_hash=${hash} and expires_at>now() and status in ('prepared','uploading')
    `;
    if(!current)throw new Error("جلسة رفع الملف منتهية أو غير صالحة");
    const providerUploaded=Number(current.provider_uploaded_bytes||0);
    if(providerUploaded>=total)return providerUploaded;

    const[progress]=await sql<any[]>`
      select coalesce(sum(byte_length),0)::bigint as staged
      from marketing.zoho_standard_upload_parts
      where ticket_hash=${hash}
    `;
    const staged=Number(progress?.staged||0);
    const remaining=total-providerUploaded;
    const sendLength=remaining<=ZOHO_PROVIDER_CHUNK_SIZE
      ? (staged===remaining?remaining:0)
      : (staged>=ZOHO_PROVIDER_CHUNK_SIZE?ZOHO_PROVIDER_CHUNK_SIZE:0);
    if(!sendLength)return providerUploaded;

    const bytes=await readFinalUploadRange(sql,hash,providerUploaded,sendLength);
    const uploaded=await uploadZohoChunk(sql,{uploadId,start:providerUploaded,total,bytes});
    const next=uploaded.uploaded;
    await sql.begin(async tx=>{
      const[locked]=await tx<any[]>`
        select coalesce(provider_uploaded_bytes,0)::bigint as provider_uploaded_bytes
        from marketing.zoho_upload_tickets
        where ticket_hash=${hash} and status in ('prepared','uploading')
        for update
      `;
      if(!locked)throw new Error("جلسة رفع الملف منتهية أثناء تثبيت جزء Zoho");
      if(Number(locked.provider_uploaded_bytes||0)!==providerUploaded)throw new Error("تغير تقدم رفع Zoho أثناء تثبيت الجزء");
      await tx`
        delete from marketing.zoho_standard_upload_parts
        where ticket_hash=${hash} and start_offset>=${providerUploaded} and start_offset<${next}
      `;
      await tx`
        update marketing.zoho_upload_tickets
        set provider_uploaded_bytes=${next},status='uploading'
        where ticket_hash=${hash}
      `;
    });
  }
}

async function uploadFinalFileChunk(sql:ReturnType<typeof getSql>,request:VercelRequest,user:SessionUser){
  const ticket=finalUploadHeader(request,"x-mzj-upload-ticket");
  if(!ticket)throw new Error("بيانات جلسة رفع Zoho غير مكتملة");
  const row=await finalUploadTicket(sql,ticket,user);
  const bytes=finalUploadBytes(request);
  if(!bytes?.byteLength)throw new Error("جزء الملف المرفوع فارغ");
  if(bytes.byteLength>ZOHO_PROXY_CHUNK_SIZE)throw new Error("حجم جزء الملف أكبر من الحد الآمن للرفع");

  const start=Number(finalUploadHeader(request,"x-mzj-upload-offset"));
  const total=Number(finalUploadHeader(request,"x-mzj-upload-total"));
  const expected=Number(row.file_size||0);
  if(!Number.isSafeInteger(start)||start<0)throw new Error("موضع جزء الملف غير صالح");
  if(!Number.isSafeInteger(total)||total<=0||total!==expected)throw new Error("حجم الملف لا يطابق جلسة الرفع");
  const end=start+bytes.byteLength-1;
  if(end>=total&&end!==total-1)throw new Error("نطاق جزء الملف يتجاوز الحجم المحدد");

  const received=await stageFinalUploadPart(sql,row,start,total,bytes);
  const providerUploaded=finalUploadStrategy(row)==='chunk'?await flushFinalUploadZohoChunks(sql,row):0;
  return{ok:true,uploaded:received,providerUploaded,total};
}

async function commitFinalFileUpload(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const ticket=clean(body.ticket);
  if(!ticket)throw new Error("بيانات جلسة رفع Zoho غير مكتملة");
  const row=await finalUploadTicket(sql,ticket,user);
  let committed:any;
  try{
    if(finalUploadStrategy(row)==='standard'){
      const parts=await readFinalUploadParts(sql,row);
      committed=await uploadZohoStandardFile(sql,{
        fileName:clean(row.file_name)||'file',
        mimeType:clean(row.mime_type)||'application/octet-stream',
        fileSize:Number(row.file_size||0),
        parentId:clean(row.parent_folder_id),
        parts,
      });
    }else{
      const uploaded=await flushFinalUploadZohoChunks(sql,row);
      const expected=Number(row.file_size||0);
      if(uploaded!==expected)throw new Error(`لم يكتمل إرسال الملف إلى Zoho (${uploaded} من ${expected} بايت)`);
      const uploadId=clean(row.upload_id);
      if(!uploadId)throw new Error("معرف جلسة رفع Zoho غير موجود");
      committed=await commitZohoChunkUpload(sql,{uploadId,parentId:clean(row.parent_folder_id),fileName:clean(row.file_name)||'file'});
    }
  }catch(error:any){
    const message=clean(error?.message)||"تعذر إنهاء رفع الملف في Zoho";
    await sql.begin(async tx=>{
      await tx`delete from marketing.zoho_standard_upload_parts where ticket_hash=${clean(row.ticket_hash)}`;
      await tx`update marketing.zoho_upload_tickets set status='failed',completed_at=now() where ticket_hash=${ticketHash(ticket)}`;
      await tx`update marketing.files set status='failed',upload_error=${message},updated_at=now() where id=${row.file_id}::uuid`;
      await tx`update marketing.final_media_groups set status='failed',updated_at=now() where id=${row.final_media_group_id}::uuid`;
    });
    throw error;
  }

  let fileInfo:any={};
  try{fileInfo=await getZohoFileInfo(sql,committed.resourceId);}catch{fileInfo={};}
  const externalUrl=clean(fileInfo.permalink||committed.parsed.permalink)||null;
  const finalName=clean(fileInfo.fileName||committed.parsed.fileName||row.file_name);
  await sql.begin(async tx=>{
    await tx`
      update marketing.files
      set status='ready',storage_provider='zoho',external_id=${committed.resourceId},external_parent_id=${clean(fileInfo.parentId||committed.parsed.parentId||committed.parentId)},external_url=${externalUrl},original_name=${finalName||row.file_name},upload_error=null,updated_at=now()
      where id=${row.file_id}::uuid
    `;
    await tx`delete from marketing.zoho_standard_upload_parts where ticket_hash=${clean(row.ticket_hash)}`;
    await tx`update marketing.zoho_upload_tickets set status='completed',completed_at=now() where ticket_hash=${ticketHash(ticket)}`;
    const[counts]=await tx<any[]>`
      select count(*)::int as total,count(*) filter(where status='ready')::int as ready
      from marketing.files where final_media_group_id=${row.final_media_group_id}::uuid
    `;
    if(Number(counts?.total||0)>0&&Number(counts?.total||0)===Number(counts?.ready||0))await tx`update marketing.final_media_groups set status='ready',updated_at=now() where id=${row.final_media_group_id}::uuid`;
  });
  return{ok:true,fileId:row.file_id,groupId:row.final_media_group_id,resourceId:committed.resourceId,fileName:finalName};
}

async function cancelFinalUpload(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const groupId=clean(body.groupId);
  if(!groupId)throw new Error("مجموعة الرفع غير محددة");
  const[group]=await sql<any[]>`select id::text,task_id::text,created_by::text,status from marketing.final_media_groups where id=${groupId}::uuid`;
  if(!group)throw new Error("مجموعة الرفع غير موجودة");
  await requireFinalFileUploadAccess(sql,user,group.task_id);
  if(group.created_by!==user.id&&!canViewAllTasks(user))throw new Error("لا توجد صلاحية لإلغاء هذه العملية");
  await sql.begin(async tx=>{
    await tx`
      delete from marketing.zoho_standard_upload_parts p
      using marketing.zoho_upload_tickets z
      where p.ticket_hash=z.ticket_hash and z.final_media_group_id=${groupId}::uuid
    `;
    await tx`update marketing.zoho_upload_tickets set status='cancelled',completed_at=now() where final_media_group_id=${groupId}::uuid and status in ('prepared','uploading')`;
    await tx`update marketing.files set status='cancelled',upload_error='تم إلغاء الرفع بواسطة المستخدم',updated_at=now() where final_media_group_id=${groupId}::uuid and status='uploading'`;
    await tx`update marketing.final_media_groups set status='cancelled',is_active=false,updated_at=now() where id=${groupId}::uuid`;
  });
  return{ok:true,message:"تم إلغاء رفع الملف النهائي"};
}

async function attachFinalMediaGroup(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const taskId=clean(body.taskId),groupId=clean(body.groupId);
  const task=await requireFinalFileUploadAccess(sql,user,taskId);
  const[group]=await sql<any[]>`
    select g.*,g.id::text,g.task_id::text
    from marketing.final_media_groups g
    where g.id=${groupId}::uuid and g.task_id=${taskId}::uuid
  `;
  if(!group)throw new Error("مجموعة الملف النهائي غير موجودة");
  const files=await sql<any[]>`
    select id::text,original_name,mime_type,file_size,order_index,status,external_id
    from marketing.files
    where final_media_group_id=${groupId}::uuid
    order by order_index,created_at,id
  `;
  if(!files.length||files.some((file:any)=>file.status!=='ready'||!clean(file.external_id)))throw new Error("لم يكتمل رفع كل الملفات إلى Zoho WorkDrive");
  if(files.length!==Number(group.file_count||0))throw new Error("عدد الملفات المرفوعة لا يطابق مجموعة النشر");
  const firstFileId=clean(files[0]?.id);
  await sql.begin(async tx=>{
    await tx`update marketing.final_media_groups set is_active=false,updated_at=now() where task_id=${taskId}::uuid and id<>${groupId}::uuid`;
    await tx`update marketing.final_media_groups set is_active=true,status='ready',updated_at=now() where id=${groupId}::uuid`;
    await tx`update marketing.tasks set final_media_group_id=${groupId}::uuid,final_file_id=${firstFileId}::uuid,updated_at=now() where id=${taskId}::uuid`;
    if(task.task_kind==='manual_publish'){
      await tx`update marketing.tasks set progress=100,status='completed',completed_at=coalesce(completed_at,now()),completed_by=coalesce(completed_by,${user.id}::uuid),updated_at=now() where id=${taskId}::uuid`;
    }else{
      const[count]=await tx<any[]>`select count(*)::int as count from marketing.assignment_actions where department_id=(select department_id from marketing.tasks where id=${taskId}::uuid) and is_active=true`;
      if(Number(count?.count||0)===0)await tx`update marketing.tasks set progress=100,status='ready_to_complete',completed_at=null,completed_by=null,updated_at=now() where id=${taskId}::uuid`;
    }
  });
  await recalculateProgress(sql,task.source_type,task.source_id);
  return{ok:true,message:files.length>1?`تم رفع ${files.length} صور نهائية بالترتيب على Zoho WorkDrive`:`تم رفع الملف النهائي على Zoho WorkDrive`,groupId,files};
}

async function prepareUpload(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!mediaStorageConfigured())throw new Error("تخزين الملفات R2 غير مضبوط في المنصة");
  const category=clean(body.category),sourceType=clean(body.sourceType),sourceId=clean(body.sourceId),taskId=clean(body.taskId),fileName=clean(body.fileName)||"file.bin",mimeType=clean(body.mimeType)||"application/octet-stream",fileSize=numberValue(body.fileSize)||null;
  if(!category)throw new Error("نوع الملف مطلوب");
  if(category==="task-template")await requireTaskTemplateUploadAccess(sql,user,taskId);
  else if(category==="final-file")await requireFinalFileUploadAccess(sql,user,taskId);
  else{
    if(!hasPermission(user,"marketing.file.upload"))throw new Error("لا توجد صلاحية لرفع الملفات");
    if(taskId&&!await canAccessMarketingTask(sql,user,taskId))throw new Error("التاسك خارج نطاق بياناتك");
    if(sourceId&&!taskId)await assertMarketingEntityAccess(sql,user,sourceType,sourceId);
  }
  const storageKey=buildMarketingStorageKey({category,sourceType,sourceId,taskId,fileName});
  const[file]=await sql<any[]>`insert into marketing.files(storage_key,original_name,mime_type,file_size,category,source_type,source_id,task_id,status,uploaded_by) values(${storageKey},${fileName},${mimeType},${fileSize},${category},${sourceType||null},${sourceId?sql`${sourceId}::uuid`:null},${taskId?sql`${taskId}::uuid`:null},'uploading',${user.id}::uuid) returning *,id::text`;
  return{ok:true,fileId:file.id,storageKey,uploadUrl:createUploadUrl(storageKey,900)};
}

async function markFileReady(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const fileId=clean(body.fileId);
  const[file]=await sql<any[]>`select id::text,category,task_id::text,source_type,source_id::text,status,uploaded_by::text from marketing.files where id=${fileId}::uuid`;
  if(!file)throw new Error("الملف غير موجود");
  if(file.uploaded_by!==user.id&&!hasPermission(user,"marketing.file.view_others"))throw new Error("لا توجد صلاحية لتحديث الملف");
  if(file.category==="task-template")await requireTaskTemplateUploadAccess(sql,user,file.task_id);
  else if(file.category==="final-file")await requireFinalFileUploadAccess(sql,user,file.task_id);
  else{
    if(!hasPermission(user,"marketing.file.upload"))throw new Error("لا توجد صلاحية لتحديث الملف");
    if(file.task_id&&!await canAccessMarketingTask(sql,user,file.task_id))throw new Error("التاسك خارج نطاق بياناتك");
    if(file.source_id&&!file.task_id)await assertMarketingEntityAccess(sql,user,clean(file.source_type),file.source_id);
  }
  const rows=await sql<any[]>`update marketing.files set status='ready',updated_at=now() where id=${fileId}::uuid and status='uploading' returning id::text`;
  if(!rows.length)throw new Error(file.status==="ready"?"تم حفظ الملف مسبقًا":"تعذر تحديث حالة الملف");
  return{ok:true,message:"تم حفظ الملف"};
}
async function fileDownload(sql:ReturnType<typeof getSql>,id:string,user:SessionUser){
  const[file]=await sql<any[]>`select *,id::text,source_id::text,task_id::text,uploaded_by::text from marketing.files where id=${id}::uuid and status='ready'`;
  if(!file)throw new Error("الملف غير موجود");
  if(!hasPermission(user,"marketing.file.view_others")){
    const allowed=file.task_id?await canAccessMarketingTask(sql,user,file.task_id):file.source_id?await canAccessMarketingEntity(sql,user,clean(file.source_type),file.source_id):file.uploaded_by===user.id;
    if(!allowed)throw new Error("الملف خارج نطاق بياناتك");
  }
  if(clean(file.storage_provider)==='zoho'){
    if(!clean(file.external_id))throw new Error("معرف ملف Zoho غير موجود");
    const info=await getZohoFileInfo(sql,clean(file.external_id));
    const url=clean(info.permalink||file.external_url||info.downloadUrl);
    if(!url)throw new Error("Zoho لم يرجع رابط فتح للملف");
    return{ok:true,url,file:{id:file.id,name:file.original_name,mimeType:file.mime_type,size:file.file_size,provider:'zoho'}};
  }
  if(!mediaStorageConfigured())throw new Error("تخزين الملفات R2 غير مضبوط");
  return{ok:true,url:createDownloadUrl(file.storage_key,900),file:{id:file.id,name:file.original_name,mimeType:file.mime_type,size:file.file_size,provider:'r2'}};
}

async function publishPrep(sql:ReturnType<typeof getSql>,user:SessionUser) {
  const access=marketingAccess(user),unrestricted=access.dataScope==='all',departmentScoped=['department','departments','branch_and_department'].includes(access.dataScope),departmentCodes=marketingDepartmentCodes(user),createdByMe=access.dataScope==='created_by_me';
  const rows=await sql<any[]>`
    select
      coalesce(schedule_row.group_id::text,t.id::text) as id,
      schedule_row.group_id::text,
      t.source_type,
      t.source_id::text,
      t.creative_id::text,
      t.id::text as task_id,
      t.task_kind,
      t.status as task_status,
      t.completed_at,
      schedule_row.publish_date,
      coalesce(
        nullif(schedule_row.caption,''),
        nullif(t.approved_template_data->>'caption',''),
        case when tt.status='approved' then nullif(tt.approved_data->>'caption','') end
      ) as caption,
      coalesce(
        nullif(schedule_row.hashtags,''),
        nullif(t.approved_template_data->>'hashtags',''),
        case when tt.status='approved' then nullif(tt.approved_data->>'hashtags','') end
      ) as hashtags,
      coalesce(aggregate_data.status,'waiting') as status,
      coalesce(aggregate_data.schedule_ids,array[]::text[]) as schedule_ids,
      aggregate_data.platform_name,
      coalesce(youtube_data.youtube_options,'{}'::jsonb) as youtube_options,
      coalesce(
        nullif(t.approved_template_data->>'proposedName',''),
        case when tt.status='approved' then nullif(tt.approved_data->>'proposedName','') end,
        c.name
      ) as youtube_title_seed,
      aggregate_data.post_type_name,
      coalesce(error_data.publish_errors,'[]'::jsonb) as publish_errors,
      coalesce(platform_data.platforms,'[]'::jsonb) as platforms,
      c.name as creative_name,
      c.instance_code,
      coalesce(cam.name,ag.name,case when t.source_type='manual' then 'نشر يدوي' end) as source_name,
      t.progress::float,
      t.final_file_id::text,
      t.final_media_group_id::text,
      coalesce(fm.primary_name,f.original_name) as final_file_name,
      coalesce(fm.file_count,case when f.id is null then 0 else 1 end)::int as final_file_count,
      coalesce(fm.files,'[]'::jsonb) as final_files,
      t.department_id::text,
      d.name as department_name,
      u.full_name as assigned_name
    from marketing.tasks t
    join marketing.creatives c on c.id=t.creative_id
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id
    left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    left join lateral (
      select ps.group_id,ps.publish_date,ps.caption,ps.hashtags,ps.created_at
      from marketing.publish_schedule ps
      where ps.task_id=t.id
      order by ps.updated_at desc,ps.created_at desc,ps.id desc
      limit 1
    ) schedule_row on true
    left join lateral (
      select
        array_agg(ps.id::text order by ps.created_at,ps.id) as schedule_ids,
        case when bool_and(ps.status='published') then 'published' when bool_or(ps.status='failed') then 'failed' else 'waiting' end as status,
        string_agg(distinct p.name,'، ') as platform_name,
        string_agg(distinct pt.name,'، ') as post_type_name
      from marketing.publish_schedule ps
      left join marketing.platforms p on p.id=ps.platform_id
      left join marketing.platform_post_types pt on pt.id=ps.post_type_id
      where schedule_row.group_id is not null and ps.group_id=schedule_row.group_id
    ) aggregate_data on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('platformId',grouped.platform_id,'postTypeIds',grouped.post_type_ids) order by grouped.platform_name) as platforms
      from (
        select ps.platform_id::text as platform_id,max(p.name) as platform_name,jsonb_agg(ps.post_type_id::text order by pt.name) as post_type_ids
        from marketing.publish_schedule ps
        left join marketing.platforms p on p.id=ps.platform_id
        left join marketing.platform_post_types pt on pt.id=ps.post_type_id
        where schedule_row.group_id is not null and ps.group_id=schedule_row.group_id
        group by ps.platform_id
      ) grouped
    ) platform_data on true
    left join lateral (
      select ps.publish_options->'youtube' as youtube_options
      from marketing.publish_schedule ps
      join marketing.platforms yp on yp.id=ps.platform_id and lower(yp.code)='youtube'
      where schedule_row.group_id is not null and ps.group_id=schedule_row.group_id
      order by ps.updated_at desc,ps.created_at desc,ps.id desc
      limit 1
    ) youtube_data on true
    left join lateral (
      select coalesce(jsonb_agg(jsonb_build_object(
        'scheduleId',latest.schedule_id,
        'platformName',latest.platform_name,
        'postTypeName',latest.post_type_name,
        'error',latest.error
      ) order by latest.platform_name,latest.post_type_name),'[]'::jsonb) as publish_errors
      from (
        select distinct on (pl.schedule_id)
          pl.schedule_id::text as schedule_id,pl.status,pl.error,p.name as platform_name,pt.name as post_type_name,pl.created_at
        from marketing.publish_logs pl
        join marketing.publish_schedule eps on eps.id=pl.schedule_id
        left join marketing.platforms p on p.id=eps.platform_id
        left join marketing.platform_post_types pt on pt.id=eps.post_type_id
        where schedule_row.group_id is not null and eps.group_id=schedule_row.group_id
        order by pl.schedule_id,pl.created_at desc,pl.id desc
      ) latest
      where latest.status='failed' and nullif(latest.error,'') is not null
    ) error_data on true
    left join marketing.departments d on d.id=t.department_id
    left join core.users u on u.id=t.assigned_to
    left join marketing.task_templates tt on tt.id=t.task_template_id
    left join marketing.files f on f.id=t.final_file_id
    left join lateral (
      select count(*)::int as file_count,min(gf.original_name) filter(where gf.order_index=0) as primary_name,
        jsonb_agg(jsonb_build_object('id',gf.id::text,'name',gf.original_name,'mimeType',gf.mime_type,'size',gf.file_size,'orderIndex',gf.order_index) order by gf.order_index,gf.created_at) as files
      from marketing.files gf
      where t.final_media_group_id is not null and gf.final_media_group_id=t.final_media_group_id and gf.status='ready'
    ) fm on true
    where t.task_kind in ('execution','manual_publish')
      and t.is_deleted=false
      and t.publish_prep_removed_at is null
      and (
        (t.source_type='campaign' and cam.id is not null and cam.is_deleted=false and cam.archived_at is null)
        or (t.source_type='agenda' and ag.id is not null and ag.archived_at is null)
        or (t.source_type='manual' and t.task_kind='manual_publish')
      )
      and (
        ${unrestricted}=true
        or t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid
        or (${departmentScoped}=true and exists(select 1 from core.user_departments ud join core.departments cd on cd.id=ud.department_id where ud.user_id in(t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)}))
        or (${createdByMe}=true and (cam.created_by=${user.id}::uuid or ag.created_by=${user.id}::uuid))
      )
    order by coalesce(schedule_row.publish_date,t.due_at::date,cam.publish_start,ag.publish_start),t.created_at,t.id
  `;
  return{ok:true,rows,youtubeDefaults:await getYouTubePublishSettings(sql)};
}
type PublishScheduleCombination={
  platformId:string;
  postTypeId:string;
  platformCode:string;
  postTypeName:string;
  publishFormat:MarketingPublishFormat;
};

type NormalizedPublishScheduleRequest={
  publishDate:string;
  normalizedPlatforms:Array<{platformId:string;postTypeIds:string[]}>;
  combinations:PublishScheduleCombination[];
  youtubeOptions:ReturnType<typeof normalizeYouTubePublishOptions>;
};

async function normalizePublishScheduleRequest(sql:ReturnType<typeof getSql>,body:any):Promise<NormalizedPublishScheduleRequest>{
  const publishDate=isoDate(body.publishDate);
  if(!publishDate)throw new Error("تاريخ النشر مطلوب");
  const normalizedPlatforms=arrayValue(body.platforms).map((platform:any)=>({
    platformId:clean(platform?.platformId),
    postTypeIds:[...new Set(arrayValue<string>(platform?.postTypeIds).map(clean).filter(Boolean))],
  })).filter((platform:any)=>platform.platformId);
  if(normalizedPlatforms.some((platform:any)=>!platform.postTypeIds.length))throw new Error("حدد نوع نشر لكل منصة مختارة");

  const requestedPairs=normalizedPlatforms.flatMap((platform:any)=>platform.postTypeIds.map((postTypeId:string)=>({platformId:platform.platformId,postTypeId})));
  if(!requestedPairs.length){
    const platformId=clean(body.platformId),postTypeId=clean(body.postTypeId);
    if(platformId&&postTypeId)requestedPairs.push({platformId,postTypeId});
  }
  const uniquePairKeys=new Set<string>();
  const uniquePairs=requestedPairs.filter((item:any)=>{
    const key=`${item.platformId}:${item.postTypeId}`;
    if(uniquePairKeys.has(key))return false;
    uniquePairKeys.add(key);
    return true;
  });
  if(!uniquePairs.length)throw new Error("اختر منصة ونوع نشر واحدًا على الأقل");

  const requestedPostTypeIds=[...new Set(uniquePairs.map((item:any)=>item.postTypeId))];
  const postTypeRows=await sql<any[]>`
    select pt.id::text,pt.platform_id::text,pt.name,pt.width,pt.height,lower(p.code) as platform_code
    from marketing.platform_post_types pt
    join marketing.platforms p on p.id=pt.platform_id and p.is_active=true
    where pt.id in ${sql(requestedPostTypeIds)} and pt.is_active=true
  `;
  const postTypeById=new Map(postTypeRows.map((row:any)=>[clean(row.id),row]));
  const combinations=uniquePairs.map((item:any)=>{
    const postType=postTypeById.get(item.postTypeId);
    if(!postType||clean(postType.platform_id)!==item.platformId)throw new Error("نوع النشر المحدد لا يتبع المنصة المختارة أو غير مفعّل");
    return{
      platformId:item.platformId,
      postTypeId:item.postTypeId,
      platformCode:clean(postType.platform_code),
      postTypeName:clean(postType.name),
      publishFormat:normalizeMarketingPublishFormat(postType.name),
    } as PublishScheduleCombination;
  });

  const youtubeSelected=combinations.some((item)=>item.platformCode==='youtube');
  const youtubeDefaults=await getYouTubePublishSettings(sql);
  const youtubeOptions=normalizeYouTubePublishOptions(body.youtubeOptions,youtubeDefaults,{
    title:clean(body.youtubeTitle)||clean(body.caption),
    description:[clean(body.caption),clean(body.hashtags)].filter(Boolean).join("\n\n"),
  });
  if(youtubeSelected){
    if(!youtubeOptions.title)throw new Error("عنوان فيديو YouTube مطلوب");
    if([...youtubeOptions.title].length>100)throw new Error("عنوان YouTube يجب ألا يتجاوز 100 حرف");
    if(Buffer.byteLength(youtubeOptions.description,'utf8')>5000)throw new Error("وصف YouTube يجب ألا يتجاوز 5000 بايت");
    if(youtubeOptions.tags.join(',').length>500)throw new Error("كلمات YouTube المفتاحية تتجاوز 500 حرف");
    if(!youtubeOptions.categoryId)throw new Error("تصنيف فيديو YouTube مطلوب");
  }
  return{publishDate,normalizedPlatforms,combinations,youtubeOptions};
}

async function activePublishTask(sql:ReturnType<typeof getSql>,taskId:string,allowedKinds:string[]){
  const[task]=await sql<any[]>`
    select t.id::text,t.source_type,t.source_id::text,t.creative_id::text,t.task_kind,t.assigned_to::text
    from marketing.tasks t
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id
    left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    where t.id=${taskId}::uuid and t.task_kind in ${sql(allowedKinds)} and t.is_deleted=false and t.publish_prep_removed_at is null
      and (
        (t.source_type='campaign' and cam.id is not null and cam.is_deleted=false and cam.archived_at is null)
        or (t.source_type='agenda' and ag.id is not null and ag.archived_at is null)
        or (t.source_type='manual' and t.task_kind='manual_publish')
      )
    limit 1
  `;
  return task;
}

async function assertPublishEntryAccess(sql:ReturnType<typeof getSql>,user:SessionUser,entry:any){
  if(clean(entry?.source_type)==='manual'){
    const taskId=clean(entry?.task_id||entry?.id);
    if(!taskId||!await canAccessMarketingTask(sql,user,taskId))throw new Error("لا توجد صلاحية للوصول إلى هذا النشر اليدوي");
    return;
  }
  await assertMarketingEntityAccess(sql,user,clean(entry?.source_type),clean(entry?.source_id));
}

async function replacePublishScheduleGroup(tx:any,input:{
  groupId:string;
  task:any;
  request:NormalizedPublishScheduleRequest;
  caption:string;
  hashtags:string;
}){
  await tx`delete from marketing.publish_schedule where group_id=${input.groupId}::uuid`;
  const youtubePublishOptions={youtube:input.request.youtubeOptions};
  for(const item of input.request.combinations){
    const publishOptions=item.platformCode==='youtube'
      ?{...youtubePublishOptions,format:item.publishFormat}
      :{format:item.publishFormat};
    await tx`
      insert into marketing.publish_schedule(
        group_id,source_type,source_id,creative_id,task_id,publish_date,
        platform_id,post_type_id,caption,hashtags,publish_options,status
      ) values(
        ${input.groupId}::uuid,${input.task.source_type},${input.task.source_id}::uuid,
        ${input.task.creative_id}::uuid,${input.task.id}::uuid,${input.request.publishDate},
        ${item.platformId}::uuid,${item.postTypeId}::uuid,${input.caption||null},${input.hashtags||null},
        ${tx.json(dbJson(publishOptions))},'waiting'
      )
    `;
  }
}

function manualPublishFileDescriptors(value:unknown){
  return arrayValue<any>(value).map((item,index)=>({
    name:clean(item?.name)||`file-${index+1}`,
    original_name:clean(item?.name)||`file-${index+1}`,
    mimeType:clean(item?.mimeType)||'application/octet-stream',
    mime_type:clean(item?.mimeType)||'application/octet-stream',
    size:Math.max(0,numberValue(item?.size)),
    file_size:Math.max(0,numberValue(item?.size)),
    orderIndex:index,
  }));
}

function validateManualPublishFiles(files:any[],combinations:PublishScheduleCombination[]){
  if(!files.length)throw new Error("اختر ملفًا واحدًا على الأقل للنشر اليدوي");
  if(files.length>30)throw new Error("الحد الأقصى 30 صورة داخل دفعة النشر الواحدة");
  const isVideo=(item:any)=>looksVideo(item);
  const isImage=(item:any)=>item.mime_type.startsWith('image/')||/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(item.original_name);
  if(files.some((item)=>!isVideo(item)&&!isImage(item)))throw new Error("ملفات النشر اليدوي يجب أن تكون صورًا أو فيديو");
  const videoCount=files.filter(isVideo).length;
  if(videoCount&&files.length!==1)throw new Error("الفيديو أو الريل يُرفع كملف واحد فقط. بوست الصور والستوري يدعمان عدة صور بالترتيب");
  if(files.some((item)=>item.file_size<=0))throw new Error("يوجد ملف فارغ ضمن الاختيار");
  for(const item of combinations){
    assertPublishMedia(item.platformCode,item.publishFormat,files);
    if(item.platformCode==='instagram'&&['photo_post','carousel','post'].includes(item.publishFormat)&&files.length>10){
      throw new Error("بوست الصور المتعدد على Instagram يدعم حتى 10 صور في المنشور الواحد");
    }
  }
}

async function savePublishPrep(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!hasPermission(user,"marketing.publish_prep.manage"))throw new Error("لا توجد صلاحية لإدارة تجهيز النشر");
  const id=clean(body.id),requestedTaskId=clean(body.taskId);
  const[current]=id?await sql<any[]>`select * from marketing.publish_schedule where group_id=${id}::uuid or id=${id}::uuid order by updated_at desc,created_at desc limit 1`:[];
  const taskId=requestedTaskId||clean(current?.task_id);
  if(!taskId)throw new Error("التاسك التنفيذي المرتبط غير موجود");
  const publishTask=await activePublishTask(sql,taskId,['execution','manual_publish']);
  if(!publishTask)throw new Error("تجهيز النشر المرتبط غير موجود أو لم يعد متاحًا");
  await assertPublishEntryAccess(sql,user,publishTask);
  const request=await normalizePublishScheduleRequest(sql,body);
  const groupId=clean(current?.group_id)||clean((await sql<any[]>`select gen_random_uuid()::text as id`)[0]?.id);
  if(!groupId)throw new Error("تعذر إنشاء مجموعة تجهيز النشر");
  const caption=clean(body.caption),hashtags=clean(body.hashtags);
  await sql.begin(async tx=>{
    await replacePublishScheduleGroup(tx,{groupId,task:publishTask,request,caption,hashtags});
    if(publishTask.task_kind==='manual_publish'){
      await tx`update marketing.tasks set due_at=${request.publishDate},approved_template_data=coalesce(approved_template_data,'{}'::jsonb)||${tx.json(dbJson({caption,hashtags}))},updated_at=now() where id=${publishTask.id}::uuid`;
      await tx`update marketing.creatives set platform_assignments=${tx.json(dbJson(request.normalizedPlatforms))},schedule_day=${request.publishDate},updated_at=now() where id=${publishTask.creative_id}::uuid`;
    }
  });
  return{ok:true,message:publishTask.task_kind==='manual_publish'?"تم تحديث تجهيز النشر اليدوي":"تم حفظ تجهيز النشر"};
}

async function createManualPublishEntry(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!hasPermission(user,"marketing.publish_prep.manage"))throw new Error("لا توجد صلاحية لإنشاء نشر يدوي");
  const creativeTypeId=clean(body.creativeTypeId);
  if(!creativeTypeId)throw new Error("اختر نوع الكرييتيف من قائمة الكرييتيفات");
  const request=await normalizePublishScheduleRequest(sql,body);
  const files=manualPublishFileDescriptors(body.files);
  validateManualPublishFiles(files,request.combinations);
  const caption=clean(body.caption),hashtags=clean(body.hashtags);
  if(!caption)throw new Error("الكابشن مطلوب");
  if(!hashtags)throw new Error("الهاشتاج مطلوب");

  return sql.begin(async tx=>{
    const[creativeType]=await tx<any[]>`
      select c.id::text,c.name,c.short_code,c.primary_department_id::text
      from marketing.creative_types c
      where c.id=${creativeTypeId}::uuid and c.is_active=true
    `;
    if(!creativeType)throw new Error("نوع الكرييتيف غير موجود أو غير مفعّل");
    const[ids]=await tx<any[]>`select gen_random_uuid()::text as creative_id,gen_random_uuid()::text as task_id,gen_random_uuid()::text as group_id`;
    if(!ids?.creative_id||!ids?.task_id||!ids?.group_id)throw new Error("تعذر إنشاء سجل النشر اليدوي");
    const sourceId=clean(ids.creative_id);
    const instanceCode=`MAN-${safeCode(creativeType.short_code)||'CREATIVE'}-${sourceId.replace(/-/g,'').slice(0,6).toUpperCase()}`;
    const manualNotes={
      manualPublish:true,
      standalone:true,
      createdBy:user.id,
      createdAt:new Date().toISOString(),
      caption,
      hashtags,
      sourceLabel:'نشر يدوي',
    };
    await tx`
      insert into marketing.creatives(
        id,campaign_id,agenda_id,creative_type,creative_type_id,quantity,status,instance_code,name,
        primary_department_id,platform_assignments,schedule_day,notes
      ) values(
        ${ids.creative_id}::uuid,null,null,${creativeType.name},${creativeTypeId}::uuid,1,'publishing',${instanceCode},${creativeType.name},
        ${creativeType.primary_department_id?tx`${creativeType.primary_department_id}::uuid`:null},
        ${tx.json(dbJson(request.normalizedPlatforms))},${request.publishDate},${tx.json(dbJson(manualNotes))}
      )
    `;
    const taskData={
      manualPublish:true,
      standalone:true,
      caption,
      hashtags,
      manualFiles:files.map((file)=>({name:file.name,mimeType:file.mimeType,size:file.size,orderIndex:file.orderIndex})),
    };
    await tx`
      insert into marketing.tasks(
        id,campaign_id,agenda_id,source_type,source_id,creative_id,department_code,department_id,
        assigned_to,task_kind,title,status,due_at,progress,received_at,completed_at,completed_by,
        note,approved_template_data
      ) values(
        ${ids.task_id}::uuid,null,null,'manual',${sourceId}::uuid,${ids.creative_id}::uuid,'publishing',
        ${creativeType.primary_department_id?tx`${creativeType.primary_department_id}::uuid`:null},
        ${user.id}::uuid,'manual_publish',${`${creativeType.name} - نشر يدوي`},'completed',${request.publishDate},100,
        now(),now(),${user.id}::uuid,'تم إنشاؤه من شاشة النشر اليدوي المستقل',${tx.json(dbJson(taskData))}
      )
    `;
    const task={id:ids.task_id,source_type:'manual',source_id:sourceId,creative_id:ids.creative_id};
    await replacePublishScheduleGroup(tx,{groupId:ids.group_id,task,request,caption,hashtags});
    return{
      ok:true,
      id:ids.group_id,
      groupId:ids.group_id,
      taskId:ids.task_id,
      creativeId:ids.creative_id,
      sourceType:'manual',
      sourceId,
      sourceName:'نشر يدوي',
      creativeTypeName:creativeType.name,
      message:"تم إنشاء تجهيز النشر اليدوي المستقل وجارٍ رفع الملفات",
    };
  });
}

async function discardManualPublishEntry(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!hasPermission(user,"marketing.publish_prep.manage"))throw new Error("لا توجد صلاحية لإلغاء النشر اليدوي");
  const taskId=clean(body.taskId);
  if(!taskId)return{ok:true,message:"لا توجد مسودة نشر يدوي لإلغائها"};
  const[task]=await sql<any[]>`
    select id::text,source_type,source_id::text,creative_id::text,assigned_to::text
    from marketing.tasks
    where id=${taskId}::uuid and task_kind='manual_publish' and is_deleted=false
  `;
  if(!task)return{ok:true,message:"تم إلغاء مسودة النشر اليدوي مسبقًا"};
  await assertPublishEntryAccess(sql,user,{...task,task_id:task.id});
  const[published]=await sql<any[]>`select 1 from marketing.publish_schedule where task_id=${taskId}::uuid and status='published' limit 1`;
  if(published)throw new Error("لا يمكن إلغاء نشر يدوي تم نشره بالفعل");
  await sql.begin(async tx=>{
    await tx`delete from marketing.publish_logs where schedule_id in(select id from marketing.publish_schedule where task_id=${taskId}::uuid)`;
    await tx`delete from marketing.publish_schedule where task_id=${taskId}::uuid`;
    await tx`delete from marketing.zoho_upload_tickets where task_id=${taskId}::uuid`;
    await tx`delete from marketing.files where task_id=${taskId}::uuid`;
    await tx`delete from marketing.final_media_groups where task_id=${taskId}::uuid`;
    await tx`delete from marketing.tasks where id=${taskId}::uuid`;
    await tx`delete from marketing.creatives where id=${task.creative_id}::uuid and not exists(select 1 from marketing.tasks where creative_id=${task.creative_id}::uuid) and not exists(select 1 from marketing.publish_schedule where creative_id=${task.creative_id}::uuid)`;
  });
  return{ok:true,message:"تم إلغاء مسودة النشر اليدوي"};
}

async function removePublishPrepEntry(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!hasPermission(user,"marketing.publish_prep.manage"))throw new Error("لا توجد صلاحية لمسح تجهيز النشر");
  const taskId=clean(body.taskId);
  if(!taskId)throw new Error("تجهيز النشر المطلوب غير محدد");
  const[task]=await sql<any[]>`
    select t.id::text,t.source_type,t.source_id::text,t.creative_id::text,t.task_kind,t.assigned_to::text,t.publish_prep_removed_at
    from marketing.tasks t
    where t.id=${taskId}::uuid and t.task_kind in ('execution','manual_publish') and t.is_deleted=false
    limit 1
  `;
  if(!task)throw new Error("تجهيز النشر غير موجود");
  if(task.publish_prep_removed_at)return{ok:true,message:"تم مسح تجهيز النشر من القائمة مسبقًا"};
  await assertPublishEntryAccess(sql,user,{...task,task_id:task.id});
  await sql`
    update marketing.tasks
    set publish_prep_removed_at=now(),publish_prep_removed_by=${user.id}::uuid,updated_at=now()
    where id=${taskId}::uuid and publish_prep_removed_at is null
  `;
  return{
    ok:true,
    taskId,
    message:task.task_kind==='manual_publish'
      ?"تم مسح النشر اليدوي من صفحة تجهيز النشر"
      :"تم مسح التاسك من صفحة تجهيز النشر دون تغيير الحملة أو الأجندة",
  };
}

async function graphRequest(path:string,method:"GET"|"POST",token:string,params:Record<string,any>={}){const version=clean(process.env.META_GRAPH_VERSION)||"v25.0";const url=new URL(`https://graph.facebook.com/${version}${path}`);const body=new URLSearchParams();for(const[key,value]of Object.entries(params)){if(value===undefined||value===null||value==='')continue;const text=typeof value==='object'?JSON.stringify(value):String(value);if(method==='GET')url.searchParams.set(key,text);else body.set(key,text);}if(method==='GET')url.searchParams.set('access_token',token);else body.set('access_token',token);const response=await fetch(url.toString(),{method,body:method==='POST'?body:undefined});const payload=await response.json().catch(()=>({}));if(!response.ok||payload.error)throw new Error(payload.error?.message||`Meta API error ${response.status}`);return payload;}
async function graphFileRequest(path:string,token:string,file:{bytes:Uint8Array;mimeType:string;fileName:string},params:Record<string,any>={}){
  const version=clean(process.env.META_GRAPH_VERSION)||"v25.0";
  const form=new FormData();
  for(const[key,value]of Object.entries(params)){
    if(value===undefined||value===null||value==='')continue;
    form.append(key,typeof value==='object'?JSON.stringify(value):String(value));
  }
  form.append('access_token',token);
  const ownedBytes=new Uint8Array(file.bytes.byteLength);
  ownedBytes.set(file.bytes);
  form.append('source',new Blob([ownedBytes],{type:file.mimeType||'application/octet-stream'}),file.fileName||'media');
  const response=await fetch(`https://graph.facebook.com/${version}${path}`,{method:'POST',body:form});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||(payload as any).error)throw new Error((payload as any).error?.message||`Meta API error ${response.status}`);
  return payload;
}
function looksVideo(file:any){return /video|mp4|mov|webm/i.test(`${file?.mime_type||''} ${file?.original_name||''}`);}
async function uploadFacebookHostedVideo(uploadUrl:string,token:string,mediaUrl:string,kind:string){
  const response=await fetch(uploadUrl,{method:'POST',headers:{Authorization:`OAuth ${token}`,file_url:mediaUrl}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||(payload as any).error)throw new Error((payload as any).error?.message||`تعذر رفع فيديو ${kind} على Facebook (${response.status})`);
  return payload;
}
async function publishFacebookReel(pageId:string,token:string,mediaUrl:string,caption:string){
  const start=await graphRequest(`/${pageId}/video_reels`,'POST',token,{upload_phase:'start'});
  const videoId=clean(start.video_id||start.id),uploadUrl=clean(start.upload_url||start.uploadUrl);
  if(!videoId||!uploadUrl)throw new Error("تعذر بدء رفع Reel على Facebook");
  const upload=await uploadFacebookHostedVideo(uploadUrl,token,mediaUrl,'Reel');
  const publish=await graphRequest(`/${pageId}/video_reels`,'POST',token,{upload_phase:'finish',video_id:videoId,video_state:'PUBLISHED',description:caption});
  return{start,upload,publish,video_id:videoId};
}
function assertPublishMedia(platform:string,format:MarketingPublishFormat,files:any[]){
  const videos=files.filter(looksVideo),images=files.filter((file:any)=>!looksVideo(file));
  if(videos.length>1||(videos.length&&files.length>1))throw new Error("الفيديو أو الريل يجب أن يكون ملفًا واحدًا فقط");
  if(publishFormatRequiresVideo(format)&&(files.length!==1||videos.length!==1))throw new Error("نوع النشر المحدد يتطلب ملف فيديو واحدًا فقط");
  if(publishFormatRequiresImages(format)&&videos.length)throw new Error("نوع النشر المحدد يقبل صورًا فقط");
  if(format==='carousel'&&images.length<2)throw new Error("Carousel يتطلب صورتين على الأقل");
  if(platform==='instagram'&&format==='post'&&videos.length)throw new Error("بوست Instagram يقبل الصور فقط. اختر Reel لنشر الفيديو");
  if(platform==='youtube'&&(files.length!==1||videos.length!==1))throw new Error("نشر YouTube يتطلب ملف فيديو واحدًا فقط");
}
function youtubeOptionsForFormat(options:any,format:MarketingPublishFormat){
  if(format!=='short')return options;
  const marker=/#shorts\b/i;
  const title=clean(options.title);
  const description=clean(options.description);
  return{...options,description:marker.test(`${title} ${description}`)?description:[description,'#Shorts'].filter(Boolean).join("\n\n")};
}
async function finalMediaFilesForSchedule(sql:ReturnType<typeof getSql>,schedule:any){
  if(clean(schedule.final_media_group_id)){
    const[group]=await sql<any[]>`select file_count,status from marketing.final_media_groups where id=${schedule.final_media_group_id}::uuid`;
    const files=await sql<any[]>`
      select * from marketing.files
      where final_media_group_id=${schedule.final_media_group_id}::uuid and status='ready'
      order by order_index,created_at,id
    `;
    if(!group||group.status!=='ready'||files.length!==Number(group.file_count||0))throw new Error("لم يكتمل رفع كل ملفات النشر إلى Zoho WorkDrive");
    if(files.length)return files;
  }
  if(!clean(schedule.final_file_id))return[];
  const[file]=await sql<any[]>`select * from marketing.files where id=${schedule.final_file_id}::uuid and status='ready'`;
  return file?[file]:[];
}
async function finalMediaDeliveryUrl(sql:ReturnType<typeof getSql>,file:any){
  if(clean(file.storage_provider)==='zoho'){
    if(!clean(file.external_id))throw new Error(`معرف ملف Zoho ${clean(file.original_name)||''} غير موجود`);
    const info=await getZohoFileInfo(sql,clean(file.external_id));
    const url=clean(info.downloadUrl||info.permalink||file.external_url);
    if(!url)throw new Error(`تعذر تجهيز رابط ملف Zoho ${clean(file.original_name)||''}`);
    return url;
  }
  if(!clean(file.storage_key))throw new Error(`مسار الملف النهائي ${clean(file.original_name)||''} غير موجود`);
  return createDownloadUrl(file.storage_key,7200);
}
function detectImageMime(bytes:Uint8Array){
  if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a)return'image/png';
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return'image/jpeg';
  if(bytes.length>=6&&String.fromCharCode(...bytes.slice(0,6)) in {'GIF87a':1,'GIF89a':1})return'image/gif';
  if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return'image/webp';
  return'';
}
async function finalMediaBinary(sql:ReturnType<typeof getSql>,file:any){
  if(clean(file.storage_provider)!=='zoho')throw new Error(`النشر المباشر للملف ${clean(file.original_name)||''} غير مدعوم من مزود التخزين الحالي`);
  const externalId=clean(file.external_id);
  if(!externalId)throw new Error(`معرف ملف Zoho ${clean(file.original_name)||''} غير موجود`);
  const runtime=await getZohoRuntime(sql);
  const info=await getZohoFileInfo(sql,externalId);
  const downloadUrl=clean(info.downloadUrl)||`${runtime.uploadDomain}/v1/workdrive/download/${encodeURIComponent(externalId)}`;
  const response=await fetch(downloadUrl,{
    redirect:'follow',
    headers:{Authorization:`Zoho-oauthtoken ${runtime.accessToken}`,Accept:'application/octet-stream,*/*'},
  });
  if(!response.ok){
    const message=clean(await response.text().catch(()=>''));
    throw new Error(message||`تعذر تنزيل ملف Zoho ${clean(file.original_name)||''} (${response.status})`);
  }
  const contentType=clean(response.headers.get('content-type')).split(';')[0].trim().toLowerCase();
  if(contentType.includes('application/json')||contentType.includes('text/html')){
    throw new Error(`Zoho لم يرجع محتوى الملف الفعلي ${clean(file.original_name)||''}. أعد ربط Zoho بعد قبول صلاحية تنزيل الملفات`);
  }
  const arrayBuffer=await response.arrayBuffer();
  const bytes=new Uint8Array(arrayBuffer);
  if(!bytes.byteLength)throw new Error(`ملف Zoho ${clean(file.original_name)||''} فارغ`);
  const detectedMimeType=detectImageMime(bytes);
  if(!detectedMimeType){
    const signature=Array.from(bytes.slice(0,12)).map(value=>value.toString(16).padStart(2,'0')).join(' ');
    throw new Error(`محتوى ملف Zoho ${clean(file.original_name)||''} ليس صورة فعلية صالحة للنشر (نوع الاستجابة: ${contentType||'غير معروف'}، بصمة البداية: ${signature||'فارغة'})`);
  }
  const storedMimeType=clean(file.mime_type).toLowerCase();
  const mimeType=contentType.startsWith('image/')?contentType:(detectedMimeType||storedMimeType);
  return{bytes,mimeType,fileName:clean(file.original_name)||`image-${externalId}`};
}
async function publishScheduleItem(sql:ReturnType<typeof getSql>,schedule:any,user:SessionUser){
  if(!clean(schedule.publish_date))throw new Error("ميعاد النشر غير موجود");
  if(!clean(schedule.platform_code))throw new Error("منصة النشر غير محددة");
  if(!clean(schedule.post_type_name))throw new Error(`نوع النشر غير محدد لمنصة ${schedule.platform_name||schedule.platform_code}`);
  if(!clean(schedule.caption))throw new Error("الكابشن غير موجود");
  if(!clean(schedule.hashtags))throw new Error("الهاشتاج غير موجود");
  const[conn]=await sql<any[]>`select * from marketing.platform_connections where platform=${schedule.platform_code}`;
  if(!conn||!conn.connected)throw new Error(`منصة ${schedule.platform_name||schedule.platform_code} غير مربوطة`);
  const files=await finalMediaFilesForSchedule(sql,schedule);
  if(!files.length)throw new Error("الملف النهائي غير موجود");
  const publishOptions=objectValue(schedule.publish_options);
  const publishFormat=normalizeMarketingPublishFormat(publishOptions.format||schedule.post_type_name);
  assertPublishMedia(clean(schedule.platform_code),publishFormat,files);
  const file=files[0],caption=[clean(schedule.caption),clean(schedule.hashtags)].filter(Boolean).join("\n\n"),multipleImages=files.length>1;
  let result:any;

  if(schedule.platform_code==='facebook'){
    const pageId=clean(conn.page_id),token=decryptPlatformToken(conn.page_access_token_encrypted||conn.access_token_encrypted||conn.user_access_token_encrypted);
    if(!pageId||!token)throw new Error("بيانات Facebook غير مكتملة");
    if(publishFormat==='story'){
      if(looksVideo(file)){
        const mediaUrl=await finalMediaDeliveryUrl(sql,file);
        const start=await graphRequest(`/${pageId}/video_stories`,'POST',token,{upload_phase:'start'});
        const videoId=clean(start.video_id||start.id),uploadUrl=clean(start.upload_url||start.uploadUrl);
        if(!videoId||!uploadUrl)throw new Error("تعذر بدء رفع فيديو Story على Facebook");
        const upload=await uploadFacebookHostedVideo(uploadUrl,token,mediaUrl,'Story');
        const publish=await graphRequest(`/${pageId}/video_stories`,'POST',token,{upload_phase:'finish',video_id:videoId});
        result={start,upload,publish,video_id:videoId};
      }else{
        const stories=[];
        for(const storyFile of files){
          const binary=await finalMediaBinary(sql,storyFile);
          const photo=await graphFileRequest(`/${pageId}/photos`,token,binary,{published:false});
          const photoId=clean(photo.id||photo.photo_id);
          if(!photoId)throw new Error("تعذر رفع إحدى صور Story على Facebook");
          const publish=await graphRequest(`/${pageId}/photo_stories`,'POST',token,{photo_id:photoId});
          stories.push({upload:photo,publish,photo_id:photoId});
        }
        result={stories,publish:stories[0]?.publish,id:clean(stories[0]?.publish?.id),batchCount:stories.length};
      }
    }else if(publishFormat==='reel'||publishFormat==='short'){
      result=await publishFacebookReel(pageId,token,await finalMediaDeliveryUrl(sql,file),caption);
    }else if(publishFormat==='video'){
      result=await graphRequest(`/${pageId}/videos`,'POST',token,{file_url:await finalMediaDeliveryUrl(sql,file),description:caption});
    }else if(publishFormat==='photo_post'||publishFormat==='carousel'||multipleImages){
      if(multipleImages){
        const uploads=[];
        for(const imageFile of files){
          const binary=await finalMediaBinary(sql,imageFile);
          uploads.push(await graphFileRequest(`/${pageId}/photos`,token,binary,{published:false}));
        }
        const mediaIds=uploads.map((item:any)=>clean(item.id||item.photo_id)).filter(Boolean);
        if(mediaIds.length!==files.length)throw new Error("تعذر تجهيز كل صور المنشور على Facebook");
        const publish=await graphRequest(`/${pageId}/feed`,'POST',token,{message:caption,attached_media:mediaIds.map((media_fbid:string)=>({media_fbid}))});
        result={uploads,publish};
      }else{
        result=await graphFileRequest(`/${pageId}/photos`,token,await finalMediaBinary(sql,file),{caption,published:true});
      }
    }else if(looksVideo(file)){
      result=await graphRequest(`/${pageId}/videos`,'POST',token,{file_url:await finalMediaDeliveryUrl(sql,file),description:caption});
    }else{
      result=await graphFileRequest(`/${pageId}/photos`,token,await finalMediaBinary(sql,file),{caption,published:true});
    }
  }else if(schedule.platform_code==='instagram'){
    const igId=clean(conn.ig_user_id||conn.account_id),token=decryptPlatformToken(conn.page_access_token_encrypted||conn.access_token_encrypted||conn.user_access_token_encrypted);
    if(!igId||!token)throw new Error("بيانات Instagram غير مكتملة");
    result=await publishInstagramContent(sql,{
      igId,
      token,
      caption,
      format:publishFormat,
      files,
    });
  }else if(schedule.platform_code==='youtube'){
    if(!['video','short','post'].includes(publishFormat))throw new Error("YouTube يقبل فيديو أو Shorts فقط");
    const youtubeDefaults=await getYouTubePublishSettings(sql);
    const youtubeOptions=youtubeOptionsForFormat(normalizeYouTubePublishOptions(publishOptions.youtube,youtubeDefaults,{title:clean(schedule.caption),description:caption}),publishFormat);
    if(!youtubeOptions.title)throw new Error("عنوان فيديو YouTube مطلوب");
    if([...youtubeOptions.title].length>100)throw new Error("عنوان YouTube يجب ألا يتجاوز 100 حرف");
    if(Buffer.byteLength(youtubeOptions.description,'utf8')>5000)throw new Error("وصف YouTube يجب ألا يتجاوز 5000 بايت");
    if(youtubeOptions.tags.join(',').length>500)throw new Error("كلمات YouTube المفتاحية تتجاوز 500 حرف");
    if(!youtubeOptions.categoryId)throw new Error("تصنيف فيديو YouTube مطلوب");
    if(!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(youtubeOptions.defaultLanguage))throw new Error("لغة فيديو YouTube غير صالحة");
    result=await publishYouTubeVideo(sql,file,youtubeOptions);
  }else throw new Error("المنصة غير مدعومة");

  result={...objectValue(result),publishFormat,postTypeName:clean(schedule.post_type_name)};
  await sql.begin(async tx=>{
    await tx`update marketing.publish_schedule set status='published',published_at=now(),publish_result=${tx.json(dbJson(result))},updated_at=now() where id=${schedule.id}::uuid`;
    await tx`insert into marketing.publish_logs(schedule_id,platform,status,result,published_by) values(${schedule.id}::uuid,${schedule.platform_code},'published',${tx.json(dbJson(result))},${user.id}::uuid)`;
  });
  await recordPublishedPost(sql,schedule,result).catch((error)=>console.error('Failed to register published post for engagement',error));
  return result;
}
async function publishNow(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!hasPermission(user,"marketing.publish.now"))throw new Error("لا توجد صلاحية للنشر الفعلي");
  const ids=arrayValue<string>(body.ids).map(clean).filter(Boolean);
  if(!ids.length)throw new Error("حدد تاسكات النشر");
  const results=[];
  for(const id of ids){
    const[schedule]=await sql<any[]>`
      select s.*,s.id::text,p.code as platform_code,p.name as platform_name,pt.name as post_type_name,
        coalesce(direct_task.final_file_id,fallback_task.final_file_id)::text as final_file_id,
        coalesce(direct_task.final_media_group_id,fallback_task.final_media_group_id)::text as final_media_group_id,
        direct_task.publish_prep_removed_at
      from marketing.publish_schedule s
      join marketing.platforms p on p.id=s.platform_id
      left join marketing.platform_post_types pt on pt.id=s.post_type_id
      left join marketing.tasks direct_task on direct_task.id=s.task_id
      left join lateral(
        select x.final_file_id,x.final_media_group_id from marketing.tasks x
        where s.task_id is null and x.creative_id=s.creative_id and x.task_kind='execution' and (x.final_file_id is not null or x.final_media_group_id is not null) and x.is_deleted=false and x.publish_prep_removed_at is null
        order by x.updated_at desc limit 1
      )fallback_task on true
      where s.id=${id}::uuid
    `;
    if(!schedule){results.push({id,ok:false,error:"تاسك النشر غير موجود",platformName:"منصة غير معروفة",postTypeName:""});continue;}
    try{
      if(schedule.publish_prep_removed_at)throw new Error("تم مسح تجهيز النشر من القائمة ولا يمكن نشره");
      await assertPublishEntryAccess(sql,user,schedule);
      const result=await publishScheduleItem(sql,schedule,user);
      results.push({id,ok:true,result,platform:schedule.platform_code,platformName:schedule.platform_name,postTypeName:schedule.post_type_name});
    }catch(error:any){
      const errorMessage=clean(error?.message)||"تعذر تنفيذ النشر بدون تفاصيل إضافية";
      await sql.begin(async tx=>{
        await tx`update marketing.publish_schedule set status='failed',publish_result=${tx.json(dbJson({error:errorMessage,failedAt:new Date().toISOString()}))},updated_at=now() where id=${id}::uuid`;
        await tx`insert into marketing.publish_logs(schedule_id,platform,status,error,published_by) values(${id}::uuid,${schedule.platform_code||''},'failed',${errorMessage},${user.id}::uuid)`;
      });
      results.push({id,ok:false,error:errorMessage,platform:schedule.platform_code,platformName:schedule.platform_name,postTypeName:schedule.post_type_name});
    }
  }
  return{ok:true,results,message:"تم تنفيذ طلب النشر"};
}
async function saveResultFile(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){if(!hasPermission(user,"marketing.file.upload"))throw new Error("لا توجد صلاحية لرفع ملف النتائج");const sourceType=clean(body.sourceType),id=clean(body.id),fileId=clean(body.fileId);await assertMarketingEntityAccess(sql,user,sourceType,id);if(sourceType==='agenda')await sql`update marketing.agendas set result_file_id=${fileId}::uuid,updated_at=now() where id=${id}::uuid`;else await sql`update marketing.campaigns set result_file_id=${fileId}::uuid,updated_at=now() where id=${id}::uuid`;return{ok:true,message:"تم حفظ ملف النتائج"};}
async function saveLinks(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){const sourceType=clean(body.sourceType),permission=sourceType==='agenda'?"marketing.agenda.edit":"marketing.campaign.edit";if(!hasPermission(user,permission))throw new Error("لا توجد صلاحية لتعديل الروابط");const id=clean(body.id),links=arrayValue(body.links).filter((item:any)=>clean(item.platform)&&clean(item.url));await assertMarketingEntityAccess(sql,user,sourceType,id);if(sourceType==='agenda')await sql`update marketing.agendas set links=${sql.json(dbJson(links))},updated_at=now() where id=${id}::uuid`;else await sql`update marketing.campaigns set links=${sql.json(dbJson(links))},updated_at=now() where id=${id}::uuid`;return{ok:true,message:"تم حفظ روابط الحملة"};}
async function archiveEntity(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){if(!hasPermission(user,"marketing.campaign.archive"))throw new Error("لا توجد صلاحية لأرشفة الحملة");const sourceType=clean(body.sourceType),id=clean(body.id);await assertMarketingEntityAccess(sql,user,sourceType,id);const[entity]=sourceType==='agenda'?await sql<any[]>`select result_file_id::text,links from marketing.agendas where id=${id}::uuid`:await sql<any[]>`select result_file_id::text,links from marketing.campaigns where id=${id}::uuid`;if(!entity)throw new Error("السجل غير موجود");const missing=[];if(!entity.result_file_id)missing.push("ملف نتائج الحملة");if(!arrayValue(entity.links).length)missing.push("روابط الحملة");if(missing.length)throw new Error(`لا يمكن أرشفة الحملة. الناقص: ${missing.join(" + ")}`);if(sourceType==='agenda')await sql`update marketing.agendas set archived_at=now(),archived_by=${user.id}::uuid,status='archived',updated_at=now() where id=${id}::uuid`;else await sql`update marketing.campaigns set archived_at=now(),archived_by=${user.id}::uuid,status='archived',updated_at=now() where id=${id}::uuid`;return{ok:true,message:"تمت الأرشفة"};}
async function deleteEntity(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){const sourceType=clean(body.sourceType),id=clean(body.id);const permission=sourceType==='agenda'?'marketing.agenda.delete':'marketing.campaign.delete';if(!hasPermission(user,permission))throw new Error("لا توجد صلاحية لمسح السجل");await assertMarketingEntityAccess(sql,user,sourceType,id);if(sourceType==='agenda')await sql`delete from marketing.agendas where id=${id}::uuid`;else await sql`update marketing.campaigns set is_deleted=true,updated_at=now() where id=${id}::uuid`;return{ok:true,message:"تم المسح"};}

async function monitoring(sql:ReturnType<typeof getSql>,user:SessionUser){
  const access=marketingAccess(user),unrestricted=access.dataScope==='all',createdByMe=access.dataScope==='created_by_me',departmentScoped=['department','departments','branch_and_department'].includes(access.dataScope),departmentCodes=marketingDepartmentCodes(user);
  const liveSourceFilter=sql`(
    (t.source_type='campaign' and exists(
      select 1 from marketing.campaigns source_campaign
      where source_campaign.id=t.source_id and source_campaign.is_deleted=false and source_campaign.archived_at is null
    ))
    or
    (t.source_type='agenda' and exists(
      select 1 from marketing.agendas source_agenda
      where source_agenda.id=t.source_id and source_agenda.archived_at is null
    ))
  )`;
  const accessTaskFilter=unrestricted?sql`true`:sql`(t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid or (${departmentScoped}=true and exists(select 1 from core.user_departments ud join core.departments cd on cd.id=ud.department_id where ud.user_id in(t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)})) or (${createdByMe}=true and (exists(select 1 from marketing.campaigns c where t.source_type='campaign' and c.id=t.source_id and c.created_by=${user.id}::uuid) or exists(select 1 from marketing.agendas a where t.source_type='agenda' and a.id=t.source_id and a.created_by=${user.id}::uuid))))`;
  const taskFilter=sql`(t.task_kind in ('task_template','execution') and ${liveSourceFilter} and ${accessTaskFilter})`;
  const[totals,statuses,delayed,employees,departments,entities]=await Promise.all([
    sql<any[]>`with visible_tasks as(select t.* from marketing.tasks t where t.is_deleted=false and ${taskFilter}) select count(distinct source_id) filter(where source_type='campaign')::int as campaigns,count(distinct source_id) filter(where source_type='campaign' and status<>'archived')::int as active_campaigns,count(distinct source_id) filter(where source_type='agenda')::int as agendas,count(*)::int as tasks,count(*) filter(where due_at<now() and progress<100)::int as delayed,count(*) filter(where progress=0)::int as waiting,count(*) filter(where progress>0 and progress<100)::int as active,coalesce(avg(progress),0)::float as progress from visible_tasks`,
    sql<any[]>`select t.status,count(*)::int as count from marketing.tasks t where t.is_deleted=false and ${taskFilter} group by t.status order by count(*) desc`,
    sql<any[]>`select t.id::text,t.title,t.due_at,t.progress::float,u.full_name,d.name as department_name,coalesce(cam.name,ag.name) as source_name,greatest(0,current_date-t.due_at::date)::int as delay_days from marketing.tasks t left join core.users u on u.id=t.assigned_to left join marketing.departments d on d.id=t.department_id left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id where t.is_deleted=false and ${taskFilter} and t.due_at<now() and t.progress<100 order by t.due_at`,
    sql<any[]>`select u.id::text,u.full_name,count(t.id)::int as tasks,coalesce(avg(t.progress),0)::float as progress,count(*) filter(where t.due_at<now() and t.progress<100)::int as delayed,coalesce(sum(greatest(0,current_date-t.due_at::date)) filter(where t.due_at<now() and t.progress<100),0)::int as delay_days from core.users u join marketing.tasks t on t.assigned_to=u.id and t.is_deleted=false and ${taskFilter} group by u.id order by progress desc`,
    sql<any[]>`select d.id::text,d.name,count(t.id)::int as tasks,coalesce(avg(t.progress),0)::float as progress from marketing.departments d left join marketing.tasks t on t.department_id=d.id and t.is_deleted=false and ${taskFilter} where d.is_active=true group by d.id having count(t.id)>0 order by d.name`,
    sql<any[]>`select 'campaign' as source_type,c.id::text,c.name,c.progress::float,c.status from marketing.campaigns c where c.is_deleted=false and c.archived_at is null and (${unrestricted}=true or (${createdByMe}=true and c.created_by=${user.id}::uuid) or exists(select 1 from marketing.tasks t where t.source_type='campaign' and t.source_id=c.id and t.is_deleted=false and ${taskFilter})) union all select 'agenda',a.id::text,a.name,a.progress::float,a.status from marketing.agendas a where a.archived_at is null and (${unrestricted}=true or (${createdByMe}=true and a.created_by=${user.id}::uuid) or exists(select 1 from marketing.tasks t where t.source_type='agenda' and t.source_id=a.id and t.is_deleted=false and ${taskFilter})) order by progress desc`
  ]);
  return{ok:true,totals:totals[0]||{},statuses,delayed,employees,departments,entities};
}
async function calendarData(sql:ReturnType<typeof getSql>,user:SessionUser){
  const access=marketingAccess(user),unrestricted=access.dataScope==='all',createdByMe=access.dataScope==='created_by_me',departmentScoped=['department','departments','branch_and_department'].includes(access.dataScope),departmentCodes=marketingDepartmentCodes(user);
  const rows=await sql<any[]>`
    select
      min(s.id::text) as id,
      s.publish_date,
      max(s.status) as status,
      t.source_type,
      p.name as platform_name,
      string_agg(distinct pt.name,'، ' order by pt.name) as post_type_name,
      c.name as creative_name,
      c.instance_code,
      coalesce(cam.name,ag.name) as source_name,
      t.id::text as task_id,
      t.title as task_title,
      u.full_name as assigned_name,
      coalesce(uc.color,'#6c3329') as user_color
    from marketing.publish_schedule s
    join marketing.tasks t on t.id=s.task_id and t.task_kind in ('execution','manual_publish') and t.is_deleted=false
    left join marketing.platforms p on p.id=s.platform_id
    left join marketing.platform_post_types pt on pt.id=s.post_type_id
    left join marketing.creatives c on c.id=s.creative_id
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id
    left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    left join core.users u on u.id=t.assigned_to
    left join marketing.user_colors uc on uc.user_id=u.id
    where (
      (t.source_type='campaign' and cam.id is not null and cam.is_deleted=false and cam.archived_at is null)
      or (t.source_type='agenda' and ag.id is not null and ag.archived_at is null)
    ) and (
      ${unrestricted}=true
      or t.assigned_to=${user.id}::uuid
      or t.paired_content_user_id=${user.id}::uuid
      or (${departmentScoped}=true and exists(
        select 1 from core.user_departments ud
        join core.departments cd on cd.id=ud.department_id
        where ud.user_id in(t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)}
      ))
      or (${createdByMe}=true and (cam.created_by=${user.id}::uuid or ag.created_by=${user.id}::uuid))
    )
    group by s.publish_date,t.source_type,p.name,c.name,c.instance_code,cam.name,ag.name,t.id,t.title,u.full_name,uc.color
    order by s.publish_date,coalesce(cam.name,ag.name),t.title,p.name
  `;
  return{ok:true,rows};
}
async function receiptCalendar(sql:ReturnType<typeof getSql>,user:SessionUser){
  const access=marketingAccess(user),unrestricted=access.dataScope==='all',createdByMe=access.dataScope==='created_by_me',departmentScoped=['department','departments','branch_and_department'].includes(access.dataScope),departmentCodes=marketingDepartmentCodes(user);
  const rows=await sql<any[]>`
    select
      t.id::text,
      t.received_at,
      t.source_type,
      t.task_kind,
      t.title,
      coalesce(cam.name,ag.name) as source_name,
      c.name as creative_name,
      c.instance_code,
      u.full_name,
      d.name as department_name,
      coalesce(uc.color,'#6c3329') as user_color
    from marketing.tasks t
    left join marketing.campaigns cam on t.source_type='campaign' and cam.id=t.source_id
    left join marketing.agendas ag on t.source_type='agenda' and ag.id=t.source_id
    left join marketing.creatives c on c.id=t.creative_id
    left join core.users u on u.id=t.assigned_to
    left join marketing.departments d on d.id=t.department_id
    left join marketing.user_colors uc on uc.user_id=u.id
    where t.received_at is not null and t.is_deleted=false and t.task_kind='execution'
      and (
        (t.source_type='campaign' and cam.id is not null and cam.is_deleted=false and cam.archived_at is null)
        or (t.source_type='agenda' and ag.id is not null and ag.archived_at is null)
      )
      and (
      ${unrestricted}=true
      or t.assigned_to=${user.id}::uuid
      or t.paired_content_user_id=${user.id}::uuid
      or (${departmentScoped}=true and exists(
        select 1 from core.user_departments ud
        join core.departments cd on cd.id=ud.department_id
        where ud.user_id in(t.assigned_to,t.paired_content_user_id) and cd.code in ${sql(departmentCodes)}
      ))
      or (${createdByMe}=true and (cam.created_by=${user.id}::uuid or ag.created_by=${user.id}::uuid))
    )
    order by t.received_at
  `;
  return{ok:true,rows};
}

async function attendanceData(sql:ReturnType<typeof getSql>,user:SessionUser,request:VercelRequest){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value=(type:string)=>parts.find((part)=>part.type===type)?.value||'';
  const todayKey=`${value('year')}-${value('month')}-${value('day')}`;
  const from=isoDate(request.query.from)||todayKey;
  const to=isoDate(request.query.to)||from;
  const departmentId=clean(request.query.departmentId);
  const requestedUserId=clean(request.query.userId);
  const userId=hasPermission(user,"marketing.attendance.manage")?requestedUserId:user.id;
  const status=clean(request.query.status);
  const [settings]=await sql<any[]>`select * from marketing.attendance_settings where singleton=true`;
  const today=await sql<any[]>`
    select u.id::text,u.full_name,
      string_agg(distinct d.name,'، ' order by d.name) as department_name,
      r.check_in,r.check_out,r.delay_minutes,r.work_minutes,r.status,
      coalesce(max(p.last_activity_at)>now()-interval '5 minutes',false) as online,
      max(p.last_activity_at) as last_activity_at,
      max(p.last_activity_type) as last_activity_type
    from core.users u
    join core.user_system_departments du on du.user_id=u.id and du.system_code='marketing'
    join marketing.departments d on d.id=du.department_id and d.is_active=true
    left join marketing.attendance_records r on r.user_id=u.id and r.attendance_date=(now() at time zone 'Asia/Riyadh')::date
    left join marketing.presence_status p on p.user_id=u.id
    where u.is_active=true and (${hasPermission(user,"marketing.attendance.manage")} or u.id=${user.id}::uuid)
    group by u.id,u.full_name,r.check_in,r.check_out,r.delay_minutes,r.work_minutes,r.status
    order by u.full_name`;
  const reportUsers=await sql<any[]>`
    select u.id::text,u.full_name,u.email,string_agg(distinct d.name,'، ' order by d.name) as department_name
    from core.users u
    join core.user_system_departments du on du.user_id=u.id and du.system_code='marketing'
    join marketing.departments d on d.id=du.department_id and d.is_active=true
    where u.is_active=true
      and (${departmentId}='' or exists(select 1 from core.user_system_departments fdu where fdu.user_id=u.id and fdu.system_code='marketing' and fdu.department_id=${departmentId||null}::uuid))
      and (${userId}='' or u.id=${userId||null}::uuid)
    group by u.id,u.full_name,u.email
    order by u.full_name`;
  const rawRows=await sql<any[]>`
    select r.*,r.id::text,r.user_id::text,r.attendance_date::text as attendance_date,u.full_name,
      string_agg(distinct d.name,'، ' order by d.name) as department_name
    from marketing.attendance_records r
    join core.users u on u.id=r.user_id
    left join core.user_system_departments du on du.user_id=u.id and du.system_code='marketing'
    left join marketing.departments d on d.id=du.department_id
    where r.attendance_date between ${from}::date and ${to}::date
      and (${departmentId}='' or exists(select 1 from core.user_system_departments fdu where fdu.user_id=u.id and fdu.system_code='marketing' and fdu.department_id=${departmentId||null}::uuid))
      and (${userId}='' or u.id=${userId||null}::uuid)
    group by r.id,u.id,u.full_name
    order by r.attendance_date desc,u.full_name`;
  const [effective]=await sql<any[]>`
    select min(r.attendance_date)::text as effective_from
    from marketing.attendance_records r
    where r.attendance_date between ${from}::date and ${to}::date
      and exists(select 1 from core.user_system_departments du where du.user_id=r.user_id and du.system_code='marketing')`;
  const effectiveFrom=clean(effective?.effective_from);
  const reportDays=effectiveFrom?datesBetween(effectiveFrom>from?effectiveFrom:from,to):[];
  const recordsByUserDay=new Map<string,any>();
  for(const row of rawRows)recordsByUserDay.set(`${row.user_id}:${clean(row.attendance_date).slice(0,10)}`,row);
  let summary=reportUsers.map((employee:any)=>{
    const records=reportDays.map((day)=>recordsByUserDay.get(`${employee.id}:${day}`)).filter(Boolean);
    const present=records.length;
    const absent=Math.max(0,reportDays.length-present);
    const lateCount=records.filter((row:any)=>numberValue(row.delay_minutes)>0).length;
    const lateTotal=records.reduce((sum:number,row:any)=>sum+numberValue(row.delay_minutes),0);
    const noCheckout=records.filter((row:any)=>row.check_in&&!row.check_out).length;
    const workTotal=records.reduce((sum:number,row:any)=>sum+numberValue(row.work_minutes),0);
    const employeeStatus=lateCount?'late':present&&noCheckout?'no_checkout':present&&absent?'partial':present?'present':'absent';
    return{user_id:employee.id,full_name:employee.full_name,email:employee.email,department_name:employee.department_name,status:employeeStatus,present,absent,late_count:lateCount,late_total:lateTotal,no_checkout:noCheckout,work_total:workTotal};
  });
  if(status==='present')summary=summary.filter((row:any)=>row.present>0);
  if(status==='late')summary=summary.filter((row:any)=>row.late_count>0);
  if(status==='absent')summary=summary.filter((row:any)=>row.absent>0);
  if(status==='no_checkout')summary=summary.filter((row:any)=>row.no_checkout>0);
  const includedUsers=new Set(summary.map((row:any)=>row.user_id));
  const rows:any[]=[];
  for(const employee of reportUsers){
    if(!includedUsers.has(employee.id))continue;
    for(const day of reportDays){
      const record=recordsByUserDay.get(`${employee.id}:${day}`);
      if(status==='absent'){
        if(!record)rows.push({id:`${employee.id}:${day}`,user_id:employee.id,attendance_date:day,full_name:employee.full_name,department_name:employee.department_name,status:'absent',check_in:null,check_out:null,delay_minutes:0,work_minutes:0});
        continue;
      }
      if(!record)continue;
      if(status==='late'&&numberValue(record.delay_minutes)<=0)continue;
      if(status==='no_checkout'&&(!record.check_in||record.check_out))continue;
      rows.push({...record,status:record.check_in&&!record.check_out?'no_checkout':numberValue(record.delay_minutes)>0?'late':'present'});
    }
  }
  rows.sort((a,b)=>String(b.attendance_date).localeCompare(String(a.attendance_date))||String(a.full_name).localeCompare(String(b.full_name),'ar'));
  const totals=summary.reduce((acc:any,row:any)=>({present:acc.present+row.present,absent:acc.absent+row.absent,lateCount:acc.lateCount+row.late_count,lateTotal:acc.lateTotal+row.late_total,noCheckout:acc.noCheckout+row.no_checkout,workTotal:acc.workTotal+row.work_total}),{present:0,absent:0,lateCount:0,lateTotal:0,noCheckout:0,workTotal:0});
  const [mine]=await sql<any[]>`select *,id::text from marketing.attendance_records where user_id=${user.id}::uuid and attendance_date=(now() at time zone 'Asia/Riyadh')::date`;
  return{ok:true,settings:settings||{},today,rows,summary,totals,effectiveFrom,mine:mine||null,canManage:hasPermission(user,"marketing.attendance.manage")};
}
async function attendanceAction(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const action=clean(body.attendanceAction);
  if(action==='ping'){
    await sql`insert into marketing.presence_status(user_id,online,last_activity_at,last_activity_type,updated_at) values(${user.id}::uuid,true,now(),${clean(body.activityType)||'فتح سيستم التسويق'},now()) on conflict(user_id) do update set online=true,last_activity_at=now(),last_activity_type=excluded.last_activity_type,updated_at=now()`;
    return{ok:true};
  }
  if(action==='save_settings'){
    if(!hasPermission(user,"marketing.attendance.manage"))throw new Error("لا توجد صلاحية لإدارة إعدادات الدوام");
    await sql`update marketing.attendance_settings set work_start=${clean(body.workStart)}::time,work_end=${clean(body.workEnd)}::time,grace_minutes=${Math.max(0,numberValue(body.graceMinutes))},updated_by=${user.id}::uuid,updated_at=now() where singleton=true`;
    return{ok:true,message:"تم حفظ إعدادات الدوام"};
  }
  if(action==='check_in'){
    const [row]=await sql<any[]>`
      with settings as(
        select
          coalesce((select work_start from marketing.attendance_settings where singleton=true),'09:00'::time) as work_start,
          coalesce((select grace_minutes from marketing.attendance_settings where singleton=true),15) as grace_minutes
      ), calculated as(
        select greatest(0,floor(extract(epoch from (((now() at time zone 'Asia/Riyadh')::time)-(work_start+(grace_minutes||' minutes')::interval)))/60))::int as delay_minutes from settings
      )
      insert into marketing.attendance_records(user_id,attendance_date,check_in,delay_minutes,status)
      select ${user.id}::uuid,(now() at time zone 'Asia/Riyadh')::date,now(),delay_minutes,case when delay_minutes>0 then 'late' else 'present' end from calculated
      on conflict(user_id,attendance_date) do update set
        check_in=coalesce(marketing.attendance_records.check_in,excluded.check_in),
        delay_minutes=case when marketing.attendance_records.check_in is null then excluded.delay_minutes else marketing.attendance_records.delay_minutes end,
        status=case when marketing.attendance_records.check_in is null then excluded.status else marketing.attendance_records.status end,
        updated_at=now()
      returning *,id::text`;
    if(!row?.id||!row?.check_in)throw new Error("تعذر تثبيت تسجيل الحضور، حاول مرة أخرى");
    return{ok:true,row,message:"تم تسجيل الحضور"};
  }
  if(action==='check_out'){
    const [row]=await sql<any[]>`update marketing.attendance_records set check_out=now(),work_minutes=greatest(0,floor(extract(epoch from (now()-check_in))/60))::int,status=case when status='late' then 'late' else 'present' end,updated_at=now() where user_id=${user.id}::uuid and attendance_date=(now() at time zone 'Asia/Riyadh')::date and check_in is not null returning *,id::text`;
    if(!row)throw new Error("يجب تسجيل الحضور أولًا");
    return{ok:true,row,message:"تم تسجيل الانصراف"};
  }
  throw new Error("إجراء الحضور غير صحيح");
}

async function stockData(sql:ReturnType<typeof getSql>,user:SessionUser){
  const requestAccessFilter=marketingAccess(user).dataScope==="all"||hasPermission(user,"marketing.photo_request.complete")?sql`true`:sql`r.requested_by=${user.id}::uuid`;
  const [cars,requests,locations]=await Promise.all([
    loadOperationsCars(sql),
    sql<any[]>`
      select r.id::text,r.request_no,r.status,r.requested_by::text,r.requested_by_name,r.requested_at,r.completed_at,r.photography_date,r.note,r.cancelled_at,
        sl.name as source_location_name,dl.name as destination_location_name,
        (r.requested_by=${user.id}::uuid and r.status='vehicle_received' and r.cancelled_at is null) as can_complete,
        coalesce((
          select json_agg(json_build_object(
            'vehicleId',v.id::text,
            'vin',v.vin,
            'carName',v.car_name,
            'statement',v.statement,
            'note',rv.item_note
          ) order by v.vin)
          from operations.transfer_request_vehicles rv
          join operations.vehicles v on v.id=rv.vehicle_id
          where rv.transfer_request_id=r.id
        ),'[]'::json) as vehicles,
        coalesce((
          select json_agg(json_build_object(
            'id',e.id::text,
            'stage',e.stage,
            'action',e.action,
            'note',e.note,
            'actorName',e.actor_name,
            'createdAt',e.created_at
          ) order by e.created_at)
          from operations.transfer_request_events e
          where e.transfer_request_id=r.id
        ),'[]'::json) as events
      from operations.transfer_requests r
      left join operations.locations sl on sl.id=r.source_location_id
      left join operations.locations dl on dl.id=r.destination_location_id
      where r.request_kind='photography' and r.is_deleted=false and ${requestAccessFilter}
      order by r.requested_at desc
    `,
    sql<any[]>`select id::text,code,name,branch_code from operations.locations where is_active=true order by sort_order,name`,
  ]);
  return{ok:true,cars,requests,locations};
}

async function markStockPhotographed(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  if(!hasPermission(user,"marketing.photo_request.complete"))throw new Error("لا توجد صلاحية لتحديث حالة التصوير");
  const vehicleIds=[...new Set(arrayValue<string>(body.vehicleIds).map(clean).filter(Boolean))];
  if(!vehicleIds.length)throw new Error("لم يتم تحديد سيارات لتحديث حالة التصوير");
  return sql.begin(async tx=>{
    const rows=await tx<any[]>`select id::text from operations.vehicles where id in ${tx(vehicleIds)} and is_deleted=false and archived_at is null for update`;
    if(rows.length!==vehicleIds.length)throw new Error("إحدى السيارات غير موجودة أو مؤرشفة");
    await tx`update operations.vehicles set photographed=true,photographed_at=now(),photographed_by=${user.id}::uuid,updated_at=now(),version=version+1 where id in ${tx(vehicleIds)} and coalesce(photographed,false)=false`;
    return{ok:true,message:vehicleIds.length===1?"تم تحديث السيارة إلى تم التصوير":`تم تحديث ${vehicleIds.length.toLocaleString("ar-SA-u-nu-latn")} سيارة إلى تم التصوير`};
  });
}

async function createPhotoRequest(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){
  const vehicles=arrayValue(body.vehicles).map((item:any)=>({vehicleId:clean(item.vehicleId),note:clean(item.note)})).filter((item:any)=>item.vehicleId);
  const destinationLocationId=clean(body.destinationLocationId);
  const photographyDate=isoDate(body.photographyDate);
  if(!vehicles.length)throw new Error("اختر سيارة واحدة على الأقل");
  if(!destinationLocationId)throw new Error("اختر المكان المستهدف");
  if(!photographyDate)throw new Error("اختر تاريخ التصوير");
  const uniqueIds=[...new Set(vehicles.map((item:any)=>item.vehicleId))];
  if(uniqueIds.length!==vehicles.length)throw new Error("لا يمكن اختيار السيارة نفسها أكثر من مرة");
  return sql.begin(async tx=>{
    const[destination]=await tx<any[]>`select id::text,code,name,branch_code from operations.locations where id=${destinationLocationId}::uuid and is_active=true`;
    if(!destination)throw new Error("المكان المستهدف غير صحيح");
    const cars:any[]=[];
    for(const item of vehicles){
      const[v]=await tx<any[]>`
        select v.*,v.id::text,l.code as location_code,l.branch_code
        from operations.vehicles v left join operations.locations l on l.id=v.location_id
        where v.id=${item.vehicleId}::uuid and v.is_deleted=false and v.archived_at is null
        for update of v
      `;
      if(!v)throw new Error("إحدى السيارات غير موجودة");
      if(String(v.location_id)===destinationLocationId)throw new Error(`السيارة ${v.vin} موجودة بالفعل في المكان المستهدف`);
      const[active]=await tx<any[]>`select r.request_no from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id where rv.vehicle_id=${item.vehicleId}::uuid and r.is_deleted=false and r.cancelled_at is null and r.status<>'completed' limit 1`;
      if(active)throw new Error(`السيارة ${v.vin} مرتبطة بطلب نشط ${active.request_no}`);
      cars.push({...v,itemNote:item.note});
    }
    const source=cars[0];
    if(cars.some((vehicle)=>String(vehicle.location_id)!==String(source.location_id)))throw new Error("يجب أن تكون كل سيارات طلب التصوير في المكان المصدر نفسه");
    const[sequence]=await tx<any[]>`select nextval('operations.transfer_request_no_seq')::bigint as n`;
    const requestNo=`PH-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(sequence?.n||1).padStart(6,'0')}`;
    const[request]=await tx<any[]>`
      insert into operations.transfer_requests(request_no,department_code,transfer_type,request_kind,source_location_id,destination_location_id,status,requested_by,requested_by_name,requested_by_role,requested_by_branch,source_branch_code,destination_branch_code,photography_date,note)
      values(${requestNo},'marketing','photography','photography',${source.location_id},${destinationLocationId}::uuid,'created',${user.id}::uuid,${user.fullName},${user.roles[0]||'مستخدم التسويق'},${user.branches[0]||null},${source.branch_code||source.location_code||null},${destination.branch_code||destination.code||null},${photographyDate}::date,${clean(body.note)||null})
      returning *,id::text
    `;
    for(const car of cars)await tx`insert into operations.transfer_request_vehicles(transfer_request_id,vehicle_id,source_location_id,source_status,item_note) values(${request.id}::uuid,${car.id}::uuid,${car.location_id},${car.status_code},${car.itemNote||null})`;
    await tx`insert into operations.transfer_request_events(transfer_request_id,stage,action,note,actor_id,actor_name,actor_role,actor_branch,after_data) values(${request.id}::uuid,'created','created',${clean(body.note)||null},${user.id}::uuid,${user.fullName},${user.roles[0]||'مستخدم التسويق'},${user.branches[0]||null},${tx.json(dbJson({requestKind:'photography',destinationLocationId,photographyDate,vehicles}))})`;
    return{ok:true,request,message:"تم إنشاء طلب التصوير"};
  });
}



async function userColors(sql:ReturnType<typeof getSql>){const rows=await sql<any[]>`select u.id::text,u.full_name,u.email,coalesce(c.color,'#6c3329') as color from core.users u left join marketing.user_colors c on c.user_id=u.id where u.is_active=true and coalesce(u.disabled_reason,'') not like 'ACCOUNT_DELETED:%' and exists(select 1 from core.user_system_departments du where du.user_id=u.id and du.system_code='marketing') order by u.full_name`;return{ok:true,rows};}
async function saveUserColors(sql:ReturnType<typeof getSql>,body:any,user:SessionUser){if(!hasPermission(user,"settings.marketing.manage"))throw new Error("لا توجد صلاحية لإدارة ألوان المستخدمين");for(const item of arrayValue(body.colors)){const userId=clean(item.userId),color=clean(item.color);if(!userId||!/^#[0-9a-fA-F]{6}$/.test(color))continue;await sql`insert into marketing.user_colors(user_id,color,updated_by,updated_at) values(${userId}::uuid,${color},${user.id}::uuid,now()) on conflict(user_id) do update set color=excluded.color,updated_by=excluded.updated_by,updated_at=now()`;}return{ok:true,message:"تم حفظ ألوان المسؤولين"};}

function rawApiToken(){
  const configured=clean(process.env.MZJ_RAW_API_TOKEN||process.env.MZJ_RAW_SECRET||process.env.RAW_API_TOKEN);
  if(configured)return configured;
  if(clean(process.env.MZJ_RAW_ALLOW_LEGACY_TOKEN).toLowerCase()==='false')return'';
  return'MZJ_RAW_SECRET_2026_CHANGE_ME';
}
async function createRawFolders(body:any){
  const url=clean(process.env.MZJ_RAW_API_URL)||'http://152.239.121.92:8080/api/create-raw-folders';
  const token=rawApiToken();
  if(!token)throw new Error("بيانات ربط سيرفر فولدرات الخام غير مكتملة");
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-api-token':token,authorization:`Bearer ${token}`},body:JSON.stringify(body.payload||body),signal:controller.signal});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.ok===false)throw new Error(payload.message||payload.error||`تعذر إنشاء فولدرات الخام (${response.status})`);
    return payload;
  }catch(error:any){
    if(error?.name==='AbortError')throw new Error("انتهت مهلة الاتصال بسيرفر فولدرات الخام");
    throw error;
  }finally{clearTimeout(timeout);}
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  try {
    await ensureAccessControlSchema(); await ensureOperationsSchema(); await ensureMarketingSchema();
    const user = await requireUser(request,response); if(!user)return;
    if(!canUseMarketing(user))return response.status(403).json({ok:false,error:"لا توجد صلاحية لدخول سيستم التسويق"});
    const sql=getSql(); const resource=clean(request.query.resource)||"dashboard";
    if(request.method==='POST'&&resource==='final_upload_chunk'){
      return response.status(200).json(await uploadFinalFileChunk(sql,request,user));
    }
    if(request.method==='GET'){
      if(resource==='meta')return response.status(200).json({...await marketingMeta(sql,user),cars:(hasPermission(user,'marketing.campaign.create')||hasPermission(user,'marketing.agenda.create')||hasPermission(user,'marketing.campaign.edit')||hasPermission(user,'marketing.agenda.edit'))?await loadOperationsCars(sql):[]});
      if(resource==='dashboard')return response.status(200).json(await dashboard(sql,user));
      if(resource==='dashboard_version')return response.status(200).json({ok:true,version:await dashboardVersion(sql)});
      if(resource==='database')return response.status(200).json(await databaseRows(sql,user));
      if(resource==='entity')return response.status(200).json(await entityDetail(sql,clean(request.query.sourceType),clean(request.query.id),user));
      if(resource==='task')return response.status(200).json(await taskDetail(sql,clean(request.query.id),user));
      if(resource==='packages')return response.status(200).json({ok:true,rows:await sql<any[]>`select p.*,p.id::text,p.category_id::text,p.sales_type_id::text,coalesce(c.name,p.category) as category_name,coalesce(s.name,p.sales_type,'—') as sales_type_name from marketing.packages p left join marketing.package_categories c on c.id=p.category_id left join marketing.package_sales_types s on s.id=p.sales_type_id where p.is_active=true order by coalesce(c.sort_order,999),coalesce(s.sort_order,999),p.name`});
      if(resource==='package_settings')return response.status(200).json(await packageSettings(sql));
      if(resource==='publish_prep')return response.status(200).json(await publishPrep(sql,user));
      if(resource==='youtube_publish_options')return response.status(200).json(await loadYouTubePublishOptions(sql));
      if(resource==='engagement'){if(!hasPermission(user,'marketing.engagement.view'))return response.status(403).json({ok:false,error:'لا توجد صلاحية لعرض تفاعل النشر'});const payload=await engagementData(sql);return response.status(200).json({...payload,webhook:{...payload.webhook,callbackUrl:hasPermission(user,'marketing.engagement.webhook.view')?payload.webhook.callbackUrl:'',verifyTokenConfigured:hasPermission(user,'marketing.engagement.status.view')?payload.webhook.verifyTokenConfigured:false,subscriptionResults:hasPermission(user,'marketing.engagement.status.view')?payload.webhook.subscriptionResults:[]}});}
      if(resource==='monitoring')return response.status(200).json(await monitoring(sql,user));
      if(resource==='calendar')return response.status(200).json(await calendarData(sql,user));
      if(resource==='receipt_calendar')return response.status(200).json(await receiptCalendar(sql,user));
      if(resource==='attendance')return response.status(200).json(await attendanceData(sql,user,request));
      if(resource==='stock')return response.status(200).json(await stockData(sql,user));
      if(resource==='user_colors')return response.status(200).json(await userColors(sql));
      if(resource==='file')return response.status(200).json(await fileDownload(sql,clean(request.query.id),user));
      if(resource==='campaign_code'){if(!hasPermission(user,'marketing.campaign.create'))return response.status(403).json({ok:false,message:'لا توجد صلاحية لإنشاء حملة'});return response.status(200).json({ok:true,code:await nextCampaignCode(sql,clean(request.query.campaignTypeId))});}
      return response.status(404).json({ok:false,error:"المورد المطلوب غير موجود"});
    }
    if(request.method!=='POST')return response.status(405).json({ok:false,error:"Method not allowed"});
    const body=bodyObject(request),action=clean(body.action); let result:any;
    if(action==='create_campaign')result=await createCampaign(sql,body,user);
    else if(action==='create_funnel')result=await createFunnel(sql,body,user);
    else if(action==='create_agenda')result=await createAgenda(sql,body,user);
    else if(action==='import_fresh_marketing_bundle')result=await importFreshMarketingBundle(sql,body,user);
    else if(action==='save_entity_creative')result=await saveEntityCreative(sql,body,user);
    else if(action==='save_campaign_budgets')result=await saveCampaignBudgets(sql,body,user);
    else if(action==='save_department')result=await saveDepartment(sql,body,user);
    else if(action==='save_assignment_action')result=await saveAssignmentAction(sql,body);
    else if(action==='save_creative_type')result=await saveCreativeType(sql,body);
    else if(action==='save_campaign_type')result=await saveCampaignType(sql,body);
    else if(action==='save_platform')result=await savePlatform(sql,body);
    else if(action==='delete_setting')result=await softDeleteSetting(sql,body,user);
    else if(action==='save_package')result=await savePackage(sql,body,user);
    else if(action==='save_package_lookup')result=await savePackageLookup(sql,body,user);
    else if(action==='receive_task')result=await receiveTask(sql,body,user);
    else if(action==='upload_template')result=await uploadTemplate(sql,body,user);
    else if(action==='review_template')result=await reviewTemplate(sql,body,user);
    else if(action==='toggle_task_action')result=await toggleTaskAction(sql,body,user);
    else if(action==='complete_task')result=await completeTask(sql,body,user);
    else if(action==='move_to_publishing')result=await moveEntityToPublishing(sql,body,user);
    else if(action==='attach_final_file')result=await attachFinalFile(sql,body,user);
    else if(action==='prepare_final_upload')result=await prepareFinalUpload(sql,body,user);
    else if(action==='commit_final_file_upload')result=await commitFinalFileUpload(sql,body,user);
    else if(action==='cancel_final_upload')result=await cancelFinalUpload(sql,body,user);
    else if(action==='attach_final_media_group')result=await attachFinalMediaGroup(sql,body,user);
    else if(action==='prepare_upload')result=await prepareUpload(sql,body,user);
    else if(action==='mark_file_ready')result=await markFileReady(sql,body,user);
    else if(action==='save_publish_prep')result=await savePublishPrep(sql,body,user);
    else if(action==='create_manual_publish_entry')result=await createManualPublishEntry(sql,body,user);
    else if(action==='discard_manual_publish_entry')result=await discardManualPublishEntry(sql,body,user);
    else if(action==='remove_publish_prep_entry')result=await removePublishPrepEntry(sql,body,user);
    else if(action==='publish_now')result=await publishNow(sql,body,user);
    else if(action==='refresh_engagement'){if(!hasPermission(user,'marketing.engagement.refresh'))throw new Error('لا توجد صلاحية لتحديث تفاعل النشر');result=await refreshEngagementMetrics(sql,arrayValue<string>(body.ids).map(clean).filter(Boolean));}
    else if(action==='subscribe_engagement_webhooks'){if(!hasPermission(user,'marketing.engagement.subscribe'))throw new Error('لا توجد صلاحية لتفعيل استقبال التفاعلات');await backfillPublishedPosts(sql);result=await subscribeMetaEngagementWebhooks(sql);}
    else if(action==='manage_engagement_item'){
      if(!hasPermission(user,'marketing.publish.now'))throw new Error('لا توجد صلاحية لإدارة تفاعل النشر');
      if(clean(body.operation)==='delete_customer'&&!hasPermission(user,'crm.customer.delete'))throw new Error('لا توجد صلاحية لمسح عميل CRM');
      result=await manageEngagementItem(sql,body,user);
    }
    else if(action==='save_result_file')result=await saveResultFile(sql,body,user);
    else if(action==='save_links')result=await saveLinks(sql,body,user);
    else if(action==='archive_entity')result=await archiveEntity(sql,body,user);
    else if(action==='delete_entity')result=await deleteEntity(sql,body,user);
    else if(action==='attendance')result=await attendanceAction(sql,body,user);
    else if(action==='create_photo_request')result=await createPhotoRequest(sql,body,user);
    else if(action==='mark_stock_photographed')result=await markStockPhotographed(sql,body,user);
    else if(action==='complete_photo_request')result=await completePhotographyRequest(sql,clean(body.id),user,clean(body.note));
    else if(action==='save_user_colors')result=await saveUserColors(sql,body,user);
    else if(action==='create_raw_folders')result=await createRawFolders(body);
    else throw new Error("الإجراء غير مدعوم");
    await audit(sql,user,action,'marketing',clean(result?.id||body.id)||null,result,undefined,requestIp(request)).catch(()=>undefined);
    await emitMarketingNotification(user, action, body, result).catch((error) => console.error("Marketing notification failed", error));
    return response.status(200).json(result);
  } catch(error:any){console.error('Marketing API failed',error);const message=clean(error?.message)||"تعذر تنفيذ العملية";const status=/صلاحية|مدير النظام/.test(message)?403:/غير موجود/.test(message)?404:400;return response.status(status).json({ok:false,error:message});}
}
