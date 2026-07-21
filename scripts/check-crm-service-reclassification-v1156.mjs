import fs from "node:fs";

const lifecycle = fs.readFileSync(new URL("../server/_crm-lifecycle.ts", import.meta.url), "utf8");
const processor = fs.readFileSync(new URL("../server/_integration-processor.ts", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../mersal-worker/src/index.js", import.meta.url), "utf8");

const requiredLifecycle = [
  "existingServiceKey === serviceKey",
  "existingServiceKey !== serviceKey",
  "request_state='closed'",
  "العميل اختار قسمًا آخر",
  "service_request_reclassified",
  "status_label='عميل جديد',status_code=null",
  "إعادة توزيع بعد اختيار قسم جديد",
];
for (const token of requiredLifecycle) {
  if (!lifecycle.includes(token)) throw new Error(`Missing lifecycle reclassification token: ${token}`);
}

const requiredProcessor = [
  "forceServiceReclassification",
  "force_service_reclassification",
  'clean(value).toLowerCase() === "service_selection"',
  "knownService && (!openRequest || explicitServiceSelection)",
  'classificationMethod: explicitServiceSelection ? "customer_service_selection" : "source_mapping"',
];
for (const token of requiredProcessor) {
  if (!processor.includes(token)) throw new Error(`Missing integration reclassification token: ${token}`);
}

const requiredWorker = [
  'mzj-mersal-postgres-v1.12.3-service-reclassification',
  "trustedServiceClassification: Boolean(serviceSelection)",
  "forceServiceReclassification: Boolean(serviceSelection)",
  "financeDetailsRequired: serviceSelection?.key === \"finance\"",
];
for (const token of requiredWorker) {
  if (!worker.includes(token)) throw new Error(`Missing worker reclassification token: ${token}`);
}
if (worker.includes('serviceSelection && serviceSelection.key !== "finance"')) {
  throw new Error("Finance is still excluded from trusted service selection");
}
console.log("CRM service reclassification v1.15.6 check passed");
