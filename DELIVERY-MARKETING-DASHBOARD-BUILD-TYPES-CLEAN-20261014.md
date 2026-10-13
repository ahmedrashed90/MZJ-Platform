# MZJ | Clean integrated marketing dashboard build correction

## Root cause
The Vercel TypeScript build failed with TS2345 at `src/marketing/pages/MarketingDashboardPage.tsx` because `WorkPlanLine.platform_code` can be `string | null | undefined`, and `Array.includes` requires `string`.

## Integrated correction
- The shared `workPlatformSupportsAutoPublish` helper explicitly recognizes Facebook, Instagram and YouTube only when a non-null string platform code is present.
- The marketing dashboard reads publishing support through the helper. Missing or unsupported codes disable activation without crashing the build or changing saved schedules.
- Added regression tests for `undefined`, `null`, unsupported and supported platform codes.
- All other files come from the previous full CLEAN source; no patch module or alternate implementation is shipped.

## Offline checks
- 108/108 `typecheck` script commands preceding `tsc -b` passed.
- 86/86 workflow tests passed (mocked DB/provider, not live).
- 303 TS/TSX source files parsed with no syntax errors.
- The shared workflow module and a typed dashboard-style call to the helper pass strict `tsc --noEmit` type validation.

## Build/deployment scope
A full `pnpm run build` could not be executed locally because the project dependency tree (React/Vite and its other packages) is not installed and registry download is unavailable. Run `pnpm install --frozen-lockfile` and `pnpm run build` on Vercel to validate the production bundle. No database changes or migrations are needed for this TypeScript correction. No changes were made to other systems or live data.
