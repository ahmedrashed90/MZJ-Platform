import type { VercelRequest, VercelResponse } from "@vercel/node";
import { databaseConfigured, getSql } from "../_db.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });

  response.setHeader("Cache-Control", "no-store");

  if (!databaseConfigured()) {
    return response.status(200).json({
      ok: true,
      databaseConfigured: false,
      databaseReachable: false,
      schemaReady: false,
      adminExists: false,
      setupKeyConfigured: Boolean(String(process.env.MZJ_SETUP_KEY || "").trim()),
    });
  }

  try {
    const sql = getSql();
    const [registry] = await sql<{
      users_table: string | null;
      roles_table: string | null;
      sessions_table: string | null;
    }[]>`
      select
        to_regclass('core.users')::text as users_table,
        to_regclass('core.roles')::text as roles_table,
        to_regclass('core.sessions')::text as sessions_table
    `;

    const schemaReady = Boolean(registry?.users_table && registry?.roles_table && registry?.sessions_table);
    let adminExists = false;

    if (schemaReady) {
      const [admin] = await sql<{ exists: boolean }[]>`
        select exists(
          select 1
          from core.users u
          join core.user_roles ur on ur.user_id = u.id
          join core.roles r on r.id = ur.role_id
          where u.is_active = true and r.code = 'admin'
        ) as exists
      `;
      adminExists = Boolean(admin?.exists);
    }

    return response.status(200).json({
      ok: true,
      databaseConfigured: true,
      databaseReachable: true,
      schemaReady,
      adminExists,
      setupKeyConfigured: Boolean(String(process.env.MZJ_SETUP_KEY || "").trim()),
    });
  } catch (error) {
    console.error("Setup status failed", error);
    return response.status(200).json({
      ok: true,
      databaseConfigured: true,
      databaseReachable: false,
      schemaReady: false,
      adminExists: false,
      setupKeyConfigured: Boolean(String(process.env.MZJ_SETUP_KEY || "").trim()),
      error: "تعذر الاتصال بقاعدة PostgreSQL باستخدام DATABASE_URL الحالي",
    });
  }
}
