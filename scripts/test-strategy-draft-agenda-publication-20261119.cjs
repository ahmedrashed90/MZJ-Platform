'use strict';
// A database-free regression test: publication comes from agenda, never from
// campaign funding, and the campaign editor does not persist publication.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader } = require('./marketing-workflow-test-support.cjs');
const root = path.resolve(__dirname, '..');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const campaignId = uuid(1), agendaId=uuid(2), entryId=uuid(3), itemId=uuid(4), taskId=uuid(5);
const user = { id: uuid(10), permissions: ['marketing.campaign.create', 'marketing.agenda.create', 'marketing.products.view'] };
const drafts = createLoader(root, {
  '../../shared/system-access.js': { hasPermission: () => true },
  '../_access-control.js': { getSystemAccess: () => ({ dataScope: 'all' }) },
  '../_marketing-workflow-schema.js': { marketingStrategyDraftsReady: async () => true },
  '../../shared/marketing-workflow.js': {
    isWorkDate: value => /^20\d{2}-\d\d-\d\d$/.test(String(value)),
    supportsWorkMedia: () => true,
    finalCoverage: () => false,
    workItemReadiness: () => 0,
  },
  '../../shared/marketing-workflow-labels.js': { W: { notFound: 'NOT_FOUND', invalid: 'INVALID', conflict: 'CONFLICT', denied: 'DENIED', saved: 'SAVED' } },
  '../../shared/marketing-publication-timing.js': { saudiCalendarDay: () => '2026-11-19', classifyWorkPublicationTiming: () => null },
})('server/marketing/strategy-drafts.ts');

function mockSql(which, { agendaPublishOn = '2026-12-01' }={}) {
  const calls=[];
  const sql=async (strings,...values)=>{
    const query=strings.join('?').replace(/\s+/g,' ').trim(); calls.push({query,values});
    if(query.startsWith('set local')) return [];
    if(query.includes('from marketing.strategy_plan_drafts where id=') && query.includes('for update')) return [{id:which,kind:which===campaignId?'campaign':'agenda',status:'draft'}];
    if(query.includes('from marketing.strategy_plan_draft_entries') && query.includes('for update')) return [{id:entryId,version:1,target_on:'2026-12-15'}];
    if(query.includes('update marketing.strategy_plan_draft_entries')) return [{version:2}];
    if(query.includes('update marketing.strategy_plan_drafts')) return [];
    if(query.includes('from marketing.strategy_plan_drafts d') && !query.includes('draft_entries')) return [{id:which,kind:which===campaignId?'campaign':'agenda',status:'draft',version:1,name:'Dec',plan_no:null,created_at:'2026-11-19',platform_goals:[],created_by:user.id}];
    if(query.includes('from marketing.strategy_plan_draft_entries e') && query.includes('agenda_link')) {
      assert(query.includes('a.item_id=e.item_id'),'agenda must match the same work item');
      assert(query.includes("ag.kind='agenda'"),'publication must come from an agenda');
      return [{id:entryId,draft_id:which,item_id:itemId,task_id:taskId,idea_code:'IDEA-1',marketing_category:'تعريفي',
        target_on:'2026-12-15',scheduled_on:'2026-12-15', // historical wrong value
        agenda_publish_on:agendaPublishOn,agenda_name:agendaPublishOn?'أجندة ديسمبر':null,agenda_draft_id:agendaPublishOn?agendaId:null,
        platforms:[],version:1,added_at:'2026-11-19',idea_name:'Idea 1',media_kind:'image',item_status:'pending',formats:[],files:[],
        task_no:'TSK-000221',requirement_number:1,due_on:'2026-11-30',task_deleted:false}];
    }
    if(query.includes('from marketing.platform_post_types')) return [];
    throw new Error('Unrecognized mock SQL: '+query);
  };
  sql.begin=fn=>fn(sql);sql.json=value=>value;sql.calls=calls;
  return sql;
}
(async()=>{
  const campaignSql=mockSql(campaignId);
  await drafts.saveStrategyDraftEntryDates(campaignSql,user,{draftId:campaignId,entryId,version:1,fundingOn:'2026-12-20'});
  const campaignUpdate=campaignSql.calls.find(c=>c.query.includes('update marketing.strategy_plan_draft_entries'));
  assert.deepEqual(campaignUpdate.values.slice(0,2),[null,'2026-12-20'],'campaign date save does not write a publication date');
  console.log('PASS: campaign saves funding only, with no publication copy');

  const agendaSql=mockSql(agendaId);
  await drafts.saveStrategyDraftEntryDates(agendaSql,user,{draftId:agendaId,entryId,version:1,scheduledOn:'2026-12-01'});
  const agendaUpdate=agendaSql.calls.find(c=>c.query.includes('update marketing.strategy_plan_draft_entries'));
  assert.deepEqual(agendaUpdate.values.slice(0,2),['2026-12-01','2026-12-01']);
  console.log('PASS: agenda owns and saves publication dates');

  const detail=await drafts.strategyDraftDetail(mockSql(campaignId),user,campaignId);
  assert.equal(detail.draft.ideas[0].publishOn,'2026-12-01');
  assert.equal(detail.draft.ideas[0].fundingOn,'2026-12-15');
  assert.equal(detail.draft.ideas[0].agendaName,'أجندة ديسمبر');
  console.log('PASS: campaign reads linked agenda publication and independent funding');

  const noAgenda=await drafts.strategyDraftDetail(mockSql(campaignId,{agendaPublishOn:null}),user,campaignId);
  assert.equal(noAgenda.draft.ideas[0].publishOn,null);
  assert.equal(noAgenda.draft.ideas[0].fundingOn,'2026-12-15');
  console.log('PASS: no linked agenda is blank instead of mislabeling funding as publication');

  const frontend=fs.readFileSync(path.join(root,'src/marketing/workflow/StrategyDrafts.tsx'),'utf8');
  const css=fs.readFileSync(path.join(root,'src/marketing/workflow/strategyDrafts.css'),'utf8');
  assert(frontend.includes('selected.publishOn ? showDate(selected.publishOn)'));
  assert(frontend.includes('className="mkw-strategy-draft-modal"'));
  assert(!frontend.includes('className="mkw-fullscreen mkw-strategy-draft-modal"'));
  assert(!frontend.includes('footer={draft?.canEdit'));
  assert(css.toLowerCase().includes('no detached fixed footer'));
  console.log('PASS: publication is read-only in campaign and action bar is inside the dialog');
})().catch(error=>{console.error(error); process.exitCode=1;});
