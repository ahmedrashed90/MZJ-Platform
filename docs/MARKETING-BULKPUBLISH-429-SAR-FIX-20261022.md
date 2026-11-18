# MZJ – BulkPublish 429 + Unified SAR reporting (full-source edition)

## Reason for TikTok “inactive” in the previous ZIP

When `/api/channels` returned BulkPublish HTTP 429, the old code recovered the
latest TikTok account from the followers table with `connected: false`. The UI
then rendered this guessed state as inactive. It was not proof that TikTok was
unlinked. The same failure was also shown on the Snapchat organic followers card.

## Changes in the full source

- The verified channel list, last analytics, and post engagement are cached in
  `marketing.social_bulkpublish_read_cache` (database-backed, shared across
  Vercel instances; API keys never saved). The cache refreshes at most every
  twelve hours by default, not on every user click.
- Same-path concurrent requests are coalesced. A SQL lease stops multiple cold
  Vercel instances from requesting the same uncached resource simultaneously.
- On `HTTP 429`, a shared cooldown stops further upstream calls for the API
  credential for a minimum of six hours, and respects longer `Retry-After`
  headers, where present. Existing verified active/inactive status and last
  metrics remain visible with an explicit stale warning. If no verified state
  exists, the UI shows **تعذر التحقق** rather than asserting “غير نشط”.
- TikTok and Snapchat organic metrics remain on BulkPublish. Snapchat paid
  campaigns remain entirely on Windsor.ai.
- Unified campaign reporting uses **SAR** for all display totals, per-campaign
  spend, CPL, graphs, Excel and browser-print PDF. When source currency is USD,
  multiply spend by **3.75** before calculating CPL. SAR is unchanged.
- If a connected ad account uses some other/unknown currency, keep spend and
  CPL unavailable, warn explicitly, and do not invent a conversion. This is
  especially important for the Windsor `date,campaign,clicks,spend,native_leads,
  account_name` fallback where currency is absent.

## One-time deployment instructions

1. Back up the active Marketing database.
2. Run `database/migrations/20261022_marketing_bulkpublish_read_cache.sql` in
   the **same database Vercel is using**, using your normal SQL editor.
3. If not already applied, run
   `database/migrations/20261022_marketing_snapchat_organic.sql` so Snapchat
   and TikTok follower snapshots can both be stored.
4. Deploy the entire ZIP to the existing MZJ project; keep your current
   environment variables `BULKPUBLISH_API_KEY` (TikTok only), `BULKPUBLISH_SNAPCHAT_API_KEY` (Snapchat organic, separate) and `WINDSOR_SNAPCHAT_API_KEY` (Snapchat paid campaigns).
   Rotate any previously shared Windsor key.
5. Redeploy on Vercel. The cache is populated on the first successful API
   response. If BulkPublish is **already** returning 429, it cannot supply fresh
   data until its quota resets, but this code will not fabricate inactivity or
   erase saved metrics. After the next successful read the account state will
   be recorded for future cold restarts.
6. Validate the exchange rate with a known USD campaign. For example,
   $20 spend and 5 native leads become **75 SAR spend, 15 SAR CPL** in the
   dashboard and both exports.
7. Only for Windsor rows with no `currency`: inspect the Snapchat account
   currency in Ads Manager and then set `WINDSOR_SNAPCHAT_CURRENCY=SAR` or `USD`
   accordingly. Never infer it from the country or campaign name.

## Local tests (no external traffic)

- `node scripts/test-marketing-organic-accounts-20261022.cjs`
- `node scripts/test-marketing-bulkpublish-429-sar-20261022.cjs`
- `node scripts/test-marketing-campaign-report-20261021.mjs`
- `node scripts/test-marketing-snapchat-integrations-20261022.cjs`

No service credentials, actual live advertising mutation, or direct database
migration is performed by these test scripts. Full Vercel production build
requires the normal project dependencies to be installed.
