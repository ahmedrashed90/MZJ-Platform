import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  collectionGroup,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { CrmLead } from "./types";

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

export function normalizeCrmPhone(value: unknown) {
  let digits = asText(value).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
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
  const parsed = Date.parse(asText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function messageFromDocument(document: QueryDocumentSnapshot<DocumentData>): LegacyIncomingMessage | null {
  const data = document.data() || {};
  if (asText(data.direction).toLowerCase() !== "in") return null;
  const createdAtMs = crmTimestampMs(data.createdAt);
  if (!createdAtMs) return null;
  const parts = document.ref.path.split("/").filter(Boolean);
  const conversationId = asText(data.conversationId || data.convId || data.chatId || parts.at(-3));
  const phone = normalizeCrmPhone(
    data.phoneNormalized || data.phone || data.mobile || data.phoneNumber || data.customerPhone || data.waId || data.from || data.senderPhone,
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
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  let stopped = false;
  let liveUnsubscribe: Unsubscribe | null = null;

  void (async () => {
    try {
      const auth = getAuth(app);
      if (!auth.currentUser) {
        try {
          await signInAnonymously(auth);
        } catch {
          // Some deployments expose these collection-group reads without Firebase Auth.
          // The listener is still attempted so the existing Firestore rules remain authoritative.
        }
      }
      if (stopped) return;
      const firestore = getFirestore(app);
      const messagesQuery = query(collectionGroup(firestore, "messages"), orderBy("createdAt", "desc"), limit(180));
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
