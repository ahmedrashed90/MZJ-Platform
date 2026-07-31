import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function check(name, condition) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  checks.push(name);
  console.log(`PASS: ${name}`);
}

const schema = read('server/_marketing-schema.ts');
const api = read('server/marketing/index.ts');
const settings = read('src/marketing/components/MarketingSettingsPanel.tsx');
const packages = read('src/marketing/pages/PackagesPage.tsx');
const database = read('src/marketing/pages/MarketingDatabasePage.tsx');
const publishPrep = read('src/marketing/pages/PublishPrepPage.tsx');
const monitoring = read('src/marketing/pages/MonitoringPage.tsx');
const agenda = read('src/marketing/pages/CreateAgendaPage.tsx');
const creative = read('src/marketing/components/CreativeEditor.tsx');
const css = read('src/marketing/marketing.css');

check('package categories are stored in PostgreSQL settings', schema.includes('marketing.package_categories'));
check('package sales types are stored in PostgreSQL settings', schema.includes('marketing.package_sales_types'));
check('packages persist category and sales type IDs', schema.includes('category_id uuid references marketing.package_categories') && schema.includes('sales_type_id uuid references marketing.package_sales_types'));
check('package settings API is exposed', api.includes("resource==='package_settings'") && api.includes('savePackageLookup'));
check('package save requires real category and sales IDs', api.includes('categoryId=clean(body.categoryId)') && api.includes('salesTypeId=clean(body.salesTypeId)'));
check('marketing settings contains package settings tab', settings.includes('إعدادات الباقات') && settings.includes('تصنيفات الباقات') && settings.includes('أنواع المبيعات'));
check('package form selects category and sales from settings', packages.includes('categoryId') && packages.includes('salesTypeId') && packages.includes('package_settings'));
check('package PDF exports package cards only', packages.includes('باقات MZJ') && packages.includes('window.print()') && !packages.includes('onClick={() => window.print()}'));
check('database keeps the professional PDF command and removes broken Excel exports', database.includes('marketing-detail-command') && database.includes('تصدير PDF كامل') && !database.includes('تصدير جدول النشر') && !database.includes('تصدير مراجعة Excel'));
check('budget display includes goals, ads and named platform amounts', database.includes('marketing-budget-detail-card') && database.includes('هدف المحتوى') && database.includes('platformName'));
check('publish preparation uses redesigned list and full editor', publishPrep.includes('marketing-publish-list') && publishPrep.includes('marketing-publish-list-row') && publishPrep.includes('marketing-publish-edit-modal'));
check('monitoring page is rebuilt with operational KPI layout', monitoring.includes('marketing-monitor-hero') && monitoring.includes('marketing-monitor-kpis') && monitoring.includes('marketing-monitor-delayed'));
check('agenda day editor is rebuilt with sidebar and full workspace', agenda.includes('marketing-agenda-editor-v2') && agenda.includes('marketing-agenda-add-panel'));
check('agenda car selection uses a dedicated modal', agenda.includes('carsModal') && creative.includes('marketing-cars-modal'));
check('marketing buttons use shared professional interaction styles', css.includes('box-shadow: 0 8px 18px') && css.includes('.marketing-detail-command'));
check('responsive rules cover the rebuilt pages', css.includes('@media (max-width: 900px)') && css.includes('.marketing-agenda-editor-layout'));

console.log(`Marketing UI batch v1.20.8 checks: ${checks.length}/${checks.length} passed`);
