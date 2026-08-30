# MZJ Platform CLEAN v33

Full source rebuild from the clean v30 source tree.

Included:
- MZJ Club customer categories, permanent highest tier, membership-card back details, separated rewards catalog, purchase vehicle details and NEXT ERP invoice download flow.
- Fixes TypeScript inference in NEXT ERP Sales Invoice lookup.
- Fixes Marketing creative edit failure caused by ambiguous `ORDER BY content_user_id`.
- Adds creative deletion from Marketing > Database > View Data > campaign/agenda creatives.
- Creative deletion is permission-scoped, entity-scoped, blocks already-published creatives, removes dependent task/schedule data through existing foreign keys, and cleans/reassigns linked campaign budget rows.

No patch/diff package is included; this is a complete source package.
