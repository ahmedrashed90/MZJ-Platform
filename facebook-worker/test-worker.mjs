import fs from "node:fs";
const source = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
const required = [
  'role: "transport_only"',
  'meta_webhook_is_authoritative',
  'createLead: false',
  'trustedServiceClassification: false',
  'providerMessageId',
  'workerCode',
  'conversationId',
  'participantId',
  'facebookPsid',
  'attachments: storedAttachments',
  'internalSendId',
  'idempotentReplay',
  'sendGraphMessage',
];
for (const token of required) if (!source.includes(token)) throw new Error(`Worker check missing: ${token}`);
for (const token of ['detectFacebookServiceSelection', 'serviceDefinition(', 'assignSales', 'assignCallCenter', 'financeRegistrationReady']) {
  if (source.includes(token)) throw new Error(`Worker contains forbidden business logic: ${token}`);
}
console.log("Facebook transport Worker v1.18.1 checks passed.");
