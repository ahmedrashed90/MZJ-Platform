import fs from "node:fs";

const files = {
  ui: fs.readFileSync("src/crm/components/LeadDrawer.tsx", "utf8"),
  browserMedia: fs.readFileSync("src/crm/messageMedia.ts", "utf8"),
  serverMedia: fs.readFileSync("server/_message-media.ts", "utf8"),
  integrations: fs.readFileSync("server/_integration-processor.ts", "utf8"),
  conversations: fs.readFileSync("server/crm/conversations.ts", "utf8"),
  messaging: fs.readFileSync("server/_crm-messaging.ts", "utf8"),
  gateway: fs.readFileSync("gateway-worker/src/index.js", "utf8"),
};

function requireText(file, label, text) {
  if (!files[file].includes(text)) throw new Error(`${label}: missing ${text}`);
}

requireText("browserMedia", "Browser media", "lookaside\\.fbsbx");
requireText("browserMedia", "Browser media", "header_document");
requireText("browserMedia", "Browser media", "prepareChatMessages");
requireText("ui", "Conversation UI", "downloadMedia");
requireText("ui", "Conversation UI", "messageDisplayText");
requireText("ui", "Conversation UI", '"العميل"');
requireText("serverMedia", "Server media", "mersalMediaUrl");
requireText("serverMedia", "Server media", "extractStrongMessageKeys");
requireText("integrations", "Integration merge", "jsonb_array_elements_text");
requireText("integrations", "Integration merge", "on conflict (conversation_id,provider_message_id)");
requireText("conversations", "Conversation ordering", "order by m.created_at desc, m.id desc");
requireText("conversations", "Conversation ordering", "order by recent.created_at asc, recent.id asc");
requireText("messaging", "Free text typing", 'type: "text", messageType: "text"');
requireText("messaging", "Template typing", 'type: "template"');
requireText("gateway", "Mersal resolver", "/api/wpbox/getConversations/none?mobile_api=true");
requireText("gateway", "Mersal resolver", "/api/wpbox/getMessages");
requireText("gateway", "Mersal resolver", "header_document");

console.log("Conversation and attachment checks passed.");
