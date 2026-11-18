import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getWebsiteStock } from "./_website-stock.js";
import { createWebsiteVehicleImageTicket, getWebsiteVehicleImages } from "./_website-images.js";

function body(request: VercelRequest) {
  return request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");

  try {
    if (request.method === "GET") {
      const refresh = String(request.query.refresh || "") === "1";
      if (String(request.query.scope || "") === "image-manager") {
        const result = await getWebsiteVehicleImages({ refresh });
        return response.status(200).json({ ok: true, ...result });
      }
      const stock = await getWebsiteStock({ refresh });
      return response.status(200).json({ ok: true, ...stock });
    }

    if (request.method === "POST") {
      const payload = body(request);
      const action = String(payload.action || "").trim();
      if (action === "image_manager_ticket") {
        const postId = Number(payload.postId || 0);
        return response.status(200).json({ ok: true, ...createWebsiteVehicleImageTicket(postId) });
      }
      return response.status(400).json({ ok: false, error: "إجراء الموقع الإلكتروني غير معروف" });
    }

    return response.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    const imageManager = String(request.query.scope || "") === "image-manager" || String(body(request).action || "") === "image_manager_ticket";
    return response.status(502).json({
      ok: false,
      error: imageManager ? "تعذر الاتصال بمدير صور السيارات في WordPress" : "تعذر تحميل استوك الموقع الإلكتروني",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
