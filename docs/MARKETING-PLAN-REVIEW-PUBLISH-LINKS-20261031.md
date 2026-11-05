# Marketing campaign/agenda review and publication links (2026-10-31)

## Scope
Only Marketing workflow files were changed. The existing publishing adapters, campaigns, agendas, task review/rating, attendance, CRM, operations and platform authentication are preserved.

## Plan lifecycle
- Saving a campaign or agenda creates a plan with `review_status=in_progress` (قيد التنفيذ).
- The creator can edit the plan's product rows, dates, compatible post types and campaign budget before submitting. An administrator/marketing manager can approve or request a revision with a permanent note.
- Revision moves to `revision` (مطلوب تعديل); the creator edits and sends to `submitted` (قيد المراجعة).
- Approval moves to `publishing` (جاري النشر). No automatic publishing is activated by this approval alone: the existing explicit activation flow still requires the original publish permissions and prepared targets.
- Each plan line represents a product + platform + post type publication. It has a manual post URL; a confirmed provider URL may also satisfy the same requirement. The plan reaches `published` (تم النشر) and 100% readiness only when **every active line** has a saved post URL. This is calculated, not a manually set status.
- Review notes are append-only in `marketing.work_plan_reviews`; task review notes are unaffected.

## Multi-format platform selection
Each selected platform can have several compatible post types (for example Instagram Photo and Story). A separate publication line is created per selected type, and the platform's campaign budget is recorded **once** on the first line; additional types carry a zero budget. The preview displays this distribution.

## Task captions
Executors can save caption and hashtags on each task requirement. When a campaign/agenda is created, these are used if the product publishing draft has no non-empty caption or hashtags. Existing non-empty publishing drafts retain precedence. Captions do not change task approval/readiness.

## Database upgrade
The new **additive** migration `schema-12` adds `work_plans.review_status`, review note/category metadata, a `work_plan_reviews` audit table, `work_plan_items.manual_post_url`, and `work_items.caption` / `hashtags`. It does not delete or rewrite task or post records. Previously activated plans are marked `publishing` to preserve the existing activation state. The migration runs only from the administrator's **تحديث قاعدة بيانات التسويق** action; normal GET requests do not run DDL. After deploying, a platform superadmin must click this button once, then refresh.

## Safeguards
- A publication URL is accepted only with an HTTP(S) scheme and a hostname; links cannot be saved before plan approval.
- Plan product edits are blocked if publish targets have already been prepared, to avoid leaving old scheduled assets attached to a different product. The creator must request administrator intervention for such a plan.
- Automatic publication remains gated by the existing preparation checks and now also requires plan approval.
- No actual post is created by saving a manual link; it is a record of a post published elsewhere.

## Validation
The existing marketing workflow, plan backend and rendered UI tests and new plan-review tests pass using mocked database/provider services. No live Postgres migration or Vercel build was run in this environment.
