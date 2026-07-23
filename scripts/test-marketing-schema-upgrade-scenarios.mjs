import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sql = fs.readFileSync(path.join(root, "database/marketing_native_schema.sql"), "utf8");

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
    if (!doubleQuoted && char === "'") {
      current += char;
      if (singleQuoted && next === "'") { current += next; index += 1; }
      else singleQuoted = !singleQuoted;
      continue;
    }
    if (!singleQuoted && char === '"') { current += char; doubleQuoted = !doubleQuoted; continue; }
    if (!singleQuoted && !doubleQuoted && char === "$") {
      const match = sqlText.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) { dollarTag = match[0]; current += dollarTag; index += dollarTag.length - 1; continue; }
    }
    if (!singleQuoted && !doubleQuoted && char === ";") { if (current.trim()) statements.push(current.trim()); current = ""; continue; }
    current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
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

function columnsFromCreate(body) {
  const columns = new Set();
  for (const item of splitItems(body)) {
    const [rawName, ...rest] = item.split(/\s+/);
    const name = String(rawName || "").replaceAll('"', "").toLowerCase();
    if (!name || rest.length === 0 || /^(primary|unique|constraint|check|foreign|exclude)(?:$|\()/.test(name)) continue;
    columns.add(name);
  }
  return columns;
}

const canonicalTables = new Map();
for (const match of sql.matchAll(/create table if not exists marketing\.([a-z_]+)\s*\(([\s\S]*?)\n\)/gi)) {
  canonicalTables.set(match[1], columnsFromCreate(match[2]));
}

const base118 = {
  campaigns: ["id", "legacy_id", "campaign_code", "name", "campaign_type", "objective", "status", "starts_at", "ends_at", "due_at", "created_by", "is_deleted", "created_at", "updated_at"],
  creatives: ["id", "campaign_id", "creative_type", "quantity", "status", "created_at"],
  tasks: ["id", "campaign_id", "creative_id", "department_code", "assigned_to", "paired_content_user_id", "status", "due_at", "completed_at", "created_at", "updated_at"],
};

const scenarios = [
  { name: "empty database", initial: {} },
  { name: "platform v1.18 base marketing tables", initial: base118 },
  {
    name: "partial legacy activity log and boolean attendance singleton",
    initial: {
      ...base118,
      attendance_settings: ["id", "work_start_time", "work_end_time", "updated_at"],
      activity_log: ["id", "action", "details", "created_at"],
    },
  },
  {
    name: "text attendance key left by interrupted schema attempt",
    initial: {
      ...base118,
      attendance_settings: ["id", "work_start_time", "work_end_time", "grace_minutes", "idle_after_minutes", "offline_after_minutes", "updated_at"],
      activity_log: ["id", "actor_id", "actor_name", "action", "entity_id", "details", "created_at"],
    },
  },
];

function simulate(scenario) {
  const tables = new Map(Object.entries(scenario.initial).map(([table, columns]) => [table, new Set(columns)]));
  const statements = splitSqlStatements(sql);
  if (!/^begin$/i.test(statements[0]) || !/^commit$/i.test(statements.at(-1))) throw new Error(`${scenario.name}: SQL is not transaction-wrapped`);

  for (const statement of statements) {
    let match = statement.match(/create table if not exists marketing\.([a-z_]+)\s*\(([\s\S]*)\)$/i);
    if (match) {
      if (!tables.has(match[1])) tables.set(match[1], columnsFromCreate(match[2]));
      continue;
    }
    match = statement.match(/alter table marketing\.([a-z_]+) add column if not exists ([a-z_]+)/i);
    if (match) {
      if (!tables.has(match[1])) throw new Error(`${scenario.name}: ALTER ran before CREATE for marketing.${match[1]}`);
      tables.get(match[1]).add(match[2]);
      continue;
    }
    match = statement.match(/create(?: unique)? index if not exists [a-z0-9_]+ on marketing\.([a-z_]+)\s*\(([^;]+)\)/i);
    if (match) {
      const columns = tables.get(match[1]);
      if (!columns) throw new Error(`${scenario.name}: index references missing table marketing.${match[1]}`);
      const identifiers = [...match[2].matchAll(/\b([a-z_][a-z0-9_]*)\b/gi)].map((entry) => entry[1].toLowerCase());
      const ignored = new Set(["coalesce", "desc", "asc", "nulls", "last", "first", "uuid"]);
      for (const identifier of identifiers) {
        if (ignored.has(identifier) || /^0+$/.test(identifier)) continue;
        if (!columns.has(identifier) && !["true", "false"].includes(identifier)) {
          throw new Error(`${scenario.name}: index on marketing.${match[1]} references missing column ${identifier}`);
        }
      }
    }
  }

  for (const [table, expectedColumns] of canonicalTables) {
    const actualColumns = tables.get(table);
    if (!actualColumns) throw new Error(`${scenario.name}: marketing.${table} was not created`);
    for (const column of expectedColumns) {
      if (!actualColumns.has(column)) throw new Error(`${scenario.name}: missing marketing.${table}.${column} after upgrade`);
    }
  }
}

for (const scenario of scenarios) simulate(scenario);
console.log(`Marketing schema upgrade simulations passed: ${scenarios.length} legacy states, ${canonicalTables.size} tables`);
