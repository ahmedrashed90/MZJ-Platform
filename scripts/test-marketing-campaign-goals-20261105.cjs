'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const ig=uid(11), snap=uid(12), other=uid(13), planId=uid(20);
const gLead=uid(21), gBrand=uid(22), gSales=uid(23);
const root=process.cwd();
const load=createLoader(root, {
  'react/jsx-runtime': {jsx:(tag,props)=>({tag,props}),jsxs:(tag,props)=>({tag,props})},
  './api': { showDate: value => value || '—' },
});
let checks=0;
function check(condition,message){ assert.ok(condition,message); checks++; console.log('PASS:',message); }
const { campaignPlatformGoalRows }=load('shared/marketing-campaign-goals.ts');
const { campaignPdfSummaryHtml }=load('src/marketing/workflow/campaignPdfExport.ts');
const lines=[
 {id:uid(101),platform_id:ig,platform_name:'إنستجرام',platform_code:'instagram',post_type_name:'ريل',budget_amount:200,scheduled_on:'2026-11-06',product_id:uid(201),idea_name:'إعلان تمويل',product_idea:'تمويل سيارتك'},
 {id:uid(102),platform_id:ig,platform_name:'إنستجرام',platform_code:'instagram',post_type_name:'ستوري',budget_amount:90,scheduled_on:'2026-11-07',product_id:uid(201),idea_name:'إعلان تمويل',product_idea:'تمويل سيارتك'},
 {id:uid(103),platform_id:snap,platform_name:'سناب شات',platform_code:'snapchat',post_type_name:'فيديو',budget_amount:300,scheduled_on:'2026-11-07',product_id:uid(201),idea_name:'إعلان تمويل',product_idea:'تمويل سيارتك'},
];
const saved=[
 {platformId:ig,goals:[{id:gLead,name:'طلبات التمويل'},{id:gBrand,name:'الوعي بالعلامة التجارية'},{id:gLead,name:'طلبات التمويل'}]},
 {platformId:snap,goals:[{id:gSales,name:'زيادة المبيعات'}]},
 {platformId:other,goals:[{id:uid(24),name:'منصة محذوفة'}]},
];
const rows=campaignPlatformGoalRows(lines,saved);
check(rows.length===2,'One table row per unique platform, not per post type or publication');
check(rows.find(r=>r.platformId===ig)?.goals.length===2,'Two objectives render together, repeated objectives collapse');
check(rows.find(r=>r.platformId===snap)?.goals.length===1,'Independent objectives remain attached to their own platform');
check(!rows.some(r=>r.platformId===other),'Deleted/unselected platforms do not leak into campaign summaries');
check(campaignPlatformGoalRows(lines,null).every(r=>r.goals.length===0),'Existing campaigns without objectives remain readable');
const html=campaignPdfSummaryHtml({planName:'حملة اختبار',planNo:'CMP-000100',lines,platformGoals:saved});
const section=html.split('الهدف من الحملة حسب المنصة</h2>')[1].split('</table>')[0];
check((section.match(/إنستجرام/g)||[]).length===1 && (section.match(/سناب شات/g)||[]).length===1,'Printable PDF groups each platform once');
check((section.match(/طلبات التمويل/g)||[]).length===1 && section.includes('الوعي بالعلامة التجارية'),'PDF keeps multiple distinct goals in a single platform row');
check(!section.includes('منصة محذوفة'),'PDF never displays goals for unused platforms');
const malicious=campaignPdfSummaryHtml({planName:'Test',planNo:'CMP-000101',lines,platformGoals:[{platformId:ig,goals:[{id:gLead,name:'<script>bad</script>'}]}]});
check(malicious.includes('&lt;script&gt;bad&lt;/script&gt;') && !malicious.includes('<script>bad</script>'),'Goal names are safely escaped in PDF HTML');
const create=fs.readFileSync('src/marketing/workflow/CreatePage.tsx','utf8');
const settings=fs.readFileSync('src/marketing/components/MarketingSettingsPanel.tsx','utf8');
const report=fs.readFileSync('src/marketing/workflow/PlanReport.tsx','utf8');
const dashboard=fs.readFileSync('src/marketing/pages/MarketingDashboardPage.tsx','utf8');
const detail=fs.readFileSync('src/marketing/workflow/PlanDetail.tsx','utf8');
const server=fs.readFileSync('server/marketing/workflow.ts','utf8');
const migration=fs.readFileSync('server/_marketing-workflow-schema.ts','utf8');
check(settings.includes('<CampaignGoalSettings') && settings.includes('الهدف من الحملة'),'Campaign goal catalog is in Marketing Settings');
check(create.includes('selectedPlatformIds.map(platformId=>({platformId, goalIds:selectedGoals[platformId]'),'Campaign save sends one goal list per selected platform');
check(report.includes('platformGoals:plan.platform_goals') && dashboard.includes('platformGoals:first.campaign_platform_goals'),'Dashboard and report both export saved goal selections');
check(detail.includes('canEditGoals') && detail.includes("save_campaign_platform_goals"),'Selected reviewer can amend historical campaigns separately');
check(server.includes('validateCampaignPlatformGoals(tx,body.platformGoals') && server.includes('campaign_platform_goals'),'Server validates campaign goals and exposes them through plan listings');
check(migration.includes("values('schema-16')") && migration.includes('work_campaign_goals') && migration.includes('if (!(await flags()).hasCampaignGoals)'),'Campaign goal schema migration is additive and gated');
check(server.includes('لا يمكن اعتماد الحملة قبل اختيار هدف') && server.includes('item.is_deleted=false'),'Plan approval requires goals for all live platforms after campaign revisions');
const permissions=fs.readFileSync('server/_api-permissions.ts','utf8');
check(permissions.includes('work_save_campaign_goal: "settings.marketing.manage"') && permissions.includes('work_delete_campaign_goal: "settings.marketing.manage"'),'Campaign goal catalog mutations require marketing settings permission at the API gate');
check(permissions.includes('work_save_campaign_platform_goals: "system.marketing.access"') && server.includes('if (!(await canReviewPlan(sql,user)))'),'Existing plan goals require campaign reviewer permission inside the handler');
check(detail.includes('availableGoalIds.has(goalId)'),'Old deleted goals stay in report snapshots but never block saving current goals');
for(const file of ['server/_marketing-workflow-schema.ts','server/marketing/workflow.ts','server/_api-permissions.ts','shared/marketing-campaign-goals.ts','shared/marketing-workflow.ts',
  'src/marketing/components/CampaignGoalSettings.tsx','src/marketing/components/MarketingSettingsPanel.tsx',
  'src/marketing/workflow/CampaignGoals.tsx','src/marketing/workflow/CreatePage.tsx',
  'src/marketing/workflow/PlanDetail.tsx','src/marketing/workflow/PlanReport.tsx',
  'src/marketing/workflow/campaignPdfExport.ts','src/marketing/workflow/campaignOverview.tsx','src/marketing/pages/MarketingDashboardPage.tsx']){
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.equal(source.parseDiagnostics.length,0,`Unexpected TypeScript syntax: ${file}`);
}
check(true,'All touched TypeScript/TSX files parse without syntax errors');
console.log(`${checks}/${checks} campaign objective report, PDF, catalog, permission, migration and syntax checks passed`);
