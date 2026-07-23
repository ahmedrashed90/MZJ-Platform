import type { SessionUser } from "../../_auth.js";
import { getSql } from "../../_db.js";
import { createDownloadUrl } from "../../_media-storage.js";
import { MarketingError, audit, clean, safeJson } from "../common.js";
import { publishMeta } from "./meta.js";
import { publishMersal } from "./mersal.js";
import { publishYouTube } from "./youtube.js";
import type { PlatformConnection, PublishResult, PublishTargetContext } from "./types.js";

function privacy(value: unknown): "public" | "private" | "unlisted" {
  const text = clean(value).toLowerCase();
  return text === "public" || text === "private" ? text : "unlisted";
}

async function connectionByCode(platformCode: string): Promise<PlatformConnection | null> {
  const sql = getSql();
  const [row] = await sql<any[]>`
    select c.*,c.id::text,c.platform_id::text,p.code platform_code,p.name platform_name
    from marketing.platform_connections c join marketing.platform_catalog p on p.id=c.platform_id
    where p.code=${clean(platformCode)}
  `;
  return row || null;
}

async function targetContext(targetId: string): Promise<PublishTargetContext & { connection: PlatformConnection | null }> {
  const sql = getSql();
  const [row] = await sql<any[]>`
    select pt.id::text target_id,pt.publish_prep_item_id::text prep_id,pt.scheduled_at,pc.code platform_code,pc.name platform_name,
      coalesce(pst.code,'') post_type_code,coalesce(pst.name,'') post_type_name,coalesce(pi.caption,'') caption,coalesce(pi.hashtags,'') hashtags,
      coalesce(f.storage_key,'') storage_key,coalesce(f.mime_type,'') mime_type,coalesce(f.file_name,'') file_name,coalesce(f.file_size,0)::bigint file_size,
      coalesce(ms.value->>'youtubePrivacy','unlisted') youtube_privacy,
      coalesce(pi.recipients,'{}'::text[]) recipients,pi.use_saved_contacts,
      c.id::text campaign_id,c.name campaign_name,cr.creative_name
    from marketing.publish_targets pt
    join marketing.publish_prep_items pi on pi.id=pt.publish_prep_item_id
    join marketing.platform_catalog pc on pc.id=pt.platform_id
    left join marketing.platform_post_types pst on pst.id=pt.post_type_id
    join marketing.campaigns c on c.id=pi.campaign_id
    join marketing.creatives cr on cr.id=pi.creative_id
    left join marketing.task_files f on f.id=pi.final_file_id and f.is_active=true
    left join marketing.settings ms on ms.key='publishing'
    where pt.id=${clean(targetId)}::uuid
  `;
  if (!row) throw new MarketingError(404, "هدف النشر غير موجود", "PUBLISH_TARGET_NOT_FOUND");
  const mediaUrl = row.storage_key ? createDownloadUrl(row.storage_key, 3600) : "";
  const explicitRecipients = Array.isArray(row.recipients) ? row.recipients.map((value: unknown) => clean(value)).filter(Boolean) : [];
  const savedRecipients = row.use_saved_contacts
    ? (await sql<{ phone_normalized: string }[]>`select phone_normalized from marketing.whatsapp_contacts where is_active=true order by updated_at desc`).map((item) => clean(item.phone_normalized)).filter(Boolean)
    : [];
  const recipients = [...new Set([...explicitRecipients, ...savedRecipients])];
  const context: PublishTargetContext = {
    targetId: row.target_id,
    prepId: row.prep_id,
    platformCode: row.platform_code,
    platformName: row.platform_name,
    postTypeCode: row.post_type_code,
    postTypeName: row.post_type_name,
    caption: row.caption,
    hashtags: row.hashtags,
    message: [row.caption, row.hashtags].filter(Boolean).join("\n\n"),
    mediaUrl,
    mimeType: row.mime_type,
    fileName: row.file_name,
    fileSize: Number(row.file_size || 0),
    scheduledAt: row.scheduled_at,
    youtubePrivacy: privacy(row.youtube_privacy),
    recipients,
  };
  return { ...context, connection: await connectionByCode(row.platform_code) };
}

function adapterResult(platformCode: string, connection: PlatformConnection | null, context: PublishTargetContext): Promise<PublishResult> {
  if (["facebook", "instagram"].includes(platformCode)) {
    if (!connection) return Promise.resolve({ status: "blocked", errorMessage: `${context.platformName} غير متصلة` });
    return publishMeta(connection, context);
  }
  if (platformCode === "youtube") {
    if (!connection) return Promise.resolve({ status: "blocked", errorMessage: "YouTube غير متصلة" });
    return publishYouTube(connection, context);
  }
  if (platformCode === "whatsapp") {
    if (!connection) return Promise.resolve({ status: "blocked", errorMessage: "WhatsApp / مرسال غير متصلة" });
    return publishMersal(connection, context);
  }
  if (platformCode === "tiktok") return Promise.resolve({ status: "blocked", errorMessage: "TikTok في وضع Sandbox/Review ولم يتم اعتماد Draft Upload" });
  if (platformCode === "snapchat") return Promise.resolve({ status: "blocked", errorMessage: "Snapchat بانتظار Public Profile API Allowlist" });
  return Promise.resolve({ status: "blocked", errorMessage: "المنصة غير مدعومة" });
}

export type PublishExecutionActor = { source: "manual"; user: SessionUser } | { source: "scheduler"; user?: null };

export async function executePublishTarget(actor: PublishExecutionActor, targetId: string) {
  const sql = getSql();
  return sql.begin(async (tx) => {
    const [locked] = await tx<any[]>`
      select pt.id::text,pt.publish_prep_item_id::text prep_id,pt.status,pt.idempotency_key,pc.code platform_code
      from marketing.publish_targets pt join marketing.platform_catalog pc on pc.id=pt.platform_id
      where pt.id=${clean(targetId)}::uuid for update
    `;
    if (!locked) throw new MarketingError(404, "هدف النشر غير موجود", "PUBLISH_TARGET_NOT_FOUND");
    if (locked.status === "published") return { ok: true, alreadyPublished: true, message: "تم نشر هذا الهدف مسبقًا" };
    if (locked.status === "publishing") throw new MarketingError(409, "هدف النشر قيد التنفيذ بالفعل", "PUBLISH_IN_PROGRESS");
    const [existingJob] = await tx<any[]>`
      select id::text,status,external_id,published_url,error_message from marketing.publish_jobs
      where target_id=${locked.id}::uuid and idempotency_key=${locked.idempotency_key} and status='published'
      order by created_at desc limit 1
    `;
    if (existingJob) {
      await tx`update marketing.publish_targets set status='published',external_id=${existingJob.external_id},published_url=${existingJob.published_url},error_message=null,updated_at=now() where id=${locked.id}::uuid`;
      return { ok: true, alreadyPublished: true, message: "تم استعادة نتيجة النشر السابقة" };
    }
    const [job] = await tx<any[]>`
      insert into marketing.publish_jobs(target_id,idempotency_key,status,requested_by,started_at,created_at,updated_at)
      values (${locked.id}::uuid,${locked.idempotency_key},'publishing',${actor.user?.id || null}::uuid,now(),now(),now())
      returning id::text
    `;
    await tx`update marketing.publish_targets set status='publishing',error_message=null,updated_at=now() where id=${locked.id}::uuid`;
    return { locked, jobId: job.id };
  }).then(async (state: any) => {
    if (state?.alreadyPublished) return state;
    const { locked, jobId } = state;
    let context: Awaited<ReturnType<typeof targetContext>> | null = null;
    let result: PublishResult;
    try {
      context = await targetContext(locked.id);
      result = await adapterResult(context.platformCode, context.connection, context);
    } catch (error) { result = { status: "failed", errorMessage: error instanceof Error ? error.message : "فشل النشر" }; }
    const sql2 = getSql();
    await sql2.begin(async (tx) => {
      await tx`
        update marketing.publish_jobs set status=${result.status},external_id=${result.externalId || null},published_url=${result.publishedUrl || null},error_message=${result.errorMessage || null},response_summary=${tx.json(safeJson(result.responseSummary || {}))},finished_at=now(),updated_at=now()
        where id=${jobId}::uuid
      `;
      await tx`
        insert into marketing.publish_attempts(job_id,target_id,attempt_no,status,response_summary,error_message,created_at)
        values (${jobId}::uuid,${locked.id}::uuid,1,${result.status},${tx.json(safeJson(result.responseSummary || {}))},${result.errorMessage || null},now())
      `;
      await tx`
        update marketing.publish_targets set status=${result.status},external_id=${result.externalId || null},published_url=${result.publishedUrl || null},error_message=${result.errorMessage || null},updated_at=now()
        where id=${locked.id}::uuid
      `;
      const [summary] = await tx<any[]>`
        select bool_and(status='published') all_published,bool_or(status='failed') any_failed,bool_or(status='publishing') any_publishing,bool_or(status='blocked') any_blocked
        from marketing.publish_targets where publish_prep_item_id=${locked.prep_id}::uuid
      `;
      await tx`
        update marketing.publish_prep_items set status=case
          when ${Boolean(summary?.all_published)} then 'published'
          when ${Boolean(summary?.any_publishing)} then 'publishing'
          when ${Boolean(summary?.any_failed)} then 'failed'
          when ${Boolean(summary?.any_blocked)} then 'blocked'
          else status end,updated_at=now()
        where id=${locked.prep_id}::uuid
      `;
    });
    await audit(actor.user || null, actor.source === "scheduler" ? "auto_publish_target" : "publish_target", "marketing.publish_target", locked.id, undefined, { source: actor.source, platform: context?.platformCode || locked.platform_code, status: result.status, externalId: result.externalId, publishedUrl: result.publishedUrl, errorMessage: result.errorMessage });
    return { ok: result.status === "published", result, message: result.status === "published" ? "تم النشر بنجاح" : result.errorMessage || "تعذر النشر" };
  });
}
