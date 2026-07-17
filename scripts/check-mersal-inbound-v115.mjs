import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const integration = read("server/integrations/[source].ts");
const automation = read("server/_crm-automation.ts");
const worker = fs.readFileSync(new URL("../workers/MZJ-Mersal-CRM-Worker-v36-Platform-Automation-Full.txt", import.meta.url), "utf8");

for (const token of [
  "return response.status(200).json",
  "automation: result.automation || null",
  "detail: error?.message || String(error)",
]) if (!integration.includes(token)) throw new Error(`Inbound integration check failed: missing ${token}`);

for (const token of [
  "configuredMessageText",
  "service_selection_sent_at is null",
  "selection_already_claimed_or_customer_classified",
  "service-selection:${event.conversation_id}:${claim.service_selection_version}",
  "/^\\d+$/.test(alias) ? normalized === alias",
]) if (!automation.includes(token)) throw new Error(`Automation check failed: missing ${token}`);

for (const token of [
  "const PLATFORM_INBOUND_URL = \"https://mzj-platform.vercel.app/api/integrations/whatsapp\"",
  "POST /webhook/mersal",
  "DEBUG_LAST_FORWARD",
  "Platform inbound endpoint rejected message",
]) if (!worker.includes(token)) throw new Error(`Mersal worker check failed: missing ${token}`);
if (worker.includes("MZJ_PLATFORM_INBOUND_URL")) throw new Error("Worker must not depend on MZJ_PLATFORM_INBOUND_URL");

console.log("Mersal inbound persistence and platform-owned entry automation checks passed.");
