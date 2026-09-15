import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const lifecycle = read('server/_crm-lifecycle.ts');
const engagement = read('server/_marketing-engagement.ts');
const messaging = read('server/_crm-messaging.ts');
const integration = read('server/_integration-processor.ts');
const conversations = read('server/crm/conversations.ts');
const facebookWorker = read('facebook-worker/src/index.js');
const instagramWorker = read('workers/MZJ-Instagram-Worker-v2.0.16-FULL.js');

const checks = [
  ['contact identity supports explicit/no participant modes', lifecycle.includes('participantIdMode?: "default" | "explicit" | "none"') && lifecycle.includes('participantIdMode === "none"')],
  ['Facebook social actor is not stored as Messenger PSID', engagement.includes('participantIdMode: messagingParticipantId ? "explicit" : "none"') && engagement.includes('const messagingParticipantId = item.platform === "instagram"')],
  ['social comments keep comment id and private-reply-ready state', engagement.includes('commentId: commentId || null') && engagement.includes('private_reply_available')],
  ['legacy Facebook fake participant ids are repaired once', engagement.includes('20260817_social_messaging_identity_v1233') && engagement.includes("coalesce(participant_id,'')=coalesce(external_id,'')") && engagement.includes('await repairLegacySocialMessagingIdentity(sql);')],
  ['Instagram IGSID is not copied into ManyChat Contact ID', !messaging.includes('manychatContactId: participantId') && messaging.includes('manychat_contact_id')],
  ['Instagram comment can use first private reply transport', messaging.includes('privateReply: true') && messaging.includes('أول رسالة خاصة لعميل Instagram القادم من تعليق يجب أن تكون رسالة نصية فقط')],
  ['Facebook Like cannot silently send with a fake PSID while comment uses private reply', messaging.includes('عميل Facebook الناتج من Like لم يبدأ محادثة Messenger بعد') && messaging.includes('privateReply: true') && messaging.includes('أول رسالة خاصة لعميل Facebook القادم من تعليق يجب أن تكون رسالة نصية فقط')],
  ['real Meta identity can merge back into provisional social conversation', integration.includes("c.metadata->>'commentId'=${socialReference.commentId}") && integration.includes('linkedFromSocialEngagement') && integration.includes('replyToProviderMessageId')],
  ['Instagram canonical identity stays IGSID while ManyChat remains an alias', integration.includes('instagramScopedId') && integration.includes('manychatContactId') && integration.includes('source === "instagram"')],
  ['CRM does not auto-create a fake chat participant from social external id', conversations.includes('provisionalSocialIdentity') && conversations.includes('const participantId = provisionalSocialIdentity ? ""')],
  ['Facebook worker forwards reply-to message identity', facebookWorker.includes('replyToProviderMessageId') && facebookWorker.includes('commentId: first(')],
  ['Instagram worker sends official comment-id private reply payload', instagramWorker.includes('recipient: { comment_id: commentId }') && instagramWorker.includes('graph_private_reply') && instagramWorker.includes('recipient_id')],
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
