import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, isCrmManager, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";

type MersalTemplate = Record<string, unknown>;

type MersalWorkerResponse = {
  ok?: boolean;
  source?: string;
  templates?: MersalTemplate[];
  error?: string;
  message?: string;
  raw?: unknown;
};

type WorkerConfig = {
  url: string;
  secretName: string;
};

function parseComponents(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      : [];
  } catch {
    return [];
  }
}

function componentBody(value: unknown) {
  const body = parseComponents(value).find((component) => String(component.type || "").toUpperCase() === "BODY");
  return clean(body?.text);
}

function workerHeaders(secretName: string) {
  const secret = clean(process.env[secretName]);
  if (!secret) throw new Error(`${secretName} غير موجود في Environment Variables`);
  return {
    accept: "application/json",
    "content-type": "application/json; charset=utf-8",
    "x-mzj-gateway-secret": secret,
  };
}

async function resolveWorkerConfig(sql: ReturnType<typeof getSql>): Promise<WorkerConfig> {
  const [endpoint] = await sql<any[]>`
    select templates_sync_url,secret_name
    from crm.integration_endpoints
    where source_code='whatsapp' and is_active=true
    limit 1
  `;
  const url = clean(endpoint?.templates_sync_url);
  if (!url) throw new Error("أضف مسار مزامنة قوالب مرسال في إعدادات CRM");
  const secretName = clean(endpoint?.secret_name);
  if (!secretName) throw new Error("أضف اسم متغير سر الـGateway في إعدادات CRM");
  return { url, secretName };
}

function extractTemplates(payload: MersalWorkerResponse) {
  if (Array.isArray(payload.templates)) return payload.templates;
  if (payload.raw && typeof payload.raw === "object") {
    const raw = payload.raw as Record<string, unknown>;
    if (Array.isArray(raw.templates)) return raw.templates as MersalTemplate[];
    if (Array.isArray(raw.data)) return raw.data as MersalTemplate[];
  }
  return [];
}

async function requestTemplates(config: WorkerConfig) {
  const upstream = await fetch(config.url, {
    method: "POST",
    headers: workerHeaders(config.secretName),
    body: JSON.stringify({ action: "sync_templates", source: "mzj-unified-platform" }),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await upstream.text();
  let payload: MersalWorkerResponse;
  try {
    payload = text ? JSON.parse(text) as MersalWorkerResponse : {};
  } catch {
    payload = { raw: text };
  }

  if (!upstream.ok || payload.ok === false) {
    throw new Error(clean(payload.error || payload.message) || `فشل وركر واتساب: HTTP ${upstream.status}`);
  }

  return {
    source: clean(payload.source) || config.url,
    templates: extractTemplates(payload),
  };
}

function normalizedTemplate(template: MersalTemplate) {
  const externalId = clean(template.id || template.name || template.templateName || template.template_name);
  const name = clean(template.name || template.templateName || template.template_name);
  const status = (clean(template.status) || "APPROVED").toUpperCase();
  const content = componentBody(template.components)
    || clean(template.body || template.content || template.text)
    || name;

  return {
    externalId,
    name,
    displayName: clean(template.displayName || template.display_name) || name,
    content,
    languageCode: clean(template.language || template.language_code || template.template_language) || "ar",
    status,
    isActive: status === "APPROVED",
  };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!isCrmManager(user)) {
    return response.status(403).json({ ok: false, error: "مزامنة قوالب مرسال متاحة للإدارة فقط" });
  }
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const sql = getSql();
    const workerConfig = await resolveWorkerConfig(sql);
    const upstream = await requestTemplates(workerConfig);
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const rawTemplate of upstream.templates) {
      const template = normalizedTemplate(rawTemplate);
      if (!template.externalId || !template.name) {
        skipped += 1;
        continue;
      }

      const [existing] = await sql<{ id: string }[]>`
        select id::text
        from crm.message_templates
        where provider='mersal' and external_id=${template.externalId}
        limit 1
      `;

      if (existing) {
        await sql`
          update crm.message_templates
          set name=${template.name},
              display_name=${template.displayName},
              content=${template.content},
              template_type='template',
              provider='mersal',
              language_code=${template.languageCode},
              status=${template.status},
              is_active=${template.isActive},
              updated_at=now()
          where id=${existing.id}::uuid
        `;
        updated += 1;
      } else {
        await sql`
          insert into crm.message_templates(
            external_id,name,display_name,content,template_type,provider,language_code,departments,status,is_active,created_by
          ) values (
            ${template.externalId},${template.name},${template.displayName},${template.content},'template','mersal',${template.languageCode},'{}'::text[],${template.status},${template.isActive},${user.id}::uuid
          )
        `;
        created += 1;
      }
    }

    await audit(user, "mersal_templates_synced", "message_template", "mersal", {
      source: upstream.source,
      received: upstream.templates.length,
      created,
      updated,
      skipped,
    });

    return response.status(200).json({
      ok: true,
      source: upstream.source,
      received: upstream.templates.length,
      created,
      updated,
      skipped,
      message: `تمت مزامنة قوالب مرسال: ${upstream.templates.length} قالب - جديد ${created} - محدث ${updated}`,
    });
  } catch (error) {
    console.error("Mersal template synchronization failed", error);
    return response.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : "فشل مزامنة قوالب مرسال",
    });
  }
}
