import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fail = (message) => { throw new Error(`Marketing schema contract check failed: ${message}`); };

const canonical = read("database/marketing_native_schema.sql").trim();
const runtimeSource = read("server/_marketing-schema.ts");
const migrationSource = read("database/migrations/20260723_marketing_native_rebuild.sql");
const apiSource = read("server/marketing/index.ts");
const dbSource = read("server/_db.ts");

const runtimeMatch = runtimeSource.match(/MARKETING_SCHEMA_SQL = String\.raw`([\s\S]*?)`;\n\nexport async function ensureMarketingSchema/);
if (!runtimeMatch) fail("runtime SQL block was not found");
if (runtimeMatch[1].trim() !== canonical) fail("runtime SQL and canonical SQL are different");

const migrationBody = migrationSource.trim();
if (migrationBody !== canonical) fail("deployment migration and canonical SQL are different");

if (!/^begin;/i.test(canonical) || !/commit;$/i.test(canonical)) fail("schema must be one transaction");
if (!runtimeSource.includes('withDatabaseAdvisoryLock("mzj:marketing-schema:v5"')) fail("runtime migration must use the advisory lock");
if (!dbSource.includes("transactionWrapped") || !dbSource.includes("sql.begin")) fail("SQL runner transaction support is missing");
if (!canonical.includes("Runtime schema contract verification")) fail("runtime information_schema postcheck is missing");
if (!canonical.includes("One-time, data-preserving normalization of the legacy campaign type aliases")) fail("legacy campaign type alias migration is missing");
if (!canonical.includes("Normalize write blockers left by pre-native marketing tables")) fail("generic legacy write-blocker normalization is missing");
if (!canonical.includes("Legacy marketing columns still block native writes")) fail("legacy write-blocker postcheck is missing");
for (const indexName of [
  "marketing_campaign_types_name_unique",
  "marketing_campaign_types_short_code_unique",
  "marketing_departments_code_unique",
  "marketing_platforms_code_unique",
  "marketing_platform_connections_platform_unique",
]) {
  if (!canonical.includes(`create unique index if not exists ${indexName}`)) fail(`existing-table unique index is missing: ${indexName}`);
}

function splitItems(body) {
  const parts = [];
  let current = "";
  let depth = 0;
  let single = false;
  let double = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1] || "";
    if (char === "'" && !double) {
      if (single && next === "'") { current += char + next; index += 1; continue; }
      single = !single;
    } else if (char === '"' && !single) double = !double;
    if (!single && !double) {
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === "," && depth === 0) { parts.push(current.trim()); current = ""; continue; }
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const tablePattern = /create table if not exists marketing\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi;
const tables = new Map();
for (const match of canonical.matchAll(tablePattern)) {
  const columns = [];
  for (const item of splitItems(match[2])) {
    const [rawName, ...rest] = item.split(/\s+/);
    const name = String(rawName || "").replaceAll('"', "").toLowerCase();
    if (!name || rest.length === 0 || /^(primary|unique|constraint|check|foreign|exclude)(?:$|\()/.test(name)) continue;
    columns.push({ name, definition: rest.join(" ") });
  }
  tables.set(match[1], columns);
}

if (tables.size < 28) fail(`expected at least 28 marketing tables, found ${tables.size}`);

for (const [table, columns] of tables) {
  for (const column of columns) {
    if (/\bprimary\s+key\b/i.test(column.definition)) continue;
    const expression = new RegExp(`alter table marketing\\.${table} add column if not exists ${column.name}\\b`, "i");
    if (!expression.test(canonical)) fail(`missing existing-table compatibility for marketing.${table}.${column.name}`);
    const contractEntry = new RegExp(`\\('${table}','${column.name}'\\)`, "i");
    if (!contractEntry.test(canonical)) fail(`missing runtime postcheck entry for marketing.${table}.${column.name}`);
  }
}

const requiredApiTables = [
  "activity_log", "assignment_actions", "attendance_records", "attendance_settings", "budget_items",
  "campaign_types", "campaigns", "creative_types", "creatives", "department_users", "departments",
  "instance_assignments", "instance_vehicles", "package_categories", "packages", "platform_connections",
  "platform_post_types", "platforms", "presence_status", "project_files", "project_links", "publish_schedule",
  "request_statuses", "task_action_progress", "task_reviews", "task_uploads", "tasks",
];
for (const table of requiredApiTables) {
  if (!tables.has(table)) fail(`API table marketing.${table} is absent from canonical schema`);
  if (!apiSource.includes(`marketing.${table}`)) fail(`API no longer references expected table marketing.${table}`);
}

for (const column of ["actor_id", "actor_name", "action", "entity_type", "entity_id", "details", "created_at"]) {
  if (!canonical.includes(`alter table marketing.activity_log add column if not exists ${column}`)) fail(`activity log repair is missing ${column}`);
}
const entityAlterPosition = canonical.indexOf("alter table marketing.activity_log add column if not exists entity_type");
const entityIndexPosition = canonical.indexOf("create index if not exists marketing_activity_log_entity_idx");
if (entityAlterPosition < 0 || entityIndexPosition < 0 || entityAlterPosition > entityIndexPosition) fail("activity log index is created before entity_type repair");

if (/attendance_settings[^;]*\bid\s*=\s*(?:true|'default')/i.test(apiSource)) fail("attendance runtime still depends on the legacy singleton id type");
if (/alter\s+table\s+marketing\.attendance_settings\s+alter\s+column\s+id\s+type/i.test(canonical)) fail("attendance id type conversion is forbidden");
if (!apiSource.includes("order by updated_at desc nulls last limit 1")) fail("attendance singleton read is not type-agnostic");
if (!apiSource.includes("where ctid=(select ctid from marketing.attendance_settings")) fail("attendance singleton update is not type-agnostic");

console.log(`Marketing schema contract checks passed: ${tables.size} tables, ${[...tables.values()].reduce((sum, cols) => sum + cols.length, 0)} columns`);
