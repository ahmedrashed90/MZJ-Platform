# MZJ Platform — Meta Ads, Attendance & Multi-Executor Tasks

Date: 2026-10-17

## 1. Marketing — Paid Meta Ads inside Publishing Engagement

- Added **حملات Meta الممولة** tab within **تفاعل النشر**.
- The page reads Meta Ads Manager accounts, campaigns, ads and insights directly using the Graph/Marketing API (read-only).
- Displays campaign/ad status, date filters, accounts, spending, budget, reach, impressions, clicks, CTR, leads, cost per lead, ad engagement and creative thumbnails when available.
- Uses a separate `GET /api/marketing?resource=meta_ads` with the existing `marketing.engagement.view` permission.
- Organic posts, Instagram/Facebook comment syncing, CRM leads, scheduled publishing and the local campaign-planning system are not modified by Meta Ads reporting.

### Required Meta Ads permissions before live results are possible

Organic Facebook Page permissions do not grant Ads Manager reporting. Choose one:

1. Preferred: configure `META_ADS_ACCESS_TOKEN` in Vercel as a **Meta System User access token** granted `ads_read` (or the broader `ads_management`) and access to the relevant ad account(s).
2. Alternatively, add `ads_read` to your existing **Meta Login for Business** configuration and reconnect Facebook. The app can then use the securely stored Meta **user access token**, not the Page token, provided it is valid and has access to the ad accounts.

Optional `META_AD_ACCOUNT_IDS` in Vercel limits reading to the specific account IDs, e.g. `123456789012345,987654321098765`. Without it, the system discovers accounts available to the token (up to 4 per read).

These are server environment variables. Do not put access tokens into website source files or into client-side `VITE_` variables. Two live campaigns cannot be verified without your actual authorized Meta Ads token and connection.

## 2. Attendance

- **ساعات العمل الفعلية** uses the actual work minutes recorded for each shift, preserving both hours and minutes, without rounding to whole hours.
- **ساعات الدوام المفترضة** sums configured scheduled shift times (one or two shifts, as applicable).
- **الفرق (مفترض − فعلي)** = scheduled minutes minus worked minutes. Positive means a shortfall; negative means overtime.
- Weekly days off do not contribute to **إجمالي ساعات الموظف**. A vacation for one shift excludes only that shift, while full-day vacation excludes the full day.
- The three hours columns appear after each shift's **النتيجة** columns, in the report and PDF/Excel exports.
- Selecting a branch and clicking **عرض** now groups rows by employee, the same as selecting individual employees.

## 3. Marketing — Task creation and executor scope

- **إضافة منفذ جديد** creates a separate executor group. The executor is selected once for the group.
- **إضافة مطلوب** adds as many separate required deliverables to that executor as needed (100 per task maximum); media kind, format, idea, attachments and due date remain independent for every deliverable.
- Multiple executors and multiple deliverables are stored as existing `marketing.work_items`, preserving the current schema and approvals/file workflow.
- The dashboard task list and task detail counts/contents honor the authenticated user's own assigned deliverables, with existing manager/reviewer department scope retained.
- The delivery calendar remains filtered to the user's assigned deliverables and their individual due dates.

## 4. Verification performed

- 1102 `PASS` checks in the existing marketing, CRM, attendance and other regression scripts; zero failed checks.
- 8 new functional checks for mocked Meta Ads API responses, lead-count deduplication, budgeting/CPL, permission handling, minute-level attendance, leave/weekly day-off, and per-executor task isolation.
- TypeScript parser/syntax checks passed on the 9 changed/added `.ts`/`.tsx` files.
- The complete `tsc -b` / `vite build` could not be executed in this restricted environment because the project's external npm dependencies were not installed and npm registry DNS access was unavailable. Standard Vercel deployment performs `pnpm install --frozen-lockfile` and `pnpm run build` from the full retained source and lockfile.

No production database, live Meta Ads account, or CRM records were modified in preparing this source archive.
