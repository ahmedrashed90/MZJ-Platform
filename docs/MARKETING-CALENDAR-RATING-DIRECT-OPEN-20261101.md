# MZJ Marketing - direct rating from delivery calendar (2026-11-01)

## Scope

- The task ratings overview is shown in the right-hand sidebar directly beneath the calendar. The day's delivery cards stay in the left column; mobile layouts stack naturally.
- Each rating line is a keyboard-accessible button. Clicking a missing rating opens only that work-item detail, even when its delivery date is different from the selected calendar day.
- The target work-item expands automatically. A reviewer with grading permission sees the rating form immediately, with the idea and available final-file previews inside the form.
- For a work item not fully approved or rejected, the form is read-only and explains the existing eligibility requirement. No permissions or approval requirements have been relaxed.
- Reviewers without grading permission can inspect the work item but cannot open an editable form or submit a rating.
- Saving uses the existing `work_save_rating` workflow and triggers refresh of both task details and calendar counts.
- Already-rated entries can still be opened for review without forcing an additional rating dialogue.

## Implementation

- `src/marketing/pages/ReceiptCalendarPage.tsx` - calendar layout and rating-entry actions, anchored to the exact item ID.
- `src/marketing/workflow/TaskDetail.tsx` - one-time focused expansion and permission-gated rating form; final-file preview.
- `src/marketing/workflow/workflow.css` - accessible clickable entries and preview styling.
- `scripts/test-marketing-calendar-rating-navigation-20261101.cjs` - in-component navigation, form, permission, and save/refresh regression scenarios.
- `package.json` - include the new test in the normal typecheck/build check chain without moving the Owners baseline check.

## Validation

- 7/7 new calendar rating navigation checks passed (mocked components and workflow response; no live DB).
- 15/15 existing auto-review and calendar tests passed.
- 134/134 workflow checks, 22/22 marketing status/notes tests, 93/93 central access and 83/83 Owners checks passed.
- Both edited TSX files transpile without syntax errors.

No database migration is required. A live production build and grading attempt on Vercel have not been verified from this environment.
