'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=(()=>{try{return require('typescript');}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');}})();
const src=fs.readFileSync('src/marketing/workflow/PlanDetail.tsx','utf8');
const compiled=ts.transpileModule(src,{fileName:'PlanDetail.tsx',reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
assert.equal(compiled.diagnostics?.length||0,0);
const jsx=(type,props)=>({type,props:props||{}});
const jsxRuntime={jsx,jsxs:jsx,Fragment:'Fragment'};
function walk(node,fn){if(Array.isArray(node))return node.forEach(item=>walk(item,fn));if(!node||typeof node!=='object')return;fn(node);walk(node.props?.children,fn);}
function find(node,test){const hits=[];walk(node,x=>{if(test(x))hits.push(x);});return hits;}
function makeHooks(){const values=[],deps=[];let pos=0,eff=0;const queued=[];
  return {useState(initial){const i=pos++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];},
  useEffect(callback,current){const i=eff++;if(!deps[i]||!current||deps[i].some((value,k)=>value!==current[k])){deps[i]=current;queued.push(callback);}},
  render(){pos=0;eff=0;},commit(){queued.splice(0).forEach(cb=>cb());}};
}
async function scenario(kind,editFunding){
  const hooks=makeHooks(), calls=[],plan={id:'id',plan_no:'CMP-0001',name:'تجربة',kind,created_by:'creator',creator_name:'منشئ الحملة',created_at:'2026-11-02',review_status:'in_progress',review_note:'',review_revision:0,status:'in_progress',readiness:0,canReview:true,canEdit:false,canEditFunding:kind==='campaign',funding_from:'2026-11-02',funding_to:null,canSaveLinks:false};
  const data={plan,lines:[],history:[]};
  const query={data,loading:false,error:'',reload:async()=>data};
  const mods={react:hooks,'react/jsx-runtime':jsxRuntime,
    '../../components/Modal':{Modal:function Modal(){}},
    './components':{W:{invalid:'غير صالح',loading:'جار التحميل',noData:'فارغ'},Empty:()=>{},WorkAlert:()=>{}},
    '../../../shared/marketing-review-note-format':{parseReviewNote:()=>[]},
    './api':{showDate:String,useWorkQuery:resource=>resource==='plan'?query:{data:{categories:[],rows:[],postTypes:[],platforms:[]},reload:async()=>{}},workPost:async(action,payload)=>{calls.push({action,payload});return{ok:true};}},
    './planComposer':{availablePlanPostTypes:()=>[]},
    './PlanStatus':{PlanStatusBadges:()=>{},planStateLabels:{in_progress:'قيد التنفيذ'}},
    './campaignOverview':{CampaignOverview:()=>{}},
    '../../../shared/marketing-workflow':{isWorkDate:date=>/^\d{4}-\d{2}-\d{2}$/.test(date)},
  };
  const out={exports:{}};
  new Function('require','module','exports',compiled.outputText)((name)=>{if(name in mods)return mods[name];throw Error('Missing mock '+name);},out,out.exports);
  const component=out.exports.PlanDetail;
  function render(){hooks.render();const view=component({id:'id',onClose:()=>{},onChanged:()=>{}});hooks.commit();return view;}
  render();let view=render();
  const textarea=find(view,node=>node.type==='textarea')[0];
  assert(textarea);textarea.props.onChange({target:{value:'يرجى مراجعة فترة التمويل'}});
  view=render();
  const openButton=find(view,node=>node.type==='button'&&node.props.children==='طلب تعديل')[0];assert(openButton);
  openButton.props.onClick();view=render();
  if(kind==='campaign'){
    // First click opens the funding window, never submits a premature revision.
    assert.equal(calls.length,0);
    const start=find(view,node=>node.type==='input'&&node.props['aria-label']==='تاريخ التمويل من مع طلب التعديل')[0];
    const end=find(view,node=>node.type==='input'&&node.props['aria-label']==='تاريخ التمويل إلى مع طلب التعديل')[0];
    assert(start&&end);assert.equal(start.props.value,'2026-11-02');assert.equal(end.props.value,'');
    if(editFunding){
      start.props.onChange({target:{value:'2026-11-03'}});
      end.props.onChange({target:{value:'2026-11-08'}});
      view=render();
    }
    const confirm=find(view,node=>node.type==='button'&&node.props.children==='تأكيد طلب التعديل')[0];assert(confirm);
    confirm.props.onClick();
  }
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);assert.equal(calls[0].action,'plan_review');
  assert.equal(calls[0].payload.decision,'revision');assert.equal(calls[0].payload.note,'يرجى مراجعة فترة التمويل');
  assert.equal(calls[0].payload.updateFunding,Boolean(editFunding));
  if(editFunding)assert.equal(calls[0].payload.fundingFrom,'2026-11-03'),assert.equal(calls[0].payload.fundingTo,'2026-11-08');
  else assert.equal(Object.prototype.hasOwnProperty.call(calls[0].payload,'fundingFrom'),false);
  return calls[0];
}
(async()=>{
  await scenario('campaign',true);
  console.log('PASS: reviewer updates campaign funding start/end along with revision note');
  await scenario('campaign',false);
  console.log('PASS: ordinary campaign revision leaves funding period untouched');
  await scenario('agenda',false);
  console.log('PASS: agenda revision retains its existing note flow without campaign funding fields');
  console.log('3/3 plan revision UI interactions passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
