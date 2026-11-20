/**
 * Read-only Marketing -> Strategy publication snapshot (v1).
 * This never creates/approves a task, changes a publishing schedule, or
 * publishes media. Strategy upserts by entry.id, then pulls approved media
 * bytes using the separate authenticated publication-file endpoint.
 */
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { VercelResponse } from '@vercel/node';
import type { getSql } from '../_db.js';
import { openGoogleDriveFile } from '../_google-drive-storage.js';
import { strategyCodeMap, type StrategyMarker, type StrategyAssignedItem } from '../../shared/marketing-idea-identity.js';

type Sql = ReturnType<typeof getSql>;
type Row = Record<string, any>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateText = (v: unknown) => String(v || '').slice(0, 10);
const str = (v: unknown) => String(v ?? '').trim();
export function validAgendaUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

export function agendaSyncSettings() {
  const secret = str(process.env.MZJ_STRATEGY_PUBLISH_SYNC_KEY);
  const rawUrl = str(process.env.MZJ_STRATEGY_PUBLISH_SYNC_URL);
  if (!rawUrl || secret.length < 32 || secret.length > 512 || !/^[a-zA-Z0-9._~-]+$/.test(secret)) {
    throw new Error('ربط نشر الأجندات بالاستراتيجية غير مكتمل: يجب إعداد عنوان الاستقبال ومفتاح المزامنة على السيرفر أولًا.');
  }
  if (secret === str(process.env.MZJ_STRATEGY_READ_KEY) || secret === str(process.env.MZJ_STRATEGY_ASSIGN_KEY)) {
    throw new Error('يجب استخدام مفتاح خاص لمزامنة النشر مختلف عن مفاتيح الربط القديمة.');
  }
  let destination: URL;
  try { destination = new URL(rawUrl); }
  catch { throw new Error('عنوان استقبال أجندات الاستراتيجية غير صالح.'); }
  if (destination.protocol !== 'https:' || destination.username || destination.password || destination.search ||
      destination.hash || (destination.port && destination.port !== '443') ||
      !destination.hostname.includes('.') || isIP(destination.hostname) !== 0 ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(destination.hostname)) {
    throw new Error('عنوان الاستقبال يجب أن يكون HTTPS عامًا وآمنًا دون معاملات أو إعادة توجيه.');
  }
  return { destination: destination.toString(), secret };
}

/** Each entry is a single agenda line + post type, even before any final upload. */
export async function buildAgendaPublicationSnapshot(sql: Sql, planId: string) {
  if (!validAgendaUuid(planId)) throw new Error('معرّف الأجندة غير صالح.');
  const [plan] = await sql<Row[]>`
    select p.id::text as id,p.plan_no,p.name,p.review_status,p.updated_at,
      coalesce(nullif(ag.payload->>'agendaFrom',''),ag.publish_start::text) as agenda_from,
      coalesce(nullif(ag.payload->>'agendaTo',''),ag.publish_end::text) as agenda_to
    from marketing.work_plans p join marketing.agendas ag on ag.id=p.id
    where p.id=${planId}::uuid and p.kind='agenda' and p.is_deleted=false`;
  if (!plan) throw new Error('الأجندة غير موجودة أو تم حذفها.');

  const lines = await sql<Row[]>`
    select l.id::text as line_id,l.product_id::text as product_id,l.post_type_id::text as post_type_id,
      l.scheduled_on::text as scheduled_on,l.caption,l.hashtags,
      i.task_id::text as task_id,i.client_key::text as client_key,i.idea_name,i.media_kind,i.sort_order,
      t.task_no,t.name as task_name,pt.name as post_type_name,pt.width as post_width,pt.height as post_height,
      pf.id::text as platform_id,pf.name as platform_name,pf.code as platform_code,
      requirement.requirement_number
    from marketing.work_plan_items l join marketing.work_items i on i.id=l.product_id
    join marketing.work_tasks t on t.id=i.task_id
    left join marketing.platform_post_types pt on pt.id=l.post_type_id
    left join marketing.platforms pf on pf.id=pt.platform_id
    left join lateral (select numbered.requirement_number from (
      select candidate.id,row_number() over(order by candidate.sort_order,candidate.created_at,candidate.id)::int as requirement_number
      from marketing.work_items candidate where candidate.task_id=i.task_id
    ) numbered where numbered.id=i.id) requirement on true
    where l.plan_id=${planId}::uuid and l.is_deleted=false and t.is_deleted=false
    order by l.scheduled_on,l.id`;
  if (!lines.length) throw new Error('الأجندة لا تحتوي على مطلوبات قابلة للمزامنة.');

  const lineIds = lines.map(row => str(row.line_id));
  const productIds = [...new Set(lines.map(row => str(row.product_id)))];
  const taskIds = [...new Set(lines.map(row => str(row.task_id)))];
  // Preparation may create several publish targets for one legacy plan line.
  const targets = await sql<Row[]>`
    select target.line_id::text,target.post_type_id::text,target.schedule_id::text,
      s.status as publish_status,s.caption,s.hashtags,
      pt.name as post_type_name,pt.width as post_width,pt.height as post_height,
      pf.id::text as platform_id,pf.name as platform_name,pf.code as platform_code
    from marketing.work_publish_targets target
    join marketing.publish_schedule s on s.id=target.schedule_id
    left join marketing.platform_post_types pt on pt.id=target.post_type_id
    left join marketing.platforms pf on pf.id=pt.platform_id
    where target.line_id=any(${lineIds}::uuid[]) and s.status<>'cancelled'
    order by target.line_id,target.post_type_id,target.schedule_id`;
  const formatsByLine = new Map<string, Row[]>();
  for (const target of targets) {
    const list = formatsByLine.get(str(target.line_id)) || [];
    if (!list.some(entry => str(entry.post_type_id) === str(target.post_type_id))) list.push(target);
    formatsByLine.set(str(target.line_id), list);
  }

  // Per-size review status is authoritative. Item-level approval must NOT
  // suppress a finished size merely because another executor/size is pending.
  const files = await sql<Row[]>`
    select j.item_id::text as product_id,j.file_id::text as file_id,j.format_id,j.order_index,
      f.original_name,f.mime_type,f.file_size,f.storage_provider,f.status as file_status,
      fmt.width,fmt.height,fmt.name as format_name
    from marketing.work_item_files j
    join marketing.files f on f.id=j.file_id and f.status='ready'
    join marketing.work_format_reviews review on review.item_id=j.item_id
      and review.format_id=j.format_id and review.status='approved'
    left join marketing.platform_post_types fmt on fmt.id::text=j.format_id
    where j.item_id=any(${productIds}::uuid[]) and j.category='final'
    order by j.item_id,j.order_index,j.created_at,j.file_id`;
  const filesByProduct = new Map<string,Row[]>();
  for (const file of files) filesByProduct.set(str(file.product_id),[...(filesByProduct.get(str(file.product_id))||[]),file]);

  // Reuse the existing immutable Strategy idea identity; no new identity table.
  const history = await sql<Row[]>`
    select t.id::text as task_id,h.data as marker
    from marketing.work_tasks t
    join lateral (select data from marketing.work_history
      where task_id=t.id and action='strategy_assigned' and data->>'source'='mzj-content-strategy'
      order by created_at desc,id desc limit 1) h on true
    where t.id=any(${taskIds}::uuid[])`;
  const markers = new Map(history.map(row => [str(row.task_id),row.marker as StrategyMarker]));
  const identityItems = await sql<(StrategyAssignedItem & {task_id:string})[]>`
    select id::text,task_id::text,client_key::text,idea_name,sort_order
    from marketing.work_items where task_id=any(${taskIds}::uuid[])
    order by task_id,sort_order,created_at,id`;
  const ideaCodes = new Map<string,string>();
  for (const taskId of taskIds) {
    const mapped = strategyCodeMap(markers.get(taskId),identityItems.filter(row => row.task_id === taskId));
    for (const [itemId,ideaCode] of mapped) ideaCodes.set(itemId,ideaCode);
  }
  const entries = lines.flatMap(line => {
    const postTargets = formatsByLine.get(str(line.line_id)) || [line];
    return postTargets.map(target => {
      const postTypeId = str(target.post_type_id);
      const width = Number(target.post_width) || null;
      const height = Number(target.post_height) || null;
      const approvedFiles = (filesByProduct.get(str(line.product_id)) || []).filter(file =>
        str(file.format_id) === postTypeId ||
        (width !== null && height !== null && Number(file.width) === width && Number(file.height) === height));
      const mediaFiles = approvedFiles.filter(file => file.storage_provider === 'google-drive');
      const media = mediaFiles.map(file => ({
        id: str(file.file_id), name: str(file.original_name), mimeType: str(file.mime_type),
        fileSize: Number(file.file_size) || 0, formatId: str(file.format_id),
        width: Number(file.width) || null, height: Number(file.height) || null,
        /** The Strategy SERVER uses its secret to GET actual binary bytes. */
        downloadPath: `/api/strategy-integration/publication-file?planId=${encodeURIComponent(planId)}&fileId=${encodeURIComponent(str(file.file_id))}`,
      }));
      const requestNo = str(line.task_no) && Number(line.requirement_number)
        ? `${str(line.task_no)}-${String(line.requirement_number).padStart(2,'0')}` : str(line.task_no);
      const fileStatus = !postTypeId || !str(target.platform_id) ? 'needs_publish_type'
        : media.length ? 'ready' : approvedFiles.length ? 'unsupported_storage' : 'waiting_file';
      return {
        id: `${str(line.line_id)}:${postTypeId || 'unassigned'}`,
        lineId: str(line.line_id), productId: str(line.product_id), taskId: str(line.task_id),
        taskNo: str(line.task_no), taskName: str(line.task_name), requestNo,
        requirementNumber: Number(line.requirement_number) || null,
        ideaName: str(line.idea_name), ideaCode: ideaCodes.get(str(line.product_id)) || '',
        mediaKind: str(line.media_kind), scheduledOn: dateText(line.scheduled_on),
        platform: postTypeId && target.platform_id ? { id: str(target.platform_id), code: str(target.platform_code), name: str(target.platform_name) } : null,
        postType: postTypeId ? { id: postTypeId, name: str(target.post_type_name), width, height } : null,
        caption: String(target.schedule_id ? target.caption ?? '' : line.caption ?? ''),
        hashtags: String(target.schedule_id ? target.hashtags ?? '' : line.hashtags ?? ''),
        publishStatus: str(target.publish_status) || null,
        fileStatus, files: media,
      };
    });
  });
  return {
    ok: true as const, schema: 'mzj-agenda-publishing/v1' as const, sourceSystem: 'mzj-marketing',
    agenda: { id: planId, planNo: str(plan.plan_no), name: str(plan.name),
      publishFrom: dateText(plan.agenda_from), publishTo: dateText(plan.agenda_to),
      reviewStatus: str(plan.review_status), updatedAt: plan.updated_at },
    entries,
    totals: { posts: entries.length, ready: entries.filter(item => item.fileStatus === 'ready').length,
      waiting: entries.filter(item => item.fileStatus === 'waiting_file').length,
      incomplete: entries.filter(item => !['ready','waiting_file'].includes(item.fileStatus)).length },
  };
}

/** Only a configured, fixed HTTPS destination may receive an explicit agenda sync. */
export async function sendAgendaPublicationSnapshot(sql: Sql, planId: string) {
  const { destination, secret } = agendaSyncSettings();
  const snapshot = await buildAgendaPublicationSnapshot(sql, planId);
  const body = JSON.stringify(snapshot);
  if (Buffer.byteLength(body,'utf8') > 2_500_000) throw new Error('بيانات الأجندة أكبر من الحد المسموح للمزامنة.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(destination, { method:'POST', redirect:'error', signal:controller.signal,
      headers:{ 'Content-Type':'application/json', 'Accept':'application/json', 'Authorization':`Bearer ${secret}` }, body });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('انتهت مهلة الاتصال بالاستراتيجية. لم نتأكد من وصول الأجندة؛ أعد التحقق قبل المحاولة مرة أخرى.');
    throw new Error('تعذر الاتصال بجهة استقبال الأجندات في سيستم الاستراتيجية.');
  } finally { clearTimeout(timeout); }
  const reply = await res.json().catch(() => null) as Record<string,unknown> | null;
  if (!res.ok || !reply || reply.ok !== true || reply.agendaId !== planId ||
      reply.received !== snapshot.entries.length) {
    throw new Error(`لم تؤكد الاستراتيجية استلام كامل الأجندة (${res.status}). لم يتم تسجيل نجاح المزامنة.`);
  }
  return { ok:true, id:planId, count:snapshot.entries.length, ready:snapshot.totals.ready,
    waiting:snapshot.totals.waiting, incomplete:snapshot.totals.incomplete,
    message:`تمت مزامنة ${snapshot.entries.length} سجل نشر مع الاستراتيجية بنجاح.` };
}

/** Authenticated binary response. This is NOT a Google Drive sharing link. */
export async function streamApprovedAgendaMedia(sql: Sql, planId: string, fileId: string, response: VercelResponse) {
  if (!validAgendaUuid(planId) || !validAgendaUuid(fileId)) throw new Error('Invalid publication file identifier');
  const [file] = await sql<Row[]>`
    select f.original_name,f.mime_type,f.file_size,f.external_id,f.storage_provider
    from marketing.files f
    join marketing.work_item_files attachment on attachment.file_id=f.id and attachment.category='final'
    join marketing.work_format_reviews review on review.item_id=attachment.item_id
      and review.format_id=attachment.format_id and review.status='approved'
    join marketing.work_plan_items line on line.product_id=attachment.item_id and line.is_deleted=false
    join marketing.work_plans p on p.id=line.plan_id and p.kind='agenda' and p.is_deleted=false
    join marketing.work_tasks t on t.id=(select task_id from marketing.work_items where id=attachment.item_id) and t.is_deleted=false
    where f.id=${fileId}::uuid and f.status='ready' and p.id=${planId}::uuid
    limit 1`;
  if (!file) return response.status(404).json({ok:false,error:'Approved agenda file not found'});
  if (file.storage_provider !== 'google-drive' || !str(file.external_id)) {
    return response.status(409).json({ok:false,error:'This file is not available through the Google Drive publication bridge'});
  }
  const upstream = await openGoogleDriveFile(sql,str(file.external_id),'application/octet-stream,*/*');
  if (!upstream.ok || !upstream.body) return response.status(502).json({ok:false,error:'Unable to retrieve original Google Drive file bytes'});
  const upstreamType = str(upstream.headers.get('content-type')).split(';')[0].toLowerCase();
  if (upstreamType === 'application/json' || upstreamType === 'text/html') {
    return response.status(502).json({ok:false,error:'Google Drive did not return the original media bytes'});
  }
  const mimeType = str(file.mime_type) || 'application/octet-stream';
  const originalName = str(file.original_name) || 'publication-file';
  response.setHeader('Content-Type',mimeType);
  response.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
  response.setHeader('Cache-Control','private, no-store');
  response.setHeader('X-Content-Type-Options','nosniff');
  const length = upstream.headers.get('content-length');
  if (length && /^\d+$/.test(length)) response.setHeader('Content-Length',length);
  response.status(200);
  await pipeline(Readable.fromWeb(upstream.body as any),response);
  return response;
}
