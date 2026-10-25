/** Isolated, dependency-free structural checks for the MZJ lead forms addition. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const app = read('src/App.tsx');
const nav = read('src/marketing/MarketingLayout.tsx');
const formAdmin = read('src/marketing/lead-forms/LeadFormsPage.tsx');
const renderer = read('src/marketing/lead-forms/LeadFormRenderer.tsx');
const publicPage = read('src/marketing/lead-forms/PublicLeadFormPage.tsx');
const handler = read('server/marketing/lead-forms.ts');
const catalog = read('shared/access-control.ts');
const catalogSql = read('server/_access-control-schema.ts');
const schema = read('database/migrations/20261025_marketing_lead_forms.sql');
const schemaRuntime = read('server/_marketing-lead-forms-schema.ts');
const templates = read('shared/lead-forms.ts');
const css = read('src/marketing/lead-forms/lead-forms.css');
const api = read('api/index.ts');

const checks = [
  ['Marketing tab and existing layout', nav.includes('فورم المنصات') && nav.includes('/marketing/lead-forms')],
  ['Private marketing route with permission', app.includes('marketing.lead_forms.view') && app.includes('<MarketingLeadFormsPage />')],
  ['Public form route before global loading/login', app.indexOf('if (isPublicLeadForm)') < app.indexOf('if (loading)') && app.includes('path="/forms/:slug"')],
  ['API handler registered', api.includes('marketingLeadFormsHandler') && api.includes('["marketing/lead-forms", marketingLeadFormsHandler]')],
  ['All 8 admin sections', ['dashboard','library','builder','manage','leads','reports','sheets','settings'].every(s => formAdmin.includes(`id:'${s}'`))],
  ['Preview never calls lead API', renderer.includes('if(preview || !form.slug)return;') && renderer.includes('if(preview){setDone(true);return;}')],
  ['Responsive customer form', css.includes('@media(max-width:760px)') && css.includes('100dvh') && css.includes('direction:rtl') && css.includes("font-family:'Tajawal'")],
  ['Only new marketing lead form tables', ['marketing.lead_forms','marketing.form_visits','marketing.form_step_events','marketing.form_leads'].every(s => schema.includes(`create table if not exists ${s}`)) && !/alter table (crm|operations|tracking)\./i.test(schema)],
  ['Runtime schema syncs SQL migration', schemaRuntime.includes('const FORM_SCHEMA_SQL = String.raw`') && schemaRuntime.includes('marketing_form_leads_ip_rate_idx')],
  ['Access catalog includes form permissions', ['marketing.lead_forms.view','marketing.lead_forms.create','marketing.lead_forms.edit','marketing.lead_forms.publish','marketing.lead_forms.leads.view','marketing.lead_forms.leads.export','marketing.lead_forms.reports.view','marketing.lead_forms.sheets.manage'].every(s=>catalog.includes(s)&&catalogSql.includes(s))],
  ['Six starter templates', ['steps','visual','chat','quiz','minimal','classic'].every(t=>templates.includes(`id: '${t}'`))],
  ['Campaign UTM attribution', formAdmin.includes('utm_source') && formAdmin.includes('utm_campaign') && renderer.includes('utm_campaign') && handler.includes('form_visits')],
  ['Published snapshot is separate from draft', handler.includes('published_config=config') && handler.includes('published_metadata=') && handler.includes('row.published_config || row.config')],
  ['Stored real leads and visits', handler.includes('insert into marketing.form_leads') && handler.includes('insert into marketing.form_visits') && handler.includes('marketing.form_step_events')],
  ['Sheet integration optional and server-side only', handler.includes('MZJ_GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON') && !renderer.includes('MZJ_GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON')],
  ['Public page fetch by slug', publicPage.includes('view=public&slug=')],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok?'PASS':'FAIL'} ${name}`);
  if (!ok) failed++;
}
assert.equal(failed, 0, `${failed} lead form checks failed`);
console.log(`MZJ marketing lead forms: ${checks.length}/${checks.length} structural checks passed.`);
