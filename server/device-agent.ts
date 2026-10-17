import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDeviceChallengeStatus, verifyDeviceChallengeProof } from "./_device-agent.js";

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function bodyObject(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { return {}; }
  }
  return {};
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method === "GET") {
      const view = clean(request.query.view);
      if (view !== "challenge") return response.status(404).json({ ok: false, error: "العرض المطلوب غير موجود" });
      const challengeId = clean(request.query.challengeId, 80);
      const pollToken = clean(request.query.pollToken, 200);
      const state = await getDeviceChallengeStatus(challengeId, pollToken);
      return response.status(200).json({ ok: true, ...state });
    }

    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
    const result = await verifyDeviceChallengeProof(request, bodyObject(request));
    return response.status(200).json({ ok: true, ...result });
  } catch (error: any) {
    console.error("Device Agent API failed", error);
    const code = clean(error?.message, 100) || "DEVICE_AGENT_ERROR";
    const messages: Record<string, string> = {
      INVALID_DEVICE_PROOF: "بيانات الجهاز غير صحيحة",
      UNSUPPORTED_DEVICE_PLATFORM: "هذا النوع من الأجهزة غير مدعوم للتحقق",
      INVALID_DEVICE_FINGERPRINT: "بصمة الجهاز غير صحيحة",
      INVALID_DEVICE_SIGNATURE: "توقيع الجهاز غير موجود",
      DEVICE_CHALLENGE_EXPIRED: "انتهت مهلة التحقق من الجهاز. أعد تسجيل الدخول",
      DEVICE_PUBLIC_KEY_REQUIRED: "مفتاح الجهاز غير موجود",
      DEVICE_KEY_MISMATCH: "هوية الجهاز لا تطابق الجهاز المسجل",
      INVALID_DEVICE_PUBLIC_KEY: "مفتاح الجهاز غير صالح",
      DEVICE_ID_KEY_MISMATCH: "هوية الجهاز لا تطابق مفتاح الجهاز",
      DEVICE_SIGNATURE_REJECTED: "فشل التحقق من توقيع الجهاز",
    };
    return response.status(400).json({ ok: false, code, error: messages[code] || "تعذر التحقق من جهاز العمل" });
  }
}
