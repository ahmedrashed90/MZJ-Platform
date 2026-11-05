# MZJ Forms — Visual Designer (2026-10-25)

## Scope

This release is based on `MZJ-Platform-MARKETING-UNDO-FINAL-APPROVAL-CLEAN-FULL-20261025(2).zip`.
All changes belong to `Marketing > فورم المنصات` and its isolated `shared/lead-form*`, `server/marketing/lead-forms.ts`, and marketing form database migration. The other systems, workers, CRM logic, Google Sheets synchronization, and existing role catalog remain unchanged.

## UI

- Form sub-navigation is centered. The platform's main RTL sidebar is unchanged.
- Removed the marketing page header sentence and the "6 templates use one engine" library note, along with similar nonessential explanatory notes.
- The six starter templates have distinct gallery previews and interaction treatments (steps, visual cards, conversational bubbles, quiz, minimal, classic).
- The editor adds a three-panel visual canvas (toolbox / draggable stage / inspector).
- Drag-and-drop uses pointer events so dragging works by mouse, pen, or touch. Each draggable element has keyboard-friendly up/down controls.
- Rearrange elements inside each question's screen, the contact screen, and the success screen. Editable blocks include text, badge, divider, spacing, image, logo, cover, headings, progress, choices, and action buttons.
- Edit choice-image URLs or upload compressed JPG/PNG/WebP images, typography size tiers, widths, alignment, background, button shape, transitions, and web form max-width.
- Add / reorder questions and keep conditional questions and lead answers intact.
- Preview on mobile / desktop; preview never creates a real lead.

## Reusable library

- Click **حفظ في مكتبة التصاميم** from an editable form. Enter the new reusable template name.
- It creates an isolated record in `marketing.form_design_templates` with the current form structure and design (it does not publish the form or change the original).
- Custom designs appear under **تصاميمي المحفوظة**, can be previewed, and can create new draft forms.
- Templates are declarative JSON; adding another fundamentally different rendering engine remains a code-level feature. Saving a new visual arrangement needs no code changes.

## Publishing / backward compatibility

- `FormConfig.design` is optional. Published forms from older releases without a design retain working templates through `createTemplateDesign` fallback.
- The active draft saves its design in `config`. Customer-facing published forms use only `published_config`; ordinary draft saves do not change the live public link.
- Renderer keeps the existing `view`, `step`, and `submit` requests and the existing lead field identifiers. The CSV and Sheets data model is unchanged.
- The API validates allowed blocks, preserves required input / contact / submit elements, forbids executable content, and restricts image sources to HTTPS or bounded image data URLs.
- The database migration is additive: `marketing.form_design_templates` only. The runtime lazy schema check creates this table automatically if missing. Existing tables are untouched.

## Deployment and test

- No new npm packages or environment variables required.
- Verify the standard Vercel `pnpm run build` using the project's exact `pnpm-lock.yaml` after deploying this full ZIP.
- Verify: create draft, add/reorder blocks, upload images, save, preview, save as template, create from saved template, publish, open public link on mobile and desktop, submit test lead on a test sheet.
- Dependency-free tests: `node scripts/test-marketing-form-visual-designer-20261025.mjs` and the preexisting marketing form checks.
