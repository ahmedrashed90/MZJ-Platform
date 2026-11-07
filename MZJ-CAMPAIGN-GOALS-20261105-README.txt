MZJ | Marketing Campaign Goals | Clean Full Source | 2026-11-05

This ZIP contains the complete application source based on the last supplied
MZJ-LEAD-FORMS-TEST-DATA-CLEAR-DASHBOARD-STABLE-CLEAN-FULL-20261105.zip.
It is NOT a patch package.

Features
1. Marketing Settings -> "الهدف من الحملة": create, rename, reorder, and
   remove goal options. Removing an option does not erase historical snapshots.
2. Campaign creation: responsive, card-based platform/post-type/budget composer;
   select one or more goals per platform. Each platform is stored once even if
   it has multiple post types or campaign dates.
3. Review: configured campaign reviewer(s) can fill or adjust platform goals
   for existing campaigns, including campaigns created before this feature.
   Changing goals does not modify publication lines or budgets.
4. Marketing dashboard -> Publishing -> Campaign report, campaign report page,
   and "تصدير PDF — ملخص الحملة": a two-column table, one row for each
   platform, with all distinct goals in the adjacent cell.
5. New campaigns require at least one selected goal for each selected platform.
   Previously created campaigns remain readable and can be completed by reviewers.

First deployment / database preparation
- Deploy the complete project and wait for Vercel to report Ready.
- Sign in as platform superadmin, open Marketing Dashboard, and press
  "تحديث أهداف الحملات" if the additive schema-16 upgrade prompt appears.
  This creates marketing.work_campaign_goals. It does not erase campaigns.
- In Marketing Settings -> "الهدف من الحملة", add the goal options.
- Reviewer: open an existing campaign -> "تحديد أهداف منصات الحملة" ->
  "اختيار المنصات والأهداف", select goals, and save.
- New campaign: select product, platform, post type and budget; then select
  campaign goals before saving. Check the report and printable PDF.

Safeguards and verification
- Changes were made in the original application files, not as layered patches.
- No campaign records were deleted or modified in a production database here.
- All 159 of 159 Node-based project check scripts passed in the validation
  environment after temporarily making TypeScript available locally.
- The campaign goal module also passed a standalone TypeScript type check.
- A full Vite/React production build could not be run here because online
  dependency installation was unavailable. Vercel must still complete build.
- The temporary validation-only node_modules folder is NOT in this ZIP.
