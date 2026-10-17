# MZJ Platform — Marketing: executor requirements and Meta follower analytics

Date: 2026-10-17
Source: MZJ-Platform-META-ADS-ATTENDANCE-EXECUTORS-CLEAN-20261017.zip (complete retained project)

## Changes integrated into original source

### Marketing → Create Task
- Moved "إضافة مطلوب" beside "إضافة منفذ جديد" in the assignments panel header.
- Selecting an executor now occupies the right side of each executor group, not the center.
- The header add-required action targets a clearly selected executor group; new groups become selected automatically.
- Image and video selections are independent toggles and can both be selected.
- A dual-medium draft is saved as TWO existing work_items (one image, one video) for the same executor, idea and date, each with appropriate publishing formats and independent approval/upload. This preserves the original database schema and all existing work-item review/publish pathways.
- Rejects a combined request that has formats for only one medium; total max is still 100 persisted work items.

### Marketing → Publishing Engagement → Meta accounts/followers
- Removed "من آخر قراءة محفوظة" from both account cards.
- Facebook content count: exact number of posts imported into marketing.meta_external_posts. The UI explicitly marks it as synced content, NOT an invented all-time Meta content count.
- Facebook page fans / page likes: preserved in an independent metric.
- Account-wide post reaction/like sums across successfully imported posts with known metrics: Facebook counts reactions across types; Instagram counts media likes. Unavailable likes stay unknown instead of zero.
- Added top-engagement post for each account based on known likes + comments + shares, including caption, metrics, published date and trusted HTTPS permalink (when present).
- Full content coverage depends on archive backfill and metrics refresh, disclosed next to the cards.

### Meta sync error
- The bulk upsert previously passed a manually JSON-stringified value to `jsonb_to_recordset`. It now uses the native postgres.js `sql.json()` typed ARRAY payload, which guarantees that the root JSON value sent to `jsonb_to_recordset` is an array.
- No database migration or destructive data operation. The existing `meta_sync_state.last_error` clears on the next successful sync; run "تحديث الحسابات والمنشورات" after deploying to confirm.

## Verification and operational caveats
- 1,323 PASS results in all runnable project regression checks (without TypeScript build), including prior Meta Ads + attendance + executor checks and new mixed-media/account/sync tests.
- All changed TS/TSX files parse with TypeScript transpiler. Pure typed format-partition helper compiles with `tsc`.
- Full `tsc -b` + Vite production build not run in this environment because project dependencies were not installed. Vercel's build installs dependencies from the retained pnpm lockfile.
- Live database, Meta, Ads campaigns and Vercel were NOT accessed or modified during editing.
- Ads Manager data still requires adding `META_ADS_ACCESS_TOKEN` (ads_read scope) in Vercel. Optionally set `META_AD_ACCOUNT_IDS=2464725157220404` for the exact MZJ account, then redeploy. No secret tokens are in this source.
