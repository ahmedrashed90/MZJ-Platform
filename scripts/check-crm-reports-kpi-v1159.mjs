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
const packageVersion = JSON.parse(pkg).version;

const checks = [
  ['Package version includes the CRM reports release', packageVersion.localeCompare('1.15.9', undefined, { numeric: true }) >= 0],
  ['Ownership page route remains removed', !app.includes('CrmOwnershipPage') && !app.includes('path="ownership"')],
  ['Ownership navigation remains removed', !layout.includes('/crm/ownership') && !layout.includes('سجل ملكية العملاء')],
  ['Ownership dedicated API remains removed', !api.includes('crmOwnershipHandler') && !api.includes('["crm/ownership"')],
  ['Browser voice recording is available through the existing attachment flow', drawer.includes('MediaRecorder') && drawer.includes('startVoiceRecording') && drawer.includes('crm-voice-record-button') && styles.includes('crm-voice-record-button')],
  ['Existing attachment upload remains available', drawer.includes('uploadPendingFile') && drawer.includes('crm-attachment-button') && drawer.includes('mediaTypeForFile')],
  ['Reports show requested count labels', reports.includes('إجمالي المصادر') && reports.includes('إجمالي الأقسام والفروع') && reports.includes('إجمالي المناديب')],
  ['Report sales totals are calculated from sold', reports.includes('sum + Number(row.sold || 0)') && reports.includes('إجمالي المبيعات')],
  ['Customer report popup exports all filtered rows to PDF', reports.includes('exportPopupPdf') && reports.includes('detailPageSize: 200') && reports.includes('جاري تجهيز PDF')],
  ['KPI PDF actions are centered', styles.includes('justify-content:center') && styles.includes('.kpi-pdf-actions')],
  ['Each KPI PDF target has dedicated content', kpi.includes('const sections: Record<ModalTab, string>') && kpi.includes('target === "all"') && kpi.includes('تفاصيل السرعة') && kpi.includes('تفاصيل الكفاءة') && kpi.includes('تفاصيل الانضباط') && kpi.includes('تفاصيل القيمة')],
  ['KPI print layout starts content on the first page', kpi.includes('class="report-head"') && kpi.includes('break-inside:auto;page-break-inside:auto') && !kpi.includes('class="cover"')],
  ['Attachment action is compact and writing area is larger', styles.includes('width:96px') && styles.includes('min-height:210px') && drawer.includes('accept="image/*,video/*,.pdf,application/pdf"')],
  ['Readable bold typography is integrated in canonical styles', styles.includes('font-size: 15px;') && styles.includes('font-weight: 700;') && styles.includes('.crm-table { width: 100%;')],
  ['Finance history layout remains unchanged', finance.includes('crm-finance-history-head-clean') && finance.includes('crm-finance-history-filter-row')],
];

let ownershipPageExists = true;
let ownershipApiExists = true;
try { await access(new URL('../src/crm/pages/CrmOwnershipPage.tsx', import.meta.url), constants.F_OK); } catch { ownershipPageExists = false; }
try { await access(new URL('../server/crm/ownership.ts', import.meta.url), constants.F_OK); } catch { ownershipApiExists = false; }
checks.push(['Ownership page and dedicated handler files remain deleted', !ownershipPageExists && !ownershipApiExists]);

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
if (failed.length) process.exit(1);
