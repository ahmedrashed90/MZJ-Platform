import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const worker = read("mersal-crm-worker/src/index.js");
const transport = read("server/_crm-messaging.ts");
const inbound = read("server/_integration-processor.ts");
const settings = read("server/crm/settings.ts");
const genericGateway = read("gateway-worker/src/index.js");

for (const forbidden of ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "firestoreClient(", "wa_conversations/"]) {
  assert(!worker.includes(forbidden), `Mersal worker must not contain ${forbidden}`);
}

for (const route of ["/send/mersal", "/webhook/mersal", "/templates/mersal"]) {
  assert(worker.includes(route), `Mersal worker route is missing: ${route}`);
}

assert(worker.includes("MZJ_PLATFORM_INBOUND_URL"), "Mersal worker must forward inbound messages to the platform");
assert(worker.includes('"x-mzj-gateway-secret"'), "Mersal worker must authenticate platform requests");
assert(worker.includes("providerMessageId") && worker.includes("ACCEPTED_PROVIDER_STATUSES"), "Mersal success must use provider evidence");
assert(transport.includes("workerAccepted"), "Platform must normalize the canonical worker response");
assert(transport.includes("const configured = clean(endpoint.text_send_url)"), "WhatsApp must use the single configured text_send_url");
assert(!transport.includes('["whatsapp", "mersal"]'), "WhatsApp endpoint alias fallback must be removed");
assert(!inbound.includes("channel_code in ('whatsapp','mersal')"), "Inbound conversation lookup must use exact whatsapp channel");
assert(settings.includes('sourceCode === "whatsapp"'), "Endpoint settings must use exact whatsapp source code");
assert(!genericGateway.includes('/send/whatsapp') && !genericGateway.includes('/webhooks/whatsapp'), "Generic gateway must not own Mersal routes");

console.log("Mersal PostgreSQL clean transport checks passed.");
