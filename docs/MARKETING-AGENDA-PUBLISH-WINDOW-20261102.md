# MZJ Marketing - Agenda publication window (2026-11-02)

## Scope
- Agenda creation now collects a required `agendaFrom` / `agendaTo` publication window, like the campaign funding range. Each actual publication line retains its independently selected `date` inside this range. The first blank agenda publication line defaults to the chosen start date.
- On new agenda creation, server validation checks both date formats, inclusive ordering and that publication days fall within the range. The existing `marketing.agendas.payload` JSONB stores `agendaFrom` and `agendaTo` and the existing `publish_start` / `publish_end` columns store the same selected range. No database migration is necessary.
- Pre-existing API clients without `agendaFrom` / `agendaTo` retain legacy behavior (period derived from earliest/latest scheduled post). No historic agenda dates are fabricated.
- Agenda publication range appears in main publishing cards, read-only reports, preparation chooser and review details. A plan creator can correct the agenda window through the review page; when a revision is open this sends it back for approval and notifies the reviewers. A reviewer (even if a platform admin) cannot alter agenda dates.
- Delivery calendar uses the explicit range start/end as milestones for new agendas, deduplicated within the same day, while legacy agendas still appear on each distinct scheduled publication date. It never creates a publication event for every intervening day.
- Editing the agenda window does not rewrite any scheduled post date or bypass approval or publishing permissions. Editing schedule rows still preserves the explicit agenda range rather than overwriting it from the first/last post.

## Validated locally (mock DB, no live provider/network)
- `node scripts/test-marketing-plan-ui-20261017.mjs` (19/19)
- `node scripts/test-marketing-plan-multiplatform-20261017.mjs` (48/48)
- `node scripts/test-marketing-plan-review-calendar-20261102.cjs` (19/19)
- `node scripts/test-marketing-plan-review-funding-ui-20261102.cjs` (4/4)
- `node scripts/test-marketing-plan-reviewers-20261102.cjs` (13/13)
- `node scripts/check-marketing-workflow-v2.cjs` (134/134)
- `node scripts/check-central-access-control-v1190.mjs` (93/93)
- `node scripts/check-owners-community-v1200.mjs` (83/83)
- Other marketing regressions: plan review, status, budgets, calendars, immutable URLs, export.

## Operational verification
- Upload the complete source and run the deployment build with normal dependencies installed.
- Create an agenda with start 2026-11-04/end 2026-11-11, place a publication on 2026-11-06, then verify its period is persisted and shown in review/report/prepare; the scheduled publication itself remains on 2026-11-06.
- Check both 2026-11-04 and 2026-11-11 on the delivery calendar; ensure no duplicate intervening-day agenda events.
- Request a revision and sign in as the agenda creator to update the range; make sure non-creator reviewer cannot change it and the revision is returned for approval.
- Open an old agenda without the new metadata and verify its original per-post dates remain unchanged.
