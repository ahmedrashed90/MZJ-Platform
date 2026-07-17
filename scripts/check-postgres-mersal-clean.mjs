import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const runtimeRoots = ["api", "server", "src", "gateway-worker/src"];
const runtimeFiles = [];
for (const relativeRoot of runtimeRoots) {
  const absoluteRoot = path.join(root, relativeRoot);
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) runtimeFiles.push(full);
    }
  };
  walk(absoluteRoot);
}

const legacyStorageTokens = [["fire", "base"], ["fire", "store"]].map((parts) => parts.join(""));
for (const file of runtimeFiles) {
  const content = fs.readFileSync(file, "utf8").toLowerCase();
  assert(legacyStorageTokens.every((token) => !content.includes(token)), `Legacy storage reference found in ${path.relative(root, file)}`);
}

const packageJson = JSON.parse(read("package.json"));
assert(packageJson.version === "1.12.0", "Package version must be 1.12.0");

const messaging = read("server/_crm-messaging.ts");
assert(messaging.includes("where is_active=true and source_code=${route}"), "Outbound endpoint must be selected by exact source_code");
assert(messaging.includes("const url = clean(endpoint.send_url)"), "Outbound must use send_url only");
const legacyEndpointColumns = [["text", "send", "url"], ["template", "send", "url"], ["media", "send", "url"]].map((parts) => parts.join("_"));
assert(legacyEndpointColumns.every((column) => !messaging.includes(column)), "Legacy endpoint columns are forbidden");
assert(messaging.includes('if (!configuredName) throw new Error("اسم متغير سر الـGateway غير مضبوط في Endpoint")'), "Endpoint secret name must be explicit");
assert(messaging.includes('type: "text"') && messaging.includes('template_name: ""') && messaging.includes('message: input.text'), "Free-text contract is incomplete");
assert(messaging.includes('type: "template"') && messaging.includes("template_name: templateName"), "Template contract is incomplete");
assert(messaging.includes('type: "media"') && messaging.includes("media_url: createDownloadUrl") && messaging.includes("media_type: input.media.mediaType"), "Media contract is incomplete");

const gateway = read("gateway-worker/src/index.js");
for (const route of ["/send/mersal", "/webhook/mersal", "/templates/mersal"]) {
  assert(gateway.includes(route), `Missing exact Mersal route ${route}`);
}
const routeAliases = [["", "send", "whatsapp"], ["", "webhooks", "whatsapp"]].map((parts) => parts.join("/"));
assert(routeAliases.every((route) => !gateway.includes(route)), "WhatsApp route aliases are forbidden");
for (const variable of [
  "MERSAL_SEND_URL",
  "MERSAL_TEMPLATE_URL",
  "MERSAL_MEDIA_SEND_URL",
  "MERSAL_CONVERSATIONS_URL",
  "MERSAL_MESSAGES_URL",
  "MERSAL_TEMPLATES_URL",
  "MERSAL_MEDIA_BASE_URL",
]) {
  assert(gateway.includes(`env.${variable}`), `Missing exact Worker variable ${variable}`);
}
assert(gateway.includes("const phone = normalizePhone(payload?.phone)"), "Worker must use the canonical phone field");
assert(gateway.includes("const message = clean(payload?.message)"), "Worker must use the canonical text field");
assert(gateway.includes("const templateName = clean(payload?.template_name)"), "Worker must use the canonical template field");
assert(gateway.includes("const mediaUrl = normalizeHttpUrl(payload?.media_url)"), "Worker must use the canonical media URL field");
assert(gateway.includes("provider_message_id:"), "Worker response must expose canonical provider_message_id");

const integration = read("server/integrations/[source].ts");
assert(integration.includes('if (!eventKey) return response.status(400)'), "Inbound event ID must be required");
assert(integration.includes("on conflict (source,event_key) do nothing"), "Inbound events must be idempotent");
assert(integration.includes("status='failed' or (status='processing'"), "Failed or stale inbound events must be reclaimed by exact event ID");

const processor = read("server/_integration-processor.ts");
assert(processor.includes("on conflict do nothing"), "Inbound messages must be idempotent");
assert(processor.includes("insert into crm.media_assets"), "Inbound R2 media metadata must be stored in PostgreSQL");
assert(processor.includes("const channel = source;"), "Inbound processing must not alias Mersal to another channel at runtime");
assert(!processor.includes('source === "mersal"'), "Runtime Mersal channel fallback is forbidden");
assert(processor.includes("lastUnreadMessageKey"), "Inbound unread state must be idempotent");

const settings = read("server/crm/settings.ts");
assert(settings.includes("/send\\/mersal") && settings.includes("/webhook\\/mersal") && settings.includes("/templates\\/mersal"), "CRM settings must validate all exact Mersal paths");
assert(legacyEndpointColumns.every((column) => !settings.includes(column)), "CRM settings must not write legacy endpoint columns");

const envExample = read(".env.example");
const overrideNames = [["MERSAL", "WORKER", "URL"], ["MERSAL", "WORKER", "TEMPLATES", "URL"]].map((parts) => parts.join("_"));
assert(overrideNames.every((name) => !envExample.includes(name)), "Vercel Worker URL overrides are forbidden");

console.log("PostgreSQL-only Mersal transport checks passed.");
