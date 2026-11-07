MZJ PLATFORM | LEAD FORMS TEST DATA CLEANUP & DASHBOARD STABILITY
Date: 2026-11-05
Base: MZJ-MARKETING-SNAPCHAT-PIXEL-VERCEL-BUILD-CLEAN-FULL-20261105.zip

This package is the COMPLETE app source, not an incremental patch.

Changes confined to the Lead Forms module and its existing permission catalog:
- Authorized lead-form managers can delete individual submissions from Marketing > Lead Forms > Lead Database.
- "Clear Test Data" opens a protected preview for the currently selected form, or for ALL forms if no form is selected.
- Before deleting, the dialog displays counts for form leads, recorded visits, and step events. It warns that all scoped records are deleted, even if they are not test records, and asks the admin to type the Arabic word "مسح".
- The server validates the permission, action confirmation, and preview counts again in a locked SQL transaction. If new data arrived after the preview, the operation is rejected and nothing is deleted.
- Deleting an individual lead adjusts submission statistics; it does not change historical visit counts. The bulk clear resets submissions, visits, and funnel steps together.
- No forms, templates, published content, tracking pixels or form configs are deleted.
- No records are deleted from CRM, Google Sheets or advertising platforms. Leads previously synced there remain there; administrators must remove those separately if desired.
- Deletion is logged in audit.activity_log, without copying phone numbers/names into the log.
- Added sensitive permission: marketing.lead_forms.leads.delete. Existing access-control schema automatically registers it and assigns it to admin, system_admin and marketing_admin role templates.
- Dashboard and Reports use stable permission-aware statistics requests. Session verification runs every 30 seconds; it no longer causes statistics to refetch. Identical statistics are reused and charts are memoized instead of remounting.

TO CLEAR PREVIOUS TEST DATA AFTER DEPLOYMENT
1. Deploy this FULL ZIP to Vercel as the complete project.
2. Open Marketing > Lead Forms > Lead Database.
3. For ALL historical test data, keep the form filter on "All Forms".
4. Click "مسح بيانات التجارب" and review preview counts; type "مسح"; confirm deletion.
5. Open Dashboard: historical visits and leads should now be zero in the selected scope, unless new live events arrived.

IMPORTANT: No database deletion is performed by deploying the code. The administrator must explicitly confirm a clear in the application.
IMPORTANT: The bulk clear does not identify test leads by name: ALL records in the chosen scope will be removed. If production leads exist, use per-row deletion instead.

VALIDATION
- 158/158 bundled Node tests PASS (with local TypeScript test shim). Includes new isolated runtime simulator for API routes: permissions, individual deletion, scoped/all resets, stale preview, audit logging, data isolation.
- TypeScript transpilation syntax diagnostics PASS for all changed TS and TSX files.
- Snapchat pixel regression and TikTok CRM attribution tests PASS.
- Full tsc/Vite build not run in this test container because React/Vite project dependencies are not installed and external package registry access was unavailable. Vercel's normal installCommand is unchanged.
