import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [app, layout, api, kpi, reports, finance, drawer, styles, pkg] = await Promise.all([
  read('src/App.tsx'),
  read('src/crm/CrmLayout.tsx'),
  read('api/index.ts'),
  read('src/crm/pages/CrmKpiPage.tsx'),
  read('src/crm/pages/CrmReportsPage.tsx'),
  read('src/crm/pages/CrmFinanceHistoryPage.tsx'),
  read('src/crm/components/LeadDrawer.tsx'),
  read('src/styles.css'),
  read('package.json'),
]);

const checks = [
  ['Version is 1.15.8', pkg.includes('"version": "1.15.8"')],
  ['Ownership page route removed', !app.includes('CrmOwnershipPage') && !app.includes('path="ownership"')],
  ['Ownership navigation removed', !layout.includes('/crm/ownership') && !layout.includes('سجل ملكية العملاء')],
  ['Ownership dedicated API removed', !api.includes('crmOwnershipHandler') && !api.includes('["crm/ownership"')],
  ['KPI uses a full-screen evaluation workspace', kpi.includes('kpi-fullscreen-dialog') && kpi.includes('kpi-fullscreen-content')],
  ['KPI agent names are emphasized', kpi.includes('kpi-agent-cell') && kpi.includes('kpi-report-agent-name')],
  ['KPI preserves old three-band thresholds', kpi.includes('n >= 80 ? "good" : n >= 50 ? "mid" : "bad"')],
  ['Reports use professional grouped filters', reports.includes('crm-reports-filters-pro') && reports.includes('crm-report-filter-row-primary')],
  ['Report customer and row names are bold', reports.includes('crm-report-row-name') && reports.includes('crm-report-customer-name')],
  ['Finance history uses a neutral header and separated filter rows', finance.includes('crm-finance-history-head-clean') && finance.includes('crm-finance-history-filter-row')],
  ['Native voice recording uses MediaRecorder', drawer.includes('new MediaRecorder') && drawer.includes('startVoiceRecording') && drawer.includes('تسجيل فويس')],
  ['Voice recording becomes an audio attachment through the existing media flow', drawer.includes('setPendingFile(new File') && drawer.includes('mediaTypeForFile')],
  ['Styles define the exact three KPI tones', styles.includes('#d9f8e5') && styles.includes('#fff0b8') && styles.includes('#ffe0e3')],
];

let ownershipPageExists = true;
let ownershipApiExists = true;
try { await access(new URL('../src/crm/pages/CrmOwnershipPage.tsx', import.meta.url), constants.F_OK); } catch { ownershipPageExists = false; }
try { await access(new URL('../server/crm/ownership.ts', import.meta.url), constants.F_OK); } catch { ownershipApiExists = false; }
checks.push(['Ownership page and dedicated handler files deleted', !ownershipPageExists && !ownershipApiExists]);

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
if (failed.length) process.exit(1);
