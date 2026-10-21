# MZJ — TikTok Ads via TikTok for Business MCP

## Scope and isolation

This implementation adds TikTok **paid advertising** to **Marketing > Engagement > Paid campaigns**. It is independent of TikTok organic publishing, the existing YouTube connection, Meta Ads, Google Ads, Snapchat, CRM distribution, attendance, and every other subsystem. Their provider connectors and stored data have not been modified.

## Before deployment

1. Deploy the entire updated source archive as the MZJ project (not a patch).
2. Verify that the existing production environment variable `MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY` (or the existing fallback `MZJ_TOKEN_ENCRYPTION_KEY`) is configured and is at least 32 characters long. Use the platform's existing configured secret; never place it in source code or a public environment variable.
3. Database connectivity and `marketing` schema must be available, as they already are for Marketing. A new **dedicated** table `marketing.tiktok_ads_mcp_credentials` is created automatically on first successful explicit link. No other table needs migration.
4. Log into MZJ with `marketing.engagement.view` permission. To link/renew OAuth or pause/enable campaigns, the account needs `marketing.campaign.edit`; to create a stopped campaign draft, it needs `marketing.campaign.create`.

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
- Create **only a stopped, empty campaign draft**. This does not create ad groups, creatives, or active ads. Complete campaign construction remains in TikTok Ads Manager.
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
