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
    return response.status(200).json(await syncMetaEngagement(getSql()));
  } catch (error) {
    console.error('Meta engagement scheduler failed', error instanceof Error ? error.message : 'Unknown error');
    return response.status(500).json({ ok: false, error: 'Meta engagement scheduler failed' });
  }
}
