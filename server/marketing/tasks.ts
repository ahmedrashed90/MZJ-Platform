import type { VercelRequest } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { createDownloadUrl, createUploadUrl, mediaStorageConfigured } from "../_media-storage.js";
import { getSql } from "../_db.js";
import {
  MarketingError, arrayValue, clean, hasPermission, isAdmin, numberValue, pageValues,
  recalculateCampaign, safeJson, storageKeyForTask, userCanAccessTask,
} from "./common.js";

const templateExtensions = new Set(["xlsx", "xls", "csv"]);
const finalExtensions = new Set(["mp4", "mov", "webm", "jpg", "jpeg", "png", "pdf", "zip", "psd", "ai"]);

function fileExtension(name: string) {
  const parts = clean(name).toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() || "" : "";
}

function validateTaskFile(fileKind: string, fileName: string, fileSize: number) {
  if (!fileName || !["template", "final", "attachment"].includes(fileKind)) {
    throw new MarketingError(400, "بيانات الملف غير مكتملة", "VALIDATION_ERROR");
  }
  const extension = fileExtension(fileName);
  const allowed = fileKind === "template" ? templateExtensions : finalExtensions;
  if (!allowed.has(extension)) throw new MarketingError(400, "امتداد الملف غير مسموح لهذه المهمة", "INVALID_FILE_TYPE");
  const maxSize = fileKind === "template" ? 20 * 1024 * 1024 : 2 * 1024 * 1024 * 1024;
  if (fileSize < 0 || fileSize > maxSize) throw new MarketingError(400, "حجم الملف أكبر من الحد المسموح", "FILE_TOO_LARGE");
}

function taskScope(sql: ReturnType<typeof getSql>, user: SessionUser) {
  if (isAdmin(user) || hasPermission(user, "marketing.tasks.review")) return sql`true`;
  return sql`t.assigned_to=${user.id}::uuid`;
}

export async function listTasks(request: VercelRequest, user: SessionUser) {
  const sql = getSql();
  const { page, pageSize, offset } = pageValues(request);
  const search = clean(request.query.search);
  const status = clean(request.query.status);
  const department = clean(request.query.department);
  const campaignId = clean(request.query.campaignId);
  const taskType = clean(request.query.taskType);
  const taskId = clean(request.query.taskId);
  const bucket = clean(request.query.bucket);
  const pattern = `%${search}%`;
  const scope = taskScope(sql, user);
  const bucketCondition = bucket === "new" ? sql`t.status in ('pending_template','ready')`
    : bucket === "active" ? sql`t.status in ('received','in_progress')`
    : bucket === "changes" ? sql`t.status='changes_requested'`
    : bucket === "review" ? sql`t.status in ('template_submitted','under_review')`
    : bucket === "completed" ? sql`(t.status='completed' or (t.task_type='content_template' and t.user_completed_at is not null))`
    : sql`true`;
  const where = sql`
    c.is_deleted=false and ${scope} and ${bucketCondition}
    and (${taskId}='' or t.id::text=${taskId})
    and (${status}='' or t.status=${status})
    and (${department}='' or t.department_code=${department})
    and (${campaignId}='' or t.campaign_id::text=${campaignId})
    and (${taskType}='' or t.task_type=${taskType})
    and (${search}='' or coalesce(t.task_code,'') ilike ${pattern} or coalesce(t.title,'') ilike ${pattern} or c.name ilike ${pattern} or coalesce(c.campaign_code,'') ilike ${pattern} or coalesce(cr.creative_name,'') ilike ${pattern} or coalesce(u.full_name,'') ilike ${pattern})
  `;
  const [count] = await sql<{ total: number }[]>`
    select count(*)::int total from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id left join marketing.creatives cr on cr.id=t.creative_id left join core.users u on u.id=t.assigned_to where ${where}
  `;
  const rows = await sql<any[]>`
    select t.id::text,t.task_code,t.task_type,t.pair_key,t.title,t.department_code,t.status,t.review_status,t.progress_percent,t.due_at,t.received_at,t.completed_at,t.user_completed_at,t.requires_final_file,t.created_at,t.updated_at,
      c.id::text campaign_id,c.campaign_code,c.name campaign_name,c.campaign_type,c.source_type,c.publish_start_date,c.publish_end_date,c.status campaign_status,
      cr.id::text creative_id,cr.creative_name,cr.instance_code,cr.primary_department_code,
      u.id::text assigned_to,u.full_name assigned_to_name,cu.id::text paired_content_user_id,cu.full_name content_user_name,
      ca.due_date,ca.writer_due_date,ca.department_note,ca.content_note,
      dm.display_name department_name,
      coalesce(a.actions,'[]'::json) actions,
      coalesce(f.files,'[]'::json) files,
      tv.latest_template,
      coalesce(v.vehicles,'[]'::json) vehicles
    from marketing.tasks t
    join marketing.campaigns c on c.id=t.campaign_id
    left join marketing.creatives cr on cr.id=t.creative_id
    left join marketing.creative_assignments ca on ca.id=t.assignment_id
    left join core.users u on u.id=t.assigned_to
    left join core.users cu on cu.id=t.paired_content_user_id
    left join marketing.department_mappings dm on dm.department_code=t.department_code
    left join lateral (
      select json_agg(x order by x.action_order) actions from (
        select id::text,action_code,action_name,action_order,weight,is_admin_only,is_required,is_completed,completed_by::text,completed_at,note
        from marketing.task_action_events where task_id=t.id
      ) x
    ) a on true
    left join lateral (
      select json_agg(x order by x.uploaded_at desc) files from (
        select id::text,file_kind,file_name,mime_type,file_size,uploaded_at,is_active
        from marketing.task_files where task_id=t.id and is_active=true
      ) x
    ) f on true
    left join lateral (
      select json_build_object('id',x.id::text,'version_no',x.version_no,'status',x.status,'parsed_data',x.parsed_data,'submitted_at',x.submitted_at,'reviewed_at',x.reviewed_at,'review_note',x.review_note) latest_template
      from marketing.task_template_versions x where x.task_id=t.id order by x.version_no desc limit 1
    ) tv on true
    left join lateral (
      select json_agg(json_build_object('vehicle_id',l.vehicle_id::text,'vin',l.vin_snapshot,'car_name',l.car_name_snapshot,'statement',l.statement_snapshot,'exterior_color',l.exterior_color_snapshot,'interior_color',l.interior_color_snapshot,'model_year',l.model_year_snapshot,'location',l.location_snapshot) order by l.vin_snapshot) vehicles
      from marketing.creative_vehicle_links l where l.creative_id=t.creative_id
    ) v on true
    where ${where}
    order by case when t.due_at<now() and t.progress_percent<100 then 0 else 1 end,t.due_at nulls last,t.updated_at desc
    limit ${pageSize} offset ${offset}
  `;
  const buckets = await sql<any[]>`
    select
      count(*) filter(where t.status in ('pending_template','ready'))::int new_count,
      count(*) filter(where t.status in ('received','in_progress'))::int active_count,
      count(*) filter(where t.status='changes_requested')::int changes_count,
      count(*) filter(where t.status in ('template_submitted','under_review'))::int review_count,
      count(*) filter(where t.status='completed' or (t.task_type='content_template' and t.user_completed_at is not null))::int completed_count
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id where c.is_deleted=false and ${scope}
  `;
  return { ok: true, rows, total: Number(count?.total || 0), page, pageSize, buckets: buckets[0] || {} };
}

async function loadTaskForUpdate(tx: any, taskId: string) {
  const [task] = await tx<any[]>`
    select t.*,t.id::text,c.status campaign_status,c.id::text campaign_id,cr.creative_name,cr.instance_code
    from marketing.tasks t join marketing.campaigns c on c.id=t.campaign_id left join marketing.creatives cr on cr.id=t.creative_id
    where t.id=${taskId}::uuid and c.is_deleted=false for update of t
  `;
  if (!task) throw new MarketingError(404, "التاسك غير موجود", "TASK_NOT_FOUND");
  return task;
}

export async function taskAction(user: SessionUser, body: Record<string, any>) {
  const sql = getSql();
  const action = clean(body.action);
  const taskId = clean(body.taskId || body.id);
  if (!taskId) throw new MarketingError(400, "التاسك مطلوب", "VALIDATION_ERROR");
  if (!(await userCanAccessTask(sql, user, taskId))) throw new MarketingError(403, "لا تملك صلاحية الوصول لهذا التاسك", "FORBIDDEN");

  if (action === "prepare_task_upload") {
    if (!mediaStorageConfigured()) throw new MarketingError(503, "تخزين R2 غير مضبوط في بيئة المنصة", "STORAGE_NOT_CONFIGURED");
    const fileKind = clean(body.fileKind);
    const fileName = clean(body.fileName);
    const mimeType = clean(body.mimeType) || "application/octet-stream";
    const fileSize = Math.max(0, Math.floor(numberValue(body.fileSize, 0)));
    validateTaskFile(fileKind, fileName, fileSize);
    const storageKey = storageKeyForTask(taskId, fileKind, fileName);
    return { ok: true, storageKey, uploadUrl: createUploadUrl(storageKey, 900), expiresIn: 900, mimeType };
  }

  if (action === "download_task_file") {
    const fileId = clean(body.fileId);
    const [file] = await sql<any[]>`select id::text,task_id::text,file_name,storage_key from marketing.task_files where id=${fileId}::uuid and task_id=${taskId}::uuid and is_active=true`;
    if (!file) throw new MarketingError(404, "الملف غير موجود", "FILE_NOT_FOUND");
    return { ok: true, fileName: file.file_name, downloadUrl: createDownloadUrl(file.storage_key, 300), expiresIn: 300 };
  }

  return sql.begin(async (tx) => {
    const task = await loadTaskForUpdate(tx, taskId);
    const ownsTask = task.assigned_to === user.id;
    const canReview = hasPermission(user, "marketing.tasks.review");

    if (action === "receive_task") {
      if (!ownsTask && !isAdmin(user)) throw new MarketingError(403, "استلام التاسك متاح للمسؤول عنه فقط", "FORBIDDEN");
      if (!["ready", "received"].includes(task.status)) throw new MarketingError(409, "التاسك غير جاهز للاستلام", "INVALID_TASK_STATE");
      const [updated] = await tx<any[]>`update marketing.tasks set status='received',received_at=coalesce(received_at,now()),updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${taskId}::uuid returning *,id::text`;
      return { ok: true, task: updated, message: "تم استلام التاسك" };
    }

    if (action === "start_task") {
      if (!ownsTask && !isAdmin(user)) throw new MarketingError(403, "بدء التاسك متاح للمسؤول عنه فقط", "FORBIDDEN");
      if (!["ready", "received", "changes_requested", "in_progress"].includes(task.status)) throw new MarketingError(409, "لا يمكن بدء التاسك في حالته الحالية", "INVALID_TASK_STATE");
      const [updated] = await tx<any[]>`update marketing.tasks set status='in_progress',received_at=coalesce(received_at,now()),updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${taskId}::uuid returning *,id::text`;
      return { ok: true, task: updated, message: "تم بدء العمل على التاسك" };
    }

    if (action === "complete_task_action" || action === "undo_task_action") {
      const actionId = clean(body.actionId);
      const [step] = await tx<any[]>`select *,id::text from marketing.task_action_events where id=${actionId}::uuid and task_id=${taskId}::uuid for update`;
      if (!step) throw new MarketingError(404, "إجراء التاسك غير موجود", "ACTION_NOT_FOUND");
      if (step.is_admin_only && !hasPermission(user, "marketing.tasks.admin_actions")) throw new MarketingError(403, "هذا الإجراء مخصص للأدمن", "FORBIDDEN");
      if (!step.is_admin_only && !ownsTask && !canReview) throw new MarketingError(403, "لا تملك صلاحية تنفيذ هذا الإجراء", "FORBIDDEN");
      if (action === "complete_task_action") {
        const [previousPending] = await tx<any[]>`select 1 from marketing.task_action_events where task_id=${taskId}::uuid and is_required=true and action_order<${step.action_order} and is_completed=false limit 1`;
        if (previousPending) throw new MarketingError(409, "يجب تنفيذ الإجراءات السابقة بالترتيب", "ACTION_ORDER_REQUIRED");
        await tx`update marketing.task_action_events set is_completed=true,completed_by=${user.id}::uuid,completed_at=now(),note=${clean(body.note) || null} where id=${actionId}::uuid`;
      } else {
        const [laterDone] = await tx<any[]>`select 1 from marketing.task_action_events where task_id=${taskId}::uuid and action_order>${step.action_order} and is_completed=true limit 1`;
        if (laterDone && !canReview) throw new MarketingError(409, "لا يمكن إلغاء إجراء قديم بعد إتمام إجراء لاحق", "ACTION_DEPENDENCY");
        await tx`update marketing.task_action_events set is_completed=false,completed_by=null,completed_at=null,note=${clean(body.note) || null} where id=${actionId}::uuid`;
      }
      const [progressRow] = await tx<any[]>`
        select coalesce(sum(weight) filter(where is_completed),0)::numeric progress,
          bool_and(is_completed or not is_required) all_required_done
        from marketing.task_action_events where task_id=${taskId}::uuid
      `;
      const progress = Math.min(100, Math.max(0, Math.round(Number(progressRow?.progress || 0))));
      const nextStatus = progress > 0 ? "in_progress" : (task.status === "ready" ? "ready" : "received");
      const [updated] = await tx<any[]>`update marketing.tasks set progress_percent=${progress},status=${nextStatus},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${taskId}::uuid returning *,id::text`;
      await recalculateCampaign(tx, task.campaign_id);
      return { ok: true, task: updated, progress, message: action === "complete_task_action" ? "تم تنفيذ الإجراء" : "تم إلغاء تنفيذ الإجراء" };
    }

    if (action === "finalize_task_upload") {
      const fileKind = clean(body.fileKind);
      const fileName = clean(body.fileName);
      const storageKey = clean(body.storageKey);
      const mimeType = clean(body.mimeType) || null;
      const rawFileSize = Math.max(0, Math.floor(numberValue(body.fileSize, 0)));
      const fileSize = rawFileSize || null;
      validateTaskFile(fileKind, fileName, rawFileSize);
      const expectedStorageSegment = `/${taskId}/${fileKind}/`;
      if (!storageKey.startsWith("marketing/") || !storageKey.includes(expectedStorageSegment)) throw new MarketingError(400, "مسار الملف لا يخص هذه المهمة", "INVALID_STORAGE_KEY");
      if (fileKind === "template" && task.task_type !== "content_template") throw new MarketingError(409, "Task Template يرفع على مهمة المحتوى فقط", "INVALID_TASK_TYPE");
      if (fileKind === "final" && task.task_type !== "execution") throw new MarketingError(409, "الملف النهائي يرفع على التاسك التنفيذي فقط", "INVALID_TASK_TYPE");
      if (!ownsTask && !isAdmin(user)) throw new MarketingError(403, "رفع الملف متاح للمسؤول عن التاسك فقط", "FORBIDDEN");
      if (fileKind === "final") {
        const [pending] = await tx<any[]>`select 1 from marketing.task_action_events where task_id=${taskId}::uuid and is_required=true and is_completed=false limit 1`;
        if (pending) throw new MarketingError(409, "أكمل إجراءات التاسك الإلزامية قبل رفع الملف النهائي", "ACTIONS_NOT_COMPLETE");
      }
      if (fileKind === "final") await tx`update marketing.task_files set is_active=false where task_id=${taskId}::uuid and file_kind='final' and is_active=true`;
      const [file] = await tx<any[]>`
        insert into marketing.task_files(task_id,file_kind,file_name,storage_key,mime_type,file_size,checksum,uploaded_by)
        values (${taskId}::uuid,${fileKind},${fileName},${storageKey},${mimeType},${fileSize},${clean(body.checksum) || null},${user.id}::uuid) returning *,id::text
      `;
      if (fileKind === "template") {
        const parsedData = safeJson(body.parsedData || {});
        if (JSON.stringify(parsedData).length > 2_000_000) throw new MarketingError(400, "بيانات Task Template أكبر من الحد المسموح", "TEMPLATE_DATA_TOO_LARGE");
        const [version] = await tx<any[]>`select coalesce(max(version_no),0)+1 version_no from marketing.task_template_versions where task_id=${taskId}::uuid`;
        const [template] = await tx<any[]>`
          insert into marketing.task_template_versions(task_id,version_no,source_file_id,status,parsed_data,submitted_by)
          values (${taskId}::uuid,${Number(version.version_no)},${file.id}::uuid,'submitted',${tx.json(parsedData)},${user.id}::uuid) returning *,id::text
        `;
        await tx`update marketing.tasks set status='template_submitted',review_status='submitted',progress_percent=50,updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${taskId}::uuid`;
        await recalculateCampaign(tx, task.campaign_id);
        return { ok: true, file, template, message: "تم رفع Task Template وإرسالها للمراجعة" };
      }
      if (fileKind === "final") {
        await tx`update marketing.tasks set status='under_review',review_status='final_file_submitted',progress_percent=99,updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${taskId}::uuid`;
        await recalculateCampaign(tx, task.campaign_id);
        return { ok: true, file, message: "تم رفع الملف النهائي وإرساله للمراجعة" };
      }
      return { ok: true, file, message: "تم إرفاق الملف" };
    }

    if (action === "review_template") {
      if (!canReview) throw new MarketingError(403, "اعتماد Task Template متاح للأدمن فقط", "FORBIDDEN");
      if (task.task_type !== "content_template") throw new MarketingError(409, "هذه ليست مهمة Task Template", "INVALID_TASK_TYPE");
      const decision = clean(body.decision);
      if (!["approved", "changes_requested", "rejected"].includes(decision)) throw new MarketingError(400, "قرار المراجعة غير صحيح", "VALIDATION_ERROR");
      const [version] = await tx<any[]>`select *,id::text from marketing.task_template_versions where task_id=${taskId}::uuid order by version_no desc limit 1 for update`;
      if (!version) throw new MarketingError(409, "لا توجد نسخة Task Template مرفوعة", "TEMPLATE_NOT_FOUND");
      await tx`update marketing.task_template_versions set status=${decision},reviewed_by=${user.id}::uuid,reviewed_at=now(),review_note=${clean(body.note) || null} where id=${version.id}::uuid`;
      if (decision === "approved") {
        await tx`update marketing.tasks set status='template_approved',review_status='approved',progress_percent=100,updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${taskId}::uuid`;
        const [execution] = await tx<any[]>`
          update marketing.tasks set status='ready',review_status=null,updated_at=now(),version=version+1
          where depends_on_task_id=${taskId}::uuid and pair_key=${task.pair_key} and task_type='execution' and status='blocked_by_template'
          returning *,id::text
        `;
        await recalculateCampaign(tx, task.campaign_id);
        return { ok: true, executionTask: execution || null, message: "تم اعتماد Task Template وفتح التاسك التنفيذي المرتبط فقط" };
      }
      await tx`update marketing.tasks set status=${decision === "changes_requested" ? "changes_requested" : "cancelled"},review_status=${decision},progress_percent=${decision === "changes_requested" ? 50 : 0},updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${taskId}::uuid`;
      await recalculateCampaign(tx, task.campaign_id);
      return { ok: true, message: decision === "changes_requested" ? "تم إرسال Task Template للتعديل" : "تم رفض Task Template" };
    }

    if (action === "mark_content_done") {
      if (task.task_type !== "content_template") throw new MarketingError(409, "الإجراء متاح لمهمة المحتوى فقط", "INVALID_TASK_TYPE");
      if (!ownsTask && !isAdmin(user)) throw new MarketingError(403, "الإجراء متاح للمسؤول عن المهمة فقط", "FORBIDDEN");
      if (Number(task.progress_percent || 0) < 100) throw new MarketingError(409, "لا يمكن إنهاء المهمة قبل اعتماد Task Template", "TASK_NOT_COMPLETE");
      await tx`update marketing.tasks set user_completed_at=now(),updated_by=${user.id}::uuid,updated_at=now() where id=${taskId}::uuid`;
      return { ok: true, message: "تم نقل Task Template إلى التاسكات المنتهية في عرضك" };
    }

    if (action === "review_final_file") {
      if (!canReview) throw new MarketingError(403, "مراجعة الملف النهائي متاحة للأدمن فقط", "FORBIDDEN");
      if (task.task_type !== "execution") throw new MarketingError(409, "هذه ليست مهمة تنفيذية", "INVALID_TASK_TYPE");
      const decision = clean(body.decision);
      if (!["approved", "changes_requested", "rejected"].includes(decision)) throw new MarketingError(400, "قرار المراجعة غير صحيح", "VALIDATION_ERROR");
      const [file] = await tx<any[]>`select *,id::text from marketing.task_files where task_id=${taskId}::uuid and file_kind='final' and is_active=true order by uploaded_at desc limit 1`;
      if (!file) throw new MarketingError(409, "لا يوجد ملف نهائي للمراجعة", "FINAL_FILE_NOT_FOUND");
      if (decision === "approved") {
        const [template] = await tx<any[]>`
          select v.id::text from marketing.task_template_versions v join marketing.tasks ct on ct.id=v.task_id
          where ct.id=task.depends_on_task_id and v.status='approved' order by v.version_no desc limit 1
        `;
        const [prep] = await tx<any[]>`
          insert into marketing.publish_prep_items(campaign_id,creative_id,source_task_id,approved_template_version_id,final_file_id,status)
          values (${task.campaign_id}::uuid,${task.creative_id}::uuid,${taskId}::uuid,${template?.id || null},${file.id}::uuid,'ready')
          on conflict(source_task_id) do update set approved_template_version_id=excluded.approved_template_version_id,final_file_id=excluded.final_file_id,status='ready',updated_at=now()
          returning *,id::text
        `;
        await tx`update marketing.tasks set status='completed',review_status='approved',progress_percent=100,completed_at=now(),updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${taskId}::uuid`;
        await recalculateCampaign(tx, task.campaign_id);
        return { ok: true, publishPrepItem: prep, message: "تم اعتماد الملف النهائي ونقله إلى تجهيز النشر" };
      }
      await tx`update marketing.tasks set status=${decision === "changes_requested" ? "changes_requested" : "cancelled"},review_status=${decision},progress_percent=99,updated_by=${user.id}::uuid,updated_at=now(),version=version+1 where id=${taskId}::uuid`;
      await recalculateCampaign(tx, task.campaign_id);
      return { ok: true, message: decision === "changes_requested" ? "تم طلب تعديل الملف النهائي" : "تم رفض الملف النهائي" };
    }

    throw new MarketingError(400, "إجراء التاسك غير مدعوم", "INVALID_ACTION");
  });
}
