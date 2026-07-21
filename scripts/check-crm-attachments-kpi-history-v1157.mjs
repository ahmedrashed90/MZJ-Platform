import { readFile } from 'node:fs/promises';

const worker = await readFile(new URL('../mersal-worker/src/index.js', import.meta.url), 'utf8');
const workerConfig = await readFile(new URL('../mersal-worker/wrangler.toml', import.meta.url), 'utf8');
const messaging = await readFile(new URL('../server/_crm-messaging.ts', import.meta.url), 'utf8');
const admin = await readFile(new URL('../src/crm/pages/CrmAdminPage.tsx', import.meta.url), 'utf8');
const ownershipApi = await readFile(new URL('../server/crm/ownership.ts', import.meta.url), 'utf8');
const ownershipPage = await readFile(new URL('../src/crm/pages/CrmOwnershipPage.tsx', import.meta.url), 'utf8');
const financeHistory = await readFile(new URL('../src/crm/pages/CrmFinanceHistoryPage.tsx', import.meta.url), 'utf8');
const kpiApi = await readFile(new URL('../server/crm/kpi.ts', import.meta.url), 'utf8');
const kpiPage = await readFile(new URL('../src/crm/pages/CrmKpiPage.tsx', import.meta.url), 'utf8');
const drawer = await readFile(new URL('../src/crm/components/LeadDrawer.tsx', import.meta.url), 'utf8');

const checks = [
  ['Worker version is attachment multipart v1.12.4', worker.includes('mzj-mersal-postgres-v1.12.4-attachment-formdata')],
  ['Worker sends the actual attachment as multipart form-data', worker.includes('new FormData()') && worker.includes('form.set("image", new Blob') && worker.includes('postMersalMultipartProvider')],
  ['Worker attachment endpoint defaults to /api/wpbox/sendmessage', worker.includes('MERSAL_ATTACHMENT_SEND_URL') && worker.includes('`${base}/api/wpbox/sendmessage`') && workerConfig.includes('MERSAL_ATTACHMENT_SEND_URL')],
  ['Platform routes media to the configured media worker endpoint', messaging.includes('endpoint.media_send_url || unifiedWhatsappSendUrl(endpoint)') && admin.includes('مسار إرسال المرفقات')],
  ['Customer chat already uploads and sends the selected attachment asset', drawer.includes('action: "prepare_upload"') && drawer.includes('mediaAssetId') && drawer.includes('type="file"')],
  ['Ownership API avoids the reserved current_user alias', ownershipApi.includes('current_assignee') && !ownershipApi.includes('current_user.full_name')],
  ['Transferred customers filter means all real transfers, not only current user transfers', ownershipApi.includes('mode !== "transferred"') && ownershipApi.includes('e.previous_assigned_to is not null and e.previous_assigned_to is distinct from e.new_assigned_to')],
  ['Ownership page uses the requested label and centered tabs', ownershipPage.includes('عملاء تم نقلهم') && !ownershipPage.includes('عملاء تم نقلهم مني') && ownershipPage.includes('crm-ownership-tabs centered')],
  ['Finance history includes premium summary and centered tabs', financeHistory.includes('crm-finance-history-hero') && financeHistory.includes('crm-finance-history-hero-stats') && financeHistory.includes('crm-finance-history-tabs')],
  ['KPI API carries the old formulas and Friday exclusion', kpiApi.includes('current.getUTCDay() !== 5') && kpiApi.includes('efficiencyRate >= 90 ? 3') && kpiApi.includes('((customerPoints + salesCount) / 80) * 100')],
  ['KPI page includes all five evaluation sections and branch reports', ['speed','efficiency','discipline','value','result'].every((value) => kpiPage.includes(`"${value}"`)) && kpiPage.includes('kpi-branch-report') && kpiPage.includes('FilePdf')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
