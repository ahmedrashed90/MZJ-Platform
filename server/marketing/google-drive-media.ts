import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getSql } from "../_db.js";
import { ensureMarketingSchema } from "../_marketing-schema.js";
import { openGoogleDriveMediaByFileId, verifyGoogleDriveMediaQuery } from "../_google-drive-media-delivery.js";

function clean(value: unknown) { return String(value ?? "").trim(); }

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("cache-control", "private, no-store");
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const verified = verifyGoogleDriveMediaQuery(request.query as Record<string, unknown>);
  if (!verified.ok) return response.status(403).json({ ok: false, error: verified.error });
  try {
    await ensureMarketingSchema();
    const { file, upstream } = await openGoogleDriveMediaByFileId(getSql(), verified.fileId);
    if (!upstream.ok || !upstream.body) {
      const detail = clean(await upstream.text().catch(() => ""));
      return response.status(502).json({ ok: false, error: detail || `Google Drive media download failed (${upstream.status})` });
    }
    response.status(200);
    response.setHeader("Content-Type", clean(file.mime_type) || clean(upstream.headers.get("content-type")) || "application/octet-stream");
    const length = clean(upstream.headers.get("content-length"));
    if (length) response.setHeader("Content-Length", length);
    await pipeline(Readable.fromWeb(upstream.body as any), response);
    return response;
  } catch (failure: any) {
    return response.status(Number(failure?.statusCode) || 500).json({ ok: false, error: failure instanceof Error ? failure.message : "Media delivery failed" });
  }
}
