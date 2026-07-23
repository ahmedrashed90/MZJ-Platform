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

function parseColumn(rawName, definition = "") {
  const name = String(rawName || "").replaceAll('"', "").toLowerCase();
  return {
    name,
    notNull: /\bnot\s+null\b/i.test(definition) || /\bprimary\s+key\b/i.test(definition),
    hasDefault: /\bdefault\b/i.test(definition) || /\bserial\b/i.test(definition),
    primaryKey: /\bprimary\s+key\b/i.test(definition),
  };
}

function columnsFromCreate(body) {
  const columns = new Map();
  const tablePrimaryKey = new Set();
  for (const item of splitItems(body)) {
    const pk = item.match(/^primary\s+key\s*\(([^)]*)\)/i);
    if (pk) {
      for (const name of pk[1].split(",").map((value) => value.trim().replaceAll('"', "").toLowerCase())) tablePrimaryKey.add(name);
      continue;
    }
    const [rawName, ...rest] = item.split(/\s+/);
    const name = String(rawName || "").replaceAll('"', "").toLowerCase();
    if (!name || rest.length === 0 || /^(unique|constraint|check|foreign|exclude)(?:$|\()/i.test(name)) continue;
    columns.set(name, parseColumn(name, rest.join(" ")));
  }
  for (const name of tablePrimaryKey) {
    const column = columns.get(name);
    if (column) { column.primaryKey = true; column.notNull = true; }
  }
  return columns;
}

const canonicalTables = new Map();
for (const match of sql.matchAll(/create table if not exists marketing\.([a-z_]+)\s*\(([\s\S]*?)\n\)/gi)) {
  canonicalTables.set(match[1], columnsFromCreate(match[2]));
}

const nullableColumns = (names) => Object.fromEntries(names.map((name) => [name, {}]));
const base118 = {
  campaigns: nullableColumns(["id", "legacy_id", "campaign_code", "name", "campaign_type", "objective", "status", "starts_at", "ends_at", "due_at", "created_by", "is_deleted", "created_at", "updated_at"]),
  creatives: nullableColumns(["id", "campaign_id", "creative_type", "quantity", "status", "created_at"]),
  tasks: nullableColumns(["id", "campaign_id", "creative_id", "department_code", "assigned_to", "paired_content_user_id", "status", "due_at", "completed_at", "created_at", "updated_at"]),
};

const scenarios = [
  { name: "empty database", initial: {} },
  { name: "platform v1.18 base marketing tables", initial: base118 },
  {
    name: "partial legacy activity log and boolean attendance singleton",
    initial: {
      ...base118,
      attendance_settings: {
        id: { notNull: true, hasDefault: true, primaryKey: true },
        work_start_time: {}, work_end_time: {}, updated_at: {},
      },
      activity_log: { id: { notNull: true, hasDefault: true, primaryKey: true }, action: {}, details: {}, created_at: {} },
    },
  },
  {
    name: "text attendance key left by interrupted schema attempt",
    initial: {
      ...base118,
      attendance_settings: {
        id: { notNull: true, hasDefault: true, primaryKey: true },
        work_start_time: {}, work_end_time: {}, grace_minutes: {}, idle_after_minutes: {}, offline_after_minutes: {}, updated_at: {},
      },
      activity_log: { id: { notNull: true, hasDefault: true, primaryKey: true }, actor_id: {}, actor_name: {}, action: {}, entity_id: {}, details: {}, created_at: {} },
    },
  },
  {
    name: "legacy campaign type aliases with required prefix and code",
    initial: {
      ...base118,
      campaign_types: {
        id: { notNull: true, hasDefault: true, primaryKey: true },
        name: { notNull: true },
        code: { notNull: true },
        prefix: { notNull: true },
        next_number: { notNull: true, hasDefault: true },
        created_at: { notNull: true, hasDefault: true },
        updated_at: { notNull: true, hasDefault: true },
      },
    },
  },
  {
    name: "unknown pre-native required aliases across settings tables",
    initial: {
      ...base118,
      campaign_types: {
        id: { notNull: true, hasDefault: true, primaryKey: true }, name: { notNull: true }, code: { notNull: true }, prefix: { notNull: true },
      },
      platforms: {
        id: { notNull: true, hasDefault: true, primaryKey: true }, code: { notNull: true }, name: { notNull: true }, legacy_label: { notNull: true },
      },
    },
  },
];

function normalizeInitial(initial) {
  return new Map(Object.entries(initial).map(([table, spec]) => {
    const columns = new Map();
    for (const [name, meta] of Object.entries(spec)) columns.set(name, { name, notNull: false, hasDefault: false, primaryKey: false, ...meta });
    return [table, columns];
  }));
}

function simulate(scenario) {
  const tables = normalizeInitial(scenario.initial);
  const statements = splitSqlStatements(sql);
  if (!/^begin$/i.test(statements[0]) || !/^commit$/i.test(statements.at(-1))) throw new Error(`${scenario.name}: SQL is not transaction-wrapped`);

  for (const statement of statements) {
    let match = statement.match(/create table if not exists marketing\.([a-z_]+)\s*\(([\s\S]*)\)$/i);
    if (match) {
      if (!tables.has(match[1])) tables.set(match[1], columnsFromCreate(match[2]));
      continue;
    }

    match = statement.match(/alter table marketing\.([a-z_]+) add column if not exists ([a-z_]+)\s+([\s\S]*)$/i);
    if (match) {
      if (!tables.has(match[1])) throw new Error(`${scenario.name}: ALTER ran before CREATE for marketing.${match[1]}`);
      if (!tables.get(match[1]).has(match[2])) tables.get(match[1]).set(match[2], parseColumn(match[2], match[3]));
      continue;
    }

    match = statement.match(/alter table marketing\.([a-z_]+) alter column ([a-z_]+) set default\b/i);
    if (match) { const column = tables.get(match[1])?.get(match[2]); if (column) column.hasDefault = true; continue; }
    match = statement.match(/alter table marketing\.([a-z_]+) alter column ([a-z_]+) drop not null\b/i);
    if (match) { const column = tables.get(match[1])?.get(match[2]); if (column) column.notNull = false; continue; }
    match = statement.match(/alter table marketing\.([a-z_]+) alter column ([a-z_]+) set not null\b/i);
    if (match) { const column = tables.get(match[1])?.get(match[2]); if (column) column.notNull = true; continue; }

    if (statement.includes("Normalize write blockers left by pre-native marketing tables")) {
      for (const [table, columns] of tables) {
        const canonical = canonicalTables.get(table) || new Map();
        for (const column of columns.values()) {
          if (!canonical.has(column.name) && column.notNull && !column.hasDefault && !column.primaryKey) column.notNull = false;
        }
      }
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
        if (!columns.has(identifier) && !["true", "false"].includes(identifier)) throw new Error(`${scenario.name}: index on marketing.${match[1]} references missing column ${identifier}`);
      }
      continue;
    }

    match = statement.match(/insert\s+into\s+marketing\.([a-z_]+)\s*\(([^)]*)\)/i);
    if (match) {
      const table = match[1];
      const columns = tables.get(table);
      if (!columns) throw new Error(`${scenario.name}: insert references missing table marketing.${table}`);
      const supplied = new Set(match[2].split(",").map((value) => value.trim().replaceAll('"', "").toLowerCase()).filter(Boolean));
      const blockers = [...columns.values()].filter((column) => column.notNull && !column.hasDefault && !supplied.has(column.name));
      if (blockers.length) throw new Error(`${scenario.name}: insert into marketing.${table} omits required columns without defaults: ${blockers.map((column) => column.name).join(", ")}`);
    }
  }

  for (const [table, expectedColumns] of canonicalTables) {
    const actualColumns = tables.get(table);
    if (!actualColumns) throw new Error(`${scenario.name}: marketing.${table} was not created`);
    for (const column of expectedColumns.keys()) if (!actualColumns.has(column)) throw new Error(`${scenario.name}: missing marketing.${table}.${column} after upgrade`);
  }

  for (const [table, columns] of tables) {
    const canonical = canonicalTables.get(table) || new Map();
    const blockers = [...columns.values()].filter((column) => !canonical.has(column.name) && column.notNull && !column.hasDefault && !column.primaryKey);
    if (blockers.length) throw new Error(`${scenario.name}: legacy write blockers remain on marketing.${table}: ${blockers.map((column) => column.name).join(", ")}`);
  }
}

for (const scenario of scenarios) simulate(scenario);
console.log(`Marketing schema upgrade simulations passed: ${scenarios.length} legacy states, ${canonicalTables.size} tables, legacy required-column writes validated`);
