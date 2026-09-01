MZJ Platform v44 - CRM Reports branch filter and finance rollup

Base: full v43 source package.

Changes:
- CRM representative report now respects the selected representative primary CRM branch and department, so selecting qadisiyah cannot render multaqa or wholesale representatives.
- Representative summary metrics use the same filtered representative dimension as the visible rows.
- Physical branches qadisiyah, hall and multaqa use one department/branch row under cash_sales.
- finance_sales and call_center records for those physical branches roll into the cash_sales branch metrics.
- online finance remains finance_sales and wholesale remains wholesale.
- Department/branch customer drill-down uses the same canonical rollup for lead rows and sold transaction rows, so finance customers are included when opening the physical cash branch customer report.
- Existing website zero-dimension row is preserved.

Validation:
- Owners: 83/83
- CRM v39: 16/16
- CRM v41: 10/10
- CRM v42: 11/11
- Marketing v43: 13/13
- CRM v44: 17/17
- TypeScript transpile of server/crm/reports.ts: PASS
- Merge conflict check: PASS

No patch or diff artifact is included.
