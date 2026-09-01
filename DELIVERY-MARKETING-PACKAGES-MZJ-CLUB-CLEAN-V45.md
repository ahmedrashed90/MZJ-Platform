# MZJ Platform v45 — Marketing Packages + MZJ Club

- Full clean source based on v44.
- Fixes the stale 23/24 CRM/Marketing baseline assertion so it validates the current canonical department/branch roll-up logic instead of the pre-v44 grouping expression.
- Adds `insurance_description` to Marketing packages.
- Insurance description is editable only when insurance is selected and is shown on the saved package card/PDF.
- Adds a dedicated `الباقات` tab to the MZJ Club customer membership page.
- Package categories and active packages are read from the same Marketing package tables; no duplicate catalog is created in Owners.
- Customer selects a category first, then only packages in that category are rendered.
- Package details are grouped as: الإجراءات / العناية بالسيارة / التوصيل.
- No `.patch` / `.diff` files are used.
