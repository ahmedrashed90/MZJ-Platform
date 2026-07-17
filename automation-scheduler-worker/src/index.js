// MZJ Automation Scheduler Worker v1.0.0
// Cloudflare Worker (Module) + Queue Producer/Consumer
// Purpose: schedule wake-up events only. CRM decisions stay inside MZJ Platform.
// Routes:
//   GET  /health
//   GET  /env-check
//   POST /schedule
// Required bindings/env:
//   Queue binding: AUTOMATION_QUEUE
//   Variable: PLATFORM_AUTOMATION_CALLBACK_URL
//   Secret: AUTOMATION_SCHEDULER_SECRET

const VERSION = "mzj-automation-scheduler-v1.0.0";
const MAX_QUEUE_DELAY_SECONDS = 86400;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response("", { status: 204, headers: corsHeaders() });
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json({ ok: true, service: "mzj-automation-scheduler", version: VERSION });
    }
    if (request.method === "GET" && url.pathname === "/env-check") {
      return json({
        ok: true,
        queueBinding: Boolean(env?.AUTOMATION_QUEUE && typeof env.AUTOMATION_QUEUE.send === "function"),
        callbackUrl: Boolean(clean(env?.PLATFORM_AUTOMATION_CALLBACK_URL)),
        schedulerSecret: Boolean(clean(env?.AUTOMATION_SCHEDULER_SECRET)),
      });
    }
    if (request.method === "POST" && url.pathname === "/schedule") {
      if (!authorized(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
      if (!env?.AUTOMATION_QUEUE || typeof env.AUTOMATION_QUEUE.send !== "function") return json({ ok: false, error: "Missing AUTOMATION_QUEUE binding" }, 500);
      const body = await safeJson(request);
      const jobId = clean(body?.jobId || body?.job_id);
      const dueAt = normalizeDueAt(body?.dueAt || body?.due_at);
      if (!isUuid(jobId)) return json({ ok: false, error: "Invalid jobId" }, 400);
      if (!dueAt) return json({ ok: false, error: "Invalid dueAt" }, 400);
      const eventId = clean(body?.eventId) || `automation-job:${jobId}:${dueAt}`;
      const delaySeconds = calculateDelaySeconds(dueAt);
      await env.AUTOMATION_QUEUE.send({ jobId, dueAt, eventId, scheduledAt: new Date().toISOString() }, { delaySeconds: Math.min(MAX_QUEUE_DELAY_SECONDS, delaySeconds) });
      return json({ ok: true, eventId, messageId: eventId, jobId, dueAt, delaySeconds: Math.min(MAX_QUEUE_DELAY_SECONDS, delaySeconds), chunked: delaySeconds > MAX_QUEUE_DELAY_SECONDS });
    }
    return json({ ok: false, error: "Not Found" }, 404);
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      const job = message.body || {};
      try {
        const jobId = clean(job?.jobId || job?.job_id);
        const dueAt = normalizeDueAt(job?.dueAt || job?.due_at);
        if (!isUuid(jobId) || !dueAt) {
          console.error("Invalid automation queue message", { jobId, dueAt });
          message.ack();
          continue;
        }
        const remainingSeconds = calculateDelaySeconds(dueAt);
        if (remainingSeconds > 1) {
          await env.AUTOMATION_QUEUE.send({ ...job, jobId, dueAt, rechunkedAt: new Date().toISOString() }, { delaySeconds: Math.min(MAX_QUEUE_DELAY_SECONDS, remainingSeconds) });
          message.ack();
          continue;
        }
        const callbackUrl = clean(env?.PLATFORM_AUTOMATION_CALLBACK_URL);
        const secret = clean(env?.AUTOMATION_SCHEDULER_SECRET);
        if (!callbackUrl || !secret) throw new Error("Missing PLATFORM_AUTOMATION_CALLBACK_URL/AUTOMATION_SCHEDULER_SECRET");
        const response = await fetch(callbackUrl, {
          method: "POST",
          headers: { "content-type": "application/json", "x-mzj-automation-secret": secret },
          body: JSON.stringify({ jobId, dueAt, eventId: clean(job?.eventId) }),
        });
        const raw = await response.text();
        if (!response.ok) throw new Error(`Platform callback failed ${response.status}: ${raw.slice(0, 500)}`);
        message.ack();
      } catch (error) {
        console.error("Automation queue delivery failed", error);
        const attempts = Number(message.attempts || 1);
        const retryDelay = Math.min(3600, Math.max(60, 60 * Math.pow(2, Math.min(attempts - 1, 5))));
        message.retry({ delaySeconds: retryDelay });
      }
    }
  },
};

function authorized(request, env) {
  const expected = clean(env?.AUTOMATION_SCHEDULER_SECRET);
  const provided = clean(request.headers.get("x-mzj-automation-secret"));
  return Boolean(expected && provided && timingSafeEqual(provided, expected));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}
function normalizeDueAt(value) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
function calculateDelaySeconds(dueAt) {
  return Math.max(0, Math.ceil((new Date(dueAt).getTime() - Date.now()) / 1000));
}
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")); }
function clean(value) { return String(value ?? "").trim(); }
async function safeJson(request) { try { return await request.json(); } catch { return {}; } }
function corsHeaders() { return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,x-mzj-automation-secret" }; }
function json(value, status = 200) { return new Response(JSON.stringify(value, null, 2), { status, headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8" } }); }
