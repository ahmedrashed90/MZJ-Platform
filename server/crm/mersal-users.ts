import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "../_auth.js";
import { hasPermission } from "../_access-control.js";
import { ensureCrmSchema } from "../_crm-schema.js";
import { getSql } from "../_db.js";

const MERSAL_BASE_URL = "https://w-mersal.com";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function bodyObject(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { return {}; }
  }
  return {};
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function plainText(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseMersalUsers(html: string) {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const users: Array<{ mersalUserId: string; fullName: string; email: string; roleName: string; status: string }> = [];
  const seen = new Set<string>();

  for (const rowMatch of rows) {
    const rowHtml = rowMatch[0];
    const idMatch = rowHtml.match(/\/users\/(\d+)\/edit/i);
    if (!idMatch) continue;
    const mersalUserId = idMatch[1];
    if (seen.has(mersalUserId)) continue;
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => plainText(match[1]));
    if (cells.length < 3 || !cells[0]) continue;
    users.push({
      mersalUserId,
      fullName: cells[0],
      email: cells[1] || "",
      roleName: cells[2] || "",
      status: cells[3] || "",
    });
    seen.add(mersalUserId);
  }

  return users;
}

function setCookieValues(headers: Headers) {
  const pairs = new Map<string, string>();
  const headerList = typeof (headers as any).getSetCookie === "function"
    ? ((headers as any).getSetCookie() as string[])
    : [];

  for (const item of headerList) {
    const pair = item.split(";", 1)[0]?.trim();
    const separator = pair?.indexOf("=") ?? -1;
    if (pair && separator > 0) pairs.set(pair.slice(0, separator), pair.slice(separator + 1));
  }

  if (!pairs.size) {
    const raw = headers.get("set-cookie") || "";
    for (const name of ["XSRF-TOKEN", "mersal_api_session", "laravel_session"]) {
      const match = raw.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`, "i"));
      if (match?.[1]) pairs.set(name, match[1]);
    }
  }

  return [...pairs.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function mersalSessionFromToken(token: string) {
  const response = await fetch(`${MERSAL_BASE_URL}/api/wpbox/getTemplates?token=${encodeURIComponent(token)}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "user-agent": "MZJ-Platform/1.0",
    },
    redirect: "manual",
  });

  const text = await response.text();
  let payload: any = null;
  try { payload = JSON.parse(text); } catch { payload = null; }
  if (!response.ok || payload?.status === "error") {
    throw Object.assign(new Error(clean(payload?.message) || `فشل التحقق من Mersal Token (${response.status})`), { status: 502 });
  }

  const cookie = setCookieValues(response.headers);
  if (!cookie || !/(?:mersal_api_session|laravel_session)=/i.test(cookie)) {
    throw Object.assign(new Error("تم قبول Mersal Token لكن لم يتم إنشاء جلسة مستخدمين من مرسال"), { status: 502 });
  }
  return cookie;
}

async function fetchMersalUsers(token: string) {
  const cookie = await mersalSessionFromToken(token);
  const response = await fetch(`${MERSAL_BASE_URL}/users`, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ar,en;q=0.8",
      cookie,
      "user-agent": "MZJ-Platform/1.0",
    },
    redirect: "manual",
  });
  const html = await response.text();
  if (response.status >= 300 && response.status < 400) {
    throw Object.assign(new Error("تعذر فتح مستخدمي مرسال باستخدام التوكن المحفوظ"), { status: 502 });
  }
  if (!response.ok || !html.includes("/users/") || !/<table\b/i.test(html)) {
    throw Object.assign(new Error(`تعذر قراءة مستخدمي مرسال (${response.status})`), { status: 502 });
  }
  const users = parseMersalUsers(html);
  if (!users.length) throw Object.assign(new Error("تم الاتصال بمرسال لكن لم يتم العثور على مستخدمين"), { status: 502 });
  return users;
}

async function loadStoredToken(sourceCode: string) {
  const sql = getSql();
  const candidates = sourceCode === "mersal" ? ["mersal", "whatsapp"] : ["whatsapp", "mersal"];
  const rows = await sql<{ source_code: string; mersal_token: string | null }[]>`
    select source_code,mersal_token
    from crm.integration_endpoints
    where source_code = any(${candidates})
      and nullif(trim(coalesce(mersal_token,'')),'') is not null
  `;
  const byCode = new Map(rows.map((row) => [row.source_code, clean(row.mersal_token)]));
  return candidates.map((code) => byCode.get(code)).find(Boolean) || "";
}

async function saveToken(sourceCode: string, token: string, userId: string) {
  const sql = getSql();
  await sql`
    insert into crm.integration_endpoints(source_code,display_name,mersal_token,is_active,updated_by,updated_at)
    values(${sourceCode},'واتساب',${token},true,${userId}::uuid,now())
    on conflict(source_code) do update set mersal_token=excluded.mersal_token,updated_by=excluded.updated_by,updated_at=now()
  `;
}

async function cacheUsers(users: Awaited<ReturnType<typeof fetchMersalUsers>>) {
  const sql = getSql();
  await sql.begin(async (tx) => {
    await tx`update core.mersal_users set is_active=false`;
    for (const item of users) {
      await tx`
        insert into core.mersal_users(mersal_user_id,full_name,email,role_name,status,is_active,synced_at)
        values(${item.mersalUserId},${item.fullName},${item.email || null},${item.roleName || null},${item.status || null},true,now())
        on conflict(mersal_user_id) do update set
          full_name=excluded.full_name,email=excluded.email,role_name=excluded.role_name,status=excluded.status,is_active=true,synced_at=now()
      `;
    }
  });
}

async function cachedUsers() {
  const sql = getSql();
  return sql<any[]>`
    select mersal_user_id,full_name,email,role_name,status,is_active,synced_at
    from core.mersal_users
    order by is_active desc,full_name,mersal_user_id
  `;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  const user = await requireUser(request, response);
  if (!user) return;
  await ensureCrmSchema();

  const canRead = ["settings.users.view", "settings.users.update", "settings.crm.view", "settings.crm.manage"]
    .some((permission) => hasPermission(user, permission));
  const canSync = hasPermission(user, "settings.crm.manage");

  if (request.method === "GET") {
    if (!canRead) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لعرض مستخدمي مرسال" });
    return response.status(200).json({ ok: true, users: await cachedUsers() });
  }

  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  if (!canSync) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لتحديث مستخدمي مرسال" });

  const body = bodyObject(request);
  const sourceCode = ["whatsapp", "mersal"].includes(clean(body.sourceCode)) ? clean(body.sourceCode) : "whatsapp";
  const providedToken = clean(body.token);
  const token = providedToken || await loadStoredToken(sourceCode);
  if (!token) return response.status(400).json({ ok: false, error: "أدخل Mersal Token أولاً" });

  try {
    const users = await fetchMersalUsers(token);
    await cacheUsers(users);
    if (providedToken) await saveToken(sourceCode, providedToken, user.id);
    const synced = await cachedUsers();
    return response.status(200).json({
      ok: true,
      users: synced,
      count: users.length,
      message: `تم ربط مرسال وتحديث ${users.length} مستخدم`,
    });
  } catch (error: any) {
    console.error("Mersal users sync failed", error);
    return response.status(Number(error?.status) || 502).json({ ok: false, error: clean(error?.message) || "تعذر تحديث مستخدمي مرسال" });
  }
}
