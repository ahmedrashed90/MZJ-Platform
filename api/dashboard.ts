import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDashboardData } from "./_dashboard-data";

export default async function handler(_request: VercelRequest, response: VercelResponse) {
  const data = await getDashboardData();
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json(data);
}
