# MZJ Marketing — Snapchat Ads + Snapchat Organic + TikTok refresh resilience

This is a **complete-source** change based on the supplied 2026-10-22 ZIP. No overlay patch or unrelated design refactor is required.

## Data routes

| Module | Read-only provider | Outcome |
| --- | --- | --- |
| Marketing > Campaign Report | Windsor.ai Snapchat Ads connector | One row per account/campaign over the selected inclusive date range; spend, submitted native leads, CPL, clicks, optional engagements |
| Marketing > Accounts & Followers | BulkPublish Snapchat channel | Connected account, follower count (only if returned), growth and historical readings, supported organic performance and top post |
| Marketing > Accounts & Followers | BulkPublish TikTok channel | Preserve last verified results if a refresh fails; expose retry/reconnect information and DB-migration diagnostics |

### Snapchat Ads configuration

1. Set `WINDSOR_SNAPCHAT_API_KEY` in the **Vercel Production environment**, using a *newly rotated* key if an older key was ever exposed in a link, screenshot or message.
2. Default query first uses `https://connectors.windsor.ai/snapchat` with `date,campaign,clicks,spend,native_leads,account_name,campaign_id,account_id,currency,source`. These fields are documented for Snapchat Ads.
3. If that route or field combination is not available, the reader tries `/all` and finally falls back to the six-field request previously verified in Postman. Raw API keys and provider error bodies are not logged.
4. `WINDSOR_SNAPCHAT_CURRENCY` is **optional** and only for fallback records missing a currency field; confirm the value against Snapchat Ads Manager before setting it.
5. `WINDSOR_SNAPCHAT_EXTRA_FIELDS` is optional for future supported metrics (`engagements`, `impressions`, `swipes`, `video_views`). If an extra field fails, the reader automatically uses the known six-field set.
6. The data reader and report UI are read-only. They neither create campaigns nor import leads into CRM.

**Financial math:** Sum the daily `spend`, `native_leads` and `clicks` per campaign within the requested date boundaries. Calculate CPL as TOTAL spend / TOTAL native leads (when leads > 0). Never average daily CPLs. Distinguish accounts by provider account ID where available, otherwise account name. Duplicated identical daily rows are dropped. Undefined engagement is `null`, not `0` and not inferred from clicks. The consolidated **Campaign Report always displays SAR**: USD spend and CPL are converted using the requested fixed rate **1 USD = 3.75 SAR**; SAR stays as-is. Unknown/other source currencies are not converted using the USD rate; those spend/CPL fields stay unknown with an explicit warning rather than being mislabeled SAR. For a Windsor `/all` fallback with no currency field, use `WINDSOR_SNAPCHAT_CURRENCY` only after verifying the actual currency in Snapchat Ads Manager. The exact same normalized amounts are used by the dashboard, charts, Excel and PDF.

**Important:** The Windsor.ai API worked in Postman with the current trial, but continued use after trial expiration is subject to the provider's subscription terms. Verify spend/leads/currency against Snapchat Ads Manager before using for business decisions.

### Snapchat organic / TikTok configuration

1. Set `BULKPUBLISH_API_KEY` in Vercel server environment (existing key for the connected channels). Never use a `VITE_` prefix or a client-side variable.
2. Connect the Snapchat **public profile** through BulkPublish Channels. The current TikTok channel remains separate.
3. Run the one-time SQL migrations **in the active Marketing database**: `database/migrations/20261022_marketing_snapchat_organic.sql` (followers history) and `database/migrations/20261022_marketing_bulkpublish_read_cache.sql` (shared cross-instance cache, connected state, quota cooldown). Both are safe `CREATE IF NOT EXISTS` migrations; they do not clear any existing tables.
4. If the earlier Marketing work-item notes migration is still missing, run the existing `database/migrations/20261022_marketing_review_notes.sql` using the normal database backup/migration procedure as well.
5. The server uses a **12-hour shared, database-backed BulkPublish response cache** plus a single-flight request lease, even across Vercel serverless instances. A 429 starts a shared cooldown (at least six hours, or the longer Retry-After hint when applicable) instead of repeatedly retrying the provider. On failure, the last VERIFIED channel connection status and prior metrics are retained, with a stale-data warning. Channel state is only marked inactive when a successful provider channels response explicitly confirms it. Manually pressing Refresh during the cache interval re-reads the stored values without consuming fresh provider quota. Daily publishing activity and other API clients may still use the same external quota.

**Source constraints:** BulkPublish's Snapchat analytics documentation covers post impressions/reach/likes/comments/shares/clicks/video views. It does not guarantee the Snapchat public profile follower count in every connected account. If the live account analytics endpoint does not return `followers`, the dashboard will show `—` with an explanation instead of guessing it.

### Tests included

- `node scripts/test-marketing-organic-accounts-20261022.cjs`
- `node scripts/test-marketing-campaign-report-20261021.mjs`
- `node scripts/test-marketing-snapchat-integrations-20261022.cjs`
- `node scripts/test-marketing-bulkpublish-429-sar-20261022.cjs` (cold-start persistence, 429 backoff, active-channel retention, deterministic API budget)

The integration tests use controlled provider mocks and, when present on the workstation, the uploaded Postman JSON. All tests are read-only and do not call live provider APIs or a production DB. No deployment secrets are packaged with the source. A complete `pnpm run build` must be run in the normal project CI/Vercel environment because npm dependency installation could not finish in this isolated environment.
