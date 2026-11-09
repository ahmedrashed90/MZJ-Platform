// End-to-end-in-component regression of the calendar rating shortcut.
// TSX is transpiled in-memory; React hooks and workflow queries are simulated.
// No network requests or live database writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const jsx = (type, props) => ({ type, props: props || {} });
const jsxRuntime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
const walk = (tree, fn) => {
  if (Array.isArray(tree)) return tree.forEach(child => walk(child, fn));
  if (!tree || typeof tree !== 'object') return;
  fn(tree);
  if (tree.props?.children) walk(tree.props.children, fn);
};
const find = (tree, predicate) => { const matches=[];walk(tree,node=>{if(predicate(node))matches.push(node)});return matches; };
function makeHooks() {
  const state=[], refs=[];
  let stateCursor=0, refCursor=0;
  const effects=[];
  return {
    useState(initial) {
      const slot=stateCursor++;
      if (!(slot in state)) state[slot]=typeof initial === 'function' ? initial() : initial;
      return [state[slot], value => { state[slot]=typeof value==='function' ? value(state[slot]) : value; }];
    },
    useRef(initial) { const slot=refCursor++; if (!(slot in refs)) refs[slot]={current:initial};return refs[slot]; },
    useEffect(callback) { effects.push(callback); },
    useMemo(callback) {return callback();},
    next() {stateCursor=0;refCursor=0;effects.length=0;},
    commit() {const current=effects.splice(0); current.forEach(effect=>effect());},
  };
}
function loadTsx(path, modules) {
  const text=fs.readFileSync(path,'utf8');
  const out=ts.transpileModule(text, {fileName:path,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  assert.equal(out.diagnostics?.length||0,0,`TSX syntax: ${path}`);
  const mod={exports:{}};
  new Function('require','module','exports',out.outputText)((name)=> {
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (!(name in modules)) throw new Error(`Unmocked dependency: ${name} from ${path}`);
    return modules[name];
  },mod,mod.exports);
  return mod.exports;
}
function count(message){ console.log('PASS: '+message); }
const markers={
  WorkHeader(){}, WorkAlert(){}, Empty(){}, MediaLabel(){}, Readiness(){}, Status(){}, WorkHeader2(){},
};
const labels={ calendar:'تقويم تاريخ التسليم',previous:'السابق',next:'التالي',today:'اليوم',required:'المطلوب',loading:'جاري التحميل',noData:'لا توجد بيانات',open:'فتح',invalid:'غير صالح' };
const useCalendarData = () => ({data:{
  rows:[{id:'today-item',task_id:'task-1',task_no:'TSK-0001',task_name:'تاسك',due_on:'2026-11-01',media_kind:'image',idea_name:'صورة',status:'approved',item_readiness:100}],
  ratingSummaries:{'task-1':{total:2,rated:1,missing:1,items:[
    {id:'today-item',idea_name:'صورة',assignee_name:'منفذ أول',status:'approved',rated:true},
    {id:'missing-other-date',idea_name:'فيديو',assignee_name:'منفذ ثان',status:'approved',rated:false},
  ]}},
},reload:async()=>{},loading:false,error:''});
const calendarHooks=makeHooks();
const CalendarTaskDetail = function CalendarTaskDetail(){};
const calendarModule=loadTsx('src/marketing/pages/ReceiptCalendarPage.tsx',{
  react:calendarHooks,
  '@phosphor-icons/react':{CaretLeft:()=>{},CaretRight:()=>{},ArrowSquareOut:()=>{}},
  '../workflow/components':{W:labels,...markers},
  '../workflow/api':{localDay(date=new Date(2026,10,1)){const y=date.getFullYear();const m=String(date.getMonth()+1).padStart(2,'0');const d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`;},showDate:()=>'',useWorkQuery:useCalendarData},
  '../workflow/TaskDetail':{TaskDetail:CalendarTaskDetail},
  '../workflow/PlanDetail':{PlanDetail:()=>null},
});
function renderCalendar(){calendarHooks.next();const tree=calendarModule.ReceiptCalendarPage();calendarHooks.commit();return tree;}
let view=renderCalendar();
const missing=find(view,node=>node.type==='button' && node.props['aria-label']?.startsWith('فتح المطلوب ونموذج تقييم المنفذ'));
assert.equal(missing.length,1);
missing[0].props.onClick();
view=renderCalendar();
let opened=find(view,node=>node.type===CalendarTaskDetail);
assert.equal(opened.length,1);
assert.deepEqual(opened[0].props.onlyItems,['missing-other-date']);
assert.equal(opened[0].props.focusItemId,'missing-other-date');
assert.equal(opened[0].props.openRatingOnLoad,true);
count('Clicking an unrated item opens that exact requirement, even if due on another day');
opened[0].props.onClose();
view=renderCalendar();
find(view,node=>node.type==='button' && node.props['aria-label']?.startsWith('فتح المطلوب وعرض تقييمه'))[0].props.onClick();
view=renderCalendar();
opened=find(view,node=>node.type===CalendarTaskDetail);
assert.deepEqual(opened[0].props.onlyItems,['today-item']);
assert.equal(opened[0].props.openRatingOnLoad,false);
count('Rated items open for inspection without launching another evaluation');

const TaskModal=function Modal(){};
const ItemEditor=function ItemEditor(){};
const itemBase={id:'missing-other-date',idea_name:'فيديو',idea:'فكرة فيديو توضيحي',assignee_name:'منفذ ثان',assigned_to:'executor',media_kind:'video',status:'approved',files:[{id:'final-1',category:'final',status:'ready',format_id:'format-1',mime_type:'image/png',name:'final.png'}],formats:[],format_reviews:[],version:1,rating:null};
let item={...itemBase};
let canRate=true, criteria=[{id:'one',name:'الجودة'},{id:'two',name:'تسليم في الموعد'}];
let saved=[];let refreshed=0;
const taskData=()=>({data:{task:{id:'task-1',task_no:'TSK-0001',name:'تاسك',status:'in_progress',type_name:'تصميم',created_at:'2026-11-01',due_from:'2026-11-01',due_to:'2026-11-01',product_count:1,readiness:100,items:[item]},rejectedItems:[],events:[],formatOptions:[],capabilities:{editTask:false,review:false},canRate},reload:async()=>{refreshed++;},error:'',loading:false});
const hooks=makeHooks();
const commonIcons = new Proxy({}, {get:()=>()=>{}});
const workflowHelpers={finalCoverage:()=>false,ideaFileAllowed:()=>false,workFileMatches:()=>false,workItemReadiness:()=>100,workReviewableFormats:()=>[],workRatingLevel:()=>({css:'good',label:'جيد',stars:4}),isBinaryProductDecisionCriterion:()=>false,supportsWorkMedia:()=>true};
const taskModule=loadTsx('src/marketing/workflow/TaskDetail.tsx',{
  react:hooks,
  '@phosphor-icons/react':commonIcons,
  '../../components/Modal':{Modal:TaskModal},
  '../../auth/AuthContext':{useAuth:()=>({user:{id:'reviewer'}})},
  '../../systemAccess':{hasPermission:()=>true},
  '../../../shared/marketing-workflow':workflowHelpers,
  './components':{W:{...labels,task:'تاسك',assignments:'المطلوبات',taskNo:'رقم التاسك',taskType:'النوع',createdAt:'إنشاء',dueOn:'تسليم',productCount:'المنتجات',assignee:'المنفذ',image:'صورة',video:'فيديو',history:'السجل',emptyTask:'فارغ'},...markers,Field(){},FileLink(){},FilesPreview(){},Formats(){},FormatSelector(){}},
  './api':{showDate:()=>'',showRange:()=>'',uploadWorkFile:async()=>{},useWorkQuery:(resource)=> resource==='task'?taskData():{data:{criteria},reload:async()=>{},error:'',loading:false},workPost:async(action,body)=>{saved.push({action,body});return {ok:true};}},
  '../../../shared/marketing-review-note-format':{parseReviewNote:()=>[]},
  './dashboardSearch':{filterDashboardExecutorItems:(items,names)=>!names?.length ? items : items.filter(item=>names.includes(item.assignee_name))},
});
function renderTask(){hooks.next();const tree=taskModule.TaskDetail({id:'task-1',onlyItems:['missing-other-date'],focusItemId:'missing-other-date',openRatingOnLoad:true,onClose:()=>{},onChanged:()=>{}});hooks.commit();return tree;}
function testModal(tree){return find(tree,node=>node.type===TaskModal && node.props.className==='mkw-rating-modal')[0];}
let detail=renderTask();
detail=renderTask();
assert.equal(testModal(detail).props.open,true);
assert.equal(find(detail,node=>node.props?.item?.id==='missing-other-date').length,1);
assert.equal(find(testModal(detail),node=>node.props?.files?.some?.(file=>file.id==='final-1')).length,1);
count('Deep-linked approved requirement opens its final-file preview and the performer rating form');
testModal(detail).props.onClose();
detail=renderTask();
assert.equal(testModal(detail).props.open,false);
count('Closing the rating form does not reopen it on render');

// Open the same requirement through the dedicated evaluation button and
// confirm the existing form permits a valid score and uses save_rating.
const evaluateButton=find(detail,node=>node.type==='button' && node.props?.children==='تقييم المنفذ')[0];
assert(evaluateButton,'The requirement must still expose its normal rating action');
evaluateButton.props.onClick();
detail=renderTask();
const inputs=find(detail,node=>node.type==='input' && node.props.type==='number');
assert.equal(inputs.length,criteria.length);
for(const input of inputs) input.props.onChange({target:{value:'3'}});
detail=renderTask();
const saveButton=find(detail,node=>node.type==='button' && node.props?.children==='حفظ التقييم')[0];
assert.equal(saveButton.props.disabled,false);
saveButton.props.onClick();
count('The opened requirement exposes a working performer rating form with existing grading rules');

function scenario(status, permission){
 item={...itemBase,status};canRate=permission;
 const freshHooks=makeHooks();
 const freshTaskModule=loadTsx('src/marketing/workflow/TaskDetail.tsx',{
    react:freshHooks,'@phosphor-icons/react':commonIcons,
    '../../components/Modal':{Modal:TaskModal},'../../auth/AuthContext':{useAuth:()=>({user:{id:'reviewer'}})},
    '../../systemAccess':{hasPermission:()=>true},'../../../shared/marketing-workflow':workflowHelpers,
    './components':{W:labels,...markers,Field(){},FileLink(){},FilesPreview(){},Formats(){},FormatSelector(){}},
    './api':{showDate:()=>'',showRange:()=>'',uploadWorkFile:async()=>{},useWorkQuery:resource=>resource==='task'?taskData():{data:{criteria},reload:async()=>{},error:'',loading:false},workPost:async()=>({ok:true})},
    '../../../shared/marketing-review-note-format':{parseReviewNote:()=>[]},
  './dashboardSearch':{filterDashboardExecutorItems:(items,names)=>!names?.length ? items : items.filter(item=>names.includes(item.assignee_name))},
  });
  const render=()=>{freshHooks.next();const tree=freshTaskModule.TaskDetail({id:'task-1',onlyItems:[item.id],focusItemId:item.id,openRatingOnLoad:true,onClose:()=>{}});freshHooks.commit();return tree;};
  render();return render();
}
const notApproved=scenario('in_progress',true);
assert.equal(testModal(notApproved).props.open,true);
assert.equal(find(testModal(notApproved),node=>node.type==='button' && node.props.children==='حفظ التقييم').length,0);
assert.equal(find(notApproved,node=>node.props?.item?.id===item.id).length,1);
const unauthorized=scenario('approved',false);
assert.equal(testModal(unauthorized).props.open,false);
assert.equal(find(unauthorized,node=>node.props?.item?.id===item.id).length,1);
count('Unapproved work opens a read-only form with a clear gate; unauthorized users cannot grade');
Promise.resolve().then(() => new Promise(resolve => setImmediate(resolve))).then(() => {
  assert.equal(saved.length,1);
  assert.equal(saved[0].action,'save_rating');
  assert.equal(saved[0].body.itemId,'missing-other-date');
  assert.equal(saved[0].body.scores.length,criteria.length);
  assert(refreshed>0,'The task must reload after saving the rating');
  count('Saving a rating targets the selected item and refreshes the task');
  console.log('7/7 calendar rating navigation tests passed');
}).catch(error=>{console.error(error);process.exitCode=1});
