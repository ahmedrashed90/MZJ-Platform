import { getSql, runSqlScript, tryWithDatabaseAdvisoryLock } from './_db.js';

import { W } from '../shared/marketing-workflow-labels.js';

export const MARKETING_WORKFLOW_SQL = `begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
create schema if not exists marketing;
create table if not exists marketing.workflow_migrations(code text primary key, applied_at timestamptz not null default now());
create sequence if not exists marketing.work_task_number_seq as bigint;
create sequence if not exists marketing.work_plan_number_seq as bigint;
create table if not exists marketing.work_reservations (
  id uuid primary key default gen_random_uuid(), request_key uuid not null, created_by uuid not null references core.users(id),
  task_number bigint not null default nextval('marketing.work_task_number_seq') unique,
  created_at timestamptz not null default now(), used_at timestamptz, unique(created_by,request_key)
);
create table if not exists marketing.work_tasks (
  id uuid primary key references marketing.work_reservations(id),
  task_number bigint not null unique, task_no text not null unique, name text not null,
  type_id uuid not null references marketing.campaign_types(id),
  created_by uuid not null references core.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  status text not null default 'active' check(status in ('active','completed','empty')),
  completed_at timestamptz, version integer not null default 1,
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid references core.users(id)
);
create table if not exists marketing.work_items (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references marketing.work_tasks(id) on delete cascade,
  client_key uuid not null, department_id uuid not null references marketing.departments(id), assigned_to uuid not null references core.users(id),
  media_kind text not null check(media_kind in ('image','video')),
  idea_name text not null default '', idea text not null default '', formats jsonb not null default '[]', due_on date not null,
  status text not null default 'in_progress' check(status in ('in_progress','submitted','revision','approved')),
  submitted_at timestamptz, approved_at timestamptz, approved_by uuid references core.users(id),
  review_note text not null default '', version integer not null default 1, sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(task_id,client_key), check(jsonb_typeof(formats)='array' and jsonb_array_length(formats)>0)
);
alter table marketing.work_tasks add column if not exists is_deleted boolean not null default false;
alter table marketing.work_tasks add column if not exists deleted_at timestamptz;
alter table marketing.work_tasks add column if not exists deleted_by uuid references core.users(id);
create index if not exists work_items_task on marketing.work_items(task_id,sort_order);
create index if not exists work_items_delivery on marketing.work_items(assigned_to,due_on,status);
create index if not exists work_items_approved on marketing.work_items(approved_at desc) where status='approved';
create table if not exists marketing.work_uploads (
  file_id uuid primary key references marketing.files(id) on delete cascade,
  reservation_id uuid references marketing.work_reservations(id), item_id uuid references marketing.work_items(id) on delete cascade,
  category text not null check(category in ('idea','final')), format_ids jsonb not null default '[]',
  created_by uuid not null references core.users(id), created_at timestamptz not null default now(),
  committed_at timestamptz, cancelled_at timestamptz,
  check((reservation_id is not null) <> (item_id is not null))
);
create table if not exists marketing.work_item_files (
  id uuid primary key default gen_random_uuid(), item_id uuid not null references marketing.work_items(id) on delete cascade,
  file_id uuid not null references marketing.files(id), category text not null check(category in ('idea','final')),
  format_id text not null default '', order_index integer not null default 0,
  created_at timestamptz not null default now(), unique(item_id,file_id,format_id)
);
create index if not exists work_item_files_file on marketing.work_item_files(file_id);
create table if not exists marketing.work_history (
  id uuid primary key default gen_random_uuid(), task_id uuid references marketing.work_tasks(id) on delete cascade,
  item_id uuid, action text not null, note text, actor_id uuid references core.users(id), actor_name text,
  data jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists marketing.work_action_progress (
  item_id uuid not null references marketing.work_items(id) on delete cascade,
  action_id uuid not null references marketing.assignment_actions(id), completed boolean not null default false,
  completed_by uuid references core.users(id), updated_at timestamptz not null default now(), primary key(item_id,action_id)
);
create table if not exists marketing.work_plans (
  id uuid primary key default gen_random_uuid(), request_key uuid not null, plan_number bigint not null default nextval('marketing.work_plan_number_seq'),
  plan_no text not null unique, kind text not null check(kind in ('agenda','campaign')), name text not null,
  created_by uuid not null references core.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, activated_at timestamptz,
  activated_by uuid references core.users(id), deleted_at timestamptz, deleted_by uuid references core.users(id),
  unique(created_by,request_key)
);
create table if not exists marketing.work_plan_items (
  id uuid primary key default gen_random_uuid(), plan_id uuid not null references marketing.work_plans(id) on delete cascade,
  product_id uuid not null references marketing.work_items(id), scheduled_on date not null,
  is_deleted boolean not null default false, post_type_id uuid references marketing.platform_post_types(id),
  budget_amount numeric(15,2) not null default 0,
  caption text not null default '', hashtags text not null default '', version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists work_plan_items_date on marketing.work_plan_items(scheduled_on,plan_id);
create table if not exists marketing.work_publish_targets (
  id uuid primary key default gen_random_uuid(), line_id uuid not null references marketing.work_plan_items(id),
  post_type_id uuid not null references marketing.platform_post_types(id), schedule_id uuid not null references marketing.publish_schedule(id),
  unique(line_id,post_type_id), unique(schedule_id)
);
create table if not exists marketing.work_publish_files (
  schedule_id uuid not null references marketing.publish_schedule(id), file_id uuid not null references marketing.files(id),
  sort_order integer not null default 0, primary key(schedule_id,file_id)
);
alter table marketing.tasks add column if not exists workflow_product_id uuid references marketing.work_items(id);
alter table marketing.assignment_actions add column if not exists is_final_approval boolean not null default false;
update marketing.assignment_actions set is_final_approval=true,admin_only=true
 where regexp_replace(name,'[[:space:]_-]+','','g')=regexp_replace('${W.approve}','[[:space:]_-]+','','g');
insert into marketing.workflow_migrations(code) values('schema-1'),('schema-2') on conflict do nothing;
commit;`;

// Small, additive migration for databases created by older Marketing V2 builds.
// Do not re-run the initial full workflow DDL just because a new column/table
// was introduced: ALTER/CREATE within the entire bootstrap may deadlock with
// concurrent reads and leave every serverless request running for 120 seconds.
export const MARKETING_WORKFLOW_TASK_DELETE_SQL = `begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
alter table marketing.work_tasks add column if not exists is_deleted boolean not null default false;
alter table marketing.work_tasks add column if not exists deleted_at timestamptz;
alter table marketing.work_tasks add column if not exists deleted_by uuid references core.users(id);
insert into marketing.workflow_migrations(code) values('schema-2') on conflict do nothing;
commit;`;

export const MARKETING_WORKFLOW_UPGRADE_SQL = `begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
create table if not exists marketing.work_product_drafts (
  product_id uuid primary key references marketing.work_items(id) on delete cascade,
  format_ids jsonb not null default '[]'::jsonb,
  caption text not null default '',
  hashtags text not null default '',
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now(),
  constraint work_product_drafts_format_array check(jsonb_typeof(format_ids)='array')
);
insert into marketing.workflow_migrations(code) values('schema-3') on conflict do nothing;
commit;`;

export const MARKETING_WORKFLOW_KPI_SQL = `-- Marketing workflow: independent format review and executor quality evaluation.
-- Applied through the platform Marketing workflow schema initializer.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
create table if not exists marketing.work_review_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null, sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists marketing.work_kpi_criteria (
  id uuid primary key default gen_random_uuid(),
  name text not null, sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists marketing.work_format_reviews (
  item_id uuid not null references marketing.work_items(id) on delete cascade,
  format_id text not null,
  status text not null check(status in ('submitted','approved','revision')),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references core.users(id),
  updated_at timestamptz not null default now(),
  primary key(item_id,format_id)
);
create index if not exists work_format_reviews_item_status on marketing.work_format_reviews(item_id,status);
alter table marketing.work_items add column if not exists review_note_type_id uuid references marketing.work_review_categories(id);
alter table marketing.work_items add column if not exists review_note_created_at timestamptz;
create table if not exists marketing.work_item_ratings (
  item_id uuid primary key references marketing.work_items(id) on delete cascade,
  assignee_id uuid not null references core.users(id),
  rated_by uuid not null references core.users(id),
  scores jsonb not null check(jsonb_typeof(scores)='array'),
  percentage numeric(5,2) not null check(percentage between 0 and 100),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists work_item_ratings_monthly on marketing.work_item_ratings(created_at,assignee_id);
-- Preserve previously approved files exactly as approved; previously submitted
-- formats remain awaiting review. A format without a ready file is not marked.
insert into marketing.work_format_reviews(item_id,format_id,status,submitted_at,approved_at,approved_by)
select i.id, f.value->>'id',
  case when i.status='approved' then 'approved' else 'submitted' end,
  i.submitted_at, case when i.status='approved' then i.approved_at else null end,
  case when i.status='approved' then i.approved_by else null end
from marketing.work_items i
cross join lateral jsonb_array_elements(i.formats) f(value)
where i.status in ('approved','submitted')
  and exists(select 1 from marketing.work_item_files w join marketing.files file on file.id=w.file_id
    where w.item_id=i.id and w.format_id=f.value->>'id' and w.category='final' and file.status='ready')
on conflict(item_id,format_id) do nothing;
insert into marketing.workflow_migrations(code) values ('schema-5') on conflict do nothing;
commit;
`;

export const MARKETING_WORKFLOW_NOTES_SQL = `begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
create table if not exists marketing.work_item_review_notes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references marketing.work_items(id) on delete cascade,
  category_id uuid references marketing.work_review_categories(id) on delete set null,
  note text not null check(length(trim(note))>0),
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  deleted_at timestamptz,
  legacy_import boolean not null default false
);
create unique index if not exists work_item_review_notes_legacy_unique
  on marketing.work_item_review_notes(item_id) where legacy_import;
create index if not exists work_item_review_notes_active
  on marketing.work_item_review_notes(item_id, created_at desc) where responded_at is null and deleted_at is null;
-- Import the original single review note exactly once without discarding it.
insert into marketing.work_item_review_notes(item_id,category_id,note,created_at,legacy_import)
select i.id,i.review_note_type_id,i.review_note,coalesce(i.review_note_created_at,i.updated_at),true
from marketing.work_items i where length(trim(i.review_note))>0
on conflict do nothing;
create table if not exists marketing.social_follower_snapshots (
  platform text not null check(platform in ('tiktok')),
  channel_id bigint not null,
  account_name text not null default '',
  snapshot_date date not null,
  followers bigint not null check(followers >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(platform,channel_id,snapshot_date)
);
create index if not exists social_follower_snapshots_date
  on marketing.social_follower_snapshots(snapshot_date desc,channel_id);
insert into marketing.workflow_migrations(code) values ('schema-6') on conflict do nothing;
commit;`;

export const MARKETING_WORKFLOW_PLAN_SCHEDULE_SQL = `begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
alter table marketing.work_plans add column if not exists is_deleted boolean not null default false;
alter table marketing.work_plans add column if not exists activated_at timestamptz;
alter table marketing.work_plans add column if not exists activated_by uuid references core.users(id);
alter table marketing.work_plans add column if not exists deleted_at timestamptz;
alter table marketing.work_plans add column if not exists deleted_by uuid references core.users(id);
alter table marketing.work_plan_items add column if not exists is_deleted boolean not null default false;
alter table marketing.work_plan_items add column if not exists post_type_id uuid references marketing.platform_post_types(id);
alter table marketing.work_plan_items add column if not exists budget_amount numeric(15,2) not null default 0;
alter table marketing.work_plan_items drop constraint if exists work_plan_items_plan_id_product_id_scheduled_on_key;
create unique index if not exists work_plan_unique_entry
  on marketing.work_plan_items(plan_id,product_id,scheduled_on,(coalesce(post_type_id,'00000000-0000-0000-0000-000000000000'::uuid)));
insert into marketing.workflow_migrations(code) values('schema-4') on conflict do nothing;
commit;`;

/**
 * Marketing V2 plan columns were introduced after many installations already
 * had work_plans and work_plan_items. Read the actual catalog, not only the
 * schema-4 marker, so an older database can never be reported as ready.
 * This inspection is strictly read-only and safe on dashboard requests.
 */
const PLAN_SCHEDULE_COLUMNS = [
  ['work_plans', 'is_deleted'], ['work_plans', 'activated_at'],
  ['work_plans', 'activated_by'], ['work_plans', 'deleted_at'],
  ['work_plans', 'deleted_by'], ['work_plan_items', 'is_deleted'],
  ['work_plan_items', 'post_type_id'], ['work_plan_items', 'budget_amount'],
] as const;

export async function marketingPlanScheduleSchemaStatus(sql = getSql()) {
  const [relations] = await sql<{ plans: boolean; lines: boolean; migrations: boolean; unique_index: boolean }[]>`
    select to_regclass('marketing.work_plans') is not null as plans,
      to_regclass('marketing.work_plan_items') is not null as lines,
      to_regclass('marketing.workflow_migrations') is not null as migrations,
      to_regclass('marketing.work_plan_unique_entry') is not null as unique_index
  `;
  const baseReady = Boolean(relations?.plans && relations?.lines && relations?.migrations);
  if (!baseReady) return { ready: false, baseReady: false, missing: ['marketing.work_plans / marketing.work_plan_items'] };
  const [columns, migrations] = await Promise.all([
    sql<{ table_name: string; column_name: string }[]>`
      select table_name,column_name from information_schema.columns
      where table_schema='marketing'
        and table_name in ('work_plans','work_plan_items')
    `,
    sql<{ code: string }[]>`select code from marketing.workflow_migrations where code='schema-4'`,
  ]);
  const present = new Set(columns.map(column => `${column.table_name}.${column.column_name}`));
  const missing = PLAN_SCHEDULE_COLUMNS
    .map(([table, column]) => `${table}.${column}`)
    .filter(column => !present.has(column));
  if (!relations.unique_index) missing.push('work_plan_unique_entry');
  if (!migrations.length) missing.push('schema-4');
  return { ready: !missing.length, baseReady: true, missing };
}

/**
 * Only a platform superadmin may invoke this explicit additive upgrade.
 * Ordinary GET requests NEVER acquire DDL locks or change the database.
 * A shared advisory lock + short lock/statement timeouts make concurrent
 * Vercel invocations safe. The SQL migration is atomic and idempotent.
 */
export async function upgradeMarketingPlanScheduleSchema() {
  const sql = getSql();
  const current = await marketingPlanScheduleSchemaStatus(sql);
  if (!current.baseReady) {
    const error = new Error('يجب تهيئة قاعدة بيانات التسويق الأساسية أولًا قبل تحديث جداول النشر');
    (error as Error & { code?: string }).code = 'MARKETING_SCHEMA_NOT_READY';
    throw error;
  }
  if (current.ready) return { ready: true, alreadyApplied: true };
  const { acquired } = await tryWithDatabaseAdvisoryLock('mzj:marketing:schema-setup', async () => {
    if (!(await marketingPlanScheduleSchemaStatus(sql)).ready) {
      await runSqlScript(MARKETING_WORKFLOW_PLAN_SCHEDULE_SQL);
    }
  });
  if (!acquired) {
    const error = new Error('تهيئة قاعدة بيانات التسويق قيد التنفيذ، يرجى إعادة المحاولة بعد قليل');
    (error as Error & { code?: string }).code = 'MARKETING_MIGRATION_BUSY';
    throw error;
  }
  const upgraded = await marketingPlanScheduleSchemaStatus(sql);
  if (!upgraded.ready) throw new Error('لم يكتمل تحديث قاعدة بيانات التسويق؛ يرجى مراجعة صلاحيات قاعدة البيانات');
  return { ready: true, alreadyApplied: false };
}

let ready: Promise<void> | null = null;
export function ensureMarketingWorkflowSchema() {
  if (!ready) ready = (async () => {
    const sql = getSql();
    const flags = async () => {
      const [present] = await sql<{ relation: string | null }[]>`select to_regclass('marketing.workflow_migrations')::text as relation`;
      if (!present?.relation) return { base: false, hasTaskDeletion: false, hasDrafts: false, current: false, hasKpi: false, hasNotes: false };
      const rows = await sql<{ code: string }[]>`select code from marketing.workflow_migrations where code in ('schema-1','schema-2','schema-3','schema-4','schema-5','schema-6')`;
      return { base: rows.some(x => x.code === 'schema-1'), hasTaskDeletion: rows.some(x => x.code === 'schema-2'), hasDrafts: rows.some(x => x.code === 'schema-3'), current: rows.some(x => x.code === 'schema-4'), hasKpi: rows.some(x => x.code === 'schema-5'), hasNotes: rows.some(x => x.code === 'schema-6') };
    };
    if ((await flags()).current && (await flags()).hasKpi && (await flags()).hasNotes && (await marketingPlanScheduleSchemaStatus(sql)).ready) return;
    // Avoid waiting behind a second cold-start migration. The first request
    // performs the migration; other requests receive a quick retriable error.
    const { acquired } = await tryWithDatabaseAdvisoryLock('mzj:marketing:schema-setup', async () => {
      const state = await flags();
      if (!state.base) await runSqlScript(MARKETING_WORKFLOW_SQL);
      if (!(await flags()).hasTaskDeletion) await runSqlScript(MARKETING_WORKFLOW_TASK_DELETE_SQL);
      if (!(await flags()).hasDrafts) await runSqlScript(MARKETING_WORKFLOW_UPGRADE_SQL);
      if (!(await marketingPlanScheduleSchemaStatus(sql)).ready) await runSqlScript(MARKETING_WORKFLOW_PLAN_SCHEDULE_SQL);
      if (!(await flags()).hasKpi) await runSqlScript(MARKETING_WORKFLOW_KPI_SQL);
      if (!(await flags()).hasNotes) await runSqlScript(MARKETING_WORKFLOW_NOTES_SQL);
    });
    if (!acquired) {
      const error = new Error('تهيئة قاعدة بيانات التسويق قيد التنفيذ، يرجى إعادة المحاولة بعد قليل');
      (error as Error & { code?: string }).code = 'MARKETING_MIGRATION_BUSY';
      throw error;
    }
  })().catch(error => { ready = null; throw error; });
  return ready;
}

/**
 * Normal Marketing requests must NEVER execute DDL, lock table schemas or
 * race with a cold-start migration. Database setup is a separate, controlled
 * operation (platform bootstrap). Inspect only catalog metadata at startup.
 * Catalog checks are intentionally read-only and shared per server instance.
 */
let workflowStructureReady: Promise<void> | null = null;
export function assertMarketingWorkflowReady(sql = getSql()) {
  if (!workflowStructureReady) {
    workflowStructureReady = (async () => {
      const [state] = await sql<{ tasks: boolean; items: boolean; plans: boolean; drafts: boolean; files: boolean; ratings: boolean; formats: boolean; categories: boolean; notes: boolean; social: boolean }[]>`
        select
          to_regclass('marketing.work_tasks') is not null as tasks,
          to_regclass('marketing.work_items') is not null as items,
          to_regclass('marketing.work_plans') is not null as plans,
          to_regclass('marketing.work_product_drafts') is not null as drafts,
          to_regclass('marketing.work_item_files') is not null as files,
          to_regclass('marketing.work_item_ratings') is not null as ratings,
          to_regclass('marketing.work_format_reviews') is not null as formats,
          to_regclass('marketing.work_review_categories') is not null as categories,
          to_regclass('marketing.work_item_review_notes') is not null as notes,
          to_regclass('marketing.social_follower_snapshots') is not null as social
      `;
      if (!state || !state.tasks || !state.items || !state.plans || !state.drafts || !state.files || !state.ratings || !state.formats || !state.categories || !state.notes || !state.social) {
        const error = new Error('قاعدة بيانات التسويق تحتاج إلى تهيئة أولية منفصلة قبل تشغيل الفلو الجديد');
        (error as Error & { code?: string }).code = 'MARKETING_SCHEMA_NOT_READY';
        throw error;
      }
      const planSchema = await marketingPlanScheduleSchemaStatus(sql);
      if (!planSchema.ready) {
        const error = new Error('قاعدة بيانات التسويق تحتاج تحديث جداول النشر. اطلب من مدير النظام تنفيذ تحديث قاعدة البيانات من الداش بورد.');
        (error as Error & { code?: string }).code = 'MARKETING_SCHEMA_UPGRADE_REQUIRED';
        throw error;
      }
    })().catch(error => { workflowStructureReady = null; throw error; });
  }
  return workflowStructureReady;
}
