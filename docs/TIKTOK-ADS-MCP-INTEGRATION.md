# MZJ — TikTok Ads via TikTok for Business MCP

## Scope and isolation

This implementation adds TikTok **paid advertising** to **Marketing > Engagement > Paid campaigns**. It is independent of TikTok organic publishing, the existing YouTube connection, Meta Ads, Google Ads, Snapchat, CRM distribution, attendance, and every other subsystem. Their provider connectors and stored data have not been modified.

## Before deployment

1. Deploy the entire updated source archive as the MZJ project (not a patch).
2. Verify that the existing production environment variable `MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY` (or the existing fallback `MZJ_TOKEN_ENCRYPTION_KEY`) is configured and is at least 32 characters long. Use the platform's existing configured secret; never place it in source code or a public environment variable.
3. Database connectivity and `marketing` schema must be available, as they already are for Marketing. A new **dedicated** table `marketing.tiktok_ads_mcp_credentials` is created automatically on first successful explicit link. No other table needs migration.
4. Log into MZJ with `marketing.engagement.view` permission. To link/renew OAuth or pause/enable campaigns, the account needs `marketing.campaign.edit`; to create a stopped campaign, ad group, and ad, it needs `marketing.campaign.create`.

## One-time connection with the existing authorized accounts

1. Open **Marketing > Engagement > Paid campaigns > TikTok Ads**.
2. Select **Connect TikTok Ads**.
3. On your own Windows computer select the previously generated `C:\Users\mrahm\tiktok-mcp-token.json` file. The OAuth public client ID from the successful local authorization is pre-filled; it can be replaced if a different OAuth public client was used.
4. Press **Confirm secure connection**. MZJ verifies permissions using MCP `auth_advertiser_get` before persisting credentials, and saves encrypted tokens server-side. Do not upload the file to chat, GitHub, or Vercel source code.
5. Select either authorized advertiser account, date window, and optionally refresh. The UI separately displays the campaign limit budget and observed spend/metrics. A lead count is only displayed if TikTok actually supplies a direct lead metric for that account's report.

The successful standalone read-only test from the user retrieved 0 campaigns for advertiser `7373597771888295952` and 61 campaigns for advertiser `7373575366947962897`. These counts are a point-in-time observation; the actual deployed data is read live from TikTok MCP.

## Available actions

- Read all available non-deleted TikTok campaigns per advertiser, with pagination, filters, date windows, cached metrics, delivery state, account budget currency and objective.
- Show report spend, impressions, clicks, CTR, conversions, genuine leads when available and calculated cost per lead. An unavailable direct lead metric is shown as unavailable rather than counting every conversion as a lead.
- Start/pause a campaign only when explicitly confirmed in the UI. Starting a campaign can incur real advertising spend. Smart+ status changes use TikTok's separate Smart+ endpoint.
- Create a stopped Lead Generation campaign, a stopped ad group, and a stopped single-video lead ad in three explicitly confirmed stages. The existing shell-only campaign endpoint remains available internally.
- Disconnect TikTok **Ads** without removing the separate organic TikTok publishing connection.

## Implementation files

- `server/_marketing-tiktok-ads.ts` — independent authenticated MCP backend, encrypted OAuth storage/refresh, reporting and campaign operations.
- `src/marketing/components/TikTokAdsPanel.tsx` — paid-campaigns interface.
- `src/marketing/components/PaidAdsPanel.tsx` — one additional platform tab within the existing paid campaigns hub.
- `src/marketing/marketing.css` — namespaced TikTok-only styles appended without rewriting existing styles.
- `server/marketing/index.ts` — four new TikTok Ads actions and a read resource.
- `server/_api-permissions.ts` — TikTok Ads-only action permissions.
- `scripts/test-marketing-tiktok-ads-mcp-20261021.mjs` — isolated mocked regression test.

## Testing and limitations

The TikTok MCP API connection itself and account/campaign reads were demonstrated by the user with their own valid OAuth access token. Source integration tests use mock MCP/database responses and do **not** perform live ads-side writes or use personal credentials. Test command: `node scripts/test-marketing-tiktok-ads-mcp-20261021.mjs`. The reporting endpoint's account-specific lead metrics and the actual deployed OAuth refresh must be verified once on the live account after linking.

The original source ZIP did not include dependency installations (`node_modules`), and the full production `pnpm build` requires normal project dependencies. Never treat the isolated test result as a live production rollout confirmation.

## Full paused Lead Generation builder (2026-10-21)

Marketing > Engagement > Paid campaigns > TikTok Ads now includes a **three-step in-app builder** for manual Lead Generation campaigns:

1. Create a **DISABLE** campaign (or select an existing disabled Lead Generation campaign).
2. Create a **DISABLE** ad group with TikTok placement, Instant Form optimization, advertiser-account-local schedule, age, gender, location IDs, and ad group budget (or resume an existing disabled ad group).
3. Create a **DISABLE** single-video ad with an identity, TikTok Ads video library asset, CTA, and existing Instant Form page ID.

The server verifies authorized advertiser ownership, that the parent campaign is stopped, that the ad group belongs to that campaign, and discovers the three create-tool schemas with TikTok MCP `tool_get` before writes. If a required tool, status field or schema is unavailable, the server fails closed and shows the missing capability. No auto-start or spend. Campaign, ad group and ad are **separate confirmed writes**: after an ambiguous network failure, check the TikTok account before trying again; do not repeat automatically. Account identities, uploaded videos, Instant Forms and existing ad groups are read on demand when the builder is open. This does not affect Meta, Google, organic publishing, or CRM.

**Prerequisites / honest limits:** This builder uses existing TikTok Ads video assets and an existing TikTok Instant Form. It does **not** upload an MZJ approved product file to TikTok's Ads media library or create an Instant Form via TikTok Instant Page Editor SDK. A TikTok video ID and Instant Form page ID must exist; the UI reads them when permitted or accepts their IDs. The user must supply TikTok location targeting IDs. TikTok's MCP tools and field schemas are discovered against the **connected production account** at runtime; no live TikTok write was performed during source development. The legacy manual Lead Generation create APIs are slated for restrictions starting January 1, 2027, so an Upgraded Smart+ flow will eventually be required.

Run `node scripts/test-marketing-tiktok-ads-full-builder-20261021.mjs` for the isolated 33 mocked contract checks. A real paused end-to-end creation must be validated on the connected account before claiming production readiness. In particular, account-specific identity and Instant Form availability cannot be inferred from a successful campaign read.
