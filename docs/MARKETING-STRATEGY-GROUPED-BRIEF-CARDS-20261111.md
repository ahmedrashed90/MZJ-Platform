# Marketing task details — MZJ grouped creative briefs

Branch changes are deliberately limited to the Marketing task detail presentation:
- `src/marketing/workflow/TaskDetail.tsx` renders imported Content Strategy briefs in clear, separated per-scene and per-image production cards without altering the stored idea text.
- `src/marketing/workflow/workflow.css` adds isolated styling.
- The summary row displays only the requirement name, executor, media type and status instead of repeating the entire brief in parentheses.
- Administrative editor still has the full original text editable and shows a structured preview; normal Marketing manual tasks continue rendering their existing plain text.
- Existing Marketing API already supports one task with multiple work items, one per selected idea, so no database migration, task API changes or CRM changes are required for grouped ideas.
- Display cards represent separate instructions; they do not create independent Marketing work items per slide. Marketing's original multi-file final-upload and format-based readiness behavior is unchanged.

The matching Content Strategy branch is `ahmedrashed90/Content-Strategy` `feature/72-ideas-image-cards-esc-v1-8`.
Changes are **not deployed**. Build and inspect in preview/staging, run existing Marketing workflow tests, create one safe sample task, verify image/video card display and final upload before production deployment.
