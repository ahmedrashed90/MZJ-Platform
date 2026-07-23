import fs from "node:fs";

const file = "database/migrations/20260723_marketing_full_native_rebuild.sql";
const sql = fs.readFileSync(file, "utf8");

const required = [
  "begin;",
  "drop schema if exists marketing cascade;",
  "create schema marketing;",
  "create table marketing.campaigns",
  "create table marketing.creatives",
  "create table marketing.tasks",
  "create table if not exists marketing.publish_jobs",
  "target_id uuid not null references marketing.publish_targets(id)",
  "create index if not exists marketing_publish_jobs_target_idx on marketing.publish_jobs(target_id,created_at desc)",
  "operations_transfer_requests_marketing_campaign_fk",
  "commit;",
];

for (const needle of required) {
  if (!sql.includes(needle)) throw new Error(`Marketing migration check failed: missing ${needle}`);
}

for (const forbidden of [
  "create table if not exists marketing.publisher_devices",
  "create table if not exists marketing.publisher_import_plans",
  "create table if not exists marketing.checklist_projects",
]) {
  if (sql.includes(forbidden)) throw new Error(`Marketing migration check failed: obsolete feature remains: ${forbidden}`);
}

const publishJobs = sql.match(/create table if not exists marketing\.publish_jobs\s*\(([\s\S]*?)\n\);/i)?.[1] ?? "";
for (const column of ["target_id", "idempotency_key", "status", "created_at", "updated_at"]) {
  if (!new RegExp(`\\b${column}\\b`, "i").test(publishJobs)) {
    throw new Error(`Marketing migration check failed: publish_jobs missing ${column}`);
  }
}

const createJobsAt = sql.indexOf("create table if not exists marketing.publish_jobs");
const indexJobsAt = sql.indexOf("create index if not exists marketing_publish_jobs_target_idx");
if (createJobsAt < 0 || indexJobsAt < createJobsAt) {
  throw new Error("Marketing migration check failed: publish_jobs index is created before the canonical table");
}

const tags = [...sql.matchAll(/\$[A-Za-z_][A-Za-z0-9_]*\$/g)].map((match) => match[0]);
const tagCounts = new Map();
for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
for (const [tag, count] of tagCounts) {
  if (count % 2 !== 0) throw new Error(`Marketing migration check failed: unbalanced dollar quote ${tag}`);
}

console.log("Marketing canonical migration structure check passed.");
