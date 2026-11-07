MZJ Platform - Lead Forms Customization & Marketing Packages Navigation
November 6, 2026

SOURCE
Based on the full MZJ-MARKETING-PUBLISH-LINKS-PRODUCT-REFERENCES-CLEAN-FULL-20261105.zip.
Complete repository source, not a patch overlay. Existing CRM, pixel attribution,
lead distribution and marketing publishing logic are intentionally unchanged.

CHANGES
1. Marketing > Packages: restore menu navigation with the existing
   marketing.packages.view permission; the existing page/route remains unchanged.
2. Lead-form cover images: contain rather than crop; max height defaults to
   120px and is configurable from the visual editor. Same constraint applies to
   the live preview and published forms.
3. Option images: upload or link a brand logo per answer and select Logo
   (small, uncropped) versus ordinary Photo (original behavior).
4. Form subtitle under company brand: editable per form, including former
   'طلب سيارة إلكتروني'.
5. Contact step: configure either Saudi mobile only or name + mobile.
   Mobile-only leads are saved/forwarded under the generic name
   'عميل من فورم المنصات' to preserve the existing CRM input contract;
   CRM deduplication and assignment are unchanged.
6. Conditional answer sets: for any choice question, configure rules based on
   up to 4 earlier answers. The first matching rule supplies its list of
   options; otherwise default options are used. Invalid stale answers are
   cleared if a customer changes a preceding answer. The published server
   validates the effective list as well as the browser.
7. Privacy layout: choose between the existing explicit-consent checkbox
   (default, preserved for existing forms) and a compact privacy-policy link
   for replying to the customer's request. The long privacy/trust text is
   hidden when compact mode is selected, but the policy stays accessible on
   every step. Compact mode does NOT pretend that the user checked a consent
   box. Additional/direct marketing requires its own lawful basis and any
   consent legally applicable; have the company review privacy requirements.

COMPATIBILITY
- Form settings live in existing JSON config / published_config; no new
  database table or migration is needed.
- Existing published forms are unchanged until the editor saves and
  publishes an update.
- Different form templates, platform pixels, UTM tracking, CRM and Google
  Sheets flows retain their existing routes.
- Restore Packages in navigation only if the signed-in account has
  marketing.packages.view access.

VALIDATION
- All 162 project Node-script checks passed in the isolated local test runner.
- New conditional-choice/settings regression test passed.
- TypeScript parse/emit checks passed for the edited TypeScript and TSX files.
- TypeScript semantic checking of standalone shared form schemas passed.
- Full Vercel build not run locally because React/Vite/node_modules could not
  be downloaded in this isolated environment. Confirm that Vercel reports READY
  before treating deployment as production-ready.

RELEASE CHECKLIST
1. Deploy the complete source, NOT the files individually.
2. Check Vercel BUILD logs, status READY and login permissions.
3. Test an existing form, then one newly customized form via Preview and
   Publish Update. Check cover and logos at mobile and desktop widths.
4. Test Hyundai / Cash versus Hyundai / Finance (new answer rules).
5. Submit a test form with mobile-only contact. Inspect CRM attribution and
   distribution and the correct lead in lead-form database.
6. Verify pixel Page View and Sign Up are still delivered as before.
