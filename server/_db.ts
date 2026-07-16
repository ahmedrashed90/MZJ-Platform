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

export async function runSqlScript(sqlText: string) {
  const sql = getSql();
  const statements = sqlText
    .split(/;\s*(?:\r?\n|$)/g)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await sql.unsafe(statement);
  }
}
