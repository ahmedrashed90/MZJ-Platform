import type { VercelRequest, VercelResponse } from '@vercel/node';
import { safeSecretEquals } from '../_auth.js';
import { getSql } from '../_db.js';
import { syncMetaEngagement } from '../_marketing-meta-sync.js';

/** Scheduled read-only-to-Meta discovery; CRM and scheduled publishing are untouched. */
export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') return response.status(405).json({ ok: false, error: 'Method not allowed' });
  const secret = String(process.env.CRON_SECRET || '').trim();
  const auth = String(request.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!secret) return response.status(503).json({ ok: false, error: 'CRON_SECRET is required' });
  if (!token || !safeSecretEquals(token, secret)) return response.status(401).json({ ok: false, error: 'Unauthorized' });
  try {
    const result = await syncMetaEngagement(getSql(), { scheduled: true });
    // Only operational counts and durations are logged, never Graph tokens or URLs.
    console.info('Meta engagement scheduler completed', JSON.stringify({
      elapsedMs: result.elapsedMs, imported: result.imported,
      skipped: 'skipped' in result ? result.skipped : false,
      deferred: 'deferred' in result ? result.deferred : false,
      accounts: result.accounts.map((account) => ({
        platform: account.platform, imported: account.imported,
        error: 'error' in account ? Boolean(account.error) : false,
      })),
    }));
    return response.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Meta engagement scheduler failed', message);
    return response.status(message === 'META_SYNC_SCHEMA_NOT_READY' ? 503 : 500).json({
      ok: false, error: message === 'META_SYNC_SCHEMA_NOT_READY' ? message : 'Meta engagement scheduler failed',
    });
  }
}
