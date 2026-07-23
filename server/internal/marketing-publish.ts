import type { VercelRequest, VercelResponse } from "@vercel/node";
import { safeSecretEquals } from "../_auth.js";
import { getSql } from "../_db.js";
import { executePublishTarget } from "../marketing/platforms/registry.js";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function positiveLimit(value: unknown, fallback = 10) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(50, Math.max(1, Math.floor(parsed)));
}

/**
 * Secure central publisher runner.
 *
 * This is deliberately server-side and independent from the removed Local Publisher.
 * It only processes targets whose saved schedule is due and whose status is still
 * ready/scheduled/failed. Platform tokens never leave the server.
 */
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });

  const expected = clean(process.env.MARKETING_PUBLISHER_SECRET);
  const provided = clean(request.headers["x-mzj-marketing-publish-secret"]);
  if (!expected || !provided || !safeSecretEquals(provided, expected)) {
    return response.status(401).json({ ok: false, error: "Unauthorized marketing publisher" });
  }

  const sql = getSql();
  const [publishingSetting] = await sql<{ enabled: boolean }[]>`
    select coalesce((value->>'enabled')::boolean,false) enabled
    from marketing.settings
    where key='publishing'
  `;
  if (!publishingSetting?.enabled) {
    return response.status(200).json({ ok: true, enabled: false, processed: 0, results: [] });
  }

  const limit = positiveLimit(request.query.limit, 10);
  const dueTargets = await sql<{ id: string }[]>`
    select pt.id::text
    from marketing.publish_targets pt
    join marketing.publish_prep_items pi on pi.id=pt.publish_prep_item_id
    join marketing.campaigns c on c.id=pi.campaign_id
    where c.is_deleted=false
      and c.status<>'archived'
      and pt.scheduled_at is not null
      and pt.scheduled_at<=now()
      and pt.status in ('ready','scheduled','failed')
    order by pt.scheduled_at,pt.created_at
    limit ${limit}
  `;

  const results: Array<{ targetId: string; ok: boolean; status?: string; message?: string }> = [];
  for (const target of dueTargets) {
    try {
      const result = await executePublishTarget({ source: "scheduler" }, target.id);
      results.push({
        targetId: target.id,
        ok: Boolean(result.ok || result.alreadyPublished),
        status: result.result?.status || (result.alreadyPublished ? "published" : undefined),
        message: result.message,
      });
    } catch (error) {
      results.push({ targetId: target.id, ok: false, message: error instanceof Error ? error.message : "تعذر تنفيذ النشر" });
    }
  }

  return response.status(200).json({ ok: true, enabled: true, processed: results.length, results });
}
