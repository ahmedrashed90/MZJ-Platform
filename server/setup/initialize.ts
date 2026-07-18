import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSession, requestIp, safeSecretEquals } from "../_auth.js";
import { databaseConfigured, getSql, runSqlScript } from "../_db.js";
import { SCHEMA_SQL, SEED_SQL } from "../_schema.js";
import { ensureAccessControlSchema, resetAccessControlSchemaCache } from "../_access-control-schema.js";
import { getEffectivePermissions } from "../_permissions.js";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  if (!databaseConfigured()) return response.status(503).json({ ok: false, error: "يجب ربط PostgreSQL وإضافة DATABASE_URL أولًا" });

  const configuredSetupKey = clean(process.env.MZJ_SETUP_KEY);
  if (!configuredSetupKey) {
    return response.status(503).json({ ok: false, error: "أضف MZJ_SETUP_KEY في Environment Variables ثم أعد النشر" });
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const setupKey = clean(body.setupKey);
  const fullName = clean(body.fullName);
  const employeeNo = clean(body.employeeNo) || null;
  const email = clean(body.email).toLowerCase() || null;
  const mobile = clean(body.mobile) || null;
  const password = clean(body.password);

  if (!safeSecretEquals(setupKey, configuredSetupKey)) return response.status(401).json({ ok: false, error: "مفتاح التهيئة غير صحيح" });
  if (!fullName) return response.status(400).json({ ok: false, error: "اسم مدير النظام مطلوب" });
  if (!email && !mobile) return response.status(400).json({ ok: false, error: "البريد الإلكتروني أو رقم الجوال مطلوب" });
  if (password.length < 10) return response.status(400).json({ ok: false, error: "كلمة المرور يجب ألا تقل عن 10 أحرف" });

  try {
    await runSqlScript(SCHEMA_SQL);
    await runSqlScript(SEED_SQL);
    resetAccessControlSchemaCache();
    await ensureAccessControlSchema();

    const sql = getSql();
    const [count] = await sql<{ count: number }[]>`select count(*)::int as count from core.users`;
    if (Number(count?.count || 0) > 0) {
      return response.status(409).json({ ok: false, error: "تمت تهيئة المنصة من قبل ولا يمكن إنشاء مدير أول جديد" });
    }

    const user = await sql.begin(async (tx) => {
      const [adminRole] = await tx<{ id: string }[]>`select id::text from core.roles where code = 'admin' limit 1`;
      if (!adminRole) throw new Error("ADMIN_ROLE_MISSING");

      const [created] = await tx<{
        id: string;
        employee_no: string | null;
        full_name: string;
        email: string | null;
        mobile: string | null;
      }[]>`
        insert into core.users(
          employee_no, full_name, email, mobile, password_hash,
          must_change_password, password_changed_at, is_active
        ) values (
          ${employeeNo}, ${fullName}, ${email}, ${mobile}, crypt(${password}, gen_salt('bf')),
          false, now(), true
        )
        returning id::text, employee_no, full_name, email, mobile
      `;

      await tx`insert into core.user_roles(user_id, role_id) values (${created.id}::uuid, ${adminRole.id}::uuid)`;
      await tx`
        insert into core.user_systems(user_id, system_code, is_enabled, data_scope)
        select ${created.id}::uuid, code, true, 'all' from core.systems where code in ('operations','tracking','marketing','crm')
        on conflict (user_id, system_code) do update set is_enabled=true, data_scope='all', updated_at=now()
      `;
      await tx`
        insert into audit.activity_log(user_id, system_code, action, entity_type, entity_id, after_data, ip_address)
        values (
          ${created.id}::uuid,
          'core',
          'platform_initialized',
          'user',
          ${created.id},
          ${tx.json({ fullName: created.full_name, email: created.email, mobile: created.mobile })},
          ${requestIp(request)}
        )
      `;

      return created;
    });

    await createSession(request, response, user.id);
    const access = await getEffectivePermissions(user.id);
    return response.status(201).json({
      ok: true,
      user: {
        id: user.id,
        employeeNo: user.employee_no,
        fullName: user.full_name,
        email: user.email,
        mobile: user.mobile,
        roles: ["مدير النظام"],
        roleCodes: ["admin"],
        departments: [],
        departmentCodes: [],
        branches: [],
        branchCodes: [],
        ...access,
      },
    });
  } catch (error: any) {
    console.error("Platform initialization failed", error);
    if (error?.code === "23505") return response.status(409).json({ ok: false, error: "رقم الموظف أو البريد أو الجوال مستخدم بالفعل" });
    return response.status(500).json({ ok: false, error: "تعذر تهيئة قاعدة البيانات وإنشاء مدير النظام" });
  }
}
