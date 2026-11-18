# MZJ | Paid campaigns reporting

## What changed

- A standalone **تقرير الحملات** tab in Marketing > تفاعل النشر, with an inclusive **From / To** date range (max. 366 days), platform/currency filters and a campaign search.
- Unified, read-only provider reports for **Meta Ads**, **Google Ads** and **TikTok Ads** via `GET /api/marketing?resource=campaign_report&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`.
- Campaign table: account, campaign, currency, amount spent, leads, cost per lead and advertising engagements; three per-campaign charts for engagement, leads and CPL.
- Full report exports: real formatted RTL `.xlsx` with numeric cells and an A4-landscape Arabic HTML print report. **For PDF, click export, then choose the browser print destination “Save as PDF”.**
- TikTok campaign reports probe supported, directly attributed lead metrics before displaying a lead count. TikTok interactions use available advertising engagement metrics (or likes + comments + shares) rather than silently counting video impressions as interactions. The TikTok paid-campaign panel now shows engagements, leads and CPL with a clear missing-data fallback.

## Data integrity rules

1. A missing metric remains `null` and is rendered as `—`. It is **not** a recorded zero and does not enter numerical totals or ratios as if known.
2. CPL = campaign spend / **known, nonzero** leads, in that account's original currency. Mixed currencies are never summed for spend/CPL; filter by currency for apples-to-apples charts.
3. Conversion counts are **not** silently substituted for leads. Only the provider's attributed leads can populate that column.
4. Provider failures are isolated. Meta, Google and TikTok are queried concurrently with `Promise.allSettled`; a failed provider has its own status/warning rather than clearing healthy platforms' results.
5. The API uses `marketing.engagement.view` permission. Report requests do not create campaigns, change advertising spend, write CRM records, or run database migrations.
6. Provider ad-engagement concepts can differ. Chart and table values reflect each source's own event definition; hover the engagements cell for that platform's description.
7. No credentials are sent to the browser. All provider calls use the established server-side credentials and access controls.

## TikTok data caveat

The lead field can be numeric only when **the authenticated TikTok for Business MCP report endpoint actually returns a supported, attributed lead metric** for that advertiser and date range. If the available MCP tool/advertiser permission does not expose a lead metric, UI displays `—` with a clear warning. The offline tests cannot prove real-account data availability. Confirm against TikTok Ads Manager after deployment. The original organic TikTok/BulkPublish connection is not touched by this report.

## How to add future Snapchat Ads

The report UI, charts, filters and exports consume the single `CampaignReportPayload` interface in `shared/campaign-report.ts`; no UI redesign is required for another platform. After a Snapchat Ads **authorized API integration** is implemented, add an entry in the `ADAPTERS` array in `server/_marketing-campaign-report.ts` that invokes its own read-only campaigns report for the requested dates. Normalize account currencies and per-campaign paid metrics using `normalizeCampaignReportRow`, assigning an `interactionField` and documented event definition. Include permission tests and missing-metric cases; a new API integration is required before Snapchat data can appear. Do not pass generic conversion totals as leads.

## Testing

- `node scripts/test-marketing-campaign-report-20261021.mjs`
- `node scripts/test-marketing-tiktok-ads-full-builder-20261021.mjs`
- `node scripts/check-marketing-workflow-v2.cjs`
- `node scripts/test-marketing-meta-ads-charts-manager-20261017.mjs`
- `node scripts/test-google-ads-integration-20261021.mjs`

Tests exercise offline/provider-mocked behavior and do not spend money or contact live advertiser accounts. Full Vite build requires the project's npm dependencies to be installed; if not present locally, run it in the deployed Vercel build environment.
