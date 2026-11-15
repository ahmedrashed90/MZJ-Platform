import { getSql } from "./_db.js";
import { deliverConversationMessage } from "./_crm-messaging.js";
import { computeMessagingWindow, type MessagingWindowChannel } from "../shared/crm-messaging-window.js";
import { tiktokWindowHours } from "./_crm-window.js";

export type KeepaliveSettings = {
  enabled: boolean;
  channels: Record<MessagingWindowChannel, boolean>;
  leadMinutes: number;
  maxCycles: number;
  humanQuietMinutes: number;
  messages: { default: string; cash: string; finance: string; service: string };
};

export const DEFAULT_KEEPALIVE_SETTINGS: KeepaliveSettings = {
  enabled: false,
  channels: { facebook: true, instagram: true, tiktok: true, whatsapp: false },
  leadMinutes: 60,
  maxCycles: 3,
  humanQuietMinutes: 120,
  messages: {
    default: "هلا فيك 👋 لا نزال في خدمتك. إذا عندك أي استفسار أو تبي نكمل معك، رد علينا هنا وفريقنا يتواصل معك.",
    cash: "هلا فيك 👋 فريق المبيعات جاهز يخدمك. إذا تبي تكمل معنا بخصوص السيارة، رد علينا هنا ونرتب لك كل شيء.",
    finance: "هلا فيك 👋 فريق التمويل جاهز يخدمك. إذا تبي نكمل إجراءات التمويل، رد علينا هنا ونوافيك بالتفاصيل.",
    service: "هلا فيك 👋 فريق خدمة العملاء جاهز لمساعدتك. إذا عندك أي استفسار، رد علينا هنا ونخدمك.",
  },
};

let schemaPromise: Promise<void> | null = null;
async function ensureKeepaliveSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`create table if not exists crm.window_keepalive_settings (
        id text primary key default 'default',
        settings jsonb not null default '{}'::jsonb,
        updated_by uuid,
        updated_at timestamptz not null default now()
      )`;
      await sql`create table if not exists crm.window_keepalive_log (
        id uuid primary key default gen_random_uuid(),
        conversation_id uuid not null,
        channel_code text,
        last_customer_message_at timestamptz not null,
        message_text text,
        status text not null default 'pending',
        error_message text,
        created_at timestamptz not null default now(),
        unique (conversation_id, last_customer_message_at)
      )`;
      await sql`create index if not exists window_keepalive_log_conv_idx on crm.window_keepalive_log (conversation_id, created_at desc)`;
    })().catch((error) => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function normalizeKeepaliveSettings(raw: any): KeepaliveSettings {
  const d = DEFAULT_KEEPALIVE_SETTINGS;
  const text = (v: unknown, fallback: string) => { const t = String(v ?? "").trim(); return t ? t.slice(0, 900) : fallback; };
  return {
    enabled: raw?.enabled === true,
    channels: {
      facebook: raw?.channels?.facebook ?? d.channels.facebook,
      instagram: raw?.channels?.instagram ?? d.channels.instagram,
      tiktok: raw?.channels?.tiktok ?? d.channels.tiktok,
      whatsapp: raw?.channels?.whatsapp ?? d.channels.whatsapp,
    } as KeepaliveSettings["channels"],
    leadMinutes: clampInt(raw?.leadMinutes, 15, 360, d.leadMinutes),
    maxCycles: clampInt(raw?.maxCycles, 1, 10, d.maxCycles),
    humanQuietMinutes: clampInt(raw?.humanQuietMinutes, 0, 1440, d.humanQuietMinutes),
    messages: {
      default: text(raw?.messages?.default, d.messages.default),
      cash: text(raw?.messages?.cash, d.messages.cash),
      finance: text(raw?.messages?.finance, d.messages.finance),
      service: text(raw?.messages?.service, d.messages.service),
    },
  };
}

export async function loadKeepaliveSettings(): Promise<KeepaliveSettings> {
  await ensureKeepaliveSchema();
  const sql = getSql();
  const [row] = await sql<any[]>`select settings from crm.window_keepalive_settings where id='default'`;
  return normalizeKeepaliveSettings(row?.settings || {});
}

export async function saveKeepaliveSettings(input: unknown, userId?: string | null) {
  await ensureKeepaliveSchema();
  const sql = getSql();
  const settings = normalizeKeepaliveSettings(input);
  await sql`
    insert into crm.window_keepalive_settings(id,settings,updated_by,updated_at)
    values ('default',${sql.json(settings as any)},${userId || null}::uuid,now())
    on conflict(id) do update set settings=excluded.settings,updated_by=excluded.updated_by,updated_at=now()
  `;
  return settings;
}

export async function listKeepaliveLog(limit = 50) {
  await ensureKeepaliveSchema();
  const sql = getSql();
  const rows = await sql<any[]>`
    select l.id::text,l.conversation_id::text,l.channel_code,l.status,l.error_message,l.message_text,l.created_at,l.last_customer_message_at,c.customer_name
    from crm.window_keepalive_log l left join crm.conversations c on c.id=l.conversation_id
    order by l.created_at desc limit ${Math.min(200, Math.max(1, limit))}
  `;
  const [stats] = await sql<any[]>`
    select count(*) filter(where status='sent' and created_at>now()-interval '24 hours')::int as sent_24h,
      count(*) filter(where status='failed' and created_at>now()-interval '24 hours')::int as failed_24h
    from crm.window_keepalive_log
  `;
  return { rows, stats: stats || { sent_24h: 0, failed_24h: 0 } };
}

function messageFor(settings: KeepaliveSettings, serviceKey: unknown) {
  const key = String(serviceKey || "").toLowerCase();
  if (key.includes("cash") || key.includes("كاش")) return settings.messages.cash;
  if (key.includes("financ") || key.includes("تمويل")) return settings.messages.finance;
  if (key.includes("service") || key.includes("خدمة")) return settings.messages.service;
  return settings.messages.default;
}

/**
 * Sends ONE automatic "reply to stay in touch" message shortly before the reply window closes.
 * It is sent inside the window (allowed by Meta). It does not extend the window by itself: the
 * customer's reply does. Stops after `maxCycles` automatic messages without a human reply in between.
 */
export async function runWindowKeepalive() {
  const settings = await loadKeepaliveSettings();
  if (!settings.enabled) return { ok: true, enabled: false, scanned: 0, sent: 0, failed: 0, skipped: 0 };
  const sql = getSql();
  const rows = await sql<any[]>`
    select c.id::text, c.channel_code, c.service_key, c.last_customer_message_at, c.last_human_reply_at, c.closed_at, c.classification_state
    from crm.conversations c
    where c.last_customer_message_at is not null
      and c.last_customer_message_at > now() - interval '48 hours'
      and c.channel_code in ('facebook','instagram','tiktok','whatsapp','mersal')
      and (c.classification_state<>'closed' or c.last_customer_message_at>coalesce(c.closed_at,'epoch'::timestamptz))
    limit 2000
  `;
  const now = Date.now();
  let sent = 0, failed = 0, skipped = 0;
  for (const row of rows) {
    const window = computeMessagingWindow({ channelCode: row.channel_code, lastCustomerMessageAt: row.last_customer_message_at, tiktokHours: tiktokWindowHours(), now });
    if (!window || window.remainingMs === null) continue;
    // Never later than 5 minutes before the end, so the message is still inside the window.
    if (window.remainingMs > settings.leadMinutes * 60_000 || window.remainingMs < 5 * 60_000) continue;
    if (!settings.channels[window.channel]) { skipped += 1; continue; }
    const lastHuman = row.last_human_reply_at ? new Date(row.last_human_reply_at).getTime() : 0;
    if (settings.humanQuietMinutes > 0 && lastHuman && now - lastHuman < settings.humanQuietMinutes * 60_000) { skipped += 1; continue; }
    // Automatic messages since the last human reply (or closing); a human reply resets the counter.
    const since = new Date(Math.max(lastHuman, row.closed_at ? new Date(row.closed_at).getTime() : 0, 0)).toISOString();
    const [counter] = await sql<any[]>`select count(*)::int as n from crm.window_keepalive_log where conversation_id=${row.id}::uuid and status='sent' and created_at>${since}::timestamptz`;
    if (Number(counter?.n || 0) >= settings.maxCycles) { skipped += 1; continue; }
    const text = messageFor(settings, row.service_key);
    const [claimed] = await sql<any[]>`
      insert into crm.window_keepalive_log(conversation_id,channel_code,last_customer_message_at,message_text,status)
      values (${row.id}::uuid,${window.channel},${new Date(row.last_customer_message_at).toISOString()}::timestamptz,${text},'pending')
      on conflict(conversation_id,last_customer_message_at) do nothing returning id::text
    `;
    if (!claimed) continue; // already handled for this customer message
    try {
      await deliverConversationMessage({
        conversationId: row.id, text, senderType: "bot", reason: "window_keepalive",
        idempotencyKey: `keepalive:${row.id}:${new Date(row.last_customer_message_at).getTime()}`,
      });
      await sql`update crm.window_keepalive_log set status='sent' where id=${claimed.id}::uuid`;
      sent += 1;
    } catch (error) {
      failed += 1;
      await sql`update crm.window_keepalive_log set status='failed',error_message=${(error instanceof Error ? error.message : String(error)).slice(0, 500)} where id=${claimed.id}::uuid`;
    }
  }
  return { ok: true, enabled: true, scanned: rows.length, sent, failed, skipped };
}
