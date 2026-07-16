import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "./_auth";
import { getSql } from "./_db";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireUser(request, response);
  if (!user) return;

  const sql = getSql();
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
  }
}
