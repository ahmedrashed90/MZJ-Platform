import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { getSql } from "../_db.js";
import { MarketingError, arrayValue, clean, hasPermission, isAdmin, pageValues } from "./common.js";
import { createOAuthState, consumeOAuthState, requestOrigin } from "./platforms/security.js";
import { exchangeMetaCode, listMetaAccounts, metaAuthorizationUrl, metaConfigured, saveMetaOAuthConnection, selectMetaPage } from "./platforms/meta.js";
import { validateMersal } from "./platforms/mersal.js";
import { executePublishTarget } from "./platforms/registry.js";
import { exchangeYouTubeCode, saveYouTubeConnection, youtubeAuthorizationUrl, youtubeConfigured } from "./platforms/youtube.js";
import type { PlatformConnection } from "./platforms/types.js";

function prepScope(sql: ReturnType<typeof getSql>, user: SessionUser) {
  if (isAdmin(user) || hasPermission(user, "marketing.publish_prep.manage") || hasPermission(user, "marketing.tasks.review")) return sql`true`;
  return sql`exists(select 1 from marketing.tasks tx where tx.id=pi.source_task_id and tx.assigned_to=${user.id}::uuid)`;
}

export async function listPublishPrep(request: VercelRequest, user: SessionUser) {
  const sql = getSql();
  const { page, pageSize, offset } = pageValues(request);
  const search = clean(request.query.search);
  const status = clean(request.query.status);
  const platformId = clean(request.query.platformId);
  const departmentCode = clean(request.query.departmentCode);
  const pattern = `%${search}%`;
  const scope = prepScope(sql, user);
  const where = sql`
    c.is_deleted=false and ${scope}
    and (${status}='' or pi.status=${status})
    and (${departmentCode}='' or t.department_code=${departmentCode})
    and (${platformId}='' or exists(select 1 from marketing.publish_targets pfilter where pfilter.publish_prep_item_id=pi.id and pfilter.platform_id::text=${platformId}))
    and (${search}='' or c.name ilike ${pattern} or c.campaign_code ilike ${pattern} or cr.creative_name ilike ${pattern} or cr.instance_code ilike ${pattern})
  `;
  const [count] = await sql<{total:number}[]>`select count(*)::int total from marketing.publish_prep_items pi join marketing.campaigns c on c.id=pi.campaign_id join marketing.creatives cr on cr.id=pi.creative_id join marketing.tasks t on t.id=pi.source_task_id where ${where}`;
  const rows = await sql<any[]>`
    select pi.id::text,pi.status,pi.caption,pi.hashtags,pi.recipients,pi.use_saved_contacts,pi.created_at,pi.updated_at,
      c.id::text campaign_id,c.campaign_code,c.name campaign_name,c.source_type,c.publish_start_date,c.publish_end_date,
      cr.id::text creative_id,cr.creative_name,cr.instance_code,t.id::text source_task_id,t.task_code,t.department_code,dm.display_name department_name,u.full_name assigned_to_name,
      f.id::text final_file_id,f.file_name final_file_name,f.mime_type final_file_mime,f.file_size final_file_size,
      tv.id::text template_version_id,tv.version_no,tv.parsed_data template_data,
      coalesce(x.targets,'[]'::json) targets,
      coalesce(s.schedule,'[]'::json) original_schedule
    from marketing.publish_prep_items pi
    join marketing.campaigns c on c.id=pi.campaign_id join marketing.creatives cr on cr.id=pi.creative_id join marketing.tasks t on t.id=pi.source_task_id
    left join marketing.department_mappings dm on dm.department_code=t.department_code
    left join core.users u on u.id=t.assigned_to left join marketing.task_files f on f.id=pi.final_file_id left join marketing.task_template_versions tv on tv.id=pi.approved_template_version_id
    left join lateral (
      select json_agg(json_build_object('id',pt.id::text,'platform_id',pt.platform_id::text,'platform_code',pc.code,'platform_name',pc.name,'post_type_id',pt.post_type_id::text,'post_type_code',pst.code,'post_type_name',pst.name,'scheduled_at',pt.scheduled_at,'status',pt.status,'published_url',pt.published_url,'external_id',pt.external_id,'error_message',pt.error_message) order by pc.sort_order,pst.sort_order) targets
      from marketing.publish_targets pt join marketing.platform_catalog pc on pc.id=pt.platform_id left join marketing.platform_post_types pst on pst.id=pt.post_type_id where pt.publish_prep_item_id=pi.id
    ) x on true
    left join lateral (
      select json_agg(json_build_object('schedule_id',si.id::text,'publish_date',si.publish_date,'caption',si.caption,'hashtags',si.hashtags,'platform_id',st.platform_id::text,'platform_name',pc.name,'post_type_id',st.post_type_id::text,'post_type_name',pst.name,'publish_time',st.publish_time,'dimensions',coalesce(st.dimensions,pst.dimensions)) order by si.publish_date,pc.sort_order,pst.sort_order) schedule
      from marketing.publish_schedule_items si join marketing.publish_schedule_targets st on st.schedule_item_id=si.id join marketing.platform_catalog pc on pc.id=st.platform_id join marketing.platform_post_types pst on pst.id=st.post_type_id
      where si.campaign_id=pi.campaign_id and si.creative_id=pi.creative_id
    ) s on true
    where ${where} order by pi.updated_at desc limit ${pageSize} offset ${offset}
  `;
  const [contactCount] = await sql<{ total: number }[]>`select count(*)::int total from marketing.whatsapp_contacts where is_active=true`;
  const [stats] = await sql<any[]>`
    select count(*)::int all_tasks,
      count(*) filter(where pi.final_file_id is not null and exists(select 1 from marketing.publish_targets pt where pt.publish_prep_item_id=pi.id and pt.status in ('ready','scheduled','publishing','published')))::int ready,
      count(*) filter(where pi.final_file_id is not null and (not exists(select 1 from marketing.publish_targets pt where pt.publish_prep_item_id=pi.id) or exists(select 1 from marketing.publish_targets pt where pt.publish_prep_item_id=pi.id and pt.scheduled_at is null and pt.status<>'published')))::int waiting_date,
      count(*) filter(where pi.final_file_id is null or pi.approved_template_version_id is null or coalesce(nullif(trim(pi.caption),''),nullif(trim(pi.hashtags),'')) is null)::int missing,
      count(*) filter(where pi.final_file_id is not null)::int files_uploaded
    from marketing.publish_prep_items pi
    join marketing.campaigns c on c.id=pi.campaign_id
    join marketing.tasks t on t.id=pi.source_task_id
    where c.is_deleted=false and ${scope}
  `;
  const departments = await sql<any[]>`
    select distinct t.department_code,coalesce(dm.display_name,t.department_code) department_name
    from marketing.publish_prep_items pi join marketing.campaigns c on c.id=pi.campaign_id join marketing.tasks t on t.id=pi.source_task_id
    left join marketing.department_mappings dm on dm.department_code=t.department_code
    where c.is_deleted=false and ${scope} order by department_name
  `;
  return { ok: true, rows, total: Number(count?.total || 0), page, pageSize, whatsappContactsCount: Number(contactCount?.total || 0), stats: stats || {}, departments };
}

export async function publishPrepAction(user: SessionUser, body: Record<string, any>) {
  if (!hasPermission(user, "marketing.publish_prep.manage")) throw new MarketingError(403, "لا توجد لديك صلاحية إدارة تجهيز النشر", "FORBIDDEN");
  const sql = getSql();
  const action = clean(body.action);
  const id = clean(body.id || body.publishPrepId);
  if (action === "execute_publish_target") {
    const targetId = clean(body.targetId);
    if (!targetId) throw new MarketingError(400, "هدف النشر مطلوب", "VALIDATION_ERROR");
    return executePublishTarget({ source: "manual", user }, targetId);
  }
  if (!id) throw new MarketingError(400, "عنصر تجهيز النشر مطلوب", "VALIDATION_ERROR");
  if (action === "save_publish_prep") {
    const caption = clean(body.caption);
    const hashtags = clean(body.hashtags);
    const recipients = [...new Set(arrayValue(body.recipients).flatMap((value) => String(value || "").split(/[,،\n]+/)).map((value) => clean(value)).filter(Boolean))];
    const useSavedContacts = body.useSavedContacts === true;
    const targets = arrayValue<any>(body.targets);
    return sql.begin(async (tx) => {
      const [item] = await tx<any[]>`select *,id::text from marketing.publish_prep_items where id=${id}::uuid for update`;
      if (!item) throw new MarketingError(404, "عنصر تجهيز النشر غير موجود", "NOT_FOUND");
      await tx`update marketing.publish_prep_items set caption=${caption || null},hashtags=${hashtags || null},recipients=${recipients},use_saved_contacts=${useSavedContacts},status=${targets.length ? "ready" : "draft"},updated_at=now() where id=${id}::uuid`;
      const keepIds: string[] = [];
      for (const target of targets) {
        const targetId = clean(target.id);
        const platformId = clean(target.platformId);
        const postTypeId = clean(target.postTypeId);
        const scheduledAt = clean(target.scheduledAt);
        if (!platformId || !postTypeId) continue;
        if (targetId) {
          const [updated] = await tx<any[]>`
            update marketing.publish_targets set platform_id=${platformId}::uuid,post_type_id=${postTypeId}::uuid,scheduled_at=${scheduledAt || null},
              status=case when status='published' then status when ${scheduledAt || ""}='' then 'ready' else 'scheduled' end,error_message=null,updated_at=now()
            where id=${targetId}::uuid and publish_prep_item_id=${id}::uuid returning id::text
          `;
          if (updated) keepIds.push(updated.id);
        } else {
          const [created] = await tx<any[]>`
            insert into marketing.publish_targets(publish_prep_item_id,platform_id,post_type_id,scheduled_at,status,idempotency_key)
            values (${id}::uuid,${platformId}::uuid,${postTypeId}::uuid,${scheduledAt || null},case when ${scheduledAt || ""}='' then 'ready' else 'scheduled' end,encode(gen_random_bytes(18),'hex')) returning id::text
          `;
          keepIds.push(created.id);
        }
      }
      if (keepIds.length) await tx`delete from marketing.publish_targets where publish_prep_item_id=${id}::uuid and id::text not in ${tx(keepIds)}`;
      else await tx`delete from marketing.publish_targets where publish_prep_item_id=${id}::uuid`;
      return { ok: true, message: "تم حفظ تجهيز النشر وتحديث التقويم" };
    });
  }
  throw new MarketingError(400, "إجراء تجهيز النشر غير مدعوم", "INVALID_ACTION");
}

export async function platformConnections(user: SessionUser) {
  const sql = getSql();
  const rows = await sql<any[]>`
    select p.id::text,p.code,p.name,p.icon,p.status catalog_status,p.capability_state,p.sort_order,
      c.id::text connection_id,coalesce(c.status,p.status) status,coalesce(c.mode,case when p.code='tiktok' then 'sandbox' else 'production' end) mode,
      c.account_id,c.account_name,c.profile_id,c.scopes,c.expires_at,c.last_refreshed_at,c.last_error,c.updated_at,
      exists(select 1 from marketing.publish_jobs pj join marketing.publish_targets pt on pt.id=pj.target_id where pt.platform_id=p.id and pj.status='published') has_published_jobs
    from marketing.platform_catalog p left join marketing.platform_connections c on c.platform_id=p.id
    where p.is_active=true order by p.sort_order
  `;
  const recentJobs = await sql<any[]>`
    select pj.id::text,pj.status,pj.created_at,pj.started_at,pj.finished_at,pj.published_url,pj.error_message,
      pc.code platform_code,pc.name platform_name,pst.name post_type_name,c.campaign_code,c.name campaign_name,
      cr.creative_name,u.full_name requested_by_name
    from marketing.publish_jobs pj
    join marketing.publish_targets pt on pt.id=pj.target_id
    join marketing.publish_prep_items pi on pi.id=pt.publish_prep_item_id
    join marketing.platform_catalog pc on pc.id=pt.platform_id
    left join marketing.platform_post_types pst on pst.id=pt.post_type_id
    join marketing.campaigns c on c.id=pi.campaign_id
    join marketing.creatives cr on cr.id=pi.creative_id
    left join core.users u on u.id=pj.requested_by
    order by pj.created_at desc
    limit 80
  `;
  const [jobStats] = await sql<any[]>`
    select count(*)::int total,
      count(*) filter(where status='published')::int published,
      count(*) filter(where status='failed')::int failed,
      count(*) filter(where status='blocked')::int blocked,
      count(*) filter(where status='publishing')::int publishing
    from marketing.publish_jobs
  `;
  return { ok: true, rows, recentJobs, jobStats: jobStats || { total: 0, published: 0, failed: 0, blocked: 0, publishing: 0 }, canManage: isAdmin(user) || hasPermission(user,"marketing.platforms.manage") };
}

async function connectionForCode(platformCode: string): Promise<PlatformConnection | null> {
  const sql = getSql();
  const [row] = await sql<any[]>`
    select c.*,c.id::text,c.platform_id::text,p.code platform_code,p.name platform_name
    from marketing.platform_connections c join marketing.platform_catalog p on p.id=c.platform_id where p.code=${platformCode}
  `;
  return row || null;
}

function callbackUri(request: VercelRequest, provider: "meta" | "youtube") {
  const configured = provider === "meta" ? clean(process.env.META_REDIRECT_URI) : clean(process.env.YOUTUBE_REDIRECT_URI);
  return configured || `${requestOrigin(request.headers)}/api/marketing?resource=oauth_callback&platform=${provider}`;
}

export async function platformAction(request: VercelRequest, user: SessionUser, body: Record<string, any>) {
  if (!hasPermission(user, "marketing.platforms.manage")) throw new MarketingError(403, "إدارة ربط المنصات متاحة للأدمن فقط", "FORBIDDEN");
  const action = clean(body.action);
  const platformCode = clean(body.platformCode).toLowerCase();
  const sql = getSql();
  const [platform] = await sql<any[]>`select *,id::text from marketing.platform_catalog where code=${platformCode} and is_active=true`;
  if (!platform) throw new MarketingError(404, "المنصة غير موجودة", "PLATFORM_NOT_FOUND");

  if (action === "disconnect_platform") {
    const codes = platformCode === "facebook" ? ["facebook", "instagram"] : [platformCode];
    await sql`
      update marketing.platform_connections c set status='disconnected',access_token_encrypted=null,refresh_token_encrypted=null,account_id=null,account_name=null,profile_id=null,expires_at=null,last_error=null,updated_at=now(),connected_by=${user.id}::uuid
      from marketing.platform_catalog p where p.id=c.platform_id and p.code in ${sql(codes)}
    `;
    return { ok: true, message: `تم فصل ${platform.name}` };
  }

  if (action === "begin_platform_oauth") {
    if (platformCode === "snapchat") throw new MarketingError(409, "Snapchat بانتظار موافقة Public Profile API Allowlist", "WAITING_ALLOWLIST");
    if (platformCode === "tiktok") throw new MarketingError(409, "TikTok ما زال في Sandbox / Review ولم يتم تفعيل Draft Upload إنتاجيًا", "SANDBOX_UNDER_REVIEW");
    if (["facebook", "instagram"].includes(platformCode)) {
      if (!metaConfigured()) throw new MarketingError(503, "بيانات تطبيق Meta غير مضبوطة في Environment Variables", "OAUTH_NOT_CONFIGURED");
      const redirectUri = callbackUri(request, "meta");
      const state = await createOAuthState({ platformCode: "meta", redirectUri, user });
      return { ok: true, redirectUrl: metaAuthorizationUrl(redirectUri, state), message: "جاري فتح Meta OAuth" };
    }
    if (platformCode === "youtube") {
      if (!youtubeConfigured()) throw new MarketingError(503, "بيانات تطبيق YouTube غير مضبوطة في Environment Variables", "OAUTH_NOT_CONFIGURED");
      const redirectUri = callbackUri(request, "youtube");
      const state = await createOAuthState({ platformCode: "youtube", redirectUri, user });
      return { ok: true, redirectUrl: youtubeAuthorizationUrl(redirectUri, state), message: "جاري فتح YouTube OAuth" };
    }
    if (platformCode === "whatsapp") {
      const validation = await validateMersal();
      await sql`
        insert into marketing.platform_connections(platform_id,status,mode,account_name,scopes,last_refreshed_at,last_error,connected_by,updated_at)
        values (${platform.id}::uuid,'connected','production','Mersal',array['text','image_template'],now(),null,${user.id}::uuid,now())
        on conflict(platform_id) do update set status='connected',mode='production',account_name='Mersal',scopes=array['text','image_template'],last_refreshed_at=now(),last_error=null,connected_by=${user.id}::uuid,updated_at=now()
      `;
      return { ok: true, message: `تم التحقق من مرسال — ${validation.templates} قالب` };
    }
  }

  if (action === "list_platform_accounts") {
    if (!["facebook", "instagram"].includes(platformCode)) throw new MarketingError(400, "اختيار الحساب متاح لـMeta فقط", "INVALID_ACTION");
    const connection = await connectionForCode("facebook");
    if (!connection) throw new MarketingError(409, "ابدأ ربط Meta أولًا", "PLATFORM_NOT_CONNECTED");
    return { ok: true, rows: await listMetaAccounts(connection) };
  }

  if (action === "select_platform_account") {
    if (!["facebook", "instagram"].includes(platformCode)) throw new MarketingError(400, "اختيار الحساب متاح لـMeta فقط", "INVALID_ACTION");
    const selected = await selectMetaPage(user, clean(body.accountId));
    return { ok: true, selected, message: "تم حفظ صفحة Facebook وحساب Instagram المرتبط" };
  }

  throw new MarketingError(400, "إجراء المنصة غير مدعوم", "INVALID_ACTION");
}

export async function platformOAuthCallback(request: VercelRequest, response: VercelResponse, user: SessionUser) {
  if (!hasPermission(user, "marketing.platforms.manage")) throw new MarketingError(403, "إدارة ربط المنصات متاحة للأدمن فقط", "FORBIDDEN");
  const provider = clean(request.query.platform).toLowerCase();
  const code = clean(request.query.code);
  const state = clean(request.query.state);
  const denied = clean(request.query.error_description || request.query.error);
  const base = `${requestOrigin(request.headers)}/marketing/platforms`;
  if (denied) return response.redirect(302, `${base}?oauth_error=${encodeURIComponent(denied)}`);
  if (!code || !state || !["meta", "youtube"].includes(provider)) return response.redirect(302, `${base}?oauth_error=${encodeURIComponent("بيانات OAuth غير مكتملة")}`);
  try {
    const stored = await consumeOAuthState({ platformCode: provider, state, user });
    if (provider === "meta") {
      const token = await exchangeMetaCode(code, stored.redirect_uri);
      const result = await saveMetaOAuthConnection(user, token.accessToken, token.expiresIn);
      return response.redirect(302, `${base}?oauth_success=meta&accounts=${result.pages}`);
    }
    const token = await exchangeYouTubeCode(code, stored.redirect_uri);
    const channel = await saveYouTubeConnection(user, token);
    return response.redirect(302, `${base}?oauth_success=youtube&account=${encodeURIComponent(channel.title)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر ربط المنصة";
    return response.redirect(302, `${base}?oauth_error=${encodeURIComponent(message)}`);
  }
}
