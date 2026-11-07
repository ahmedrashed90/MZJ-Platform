MZJ Marketing Platform - Clean full source - 2026-11-05

Scope:
1. Campaign/agenda publishing report, preparation, and Products display the product title and its original Task number, 1-based requirement number, and assignee.
2. A saved post URL alone is sufficient for a published status; caption and hashtags are optional and can be saved later without changing the first publication date.
3. Plan-row edits retain existing manual post URLs and dates, and block changing/deleting already published rows.
4. For historical rows where the date still exists but URL is empty, a marketing reviewer/admin may restore the ORIGINAL URL without changing the original publication date. An audited URL is displayed when such an audit record exists.
5. New successful URL saves are audited with the original link and date.

Important data limitation:
Existing production data is NOT modified by packaging or deployment. A link already erased from the database, and absent from any previous backup, audit or provider record, cannot be reconstructed automatically; a reviewer must provide the actual original URL. No invented URL or publication date is used.

Validation:
161/161 existing/new Node regression scripts pass in isolated local checks. Full Vite/TypeScript build could not be run here because the production dependency tree was unavailable. Deploy first to a preview, confirm Vercel build, then test published links before production promotion.

This ZIP contains the complete source tree, not a patch. Existing CRM, pixel tracking and unrelated modules were retained unchanged.
