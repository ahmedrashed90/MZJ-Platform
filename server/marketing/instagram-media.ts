import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { loadInstagramImage, verifyInstagramImageDeliveryQuery } from "../_instagram-media-delivery.js";

function clean(value: unknown) { return String(value ?? "").trim(); }

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const verified = verifyInstagramImageDeliveryQuery(request.query as Record<string, unknown>);
    if (!verified.ok) return response.status(403).json({ ok: false, error: verified.error });

    const image = await loadInstagramImage(getSql(), verified.fileId);
    const maxAge = Math.max(0, verified.expiresAt - Math.floor(Date.now() / 1000));
    response.setHeader("Content-Type", image.contentType);
    response.setHeader("Content-Length", String(image.bytes.length));
    response.setHeader("Cache-Control", `public, max-age=${Math.min(7200, maxAge)}, immutable`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(image.fileName)}`);
    if (request.method === "HEAD") return response.status(200).end();
    return response.status(200).send(image.bytes);
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || 0) || 500;
    const message = clean(error?.message) || "تعذر تجهيز صورة Instagram";
    if (statusCode >= 500) console.error("Instagram public image delivery failed", error);
    return response.status(statusCode).json({ ok: false, error: message });
  }
}
