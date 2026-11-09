MZJ Platform - Lead form UX revisions (2026-11-06)
Source: complete clean source based on MZJ-LEAD-FORMS-CUSTOM-DESIGN-CAR-LOGOS-CONDITIONAL-CHOICES-PACKAGES-CLEAN-FULL-20261106.zip.

1. 'Choice appearance' is now saved per question ID in config.design.choiceLayouts.
   Changing question #2's layout never overwrites question #1's layout.
   Existing forms without overrides continue using their previous default choice layout.
2. On each question's inspector, 'Photos and logos' is expanded. Upload logo files
   separately for Cash, Financing, Undecided or any other option.
   Icons and layouts remain scoped to that question, including conditional options.
3. Contact step: edit the heading through the contact-screen inspector or the
   lead-form content settings. Stored as config.style.contactTitle (optional).
4. Customer form: removed the long privacy statement, approval checkbox,
   and repeated 'Your data is used ...' note. A small privacy policy link remains
   accessible. The submit request sends noticeProvided=true and consent=false;
   the server accepts the visible policy link, without fabricating consent.
   Older open tabs using explicit consent remain supported.
   Advertising pixel opt-in is unchanged and stays independent.
5. No changes to marketing packages, CRM, pixel event dispatch or lead routing.
6. Existing published forms use their saved layout until you edit/save/publish
   a new form configuration; customer privacy copy is updated in the renderer.

Quality checks: all existing 162 automated scripts and new scoped script passed.
Vite/React production bundle not verified locally because npm network and build
packages were unavailable (npm registry DNS EAI_AGAIN). Verify Vercel build state.
