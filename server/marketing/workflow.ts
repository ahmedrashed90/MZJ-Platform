import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { getSql, withDatabaseAdvisoryLock } from '../_db.js';
import { loadUserProfile, type SessionUser } from '../_auth.js';
import { hasPermission } from '../../shared/system-access.js';
import { getSystemAccess } from '../_access-control.js';
import { assertMarketingWorkflowReady } from '../_marketing-workflow-schema.js';
import { createNotification } from '../_notifications.js';
import { createUploadUrl, headMediaObject, mediaStorageConfigured, buildMarketingStorageKey } from '../_media-storage.js';
import { createGoogleDriveResumableUpload, verifyGoogleDriveUploadedFile } from '../_google-drive-storage.js';
import { normalizeMarketingPublishFormat } from '../../shared/marketing-publishing.js';
import { normalizeYouTubePublishOptions } from '../../shared/youtube-publishing.js';
import { finalCoverage, workReadiness, isWorkDate, supportsWorkMedia, ideaFileAllowed, workFileMatches, workDate, type WorkItem, type WorkFormat, type WorkCapabilities } from '../../shared/marketing-workflow.js';
import { W } from '../../shared/marketing-workflow-labels.js';

type Sql = ReturnType<typeof getSql>;
type Row = Record<string, any>;
export type WorkflowServices = {
  meta: (sql: Sql, user: SessionUser, synchronize?: boolean) => Promise<any>;
  streamFile: (sql: Sql, id: string, user: SessionUser, response: VercelResponse, download: boolean) => Promise<any>;
  publishItem: (sql: Sql, schedule: any, user: SessionUser) => Promise<any>;
  validatePublishItem: (sql: Sql, schedule: any) => Promise<void>;
  youtubeDefaults: (sql: Sql) => Promise<any>;
  legacyDatabase: (sql: Sql, user: SessionUser) => Promise<any>;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function text(v: unknown, limit = 2000) { return String(v ?? '').trim().slice(0, limit); }
function id(v: unknown): string { const s = text(v, 64); if (!uuidPattern.test(s)) throw new Error(W.invalid); return s; }
function list(v: unknown): any[] { return Array.isArray(v) ? v : []; }
function json(value: unknown): any { return JSON.parse(JSON.stringify(value ?? null)); }
function requirePermission(user: SessionUser, permission: string) { if (!hasPermission(user, permission)) throw new Error(W.denied); }
function isManager(user: SessionUser) {
  return (hasPermission(user, 'marketing.task.view_all') || hasPermission(user, 'marketing.task.review')) && getSystemAccess(user, 'marketing').dataScope === 'all';
}
function departmentScope(user: SessionUser) {
  const access = getSystemAccess(user, 'marketing');
  return ['department', 'departments', 'branch_and_department'].includes(access.dataScope) &&
    (hasPermission(user, 'marketing.task.view_all') || hasPermission(user, 'marketing.task.review')) ? access.departmentCodes : [];
}
function productManager(user: SessionUser) {
  return getSystemAccess(user, 'marketing').dataScope === 'all' &&
    (hasPermission(user, 'marketing.products.view') || hasPermission(user, 'marketing.publish_prep.view'));
}
export function workflowCapabilities(user: SessionUser): WorkCapabilities {
  return {
    createTask: hasPermission(user, 'marketing.task.create'), editTask: hasPermission(user, 'marketing.task.edit'),
    review: hasPermission(user, 'marketing.task.review'), createAgenda: hasPermission(user, 'marketing.agenda.create'),
    createCampaign: hasPermission(user, 'marketing.campaign.create'), products: hasPermission(user, 'marketing.products.view'),
    prepare: hasPermission(user, 'marketing.publish_prep.manage'), publish: hasPermission(user, 'marketing.publish.now'), viewAll: isManager(user),
  };
}
function queryBody(request: VercelRequest): Row {
  if (request.body && typeof request.body === 'object' && !Array.isArray(request.body)) return request.body;
  if (typeof request.body === 'string') { try { return JSON.parse(request.body); } catch { throw new Error(W.invalid); } }
  return {};
}
async function history(db: any, user: SessionUser, taskId: string | null, itemId: string | null, action: string, note = '', data: Row = {}) {
  await db`insert into marketing.work_history(task_id,item_id,action,note,actor_id,actor_name,data)
    values(${taskId}::uuid,${itemId}::uuid,${action},${note},${user.id}::uuid,${user.fullName},${db.json(json(data))})`;
}
async function notify(user: SessionUser, action: string, taskId: string, title: string, audience: string[], note = '', eventId: string = randomUUID()) {
  if (!audience.length) return;
  await createNotification({ systemCode: 'marketing', eventType: `workflow.${action}`, title, body: note,
    entityType: 'marketing_work_task', entityId: taskId, actionUrl: `/marketing?task=${encodeURIComponent(taskId)}`,
    actorId: user.id, actorName: user.fullName, audienceUserIds: [...new Set(audience)],
    severity: action === 'approved' ? 'success' : action === 'revision' ? 'warning' : 'info', dedupeKey: `marketing-workflow:${action}:${eventId}`,
  }).catch(error => console.error('Marketing workflow notification failed', error));
}
async function taskVisible(db: any, user: SessionUser, taskId: string) {
  const scopes = departmentScope(user);
  const [row] = await db`select t.* from marketing.work_tasks t where t.id=${taskId}::uuid and t.is_deleted=false and (
    ${isManager(user)} or t.created_by=${user.id}::uuid or exists(
      select 1 from marketing.work_items i left join core.departments d on d.id=i.department_id
      where i.task_id=t.id and (i.assigned_to=${user.id}::uuid or d.code=any(${scopes}::text[]))
    ))`;
  if (!row) throw new Error(W.notFound);
  return row;
}
async function visibleItem(db: any, user: SessionUser, itemId: string, forEdit = false) {
  const scopes = departmentScope(user);
  const [row] = await db`select i.*,t.name as task_name,t.task_no,t.created_by,t.status as task_status
    from marketing.work_items i join marketing.work_tasks t on t.id=i.task_id
    left join core.departments d on d.id=i.department_id where i.id=${itemId}::uuid and t.is_deleted=false and (
      ${isManager(user)} or i.assigned_to=${user.id}::uuid or
      (${(hasPermission(user, 'marketing.task.edit') || hasPermission(user, 'marketing.task.review'))} and t.created_by=${user.id}::uuid) or d.code=any(${scopes}::text[]))`;
  if (!row) throw new Error(W.notFound);
  if (forEdit && !['in_progress', 'revision'].includes(row.status)) throw new Error(W.immutable);
  return row;
}
async function loadItems(db: any, taskId: string, onlyUser = ''): Promise<WorkItem[]> {
  const rows = await db`select i.*,i.due_on::text,coalesce(d.name,'') as department_name,coalesce(u.full_name,'') as assignee_name,
    case when i.status in ('submitted','approved') and i.submitted_at is not null
      then case when (i.submitted_at at time zone 'Asia/Riyadh')::date <= i.due_on then 'on_time' else 'late' end
      else null end as delivery_status,
    coalesce((select jsonb_agg(jsonb_build_object('id',f.id::text,'name',f.original_name,'mime_type',f.mime_type,
      'file_size',f.file_size,'category',j.category,'format_id',j.format_id,'status',f.status,'order_index',j.order_index)
      order by j.order_index,j.created_at,j.id) from marketing.work_item_files j join marketing.files f on f.id=j.file_id
      where j.item_id=i.id and f.status='ready'),'[]'::jsonb) as files,
    coalesce((select jsonb_agg(jsonb_build_object('id',f.id::text,'name',f.original_name,'category',up.category))
      from marketing.work_uploads up join marketing.files f on f.id=up.file_id
      where up.item_id=i.id and up.cancelled_at is null and f.status='uploading'),'[]'::jsonb) as pending_uploads,
    coalesce((select jsonb_agg(jsonb_build_object('id',a.id::text,'name',a.name,'completed',coalesce(ap.completed,false),
      'admin_only',a.admin_only,'is_final_approval',a.is_final_approval) order by a.sort_order,a.created_at)
      from marketing.assignment_actions a left join marketing.work_action_progress ap on ap.action_id=a.id and ap.item_id=i.id
      where a.department_id=i.department_id and a.is_active=true),'[]'::jsonb) as actions
    from marketing.work_items i left join marketing.departments d on d.id=i.department_id
    left join core.users u on u.id=i.assigned_to
    where i.task_id=${taskId}::uuid and (${onlyUser}='' or i.assigned_to=nullif(${onlyUser},'')::uuid)
    order by i.sort_order,i.created_at,i.id`;
  return rows as WorkItem[];
}
async function recalculateTask(db: any, taskId: string) {
  await db`select id from marketing.work_tasks where id=${taskId}::uuid for update`;
  const items = await loadItems(db, taskId);
  const readiness = workReadiness(items);
  await db`update marketing.work_tasks set status=${readiness.complete ? 'completed' : readiness.total ? 'active' : 'empty'},
    completed_at=case when ${readiness.complete} then coalesce(completed_at,now()) else null end,
    updated_at=now(),version=version+1 where id=${taskId}::uuid`;
  return readiness;
}
async function taskSummary(db: any, user: SessionUser, taskId: string) {
  const task = await taskVisible(db, user, taskId);
  const all = await loadItems(db, taskId);
  const readiness = workReadiness(all);
  const canSeeAll = isManager(user) || (task.created_by === user.id && (hasPermission(user, 'marketing.task.edit') || hasPermission(user, 'marketing.task.review')));
  const scopes = departmentScope(user);
  const permittedDepartments = scopes.length ? await db`select id::text from core.departments where code=any(${scopes}::text[]) and system_code='marketing'` : [];
  const departmentIds = new Set(permittedDepartments.map((d: any) => d.id));
  const items = canSeeAll ? all : all.filter(i => i.assigned_to === user.id || departmentIds.has(i.department_id));
  const dates = all.map(i => workDate(i.due_on)).sort();
  const [type] = await db`select name from marketing.campaign_types where id=${task.type_id}::uuid`;
  const itemIds = items.map(i => i.id);
  const events = await db`select id,action,note,actor_name,created_at,item_id,data from marketing.work_history
    where task_id=${taskId}::uuid and (${canSeeAll} or item_id=any(${itemIds}::uuid[])) order by created_at desc,id desc limit 150`;
  return { ok: true, task: { ...task, type_name: type?.name || '', items, product_count: readiness.total,
    approved_count: readiness.approved, readiness: readiness.percent, due_from: dates[0] || null, due_to: dates.at(-1) || null }, events, capabilities: workflowCapabilities(user) };
}
async function taskList(sql: Sql, user: SessionUser, activeOnly = false) {
  const scopes = departmentScope(user);
  const rows = await sql<any[]>`select t.*,ct.name as type_name,
    count(i.id)::int as product_count,
    count(i.id) filter(where i.status='approved' and exists(select 1 from marketing.work_item_files jf join marketing.files f on f.id=jf.file_id where jf.item_id=i.id and jf.category='final' and f.status='ready'))::int as approved_count,
    -- On-time delivery measures the executor's submission, NOT admin approval.
    -- Riyadh calendar date makes submissions around UTC midnight unambiguous.
    count(i.id) filter(where i.status in ('submitted','approved') and i.submitted_at is not null
      and (i.submitted_at at time zone 'Asia/Riyadh')::date <= i.due_on)::int as submitted_on_time_count,
    count(i.id) filter(where i.status in ('submitted','approved') and i.submitted_at is not null
      and (i.submitted_at at time zone 'Asia/Riyadh')::date > i.due_on)::int as submitted_late_count,
    min(i.due_on)::text as due_from,max(i.due_on)::text as due_to
    from marketing.work_tasks t join marketing.campaign_types ct on ct.id=t.type_id
    left join marketing.work_items i on i.task_id=t.id
    where t.is_deleted=false and (${!activeOnly} or t.status='active') and (
      ${isManager(user)} or t.created_by=${user.id}::uuid or exists(select 1 from marketing.work_items own
        left join core.departments d on d.id=own.department_id where own.task_id=t.id and
          (own.assigned_to=${user.id}::uuid or d.code=any(${scopes}::text[]))))
    group by t.id,ct.name order by t.created_at desc,t.task_number desc`;
  return rows.map(row => ({ ...row, readiness: row.product_count ? Math.round(row.approved_count * 1000 / row.product_count) / 10 : 0 }));
}
async function reserveTask(sql: Sql, body: Row, user: SessionUser) {
  requirePermission(user, 'marketing.task.create');
  const key = id(body.requestKey);
  const [row] = await sql<any[]>`insert into marketing.work_reservations(created_by,request_key)
    values(${user.id}::uuid,${key}::uuid) on conflict(created_by,request_key) do update set request_key=excluded.request_key
    returning id::text,task_number::text,created_at,used_at`;
  return { ok: true, reservation: { ...row, task_no: `TSK-${String(row.task_number).padStart(6, '0')}` } };
}
async function validateAssignee(db: any, departmentId: string, userId: string) {
  const [row] = await db`select u.id from core.users u join core.user_system_departments usd on usd.user_id=u.id
    join core.user_systems us on us.user_id=u.id and us.system_code='marketing' and us.is_enabled=true
    join marketing.departments d on d.id=usd.department_id and d.is_active=true
    join core.departments cd on cd.id=d.id and cd.system_code='marketing' and cd.is_active=true
    where usd.system_code='marketing' and d.id=${departmentId}::uuid and u.id=${userId}::uuid and u.is_active=true
      and coalesce(u.is_archived,false)=false and coalesce(u.disabled_reason,'') not like 'ACCOUNT_DELETED:%'`;
  if (!row) throw new Error(`${W.assignee}: ${W.invalid}`);
}
async function validateFormats(db: any, kind: 'image' | 'video', ids: string[]): Promise<WorkFormat[]> {
  if (!ids.length || ids.length > 150) throw new Error(W.selectFormats);
  const uniqueIds = [...new Set(ids.map(id))];
  const rows = await db`select pt.id::text,pt.platform_id::text,pt.name,pt.width,pt.height,p.name as platform_name,p.code as platform_code
    from marketing.platform_post_types pt join marketing.platforms p on p.id=pt.platform_id and p.is_active=true
    where pt.id=any(${uniqueIds}::uuid[]) and pt.is_active=true order by p.name,pt.name,pt.id`;
  if (rows.length !== uniqueIds.length || rows.some((r: WorkFormat) => !supportsWorkMedia(kind, r.name))) throw new Error(W.selectFormats);
  return rows as WorkFormat[];
}
async function createTask(sql: Sql, body: Row, user: SessionUser) {
  requirePermission(user, 'marketing.task.create');
  const reservationId = id(body.reservationId), typeId = id(body.typeId), name = text(body.name, 250);
  const incoming = list(body.items);
  if (!name || !incoming.length || incoming.length > 100) throw new Error(W.requiredFields);
  const audiences: string[] = [];
  const result = await sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    const [reservation] = await tx<any[]>`select * from marketing.work_reservations where id=${reservationId}::uuid and created_by=${user.id}::uuid for update`;
    if (!reservation) throw new Error(W.notFound);
    if (reservation.used_at) return { ok: true, id: reservationId, message: W.saved, existed: true };
    const [type] = await tx<any[]>`select id from marketing.campaign_types where id=${typeId}::uuid and is_active=true`;
    if (!type) throw new Error(W.invalid);
    const taskNo = `TSK-${String(reservation.task_number).padStart(6, '0')}`;
    await tx`insert into marketing.work_tasks(id,task_number,task_no,name,type_id,created_by,created_at)
      values(${reservationId}::uuid,${reservation.task_number},${taskNo},${name},${typeId}::uuid,${user.id}::uuid,${reservation.created_at})`;
    const clientKeys = new Set<string>();
    for (let index = 0; index < incoming.length; index++) {
      const input = incoming[index], clientKey = id(input.clientKey), departmentId = id(input.departmentId), assigneeId = id(input.assigneeId);
      if (clientKeys.has(clientKey)) throw new Error(W.invalid);
      clientKeys.add(clientKey);
      const kind = input.mediaKind === 'image' || input.mediaKind === 'video' ? input.mediaKind : null;
      const idea = text(input.idea, 20000), dueOn = text(input.dueOn, 10), fileIds = [...new Set(list(input.ideaFileIds).map(id))];
      if (!kind || !isWorkDate(dueOn) || (!idea && !fileIds.length)) throw new Error(W.requiredFields);
      await validateAssignee(tx, departmentId, assigneeId);
      const formats = await validateFormats(tx, kind, list(input.formatIds));
      const [item] = await tx<any[]>`insert into marketing.work_items(task_id,client_key,department_id,assigned_to,media_kind,idea_name,idea,formats,due_on,sort_order)
        values(${reservationId}::uuid,${clientKey}::uuid,${departmentId}::uuid,${assigneeId}::uuid,${kind},
          ${text(input.ideaName, 250) || idea.split('\n')[0].slice(0, 120) || `${name} - ${index + 1}`},${idea},${tx.json(json(formats))},${dueOn}::date,${index}) returning id::text`;
      if (fileIds.length) {
        const files = await tx<any[]>`select f.id::text from marketing.files f join marketing.work_uploads up on up.file_id=f.id
          where f.id=any(${fileIds}::uuid[]) and up.reservation_id=${reservationId}::uuid and up.created_by=${user.id}::uuid
          and up.category='idea' and up.cancelled_at is null and f.status='ready'`;
        if (files.length !== fileIds.length) throw new Error(W.invalid);
        for (const fileId of fileIds) await tx`insert into marketing.work_item_files(item_id,file_id,category) values(${item.id}::uuid,${fileId}::uuid,'idea')`;
      }
      audiences.push(assigneeId);
      await history(tx, user, reservationId, item.id, 'created', '', { assigneeId, kind, dueOn });
    }
    await tx`update marketing.work_reservations set used_at=now() where id=${reservationId}::uuid`;
    return { ok: true, id: reservationId, taskNo, message: W.saved, existed: false };
  });
  if (!result.existed) await notify(user, 'created', reservationId, `${W.task}: ${name}`, audiences, W.execution, reservationId);
  return result;
}
async function saveItem(sql: Sql, body: Row, user: SessionUser) {
  const itemId = id(body.itemId);
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    const current = await visibleItem(tx, user, itemId, true);
    await tx`select id from marketing.work_tasks where id=${current.task_id}::uuid for update`;
    const [locked] = await tx<any[]>`select * from marketing.work_items where id=${itemId}::uuid for update`;
    if (locked.version !== Number(body.version)) throw new Error(W.conflict);
    if (!['in_progress', 'revision'].includes(locked.status)) throw new Error(W.immutable);
    const managerEdit = hasPermission(user, 'marketing.task.edit') && (isManager(user) || current.created_by === user.id || departmentScope(user).length > 0);
    if (current.assigned_to !== user.id && !managerEdit) throw new Error(W.denied);
    const idea = text(body.idea ?? locked.idea, 20000), ideaName = text(body.ideaName ?? locked.idea_name, 250);
    let due = workDate(locked.due_on);
    let assignedTo = locked.assigned_to, departmentId = locked.department_id;
    if (managerEdit && body.dueOn !== undefined) { if (!isWorkDate(body.dueOn)) throw new Error(W.dateInvalid); due = body.dueOn; }
    if (managerEdit && body.assigneeId !== undefined) {
      assignedTo = id(body.assigneeId); departmentId = id(body.departmentId); await validateAssignee(tx, departmentId, assignedTo);
    }
    const [row] = await tx<any[]>`update marketing.work_items set idea=${idea},idea_name=${ideaName || idea.split('\n')[0].slice(0, 120)},
      due_on=${due}::date,assigned_to=${assignedTo}::uuid,department_id=${departmentId}::uuid,version=version+1,updated_at=now()
      where id=${itemId}::uuid returning version`;
    await history(tx, user, current.task_id, itemId, 'edited', '', { dueOn: due, assigneeId: assignedTo });
    await recalculateTask(tx, current.task_id);
    return { ok: true, version: row.version, message: W.saved };
  });
}
async function submitItem(sql: Sql, body: Row, user: SessionUser) {
  requirePermission(user, 'marketing.task.final_file.upload');
  const itemId = id(body.itemId);
  const result = await sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    const current = await visibleItem(tx, user, itemId, true);
    if (current.assigned_to !== user.id) throw new Error(W.denied);
    await tx`select id from marketing.work_tasks where id=${current.task_id}::uuid for update`;
    const [locked] = await tx<any[]>`select * from marketing.work_items where id=${itemId}::uuid for update`;
    if (locked.version !== Number(body.version)) throw new Error(W.conflict);
    if (!['in_progress','revision'].includes(locked.status)) throw new Error(W.immutable);
    const items = await loadItems(tx, current.task_id), item = items.find(row => row.id === itemId);
    if (!item || !finalCoverage(item)) throw new Error(W.incompleteFiles);
    const [uploads] = await tx<any[]>`select count(*)::int as count from marketing.work_uploads up join marketing.files f on f.id=up.file_id
      where up.item_id=${itemId}::uuid and up.cancelled_at is null and f.status='uploading'`;
    if (uploads.count > 0) throw new Error(W.incompleteFiles);
    await tx`update marketing.work_items set status='submitted',submitted_at=now(),approved_at=null,approved_by=null,version=version+1,updated_at=now() where id=${itemId}::uuid`;
    await history(tx, user, current.task_id, itemId, 'submitted');
    await recalculateTask(tx, current.task_id);
    return { ok: true, taskId: current.task_id, owner: current.created_by, title: current.task_name, message: W.saved };
  });
  const candidates = await sql<any[]>`select u.id::text from core.users u join core.user_systems us on us.user_id=u.id
    where us.system_code='marketing' and us.is_enabled=true and u.is_active=true and coalesce(u.is_archived,false)=false`;
  const reviewers: string[] = [];
  for (const candidate of candidates) {
    const reviewer = await loadUserProfile(candidate.id);
    if (!reviewer || !hasPermission(reviewer, 'marketing.task.review')) continue;
    try { await visibleItem(sql, reviewer, itemId); reviewers.push(candidate.id); } catch { /* Outside this reviewer's scope. */ }
  }
  await notify(user, 'submitted', result.taskId, `${W.submitted}: ${result.title}`, [...reviewers, result.owner]);
  return result;
}
async function reviewItem(sql: Sql, body: Row, user: SessionUser) {
  requirePermission(user, 'marketing.task.review');
  const itemId = id(body.itemId), decision = text(body.decision), note = text(body.note, 10000);
  if (!['approve','revise','reject'].includes(decision)) throw new Error(W.invalid);
  if (decision === 'revise' && !note) throw new Error(W.notesRequired);
  const result = await sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    const visible = await visibleItem(tx, user, itemId);
    await tx`select id from marketing.work_tasks where id=${visible.task_id}::uuid for update`;
    const [locked] = await tx<any[]>`select * from marketing.work_items where id=${itemId}::uuid for update`;
    if (!locked || locked.version !== Number(body.version)) throw new Error(W.conflict);
    if (locked.status !== 'submitted') throw new Error(W.immutable);
    const item = (await loadItems(tx, locked.task_id)).find(row => row.id === itemId);
    if (decision === 'approve' && (!item || !finalCoverage(item))) throw new Error(W.incompleteFiles);
    await history(tx, user, locked.task_id, itemId, decision === 'approve' ? 'approved' : decision === 'revise' ? 'revision' : 'rejected', note,
      decision === 'reject' ? { assigneeId: locked.assigned_to, mediaKind: locked.media_kind, ideaName: locked.idea_name } : {});
    if (decision === 'reject') {
      // Hard-delete the requirement, not a hidden rejected requirement that
      // would keep contributing to count/readiness or return to its executor.
      await tx`delete from marketing.work_items where id=${itemId}::uuid`;
    } else {
      await tx`update marketing.work_items set status=${decision === 'approve' ? 'approved' : 'revision'},review_note=${note},
        approved_at=case when ${decision === 'approve'} then now() else null end,
        approved_by=case when ${decision === 'approve'} then ${user.id}::uuid else null end,
        version=version+1,updated_at=now() where id=${itemId}::uuid`;
      if (decision === 'approve') await tx`insert into marketing.work_action_progress(item_id,action_id,completed,completed_by)
        select ${itemId}::uuid,id,true,${user.id}::uuid from marketing.assignment_actions where department_id=${locked.department_id}::uuid and is_active=true and is_final_approval=true
        on conflict(item_id,action_id) do update set completed=true,completed_by=excluded.completed_by,updated_at=now()`;
    }
    const readiness = await recalculateTask(tx, locked.task_id);
    return { ok: true, taskId: locked.task_id, assigneeId: locked.assigned_to, readiness, message: W.saved };
  });
  if (decision !== 'reject') await notify(user, decision === 'approve' ? 'approved' : 'revision', result.taskId,
    decision === 'approve' ? W.approve : W.revise, [result.assigneeId], note);
  return result;
}
async function toggleAction(sql: Sql, body: Row, user: SessionUser) {
  const itemId = id(body.itemId), actionId = id(body.actionId);
  const item = await visibleItem(sql, user, itemId);
  const [action] = await sql<any[]>`select * from marketing.assignment_actions where id=${actionId}::uuid and department_id=${item.department_id}::uuid and is_active=true`;
  if (!action) throw new Error(W.notFound);
  if (action.is_final_approval) return reviewItem(sql, { ...body, decision: 'approve' }, user);
  requirePermission(user, action.admin_only ? 'marketing.assignment_action.admin' : 'marketing.assignment_action.execute');
  if (item.status === 'approved' || item.status === 'submitted') throw new Error(W.immutable);
  if (!action.admin_only && item.assigned_to !== user.id && !isManager(user)) throw new Error(W.denied);
  await sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    await tx`select id from marketing.work_tasks where id=${item.task_id}::uuid for update`;
    const [locked] = await tx<any[]>`select status,version from marketing.work_items where id=${itemId}::uuid for update`;
    if (locked.version !== Number(body.version)) throw new Error(W.conflict);
    if (!['in_progress','revision'].includes(locked.status)) throw new Error(W.immutable);
    await tx`insert into marketing.work_action_progress(item_id,action_id,completed,completed_by)
      values(${itemId}::uuid,${actionId}::uuid,${body.completed === true},${user.id}::uuid)
      on conflict(item_id,action_id) do update set completed=excluded.completed,completed_by=excluded.completed_by,updated_at=now()`;
    await tx`update marketing.work_items set version=version+1,updated_at=now() where id=${itemId}::uuid`;
    await history(tx, user, item.task_id, itemId, 'action', action.name, { completed: body.completed === true });
  });
  return { ok: true, message: W.saved };
}

async function prepareUpload(sql: Sql, body: Row, user: SessionUser) {
  const category = text(body.category), itemId = body.itemId ? id(body.itemId) : null, reservationId = body.reservationId ? id(body.reservationId) : null;
  const fileName = text(body.fileName, 255).replace(/[\r\n/\\]/g, '_'), mimeType = text(body.mimeType, 120) || 'application/octet-stream';
  const size = Number(body.fileSize);
  if (!!itemId === !!reservationId || !['idea','final'].includes(category) || !fileName || !Number.isSafeInteger(size) || size <= 0 || size > 5 * 1024 ** 3) throw new Error(W.fileInvalid);
  if (category === 'idea' && (!ideaFileAllowed(fileName) || size > 50 * 1024 ** 2)) throw new Error(W.fileInvalid);
  const provider = category === 'final' ? 'google-drive' : mediaStorageConfigured() ? 'r2' : 'google-drive';
  // Persist the pending upload under the same task/item locks as submission.
  // Submission can never overlook an upload being staged concurrently.
  const staged = await sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    let formats: string[] = [], taskId: string | null = null, taskNo = '';
    if (itemId) {
      const visible = await visibleItem(tx, user, itemId, true);
      await tx`select id from marketing.work_tasks where id=${visible.task_id}::uuid for update`;
      await tx`select id from marketing.work_items where id=${itemId}::uuid for update`;
      const item = await visibleItem(tx, user, itemId, true);
      if (category === 'final') {
        requirePermission(user, 'marketing.task.final_file.upload');
        if (item.assigned_to !== user.id) throw new Error(W.denied);
        if (!workFileMatches(item.media_kind, fileName, mimeType)) throw new Error(W.fileInvalid);
        formats = [...new Set(list(body.formatIds).map(id))];
        if (!formats.length || formats.some(formatId => !list(item.formats).some(f => f.id === formatId))) throw new Error(W.selectFormats);
      } else if (item.assigned_to !== user.id && !hasPermission(user, 'marketing.task.edit')) throw new Error(W.denied);
      taskId = item.task_id; taskNo = item.task_no;
    } else {
      requirePermission(user, 'marketing.task.create');
      if (category !== 'idea' || !reservationId) throw new Error(W.invalid);
      const [reservation] = await tx<any[]>`select task_number from marketing.work_reservations where id=${reservationId}::uuid and created_by=${user.id}::uuid and used_at is null for update`;
      if (!reservation) throw new Error(W.notFound);
      taskNo = `TSK-${String(reservation.task_number).padStart(6, '0')}`;
    }
    const storageKey = buildMarketingStorageKey({ sourceType: 'task', sourceId: taskId || reservationId || '', sourceCode: taskNo,
      sourceName: taskNo, taskId: itemId || '', taskName: category, category: `workflow-${category}`, fileName });
    const [file] = await tx<any[]>`insert into marketing.files(storage_key,original_name,mime_type,file_size,category,source_type,source_id,status,uploaded_by,storage_provider)
      values(${storageKey},${fileName},${mimeType},${size},${`workflow-${category}`},'workflow',${taskId || reservationId}::uuid,'uploading',${user.id}::uuid,${provider}) returning id::text`;
    await tx`insert into marketing.work_uploads(file_id,reservation_id,item_id,category,format_ids,created_by)
      values(${file.id}::uuid,${reservationId}::uuid,${itemId}::uuid,${category},${tx.json(formats)},${user.id}::uuid)`;
    return { fileId: file.id as string, storageKey };
  });
  try {
    const uploadUrl = provider === 'google-drive'
      ? (await createGoogleDriveResumableUpload(sql, { fileId: staged.fileId, fileName, mimeType, fileSize: size, category: `workflow-${category}`, storageKey: staged.storageKey })).uploadUrl
      : createUploadUrl(staged.storageKey, 900);
    return { ok: true, fileId: staged.fileId, uploadUrl, storageProvider: provider };
  } catch (error) {
    await sql`update marketing.files set status='failed',updated_at=now() where id=${staged.fileId}::uuid and status='uploading'`;
    throw error;
  }
}
async function commitUpload(sql: Sql, body: Row, user: SessionUser) {
  const fileId = id(body.fileId);
  const [upload] = await sql<any[]>`select up.*,f.storage_provider,f.storage_key,f.status,f.original_name,f.mime_type,f.file_size,f.external_id
    from marketing.work_uploads up join marketing.files f on f.id=up.file_id
    where up.file_id=${fileId}::uuid and up.created_by=${user.id}::uuid and up.cancelled_at is null`;
  if (!upload) throw new Error(W.notFound);
  if (upload.committed_at && upload.status === 'ready') return { ok: true, fileId, message: W.saved };
  if (upload.status !== 'uploading') throw new Error(W.invalid);
  let externalId: string | null = null, externalUrl: string | null = null;
  if (upload.storage_provider === 'google-drive') {
    const info = await verifyGoogleDriveUploadedFile(sql, { externalId: text(body.externalId) || undefined, fileId, expectedSize: Number(upload.file_size) });
    if (Number(info.size || 0) !== Number(upload.file_size)) throw new Error(W.fileInvalid);
    externalId = text(info.id); externalUrl = text(info.webViewLink || info.webContentLink) || null;
  } else {
    const head = await headMediaObject(upload.storage_key);
    if (!head.exists || head.size !== Number(upload.file_size)) throw new Error(W.fileInvalid);
  }
  await sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    if (upload.item_id) {
      const item = await visibleItem(tx, user, upload.item_id, true);
      await tx`select id from marketing.work_tasks where id=${item.task_id}::uuid for update`;
      const [current] = await tx<any[]>`select status,assigned_to from marketing.work_items where id=${upload.item_id}::uuid for update`;
      if (!current || !['in_progress','revision'].includes(current.status)) throw new Error(W.immutable);
      await visibleItem(tx, user, upload.item_id, true);
      if (upload.category === 'final') { requirePermission(user, 'marketing.task.final_file.upload'); if (current.assigned_to !== user.id) throw new Error(W.denied); }
      else if (current.assigned_to !== user.id && !hasPermission(user, 'marketing.task.edit')) throw new Error(W.denied);
    } else {
      const [reservation] = await tx<any[]>`select id from marketing.work_reservations where id=${upload.reservation_id}::uuid and created_by=${user.id}::uuid and used_at is null for update`;
      if (!reservation) throw new Error(W.notFound);
    }
    const [locked] = await tx<any[]>`select * from marketing.work_uploads where file_id=${fileId}::uuid for update`;
    if (locked.cancelled_at) throw new Error(W.invalid);
    if (locked.committed_at) return;
    await tx`update marketing.files set status='ready',external_id=${externalId},external_url=${externalUrl},updated_at=now() where id=${fileId}::uuid`;
    await tx`update marketing.work_uploads set committed_at=now() where file_id=${fileId}::uuid`;
    if (upload.item_id) {
      const formatIds = upload.category === 'final' ? list(upload.format_ids).map(String) : [''];
      const [kind] = await tx<any[]>`select media_kind from marketing.work_items where id=${upload.item_id}::uuid`;
      if (upload.category === 'final' && kind.media_kind === 'video') await tx`delete from marketing.work_item_files
        where item_id=${upload.item_id}::uuid and category='final' and format_id=any(${formatIds}::text[])`;
      for (const formatId of formatIds) await tx`insert into marketing.work_item_files(item_id,file_id,category,format_id,order_index)
        values(${upload.item_id}::uuid,${fileId}::uuid,${upload.category},${formatId},
          (select coalesce(max(order_index),-1)+1 from marketing.work_item_files where item_id=${upload.item_id}::uuid and format_id=${formatId}))
        on conflict(item_id,file_id,format_id) do nothing`;
      await tx`update marketing.work_items set version=version+1,updated_at=now() where id=${upload.item_id}::uuid`;
    }
  });
  return { ok: true, fileId, message: W.saved };
}
async function removeUpload(sql: Sql, body: Row, user: SessionUser) {
  const fileId = id(body.fileId), requestedItemId = body.itemId ? id(body.itemId) : null;
  await sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    const [upload] = await tx<any[]>`select * from marketing.work_uploads where file_id=${fileId}::uuid`;
    const itemId = requestedItemId || upload?.item_id;
    if (itemId) {
      const item = await visibleItem(tx, user, itemId, true);
      if (item.assigned_to !== user.id && !hasPermission(user, 'marketing.task.edit')) throw new Error(W.denied);
      // Same ordering as submit/review/commit: task -> item -> upload.
      await tx`select id from marketing.work_tasks where id=${item.task_id}::uuid for update`;
      const [current] = await tx<any[]>`select status,assigned_to from marketing.work_items where id=${itemId}::uuid for update`;
      if (!current || !['in_progress','revision'].includes(current.status)) throw new Error(W.immutable);
      await visibleItem(tx, user, itemId, true);
      if (current.assigned_to !== user.id && !hasPermission(user, 'marketing.task.edit')) throw new Error(W.denied);
      const [linked] = await tx<any[]>`select 1 from marketing.work_item_files where item_id=${itemId}::uuid and file_id=${fileId}::uuid`;
      if (!linked && upload?.item_id !== itemId) throw new Error(W.notFound);
      await tx`delete from marketing.work_item_files where item_id=${itemId}::uuid and file_id=${fileId}::uuid`;
      if (upload?.item_id === itemId) {
        await tx`update marketing.work_uploads set cancelled_at=now() where file_id=${fileId}::uuid`;
        await tx`update marketing.files set status='cancelled',updated_at=now() where id=${fileId}::uuid and status='uploading'`;
      }
      await tx`update marketing.work_items set version=version+1,updated_at=now() where id=${itemId}::uuid`;
      await history(tx, user, item.task_id, itemId, 'file_removed');
    } else {
      if (!upload || upload.created_by !== user.id || !upload.reservation_id) throw new Error(W.notFound);
      const [reservation] = await tx<any[]>`select used_at from marketing.work_reservations
        where id=${upload.reservation_id}::uuid and created_by=${user.id}::uuid for update`;
      if (!reservation || reservation.used_at) throw new Error(W.immutable);
      await tx`update marketing.work_uploads set cancelled_at=now() where file_id=${fileId}::uuid`;
      await tx`update marketing.files set status='cancelled',updated_at=now() where id=${fileId}::uuid and status='uploading'`;
    }
    // No shared/approved physical object is deleted. Detach this requirement only.
  });
  return { ok: true, message: W.saved };
}

export async function assertWorkflowFileAccess(sql: Sql, file: any, user: SessionUser) {
  await assertMarketingWorkflowReady(sql);
  const scopes = departmentScope(user);
  const [allowed] = await sql<any[]>`select 1 where exists(
    select 1 from marketing.work_item_files j join marketing.work_items i on i.id=j.item_id
    join marketing.work_tasks t on t.id=i.task_id left join core.departments d on d.id=i.department_id
    where j.file_id=${file.id}::uuid and (
      ${isManager(user)} or i.assigned_to=${user.id}::uuid or
      (t.created_by=${user.id}::uuid and (${hasPermission(user, 'marketing.task.edit') || hasPermission(user, 'marketing.task.review')} or (j.category='final' and i.status='approved' and t.status='completed'))) or d.code=any(${scopes}::text[]) or
      (i.status='approved' and t.status='completed' and j.category='final' and ${productManager(user)})
    )) or exists(select 1 from marketing.work_uploads up join marketing.work_reservations r on r.id=up.reservation_id
      where up.file_id=${file.id}::uuid and up.created_by=${user.id}::uuid and up.cancelled_at is null and r.used_at is null)`;
  if (!allowed) throw new Error(W.denied);
}
async function products(sql: Sql, user: SessionUser) {
  if (!hasPermission(user, 'marketing.products.view') && !hasPermission(user, 'marketing.publish_prep.view')) throw new Error(W.denied);
  const scopes = departmentScope(user);
  const rows = await sql<any[]>`select i.*,i.due_on::text,t.task_no,t.name as task_name,t.completed_at as released_at,
    coalesce(d.name,'') as department_name,coalesce(u.full_name,'') as assignee_name,
    coalesce((select jsonb_agg(jsonb_build_object('id',f.id::text,'name',f.original_name,'mime_type',f.mime_type,'file_size',f.file_size,
      'category',j.category,'format_id',j.format_id,'status',f.status,'order_index',j.order_index) order by j.order_index,j.id)
      from marketing.work_item_files j join marketing.files f on f.id=j.file_id
      where j.item_id=i.id and j.category='final' and f.status='ready'),'[]'::jsonb) as files
    from marketing.work_items i join marketing.work_tasks t on t.id=i.task_id
    left join marketing.departments d on d.id=i.department_id left join core.departments cd on cd.id=i.department_id
    left join core.users u on u.id=i.assigned_to
    where t.is_deleted=false and t.status='completed' and i.status='approved' and (${productManager(user)} or ${isManager(user)} or
      i.assigned_to=${user.id}::uuid or t.created_by=${user.id}::uuid or cd.code=any(${scopes}::text[]))
    order by t.completed_at desc,i.approved_at desc,i.created_at desc,i.id desc`;
  return rows.filter(row => finalCoverage(row as WorkItem)).map(row => ({ ...row,
    statement: `${row.task_name} - ${row.media_kind === 'video' ? W.video : W.image}` }));
}
async function productVisible(db: any, user: SessionUser, itemId: string) {
  const scopes = departmentScope(user);
  const [row] = await db`select i.*,i.due_on::text,t.name as task_name,t.task_no,t.status as task_status,t.completed_at,
    u.full_name as assignee_name,d.name as department_name from marketing.work_items i
    join marketing.work_tasks t on t.id=i.task_id left join core.users u on u.id=i.assigned_to
    left join marketing.departments d on d.id=i.department_id left join core.departments cd on cd.id=d.id
    where i.id=${itemId}::uuid and i.status='approved' and t.status='completed' and t.is_deleted=false and (
      ${productManager(user)} or ${isManager(user)} or i.assigned_to=${user.id}::uuid or t.created_by=${user.id}::uuid or cd.code=any(${scopes}::text[]))`;
  if (!row) throw new Error(W.productUnavailable);
  const item = (await loadItems(db, row.task_id)).find(r => r.id === itemId);
  if (!item || !finalCoverage(item)) throw new Error(W.productUnavailable);
  return { ...row, ...item, files: item.files.filter(file => file.category === 'final'), actions: undefined, pending_uploads: undefined };
}
/** Product-level publishing preparation is independent of agenda/financing dates.
 * The draft does not create schedules, publish content or change approved files.
 * Creating an agenda/campaign snapshots its caption and hashtags into each line.
 */
async function productDrafts(sql: Sql, products: Row[]) {
  const productIds = products.map(product => String(product.id));
  if (!productIds.length) return [];
  return sql<any[]>`select product_id::text,format_ids,caption,hashtags,updated_at
    from marketing.work_product_drafts where product_id=any(${productIds}::uuid[])`;
}

async function saveProductDraft(sql: Sql, user: SessionUser, body: Row) {
  requirePermission(user, 'marketing.publish_prep.manage');
  const productId = id(body.productId);
  const product = await productVisible(sql, user, productId);
  const formats = list(product.formats) as WorkFormat[];
  const selected = [...new Set(list(body.formatIds).map(v => id(v)))];
  if (!selected.length || selected.some(formatId => !formats.some(format => format.id === formatId))) {
    throw new Error(W.selectFormats);
  }
  const caption = text(body.caption, 10000), hashtags = text(body.hashtags, 3000);
  await sql`insert into marketing.work_product_drafts(product_id,format_ids,caption,hashtags,updated_by,updated_at)
    values(${productId}::uuid,${sql.json(selected)},${caption},${hashtags},${user.id}::uuid,now())
    on conflict(product_id) do update set format_ids=excluded.format_ids,caption=excluded.caption,
      hashtags=excluded.hashtags,updated_by=excluded.updated_by,updated_at=now()`;
  return { ok: true, id: productId, message: W.saved };
}

async function createPlan(sql: Sql, body: Row, user: SessionUser) {
  const kind = body.kind === 'agenda' || body.kind === 'campaign' ? body.kind : null;
  if (!kind) throw new Error(W.invalid);
  requirePermission(user, kind === 'agenda' ? 'marketing.agenda.create' : 'marketing.campaign.create');
  requirePermission(user, 'marketing.products.view');
  const requestKey = id(body.requestKey), entries = list(body.entries);
  if (!entries.length || entries.length > 500) throw new Error(W.requiredFields);
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    await tx`select pg_advisory_xact_lock(hashtext(${`work-plan:${user.id}:${requestKey}`}))`;
    const [existing] = await tx<any[]>`select id from marketing.work_plans where created_by=${user.id}::uuid and request_key=${requestKey}::uuid`;
    if (existing) return { ok: true, id: existing.id, message: W.saved };
    const normalized: { productId: string; date: string; postTypeId: string; budget: number }[] = [], seen = new Set<string>();
    for (const entry of entries) {
      const productId = id(entry.productId), date = text(entry.date, 10);
      if (!isWorkDate(date)) throw new Error(W.dateInvalid);
      const postTypeId = id(entry.postTypeId);
      const budget = kind === 'campaign' ? Number(entry.budget) : 0;
      if (!Number.isFinite(budget) || budget < 0 || budget > 100000000 || Math.round(budget * 100) / 100 !== budget) throw new Error(W.invalid);
      const product = await productVisible(tx, user, productId);
      if (!list(product.formats).some((format: WorkFormat) => format.id === postTypeId)) throw new Error(W.selectFormats);
      const key = `${date}:${productId}:${postTypeId}`;
      if (seen.has(key)) throw new Error('نفس المنتج والمنصة ونوع النشر والتاريخ مكرر في الجدول');
      seen.add(key); normalized.push({ productId, date, postTypeId, budget });
    }
    let seq: any, planNo = '';
    do {
      [seq] = await tx<any[]>`select nextval('marketing.work_plan_number_seq')::text as value`;
      planNo = `${kind === 'agenda' ? 'AGD' : 'CMP'}-${String(seq.value).padStart(6, '0')}`;
      const [collision] = await tx<any[]>`select 1 from marketing.campaigns where campaign_code=${planNo} union all select 1 from marketing.work_plans where plan_no=${planNo} limit 1`;
      if (!collision) break;
    } while (true);
    const planId = randomUUID();
    const name = text(body.name, 250) || `${kind === 'agenda' ? W.agenda : W.campaign} ${planNo}`;
    const dates = normalized.map(e => e.date).sort(), start = dates[0], end = dates.at(-1)!;
    await tx`insert into marketing.work_plans(id,request_key,plan_number,plan_no,kind,name,created_by)
      values(${planId}::uuid,${requestKey}::uuid,${seq.value},${planNo},${kind},${name},${user.id}::uuid)`;
    // Native records are publication adapters, not the old creation workflow.
    // They preserve existing post -> engagement -> CRM relationships.
    const payload = tx.json({ workflowVersion: 2, workflowPlanId: planId });
    if (kind === 'agenda') await tx`insert into marketing.agendas(id,name,month_key,publish_start,publish_end,status,payload,progress,created_by)
      values(${planId}::uuid,${name},${start.slice(0, 7)},${start}::date,${end}::date,'publishing',${payload},100,${user.id}::uuid)`;
    else await tx`insert into marketing.campaigns(id,campaign_code,name,campaign_date,publish_start,publish_end,status,payload,progress,created_by)
      values(${planId}::uuid,${planNo},${name},current_date,${start}::date,${end}::date,'publishing',${payload},100,${user.id}::uuid)`;
    for (const entry of normalized) await tx`insert into marketing.work_plan_items(plan_id,product_id,scheduled_on,post_type_id,budget_amount,caption,hashtags)
      select ${planId}::uuid,${entry.productId}::uuid,${entry.date}::date,${entry.postTypeId}::uuid,${entry.budget},
        coalesce(draft.caption,''),coalesce(draft.hashtags,'')
      from (select 1) as seed left join marketing.work_product_drafts draft
        on draft.product_id=${entry.productId}::uuid`;
    return { ok: true, id: planId, planNo, message: W.saved };
  });
}
async function planLines(sql: Sql, user: SessionUser, planId = '') {
  const scopes = departmentScope(user);
  const rows = await sql<any[]>`select l.*,l.scheduled_on::text,p.plan_no,p.kind,p.name,p.created_at,p.created_by,p.activated_at,
    pt.name as post_type_name,pf.name as platform_name,pf.code as platform_code,
    i.idea_name,i.media_kind,t.task_no,t.name as task_name,
    (select count(*)::int from marketing.work_publish_targets target join marketing.publish_schedule s on s.id=target.schedule_id where target.line_id=l.id and s.status<>'cancelled') as prepared_count,
    (select count(*)::int from marketing.work_publish_targets target join marketing.publish_schedule s on s.id=target.schedule_id where target.line_id=l.id and s.status='published') as published_count,
    (select count(*)::int from marketing.work_publish_targets target join marketing.publish_schedule s on s.id=target.schedule_id where target.line_id=l.id and s.status in('failed','verification_required')) as failed_count
    from marketing.work_plan_items l join marketing.work_plans p on p.id=l.plan_id
    join marketing.work_items i on i.id=l.product_id join marketing.work_tasks t on t.id=i.task_id
    left join core.departments d on d.id=i.department_id
    left join marketing.platform_post_types pt on pt.id=l.post_type_id
    left join marketing.platforms pf on pf.id=pt.platform_id
    where t.is_deleted=false and p.is_deleted=false and l.is_deleted=false and (${planId}='' or p.id=nullif(${planId},'')::uuid)
      and (p.kind<>'campaign' or exists (
        select 1 from marketing.campaigns campaign
        where campaign.id=p.id and campaign.is_deleted=false
      )) and (
      ${productManager(user)} or ${isManager(user)} or p.created_by=${user.id}::uuid or i.assigned_to=${user.id}::uuid or d.code=any(${scopes}::text[]))
    order by l.scheduled_on,p.created_at desc,l.id`;
  return rows.map(row => ({ ...row, status: row.prepared_count && row.published_count === row.prepared_count ? 'published' : row.failed_count ? 'failed' : row.prepared_count ? 'prepared' : 'waiting' }));
}

/** Native campaigns share their ID with the existing marketing.campaigns adapter.
 * Soft-delete that adapter, so historical files, published posts and engagement
 * references are preserved. Never remove work_plan_items by cascading delete.
 */
async function deleteWorkflowCampaign(sql: Sql, user: SessionUser, planId: string) {
  requirePermission(user, 'marketing.campaign.delete');
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    const [campaign] = await tx<any[]>`select p.id,p.name,p.created_by
      from marketing.work_plans p join marketing.campaigns c on c.id=p.id
      where p.id=${planId}::uuid and p.kind='campaign' and c.is_deleted=false
      for update of p`;
    if (!campaign) throw new Error(W.notFound);
    if (!isManager(user) && campaign.created_by !== user.id) throw new Error(W.denied);
    // A publication being sent to a provider cannot be safely cancelled.
    const [sending] = await tx<any[]>`select 1 from marketing.work_plan_items line
      join marketing.work_publish_targets target on target.line_id=line.id
      join marketing.publish_schedule s on s.id=target.schedule_id
      where line.plan_id=${planId}::uuid and s.status in ('processing','verification_required') limit 1`;
    if (sending) throw new Error(W.unpublishedOnly);
    await tx`update marketing.campaigns set is_deleted=true,updated_at=now()
      where id=${planId}::uuid and is_deleted=false`;
    await tx`update marketing.publish_schedule s set status='cancelled',updated_at=now()
      where s.id in (select target.schedule_id from marketing.work_publish_targets target
        join marketing.work_plan_items line on line.id=target.line_id where line.plan_id=${planId}::uuid)
      and s.status in ('waiting','failed')`;
    return { ok:true, id:planId, message:W.remove };
  });
}
async function planDetails(sql: Sql, user: SessionUser, planId: string) {
  const lines = await planLines(sql, user, planId);
  if (!lines.length) throw new Error(W.notFound);
  return { ok: true, plan: { id: planId, plan_no: lines[0].plan_no, name: lines[0].name, kind: lines[0].kind, created_at: lines[0].created_at }, lines };
}
/** One confirmed task deletion removes every linked campaign/agenda plan and all its
 * future publication rows, even if that plan also references a product from another
 * task. Those other source tasks and their files remain intact. Published posts and
 * history stay as historical evidence and are never remotely deleted. */
async function deleteWorkflowTask(sql: Sql, user: SessionUser, taskId: string) {
  requirePermission(user, 'marketing.task.delete');
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    const [task] = await tx<any[]>`select id,name,task_no,is_deleted,created_by from marketing.work_tasks
      where id=${taskId}::uuid for update`;
    if (!task || task.is_deleted) throw new Error(W.notFound);
    if (!isManager(user) && task.created_by !== user.id) throw new Error(W.denied);
    const referencedPlans = await tx<any[]>`select distinct l.plan_id::text from marketing.work_plan_items l
      join marketing.work_items item on item.id=l.product_id
      where item.task_id=${taskId}::uuid and l.is_deleted=false`;
    const planIds = referencedPlans.map(plan => plan.plan_id);
    if (planIds.length) await tx`select id from marketing.work_plans
      where id=any(${planIds}::uuid[]) for update`;
    const lines = planIds.length ? await tx<any[]>`select id::text from marketing.work_plan_items
      where plan_id=any(${planIds}::uuid[]) and is_deleted=false for update` : [];
    const lineIds = lines.map(line => line.id);
    const [sending] = await tx<any[]>`select 1 from marketing.work_publish_targets target
      join marketing.publish_schedule s on s.id=target.schedule_id
      where target.line_id=any(${lineIds}::uuid[]) and s.status in('processing','verification_required') limit 1`;
    if (sending) throw new Error('هناك نشر جارٍ أو يحتاج للتحقق؛ لا يمكن حذف التاسك أثناء تنفيذ النشر');
    const [pending] = await tx<any[]>`select 1 from marketing.work_uploads upload
      join marketing.work_items item on item.id=upload.item_id
      join marketing.files file on file.id=upload.file_id
      where item.task_id=${taskId}::uuid and upload.cancelled_at is null
        and upload.committed_at is null and file.status='uploading' limit 1`;
    if (pending) throw new Error(W.taskHasUploads);
    // Cancel only unpublished provider work. Historic published outputs must
    // retain immutable records and never cause a delete on Meta/TikTok/etc.
    if (lineIds.length) {
      await tx`update marketing.publish_schedule s set status='cancelled',updated_at=now()
        where s.id in (select target.schedule_id from marketing.work_publish_targets target
          where target.line_id=any(${lineIds}::uuid[])) and s.status in('waiting','failed')`;
      await tx`update marketing.work_plan_items set is_deleted=true,updated_at=now()
        where id=any(${lineIds}::uuid[]) and is_deleted=false`;
    }
    if (planIds.length) {
      await tx`update marketing.work_plans set is_deleted=true,activated_at=null,
        deleted_at=now(),deleted_by=${user.id}::uuid,updated_at=now()
        where id=any(${planIds}::uuid[]) and is_deleted=false`;
      await tx`update marketing.campaigns set is_deleted=true,updated_at=now()
        where id=any(${planIds}::uuid[]) and is_deleted=false`;
      await tx`update marketing.agendas set status='archived',archived_at=coalesce(archived_at,now()),
        archived_by=${user.id}::uuid,updated_at=now() where id=any(${planIds}::uuid[])`;
    }
    await tx`update marketing.work_tasks set is_deleted=true,deleted_at=now(),
      deleted_by=${user.id}::uuid,updated_at=now(),version=version+1
      where id=${taskId}::uuid and is_deleted=false`;
    await history(tx, user, taskId, null, 'task_deleted', '', { removedPlanLines: lineIds.length, deletedPlans: planIds.length });
    return { ok: true, id: taskId, affectedLines: lineIds.length, deletedPlans: planIds.length, message: W.saved };
  });
}

async function database(sql: Sql, user: SessionUser, services: WorkflowServices) {
  requirePermission(user, 'marketing.database.view');
  const [tasks, lines, historical] = await Promise.all([taskList(sql, user), planLines(sql, user), services.legacyDatabase(sql, user)]);
  const planMap = new Map<string, any>();
  for (const line of lines) {
    const existing = planMap.get(line.plan_id);
    if (!existing) planMap.set(line.plan_id, { id: line.plan_id, kind: line.kind, code: line.plan_no, name: line.name,
      created_at: line.created_at, date_from: line.scheduled_on, date_to: line.scheduled_on, product_count: 1, status: line.status, readiness: null });
    else { existing.product_count++; existing.date_to = line.scheduled_on; if (line.status !== existing.status) existing.status = 'waiting'; }
  }
  const nativePlanIds = new Set((await sql<any[]>`select id::text from marketing.work_plans`).map(p => p.id));
  const oldRows = list(historical.rows).filter(row => !nativePlanIds.has(row.id)).map(row => ({
    id: row.id, kind: row.source_type, code: row.code, name: row.name, created_at: row.created_at,
    date_from: workDate(row.publish_start), date_to: workDate(row.publish_end), product_count: Number(row.tasks_count || 0),
    status: row.status, readiness: Number(row.progress || 0), legacy: true,
  }));
  const rows = [...tasks.map(t => ({ id: t.id, kind: 'task', code: t.task_no, name: t.name, created_at: t.created_at,
    date_from: t.due_from, date_to: t.due_to, product_count: t.product_count, readiness: t.readiness, status: t.status })), ...planMap.values(), ...oldRows];
  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return { ok: true, rows };
}
async function calendar(sql: Sql, user: SessionUser, request: VercelRequest) {
  requirePermission(user, 'marketing.receipt_calendar.view');
  const from = text(request.query.from, 10), to = text(request.query.to, 10);
  if (!isWorkDate(from) || !isWorkDate(to) || from > to) throw new Error(W.dateInvalid);
  if ((new Date(to).getTime() - new Date(from).getTime()) / 86400000 > 62) throw new Error(W.dateInvalid);
  const rows = await sql<any[]>`select i.id,i.task_id,i.due_on::text,i.media_kind,i.idea_name,i.status,t.name as task_name,t.task_no
    from marketing.work_items i join marketing.work_tasks t on t.id=i.task_id
    where t.is_deleted=false and i.assigned_to=${user.id}::uuid and i.due_on between ${from}::date and ${to}::date
    order by i.due_on,t.created_at desc,i.sort_order`;
  return { ok: true, rows };
}

async function preparationDetail(sql: Sql, user: SessionUser, lineId: string, services: WorkflowServices) {
  requirePermission(user, 'marketing.publish_prep.view');
  const [line] = (await planLines(sql, user)).filter(row => row.id === lineId);
  if (!line) throw new Error(W.notFound);
  const product = await productVisible(sql, user, line.product_id);
  const targets = await sql<any[]>`select target.id,target.post_type_id,target.schedule_id,s.status,s.publish_result,s.published_at,
    s.caption,s.hashtags,s.publish_options,s.updated_at,p.code as platform_code,p.name as platform_name,pt.name as post_type_name
    from marketing.work_publish_targets target join marketing.publish_schedule s on s.id=target.schedule_id
    join marketing.platforms p on p.id=s.platform_id join marketing.platform_post_types pt on pt.id=s.post_type_id
    where target.line_id=${lineId}::uuid order by p.name,pt.name`;
  const [draft] = await sql<any[]>`select format_ids from marketing.work_product_drafts where product_id=${product.id}::uuid`;
  return { ok: true, line, product, targets, draftFormatIds: list(draft?.format_ids), youtubeDefaults: await services.youtubeDefaults(sql), capabilities: workflowCapabilities(user) };
}

async function savePreparation(sql: Sql, user: SessionUser, body: Row, services: WorkflowServices) {
  requirePermission(user, 'marketing.publish_prep.manage');
  const lineId = id(body.lineId);
  const [visible] = (await planLines(sql, user)).filter(row => row.id === lineId);
  if (!visible) throw new Error(W.notFound);
  const product = await productVisible(sql, user, visible.product_id);
  const selected = [...new Set(list(body.formatIds).map(value => id(value)))];
  const formats = list(product.formats) as WorkFormat[];
  if (!selected.length || selected.some(formatId => !formats.some(format => format.id === formatId))) throw new Error(W.selectFormats);
  if (visible.post_type_id && (selected.length !== 1 || selected[0] !== visible.post_type_id)) throw new Error('نوع النشر يجب أن يطابق جدول النشر المحفوظ');
  const caption = text(body.caption, 10000), hashtags = text(body.hashtags, 3000);
  if (!caption || !hashtags) throw new Error(W.requiredFields);
  const defaults = await services.youtubeDefaults(sql);
  const youtube = normalizeYouTubePublishOptions(body.youtubeOptions, defaults, { title: caption, description: [caption, hashtags].join('\n\n') });
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    const [line] = await tx<any[]>`select l.*,p.kind,p.created_by from marketing.work_plan_items l
      join marketing.work_plans p on p.id=l.plan_id where l.id=${lineId}::uuid and p.is_deleted=false and l.is_deleted=false for update of l`;
    if (!line || Number(body.version) !== Number(line.version)) throw new Error(W.conflict);
    // Recheck approval in the same transaction. A prepared file is never a draft upload.
    const [released] = await tx<any[]>`select i.id from marketing.work_items i join marketing.work_tasks t on t.id=i.task_id
      where i.id=${line.product_id}::uuid and i.status='approved' and t.status='completed' for share of i,t`;
    if (!released) throw new Error(W.productUnavailable);
    const existing = await tx<any[]>`select target.*,s.status,s.caption,s.hashtags,s.publish_options from marketing.work_publish_targets target
      join marketing.publish_schedule s on s.id=target.schedule_id where target.line_id=${lineId}::uuid for update of s`;
    for (const target of existing) {
      if (['published', 'processing', 'verification_required'].includes(target.status)) {
        if (!selected.includes(target.post_type_id) || target.caption !== caption || target.hashtags !== hashtags) throw new Error(W.unpublishedOnly);
      }
    }
    let adapter: any;
    [adapter] = await tx<any[]>`select id,creative_id from marketing.tasks where source_id=${line.plan_id}::uuid
      and workflow_product_id=${line.product_id}::uuid and approved_template_data->>'workflowLineId'=${lineId} limit 1`;
    if (!adapter) {
      const creativeId = randomUUID(), taskId = randomUUID();
      const campaignId = line.kind === 'campaign' ? line.plan_id : null, agendaId = line.kind === 'agenda' ? line.plan_id : null;
      await tx`insert into marketing.creatives(id,campaign_id,agenda_id,creative_type,name,quantity,status,instance_code,schedule_day,notes)
        values(${creativeId}::uuid,${campaignId}::uuid,${agendaId}::uuid,${product.media_kind},${product.idea_name},1,'completed',
          ${product.task_no},${workDate(line.scheduled_on)}::date,${tx.json({ workflowProductId: line.product_id, workflowLineId: lineId })})`;
      await tx`insert into marketing.tasks(id,campaign_id,agenda_id,source_type,source_id,creative_id,department_code,department_id,
        assigned_to,task_kind,title,status,progress,completed_at,completed_by,workflow_product_id,approved_template_data)
        values(${taskId}::uuid,${campaignId}::uuid,${agendaId}::uuid,${line.kind},${line.plan_id}::uuid,${creativeId}::uuid,'marketing_publication',
          ${product.department_id}::uuid,${user.id}::uuid,'manual_publish',${product.idea_name},'completed',100,now(),${user.id}::uuid,
          ${line.product_id}::uuid,${tx.json({ workflowLineId: lineId })})`;
      adapter = { id: taskId, creative_id: creativeId };
    }
    for (const formatId of selected) {
      const format = formats.find(f => f.id === formatId)!;
      const files = product.files.filter((file: any) => file.category === 'final' && file.format_id === formatId && file.status === 'ready');
      if (!files.length || (product.media_kind === 'video' && files.length !== 1)) throw new Error(W.incompleteFiles);
      const [currentFormat] = await tx<any[]>`select pt.id from marketing.platform_post_types pt join marketing.platforms p on p.id=pt.platform_id
        where pt.id=${formatId}::uuid and pt.platform_id=${format.platform_id}::uuid and pt.is_active=true and p.is_active=true`;
      if (!currentFormat) throw new Error(W.selectFormats);
      const old = existing.find(t => t.post_type_id === formatId);
      if (old && ['published', 'processing', 'verification_required'].includes(old.status)) continue;
      const options = { workflowProductId: line.product_id, workflowLineId: lineId, workflowKind: line.kind,
        format: normalizeMarketingPublishFormat(format.name), youtube };
      let scheduleId: string;
      if (old) {
        scheduleId = old.schedule_id;
        await tx`update marketing.publish_schedule set caption=${caption},hashtags=${hashtags},publish_date=${workDate(line.scheduled_on)}::date,
          publish_options=${tx.json(json(options))},status='waiting',publish_result='{}'::jsonb,updated_at=now() where id=${scheduleId}::uuid`;
      } else {
        scheduleId = randomUUID();
        await tx`insert into marketing.publish_schedule(id,group_id,source_type,source_id,creative_id,task_id,publish_date,platform_id,post_type_id,caption,hashtags,publish_options)
          values(${scheduleId}::uuid,${lineId}::uuid,${line.kind},${line.plan_id}::uuid,${adapter.creative_id}::uuid,${adapter.id}::uuid,
            ${workDate(line.scheduled_on)}::date,${format.platform_id}::uuid,${formatId}::uuid,${caption},${hashtags},${tx.json(json(options))})`;
        await tx`insert into marketing.work_publish_targets(line_id,post_type_id,schedule_id) values(${lineId}::uuid,${formatId}::uuid,${scheduleId}::uuid)`;
      }
      // Only unpublished attachment links are replaced; schedules/posts/logs remain intact.
      await tx`delete from marketing.work_publish_files where schedule_id=${scheduleId}::uuid`;
      for (let order = 0; order < files.length; order++) await tx`insert into marketing.work_publish_files(schedule_id,file_id,sort_order)
        values(${scheduleId}::uuid,${files[order].id}::uuid,${order}) on conflict do nothing`;
    }
    for (const old of existing.filter(t => !selected.includes(t.post_type_id))) {
      await tx`update marketing.publish_schedule set status='cancelled',updated_at=now() where id=${old.schedule_id}::uuid
        and status not in('published','processing','verification_required')`;
    }
    await tx`update marketing.work_plan_items set caption=${caption},hashtags=${hashtags},version=version+1,updated_at=now() where id=${lineId}::uuid`;
    return { ok: true, message: W.saved };
  });
}

/** Publication adapter: the existing provider engines consume approved files only. */
export async function workflowScheduleFiles(sql: Sql, schedule: Row): Promise<any[] | null> {
  if (!schedule.publish_options?.workflowProductId) return null;
  const rows = await sql<any[]>`select f.* from marketing.work_publish_files link
    join marketing.files f on f.id=link.file_id join marketing.work_publish_targets target on target.schedule_id=link.schedule_id
    join marketing.work_plan_items l on l.id=target.line_id join marketing.work_items i on i.id=l.product_id
    join marketing.work_tasks t on t.id=i.task_id
    where link.schedule_id=${schedule.id}::uuid and f.status='ready' and i.status='approved' and t.status='completed' and t.is_deleted=false
      and exists(select 1 from marketing.work_item_files jf where jf.item_id=i.id and jf.file_id=f.id and jf.category='final' and jf.format_id=target.post_type_id::text)
    order by link.sort_order,f.created_at,f.id`;
  if (!rows.length) throw new Error(W.productUnavailable);
  return rows;
}

async function publishTarget(sql: Sql, user: SessionUser, body: Row, services: WorkflowServices) {
  requirePermission(user, 'marketing.publish.now');
  requirePermission(user, 'marketing.publish_prep.view');
  const scheduleId = id(body.scheduleId);
  const [target] = await sql<any[]>`select target.line_id,p.kind from marketing.work_publish_targets target
    join marketing.work_plan_items l on l.id=target.line_id join marketing.work_plans p on p.id=l.plan_id
    where target.schedule_id=${scheduleId}::uuid`;
  if (!target || !(await planLines(sql, user)).some(line => line.id === target.line_id)) throw new Error(W.notFound);
  // Publishing a campaign posts organically on supported connected accounts;
  // the campaign budget is a plan only and NEVER triggers paid ad spending.
  return withDatabaseAdvisoryLock(`mzj:marketing:work-publish:${scheduleId}`, async () => {
    // The snapshot and claim are atomic with the preparation editor. A save
    // cannot change caption/files between the read and the provider request.
    const claimed = await sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
      const [schedule] = await tx<any[]>`select s.*,p.code as platform_code,p.name as platform_name,pt.name as post_type_name
        from marketing.publish_schedule s join marketing.platforms p on p.id=s.platform_id
        join marketing.platform_post_types pt on pt.id=s.post_type_id
        where s.id=${scheduleId}::uuid for update of s`;
      if (!schedule || schedule.status === 'cancelled') throw new Error(W.notFound);
      if (schedule.status === 'published') return { alreadyPublished: true, schedule };
      if (['processing', 'verification_required'].includes(schedule.status)) throw new Error(W.unpublishedOnly);
      if (!['waiting','failed'].includes(schedule.status)) throw new Error(W.immutable);
      const [activePlan] = await tx<any[]>`select 1 from marketing.work_publish_targets target
        join marketing.work_plan_items line on line.id=target.line_id
        join marketing.work_plans plan on plan.id=line.plan_id
        join marketing.work_items item on item.id=line.product_id
        join marketing.work_tasks task on task.id=item.task_id
        where target.schedule_id=${scheduleId}::uuid and plan.activated_at is not null
          and plan.is_deleted=false and line.is_deleted=false and task.is_deleted=false`;
      if (!activePlan) throw new Error('النشر غير مفعل أو تم إلغاء جدول النشر');
      if (!['facebook', 'instagram', 'youtube'].includes(schedule.platform_code)) throw new Error(W.invalid);
      if (!text(schedule.caption) || !text(schedule.hashtags)) throw new Error(W.requiredFields);
      if (workDate(schedule.publish_date) > new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })) throw new Error('موعد النشر لم يحن بعد');
      await services.validatePublishItem(tx as any, schedule);
      await tx`update marketing.publish_schedule set status='processing',updated_at=now()
        where id=${scheduleId}::uuid and status in('waiting','failed')`;
      return { alreadyPublished: false, schedule };
    });
    if (claimed.alreadyPublished) return { ok: true, alreadyPublished: true, result: claimed.schedule.publish_result };
    try {
      const result = await services.publishItem(sql, claimed.schedule, user);
      return { ok: true, result, message: W.published };
    } catch (error: any) {
      // A provider may accept content before a connection fails. Never
      // automatically retry an ambiguous public write or downgrade success.
      const message = text(error?.message, 3000) || W.failed;
      await sql`update marketing.publish_schedule set status='verification_required',publish_result=${sql.json({ error: message, verificationRequired: true })},
        updated_at=now() where id=${scheduleId}::uuid and status<>'published'`;
      await sql`insert into marketing.publish_logs(schedule_id,platform,status,error,published_by)
        values(${scheduleId}::uuid,${claimed.schedule.platform_code},'verification_required',${message},${user.id}::uuid)`;
      throw new Error(message);
    }
  });
}

async function resetPublicationAfterCheck(sql: Sql, user: SessionUser, body: Row) {
  requirePermission(user, 'marketing.publish.now');
  requirePermission(user, 'marketing.publish_prep.manage');
  if (body.confirmedNotPublished !== true) throw new Error(W.invalid);
  const scheduleId = id(body.scheduleId);
  return withDatabaseAdvisoryLock(`mzj:marketing:work-publish:${scheduleId}`, async () => {
    const [target] = await sql<any[]>`select line_id from marketing.work_publish_targets where schedule_id=${scheduleId}::uuid`;
    if (!target || !(await planLines(sql, user)).some(line => line.id === target.line_id)) throw new Error(W.notFound);
    const [changed] = await sql<any[]>`update marketing.publish_schedule set status='waiting',updated_at=now(),
      publish_result=jsonb_build_object('verifiedNotPublishedBy',${user.id}::text,'verifiedAt',now())
      where id=${scheduleId}::uuid and (status='verification_required' or (status='processing' and updated_at<now()-interval '15 minutes'))
      returning platform_id`;
    if (!changed) throw new Error(W.unpublishedOnly);
    await sql`insert into marketing.publish_logs(schedule_id,platform,status,error,published_by)
      select ${scheduleId}::uuid,code,'reset_after_verification',${W.resetAfterCheck},${user.id}::uuid
      from marketing.platforms where id=${changed.platform_id}::uuid`;
    return { ok: true, message: W.saved };
  });
}


async function activateWorkflowPlan(sql: Sql, user: SessionUser, body: Row) {
  requirePermission(user, 'marketing.publish.now');
  requirePermission(user, 'marketing.publish_prep.view');
  const planId = id(body.planId);
  return sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '15s'`;
    const [plan] = await tx<any[]>`select id,created_by,activated_at from marketing.work_plans
      where id=${planId}::uuid and is_deleted=false for update`;
    if (!plan) throw new Error(W.notFound);
    const visible = await planLines(tx as unknown as Sql, user, planId);
    if (!visible.length) throw new Error(W.notFound);
    const unfinished = visible.find(line => !line.prepared_count || line.failed_count || line.prepared_count !== 1);
    if (unfinished) throw new Error('أكمل تجهيز النشر وحفظ الكابشن والهاشتاج لكل صف في جدول النشر أولًا');
    const [unsupported] = await tx<any[]>`select 1 from marketing.work_publish_targets target
      join marketing.work_plan_items line on line.id=target.line_id
      join marketing.publish_schedule s on s.id=target.schedule_id
      join marketing.platforms p on p.id=s.platform_id
      where line.plan_id=${planId}::uuid and line.is_deleted=false
        and (p.code not in ('facebook','instagram','youtube') or s.status='cancelled') limit 1`;
    if (unsupported) throw new Error('المنصة المحددة لا تدعم النشر التلقائي عبر الربط الحالي');
    await tx`update marketing.work_plans set activated_at=coalesce(activated_at,now()),
      activated_by=${user.id}::uuid,updated_at=now() where id=${planId}::uuid`;
    return { ok: true, id: planId, message: 'تم تفعيل النشر حسب تواريخ جدول النشر' };
  });
}

/** Invoked by protected cron only. A pending scheduled post is attempted once;
 * ambiguous provider responses must remain verification_required, not retried. */
export async function runDueWorkflowPublications(sql: Sql, services: WorkflowServices) {
  await assertMarketingWorkflowReady(sql);
  const due = await sql<any[]>`select target.schedule_id::text,coalesce(p.activated_by,p.created_by)::text as publisher_id
    from marketing.work_publish_targets target
    join marketing.work_plan_items line on line.id=target.line_id
    join marketing.work_plans p on p.id=line.plan_id
    join marketing.work_items item on item.id=line.product_id
    join marketing.work_tasks task on task.id=item.task_id
    join marketing.publish_schedule s on s.id=target.schedule_id
    where p.activated_at is not null and p.is_deleted=false and line.is_deleted=false
      and task.is_deleted=false and s.status='waiting'
      and s.publish_date <= (now() at time zone 'Asia/Riyadh')::date
    order by s.publish_date,s.created_at,s.id limit 12`;
  const results: { scheduleId: string; ok: boolean; error?: string }[] = [];
  for (const target of due) {
    try {
      const owner = await loadUserProfile(target.publisher_id);
      if (!owner) throw new Error('مستخدم تفعيل النشر غير نشط');
      await publishTarget(sql, owner, { scheduleId: target.schedule_id }, services);
      results.push({ scheduleId: target.schedule_id, ok: true });
    } catch (failure) {
      results.push({ scheduleId: target.schedule_id, ok: false, error: failure instanceof Error ? failure.message : W.failed });
    }
  }
  return { ok: true, checked: due.length, published: results.filter(r => r.ok).length, errors: results.filter(r => !r.ok).length };
}

/** Old native endpoints must not mutate records owned by the rebuilt workflow. */
export async function assertLegacyMarketingTarget(sql: Sql, body: Row) {
  const actions = new Set(['save_entity_creative','delete_entity_creative','save_campaign_budgets','receive_task','upload_template',
    'review_template','toggle_task_action','reject_task','complete_task','move_to_publishing','attach_final_file','prepare_final_upload',
    'commit_final_file_upload','cancel_final_upload','attach_final_media_group','prepare_task_folder_upload','verify_task_folder_upload',
    'delete_task_folder_item','prepare_upload','mark_file_ready','cancel_file_upload','delete_first_file','save_publish_prep',
    'discard_manual_publish_entry','remove_publish_prep_entry','publish_now','save_links','archive_entity','delete_entity']);
  if (!actions.has(String(body.action))) return;
  const identifiers = new Set<string>();
  function collect(value: unknown, depth = 0) {
    if (depth > 8 || identifiers.size > 1500) throw new Error(W.invalid);
    if (typeof value === 'string' && uuidPattern.test(value)) identifiers.add(value);
    else if (Array.isArray(value)) value.forEach(item => collect(item, depth + 1));
    else if (value && typeof value === 'object') Object.values(value).forEach(item => collect(item, depth + 1));
  }
  collect(body);
  if (!identifiers.size) return;
  await assertMarketingWorkflowReady(sql);
  const ids = [...identifiers];
  const [owned] = await sql<any[]>`select 1 where
    exists(select 1 from marketing.work_tasks where id=any(${ids}::uuid[])) or
    exists(select 1 from marketing.work_items where id=any(${ids}::uuid[])) or
    exists(select 1 from marketing.work_plans where id=any(${ids}::uuid[])) or
    exists(select 1 from marketing.work_plan_items where id=any(${ids}::uuid[])) or
    exists(select 1 from marketing.tasks where id=any(${ids}::uuid[]) and workflow_product_id is not null) or
    exists(select 1 from marketing.creatives where id=any(${ids}::uuid[]) and notes ? 'workflowProductId') or
    exists(select 1 from marketing.publish_schedule where (id=any(${ids}::uuid[]) or group_id=any(${ids}::uuid[])) and publish_options ? 'workflowProductId') or
    exists(select 1 from marketing.files where id=any(${ids}::uuid[]) and category in('workflow-idea','workflow-final'))`;
  if (owned) throw new Error(W.immutable);
}

/** Dispatch only the rebuilt marketing workflow; unrelated systems/routes are untouched. */
export async function handleMarketingWorkflow(request: VercelRequest, response: VercelResponse, sql: Sql, user: SessionUser, services: WorkflowServices): Promise<boolean> {
  const resource = text(request.query.resource), body = request.method === 'POST' ? queryBody(request) : {};
  const action = text(body.action);
  if (!resource.startsWith('work_') && !action.startsWith('work_')) return false;
  await assertMarketingWorkflowReady(sql);
  let result: any;
  if (request.method === 'GET') {
    if (resource === 'work_version') {
      if (!['marketing.dashboard.view','marketing.database.view','marketing.products.view','marketing.publish_prep.view','marketing.receipt_calendar.view'].some(permission => hasPermission(user, permission))) throw new Error(W.denied);
      const [row] = await sql<any[]>`select md5(concat_ws('|',
        (select max(updated_at)::text from marketing.work_tasks),
        (select max(updated_at)::text from marketing.work_plans),
        (select max(updated_at)::text from marketing.work_plan_items),
        (select max(updated_at)::text from marketing.publish_schedule),
        (select max(updated_at)::text from marketing.campaigns),
        (select max(updated_at)::text from marketing.agendas))) as version`;
      result = { ok: true, version: row.version };
    } else if (resource === 'work_meta') {
      const meta = await services.meta(sql, user, false);
      const enabled = new Set((await sql<any[]>`select user_id::text from core.user_systems where system_code='marketing' and is_enabled=true`).map(row => row.user_id));
      result = { ...meta, users: [], departments: meta.departments.map((department: any) => ({ ...department, users: department.users.filter((member: any) => enabled.has(member.id)) })), capabilities: workflowCapabilities(user), userId: user.id };
    } else if (resource === 'work_dashboard') {
      requirePermission(user, 'marketing.dashboard.view');
      result = { ok: true, tasks: await taskList(sql, user, true), lines: await planLines(sql, user), capabilities: workflowCapabilities(user) };
    } else if (resource === 'work_task') {
      if (!hasPermission(user, 'marketing.task.view_assigned') && !hasPermission(user, 'marketing.task.view_all') && !hasPermission(user, 'marketing.database.view') && !hasPermission(user, 'marketing.task.review')) throw new Error(W.denied);
      result = await taskSummary(sql, user, id(request.query.id));
    } else if (resource === 'work_products') {
      requirePermission(user, 'marketing.products.view'); result = { ok: true, rows: await products(sql, user) };
    } else if (resource === 'work_product') {
      if (!hasPermission(user, 'marketing.products.view') && !hasPermission(user, 'marketing.publish_prep.view')) throw new Error(W.denied);
      result = { ok: true, product: await productVisible(sql, user, id(request.query.id)) };
    } else if (resource === 'work_database') result = await database(sql, user, services);
    else if (resource === 'work_calendar') result = await calendar(sql, user, request);
    else if (resource === 'work_plan') { requirePermission(user, 'marketing.database.view'); result = await planDetails(sql, user, id(request.query.id)); }
    else if (resource === 'work_publishing') {
      requirePermission(user, 'marketing.publish_prep.view');
      const visibleProducts = await products(sql, user);
      const [lines, drafts] = await Promise.all([planLines(sql, user), productDrafts(sql, visibleProducts)]);
      result = { ok: true, products: visibleProducts, lines, drafts, capabilities: workflowCapabilities(user) };
    } else if (resource === 'work_prep') result = await preparationDetail(sql, user, id(request.query.id), services);
    else if (resource === 'work_file') {
      await services.streamFile(sql, id(request.query.id), user, response, text(request.query.download) === '1'); return true;
    } else { response.status(404).json({ ok: false, error: W.notFound }); return true; }
  } else if (request.method === 'POST') {
    if (action === 'work_reserve') result = await reserveTask(sql, body, user);
    else if (action === 'work_create_task') result = await createTask(sql, body, user);
    else if (action === 'work_save_item') result = await saveItem(sql, body, user);
    else if (action === 'work_submit') result = await submitItem(sql, body, user);
    else if (action === 'work_review') result = await reviewItem(sql, body, user);
    else if (action === 'work_action') result = await toggleAction(sql, body, user);
    else if (action === 'work_prepare_upload') result = await prepareUpload(sql, body, user);
    else if (action === 'work_commit_upload') result = await commitUpload(sql, body, user);
    else if (action === 'work_remove_upload') result = await removeUpload(sql, body, user);
    else if (action === 'work_create_plan') result = await createPlan(sql, body, user);
    else if (action === 'work_activate_plan') result = await activateWorkflowPlan(sql, user, body);
    else if (action === 'work_delete_campaign') result = await deleteWorkflowCampaign(sql, user, id(body.id));
    else if (action === 'work_delete_task') result = await deleteWorkflowTask(sql, user, id(body.id));
    else if (action === 'work_save_product_draft') result = await saveProductDraft(sql, user, body);
    else if (action === 'work_save_prep') result = await savePreparation(sql, user, body, services);
    else if (action === 'work_reset_publication') result = await resetPublicationAfterCheck(sql, user, body);
    else if (action === 'work_publish') result = await publishTarget(sql, user, body, services);
    else { response.status(404).json({ ok: false, error: W.notFound }); return true; }
    // Audit metadata, never inline attachment bytes or provider credentials.
    await sql`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
      values(${user.id}::uuid,'marketing',${action},'marketing_workflow',${text(result?.id || body.itemId || body.lineId || body.scheduleId)},
        ${sql.json({ action, itemId: text(body.itemId), lineId: text(body.lineId) })})`.catch(error => console.error('Marketing workflow audit failed', error));
  } else { response.status(405).json({ ok: false, error: W.invalid }); return true; }
  response.status(200).json(result);
  return true;
}
