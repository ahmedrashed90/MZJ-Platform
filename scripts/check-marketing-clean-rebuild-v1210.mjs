import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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
const packages = read('src/marketing/pages/PackagesPage.tsx');
const settings = read('src/marketing/components/MarketingSettingsPanel.tsx');
const campaign = read('src/marketing/pages/CreateCampaignPage.tsx');
const agenda = read('src/marketing/pages/CreateAgendaPage.tsx');
const creative = read('src/marketing/components/CreativeEditor.tsx');
const dashboard = read('src/marketing/pages/MarketingDashboardPage.tsx');
const css = read('src/marketing/marketing.css');

check('Package category lookup table exists', schema.includes('marketing.package_categories'));
check('Package sales lookup table exists', schema.includes('marketing.package_sales_types'));
check('Packages store category and sales IDs', schema.includes('category_id uuid') && schema.includes('sales_type_id uuid'));
check('Package options are read from API', api.includes("resource==='package_options'") && api.includes('packageOptions(sql)'));
check('Package option add/edit/delete API exists', api.includes('savePackageOption') && api.includes('deletePackageOption'));
check('Package save requires configured category and sales type', api.includes('categoryId') && api.includes('salesTypeId') && api.includes('اسم الباقة والتصنيف والمبيعات مطلوبة'));
check('Package page loads settings-based options', packages.includes('resource: "package_options"') && packages.includes('salesTypeId'));
check('Package PDF exports package cards only', packages.includes('exportPackagesPdf') && packages.includes('<main class="packages">') && !packages.includes('onClick={() => window.print()}'));
check('Marketing settings include package options tab', settings.includes('package_options') && settings.includes('تصنيفات الباقات') && settings.includes('أنواع المبيعات'));
check('Campaign budget editor is structured', campaign.includes('marketing-budget-editor') && campaign.includes('marketing-budget-platforms'));
check('Campaign schedule uses publishing period and day editor', campaign.includes('marketing-publishing-days') && campaign.includes('marketing-publishing-day-form') && campaign.includes('saveScheduleItem'));
check('Agenda day editor is full workflow', agenda.includes('marketing-agenda-day-editor') && agenda.includes('marketing-agenda-add-creative'));
check('Agenda car picker uses dedicated modal', agenda.includes('carsModal') && creative.includes('marketing-car-modal-backdrop'));
check('Dashboard shows move-to-publishing action at 100%', dashboard.includes('moveToPublishing') && dashboard.includes('نقل إلى قسم النشر'));
check('Backend blocks publishing before 100%', api.includes('لا يمكن النقل إلى قسم النشر قبل اكتمال الجاهزية بنسبة 100%'));
check('Progress recalculation preserves publishing status', api.includes("status in ('publishing','archived')"));
check('Publishing card renders moved entities', dashboard.includes('publishingEntities') && dashboard.includes('marketing-publishing-card'));
check('New layout CSS exists without inline patch files', css.includes('.marketing-publishing-schedule-layout') && css.includes('.marketing-agenda-day-editor') && css.includes('.marketing-package-options-grid'));

const modifiedTs = [
  'src/marketing/pages/CreateCampaignPage.tsx',
  'src/marketing/pages/CreateAgendaPage.tsx',
  'src/marketing/pages/PackagesPage.tsx',
  'src/marketing/pages/MarketingDashboardPage.tsx',
  'src/marketing/components/MarketingSettingsPanel.tsx',
  'src/marketing/components/CreativeEditor.tsx',
  'server/marketing/index.ts',
  'server/_marketing-schema.ts',
];
for (const file of modifiedTs) {
  const source = read(file);
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const errors = (result.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  check(`TypeScript syntax: ${file}`, errors.length === 0);
}

console.log(`Marketing clean rebuild checks passed: ${checks.length}/${checks.length}`);
