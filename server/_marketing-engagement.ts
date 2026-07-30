import { getSql } from "./_db.js";
import { ensureCrmSchema } from "./_crm-schema.js";
import { ensureMarketingSchema } from "./_marketing-schema.js";
import { classifyConversationService, ensureContactIdentity } from "./_crm-lifecycle.js";
import { decryptPlatformToken } from "./_platform-connections.js";

function clean(value: unknown) { return String(value ?? "").trim(); }
function asObject(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function asArray<T = any>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function numberValue(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function graphVersion() { return clean(process.env.META_GRAPH_VERSION) || "v25.0"; }

type MetaGraphHost = "facebook" | "instagram";
type MetaGraphFailure = Error & { meta?: Record<string, any> };

function metaGraphOrigin(host: MetaGraphHost) {
  return host === "instagram" ? "https://graph.instagram.com" : "https://graph.facebook.com";
}

async function graphRequest(path: string, method: "GET" | "POST", token: string, params: Record<string, any> = {}, host: MetaGraphHost = "facebook") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${metaGraphOrigin(host)}/${graphVersion()}${normalizedPath}`);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    const encoded = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (method === "GET") url.searchParams.set(key, encoded); else body.set(key, encoded);
  }
  if (method === "GET") url.searchParams.set("access_token", token); else body.set("access_token", token);
  const response = await fetch(url, { method, headers: method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : undefined, body: method === "POST" ? body : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    const metaError = asObject(payload?.error);
    const message = clean(metaError.error_user_msg || metaError.message || payload?.message) || `Meta API error (${response.status})`;
    const failure = new Error(message) as MetaGraphFailure;
    failure.meta = {
      host,
      path: normalizedPath,
      status: response.status,
      type: clean(metaError.type),
      code: numberValue(metaError.code) || null,
      subcode: numberValue(metaError.error_subcode) || null,
      traceId: clean(metaError.fbtrace_id),
    };
    throw failure;
  }
  return payload;
}

function connectionScopes(connection: any) {
  return asArray(connection?.scopes).map(clean).filter(Boolean);
}

function missingScopes(granted: string[], required: string[]) {
  return required.filter((scope) => !granted.includes(scope));
}

function subscriptionFields(payload: any) {
  const appId = clean(process.env.META_APP_ID);
  const rows = asArray(payload?.data);
  const row = rows.find((item: any) => appId && clean(item?.id) === appId) || rows[0];
  return asArray(row?.subscribed_fields).map(clean).filter(Boolean);
}

function subscriptionFailure(error: any) {
  const details = asObject((error as MetaGraphFailure)?.meta);
  return {
    error: clean(error?.message) || "تعذر تنفيذ اشتراك Meta",
    errorDetails: {
      status: numberValue(details.status) || null,
      type: clean(details.type),
      code: numberValue(details.code) || null,
      subcode: numberValue(details.subcode) || null,
      traceId: clean(details.traceId),
      host: clean(details.host),
      path: clean(details.path),
    },
  };
}

function publishedIds(platform: string, resultInput: unknown) {
  const result = asObject(resultInput);
  if (platform === "facebook") {
    const publish = asObject(result.publish);
    const providerPostId = clean(result.post_id || publish.post_id || publish.id || result.id);
    const providerMediaId = clean(result.id || asArray(result.uploads)[0]?.id || providerPostId);
    return { providerPostId, providerMediaId };
  }
  const publish = asObject(result.publish);
  const providerPostId = clean(publish.id || result.id);
  const providerMediaId = providerPostId;
  return { providerPostId, providerMediaId };
}

export async function recordPublishedPost(sql: ReturnType<typeof getSql>, schedule: any, result: unknown) {
  const platform = clean(schedule.platform_code || schedule.platform);
  if (!['facebook','instagram'].includes(platform)) return null;
  const { providerPostId, providerMediaId } = publishedIds(platform, result);
  if (!providerPostId) throw new Error("لم ترجع المنصة معرف المنشور بعد نجاح النشر");
  const [connection] = await sql<any[]>`
    select platform,page_id,ig_user_id,account_id from marketing.platform_connections where platform=${platform} and connected=true limit 1
  `;
  const accountId = platform === "facebook" ? clean(connection?.page_id || connection?.account_id) : clean(connection?.ig_user_id || connection?.account_id);
  if (!accountId) throw new Error(`حساب ${platform === 'facebook' ? 'Facebook' : 'Instagram'} غير مكتمل`);
  const [row] = await sql<any[]>`
    insert into marketing.published_posts(
      schedule_id,source_type,source_id,creative_id,task_id,platform,account_id,provider_post_id,provider_media_id,post_type_name,published_at,raw_metrics
    ) values(
      ${schedule.id}::uuid,${schedule.source_type},${schedule.source_id}::uuid,${schedule.creative_id || null}::uuid,${schedule.task_id || null}::uuid,
      ${platform},${accountId},${providerPostId},${providerMediaId || null},${clean(schedule.post_type_name) || null},now(),${sql.json({ publishResult: result } as any)}
    ) on conflict(schedule_id) do update set
      platform=excluded.platform,account_id=excluded.account_id,provider_post_id=excluded.provider_post_id,provider_media_id=excluded.provider_media_id,
      post_type_name=excluded.post_type_name,published_at=excluded.published_at,sync_status='pending',sync_error=null,
      raw_metrics=coalesce(marketing.published_posts.raw_metrics,'{}'::jsonb)||excluded.raw_metrics,updated_at=now()
    returning *,id::text,schedule_id::text,source_id::text,creative_id::text,task_id::text
  `;
  return row;
}

export async function backfillPublishedPosts(sql: ReturnType<typeof getSql>) {
  const schedules = await sql<any[]>`
    select s.*,s.id::text,s.source_id::text,s.creative_id::text,s.task_id::text,p.code as platform_code,pt.name as post_type_name
    from marketing.publish_schedule s
    join marketing.platforms p on p.id=s.platform_id
    left join marketing.platform_post_types pt on pt.id=s.post_type_id
    left join marketing.published_posts pp on pp.schedule_id=s.id
    where s.status='published' and pp.id is null and p.code in ('facebook','instagram') and coalesce(s.publish_result,'{}'::jsonb)<>'{}'::jsonb
    order by s.published_at
  `;
  let created = 0;
  for (const schedule of schedules) {
    try { if (await recordPublishedPost(sql, schedule, schedule.publish_result)) created += 1; }
    catch (error) { console.error("Engagement backfill skipped", { scheduleId: schedule.id, error }); }
  }
  return created;
}

async function platformConnection(sql: ReturnType<typeof getSql>, platform: string) {
  const [connection] = await sql<any[]>`select * from marketing.platform_connections where platform=${platform} and connected=true limit 1`;
  if (!connection) throw new Error(`ربط ${platform === 'facebook' ? 'Facebook' : 'Instagram'} غير متاح`);
  const token = decryptPlatformToken(connection.page_access_token_encrypted || connection.access_token_encrypted || connection.user_access_token_encrypted);
  if (!token) throw new Error(`توكن ${platform === 'facebook' ? 'Facebook' : 'Instagram'} غير متاح`);
  return { connection, token };
}

async function refreshOne(sql: ReturnType<typeof getSql>, post: any) {
  try {
    const { token } = await platformConnection(sql, post.platform);
    let payload: any;
    let likes = 0, comments = 0, shares = 0, saves = 0, views = 0, reach = 0;
    let permalink = clean(post.permalink);
    if (post.platform === 'facebook') {
      payload = await graphRequest(`/${encodeURIComponent(post.provider_post_id)}`, 'GET', token, {
        fields: 'id,permalink_url,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares',
      });
      likes = numberValue(payload?.reactions?.summary?.total_count);
      comments = numberValue(payload?.comments?.summary?.total_count);
      shares = numberValue(payload?.shares?.count);
      permalink = clean(payload?.permalink_url || permalink);
    } else {
      payload = await graphRequest(`/${encodeURIComponent(post.provider_media_id || post.provider_post_id)}`, 'GET', token, {
        fields: 'id,permalink,like_count,comments_count,media_type,timestamp',
      });
      likes = numberValue(payload?.like_count);
      comments = numberValue(payload?.comments_count);
      permalink = clean(payload?.permalink || permalink);
      try {
        const insight = await graphRequest(`/${encodeURIComponent(post.provider_media_id || post.provider_post_id)}/insights`, 'GET', token, {
          metric: 'reach,views,saved,shares',
        });
        for (const metric of asArray(insight?.data)) {
          const value = numberValue(asArray(metric?.values)[0]?.value ?? metric?.value);
          if (metric?.name === 'reach') reach = value;
          if (metric?.name === 'views') views = value;
          if (metric?.name === 'saved') saves = value;
          if (metric?.name === 'shares') shares = value;
        }
        payload = { ...payload, insights: insight };
      } catch (error: any) {
        payload = { ...payload, insightsWarning: clean(error?.message) };
      }
    }
    await sql.begin(async tx => {
      await tx`
        update marketing.published_posts set permalink=${permalink || null},likes_count=${likes},comments_count=${comments},shares_count=${shares},
          saves_count=${saves},views_count=${views},reach_count=${reach},last_synced_at=now(),sync_status='synced',sync_error=null,
          raw_metrics=coalesce(raw_metrics,'{}'::jsonb)||${tx.json({ latest: payload } as any)}::jsonb,updated_at=now()
        where id=${post.id}::uuid
      `;
      await tx`
        insert into marketing.engagement_snapshots(published_post_id,snapshot_date,likes_count,comments_count,shares_count,saves_count,views_count,reach_count)
        values(${post.id}::uuid,current_date,${likes},${comments},${shares},${saves},${views},${reach})
        on conflict(published_post_id,snapshot_date) do update set likes_count=excluded.likes_count,comments_count=excluded.comments_count,
          shares_count=excluded.shares_count,saves_count=excluded.saves_count,views_count=excluded.views_count,reach_count=excluded.reach_count,updated_at=now()
      `;
    });
    return { id: post.id, ok: true };
  } catch (error: any) {
    const message = clean(error?.message) || 'تعذر تحديث التفاعل';
    await sql`update marketing.published_posts set last_synced_at=now(),sync_status='failed',sync_error=${message},updated_at=now() where id=${post.id}::uuid`;
    return { id: post.id, ok: false, error: message };
  }
}

export async function refreshEngagementMetrics(sql: ReturnType<typeof getSql>, ids: string[] = []) {
  await backfillPublishedPosts(sql);
  const rows = ids.length
    ? await sql<any[]>`select *,id::text from marketing.published_posts where id=any(${ids}::uuid[]) order by published_at desc`
    : await sql<any[]>`select *,id::text from marketing.published_posts order by published_at desc`;
  const results = [];
  for (const row of rows) results.push(await refreshOne(sql, row));
  return { ok: true, results, updated: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length };
}

export async function engagementData(sql: ReturnType<typeof getSql>) {
  await ensureCrmSchema();
  await backfillPublishedPosts(sql);
  const rows = await sql<any[]>`
    select pp.*,pp.id::text,pp.schedule_id::text,pp.source_id::text,pp.creative_id::text,pp.task_id::text,
      coalesce(campaign.name,agenda.name,'—') as source_name,
      coalesce(cr.name,cr.instance_code,cr.creative_type,'—') as creative_name,
      coalesce(t.title,'—') as task_name,
      coalesce(u.full_name,'—') as assigned_name
    from marketing.published_posts pp
    left join marketing.campaigns campaign on pp.source_type='campaign' and campaign.id=pp.source_id
    left join marketing.agendas agenda on pp.source_type='agenda' and agenda.id=pp.source_id
    left join marketing.creatives cr on cr.id=pp.creative_id
    left join marketing.tasks t on t.id=pp.task_id
    left join core.users u on u.id=t.assigned_to
    order by pp.published_at desc
  `;
  const comments = await sql<any[]>`
    select pc.*,pc.id::text,pc.published_post_id::text,pc.crm_lead_id::text,
      pp.platform,coalesce(campaign.name,agenda.name,'—') as campaign_name,
      coalesce(cr.name,cr.instance_code,cr.creative_type,'—') as creative_name,
      l.customer_name,l.branch_code,l.status_label,l.source_name as crm_source_name,
      sales.full_name as assigned_name
    from marketing.post_comments pc
    join marketing.published_posts pp on pp.id=pc.published_post_id
    left join marketing.campaigns campaign on pp.source_type='campaign' and campaign.id=pp.source_id
    left join marketing.agendas agenda on pp.source_type='agenda' and agenda.id=pp.source_id
    left join marketing.creatives cr on cr.id=pp.creative_id
    left join crm.leads l on l.id=pc.crm_lead_id
    left join core.users sales on sales.id=l.assigned_to
    order by coalesce(pc.commented_at,pc.created_at) desc limit 200
  `;
  const summary = rows.reduce((total: any, row: any) => ({
    posts: total.posts + 1,
    likes: total.likes + numberValue(row.likes_count),
    comments: total.comments + numberValue(row.comments_count),
    shares: total.shares + numberValue(row.shares_count),
    saves: total.saves + numberValue(row.saves_count),
    views: total.views + numberValue(row.views_count),
    reach: total.reach + numberValue(row.reach_count),
  }), { posts: 0, likes: 0, comments: 0, shares: 0, saves: 0, views: 0, reach: 0 });
  const crmLeads = new Set(comments.map((row: any) => clean(row.crm_lead_id)).filter(Boolean)).size;
  const connections = await sql<any[]>`select platform,metadata from marketing.platform_connections where platform in ('facebook','instagram') order by platform`;
  const subscriptionResults = connections.flatMap((row: any) => {
    const stored = asObject(asObject(row.metadata).engagementWebhookSubscription);
    const direct = asObject(stored.result);
    if (clean(direct.platform)) return [direct];
    return asArray(stored.results).filter((item: any) => clean(item?.platform) === clean(row.platform));
  });
  const callbackBase = clean(process.env.MZJ_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : ''));
  return {
    ok: true, rows, comments, summary: { ...summary, crmLeads },
    webhook: {
      callbackUrl: callbackBase ? `${callbackBase.replace(/\/$/,'')}/api/integrations/meta/engagement-webhook` : '/api/integrations/meta/engagement-webhook',
      verifyTokenConfigured: Boolean(clean(process.env.META_WEBHOOK_VERIFY_TOKEN)),
      subscriptionResults,
    },
  };
}

type SubscriptionTarget = {
  platform: 'facebook' | 'instagram';
  field: 'feed' | 'comments';
  accountId: string;
  accountName: string;
  host: MetaGraphHost;
  token: string;
  grantedScopes: string[];
  requiredScopes: string[];
};

async function subscribeTarget(target: SubscriptionTarget) {
  const missing = missingScopes(target.grantedScopes, target.requiredScopes);
  const base = {
    platform: target.platform,
    field: target.field,
    accountId: target.accountId,
    accountName: target.accountName,
    host: target.host,
    endpoint: `/${target.accountId}/subscribed_apps`,
    grantedScopes: target.grantedScopes,
    requiredScopes: target.requiredScopes,
    missingScopes: missing,
  };
  if (missing.length) return { ...base, ok: false, error: `التوكن الحالي لا يحتوي الصلاحيات المطلوبة: ${missing.join(', ')}`, errorDetails: {} };
  try {
    const result = await graphRequest(`/${encodeURIComponent(target.accountId)}/subscribed_apps`, 'POST', target.token, { subscribed_fields: target.field }, target.host);
    const verification = await graphRequest(`/${encodeURIComponent(target.accountId)}/subscribed_apps`, 'GET', target.token, {}, target.host);
    const fields = subscriptionFields(verification);
    if (!fields.includes(target.field)) {
      return { ...base, ok: false, result, verification, subscribedFields: fields, error: `Meta استقبلت طلب الاشتراك لكن الحقل ${target.field} لم يظهر ضمن الاشتراكات الفعلية`, errorDetails: {} };
    }
    return { ...base, ok: true, result, verification, subscribedFields: fields };
  } catch (error: any) {
    return { ...base, ok: false, ...subscriptionFailure(error) };
  }
}

export async function subscribeMetaEngagementWebhooks(sql: ReturnType<typeof getSql>) {
  const results: any[] = [];
  for (const platform of ['facebook','instagram'] as const) {
    try {
      const linked = await platformConnection(sql, platform);
      const grantedScopes = connectionScopes(linked.connection);
      const isFacebook = platform === 'facebook';
      const accountId = isFacebook
        ? clean(linked.connection.page_id || linked.connection.account_id)
        : clean(linked.connection.ig_user_id || linked.connection.account_id);
      if (!accountId) throw new Error(isFacebook ? 'Page ID الخاص بـFacebook غير موجود' : 'Instagram Account ID غير موجود');
      const instagramLogin = !isFacebook && grantedScopes.some((scope) => scope.startsWith('instagram_business_'));
      results.push(await subscribeTarget({
        platform,
        field: isFacebook ? 'feed' : 'comments',
        accountId,
        accountName: clean(linked.connection.page_name || linked.connection.account_name || linked.connection.username),
        host: instagramLogin ? 'instagram' : 'facebook',
        token: linked.token,
        grantedScopes,
        requiredScopes: isFacebook ? ['pages_manage_metadata'] : [instagramLogin ? 'instagram_business_manage_comments' : 'instagram_manage_comments'],
      }));
    } catch (error: any) {
      results.push({ platform, field: platform === 'facebook' ? 'feed' : 'comments', ok: false, ...subscriptionFailure(error) });
    }
  }
  const updatedAt = new Date().toISOString();
  for (const item of results) {
    await sql`
      update marketing.platform_connections
      set metadata=coalesce(metadata,'{}'::jsonb)||${sql.json({ engagementWebhookSubscription: { result: item, updatedAt } } as any)}::jsonb,updated_at=now()
      where platform=${item.platform}
    `;
  }
  const subscriptionOk = results.every((item) => item.ok);
  return {
    ok: true,
    subscriptionOk,
    results,
    message: subscriptionOk ? 'تم تفعيل استقبال تعليقات Facebook وInstagram والتحقق من الاشتراكات' : 'تعذر تفعيل استقبال التعليقات على منصة أو أكثر؛ راجع التفاصيل أدناه',
  };
}

type NormalizedComment = {
  platform: 'facebook' | 'instagram'; accountId: string; postIds: string[]; commentId: string;
  commenterId: string; commenterName: string; text: string; commentedAt: string; raw: any;
};

function normalizeWebhook(payload: any): NormalizedComment[] {
  const output: NormalizedComment[] = [];
  const object = clean(payload?.object).toLowerCase();
  for (const entry of asArray(payload?.entry)) {
    const accountId = clean(entry?.id);
    for (const change of asArray(entry?.changes)) {
      const value = asObject(change?.value);
      if (object === 'page' && clean(change?.field) === 'feed' && clean(value?.item) === 'comment' && clean(value?.verb) === 'add') {
        const from = asObject(value?.from);
        const commentId = clean(value?.comment_id || value?.id);
        const commenterId = clean(from?.id);
        if (commentId && commenterId) output.push({
          platform: 'facebook', accountId, postIds: [clean(value?.post_id), clean(value?.parent_id)].filter(Boolean), commentId,
          commenterId, commenterName: clean(from?.name) || 'عميل Facebook', text: clean(value?.message),
          commentedAt: value?.created_time ? new Date(numberValue(value.created_time) * 1000).toISOString() : new Date(numberValue(entry?.time) * 1000 || Date.now()).toISOString(), raw: change,
        });
      }
      if (object === 'instagram' && clean(change?.field) === 'comments') {
        const from = asObject(value?.from);
        const media = asObject(value?.media);
        const commentId = clean(value?.id || value?.comment_id);
        const commenterId = clean(from?.id);
        if (commentId && commenterId) output.push({
          platform: 'instagram', accountId, postIds: [clean(media?.id), clean(value?.media_id)].filter(Boolean), commentId,
          commenterId, commenterName: clean(from?.username || from?.name) || 'عميل Instagram', text: clean(value?.text || value?.message),
          commentedAt: new Date(numberValue(entry?.time) * 1000 || Date.now()).toISOString(), raw: change,
        });
      }
    }
  }
  return output;
}

async function findPublishedPost(sql: ReturnType<typeof getSql>, comment: NormalizedComment) {
  const candidates = [...new Set(comment.postIds.map(clean).filter(Boolean))];
  if (!candidates.length) return null;
  const [post] = await sql<any[]>`
    select *,id::text,source_id::text,creative_id::text,task_id::text from marketing.published_posts
    where platform=${comment.platform} and account_id=${comment.accountId}
      and (provider_post_id=any(${candidates}::text[]) or coalesce(provider_media_id,'')=any(${candidates}::text[]))
    order by published_at desc limit 1
  `;
  return post || null;
}

async function createCrmLeadFromComment(sql: ReturnType<typeof getSql>, post: any, comment: NormalizedComment) {
  const sourceCode = comment.platform === 'facebook' ? 'facebook_post' : 'instagram_post';
  const sourceName = comment.platform === 'facebook' ? 'بوست فيس بوك' : 'بوست انستجرام';
  const { contact } = await ensureContactIdentity({
    channelCode: comment.platform,
    externalId: comment.commenterId,
    participantId: comment.commenterId,
    pageId: comment.accountId,
    displayName: comment.commenterName,
    metadata: { origin: 'post_comment', sourceCode, providerPostId: post.provider_post_id },
  });
  const legacyId = `post-comment:${comment.platform}:${comment.accountId}:${comment.commenterId}`;
  const [conversation] = await sql<any[]>`
    insert into crm.conversations(
      legacy_id,contact_id,channel_code,customer_name,participant_id,status,preview_text,unread_count,last_message_at,
      provider,page_id,classification_state,last_customer_message_at,metadata
    ) values(
      ${legacyId},${contact.id}::uuid,${comment.platform},${comment.commenterName},${comment.commenterId},'open',${comment.text || 'تعليق على منشور'},1,${comment.commentedAt}::timestamptz,
      'meta',${comment.accountId},'new',${comment.commentedAt}::timestamptz,${sql.json({ origin: 'post_comment', sourceCode, publishedPostId: post.id, providerPostId: post.provider_post_id } as any)}
    ) on conflict(legacy_id) do update set
      contact_id=excluded.contact_id,customer_name=coalesce(nullif(excluded.customer_name,''),crm.conversations.customer_name),
      preview_text=coalesce(nullif(excluded.preview_text,''),crm.conversations.preview_text),unread_count=greatest(crm.conversations.unread_count,1),
      last_message_at=greatest(coalesce(crm.conversations.last_message_at,'epoch'),excluded.last_message_at),
      last_customer_message_at=greatest(coalesce(crm.conversations.last_customer_message_at,'epoch'),excluded.last_customer_message_at),
      metadata=coalesce(crm.conversations.metadata,'{}'::jsonb)||excluded.metadata,updated_at=now()
    returning *,id::text,contact_id::text,lead_id::text,service_request_id::text
  `;
  const classification = await classifyConversationService({
    conversationId: conversation.id, serviceKey: 'cash', sourceCode, classificationMethod: 'meta_post_comment',
    eventKey: `${comment.platform}:${comment.commentId}`, skipAutomaticTemplate: true, assignPrimary: true, assignCallCenter: false,
  });
  const [source] = post.source_type === 'agenda'
    ? await sql<any[]>`select name from marketing.agendas where id=${post.source_id}::uuid`
    : await sql<any[]>`select name from marketing.campaigns where id=${post.source_id}::uuid`;
  const leadId = clean(classification.leadId || classification.request?.lead_id);
  if (!leadId) throw new Error('تعذر تحديد عميل CRM بعد التوزيع');
  await sql`
    update crm.leads set source_code=${sourceCode},source_name=${sourceName},platform_code=${comment.platform},campaign_name=${clean(source?.name) || null},
      extra_data=coalesce(extra_data,'{}'::jsonb)||${sql.json({
        socialComment: true, publishedPostId: post.id, providerPostId: post.provider_post_id,
        latestCommentId: comment.commentId, latestCommentText: comment.text,
      } as any)}::jsonb,updated_at=now()
    where id=${leadId}::uuid
  `;
  return { leadId, reused: Boolean(classification.reused) };
}

export async function processMetaEngagementWebhook(payload: any) {
  await Promise.all([ensureMarketingSchema(), ensureCrmSchema()]);
  const sql = getSql();
  const comments = normalizeWebhook(payload);
  const results: any[] = [];
  for (const comment of comments) {
    let commentRow: any = null;
    try {
      const post = await findPublishedPost(sql, comment);
      if (!post) { results.push({ commentId: comment.commentId, status: 'ignored', reason: 'post_not_published_by_platform' }); continue; }
      if (comment.commenterId === comment.accountId) { results.push({ commentId: comment.commentId, status: 'ignored', reason: 'own_account_comment' }); continue; }
      const [inserted] = await sql<any[]>`
        insert into marketing.post_comments(published_post_id,platform,provider_comment_id,provider_post_id,account_id,commenter_id,commenter_name,comment_text,commented_at,raw_payload)
        values(${post.id}::uuid,${comment.platform},${comment.commentId},${comment.postIds[0] || post.provider_post_id},${comment.accountId},${comment.commenterId},${comment.commenterName},${comment.text || null},${comment.commentedAt}::timestamptz,${sql.json(comment.raw as any)})
        on conflict(platform,provider_comment_id) do nothing returning *,id::text
      `;
      if (!inserted) { results.push({ commentId: comment.commentId, status: 'duplicate' }); continue; }
      commentRow = inserted;
      const lead = await createCrmLeadFromComment(sql, post, comment);
      await sql`update marketing.post_comments set crm_lead_id=${lead.leadId}::uuid,processing_status=${lead.reused ? 'reused' : 'created'},processing_error=null,updated_at=now() where id=${inserted.id}::uuid`;
      results.push({ commentId: comment.commentId, status: lead.reused ? 'reused' : 'created', leadId: lead.leadId });
    } catch (error: any) {
      const message = clean(error?.message) || 'تعذر تحويل التعليق إلى CRM';
      if (commentRow?.id) await sql`update marketing.post_comments set processing_status='failed',processing_error=${message},updated_at=now() where id=${commentRow.id}::uuid`;
      results.push({ commentId: comment.commentId, status: 'failed', error: message });
    }
  }
  return { ok: true, received: comments.length, results };
}
