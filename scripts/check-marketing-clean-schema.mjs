import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fail = (message) => { throw new Error(`Marketing clean schema check failed: ${message}`); };

const canonical = read("database/marketing_native_schema.sql").trim();
const runtimeSource = read("server/_marketing-schema.ts");
const migration = read("database/migrations/20260723_marketing_native_clean_rebuild.sql").trim();
const dbSource = read("server/_db.ts");
const baseRuntimeSchema = read("server/_schema.ts");
const baseDeploymentSchema = read("database/schema.sql");

const runtimeMatch = runtimeSource.match(/MARKETING_SCHEMA_SQL = String\.raw`([\s\S]*?)`;/);
if (!runtimeMatch) fail("runtime SQL block is missing");
if (runtimeMatch[1].trim() !== canonical) fail("runtime SQL differs from canonical SQL");
if (migration !== canonical) fail("deployment migration differs from canonical SQL");
if (!/^begin;\s*/i.test(canonical) || !/\scommit;$/i.test(canonical)) fail("schema is not transaction wrapped");
if (!runtimeSource.includes('withDatabaseAdvisoryLock("mzj:marketing-native-schema:v1200"')) fail("schema advisory lock is missing or version-mismatched");
if (!runtimeSource.includes("async function marketingSchemaIsCurrent()") || !runtimeSource.includes("Number(state?.table_count || 0) === 29") || !runtimeSource.includes("Boolean(state?.platform_fk_ok)") || !runtimeSource.includes("Boolean(state?.no_legacy_fk)")) fail("schema fast-path contract verification is incomplete");
if ((runtimeSource.match(/await marketingSchemaIsCurrent()/g) || []).length < 2) fail("schema state must be checked before and after acquiring the advisory lock");
if (!dbSource.includes("transactionWrapped") || !dbSource.includes("sql.begin")) fail("transaction-aware SQL runner is missing");
if (/\balter\s+table\s+marketing_native\./i.test(canonical)) fail("clean isolated schema must not contain compatibility ALTER TABLE statements");
if (/\bdrop\s+(?:schema|table)\b/i.test(canonical)) fail("destructive DROP statement is forbidden");
if (!canonical.includes("marketing_native schema validation failed")) fail("transactional runtime self-validation block is missing");
if (!canonical.includes("platform_post_types FK does not target marketing_native.platforms")) fail("platform post-type FK self-check is missing");
if (!canonical.includes("a foreign key still targets legacy marketing schema")) fail("legacy FK target self-check is missing");
if ((canonical.match(/\$\$/g) || []).length !== 2 || !/do \$\$[\s\S]*end \$\$;/i.test(canonical)) fail("PostgreSQL DO block dollar quoting is malformed");

function splitSqlStatements(sqlText) {
  const statements = [];
  let current = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;
  let dollarTag = "";
  for (let index = 0; index < sqlText.length; index += 1) {
    const char = sqlText[index];
    const next = sqlText[index + 1] || "";
    if (lineComment) { current += char; if (char === "\n") lineComment = false; continue; }
    if (blockComment) { current += char; if (char === "*" && next === "/") { current += next; index += 1; blockComment = false; } continue; }
    if (dollarTag) {
      if (sqlText.startsWith(dollarTag, index)) { current += dollarTag; index += dollarTag.length - 1; dollarTag = ""; }
      else current += char;
      continue;
    }
    if (!singleQuoted && !doubleQuoted && char === "-" && next === "-") { current += char + next; index += 1; lineComment = true; continue; }
    if (!singleQuoted && !doubleQuoted && char === "/" && next === "*") { current += char + next; index += 1; blockComment = true; continue; }
    if (!doubleQuoted && char === "'") { current += char; if (singleQuoted && next === "'") { current += next; index += 1; } else singleQuoted = !singleQuoted; continue; }
    if (!singleQuoted && char === '"') { current += char; if (doubleQuoted && next === '"') { current += next; index += 1; } else doubleQuoted = !doubleQuoted; continue; }
    if (!singleQuoted && !doubleQuoted && char === "$") {
      const tag = sqlText.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) { dollarTag = tag; current += tag; index += tag.length - 1; continue; }
    }
    if (!singleQuoted && !doubleQuoted && char === ";") { if (current.trim()) statements.push(current.trim()); current = ""; continue; }
    current += char;
  }
  if (dollarTag || singleQuoted || doubleQuoted || blockComment) fail("canonical SQL contains an unterminated quoted block");
  if (current.trim()) statements.push(current.trim());
  return statements;
}
const sqlStatements = splitSqlStatements(canonical);
if (!/^begin$/i.test(sqlStatements[0]) || !/^commit$/i.test(sqlStatements.at(-1))) fail("SQL splitter does not preserve transaction boundaries");
if (sqlStatements.filter((statement) => /^do \$\$/i.test(statement)).length !== 1) fail("PostgreSQL DO block is not preserved as one SQL statement");

function splitTopLevel(body) {
  const parts = [];
  let current = "";
  let depth = 0;
  let single = false;
  let double = false;
  let dollarTag = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1] || "";
    if (dollarTag) {
      if (body.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = "";
      } else current += char;
      continue;
    }
    if (!single && !double && char === "$") {
      const tag = body.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        dollarTag = tag;
        current += tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (char === "'" && !double) {
      current += char;
      if (single && next === "'") {
        current += next;
        index += 1;
      } else single = !single;
      continue;
    }
    if (char === '"' && !single) {
      current += char;
      if (double && next === '"') {
        current += next;
        index += 1;
      } else double = !double;
      continue;
    }
    if (!single && !double) {
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const tables = new Map();
const tableOrder = [];
const tablePattern = /create table if not exists marketing_native\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi;
for (const match of canonical.matchAll(tablePattern)) {
  const name = match[1].toLowerCase();
  if (tables.has(name)) fail(`table declared more than once: ${name}`);
  const columns = new Map();
  const uniqueSets = [];
  const body = match[2];
  for (const item of splitTopLevel(body)) {
    const normalized = item.trim();
    const tableUnique = normalized.match(/^unique\s*\(([^)]+)\)/i);
    if (tableUnique) {
      uniqueSets.push(tableUnique[1].split(",").map((value) => value.trim().replaceAll('"', "").toLowerCase()));
      continue;
    }
    if (/^(?:primary\s+key|constraint|check|foreign\s+key|exclude)\b/i.test(normalized)) continue;
    const columnMatch = normalized.match(/^"?([a-z_][a-z0-9_]*)"?\s+([\s\S]+)$/i);
    if (!columnMatch) fail(`could not parse column in ${name}: ${normalized}`);
    const column = columnMatch[1].toLowerCase();
    const definition = columnMatch[2].trim();
    if (columns.has(column)) fail(`duplicate column ${name}.${column}`);
    columns.set(column, {
      definition,
      notNull: /\bnot\s+null\b/i.test(definition) || /\bprimary\s+key\b/i.test(definition),
      hasDefault: /\bdefault\b/i.test(definition) || /\b(?:bigserial|serial|identity)\b/i.test(definition),
      primary: /\bprimary\s+key\b/i.test(definition),
      unique: /\bunique\b/i.test(definition),
    });
    if (/\bunique\b/i.test(definition)) uniqueSets.push([column]);
    if (/\bprimary\s+key\b/i.test(definition)) uniqueSets.push([column]);
  }
  tables.set(name, { columns, uniqueSets, body, position: match.index });
  tableOrder.push(name);
}

const expectedTables = [
  "schema_meta", "departments", "department_users", "assignment_actions", "creative_types", "campaign_types",
  "platforms", "platform_post_types", "package_categories", "request_statuses", "campaigns", "creatives",
  "instance_assignments", "instance_vehicles", "budget_items", "publish_schedule", "tasks", "task_action_progress",
  "task_uploads", "task_reviews", "project_links", "project_files", "packages", "attendance_settings",
  "attendance_records", "presence_status", "attendance_requests", "platform_connections", "activity_log",
];
if (tables.size !== expectedTables.length) fail(`expected ${expectedTables.length} tables, found ${tables.size}`);
for (const table of expectedTables) if (!tables.has(table)) fail(`missing canonical table ${table}`);
if (tableOrder.join(",") !== expectedTables.join(",")) fail("canonical table order changed unexpectedly");

for (const match of canonical.matchAll(/references\s+([a-z_]+)\.([a-z_]+)\s*\(([^)]+)\)/gi)) {
  const schemaName = match[1].toLowerCase();
  const parentTable = match[2].toLowerCase();
  const parentColumn = match[3].trim().replaceAll('"', "").toLowerCase();
  if (schemaName === "marketing") fail(`foreign key still references legacy marketing.${parentTable}`);
  if (schemaName === "marketing_native") {
    const parent = tables.get(parentTable);
    if (!parent) fail(`foreign key references missing parent marketing_native.${parentTable}`);
    if (!parent.columns.has(parentColumn)) fail(`foreign key references missing parent column ${parentTable}.${parentColumn}`);
    const statementPrefix = canonical.slice(0, match.index);
    const childMatch = [...statementPrefix.matchAll(/create table if not exists marketing_native\.([a-z_]+)\s*\(/gi)].at(-1);
    const childTable = childMatch?.[1]?.toLowerCase();
    if (!childTable) fail(`could not resolve child table for FK to ${parentTable}`);
    if (childTable !== parentTable && tables.get(parentTable).position > tables.get(childTable).position) {
      fail(`parent table ${parentTable} is created after child table ${childTable}`);
    }
  } else if (!new Set(["core", "operations"]).has(schemaName)) {
    fail(`unexpected external FK schema ${schemaName}.${parentTable}`);
  }
}

for (const [tableName, table] of tables) {
  for (const [columnName, column] of table.columns) {
    for (const ref of column.definition.matchAll(/references\s+([a-z_]+)\.([a-z_]+)\s*\(([^)]+)\)/gi)) {
      if (ref[1].toLowerCase() === "marketing_native" && ref[2].toLowerCase() === tableName && columnName !== "template_task_id") {
        fail(`unexpected self-referencing FK ${tableName}.${columnName}`);
      }
    }
  }
}

const uniqueIndexPattern = /create\s+unique\s+index\s+if\s+not\s+exists\s+[a-z_][a-z0-9_]*\s+on\s+marketing_native\.([a-z_]+)\s*\(([^;]+?)\)(?:\s+where\s+[^;]+)?;/gi;
for (const match of canonical.matchAll(uniqueIndexPattern)) {
  const table = tables.get(match[1].toLowerCase());
  if (!table) fail(`unique index targets missing table ${match[1]}`);
  const simpleColumns = splitTopLevel(match[2]).map((value) => value.trim().replaceAll('"', "").toLowerCase());
  if (simpleColumns.every((column) => /^[a-z_][a-z0-9_]*$/.test(column))) table.uniqueSets.push(simpleColumns);
}

let insertCount = 0;
for (const match of canonical.matchAll(/insert\s+into\s+marketing_native\.([a-z_]+)\s*\(([^)]+)\)\s*([\s\S]*?)(?=\n\s*(?:insert\s+into|do\s+\$\$|commit;))/gi)) {
  insertCount += 1;
  const tableName = match[1].toLowerCase();
  const table = tables.get(tableName);
  if (!table) fail(`seed insert targets missing table ${tableName}`);
  const columns = match[2].split(",").map((value) => value.trim().replaceAll('"', "").toLowerCase()).filter(Boolean);
  for (const column of columns) if (!table.columns.has(column)) fail(`seed insert uses missing column ${tableName}.${column}`);
  const required = [...table.columns.entries()]
    .filter(([, column]) => column.notNull && !column.hasDefault)
    .map(([column]) => column);
  const missingRequired = required.filter((column) => !columns.includes(column));
  if (missingRequired.length) fail(`seed insert into ${tableName} omits required columns: ${missingRequired.join(", ")}`);

  const conflict = match[3].match(/on\s+conflict\s*\(([^)]+)\)/i);
  if (conflict) {
    const conflictColumns = conflict[1].split(",").map((value) => value.trim().replaceAll('"', "").toLowerCase());
    const valid = table.uniqueSets.some((set) => set.length === conflictColumns.length && set.every((column, index) => column === conflictColumns[index]));
    if (!valid) fail(`ON CONFLICT target is not backed by a unique key: ${tableName}(${conflictColumns.join(",")})`);
  }
}
if (insertCount !== 10) fail(`expected 10 marketing seed inserts, found ${insertCount}`);

const platformSeedPosition = canonical.indexOf("insert into marketing_native.platforms");
const postTypeSeedPosition = canonical.indexOf("insert into marketing_native.platform_post_types");
if (platformSeedPosition < 0 || postTypeSeedPosition < 0 || platformSeedPosition > postTypeSeedPosition) fail("platform seed must run before platform_post_types seed");
const postTypeSeed = canonical.slice(postTypeSeedPosition, canonical.indexOf("insert into marketing_native.package_categories", postTypeSeedPosition));
if (!/select\s+p\.id/i.test(postTypeSeed) || !/from\s+marketing_native\.platforms\s+p/i.test(postTypeSeed) || !/on\s+v\.platform_code\s*=\s*p\.code/i.test(postTypeSeed)) {
  fail("platform_post_types seed does not resolve parent IDs from marketing_native.platforms");
}

const forbiddenLegacyObject = /\b(?:from|join|into|update|table|sequence|references)\s+marketing\.(?:schema_meta|departments|department_users|assignment_actions|creative_types|campaign_types|platforms|platform_post_types|package_categories|request_statuses|campaigns|creatives|instance_assignments|instance_vehicles|budget_items|publish_schedule|tasks|task_action_progress|task_uploads|task_reviews|project_links|project_files|packages|attendance_settings|attendance_records|presence_status|attendance_requests|platform_connections|activity_log|project_code_seq|task_no_seq|photo_request_no_seq)\b/i;
if (forbiddenLegacyObject.test(runtimeSource)) fail("runtime schema still references a legacy marketing object");
if (forbiddenLegacyObject.test(baseRuntimeSchema)) fail("base runtime schema still creates a legacy marketing domain object");
if (forbiddenLegacyObject.test(baseDeploymentSchema)) fail("base deployment schema still creates a legacy marketing domain object");

const externalParents = [
  ["core.users", /create\s+table\s+if\s+not\s+exists\s+core\.users\b/i],
  ["operations.vehicles", /create\s+table\s+if\s+not\s+exists\s+operations\.vehicles\b/i],
];
for (const [name, pattern] of externalParents) {
  if (!pattern.test(baseRuntimeSchema) && !pattern.test(baseDeploymentSchema)) fail(`external FK parent is not defined by the platform schema: ${name}`);
}

console.log(`Marketing clean schema checks passed: ${tables.size} tables, ${[...tables.values()].reduce((sum, table) => sum + table.columns.size, 0)} columns, ${insertCount} seeds`);
