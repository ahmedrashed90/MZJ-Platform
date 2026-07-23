import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runtimeFiles = ["server/marketing/index.ts", "server/operations/index.ts", "server/_dashboard-data.ts", "server/_marketing-schema.ts"];
const api = runtimeFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const schema = fs.readFileSync(path.join(root, "database/marketing_native_schema.sql"), "utf8");

function splitItems(body) {
  const parts = [];
  let current = "";
  let depth = 0;
  let single = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1] || "";
    if (char === "'") {
      if (single && next === "'") { current += char + next; index += 1; continue; }
      single = !single;
    }
    if (!single) {
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === "," && depth === 0) { parts.push(current.trim()); current = ""; continue; }
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const tables = new Map();
for (const match of schema.matchAll(/create table if not exists marketing_native\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
  const columns = new Map();
  for (const item of splitItems(match[2])) {
    const [rawName, ...rest] = item.split(/\s+/);
    const name = String(rawName || "").replaceAll('"', "").toLowerCase();
    if (!name || rest.length === 0 || /^(primary|unique|constraint|check|foreign|exclude)(?:$|\()/.test(name)) continue;
    const definition = rest.join(" ");
    columns.set(name, {
      required: /\bnot\s+null\b/i.test(definition) && !/\bdefault\b/i.test(definition) && !/\b(?:bigserial|serial|identity)\b/i.test(definition),
    });
  }
  tables.set(match[1].toLowerCase(), columns);
}

const keywords = new Set(["where", "set", "values", "returning", "on", "left", "right", "inner", "outer", "full", "cross", "join", "order", "group", "limit", "offset"]);
const errors = [];
const checked = new Set();
const templates = [...api.matchAll(/(?:sql|tx)`([\s\S]*?)`/g)].map((match) => match[1].replace(/\$\{[\s\S]*?\}/g, "NULL"));

function assertColumn(table, column, context) {
  const columns = tables.get(table);
  if (!columns) { errors.push(`missing schema table marketing_native.${table} (${context})`); return; }
  if (!columns.has(column)) errors.push(`missing schema column marketing_native.${table}.${column} (${context})`);
  else checked.add(`${table}.${column}`);
}

for (const query of templates) {
  const aliases = new Map();
  for (const match of query.matchAll(/\b(from|join|update|into)\s+marketing_native\.([a-z_]+)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi)) {
    const table = match[2].toLowerCase();
    let alias = String(match[3] || table).toLowerCase();
    if (keywords.has(alias)) alias = table;
    aliases.set(alias, table);
    aliases.set(table, table);
  }

  for (const match of query.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi)) {
    const alias = match[1].toLowerCase();
    const column = match[2].toLowerCase();
    const table = aliases.get(alias);
    if (table) assertColumn(table, column, query.trim().slice(0, 90));
  }

  const insert = query.match(/\binsert\s+into\s+marketing_native\.([a-z_]+)\s*\(([^)]*)\)/i);
  if (insert) {
    const tableName = insert[1].toLowerCase();
    const insertColumns = insert[2].split(",").map((value) => value.trim().replaceAll('"', "").toLowerCase()).filter(Boolean);
    for (const column of insertColumns) assertColumn(tableName, column, "insert column list");
    const tableColumns = tables.get(tableName);
    if (tableColumns) {
      const missingRequired = [...tableColumns.entries()]
        .filter(([, definition]) => definition.required)
        .map(([column]) => column)
        .filter((column) => !insertColumns.includes(column));
      if (missingRequired.length) errors.push(`runtime insert into marketing_native.${tableName} omits required columns: ${missingRequired.join(", ")}`);
    }
  }

  const update = query.match(/\bupdate\s+marketing_native\.([a-z_]+)(?:\s+[a-z_][a-z0-9_]*)?\s+set\s+([\s\S]*?)(?:\bwhere\b|\breturning\b|$)/i);
  if (update) {
    for (const assignment of splitItems(update[2])) {
      const column = assignment.match(/^([a-z_][a-z0-9_]*)\s*=/i)?.[1]?.toLowerCase();
      if (column) assertColumn(update[1].toLowerCase(), column, "update assignment");
    }
  }
}

if (errors.length) throw new Error(`Marketing native API/schema usage check failed:\n- ${[...new Set(errors)].join("\n- ")}`);
console.log(`Marketing native runtime/schema usage checks passed: ${runtimeFiles.length} files, ${templates.length} SQL templates, ${checked.size} table-column references`);
