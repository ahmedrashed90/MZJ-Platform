import fs from "node:fs";

const processor = fs.readFileSync(new URL("../server/_integration-processor.ts", import.meta.url), "utf8");
const lifecycle = fs.readFileSync(new URL("../server/_crm-lifecycle.ts", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../server/_crm-schema.ts", import.meta.url), "utf8");
const automaticTemplate = fs.readFileSync(new URL("../server/_crm-auto-template.ts", import.meta.url), "utf8");
const settings = fs.readFileSync(new URL("../server/crm/settings.ts", import.meta.url), "utf8");
const admin = fs.readFileSync(new URL("../src/crm/pages/CrmAdminPage.tsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../server/integrations/[source].ts", import.meta.url), "utf8");

for (const token of [
  "Facebook PSID is required; ManyChat Contact ID cannot be used as PSID",
  "facebook:${pageId}:${facebookPsid}",
  "crm.service_selection_state",
  "serviceSelectionAccepted",
  'serviceKey === "finance"',
  "if (!normalizePhone(phone)) return",
]) if (!processor.includes(token)) throw new Error(`Missing Facebook identity token: ${token}`);

for (const forbidden of ["findManyChatSubscribersByName", "IDENTITY_MATCH_WINDOW_MS", "resolveManyChatContactForMeta"]) {
  if (processor.includes(forbidden)) throw new Error(`Forbidden guessed identity token in platform: ${forbidden}`);
}

for (const token of [
  "cash_total_customers_template_enabled",
  "finance_call_center_template_enabled",
  "crm.automatic_template_dispatches",
  "unique(service_request_id,template_name,reason)",
  "default false",
]) if (!schema.includes(token)) throw new Error(`Missing durable migration token: ${token}`);

for (const token of [
  "finance_request_received",
  "crm:auto-template:${input.serviceRequestId}",
  "deliverCrmMessage",
  "automaticDispatchId",
]) if (!automaticTemplate.includes(token)) throw new Error(`Missing automatic template token: ${token}`);

if (!lifecycle.includes("dispatchAutomaticEntryTemplate")) throw new Error("Automatic template dispatch is not centralized in CRM lifecycle");
if (!settings.includes('section === "automatic_template_settings"')) throw new Error("Automatic template settings API missing");
if (!admin.includes('key: "automatic_templates"')) throw new Error("Automatic template settings UI missing");
for (const token of ["serviceSelectionAccepted", "automaticTemplate"]) {
  if (!route.includes(token)) throw new Error(`Integration response is missing ${token}`);
}
console.log("Facebook canonical identity and automatic entry template v1.17.3 check passed");
