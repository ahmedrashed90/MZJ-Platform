import type { VercelRequest, VercelResponse } from '@vercel/node';
import { safeSecretEquals } from '../_auth.js';
import { runMarketingScheduledPublishing } from '../marketing/index.js';

/** Publishing time is determined by each campaign/agenda row, not by a UI click. */
export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') return response.status(405).json({ ok: false, error: 'Method not allowed' });
  const secret = String(process.env.CRON_SECRET || '').trim();
  const auth = String(request.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!secret) return response.status(503).json({ ok: false, error: 'CRON_SECRET is required' });
  if (!token || !safeSecretEquals(token, secret)) return response.status(401).json({ ok: false, error: 'Unauthorized' });
  try {
    const result = await runMarketingScheduledPublishing();
    console.info('Marketing scheduled publishing tick', JSON.stringify(result));
    return response.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Marketing scheduled publishing tick failed', message);
    return response.status(message.includes('تهيئة أولية') ? 503 : 500).json({ ok: false, error: 'تعذر تنفيذ فحص النشر المجدول' });
  }
}
