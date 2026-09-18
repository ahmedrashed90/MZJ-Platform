import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAttendanceTick } from "../_attendance.js";
import { safeSecretEquals } from "../_auth.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!["GET", "POST"].includes(request.method || "")) {
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const expected = String(process.env.CRON_SECRET || "").trim();
  if (expected) {
    const authorization = String(request.headers.authorization || "");
    const actual = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!actual || !safeSecretEquals(actual, expected)) {
      return response.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  try {
    return response.status(200).json(await runAttendanceTick());
  } catch (error) {
    console.error("Attendance cron failed", error);
    return response.status(500).json({ ok: false, error: "Attendance tick failed" });
  }
}
