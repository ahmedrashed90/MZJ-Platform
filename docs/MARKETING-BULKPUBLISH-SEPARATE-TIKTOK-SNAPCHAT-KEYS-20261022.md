# MZJ Marketing – isolated BulkPublish TikTok/Snapchat API keys

## User-facing behavior

* **Marketing → Accounts & Followers → TikTok:** Uses the original `BULKPUBLISH_API_KEY` and existing TikTok channel. TikTok scheduled publishing, status checking and rescheduling are unchanged.
* **Marketing → Accounts & Followers → Snapchat:** Uses only `BULKPUBLISH_SNAPCHAT_API_KEY`. The optional `BULKPUBLISH_SNAPCHAT_CHANNEL_ID` filters connected Snapchat channels; when unset, Snapchat channels under that key are discovered automatically.
* **Marketing → Campaign Report → Snapchat Ads:** Continues using `WINDSOR_SNAPCHAT_API_KEY` without changes. No mixing of paid and organic data.

## Vercel → Project Settings → Environment Variables (Production)

| Variable | Set | Notes |
| --- | --- | --- |
| `BULKPUBLISH_API_KEY` | **Leave existing value unchanged** | TikTok only, including organic scheduling |
| `BULKPUBLISH_TIKTOK_CHANNEL_ID` | **Leave existing value unchanged** | Existing TikTok channel |
| `BULKPUBLISH_SNAPCHAT_API_KEY` | **Add new value** | The *separate* Snapchat BulkPublish key **only**; not the URL, `Bearer`, or `api_key=` |
| `BULKPUBLISH_SNAPCHAT_CHANNEL_ID` | Optional | Numeric channel ID of the Snapchat account; leave blank for auto-discovery |
| `WINDSOR_SNAPCHAT_API_KEY` | **Leave existing value unchanged** | Snapchat paid campaign reports |

Set the new BulkPublish variable to **server-side** Production, not `VITE_...`. Redeploy after saving Vercel environment variables. The Snapchat public profile must already be connected to the BulkPublish account/organisation represented by this key. If the secret has ever been shared publicly, rotate it before deploying.

## Technical details

- The organic account API reads `GET /api/channels`, `GET /api/analytics/account`, and `GET /api/analytics/engagement` **once per key / platform**, never borrowing channels from the other credential's response. The provider REST endpoint is the same host, but the bearer tokens are different.
- A missing Snapchat key displays a Snapchat-only configuration warning; TikTok is still loaded. A missing TikTok key does not block Snapchat.
- An invalid Snapchat channel ID displays a Snapchat-only error; a configured ID must actually belong to the Snapchat credential.
- Read cache, 429 cooldown and cross-instance storage are keyed using a SHA-256 fingerprint of each API key. API keys are never sent to the frontend or logged in the error message.
- The original `marketing.social_bulkpublish_read_cache` and `marketing.social_follower_snapshots` tables are reused. **No new SQL migration** is required for this separation if the previous BulkPublish cache / follower-history migrations have already been applied.
- As before, a provider quota imposed at **organization level** may affect more than one API key from the same organization. Separating client credentials does not bypass the provider's quota.
- Snapchat follower count is displayed only if BulkPublish returns the `followers` metric. Missing metrics remain `—` rather than fabricated zeros.

## Offline regression verification

```bash
node scripts/test-marketing-bulkpublish-separated-keys-20261022.cjs
node scripts/test-marketing-organic-accounts-20261022.cjs
node scripts/test-marketing-bulkpublish-429-sar-20261022.cjs
node scripts/test-marketing-bulkpublish-20261021.mjs
node scripts/test-marketing-snapchat-integrations-20261022.cjs
```

These mock tests do not call BulkPublish, Snapchat, TikTok, Windsor, or production database. A real connected-account read can only be validated after configuring the Snapchat key on the user's Vercel environment.
