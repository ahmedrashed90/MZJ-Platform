import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const worker = read("workers/MZJ-WhatsApp-Mersal-Gateway-v2.0.0-FULL.txt");
const schema = read("server/_crm-schema.ts");
const automation = read("server/_crm-automation.ts");
const processor = read("server/_integration-processor.ts");
const messaging = read("server/_crm-messaging.ts");
const drawer = read("src/crm/components/LeadDrawer.tsx");
const conversations = read("server/crm/conversations.ts");
const api = read("api/index.ts");
const app = read("src/App.tsx");
const schedulerWorker = read("workers/MZJ-Automation-Scheduler-Worker-v1.0.0-FULL.txt");
const vercel = read("vercel.json");

for (const token of [
  "/webhooks/mersal/v1/messages",
  "/outbound/whatsapp/v1/text",
  "/outbound/whatsapp/v1/template",
  "/outbound/whatsapp/v1/media",
  "/templates/mersal/v1/sync",
  "MZJ_PLATFORM_URL",
  "MZJ_GATEWAY_SECRET",
  "persistInboundMedia",
]) {
  if (!worker.includes(token)) throw new Error(`Worker v2.0 check failed: missing ${token}`);
}
for (const forbidden of ["FIREBASE_PROJECT_ID", "buildAssignment(", "upsertWhatsappLead(", "handleInboxAgentQueueMessage("]) {
  if (worker.includes(forbidden)) throw new Error(`Worker v2.0 must stay transport-only: found ${forbidden}`);
}
for (const token of ["crm.contacts", "crm.contact_identities", "crm.service_requests", "crm.automation_rules", "crm.automation_jobs", "crm.ownership_events", "crm.media_assets", "crm-automation-core-v1.9.1-queue"]) {
  if (!schema.includes(token)) throw new Error(`Automation schema v1.9 check failed: missing ${token}`);
}
for (const token of ["sendServiceSelection", "classifyConversationService", "scheduleInboxAgent", "processAutomationJobById", "scheduleAutomationWakeup", "human_reply_detected", "branch_manager_escalation", "sales_manager_escalation"]) {
  if (!automation.includes(token)) throw new Error(`Automation engine v1.9 check failed: missing ${token}`);
}
for (const token of ["ensureContactIdentity", "findOpenServiceRequest", "publishAutomationEvent", "storageKey", "createLead:createdByKnownSource"]) {
  if (!processor.includes(token)) throw new Error(`Integration processor v1.9 check failed: missing ${token}`);
}
for (const token of ["text_send_url", "template_send_url", "media_send_url", "senderType === \"human\"", "buttons: input.buttons"]) {
  if (!messaging.includes(token)) throw new Error(`Messaging v1.9 check failed: missing ${token}`);
}
for (const token of ["uploadPendingFile", "media_asset_id", "renderTemplateInComposer", "crm-chat-media-image"]) {
  if (!drawer.includes(token)) throw new Error(`CRM drawer v1.9 check failed: missing ${token}`);
}
if (!conversations.includes("استكمل متغيرات القالب")) throw new Error("Template variables must be validated before send");
for (const token of ["crm/automations", "crm/inbox", "crm/ownership", "crm/media", "integrations/media", "internal/automation-job"]) {
  if (!api.includes(token)) throw new Error(`API router v1.9 check failed: missing ${token}`);
}
for (const token of ["CrmInboxPage", "CrmAutomationsPage", "CrmOwnershipPage"]) {
  if (!app.includes(token)) throw new Error(`CRM app v1.9 check failed: missing ${token}`);
}
for (const token of ["AUTOMATION_QUEUE", "/schedule", "PLATFORM_AUTOMATION_CALLBACK_URL", "x-mzj-automation-secret", "delaySeconds"]) {
  if (!schedulerWorker.includes(token)) throw new Error(`Automation Scheduler Worker check failed: missing ${token}`);
}
if (vercel.includes('"crons"') || vercel.includes('* * * * *')) throw new Error("Vercel Cron must not be used on Hobby");
console.log("CRM automation core v1.9.1, Queue scheduler, and Mersal transport-only Worker checks passed.");
