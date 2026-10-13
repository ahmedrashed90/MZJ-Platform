# MZJ CRM - Per-lead source attribution for incremental sheet imports

## Functional change
- Importing Excel/CSV/TSV supports a third header `Source` or its Arabic equivalent.
- Source is recorded per newly inserted CRM lead in both `source_code` and `source_name`, using canonical CRM source categories.
- Recognized marketing sources: Facebook Lead, Instagram Lead, TikTok Lead, Snapchat Lead, Meta Lead, Google Ads, WhatsApp, Website, Haraj, Other.
- Spelling variations and common English/Arabic aliases map to one canonical CRM source code. Unrecognized nonempty sources are marked invalid for new leads, rather than corrupting marketing attribution.
- Legacy two-column imports still work: a missing/blank source retains the original `sheet_lead` source, with an on-screen reminder to fill missing sources for better reporting.
- Existing CRM leads, including previously imported customers, are checked by normalized mobile number BEFORE any new assignment or insertion. The existing assignee, branch, name, campaign, status, and source are never overwritten; their current stored source is available in the export.
- Source changes do not alter sales-representative routing logic: the existing cash/finance distribution source is retained for assignment rules.
- Registered source metadata uses WhatsApp as the delivery route for new sheet sources because importing a source is not proof of an active social messenger conversation. Existing catalog entries are not overwritten.
- No structural database migration or extra CRM table is needed.

## Spreadsheet
- The user's existing workbook is provided separately, with `Source` added as a blank third column and a controlled source dropdown. Existing 112 customer rows and phone values remain unchanged.
- A blank CSV template with three columns is included at `database/crm-lead-sheet-template.csv`.
- The workbook with customer information is NOT bundled inside the deployable source ZIP.

## Checks
- CRM sheet parser, admin permissions, canonical source mapping, duplicate suppression, and the 10 -> 15 -> 15 scenario: PASS.
- Existing CRM phone with a different or unknown source remains unchanged: PASS.
- New lead with unsupported source is rejected without assignment: PASS.
- 110 of 110 existing source-level checks: PASS.
- Isolated TypeScript typechecking of pure source mapping and parser: PASS.
- All touched TypeScript/TSX files syntax checks: PASS.
- Full production build still requires the project's React/Vite dependencies and must be confirmed on Vercel.

## Deployment
- Deploy the entire CLEAN ZIP as the new source, not as a patch.
- Keep the original database contents and original leads.
- Fill `Source` in the uploaded sheet before importing new leads if marketing source attribution is required.
