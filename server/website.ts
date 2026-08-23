import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getWebsiteStock } from "./_website-stock.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const stock = await getWebsiteStock({ refresh: String(request.query.refresh || "") === "1" });
    return response.status(200).json({ ok: true, ...stock });
  } catch (error) {
    return response.status(502).json({
      ok: false,
      error: "تعذر تحميل استوك الموقع الإلكتروني",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
