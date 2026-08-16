import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const messaging = read('server/_crm-messaging.ts');
const conversations = read('server/crm/conversations.ts');
const engagement = read('server/_marketing-engagement.ts');
const worker = read('facebook-worker/src/index.js');

const checks = [
  ['manual CRM send waits for provider result', conversations.includes('awaitProviderResult: true')],
  ['failed provider send is not emitted as message.sent', conversations.includes('delivery.providerStatus === "failed" ? "message.failed"')],
  ['provisional Facebook social participant is cleared before delivery', messaging.includes('normalizeProvisionalFacebookMessagingIdentity') && messaging.includes('participant_id=null')],
  ['Facebook social send trusts messagingReady, not a stale participant id', messaging.includes('socialConversation && !messagingReady') && messaging.includes('normalizeProvisionalFacebookMessagingIdentity(sql, conversation, policy.route)')],
  ['Facebook comment stays identity-pending until real Messenger identity exists', engagement.includes('item.platform === "instagram" ? "private_reply_available" : "identity_pending"')],
  ['Facebook worker targets the explicit Page messages endpoint', worker.includes('`${graphBase(env)}/${encodeURIComponent(resolvedPageId)}/messages`')],
  ['Facebook worker exposes structured Meta rejection details in logs', worker.includes('Facebook Graph send rejected') && worker.includes('error_subcode') && worker.includes('fbtrace_id')],
  ['worker version is provider-confirmed send v2.0.3', worker.includes('mzj-facebook-worker-v2.0.3-provider-confirmed-send')],
];

let passed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error(`FAIL ${name}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`PASS ${name}`);
  }
}
console.log(`\n${passed}/${checks.length} checks passed`);
if (passed !== checks.length) process.exit(1);
