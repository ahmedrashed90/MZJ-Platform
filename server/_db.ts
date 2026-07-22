import postgres from "postgres";

let client: ReturnType<typeof postgres> | null = null;

export function databaseConfigured() {
  return Boolean(String(process.env.DATABASE_URL || "").trim());
}

export function getSql() {
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (!connectionString) {
    const error = new Error("DATABASE_URL is not configured");
    (error as Error & { code?: string }).code = "DATABASE_NOT_CONFIGURED";
    throw error;
  }

  if (!client) {
    client = postgres(connectionString, {
      max: 4,
      prepare: false,
      connect_timeout: 12,
      idle_timeout: 20,
      max_lifetime: 60 * 30,
      onnotice: () => undefined,
    });
  }

  return client;
}

function splitSqlStatements(sqlText: string) {
  const statements: string[] = [];
  let current = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;
  let dollarTag = "";

  for (let index = 0; index < sqlText.length; index += 1) {
    const char = sqlText[index];
    const next = sqlText[index + 1] || "";

    if (lineComment) {
      current += char;
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }

    if (dollarTag) {
      if (sqlText.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = "";
      } else {
        current += char;
      }
      continue;
    }

    if (!singleQuoted && !doubleQuoted && char === "-" && next === "-") {
      current += char + next;
      index += 1;
      lineComment = true;
      continue;
    }

    if (!singleQuoted && !doubleQuoted && char === "/" && next === "*") {
      current += char + next;
      index += 1;
      blockComment = true;
      continue;
    }

    if (!doubleQuoted && char === "'") {
      current += char;
      if (singleQuoted && next === "'") {
        current += next;
        index += 1;
      } else {
        singleQuoted = !singleQuoted;
      }
      continue;
    }

    if (!singleQuoted && char === '"') {
      current += char;
      if (doubleQuoted && next === '"') {
        current += next;
        index += 1;
      } else {
        doubleQuoted = !doubleQuoted;
      }
      continue;
    }

    if (!singleQuoted && !doubleQuoted && char === "$") {
      const match = sqlText.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        index += dollarTag.length - 1;
        continue;
      }
    }

    if (!singleQuoted && !doubleQuoted && char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }

    current += char;
  }

  const finalStatement = current.trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}

export async function runSqlScript(sqlText: string) {
  const sql = getSql();
  const statements = splitSqlStatements(sqlText);
  const transactionWrapped = statements.length >= 2
    && /^begin(?:\s+transaction)?$/i.test(statements[0].trim())
    && /^(?:commit|end)(?:\s+transaction)?$/i.test(statements[statements.length - 1].trim());
  if (transactionWrapped) {
    await sql.begin(async (tx) => {
      for (const statement of statements.slice(1, -1)) await tx.unsafe(statement);
    });
    return;
  }
  for (const statement of statements) await sql.unsafe(statement);
}
