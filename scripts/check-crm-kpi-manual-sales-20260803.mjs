import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [page, api, dataManagement, schema] = await Promise.all([
  read('src/crm/pages/CrmKpiPage.tsx'),
  read('server/crm/kpi.ts'),
  read('server/data-management.ts'),
  read('server/_crm-schema.ts'),
]);

const checks = [
  ['KPI API no longer calculates sales from sold CRM leads or ERP orders',
    !api.includes('calculated_sales')
      && !api.includes("l.status_label='تم البيع'")
      && !api.includes('ensureErpNextSalesOrderSchema')],
  ['KPI list displays the manually entered daily sales total only',
    page.includes('{Math.round(result.salesCount)}')
      && page.includes('return sum + number(calc.salesCount);')
      && !page.includes('calculated_sales')],
  ['Representative grade remains calculated only from saved KPI details',
    page.includes('{Math.round(result.totalPoints)}')
      && page.includes('const details = normalizeDetails(row?.details')],
  ['Full test-data reset now clears KPI evaluations',
    dataManagement.includes('"crm.kpi_evaluations"')
      && dataManagement.includes('وتقييمات KPI فقط')],
  ['Existing stale KPI evaluations are aligned with the latest explicit test-data reset',
    schema.includes('crm-kpi-manual-sales-reset-alignment-20260803')
      && schema.includes("where action='test_data_reset'")
      && schema.includes('delete from crm.kpi_evaluations')
      && schema.includes('where updated_at < latest_test_reset')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
if (failed.length) process.exit(1);
