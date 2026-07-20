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

function splitSqlScript(sqlText: string) {
  return sqlText
    .split(/;\s*(?:\r?\n|$)/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function runSqlScript(sqlText: string) {
  const sql = getSql();
  for (const statement of splitSqlScript(sqlText)) {
    await sql.unsafe(statement);
  }
}

export async function runSqlScriptTransaction(sqlText: string, lockKey: string) {
  const sql = getSql();
  const statements = splitSqlScript(sqlText);
  await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext(${lockKey}))`;
    for (const statement of statements) {
      await transaction.unsafe(statement);
    }
  });
}

export async function runSqlMigrationTransaction(
  sqlText: string,
  lockKey: string,
  migrationTable: string,
  migrationKey: string,
) {
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(migrationTable)) {
    throw new Error("Invalid migration table identifier");
  }
  const [schemaName] = migrationTable.split(".");
  const sql = getSql();
  const statements = splitSqlScript(sqlText);
  await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext(${lockKey}))`;
    await transaction.unsafe(`create schema if not exists ${schemaName}`);
    await transaction.unsafe(`create table if not exists ${migrationTable} (migration_key text primary key, applied_at timestamptz not null default now())`);
    const applied = await transaction.unsafe(`select migration_key from ${migrationTable} where migration_key = $1 limit 1`, [migrationKey]);
    if (applied.length > 0) return;
    for (const statement of statements) {
      await transaction.unsafe(statement);
    }
  });
}
