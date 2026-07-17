import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  collection,
  collectionGroup,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { CrmLead, CrmMessage } from "./types";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCd2paKL200XRdz2SwFEUzAtfg51xWL5QA",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "mzj-lead.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "mzj-lead",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "mzj-lead.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "470098288857",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:470098288857:web:613125cfc1623b08abdec8",
};

export type LegacyIncomingMessage = {
  messageId: string;
  messagePath: string;
  conversationId: string;
  createdAt: string;
  createdAtMs: number;
  direction: "in";
  phone: string;
  raw: Record<string, unknown>;
};

function asText(value: unknown) {
  return String(value ?? "").trim();
}

function firebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

async function ensureFirebaseAuth(app: FirebaseApp) {
  const auth = getAuth(app);
  if (auth.currentUser) return;
  try {
    await signInAnonymously(auth);
  } catch {
    // Existing Firestore rules remain authoritative when anonymous auth is disabled.
  }
}

export function normalizeCrmPhone(value: unknown) {
  let digits = asText(value).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("05") && digits.length === 10) digits = `966${digits.slice(1)}`;
  if (digits.startsWith("0") && digits.length === 10) digits = `966${digits.slice(1)}`;
  if (digits.startsWith("5") && digits.length === 9) digits = `966${digits}`;
  return digits;
}

export function crmTimestampMs(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  if (typeof value === "object") {
    const timestamp = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof timestamp.toDate === "function") return timestamp.toDate().getTime();
    if (typeof timestamp.seconds === "number") return (timestamp.seconds * 1000) + Number(timestamp.nanoseconds || 0) / 1e6;
  }
  const text = asText(value);
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function messageDirection(data: Record<string, unknown>) {
  const raw = asText(data.direction || data.lastMessageDirection).toLowerCase();
  return ["out", "outbound", "sent", "send"].includes(raw) ? "out" : "in";
}

function messageMediaUrl(data: Record<string, unknown>) {
  const candidates = [
    data.mersalMediaUrl,
    data.mediaUrl,
    data.fileUrl,
    data.attachmentUrl,
    data.whatsappMediaUrl,
    data.downloadUrl,
    data.publicUrl,
    data.header_image,
    data.header_audio,
    data.header_video,
    data.header_document,
  ];
  for (const candidate of candidates) {
    let url = asText(candidate).replace(/\\\//g, "/").replace(/&amp;/gi, "&");
    if (!url || /lookaside\.fbsbx\.com\/whatsapp_business\/attachments/i.test(url)) continue;
    if (url.startsWith("//")) url = `https:${url}`;
    else if (url.startsWith("/")) url = `https://w-mersal.com${url}`;
    else if (/^(?:uploads?|storage|media|files?|documents?|public)\//i.test(url)) url = `https://w-mersal.com/${url.replace(/^\/+/, "")}`;
    if (/^https?:\/\//i.test(url)) return url;
  }
  return "";
}

function messageType(data: Record<string, unknown>, mediaUrl: string) {
  let type = asText(data.attachmentType || data.mediaType || data.messageType || data.type).toLowerCase();
  const mime = asText(data.mimeType || data.mime_type).toLowerCase();
  if (type === "photo" || type === "picture") type = "image";
  if (type === "voice" || type === "ptt") type = "audio";
  if (type === "file") type = "document";
  if (["image", "audio", "video", "document", "sticker", "template", "text"].includes(type)) return type;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime) return "document";
  if (/\.(?:jpg|jpeg|png|webp|gif)$/i.test(mediaUrl)) return "image";
  if (/\.(?:mp3|ogg|opus|wav|aac|m4a)$/i.test(mediaUrl)) return "audio";
  if (/\.(?:mp4|webm|mov|m4v)$/i.test(mediaUrl)) return "video";
  if (mediaUrl) return "document";
  return "text";
}

function messageBody(data: Record<string, unknown>, type: string) {
  const body = asText(data.text || data.caption || data.buttonTitle || data.message || data.body || data.lastMessageText);
  if (body) return body;
  if (type === "image") return "صورة من العميل";
  if (type === "audio") return "رسالة صوتية من العميل";
  if (type === "video") return "فيديو من العميل";
  if (type === "document") return "ملف من العميل";
  return "";
}

function providerMessageId(data: Record<string, unknown>) {
  const raw = data.workerResponse && typeof data.workerResponse === "object" ? data.workerResponse as Record<string, unknown> : {};
  const nested = raw.raw && typeof raw.raw === "object" ? raw.raw as Record<string, unknown> : {};
  return asText(
    data.providerMessageId
      || data.provider_message_id
      || data.mersalMessageId
      || data.messageWamid
      || data.message_wamid
      || data.wamid
      || raw.provider_message_id
      || raw.message_wamid
      || raw.message_id
      || nested.provider_message_id
      || nested.message_wamid
      || nested.message_id,
  );
}

function legacyCrmMessage(data: Record<string, unknown>, documentId: string, conversationId: string): CrmMessage {
  const direction = messageDirection(data);
  const mediaUrl = messageMediaUrl(data);
  const type = messageType(data, mediaUrl);
  const createdAtMs = crmTimestampMs(data.receivedAt || data.createdAt || data.sentAt || data.timestamp || data.updatedAt) || Date.now();
  const messageId = asText(data.messageId || data.id || documentId);
  const fileName = asText(data.fileName || data.filename || data.documentName || data.attachmentName);
  const status = asText(data.status || data.providerStatus || data.provider_status) || (direction === "in" ? "received" : "sent");
  return {
    id: messageId,
    direction,
    message_type: type,
    body: messageBody(data, type),
    attachment_url: mediaUrl || null,
    attachment_type: mediaUrl ? type : null,
    file_name: fileName || null,
    mime_type: asText(data.mimeType || data.mime_type) || null,
    file_size: Number(data.fileSize || data.file_size || 0) || null,
    provider_status: status,
    provider_message_id: providerMessageId(data) || null,
    sender_type: direction === "in" ? "customer" : "human",
    created_at: new Date(createdAtMs).toISOString(),
    legacy_path: `wa_conversations/${conversationId}/messages/${documentId}`,
  };
}

function messageFromDocument(document: QueryDocumentSnapshot<DocumentData>): LegacyIncomingMessage | null {
  const data = document.data() || {};
  if (messageDirection(data as Record<string, unknown>) !== "in") return null;
  const createdAtMs = crmTimestampMs(data.receivedAt || data.createdAt || data.sentAt || data.timestamp || data.updatedAt);
  if (!createdAtMs) return null;
  const parts = document.ref.path.split("/").filter(Boolean);
  const conversationId = asText(data.conversationId || data.convId || data.chatId || parts.at(-3));
  const phone = normalizeCrmPhone(
    data.phoneNormalized || data.phone || data.mobile || data.phoneNumber || data.customerPhone || data.waId || data.from || data.senderPhone || conversationId,
  );
  return {
    messageId: asText(data.messageId || data.id || document.id),
    messagePath: document.ref.path,
    conversationId,
    createdAt: new Date(createdAtMs).toISOString(),
    createdAtMs,
    direction: "in",
    phone,
    raw: data as Record<string, unknown>,
  };
}

function conversationIdsForLead(lead: CrmLead) {
  const extra = lead.extra_data && typeof lead.extra_data === "object" ? lead.extra_data : {};
  const ids = [
    normalizeCrmPhone(lead.phone_normalized || lead.phone),
    lead.conversation_legacy_id,
    extra.waConversationId,
    extra.convId,
    extra.conversationId,
    extra.conversation_id,
    extra.chatId,
  ].map(asText).filter(Boolean);
  return [...new Set(ids)];
}

export function mergeCrmMessages(...groups: CrmMessage[][]) {
  const sorted = groups.flat().filter(Boolean).sort((left, right) => crmTimestampMs(left.created_at) - crmTimestampMs(right.created_at));
  const byStrongKey = new Map<string, CrmMessage>();
  const fallbackKeys = new Set<string>();
  for (const message of sorted) {
    const strong = asText(message.provider_message_id) || asText(message.legacy_path) || asText(message.id);
    const timeBucket = Math.floor(crmTimestampMs(message.created_at) / 5000);
    const fallback = [message.direction, asText(message.body), asText(message.attachment_url), timeBucket].join("|");
    if (strong && byStrongKey.has(strong)) {
      byStrongKey.set(strong, { ...byStrongKey.get(strong)!, ...message });
      continue;
    }
    if (fallbackKeys.has(fallback)) continue;
    fallbackKeys.add(fallback);
    byStrongKey.set(strong || fallback, message);
  }
  return [...byStrongKey.values()].sort((left, right) => crmTimestampMs(left.created_at) - crmTimestampMs(right.created_at));
}

export async function loadLegacyConversationMessages(lead: CrmLead, maximum = 300): Promise<CrmMessage[]> {
  const app = firebaseApp();
  await ensureFirebaseAuth(app);
  const firestore = getFirestore(app);
  const all: CrmMessage[] = [];
  for (const conversationId of conversationIdsForLead(lead)) {
    const reference = collection(firestore, "wa_conversations", conversationId, "messages");
    let loaded = false;
    for (const field of ["receivedAt", "createdAt", "timestamp"]) {
      try {
        const snapshot = await getDocs(query(reference, orderBy(field, "asc"), limit(maximum)));
        all.push(...snapshot.docs.map((row) => legacyCrmMessage(row.data() as Record<string, unknown>, row.id, conversationId)));
        loaded = true;
        break;
      } catch {
        // Try the next timestamp field used by older worker versions.
      }
    }
    if (!loaded) {
      try {
        const snapshot = await getDocs(query(reference, limit(maximum)));
        all.push(...snapshot.docs.map((row) => legacyCrmMessage(row.data() as Record<string, unknown>, row.id, conversationId)));
      } catch {
        // The next conversation identifier can still be the active one.
      }
    }
  }
  return mergeCrmMessages(all).slice(-maximum);
}

export function subscribeToLegacyConversationMessages(
  lead: CrmLead,
  onMessages: (messages: CrmMessage[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const app = firebaseApp();
  let stopped = false;
  const unsubscribers: Unsubscribe[] = [];
  const buckets = new Map<string, CrmMessage[]>();

  void (async () => {
    try {
      await ensureFirebaseAuth(app);
      if (stopped) return;
      const firestore = getFirestore(app);
      for (const conversationId of conversationIdsForLead(lead)) {
        const reference = query(collection(firestore, "wa_conversations", conversationId, "messages"), limit(500));
        const unsubscribe = onSnapshot(
          reference,
          (snapshot) => {
            buckets.set(conversationId, snapshot.docs.map((row) => legacyCrmMessage(row.data() as Record<string, unknown>, row.id, conversationId)));
            onMessages(mergeCrmMessages(...buckets.values()));
          },
          (error) => onError?.(error instanceof Error ? error : new Error(String(error))),
        );
        unsubscribers.push(unsubscribe);
      }
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return () => {
    stopped = true;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

export async function saveLegacyOutgoingMessage(input: {
  lead: CrmLead;
  clientMessageId: string;
  text: string;
  messageType: "text" | "template";
  templateName?: string;
  providerResponse?: Record<string, unknown>;
  providerMessageId?: string;
}) {
  const app = firebaseApp();
  await ensureFirebaseAuth(app);
  const firestore = getFirestore(app);
  const conversationId = normalizeCrmPhone(input.lead.phone_normalized || input.lead.phone) || conversationIdsForLead(input.lead)[0];
  if (!conversationId) throw new Error("تعذر تحديد محادثة واتساب في Firebase");
  const now = new Date().toISOString();
  const body = asText(input.text) || (input.messageType === "template" ? "قالب واتساب" : "");
  const providerId = asText(input.providerMessageId);

  await Promise.all([
    setDoc(doc(firestore, "wa_conversations", conversationId), {
      id: conversationId,
      convId: conversationId,
      conversationId,
      leadId: input.lead.id,
      customerName: input.lead.customer_name || "",
      phone: input.lead.phone || input.lead.phone_normalized || "",
      phoneNormalized: normalizeCrmPhone(input.lead.phone_normalized || input.lead.phone),
      source: input.lead.source_name || input.lead.source_code || "",
      sourceName: input.lead.source_name || input.lead.source_code || "",
      platform: "whatsapp",
      channel: "whatsapp",
      channelCode: "wa",
      provider: "mersal",
      updatedAt: now,
      lastUpdated: now,
      lastMessageText: body,
      lastMessage: body,
      lastMessageDirection: "outbound",
      lastOutboundAt: now,
      lastHumanReplyAt: now,
    }, { merge: true }),
    setDoc(doc(firestore, "wa_conversations", conversationId, "messages", input.clientMessageId), {
      id: input.clientMessageId,
      messageId: input.clientMessageId,
      providerMessageId: providerId,
      provider_message_id: providerId,
      convId: conversationId,
      conversationId,
      direction: "out",
      text: body,
      message: body,
      body,
      type: input.messageType,
      templateName: input.templateName || "",
      provider: "mersal",
      platform: "whatsapp",
      channel: "whatsapp",
      channelCode: "wa",
      status: "sent",
      createdAt: now,
      sentAt: now,
      updatedAt: now,
      receivedAt: now,
      senderName: "CRM",
      senderId: "crm",
      workerResponse: input.providerResponse || null,
    }, { merge: true }),
  ]);
}

export function leadHasUnreadMessage(lead: CrmLead) {
  if (Number(lead.unread_count || 0) > 0) return true;
  if (lead.dashboard_unread === true || lead.has_unread_message === true || lead.has_unread_messages === true || lead.message_unread === true || lead.is_unread === true) return true;
  const direction = asText(lead.last_message_direction).toLowerCase();
  const incomingAt = crmTimestampMs(lead.last_incoming_message_at || lead.last_message_at);
  const readAt = crmTimestampMs(lead.dashboard_message_read_at);
  return direction === "in" && incomingAt > readAt;
}

export function messageMatchesLead(lead: CrmLead, message: LegacyIncomingMessage) {
  const extra = lead.extra_data && typeof lead.extra_data === "object" ? lead.extra_data : {};
  const leadIds = [
    lead.conversation_id,
    lead.conversation_legacy_id,
    lead.legacy_id,
    lead.id,
    extra.conversationId,
    extra.conversation_id,
    extra.convId,
    extra.waConversationId,
    extra.chatId,
    extra.participantId,
  ]
    .map((item) => asText(item).toLowerCase())
    .filter(Boolean);
  const messageIds = [
    message.conversationId,
    asText(message.raw.convId),
    asText(message.raw.chatId),
    asText(message.raw.conversationRefId),
    asText(message.raw.waConversationId),
    asText(message.raw.participantId),
    asText(message.raw.leadId),
    asText(message.raw.customerId),
  ]
    .map((item) => asText(item).toLowerCase())
    .filter(Boolean);
  if (leadIds.some((id) => messageIds.includes(id))) return true;
  const leadPhone = normalizeCrmPhone(lead.phone_normalized || lead.phone || extra.phoneNormalized || extra.phone || extra.mobile || extra.phoneNumber || extra.customerPhone || extra.waId);
  if (!leadPhone || !message.phone) return false;
  return leadPhone === message.phone
    || (leadPhone.length >= 9 && message.phone.length >= 9 && (leadPhone.endsWith(message.phone) || message.phone.endsWith(leadPhone)));
}

export function subscribeToLegacyIncomingMessages(
  onMessage: (message: LegacyIncomingMessage) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const app = firebaseApp();
  let stopped = false;
  let liveUnsubscribe: Unsubscribe | null = null;

  void (async () => {
    try {
      await ensureFirebaseAuth(app);
      if (stopped) return;
      const firestore = getFirestore(app);
      const messagesQuery = query(collectionGroup(firestore, "messages"), limit(300));
      const seen = new Set<string>();
      let initialSnapshot = true;
      const recentInitialWindowMs = 24 * 60 * 60 * 1000;

      liveUnsubscribe = onSnapshot(
        messagesQuery,
        (snapshot) => {
          const documents = initialSnapshot
            ? snapshot.docs
            : snapshot.docChanges().filter((change) => change.type === "added" || change.type === "modified").map((change) => change.doc);
          for (const document of documents) {
            const message = messageFromDocument(document);
            if (!message || seen.has(message.messagePath)) continue;
            seen.add(message.messagePath);
            if (initialSnapshot && Date.now() - message.createdAtMs > recentInitialWindowMs) continue;
            onMessage(message);
          }
          initialSnapshot = false;
        },
        (error) => onError?.(error instanceof Error ? error : new Error(String(error))),
      );
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return () => {
    stopped = true;
    liveUnsubscribe?.();
  };
}
