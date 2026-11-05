'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts = require('typescript');
const compiled=ts.transpileModule(fs.readFileSync('src/marketing/workflow/PlanDetail.tsx','utf8'),{
  fileName:'PlanDetail.tsx',reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
assert.equal(compiled.diagnostics?.length||0,0);
const jsx=(type,props)=>({type,props:props||{}});
const GoalPicker=()=>null;
function walk(node,fn){if(Array.isArray(node))return node.forEach(n=>walk(n,fn));if(!node||typeof node!=='object')return;fn(node);walk(node.props?.children,fn);}
function find(node,test){const hits=[];walk(node,n=>{if(test(n))hits.push(n);});return hits;}
function hooks(){const values=[],deps=[];let pos=0,eff=0;const queued=[];
  return {useState(initial){const i=pos++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];},
    useEffect(callback,current){const i=eff++;if(!deps[i]||!current||deps[i].some((v,k)=>v!==current[k])){deps[i]=current;queued.push(callback);}},
    render(){pos=0;eff=0;},commit(){queued.splice(0).forEach(cb=>cb());}};
}
async function scenario(kind,role){
  const state=hooks(),calls=[];
  const isReviewer=role==='reviewer'||role==='goalsReviewer',goalReviewer=role==='goalsReviewer',plan={id:'id',plan_no:'CMP-0001',name:'Example',kind,created_by:'creator',creator_name:'Creator',created_at:'2026-11-02',
    review_status:isReviewer?'in_progress':'revision',review_note:isReviewer?'':'Please update funding dates',review_revision:isReviewer?0:1,
    status:isReviewer?'in_progress':'revision',readiness:0,canReview:isReviewer,canEditGoals:goalReviewer,canEdit:!isReviewer,canEditFunding:!isReviewer&&kind==='campaign',canEditAgendaWindow:!isReviewer&&kind==='agenda',
    funding_from:'2026-11-02',funding_to:null,agenda_from:'2026-11-02',agenda_to:'2026-11-09',canSaveLinks:false};
  const data={plan,lines:goalReviewer?[{platform_id:'platform-ig',platform_name:'Instagram'},{platform_id:'platform-sn',platform_name:'Snapchat'},{platform_id:'platform-ig',platform_name:'Instagram'}]:[],history:[]},query={data,error:'',loading:false,reload:async()=>data};
  const mods={react:state,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
    '../../components/Modal':{Modal:function Modal(){}},'./components':{W:{invalid:'Invalid',loading:'Loading',noData:'Empty'},Empty:()=>{},WorkAlert:()=>{}},
    '../../../shared/marketing-review-note-format':{parseReviewNote:()=>[]},
    './api':{showDate:String,useWorkQuery:resource=>resource==='plan'?query:{data:resource==='campaign_goal_settings'?{goals:[{id:'goal-one',name:'زيادة المبيعات'},{id:'goal-two',name:'طلبات التمويل'}],migrationRequired:false}:{categories:[],rows:[],postTypes:[],platforms:[]},reload:async()=>{}},workPost:async(action,payload)=>{calls.push({action,payload});return{ok:true};}},
    './planComposer':{availablePlanPostTypes:()=>[]},'./PlanStatus':{PlanStatusBadges:()=>{},planStateLabels:{in_progress:'Draft'}},'./campaignOverview':{CampaignOverview:()=>{}},
    './CampaignGoals':{CampaignGoalPicker:GoalPicker},'./ProductReference':{ProductReference:()=>null},'../../../shared/marketing-campaign-goals':{campaignPlatformGoalRows:lines=>[...new Map(lines.map(row=>[row.platform_id,{platformId:row.platform_id,platformName:row.platform_name,goals:[]}])).values()]},
    '../../../shared/marketing-workflow':{isWorkDate:date=>/^\d{4}-\d{2}-\d{2}$/.test(date)}};
  const out={exports:{}};new Function('require','module','exports',compiled.outputText)(n=>{if(n in mods)return mods[n];throw Error('Missing mock '+n);},out,out.exports);
  function render(){state.render();const v=out.exports.PlanDetail({id:'id',onClose:()=>{},onChanged:()=>{}});state.commit();return v;}
  render();let view=render();
  if(goalReviewer){
    const edit=find(view,n=>n.type==='button'&&n.props.children==='اختيار المنصات والأهداف')[0];
    assert(edit,'Campaign reviewer must see goal editor');edit.props.onClick();
    view=render();
    const goalFields=find(view,n=>n.type===GoalPicker);
    assert.equal(goalFields.length,2,'One objective picker per unique live platform, even with duplicate publishing lines');
    goalFields.find(field=>field.props.platformName==='Instagram').props.onChange(['goal-one','goal-two']);
    goalFields.find(field=>field.props.platformName==='Snapchat').props.onChange(['goal-one']);
    view=render();
    const save=find(view,n=>n.type==='button'&&n.props.children==='حفظ أهداف الحملة')[0];
    assert(save,'Reviewer must see save goals control');save.props.onClick();await new Promise(r=>setImmediate(r));
    assert.equal(calls.length,1);assert.equal(calls[0].action,'save_campaign_platform_goals');
    assert.equal(calls[0].payload.platformGoals.length,2);
    assert.deepEqual(calls[0].payload.platformGoals.find(row=>row.platformId==='platform-ig').goalIds,['goal-one','goal-two']);
    assert.deepEqual(calls[0].payload.platformGoals.find(row=>row.platformId==='platform-sn').goalIds,['goal-one']);
  }else if(isReviewer){
    const note=find(view,n=>n.type==='textarea')[0];assert(note);note.props.onChange({target:{value:'Please revise funding dates'}});
    view=render();
    const request=find(view,n=>n.type==='button'&&String(n.props.children).includes('\u0637\u0644\u0628 \u0627\u0644\u062a\u0639\u062f\u064a\u0644')&&n.props.onClick)[0];assert(request);
    assert.equal(find(view,n=>n.type==='input'&&n.props['aria-label']==='\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u062a\u0645\u0648\u064a\u0644 \u0645\u0646 \u0645\u0639 \u0637\u0644\u0628 \u0627\u0644\u062a\u0639\u062f\u064a\u0644').length,0);
    request.props.onClick();await new Promise(r=>setImmediate(r));
    assert.equal(calls.length,1);assert.equal(calls[0].action,'plan_review');assert.equal(calls[0].payload.decision,'revision');
    assert.equal(calls[0].payload.updateFunding,undefined);assert.equal(calls[0].payload.fundingFrom,undefined);
  }else if(kind==='campaign'){
    assert.equal(find(view,n=>n.type==='textarea').length,0);
    const from=find(view,n=>n.type==='input'&&n.props['aria-label']==='\u062a\u0639\u062f\u064a\u0644 \u062a\u0627\u0631\u064a\u062e \u0627\u0644\u062a\u0645\u0648\u064a\u0644 \u0645\u0646')[0];
    const to=find(view,n=>n.type==='input'&&n.props['aria-label']==='\u062a\u0639\u062f\u064a\u0644 \u062a\u0627\u0631\u064a\u062e \u0627\u0644\u062a\u0645\u0648\u064a\u0644 \u0625\u0644\u0649')[0];assert(from&&to);
    from.props.onChange({target:{value:'2026-11-03'}});to.props.onChange({target:{value:'2026-11-08'}});
    view=render();
    const save=find(view,n=>n.type==='button'&&n.props.onClick&&String(n.props.children).includes('\u0625\u0631\u0633\u0627\u0644\u0647\u0627'))[0];assert(save);
    save.props.onClick();await new Promise(r=>setImmediate(r));
    assert.equal(calls.length,1);assert.equal(calls[0].action,'update_plan_funding');
    assert.equal(calls[0].payload.fundingFrom,'2026-11-03');assert.equal(calls[0].payload.fundingTo,'2026-11-08');
  }else{
    assert.equal(find(view,n=>n.type==='input'&&String(n.props['aria-label']||'').includes('\u0627\u0644\u062a\u0645\u0648\u064a\u0644')).length,0);
    const from=find(view,n=>n.type==='input'&&n.props['aria-label']==='تعديل تاريخ نشر الأجندة من')[0];
    const to=find(view,n=>n.type==='input'&&n.props['aria-label']==='تعديل تاريخ نشر الأجندة إلى')[0];
    assert(from&&to,'Agenda creator should be able to edit agenda period');
    from.props.onChange({target:{value:'2026-11-03'}});
    to.props.onChange({target:{value:'2026-11-10'}});
    view=render();
    const save=find(view,n=>n.type==='button'&&String(n.props.children).includes('حفظ فترة الأجندة')&&n.props.onClick)[0];
    assert(save,'Agenda creator save date button');
    save.props.onClick();await new Promise(r=>setImmediate(r));
    assert.equal(calls.length,1);
    assert.equal(calls[0].action,'update_plan_agenda_window');
    assert.equal(calls[0].payload.agendaFrom,'2026-11-03');
    assert.equal(calls[0].payload.agendaTo,'2026-11-10');
  }
}
(async()=>{
  await scenario('campaign','goalsReviewer');console.log('PASS: campaign reviewer assigns multiple goals to existing plan platforms without duplicates');
  await scenario('campaign','reviewer');console.log('PASS: configured reviewer requests revision without editing dates');
  await scenario('agenda','reviewer');console.log('PASS: agenda reviewer sends note without funding controls');
  await scenario('campaign','creator');console.log('PASS: creator changes funding dates for revised campaign');
  await scenario('agenda','creator');console.log('PASS: agenda creator edits agenda publication dates without campaign funding controls');
  console.log('5/5 plan-review separation and historical campaign goal checks passed');
})().catch(err=>{console.error(err);process.exitCode=1;});
