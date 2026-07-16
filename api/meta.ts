import type { VercelRequest, VercelResponse } from "@vercel/node";
import postgres from "postgres";

export default async function handler(_request: VercelRequest, response: VercelResponse) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return response.status(503).json({ ok: false, error: "DATABASE_URL is not configured" });

  const sql = postgres(connectionString, { max: 1, prepare: false });
  try {
    const [departments, branches, roles] = await Promise.all([
      sql`select id::text, code, name, system_code from core.departments where is_active = true order by system_code, name`,
      sql`select id::text, code, name from core.branches where is_active = true order by sort_order, name`,
      sql`select id::text, code, name from core.roles order by name`,
    ]);
    return response.status(200).json({ ok: true, departments, branches, roles });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: "تعذر تحميل بيانات الإعدادات" });
  } finally {
    await sql.end({ timeout: 1 });
  }
}
