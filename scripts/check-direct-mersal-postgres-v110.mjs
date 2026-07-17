import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const direct = read("src/crm/mersalDirect.ts");
const drawer = read("src/crm/components/LeadDrawer.tsx");
const sourceCatalog = read("src/crm/sourceCatalog.ts");
const integration = read("server/_integration-processor.ts");
const unread = read("server/_crm-unread-state.ts");
const conversations = read("server/crm/conversations.ts");
const worker = read("workers/mersal-crm-postgres.js");
const styles = read("src/styles.css");
const packageJson = JSON.parse(read("package.json"));

assert(direct.includes('https://mersal-crm.next-erp-mzj.workers.dev/send/mersal'), "Mersal direct URL is not the approved mersal-crm route");
assert(direct.includes('template_name: templateName'), "Template payload must send the Mersal template name");
assert(direct.includes('message,') && direct.includes('text: message'), "Free-text payload is incomplete");
assert(!direct.includes("AbortController") && !direct.includes("Promise.race") && !direct.includes("20000"), "Direct Mersal send must not contain a client timeout");

assert(drawer.includes("sendMersalDirect(payload)"), "WhatsApp send does not use the direct Mersal transport");
assert(drawer.includes('action: "record_outgoing"'), "Successful outbound messages are not persisted independently");
assert(drawer.includes('provider_status: "sending"'), "Optimistic outgoing message is missing");
assert(!drawer.includes("crm-linked-template-note") && !drawer.includes("القالب المرتبط بالحالة"), "Linked-template block still exists");
assert(!styles.includes("crm-linked-template-note"), "Linked-template block styles still exist");
assert(sourceCatalog.includes('allowFreeText: true') && sourceCatalog.includes('reason: "الإرسال عبر واتساب بنص حر أو قالب"'), "WhatsApp free-text policy is not enabled");

assert(conversations.includes('action === "record_outgoing"'), "record_outgoing action is missing");
assert(integration.includes("markCrmLeadUnread"), "Incoming WhatsApp unread update is missing");
assert(integration.includes("phone_normalized=${identity.phoneNormalized}"), "Incoming WhatsApp lead matching by normalized phone is missing");
assert(unread.includes("lastProviderMessageId") && !unread.includes("Firestore"), "Unread state still contains legacy metadata");

assert(worker.includes('url.pathname === "/send/mersal"'), "Worker send route is missing");
assert(worker.includes('url.pathname === "/webhook/mersal"'), "Worker webhook route is missing");
assert(worker.includes("MZJ_PLATFORM_INBOUND_URL"), "Worker inbound platform URL is missing");
assert(worker.includes('"x-mzj-gateway-secret": secret'), "Worker inbound gateway authentication is missing");
assert(worker.includes('"access-control-allow-headers": "content-type"'), "Direct browser send CORS is not configured");
assert(!/firebase|firestore|wa_conversations/i.test(worker), "Worker still contains the removed database path");
assert(!/outbound\/whatsapp|send\/whatsapp|mersal-new-platform/i.test(worker), "Worker still contains obsolete send routes");

assert(packageJson.version === "1.10.0", "Package version is not 1.10.0");
assert(!packageJson.dependencies?.firebase, "Firebase dependency still exists");
assert(!fs.existsSync(path.join(root, "RELEASE-CHECKLIST-v1.5.1.md")), "RELEASE-CHECKLIST-v1.5.1.md must not be included");

console.log("Direct Mersal/PostgreSQL v1.10.0 checks passed.");
