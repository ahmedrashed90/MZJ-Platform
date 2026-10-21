# MZJ Marketing — TikTok scheduled organic publishing through BulkPublish

- This integration is **organic** and separate from the existing TikTok Ads MCP (paid advertising).
- Required server-only Vercel environment variable: `BULKPUBLISH_API_KEY`.
- Optional channel selector: `BULKPUBLISH_TIKTOK_CHANNEL_ID=2042` (TikTok `@mzjcars`).
- Never put the API key into `VITE_` variables or commit a real key to Git/source archives.

## Publication workflow

1. Approve the final product file(s), preserving the original product as image or video.
2. Prepare an agenda/campaign publication row for TikTok using a supported post type (video, or image post/slideshow). TikTok Story direct publishing is **not** available with this provider; Instagram/Facebook Story remain supported by their existing integrations.
3. In Marketing > Publishing, save the caption, hashtags and Saudi Arabia local publishing time; the row's schedule date comes from the agenda/campaign.
4. Press `نشر في التاريخ والوقت المحددين` and confirm. The server verifies the approved media, validates the future Saudi datetime, uploads to BulkPublish and creates **one scheduled post** (not immediate publication).
5. A successfully scheduled record appears as `scheduled` in MZJ and can be queried on demand for eventual TikTok publication URL/status. Only the confirmed `published` provider status changes the row to published.
6. Before publication, a date/time change updates the **same BulkPublish Post ID**, using its saved media IDs, to prevent duplicate publication. If other platforms share the plan item, the date is locked here; the TikTok local time may still be edited.

### Safety and correctness

- `status:'scheduled'` and explicit UTC ISO timestamp are sent alongside timezone `Asia/Riyadh`.
- A failed or ambiguous external mutation is left in `verification_required` for manual confirmation before retry; it is **not automatically retried**.
- Existing cron excludes TikTok records because BulkPublish owns the future publishing time.
- TikTok files are real signed-file content, validated by byte signature. Supported: single MP4/MOV video or image JPG/PNG/WebP for photo slideshow. The format must also be supported by the selected MZJ post type.
- Key and media upload run server-side only; ad accounts, Meta, Google, YouTube, Snapchat, CRM and attendance are isolated.
- BulkPublish quota and provider platform capabilities apply; monitor account limits and connector validity.

### Current paid campaign limitation

The connected TikTok Ads MCP supports paid campaign reporting and a **paused campaign shell**, plus permissions-gated campaign state operations. It has not yet been verified to create a fully working ad group, creative, lead form, or live TikTok paid advertisement end to end. A paused shell is **not a ready-to-spend campaign**. Do not represent it as such.

### Verification

Run `node scripts/test-marketing-bulkpublish-20261021.mjs` for isolated provider mocks, `node scripts/test-marketing-tiktok-ads-mcp-20261021.mjs` for paid Ads isolation, and `node scripts/test-marketing-plan-multiplatform-20261017.mjs` for image/video + cross-platform planning. These tests do not publish live content. Full frontend build requires dependencies from `pnpm-lock.yaml`.
