import fs from "node:fs";

const worker = fs.readFileSync(new URL("../workers/MZJ-WhatsApp-Mersal-Worker-v1.0.0-FULL.txt", import.meta.url), "utf8");
const serverSync = fs.readFileSync(new URL("../server/crm/mersal-templates.ts", import.meta.url), "utf8");
const messaging = fs.readFileSync(new URL("../server/_crm-messaging.ts", import.meta.url), "utf8");

for (const token of [
  '"/templates/mersal"',
  '"/send/mersal"',
  "MZJ_GATEWAY_SECRET",
  "MERSAL_TOKEN",
  "sendtemplatemessage",
  "sendmessage",
  "resolveTemplateComponents",
  "normalizeSaudiPhone",
]) {
  if (!worker.includes(token)) throw new Error(`Mersal Worker v1.8.1 check failed: missing ${token}`);
}

for (const token of [
  "templateUrlFromSendUrl",
  "crm.integration_endpoints",
  "x-mzj-gateway-secret",
  "requestTemplates(workerConfig)",
]) {
  if (!serverSync.includes(token)) throw new Error(`Mersal platform sync v1.8.1 check failed: missing ${token}`);
}

for (const token of ["endpoint.send_url", "gatewayHeaders(endpoint.secret_name)", "template_name", "params:"]) {
  if (!messaging.includes(token)) throw new Error(`Mersal send routing v1.8.1 check failed: missing ${token}`);
}

if (serverSync.includes("process.env.MERSAL_TOKEN") || serverSync.includes("/api/wpbox/getTemplates?token=")) {
  throw new Error("Mersal platform sync v1.8.1 check failed: Vercel must not call Mersal directly or store its token");
}

console.log("WhatsApp/Mersal Worker sync and send checks passed.");
