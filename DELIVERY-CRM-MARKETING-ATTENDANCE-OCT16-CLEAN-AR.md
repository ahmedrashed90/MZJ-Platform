# MZJ – CRM, marketing, attendance and platform dashboard (CLEAN)

## Scope

This full source tree is based on `MZJ-Platform-CRM-ATTENDANCE-SHIFTS-HISTORIC-LEADS-CLEAN-FULL.zip`. No source file from the input ZIP was intentionally removed. The implementation updates the existing application files; it does not include a separate patch installer.

- Global dashboard: requested composite total `open conversations + unanswered leads + sold quantity` per selected range. The department pie / representative counts instead deliberately show **unique customer records** from the deduplicated, registered-date cohort. Those are *different metrics and may not equal the composite total* when customers overlap across categories. The pie is explicitly labeled `عملاء فريدون`. This distinction must not be masked with invented figures. Calendar-month ranges show `جدد هذا الشهر`; a 1–7 day range shows `جدد هذا الأسبوع`; otherwise `جدد خلال الفترة`.
- CRM sales dashboards: historic client cards retained except the date-restricted `غير مؤهل` state; sales KPI is sourced from canonical `crm.sales_transactions` with real `sale_at` range instead of cumulative historic sales. Sales quantities and unique customer counts are different quantities. Qualified is the configurable group in `crm.report_quality_settings`.
- Report quality: marketing `(qualified group + in-period sold quantity) / total`; sales `in-period sold quantity / total`.
- CRM manual lead import: downloadable **.xlsx** three-column template (Full Name / Phone Number / Source). Imported Saudi phones use the existing normalization, deduplication, retry and salesperson routing flow; source names/codes can be resolved against active CRM sources, including `السوق المفتوح`. The existing superadmin restriction remains.
- Marketing: flat marketing user choice without department labels while preserving the canonical department/user IDs; delivery badges are suppressed when zero.
- Attendance: expected, actual and delta hours are inline columns in day/employee tables and the existing PDF/Excel report sheets; no second hours table. The early-permission form captures departure vs vacation, shift, reason and times. Admin may delete a mistaken permission. Only a checkout identified as authorized by exactly that permission is reverted, never a manually recorded checkout.

## Verification

- All scripted application checks reached TypeScript without runtime assertion failures, including the updated regression checks for the newly requested behavior.
- Dedicated assertions `node scripts/check-mzj-oct16-clean.mjs`: 11/11 PASS.
- Source parser: 307 TS/TSX files parsed, 0 syntax errors.
- **Not verified:** full Vercel production build / live Neon database queries. This sandbox did not have the project React, Vite and Node declaration packages available. Deploy on a staging environment and check CRM reports, attendance permissions, marketing task creation and historical/period metrics before promoting to production.

## Known metric-contract distinction

The instruction that total clients equals the raw sum of open conversations, unanswered leads and sales cannot simultaneously mean the number of **unique** customers if any client belongs to more than one category. The requested additive KPI is implemented separately from the unique-customer pie/representative counts. The CRM report cohort and registration-date growth cohort can likewise legitimately differ unless their status and date scopes are first aligned. No database reconciliation was performed on production data.
