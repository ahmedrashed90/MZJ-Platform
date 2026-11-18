/** BulkPublish organic read-only cache and shared 429 circuit breaker.
 * A successful channel list is the last VERIFIED connection state. A failed
 * refresh is never evidence of a disconnected TikTok/Snapchat account.
 *
 * Cross-lambda cache/leases live in the Marketing DB; if its migration has not
 * been run the in-memory cache still works without disrupting the dashboard.
 * Credentials are used only in request headers; cache keys are SHA-256 hashes.
 */
import { createHash } from 'node:crypto';
import { getSql } from './_db.js';

type Sql = ReturnType<typeof getSql>;
type Json = Record<string, any>;
type Stored = { payload: Json | null; fetchedMs: number; blockedMs: number; lastStatus?: number };
export type BulkPublishRead = { payload: Json; stale: boolean; warning: string };
const CACHE_MS = 12 * 60 * 60_000; // 2 checks/day -> keep Free API usage bounded.
const QUOTA_BACKOFF_MS = 6 * 60 * 60_000;
const ERROR_BACKOFF_MS = 15 * 60_000;
const LEASE_MS = 75_000;
const providerCache = new Map<string, Stored>();
const inflight = new Map<string, Promise<BulkPublishRead>>();
const quotaBlocks = new Map<string, number>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const obj = (value: unknown): Json => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const ms = (value: unknown) => { const num = Number(value); return Number.isFinite(num) && num > 0 ? num : 0; };
const safeJson = (value: unknown): Json | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null;

async function fromDb(sql: Sql, key: string): Promise<Stored | null> {
  try {
    const [row] = await sql<Array<{payload: unknown; fetched_ms: number | string | null; blocked_ms: number | string | null; last_status?: number | null}>>`
      select payload, extract(epoch from fetched_at)*1000 as fetched_ms,
        extract(epoch from blocked_until)*1000 as blocked_ms,last_status
      from marketing.social_bulkpublish_read_cache where cache_key=${key} limit 1`;
    return row ? { payload: safeJson(row.payload), fetchedMs: ms(row.fetched_ms), blockedMs: ms(row.blocked_ms), lastStatus: Number(row.last_status) || undefined } : null;
  } catch { return null; } // Migration absent / DB temporarily unavailable.
}
async function claim(sql: Sql, key: string, now: number): Promise<boolean | null> {
  try {
    const rows = await sql<any[]>`
      insert into marketing.social_bulkpublish_read_cache (cache_key,blocked_until)
      values (${key},${new Date(now + LEASE_MS).toISOString()}::timestamptz)
      on conflict (cache_key) do update set blocked_until=excluded.blocked_until
      where marketing.social_bulkpublish_read_cache.blocked_until <= now()
      returning cache_key`;
    return rows.length > 0;
  } catch { return null; }
}
async function remember(sql: Sql, key: string, payload: Json, now: number) {
  providerCache.set(key, {payload, fetchedMs:now, blockedMs:now+CACHE_MS, lastStatus:200});
  try {
    await sql`
      insert into marketing.social_bulkpublish_read_cache (cache_key,payload,fetched_at,blocked_until)
      values (${key},${sql.json(payload)}::jsonb,${new Date(now).toISOString()}::timestamptz,${new Date(now+CACHE_MS).toISOString()}::timestamptz)
      on conflict (cache_key) do update set payload=excluded.payload,
        fetched_at=excluded.fetched_at,blocked_until=excluded.blocked_until,last_status=200`;
  } catch { /* Best-effort persistence: still return verified result. */ }
}
async function pause(sql: Sql, key: string, nextMs: number, status: number) {
  const stored = providerCache.get(key);
  providerCache.set(key, {payload:stored?.payload || null,fetchedMs:stored?.fetchedMs || 0,blockedMs:nextMs,lastStatus:status});
  try {
    await sql`
      insert into marketing.social_bulkpublish_read_cache (cache_key,blocked_until,last_status)
      values (${key},${new Date(nextMs).toISOString()}::timestamptz,${status})
      on conflict (cache_key) do update set blocked_until=greatest(marketing.social_bulkpublish_read_cache.blocked_until,excluded.blocked_until),last_status=excluded.last_status`;
  } catch { /* Backoff persists inside warm instance even without the table. */ }
}
function quotaWait(headers: Headers, now: number) {
  const retry = headers.get('retry-after');
  if (!retry) return QUOTA_BACKOFF_MS;
  const seconds = Number(retry);
  const hinted = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(retry) - now;
  return Number.isFinite(hinted) ? Math.min(24 * 60 * 60_000, Math.max(QUOTA_BACKOFF_MS,hinted)) : QUOTA_BACKOFF_MS;
}
function fallback(entry: Stored | null, message: string): BulkPublishRead {
  if (entry?.payload) return {payload:entry.payload,stale:true,warning:message};
  throw new Error(message);
}

async function read(sql: Sql, apiKey: string, path: string): Promise<BulkPublishRead> {
  const identity = hash(apiKey), key = `${identity}:${hash(path)}`, globalKey = `${identity}:quota`;
  const now = Date.now();
  let saved = providerCache.get(key) || null;
  if (saved?.payload && saved.fetchedMs + CACHE_MS > now) return {payload:saved.payload,stale:false,warning:''};
  const stored = await fromDb(sql,key);
  if (stored && (!saved || stored.fetchedMs > saved.fetchedMs || stored.blockedMs > saved.blockedMs)) {
    saved = stored;
    providerCache.set(key,stored);
  }
  if (saved?.payload && saved.fetchedMs + CACHE_MS > now) return {payload:saved.payload,stale:false,warning:''};

  const quota = await fromDb(sql,globalKey);
  const blockedUntil = Math.max(quotaBlocks.get(identity) || 0, quota?.blockedMs || 0);
  if (blockedUntil > now) return fallback(saved,'حد طلبات BulkPublish مؤقتًا (429)؛ تُعرض آخر بيانات محفوظة حتى يُسمح بالتحديث.');
  if (saved && saved.blockedMs > now) {
    if ([400,404,422].includes(saved.lastStatus || 0)) throw new Error(`BulkPublish HTTP ${saved.lastStatus}`);
    return fallback(saved,'تحديث BulkPublish قيد الانتظار؛ تُعرض آخر قراءة محفوظة.');
  }

  // This lease prevents simultaneous Vercel instances from exhausting the
  // shared API key on dashboard reloads. On DB migration absence it is a no-op.
  const leased = await claim(sql,key,now);
  if (leased === false) {
    const latest = await fromDb(sql,key);
    return fallback(latest?.payload ? latest : saved,'يوجد تحديث جارٍ من BulkPublish؛ تُعرض آخر قراءة محفوظة.');
  }

  try {
    const response = await fetch(`https://app.bulkpublish.com${path}`, {
      headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'},
      redirect:'manual',signal:AbortSignal.timeout(12_000),
    });
    if (response.status === 429) {
      const until = Date.now() + quotaWait(response.headers,Date.now());
      quotaBlocks.set(identity,until);
      await Promise.all([pause(sql,globalKey,until,429),pause(sql,key,until,429)]);
      return fallback(saved,'BulkPublish وصل لحد الطلبات المسموح (429)؛ البيانات السابقة محفوظة ولم يتم فصل الحساب.');
    }
    if (!response.ok) throw new Error(`BulkPublish HTTP ${response.status}`);
    const payload = obj(await response.json());
    if (payload.error || payload.success === false) throw new Error('BulkPublish لم يرجع إحصائيات صالحة');
    await remember(sql,key,payload,Date.now());
    if (providerCache.size > 80) providerCache.delete(providerCache.keys().next().value!);
    return {payload,stale:false,warning:''};
  } catch (error) {
    const message = error instanceof Error ? error.message : 'فشل اتصال BulkPublish';
    const status = Number(/BulkPublish HTTP (\d+)/.exec(message)?.[1]) || 503;
    await pause(sql,key,Date.now()+ERROR_BACKOFF_MS,status);
    return fallback(saved,`تعذر تحديث BulkPublish مؤقتًا (${message})؛ تُعرض آخر قراءة محفوظة.`);
  }
}
/** Never use the external API on every click. In-flight requests coalesce too. */
export function cachedBulkPublishRead(sql: Sql, apiKey: string, path: string): Promise<BulkPublishRead> {
  const key = `${hash(apiKey)}:${hash(path)}`;
  const current = inflight.get(key);
  if (current) return current;
  const work = read(sql,apiKey,path).finally(() => { if (inflight.get(key) === work) inflight.delete(key); });
  inflight.set(key,work);
  return work;
}
