import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, isCrmManager, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";

type MersalTemplate = Record<string, unknown>;

type MersalResponse = {
  ok?: boolean;
  status?: string;
  templates?: MersalTemplate[];
  error?: string;
  message?: string;
  raw?: string;
};

function parseComponents(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function componentBody(value: unknown) {
  const body = parseComponents(value).find((component) => String(component.type || "").toUpperCase() === "BODY");
  return clean(body?.text);
}

function configuredBases() {
  const configured = clean(process.env.MERSAL_API_ENDPOINT || "https://w-mersal.com").replace(/\/+$/, "");
  return [...new Set([configured, "https://w-mersal.com", "https://api.w-mersal.com"].filter(Boolean))];
}

async function requestTemplates(token: string) {
  let lastError = "فشل جلب القوالب من مرسال";

  for (const base of configuredBases()) {
    const url = `${base}/api/wpbox/getTemplates?token=${encodeURIComponent(token)}`;
    try {
      const upstream = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await upstream.text();
      let payload: MersalResponse;
      try {
        payload = JSON.parse(text) as MersalResponse;
      } catch {
        payload = { raw: text };
      }

      if (!upstream.ok) {
        lastError = clean(payload.message || payload.error) || `HTTP ${upstream.status}`;
        continue;
      }

      return {
        source: base,
        templates: Array.isArray(payload.templates) ? payload.templates : [],
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "فشل الاتصال بمرسال";
    }
  }

  throw new Error(lastError);
}

function normalizedTemplate(template: MersalTemplate) {
  const externalId = clean(template.id || template.name || template.templateName);
  const name = clean(template.name || template.templateName);
  const status = (clean(template.status) || "APPROVED").toUpperCase();
  const content = componentBody(template.components) || clean(template.body || template.content) || name;

  return {
    externalId,
    name,
    displayName: name,
    content,
    languageCode: clean(template.language) || "ar",
    status,
    isActive: status === "APPROVED",
  };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "مزامنة قوالب مرسال متاحة للإدارة فقط" });
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });

  const token = clean(process.env.MERSAL_TOKEN || process.env.MERSAL_API_TOKEN);
  if (!token) return response.status(500).json({ ok: false, error: "MERSAL_TOKEN غير موجود في Environment Variables" });

  try {
    const sql = getSql();
    const upstream = await requestTemplates(token);
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
