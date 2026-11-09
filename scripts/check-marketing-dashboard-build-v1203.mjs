import fs from 'node:fs';
import assert from 'node:assert/strict';
const dashboard=fs.readFileSync('src/marketing/pages/MarketingDashboardPage.tsx','utf8');
assert(dashboard.includes('WorkTask[]'));
assert(dashboard.includes('new Map<string, WorkPlanLine[]>()'));
console.log('PASS: dashboard task rows and publication groups have explicit types');
